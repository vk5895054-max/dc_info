import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withSafeFetch } from '../../common/security/ssrf-guard';
import { GrizzlyOrder } from './entities/grizzly-order.entity';
import { GrizzlyBalanceSnapshot } from './entities/grizzly-balance-snapshot.entity';

export interface BuyNumberOptions {
  service?: string;
  country?: string;
  maxPrice?: number;
  providerIds?: string;
  exceptProviderIds?: string;
  phoneException?: string;
  minPrice?: number;
}

export interface GrizzlyAccountNumber {
  id: number;
  number: string;
  status: number;
  code: string | null;
  price: string;
  service_name: string;
  service_code: string;
  country_code: string;
  country_phone_code: string;
  country_name: string;
  provider_id: number;
  is_active: number;
  created_at: string;
  end_at: string;
  allow_cancel_sec: number;
  multiple_sms: boolean;
  sms_tip: string | null;
}

interface GrizzlyConfig {
  apiKey: string;
  baseUrl: string;
  country: string;
  service: string;
  priceLadder: number[];
  requestTimeoutMs: number;
  accountToken: string;
}

/**
 * GrizzlySMS integration — virtual numbers for WhatsApp registration, purchased in USD for Indian
 * (country 22) numbers only, walking a descending price ladder so a cheap number is never declined
 * outright when the first budget is unavailable. The service persists every successful purchase and
 * every balance check so the operator gets durable order + balance history.
 *
 * Wire protocol is sms-activate compatible (GrizzlySMS documents its compatibility explicitly):
 *   getNumber   -> ACCESS_NUMBER:<activationId>:<phone> | NO_NUMBERS / NO_BALANCE / BAD_KEY / ...
 *   getBalance  -> ACCESS_BALANCE:<balance>
 *   getStatus   -> STATUS_WAIT_CODE / STATUS_WAIT_RETRY:<code> / STATUS_WAIT_RESEND /
 *                  STATUS_CANCEL / STATUS_OK:<code>
 *   setStatus   -> ACCESS_READY / ACCESS_RETRY_GET / ACCESS_ACTIVATION / ACCESS_CANCEL
 * All fetches run through withSafeFetch (SSRF-guarded) with a bounded timeout.
 */
@Injectable()
export class GrizzlySmsService {
  private readonly logger = new Logger(GrizzlySmsService.name);

  constructor(
    @InjectRepository(GrizzlyOrder, 'data')
    private readonly orders: Repository<GrizzlyOrder>,
    @InjectRepository(GrizzlyBalanceSnapshot, 'data')
    private readonly snapshots: Repository<GrizzlyBalanceSnapshot>,
    private readonly config: ConfigService,
  ) {}

  private cfg(): GrizzlyConfig {
    const ladder = (this.config.get<string>('grizzlysms.priceLadder', '1,0.85,0.75') || '1,0.85,0.75')
      .split(',')
      .map(v => Number(v.trim()))
      .filter(v => Number.isFinite(v) && v > 0);
    return {
      apiKey: this.config.get<string>('grizzlysms.apiKey', '').trim(),
      baseUrl:
        this.config.get<string>('grizzlysms.baseUrl', '') ||
        'https://api.grizzlysms.com/stubs/handler_api.php',
      country: this.config.get<string>('grizzlysms.country', '22').trim() || '22',
      service: this.config.get<string>('grizzlysms.service', 'wa').trim() || 'wa',
      priceLadder: ladder.length ? ladder : [1, 0.85, 0.75],
      requestTimeoutMs: this.config.get<number>('grizzlysms.requestTimeoutMs', 20000),
      accountToken: this.config.get<string>('grizzlysms.accountToken', '').trim(),
    };
  }

  private assertConfigured(cfg: GrizzlyConfig): void {
    if (!cfg.apiKey) {
      throw new BadRequestException('GRIZZLYSMS_API_KEY is not configured — set it in the environment');
    }
  }

  private async call(action: string, params: Record<string, string>): Promise<string> {
    const cfg = this.cfg();
    this.assertConfigured(cfg);
    const url = new URL(cfg.baseUrl);
    const search = new URLSearchParams({ api_key: cfg.apiKey, action, ...params });
    const query = search.toString();
    const target = url.search ? `${url.toString()}${url.search.endsWith('?') ? '' : '&'}${query}` : `${url.toString()}?${query}`;
    const timeoutMs = cfg.requestTimeoutMs;
    const body = await withSafeFetch(
      target,
      { method: 'GET', signal: AbortSignal.timeout(timeoutMs) },
      r => r.text(),
    );
    this.logger.log(`grizzlysms ${action} -> ${body.slice(0, 500)}`);
    return body.trim();
  }

  /** Fresh balance check against the provider; persists a snapshot for history. */
  async checkBalance(): Promise<{ balance: number; currency: string | null; raw: string }> {
    const raw = await this.call('getBalance', {});
    const parsed = this.parseBalance(raw);
    if (parsed === null) throw new BadRequestException(`GrizzlySMS balance failed: ${raw}`);
    await this.snapshots.save(
      this.snapshots.create({ balance: parsed.balance, currency: parsed.currency, rawResponse: raw }),
    );
    return { ...parsed, raw };
  }

  async balanceHistory(limit = 50): Promise<GrizzlyBalanceSnapshot[]> {
    return this.snapshots.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async ordersList(limit = 100): Promise<GrizzlyOrder[]> {
    return this.orders.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * Live bought-numbers list from the Grizzly account API (Bearer JWT from grizzlysms.com).
   * The JWT lives ~1h, so the caller may pass a fresh token per request (X-Grizzly-Token);
   * otherwise the server env GRIZZLYSMS_ACCOUNT_TOKEN is used. Read-only, no DB writes.
   */
  async accountNumbers(explicitToken?: string): Promise<GrizzlyAccountNumber[]> {
    const cfg = this.cfg();
    const token = (explicitToken || '').trim() || cfg.accountToken;
    if (!token) {
      throw new BadRequestException(
        'Grizzly account token missing — paste a fresh Bearer token from grizzlysms.com (it expires ~1h) or set GRIZZLYSMS_ACCOUNT_TOKEN',
      );
    }
    const timeoutMs = cfg.requestTimeoutMs;
    const url = 'https://grizzlysms.com/api/sms-users/active-numbers';
    let status = 0;
    const body = await withSafeFetch(
      url,
      {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}` },
      },
      async r => {
        status = r.status;
        return r.text();
      },
    );
    if (status === 401 || status === 403) {
      throw new BadRequestException('Grizzly account token expired/invalid — paste a fresh token from grizzlysms.com');
    }
    if (status < 200 || status >= 300) {
      throw new BadRequestException(`Grizzly account API failed: HTTP ${status}`);
    }
    try {
      const data = JSON.parse(body);
      return Array.isArray(data) ? data : [];
    } catch {
      throw new BadRequestException(`Grizzly account API returned non-JSON: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Purchase a WhatsApp number. Walks the price ladder ($1.00 -> $0.85 -> $0.75) in descending
   * order: the first budget with an available Indian number wins. When every rung returns
   * NO_NUMBERS the last provider message is surfaced as a BadRequest. Terminal errors (BAD_KEY,
   * NO_BALANCE, ...) fail fast with the provider's message.
   */
  async buyNumber(opts: BuyNumberOptions): Promise<GrizzlyOrder> {
    const cfg = this.cfg();
    this.assertConfigured(cfg);
    const service = (opts.service || cfg.service).trim();
    const country = (opts.country || cfg.country).trim();
    const explicitPrice = opts.maxPrice;
    const ladder = explicitPrice !== undefined && explicitPrice > 0
      ? [explicitPrice]
      : cfg.priceLadder;

    let lastNoNumbers = '';
    for (const price of ladder) {
      const params: Record<string, string> = { service, country, maxPrice: String(price) };
      if (opts.minPrice !== undefined) params.minPrice = String(opts.minPrice);
      if (opts.providerIds) params.providerIds = opts.providerIds;
      if (opts.exceptProviderIds) params.exceptProviderIds = opts.exceptProviderIds;
      if (opts.phoneException) params.phoneException = opts.phoneException;

      const raw = await this.call('getNumber', params);
      const ok = /^ACCESS_NUMBER:/.test(raw);
      const isNoNumbers = raw === 'NO_NUMBERS';
      this.logger.log(`grizzlysms getNumber maxPrice=$ ${price} -> ${raw.slice(0, 300)}`);
      if (ok) {
        const parsed = this.parseNumber(raw);
        const order = this.orders.create({
          activationId: parsed.activationId,
          phone: parsed.phone,
          service,
          country,
          priceUsed: price,
          status: 'pending',
          rawResponse: raw,
        });
        await this.orders.save(order);
        this.logger.log(`grizzlysms order ${order.activationId} phone=${parsed.phone} @ $ ${price}`);
        return order;
      }
      if (isNoNumbers) {
        lastNoNumbers = raw;
        continue; // cheaper rung still available
      }
      throw new BadRequestException(`GrizzlySMS getNumber failed: ${raw}`);
    }
    throw new BadRequestException(`GrizzlySMS NO_NUMBERS at every price in the ladder${lastNoNumbers ? ` (last: ${lastNoNumbers})` : ''}`);
  }

  /** Map a provider state onto the persisted order and return the detailed status. */
  async getOrderStatus(activationId: string): Promise<{ status: string; raw: string }> {
    const raw = await this.call('getStatus', { id: activationId });
    const status = this.parseStatus(raw);
    await this.orders.update({ activationId }, { status, rawResponse: raw });
    return { status, raw };
  }

  /**
   * Track an activation bought outside dc_info (CLI/MCP/direct API) so it shows in this
   * profile's order list. Fetches live status, then upserts the row by activationId.
   */
  async trackActivation(
    activationId: string,
    opts: { phone?: string; service?: string; country?: string } = {},
  ): Promise<GrizzlyOrder> {
    const id = (activationId || '').trim();
    if (!id) throw new BadRequestException('activationId is required');
    const cfg = this.cfg();
    this.assertConfigured(cfg);
    const raw = await this.call('getStatus', { id });
    const status = this.parseStatus(raw);
    const existing = await this.orders.findOne({ where: { activationId: id } });
    if (existing) {
      existing.status = status;
      existing.rawResponse = raw;
      if (opts.phone) existing.phone = opts.phone;
      if (opts.service) existing.service = opts.service;
      if (opts.country) existing.country = opts.country;
      return this.orders.save(existing);
    }
    const order = this.orders.create({
      activationId: id,
      phone: opts.phone || null,
      service: (opts.service || cfg.service).trim(),
      country: (opts.country || cfg.country).trim(),
      priceUsed: null,
      status,
      rawResponse: raw,
    });
    return this.orders.save(order);
  }

  /**
   * setStatus bridge. Allowed keys are the sms-activate statuses GrizzlySMS accepts:
   *   ready  -> 1   (number is ready / SMS arrival confirmed pending)
   *   resend -> 3   (request another SMS)
   *   done   -> 6   (activation complete)
   *   cancel -> 8   (cancel + refund)
   */
  async setOrderStatus(activationId: string, statusKey: string | number): Promise<{ ok: string; raw: string }> {
    const status = String(statusKey);
    const allowed = new Set(['-1', '1', '3', '6', '8']);
    if (!allowed.has(status)) {
      throw new BadRequestException(`Invalid grizzlysms status "${status}" (use -1, 1, 3, 6 or 8)`);
    }
    const raw = await this.call('setStatus', { id: activationId, status });
    const ok = /^ACCESS_READY$|^ACCESS_RETRY_GET$|^ACCESS_ACTIVATION$|^ACCESS_CANCEL$/.test(raw);
    if (!ok) throw new BadRequestException(`GrizzlySMS setStatus failed: ${raw}`);
    await this.getOrderStatus(activationId);
    return { ok: raw, raw };
  }

  private parseNumber(raw: string): { activationId: string; phone: string } {
    const m = /^ACCESS_NUMBER:([^:]+):(.+)$/.exec(raw);
    if (!m) throw new BadRequestException(`GrizzlySMS unexpected getNumber response: ${raw}`);
    return { activationId: m[1].trim(), phone: m[2].trim() };
  }

  private parseBalance(raw: string): { balance: number; currency: string | null } | null {
    const m = /^ACCESS_BALANCE:([\d.]+)$/.exec(raw);
    if (!m) return null;
    return { balance: Number(m[1]), currency: null };
  }

  private parseStatus(raw: string): string {
    if (/^STATUS_OK:/.test(raw)) return 'OK';
    if (/^STATUS_WAIT_RETRY:/.test(raw)) return 'WAIT_RETRY';
    if (raw === 'STATUS_WAIT_CODE') return 'WAIT_CODE';
    if (raw === 'STATUS_WAIT_RESEND') return 'WAIT_RESEND';
    if (raw === 'STATUS_CANCEL') return 'CANCEL';
    return raw.slice(0, 60);
  }
}