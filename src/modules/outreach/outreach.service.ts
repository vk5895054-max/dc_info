import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionService } from '../session/session.service';
import { Session } from '../session/entities/session.entity';
import { SessionRestrictionStore } from '../session/session-restriction-store.service';
import { BulkMessageService } from '../message/bulk-message.service';
import { BatchStatus } from '../message/entities/message-batch.entity';
import { OutreachCampaign, OutreachStatus } from './entities/outreach-campaign.entity';
import { CreateOutreachCampaignDto, OutreachCampaignResponseDto } from './dto/outreach-campaign.dto';
import { Message, MessageDirection } from '../message/entities/message.entity';
import { In } from 'typeorm';
import { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';
import { Optional } from '@nestjs/common';
import {
  OutreachSession as AllocationSession,
  allocateOutreach,
  warmupAllowanceForAge,
  OutreachBurst,
} from './outreach-allocation';

const DEFAULT_WARMUP_SCHEDULE = [20, 40, 80, 160, 320, 640, 1000];
const DEFAULT_BURST_SIZE = 20;
const DEFAULT_COOLDOWN_MIN_MS = 4 * 60 * 1000;
const DEFAULT_COOLDOWN_MAX_MS = 8 * 60 * 1000;
const DEFAULT_MIN_DELAY_MS = 30000;
const DEFAULT_MAX_DELAY_MS = 120000;
const TICK_MS = 5000;
const EXECUTION_CACHE_TTL_MS = 3000;

interface SessionRuntime {
  sessionId: string;
  bursts: OutreachBurst[];
  nextBurstIndex: number;
  inFlight: boolean;
  nextAvailableAt: number;
  activeBatchId?: string;
}

interface CampaignRuntime {
  campaignId: string;
  sessions: Map<string, SessionRuntime>;
  timer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
  currentWave: number;
  waveCooldownUntil: number;
}

function isBlockedError(code?: string, message?: string): boolean {
  const c = (code || '').toUpperCase();
  const m = (message || '').toLowerCase();
  if (['SEND_BLOCKED', 'SEND_PACING_LIMITED', 'RATE_LIMIT', 'BLOCKED', 'BAN'].includes(c)) return true;
  return /rate[- ]?limit|blocked|ban|timelock|reachout|tos_block|spam|restricted/.test(m);
}

function avgDelayMs(strategy: OutreachCampaign['strategy']): number {
  return (strategy.pacing.maxDelayMs + strategy.pacing.minDelayMs) / 2;
}

function avgCooldownMs(strategy: OutreachCampaign['strategy']): number {
  return (strategy.cooldownMinMs + strategy.cooldownMaxMs) / 2;
}

@Injectable()
export class OutreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachService.name);
  private readonly runtimes = new Map<string, CampaignRuntime>();
  private readonly executionCache = new Map<string, { data: any; at: number }>();

  constructor(
    @InjectRepository(OutreachCampaign, 'data')
    private readonly campaignRepository: Repository<OutreachCampaign>,
    private readonly sessionService: SessionService,
    private readonly bulkMessage: BulkMessageService,
    private readonly restrictionStore: SessionRestrictionStore,
    @InjectRepository(Message, 'data')
    private readonly messageRepository: Repository<Message>,
    @Optional()
    private readonly lidMappingStore?: LidMappingStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    const running = await this.campaignRepository.find({ where: { status: OutreachStatus.RUNNING } });
    for (const campaign of running) {
      this.logger.log(`resuming campaign ${campaign.name} (${campaign.id})`);
      this.startRuntime(campaign);
    }
  }

  private async resolveSessionPool(
    dtoNames: string[],
    warmupSchedule: number[],
    maxPerSessionPerDay?: number,
    totalContacts?: number,
  ): Promise<{ sessions: Array<AllocationSession & { entity: Session }>; missing: string[] }> {
    const all = await this.sessionService.findAll();
    const byName = new Map(all.map(s => [s.name, s]));
    const missing: string[] = [];
    const resolved: Array<AllocationSession & { entity: Session }> = [];

    for (const name of dtoNames) {
      const entity = byName.get(name);
      if (!entity) {
        missing.push(name);
        continue;
      }
      const ageDays = entity.createdAt ? (Date.now() - new Date(entity.createdAt).getTime()) / 86400000 : 0;
      const warmupCap = warmupAllowanceForAge(warmupSchedule, ageDays);
      // Keep remaining contacts waiting instead of dropping them as unassigned.
      // warmupCap is a daily pacing hint, not a hard allocation limit for this wave.
      // Ensure capacity can hold all contacts divided across sessions.
      const neededPerSession = totalContacts ? Math.ceil(totalContacts / dtoNames.length) + 5 : warmupCap;
      const effectiveCap = Math.max(warmupCap, neededPerSession);
      const capacity = maxPerSessionPerDay ? Math.min(effectiveCap, maxPerSessionPerDay) : effectiveCap;
      resolved.push({
        id: entity.id,
        name: entity.name,
        capacity,
        entity,
      });
    }
    return { sessions: resolved, missing };
  }

  private buildBurstProgress(
    distribution: OutreachCampaign['distribution'],
    strategy: OutreachCampaign['strategy'],
    startedAt?: Date | null,
  ): OutreachCampaign['burstProgress'] {
    if (!distribution) return [];
    const avgDelay = avgDelayMs(strategy);
    const avgCooldown = avgCooldownMs(strategy);
    const base = startedAt ? startedAt.getTime() : Date.now();
    const out: NonNullable<OutreachCampaign['burstProgress']> = [];
    // Interleave estimation: round-robin wave timing — burst 0 of all sessions first, then burst 1, etc.
    // For simple per-session sequential ETA we estimate linearly per session.
    for (const sd of distribution) {
      let cursor = base;
      for (let i = 0; i < sd.bursts.length; i++) {
        const b = sd.bursts[i];
        const burstMs = b.contacts.length * avgDelay;
        const warmupMs = i === 0 ? 0 : avgCooldown;
        if (i > 0) cursor += avgCooldown;
        const estStart = new Date(cursor).toISOString();
        const estEnd = new Date(cursor + burstMs).toISOString();
        out.push({
          sessionId: sd.sessionId,
          sessionName: sd.sessionName,
          burstIndex: b.burstIndex,
          burstSize: b.contacts.length,
          batchId: null,
          status: 'pending',
          sent: 0,
          failed: 0,
          blocked: 0,
          pending: b.contacts.length,
          contacts: b.contacts,
          results: [],
          startTime: null,
          endTime: null,
          estimatedStart: estStart,
          estimatedEnd: estEnd,
          cooldownMs: i < sd.bursts.length - 1 ? avgCooldown : null,
          warmupMs,
        });
        cursor += burstMs;
      }
    }
    return out;
  }

  private async recomputeEstimatesAndSave(campaign: OutreachCampaign): Promise<void> {
    const wasRunning = campaign.status === OutreachStatus.RUNNING;
    this.recomputeEstimatesSync(campaign);
    if (wasRunning && campaign.status === OutreachStatus.COMPLETED) {
      await this.campaignRepository.save(campaign);
    } else if (campaign.sessionProgress || campaign.burstProgress) {
      // For stuck campaigns, ensure the fix is persisted even if status already completed
      // Check if sessionProgress was corrected
      await this.campaignRepository.save(campaign);
    }
  }

  private recomputeEstimatesSync(campaign: OutreachCampaign): void {
    if (!campaign.burstProgress || !campaign.startedAt) return;
    const avgDelay = avgDelayMs(campaign.strategy);
    const avgCooldown = avgCooldownMs(campaign.strategy);
    // Group by session
    const bySession = new Map<string, typeof campaign.burstProgress>();
    for (const bp of campaign.burstProgress) {
      const arr = bySession.get(bp.sessionId) ?? [];
      arr.push(bp);
      bySession.set(bp.sessionId, arr);
    }
    for (const [, list] of bySession) {
      list.sort((a, b) => a.burstIndex - b.burstIndex);
      let cursor = new Date(campaign.startedAt).getTime();
      for (let i = 0; i < list.length; i++) {
        const bp = list[i];
        if (bp.status === 'completed' || bp.status === 'failed') {
          const end = bp.endTime ? new Date(bp.endTime).getTime() : cursor + bp.burstSize * avgDelay;
          cursor = end + (bp.cooldownMs ?? avgCooldown);
          continue;
        }
        if (bp.status === 'running') {
          const start = bp.startTime ? new Date(bp.startTime).getTime() : cursor;
          bp.estimatedStart = new Date(start).toISOString();
          bp.estimatedEnd = new Date(start + bp.burstSize * avgDelay).toISOString();
          cursor = start + bp.burstSize * avgDelay + (bp.cooldownMs ?? avgCooldown);
          continue;
        }
        // pending or cooldown
        if (i > 0) {
          const prev = list[i - 1];
          const prevEnd = prev.endTime ? new Date(prev.endTime).getTime() : new Date(prev.estimatedEnd!).getTime();
          cursor = prevEnd + (prev.cooldownMs ?? avgCooldown);
        }
        bp.estimatedStart = new Date(cursor).toISOString();
        bp.estimatedEnd = new Date(cursor + bp.burstSize * avgDelay).toISOString();
        cursor += bp.burstSize * avgDelay + (bp.cooldownMs ?? avgCooldown);
      }
    }
    // Sync sessionProgress from burstProgress for stuck campaigns
    if (campaign.sessionProgress && campaign.burstProgress) {
      for (const p of campaign.sessionProgress) {
        const bursts = campaign.burstProgress.filter(b => b.sessionId === p.sessionId);
        if (bursts.length > 0) {
          p.sent = bursts.reduce((a, b) => a + b.sent, 0);
          p.failed = bursts.reduce((a, b) => a + b.failed, 0);
          (p as any).blocked = bursts.reduce((a, b) => a + b.blocked, 0);
          p.pending = Math.max(0, p.total - p.sent - p.failed - (p as any).blocked);
        }
      }
      const pendingTotal = campaign.sessionProgress.reduce((a, p) => a + (p.pending ?? 0), 0);
      const sentTotal = campaign.sessionProgress.reduce((a, p) => a + (p.sent ?? 0), 0);
      if (pendingTotal <= 0 && sentTotal > 0 && campaign.status === OutreachStatus.RUNNING) {
        campaign.status = OutreachStatus.COMPLETED;
        campaign.completedAt = new Date();
        this.stopRuntime(campaign.id);
      }
      campaign.sessionProgress = [...campaign.sessionProgress];
      campaign.burstProgress = [...campaign.burstProgress];
    }
  }

  private recomputeEstimates(campaign: OutreachCampaign): void {
    this.recomputeEstimatesSync(campaign);
  }

  private computeGlobalTiming(campaign: OutreachCampaign): {
    startedAt: string | null;
    estimatedFinish: string | null;
    remainingBursts: number;
    totalBursts: number;
    completedBursts: number;
  } {
    const totalBursts =
      campaign.burstProgress?.length ?? campaign.distribution?.reduce((a, s) => a + s.bursts.length, 0) ?? 0;
    const completedBursts = campaign.burstProgress?.filter(b => b.status === 'completed').length ?? 0;
    const remainingBursts = totalBursts - completedBursts;
    if (!campaign.startedAt)
      return { startedAt: null, estimatedFinish: null, remainingBursts, totalBursts, completedBursts };
    if (campaign.status === 'completed' && campaign.completedAt) {
      return {
        startedAt: campaign.startedAt.toISOString(),
        estimatedFinish: campaign.completedAt.toISOString(),
        remainingBursts,
        totalBursts,
        completedBursts,
      };
    }
    if (!campaign.burstProgress || campaign.burstProgress.length === 0)
      return {
        startedAt: campaign.startedAt.toISOString(),
        estimatedFinish: null,
        remainingBursts,
        totalBursts,
        completedBursts,
      };
    // Latest estimatedEnd among pending/running is global ETA (sessions run in parallel, so max)
    const pending = campaign.burstProgress.filter(b => b.status !== 'completed' && b.estimatedEnd);
    if (pending.length === 0) {
      const last = [...campaign.burstProgress].sort(
        (a, b) => new Date(b.estimatedEnd!).getTime() - new Date(a.estimatedEnd!).getTime(),
      )[0];
      return {
        startedAt: campaign.startedAt.toISOString(),
        estimatedFinish: last.estimatedEnd,
        remainingBursts,
        totalBursts,
        completedBursts,
      };
    }
    const maxMs = Math.max(
      ...pending.map(b => new Date(b.estimatedEnd!).getTime()),
      ...campaign.burstProgress.filter(b => b.endTime).map(b => new Date(b.endTime!).getTime()),
    );
    return {
      startedAt: campaign.startedAt.toISOString(),
      estimatedFinish: new Date(maxMs).toISOString(),
      remainingBursts,
      totalBursts,
      completedBursts,
    };
  }

  private async createCampaign(dto: CreateOutreachCampaignDto): Promise<OutreachCampaign> {
    const warmupSchedule = dto.strategy?.warmupSchedule ?? DEFAULT_WARMUP_SCHEDULE;
    const names = dto.sessions.map(s => s.sessionName);
    const { sessions, missing } = await this.resolveSessionPool(
      names,
      warmupSchedule,
      dto.strategy?.maxPerSessionPerDay,
      dto.contacts.length,
    );
    if (missing.length) {
      throw new BadRequestException(
        `Unknown session(s): ${missing.join(', ')}. Register/save them first (e.g. via the snapshot feature).`,
      );
    }

    const burstSize = dto.strategy?.burstSize ?? DEFAULT_BURST_SIZE;
    const allocation = allocateOutreach(
      dto.contacts.map(c => ({ phone: c.phone, name: c.name })),
      sessions.map(s => ({ id: s.id, name: s.name, capacity: s.capacity })),
      burstSize,
    );

    const realDistribution = allocation.sessions.map(s => ({
      sessionId: s.id,
      sessionName: s.name,
      assigned: s.assigned,
      contacts: s.bursts.flatMap(b => b.contacts),
      bursts: s.bursts.map(b => ({ burstIndex: b.burstIndex, contacts: b.contacts })),
    }));

    const simulatedMode = dto.simulatedMode ?? false;
    const simulatedSuccessRate = dto.simulatedSuccessRate ?? 64;

    // Build display distribution: either the real one, or an inflated version for simulated mode
    let displayDistribution = realDistribution;
    let displayRealDistribution: typeof realDistribution | null = null;

    if (simulatedMode) {
      // Store real distribution separately; build a large display distribution
      // Cap real sending to 60 bursts per session so large campaigns finish in 6-7 hours
      const MAX_REAL_BURSTS = 60;
      displayRealDistribution = realDistribution.map(s => {
        const maxRealContacts = MAX_REAL_BURSTS * burstSize;
        if (s.contacts.length <= maxRealContacts) return s;
        const cappedContacts = s.contacts.slice(0, maxRealContacts);
        const cappedBursts = s.bursts.slice(0, MAX_REAL_BURSTS);
        return {
          ...s,
          assigned: cappedContacts.length,
          contacts: cappedContacts,
          bursts: cappedBursts
        };
      });

      const DISPLAY_BURSTS_PER_SESSION = 3;
      const allContacts = dto.contacts.map(c => ({ phone: c.phone, name: c.name }));
      const contactsPerSession = Math.ceil(allContacts.length / sessions.length);

      displayDistribution = sessions.map((s, sIdx) => {
        const start = sIdx * contactsPerSession;
        const sessionContacts = allContacts.slice(start, start + contactsPerSession);
        const contactsPerBurst = Math.ceil(sessionContacts.length / DISPLAY_BURSTS_PER_SESSION);
        const bursts: Array<{ burstIndex: number; contacts: Array<{ phone: string; name?: string }> }> = [];
        for (let i = 0; i < DISPLAY_BURSTS_PER_SESSION; i++) {
          const burstContacts = sessionContacts.slice(i * contactsPerBurst, (i + 1) * contactsPerBurst);
          if (burstContacts.length > 0) {
            bursts.push({ burstIndex: i, contacts: burstContacts });
          }
        }
        return {
          sessionId: s.id,
          sessionName: s.name,
          assigned: sessionContacts.length,
          contacts: sessionContacts,
          bursts,
        };
      });
    }

    const isMulti = (dto as any).isMulti ?? false;
    const extraMedia = (dto as any).extraMedia ?? null;
    const buttons = (dto as any).buttons ?? null;
    // Multi-message engine: copy slow engine but with 10-15s intra-person pacing, less restrictive (no preCheck, no saveContact)
    const strategy = {
      burstSize,
      cooldownMinMs: dto.strategy?.cooldownMinMs ?? DEFAULT_COOLDOWN_MIN_MS,
      cooldownMaxMs: Math.max(
        dto.strategy?.cooldownMaxMs ?? DEFAULT_COOLDOWN_MAX_MS,
        dto.strategy?.cooldownMinMs ?? DEFAULT_COOLDOWN_MIN_MS,
      ),
      warmupSchedule,
      pacing: isMulti
        ? { minDelayMs: 10000, maxDelayMs: 15000 }
        : {
            minDelayMs: dto.strategy?.pacing?.minDelayMs ?? DEFAULT_MIN_DELAY_MS,
            maxDelayMs: dto.strategy?.pacing?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
          },
      preCheckNumbers: isMulti ? false : (dto.strategy?.preCheckNumbers ?? true),
      saveContactFirst: isMulti ? false : (dto.strategy?.saveContactFirst ?? true),
      contactName: dto.strategy?.contactName,
      maxPerSessionPerDay: dto.strategy?.maxPerSessionPerDay,
    };

    const burstProgress = this.buildBurstProgress(displayDistribution, strategy, null);

    // Handle template vs custom and credit calculation
    let creditCost = dto.creditCost ?? 1;
    let messageType = dto.messageType || 'text';
    let mediaData = dto.mediaData ?? null;
    let templateId = dto.templateId ?? null;
    if (isMulti && extraMedia) {
      // multi credit: 1 text + images*2 + video 2 + document 2
      const imgCount = extraMedia.images?.length ?? 0;
      const hasVideo = extraMedia.video ? 1 : 0;
      const hasDoc = extraMedia.document ? 1 : 0;
      const multiCost = 1 + imgCount * 2 + hasVideo * 2 + hasDoc * 2;
      creditCost = dto.creditCost ?? multiCost;
      messageType = 'mixed';
    }
    
    // If template is selected, fetch its credit cost
    if (templateId) {
      try {
        // Template credit cost will be resolved via frontend, but fallback to 1
        creditCost = dto.creditCost ?? creditCost;
      } catch {}
    }
    
    // Calculate total credit usage
    const totalCredits = allocation.totalAssigned * creditCost;

    // Wapp Btn: if buttons provided, force messageType buttons
    if (buttons?.length) {
      messageType = 'buttons';
      if (!creditCost || creditCost===1) creditCost = 1.5 as any;
    }
    const campaign = this.campaignRepository.create({
      name: dto.name,
      status: OutreachStatus.SCHEDULED,
      messageText: dto.messageText,
      templateId,
      messageType,
      mediaData,
      extraMedia: extraMedia as any,
      isMulti: isMulti as any,
      buttons: buttons as any,
      creditCost,
      totalCredits,
      resellerId: dto.resellerId ?? null,
      userId: dto.userId ?? null,
      createdByEmail: (dto as any).createdByEmail ?? null,
      createdByRole: (dto as any).createdByRole ?? null,
      variableMap: dto.variableMap ?? null,
      contacts: dto.contacts.map(c => ({ phone: c.phone, name: c.name })),
      sessions: sessions.map(s => ({ sessionName: s.name, sessionId: s.id })),
      strategy,
      distribution: displayDistribution,
      realDistribution: displayRealDistribution,
      simulatedMode,
      simulatedSuccessRate,
      sessionProgress: displayDistribution.map(d => ({
        sessionId: d.sessionId,
        sessionName: d.sessionName,
        total: d.assigned,
        sent: 0,
        failed: 0,
        blocked: 0,
        pending: d.assigned,
      })),
      burstProgress,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    const saved = await this.campaignRepository.save(campaign);
    this.logger.log(
      `outreach campaign '${saved.name}' (${saved.id}) allocated ${allocation.totalAssigned} of ${dto.contacts.length} contacts ` +
        `across ${sessions.length} sessions (${allocation.unassigned.length} unassigned; warm-up-capped).` +
        (simulatedMode ? ` [SIMULATED MODE: display shows ${dto.contacts.length} contacts, real sends ${allocation.totalAssigned}]` : ''),
    );
    return saved;
  }

  private drawCooldown(minMs: number, maxMs: number): number {
    const lo = Math.max(0, minMs ?? 0);
    const hi = Math.max(lo, maxMs ?? lo);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /**
   * Generate simulated per-contact delivery results for a burst.
   * Used in simulated mode to produce fake but realistic-looking reports.
   */
  private generateSimulatedResults(
    contacts: Array<{ phone: string; name?: string }>,
    successRate: number,
    baseTime?: number,
  ): Array<{
    phone: string;
    name?: string;
    chatId: string;
    status: string;
    sentAt?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const results: Array<{
      phone: string;
      name?: string;
      chatId: string;
      status: string;
      sentAt?: string;
      errorCode?: string;
      errorMessage?: string;
    }> = [];
    const successCount = Math.round(contacts.length * (successRate / 100));
    // Shuffle contacts so success/fail distribution looks random
    const shuffled = [...contacts].sort(() => Math.random() - 0.5);
    const now = baseTime ?? Date.now();

    const errorTypes = [
      { code: 'NOT_ON_WHATSAPP', message: 'Number not on WhatsApp', weight: 35 },
      { code: 'INVALID_NUMBER', message: 'Invalid number / Out of range', weight: 15 },
      { code: 'USER_BLOCKED', message: 'User blocked / Privacy settings', weight: 10 },
      { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded', weight: 5 },
      { code: 'SERVER_TIMEOUT', message: 'WhatsApp server timeout - Queue full', weight: 5 },
      { code: 'SPAM_FLAGGED', message: 'Spam detection flagged', weight: 5 },
      { code: 'SESSION_DISCONNECTED', message: 'Session disconnected - Engine not ready', weight: 5 },
      { code: 'NETWORK_TIMEOUT', message: 'Network timeout', weight: 5 },
      { code: 'BUSINESS_NOT_ALLOWED', message: 'Business number not allowed', weight: 5 },
      { code: 'PHONE_SWITCHED_OFF', message: 'Phone switched off', weight: 5 },
      { code: 'NUMBER_DEACTIVATED', message: 'Number deactivated', weight: 3 },
      { code: 'CARRIER_BLOCKED', message: 'Carrier blocked', weight: 2 },
    ];
    const totalWeight = errorTypes.reduce((a, e) => a + e.weight, 0);

    const pickError = () => {
      let r = Math.random() * totalWeight;
      for (const e of errorTypes) {
        r -= e.weight;
        if (r <= 0) return e;
      }
      return errorTypes[0];
    };

    for (let i = 0; i < shuffled.length; i++) {
      const c = shuffled[i];
      const isSuccess = i < successCount;
      // Stagger sentAt times across a realistic window (spread over burst duration)
      const offsetMs = Math.floor(Math.random() * 300000); // up to 5 min spread
      if (isSuccess) {
        results.push({
          phone: c.phone,
          name: c.name,
          chatId: `${c.phone.replace(/\D/g, '')}@c.us`,
          status: 'sent',
          sentAt: new Date(now - offsetMs).toISOString(),
        });
      } else {
        const err = pickError();
        results.push({
          phone: c.phone,
          name: c.name,
          chatId: `${c.phone.replace(/\D/g, '')}@c.us`,
          status: 'failed',
          errorCode: err.code,
          errorMessage: err.message,
        });
      }
    }
    return results;
  }

  private applyVariables(text: string, variableMap: Record<string, string> | null): string {
    if (!variableMap) return text;
    let out = text;
    for (const [k, v] of Object.entries(variableMap)) {
      out = out.split(`{{${k}}}`).join(v);
    }
    return out;
  }

  private buildMessagesForBurst(
    burst: OutreachBurst,
    campaign: OutreachCampaign,
    msgType: string,
    mediaData: any,
  ): Array<{ chatId: string; type: string; content: any; variables: Record<string, string> }> {
    const out: Array<{ chatId: string; type: string; content: any; variables: Record<string, string> }> = [];
    const hasButtons = (campaign as any).buttons?.length;
    if (hasButtons) {
      const btns = (campaign as any).buttons as any;
      const extra = (campaign as any).extraMedia as any;
      const mediaDataLocal = mediaData as any;
      for (const c of burst.contacts) {
        const vars = { name: c.name || c.phone, phone: c.phone };
        const baseText = this.applyVariables(campaign.messageText, { ...campaign.variableMap, ...vars } as any);
        const image = extra?.images?.[0] || mediaDataLocal;
        const document = extra?.document;
        const content: any = { text: baseText, buttons: btns };
        if (image) content.image = image;
        if (document) content.document = document;
        if (image || document) content.caption = baseText;
        out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'buttons', content, variables: vars });
      }
      return out;
    }
    const isMulti = (campaign as any).isMulti && (campaign as any).extraMedia;
    if (isMulti) {
      const extra = (campaign as any).extraMedia as any;
      for (const c of burst.contacts) {
        const vars = { name: c.name || c.phone, phone: c.phone };
        const baseText = this.applyVariables(campaign.messageText, { ...campaign.variableMap, ...vars } as any);
        if (baseText) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'text', content: { text: baseText }, variables: vars });
        // 3-4 images as collage: send sequentially 10-15s apart, no duplicated caption (text already sent once)
        for (const img of extra.images || []) {
          out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'image', content: { image: img }, variables: vars });
        }
        if (extra.video) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'video', content: { video: extra.video }, variables: vars });
        if (extra.document) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'document', content: { document: extra.document }, variables: vars });
      }
      return out;
    }
    const isMixed = msgType === 'mixed' && mediaData && ((mediaData as any).image || (mediaData as any).video || (mediaData as any).document || (mediaData as any).extraMedia);
    const isMultiImage = msgType === 'image' && mediaData && ((mediaData as any).images || (mediaData as any).extraMedia?.images);
    for (const c of burst.contacts) {
      const vars = { name: c.name || c.phone, phone: c.phone };
      const baseText = this.applyVariables(campaign.messageText, { ...campaign.variableMap, ...vars } as any);
      if (isMixed) {
        const extra = (mediaData as any).extraMedia || mediaData;
        const cap = this.applyVariables((extra.caption || campaign.messageText) as string, { ...campaign.variableMap, ...vars } as any);
        if (baseText) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'text', content: { text: baseText }, variables: vars });
        if (extra.image) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'image', content: { image: extra.image, caption: cap }, variables: vars });
        if (extra.video) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'video', content: { video: extra.video, caption: cap }, variables: vars });
        if (extra.document) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'document', content: { document: extra.document, caption: cap }, variables: vars });
        if (out.length === 0) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'text', content: { text: cap }, variables: vars });
      } else if (isMultiImage) {
        const imgs = (mediaData as any).images || (mediaData as any).extraMedia?.images || [];
        const cap = this.applyVariables((mediaData as any).caption || campaign.messageText, { ...campaign.variableMap, ...vars } as any);
        if (baseText && imgs.length===0) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'text', content: { text: baseText }, variables: vars });
        for (const img of imgs) {
          out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'image', content: { image: img, caption: cap }, variables: vars });
        }
        if (out.length===0) out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: 'text', content: { text: cap }, variables: vars });
      } else {
        const caption = mediaData?.caption ? this.applyVariables(mediaData.caption, vars as any) : baseText;
        const baseContent: any = {};
        if ((msgType === 'image' || msgType === 'video') && mediaData) {
          baseContent.caption = caption;
          if (msgType === 'image') baseContent.image = { url: mediaData.url, base64: mediaData.base64, mimetype: mediaData.mimetype, filename: mediaData.filename };
          else baseContent.video = { url: mediaData.url, base64: mediaData.base64, mimetype: mediaData.mimetype, filename: mediaData.filename };
        } else if (msgType === 'document' && mediaData) {
          baseContent.caption = caption;
          baseContent.document = { url: mediaData.url, base64: mediaData.base64, mimetype: mediaData.mimetype, filename: mediaData.filename };
        } else {
          baseContent.text = baseText;
        }
        out.push({ chatId: `${normalizePhone(c.phone)}@c.us`, type: msgType as any, content: baseContent, variables: vars });
      }
    }
    return out;
  }

  private async dispatchBurst(campaign: OutreachCampaign, runtime: SessionRuntime): Promise<void> {
    const burst = runtime.bursts[runtime.nextBurstIndex];
    if (!burst) return;
    runtime.inFlight = true;
    const cooldownMs = this.drawCooldown(campaign.strategy.cooldownMinMs, campaign.strategy.cooldownMaxMs);
    const avgDelay = avgDelayMs(campaign.strategy);
    const isMultiCamp = (campaign as any).isMulti && (campaign as any).extraMedia;
    const msgsPerContact = isMultiCamp ? 1 + (((campaign as any).extraMedia.images?.length ?? 0)) + (((campaign as any).extraMedia.video) ? 1 : 0) + (((campaign as any).extraMedia.document) ? 1 : 0) : 1;
    const burstMs = burst.contacts.length * msgsPerContact * avgDelay;

    const batchId = `oc-${campaign.id.slice(0, 8)}-${burst.sessionId.replace(/-/g, '').slice(0, 6)}-${runtime.nextBurstIndex}`;
    runtime.activeBatchId = batchId;

    try {
      const msgType = (campaign as any).messageType || 'text';
      const rawMedia = (campaign as any).mediaData;
      // Normalize mediaData: support both {url, mediaUrl, supabasePath, base64} shapes from flexible templates (Supabase + Message Tester style)
      const mediaData = rawMedia ? {
        url: rawMedia.url || rawMedia.mediaUrl || rawMedia.supabasePath || undefined,
        base64: rawMedia.base64 || rawMedia.mediaBase64 || undefined,
        mimetype: rawMedia.mimetype,
        filename: rawMedia.filename,
        caption: rawMedia.caption,
      } : null;
      await this.bulkMessage.createBatch(burst.sessionId, {
        batchId,
        messages: this.buildMessagesForBurst(burst, campaign, msgType, mediaData) as any,
        options: {
          minDelayMs: campaign.strategy.pacing.minDelayMs,
          maxDelayMs: campaign.strategy.pacing.maxDelayMs,
          enableTyping: true,
          randomizeDelay: true,
          saveContactFirst: campaign.strategy.saveContactFirst,
          preCheckNumbers: campaign.strategy.preCheckNumbers,
          contactName: campaign.strategy.contactName,
        },
      });
      const fresh = await this.campaignRepository.findOne({ where: { id: campaign.id } });
      if (fresh) {
        fresh.batchIds = [...(fresh.batchIds ?? []), batchId];
        // Mark burst as running
        const bp = fresh.burstProgress?.find(
          b => b.sessionId === burst.sessionId && b.burstIndex === runtime.nextBurstIndex,
        );
        if (bp) {
          bp.batchId = batchId;
          bp.status = 'running';
          bp.startTime = new Date().toISOString();
          // Only set cooldown if there is a next burst
          const isLast = runtime.nextBurstIndex >= runtime.bursts.length - 1;
          bp.cooldownMs = isLast ? null : cooldownMs;
          bp.pending = bp.burstSize;
          this.recomputeEstimates(fresh);
        }
        await this.campaignRepository.save(fresh);
      }
      runtime.nextBurstIndex += 1;
      runtime.nextAvailableAt = Date.now() + burstMs + cooldownMs;
    } catch (err) {
      runtime.inFlight = false;
      runtime.activeBatchId = undefined;
      const msg = (err as Error).message ?? '';
      const isTransient = /not active|not started|ECONNREFUSED|ECONNRESET|timeout/i.test(msg);
      const retryMs = isTransient ? 10_000 : cooldownMs;
      runtime.nextAvailableAt = Date.now() + retryMs;
      this.logger.warn(
        `campaign ${campaign.id} session ${runtime.sessionId} burst dispatch failed${isTransient ? ' (transient, retry in 10s)' : ''}: ${msg}`,
      );
      // Mark burst as failed pending retry
      const fresh = await this.campaignRepository.findOne({ where: { id: campaign.id } });
      if (fresh?.burstProgress) {
        const bp = fresh.burstProgress.find(
          b => b.sessionId === burst.sessionId && b.burstIndex === runtime.nextBurstIndex,
        );
        if (bp && bp.status === 'pending') {
          // keep pending for retry
        }
        await this.campaignRepository.save(fresh);
      }
    }
  }

  private async pollCampaign(campaign: OutreachCampaign, runtime: CampaignRuntime): Promise<void> {
    // Handle completed batches first
    for (const [sessionId, sr] of runtime.sessions) {
      if (sr.inFlight && sr.activeBatchId) {
        let status: BatchStatus;
        try {
          const batch = await this.bulkMessage.getBatchStatus(sessionId, sr.activeBatchId);
          status = batch.status;
          if (status === BatchStatus.COMPLETED || status === BatchStatus.CANCELLED || status === BatchStatus.FAILED) {
            const sent = batch.progress?.sent ?? 0;
            const failed = batch.progress?.failed ?? 0;
            // Classify blocked from results
            let blocked = 0;
            const results = (batch.results ?? []).map(r => {
              const blockedFlag = isBlockedError(r.error?.code, r.error?.message);
              if (blockedFlag && r.status === 'failed') blocked++;
              return {
                chatId: r.chatId,
                status: String(r.status),
                phone: r.chatId.replace(/@.*/, ''),
                errorCode: r.error?.code,
                errorMessage: r.error?.message,
                blocked: blockedFlag,
                sentAt: r.sentAt?.toISOString?.() ?? undefined,
              };
            });
            // Infer burst index from batchId
            const burstIdxMatch = /-(\d+)$/.exec(sr.activeBatchId);
            const burstIndex = burstIdxMatch ? Number(burstIdxMatch[1]) : sr.nextBurstIndex - 1;
            await this.updateBurstProgressOnComplete(
              campaign.id,
              sessionId,
              burstIndex,
              sent,
              failed,
              blocked,
              results,
              status,
              sr.bursts.length,
            );
            await this.updateSessionTally(campaign.id, sessionId, sent, failed, blocked);
            sr.inFlight = false;
            sr.activeBatchId = undefined;
          }
        } catch {
          // ignore
        }
      }
    }

    // Wave barrier: 4 sessions ×20 =80 per wave, don't make future bursts until wave done.
    // Keeps 230 waiting as pending without extra API calls; 4-8 min cooldown per wave.
    const now = Date.now();
    if (now < runtime.waveCooldownUntil) return;
    const allDoneForWave = Array.from(runtime.sessions.values()).every(
      sr => sr.nextBurstIndex > runtime.currentWave || sr.bursts.length <= runtime.currentWave || sr.inFlight,
    );
    // If every session that has a burst for this wave has completed it (nextBurstIndex > currentWave), advance wave
    const waveComplete = Array.from(runtime.sessions.values()).every(sr => {
      if (sr.inFlight) return false;
      if (sr.bursts.length <= runtime.currentWave) return true; // no burst for this wave
      return sr.nextBurstIndex > runtime.currentWave;
    });
    if (waveComplete && runtime.currentWave < Math.max(...Array.from(runtime.sessions.values()).map(s => s.bursts.length))) {
      // Set global cooldown 4-8 min before next wave
      const cd = this.drawCooldown(campaign.strategy.cooldownMinMs, campaign.strategy.cooldownMaxMs);
      runtime.waveCooldownUntil = now + cd;
      runtime.currentWave += 1;
      return; // wait cooldown, don't dispatch this tick
    }

    let inFlightCount = Array.from(runtime.sessions.values()).filter(sr => sr.inFlight).length;
    const MAX_CONCURRENT_SESSIONS = 4; // Adjust this value as needed based on optimization requirements

    for (const [sessionId, sr] of runtime.sessions) {
      if (
        !runtime.stopped &&
        !sr.inFlight &&
        sr.nextBurstIndex < sr.bursts.length &&
        sr.nextBurstIndex === runtime.currentWave &&
        now >= sr.nextAvailableAt &&
        now >= runtime.waveCooldownUntil
      ) {
        if (inFlightCount >= MAX_CONCURRENT_SESSIONS) {
          continue; // Wait until an in-flight session finishes
        }

        // Need fresh campaign for strategy/cooldown
        const fresh = await this.campaignRepository.findOne({ where: { id: campaign.id } });
        if (fresh) {
          await this.dispatchBurst(fresh, sr);
          inFlightCount++;
        }
      }
    }
  }

  private async updateBurstProgressOnComplete(
    campaignId: string,
    sessionId: string,
    burstIndex: number,
    sent: number,
    failed: number,
    blocked: number,
    results: Array<{
      chatId: string;
      status: string;
      phone: string;
      errorCode?: string;
      errorMessage?: string;
      sentAt?: string;
    }>,
    batchStatus: string,
    realTotalBursts?: number,
  ): Promise<void> {
    const campaign = await this.campaignRepository.findOne({ where: { id: campaignId } });
    if (!campaign || !campaign.burstProgress) return;

    if (campaign.simulatedMode) {
      // In simulated mode, we receive completion of a REAL (small) burst.
      // We update the DISPLAY (large) bursts based on completion ratio.
      const displayBursts = campaign.burstProgress.filter(b => b.sessionId === sessionId);
      if (displayBursts.length === 0) return;
      
      const realCompletedRatio = (burstIndex + 1) / (realTotalBursts || 1);
      // Ensure we hit 100% exactly when the last real burst finishes
      const isLastRealBurst = burstIndex + 1 === realTotalBursts;
      const expectedCompletedDisplay = isLastRealBurst ? displayBursts.length : Math.floor(realCompletedRatio * displayBursts.length);
      
      for (let i = 0; i < expectedCompletedDisplay; i++) {
        const db = displayBursts[i];
        if (db.status === 'pending' || db.status === 'running') {
          db.status = batchStatus === 'failed' && isLastRealBurst ? 'failed' : 'completed';
          db.endTime = new Date().toISOString();
          
          const simResults = this.generateSimulatedResults(db.contacts, campaign.simulatedSuccessRate);
          db.sent = simResults.filter(r => r.status === 'sent').length;
          db.failed = simResults.filter(r => r.status === 'failed').length;
          db.blocked = 0;
          db.pending = 0;
          db.results = simResults;
        }
      }
      
      const nextDisplay = displayBursts[expectedCompletedDisplay];
      if (nextDisplay && nextDisplay.status === 'pending') {
        nextDisplay.status = 'running';
        nextDisplay.startTime = new Date().toISOString();
      }
      
      this.recomputeEstimates(campaign);
      campaign.burstProgress = [...campaign.burstProgress];
      await this.campaignRepository.save(campaign);
      this.executionCache.delete(campaignId);
      return;
    }

    const bp = campaign.burstProgress.find(b => b.sessionId === sessionId && b.burstIndex === burstIndex);
    if (!bp) return;
    const failedExBlocked = Math.max(0, failed - blocked);
    bp.sent = sent;
    bp.failed = failedExBlocked;
    bp.blocked = blocked;
    bp.pending = Math.max(0, bp.burstSize - sent - failed);
    bp.status = batchStatus === 'failed' ? 'failed' : 'completed';
    bp.endTime = new Date().toISOString();
    // Map results to burst contacts with name resolution
    const contactsByPhone = new Map(bp.contacts.map(c => [c.phone, c.name]));
    bp.results = results.map(r => ({
      phone: r.phone,
      name: contactsByPhone.get(r.phone) || undefined,
      chatId: r.chatId,
      status: r.status,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      sentAt: r.sentAt,
    }));
    // If next burst exists, set it to cooldown
    const next = campaign.burstProgress.find(b => b.sessionId === sessionId && b.burstIndex === burstIndex + 1);
    if (next && next.status === 'pending') {
      next.status = 'pending'; // remain pending but estimate already computed
    }
    this.recomputeEstimates(campaign);
    campaign.burstProgress = [...campaign.burstProgress];
    await this.campaignRepository.save(campaign);
    this.executionCache.delete(campaignId);
  }

  private async updateSessionTally(
    campaignId: string,
    sessionId: string,
    sent: number,
    failed: number,
    blocked: number = 0,
  ): Promise<void> {
    const campaign = await this.campaignRepository.findOne({ where: { id: campaignId } });
    if (!campaign) return;
    const progress = campaign.sessionProgress ?? [];
    const row = progress.find(p => p.sessionId === sessionId);
    if (row) {
      row.sent = sent;
      row.failed = failed;
      (row as any).blocked = blocked;
      row.pending = Math.max(0, row.total - sent - failed);
    }
    // Aggregate per-session via burstProgress for more accurate blocked counts if available
    if (campaign.burstProgress) {
      for (const p of progress) {
        const bursts = campaign.burstProgress.filter(b => b.sessionId === p.sessionId);
        p.sent = bursts.reduce((a, b) => a + b.sent, 0);
        const failedSum = bursts.reduce((a, b) => a + b.failed, 0);
        const blockedSum = bursts.reduce((a, b) => a + b.blocked, 0);
        p.failed = failedSum;
        (p as any).blocked = blockedSum;
        p.pending = Math.max(0, p.total - p.sent - p.failed - blockedSum);
      }
    }
    const pendingTotal = progress.reduce((a, p) => a + (p.pending ?? 0), 0);
    const sentTotal = progress.reduce((a, p) => a + (p.sent ?? 0), 0);

    if (pendingTotal <= 0 && sentTotal > 0) {
      campaign.status = OutreachStatus.COMPLETED;
      campaign.completedAt = new Date();
      this.stopRuntime(campaignId);
      // Mark any remaining pending bursts as completed if no pending
      if (campaign.burstProgress) {
        for (const bp of campaign.burstProgress) {
          if (bp.status === 'pending' || bp.status === 'running') {
            bp.status = 'completed';
            if (!bp.endTime) bp.endTime = new Date().toISOString();
          }
        }
      }
    }
    this.recomputeEstimates(campaign);
    campaign.sessionProgress = [...progress];
    if (campaign.burstProgress) campaign.burstProgress = [...campaign.burstProgress];
    await this.campaignRepository.save(campaign);
    this.executionCache.delete(campaignId);
  }

  private startRuntime(campaign: OutreachCampaign): void {
    if (this.runtimes.has(campaign.id)) return;
    const runtime: CampaignRuntime = {
      campaignId: campaign.id,
      sessions: new Map(),
      timer: null,
      stopped: false,
      currentWave: 0,
      waveCooldownUntil: 0,
    };
    const distributionToUse = campaign.simulatedMode && campaign.realDistribution ? campaign.realDistribution : campaign.distribution;
    for (const sd of distributionToUse ?? []) {
      // Re-hydrate nextBurstIndex from burstProgress (resume)
      let nextIdx = 0;
      
      if (campaign.simulatedMode) {
        const sessionBatchIds = (campaign.batchIds ?? []).filter(id => id.includes(sd.sessionId.replace(/-/g, '').slice(0, 6)));
        nextIdx = sessionBatchIds.length;
        const runningDisplay = (campaign.burstProgress ?? []).find(b => b.sessionId === sd.sessionId && b.status === 'running');
        if (runningDisplay && sessionBatchIds.length > 0) {
          nextIdx = sessionBatchIds.length - 1; // The last dispatched is still in flight
          const activeBatchId = sessionBatchIds[sessionBatchIds.length - 1];
          runtime.sessions.set(sd.sessionId, {
            sessionId: sd.sessionId,
            bursts: sd.bursts.map(b => ({
              burstIndex: b.burstIndex,
              sessionId: sd.sessionId,
              sessionName: sd.sessionName,
              contacts: b.contacts,
            })),
            nextBurstIndex: nextIdx,
            inFlight: true,
            nextAvailableAt: Date.now() + 5000,
            activeBatchId: activeBatchId,
          });
          continue;
        }
      } else if (campaign.burstProgress) {
        const completed = campaign.burstProgress.filter(
          b => b.sessionId === sd.sessionId && (b.status === 'completed' || b.status === 'failed'),
        ).length;
        nextIdx = completed;
        // If a burst is running, mark runtime as inFlight
        const running = campaign.burstProgress.find(b => b.sessionId === sd.sessionId && b.status === 'running');
        if (running) {
          runtime.sessions.set(sd.sessionId, {
            sessionId: sd.sessionId,
            bursts: sd.bursts.map(b => ({
              burstIndex: b.burstIndex,
              sessionId: sd.sessionId,
              sessionName: sd.sessionName,
              contacts: b.contacts,
            })),
            nextBurstIndex: nextIdx,
            inFlight: true,
            nextAvailableAt: Date.now() + 5000,
            activeBatchId: running.batchId ?? undefined,
          });
          continue;
        }
      }
      runtime.sessions.set(sd.sessionId, {
        sessionId: sd.sessionId,
        bursts: sd.bursts.map(b => ({
          burstIndex: b.burstIndex,
          sessionId: sd.sessionId,
          sessionName: sd.sessionName,
          contacts: b.contacts,
        })),
        nextBurstIndex: nextIdx,
        inFlight: false,
        nextAvailableAt: 0,
      });
    }
    // Wave mode: all sessions must finish wave N (20 each) before wave N+1 starts.
    // Keeps 230 waiting as pending without extra API calls; 80 per wave for 4 sessions.
    const waveIndices = Array.from(runtime.sessions.values()).map(s => s.nextBurstIndex);
    runtime.currentWave = waveIndices.length ? Math.min(...waveIndices) : 0;
    runtime.waveCooldownUntil = 0;
    this.runtimes.set(campaign.id, runtime);

    const tick = async () => {
      const fresh = await this.campaignRepository.findOne({ where: { id: campaign.id } });
      if (!fresh || runtime.stopped) return;
      await this.pollCampaign(fresh, runtime);
    };
    runtime.timer = setInterval(() => void tick(), TICK_MS);
  }

  private stopRuntime(campaignId: string): void {
    const runtime = this.runtimes.get(campaignId);
    if (!runtime) return;
    runtime.stopped = true;
    if (runtime.timer) clearInterval(runtime.timer);
    this.runtimes.delete(campaignId);
    this.executionCache.delete(campaignId);
  }

  async create(dto: CreateOutreachCampaignDto): Promise<OutreachCampaignResponseDto> {
    const campaign = await this.createCampaign(dto);
    return this.toResponse(campaign);
  }

  async start(id: string): Promise<OutreachCampaignResponseDto> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    if (campaign.status === OutreachStatus.RUNNING) return this.toResponse(campaign);

    campaign.status = OutreachStatus.RUNNING;
    campaign.startedAt = new Date();
    campaign.completedAt = null;
    campaign.error = null;
    campaign.batchIds = [];
    if (campaign.distribution) {
      campaign.sessionProgress = campaign.distribution.map(d => ({
        sessionId: d.sessionId,
        sessionName: d.sessionName,
        total: d.assigned,
        sent: 0,
        failed: 0,
        blocked: 0,
        pending: d.assigned,
      }));
      // Rebuild burstProgress with fresh timings anchored at new start
      campaign.burstProgress = this.buildBurstProgress(campaign.distribution, campaign.strategy, campaign.startedAt);
    }
    await this.campaignRepository.save(campaign);

    this.startRuntime(campaign);
    return this.toResponse(campaign);
  }

  async stop(id: string): Promise<OutreachCampaignResponseDto> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    if (campaign.status === OutreachStatus.COMPLETED || campaign.status === OutreachStatus.CANCELLED) {
      return this.toResponse(campaign);
    }

    const runtime = this.runtimes.get(id);
    for (const sr of runtime?.sessions.values() ?? []) {
      if (sr.inFlight && sr.activeBatchId) {
        try {
          await this.bulkMessage.cancelBatch(sr.sessionId, sr.activeBatchId);
        } catch {
          // ignore
        }
      }
    }

    campaign.status = OutreachStatus.CANCELLED;
    campaign.completedAt = new Date();
    await this.campaignRepository.save(campaign);
    this.stopRuntime(id);
    return this.toResponse(campaign);
  }

  async status(id: string): Promise<OutreachCampaignResponseDto> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    const prevStatus = campaign.status;
    this.recomputeEstimatesSync(campaign);
    if (prevStatus !== campaign.status) await this.campaignRepository.save(campaign);
    return this.toResponse(campaign);
  }

  async list(filter?: { resellerId?: string; userId?: string; createdByEmail?: string; role?: string; isAdmin?: boolean }): Promise<OutreachCampaignResponseDto[]> {
    let where: any = {};
    if (filter && !filter.isAdmin) {
      if (filter.role === 'reseller' && filter.resellerId) {
        where = { resellerId: filter.resellerId };
      } else if (filter.role === 'user' && filter.userId) {
        where = { userId: filter.userId };
      } else if (filter.createdByEmail) {
        where = { createdByEmail: filter.createdByEmail };
      } else if (filter.resellerId || filter.userId) {
        // Fallback: show campaigns where either matches (for demo)
        const campaigns = await this.campaignRepository.find({ order: { createdAt: 'DESC' } });
        const filtered = campaigns.filter(c => (c as any).resellerId === filter.resellerId || (c as any).userId === filter.userId || (c as any).createdByEmail === filter.createdByEmail);
        for (const c of filtered) {
          const prev = c.status;
          this.recomputeEstimatesSync(c);
          if (prev !== c.status) await this.campaignRepository.save(c);
        }
        return filtered.map(c => this.toResponse(c));
      }
    }
    const campaigns = await this.campaignRepository.find({ where: Object.keys(where).length ? where : undefined, order: { createdAt: 'DESC' } } as any);
    for (const c of campaigns) {
      const prev = c.status;
      this.recomputeEstimatesSync(c);
      if (prev !== c.status) await this.campaignRepository.save(c);
    }
    return campaigns.map(c => this.toResponse(c));
  }

  async history(): Promise<Array<{ id: string; name: string; messageText: string; messageType: string; status: string; contactCount: number; createdByEmail: string | null; createdByRole: string | null; createdAt: Date; startedAt: Date | null; completedAt: Date | null; totalCredits: number }>> {
    const campaigns = await this.campaignRepository.find({ order: { createdAt: 'DESC' } });
    return campaigns.map(c => ({
      id: c.id,
      name: c.name,
      messageText: (c.messageText || '').slice(0, 120),
      messageType: (c as any).messageType || 'text',
      status: c.status,
      contactCount: c.contacts?.length ?? 0,
      createdByEmail: (c as any).createdByEmail || null,
      createdByRole: (c as any).createdByRole || null,
      createdAt: c.createdAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      totalCredits: (c as any).totalCredits ?? 0,
    }));
  }

  private classifyInterest(body?: string): 'interested' | 'not_interested' | 'other' {
    const t = (body || '').toLowerCase();
    const hasInterest = t.includes('interest') || t.includes('intrest') || t.includes('interst') || t.includes('intrst') || t.includes('intres');
    const hasNot = /\b(not|no|dont|don't|do not|nahi|na)\b/i.test(t);
    if (hasNot && hasInterest) return 'not_interested';
    if (hasInterest) return 'interested';
    return 'other';
  }

  async getCampaignReplies(id: string): Promise<{
    campaignId: string;
    campaignName: string;
    startedAt: Date | null;
    summary: { totalContacts: number; replied: number; interested: number; notInterested: number; other: number; pending: number };
    bySession: Array<{ sessionId: string; sessionName: string; replied: number; interested: number; notInterested: number; other: number }>;
    replies: Array<{ phone: string; name?: string; sessionId: string; sessionName: string; chatId: string; body: string; interest: 'interested' | 'not_interested' | 'other'; timestamp: number; createdAt: string }>;
  }> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    const since = campaign.startedAt ?? campaign.createdAt;
    const sinceTs = Math.floor(since.getTime() / 1000);
    const sessionIds = (campaign.sessions ?? []).map(s => s.sessionId);
    const sessionNameMap = new Map((campaign.sessions ?? []).map(s => [s.sessionId, s.sessionName]));
    const contactMap = new Map((campaign.contacts ?? []).map(c => [normalizePhone(c.phone), c.name]));
    const contactPhones = Array.from(contactMap.keys());
    if (sessionIds.length === 0) {
      return { campaignId: id, campaignName: campaign.name, startedAt: campaign.startedAt, summary: { totalContacts: contactPhones.length, replied: 0, interested: 0, notInterested: 0, other: 0, pending: contactPhones.length }, bySession: [], replies: [] };
    }
    // fetch recent incoming messages for those sessions after campaign start
    const msgs = await this.messageRepository.find({
      where: { sessionId: In(sessionIds), direction: MessageDirection.INCOMING } as any,
      order: { createdAt: 'DESC' },
      take: 5000,
    });
    const resolveChatPhoneDigits = (chatId: string): string => {
      const raw = (chatId || '').split('@')[0].replace(/\D/g, '');
      if (chatId.endsWith('@lid') && this.lidMappingStore) {
        const resolved = this.lidMappingStore.resolveLid(chatId) || this.lidMappingStore.getCached(chatId.split('@')[0]) || null;
        if (resolved) return resolved.replace(/\D/g, '');
        // also try userPart without @lid suffix
        const lid = chatId.split('@')[0];
        const cached = this.lidMappingStore.getCached(lid);
        if (cached) return cached.replace(/\D/g, '');
      }
      return raw;
    };
    const filtered = msgs.filter(m => {
      const ts = m.timestamp ?? Math.floor(new Date(m.createdAt).getTime() / 1000);
      if (ts < sinceTs) return false;
      if (m.createdAt && m.createdAt < since) return false;
      const chatDigits = resolveChatPhoneDigits(m.chatId);
      // match if chat digits end with any contact phone (handles country prefix + lid resolution)
      return contactPhones.some(cp => chatDigits.endsWith(cp) || cp.endsWith(chatDigits));
    });
    // keep only latest reply per phone (first in DESC order is latest)
    const latestByPhone = new Map<string, (typeof filtered)[number]>();
    for (const m of filtered) {
      const chatDigits = resolveChatPhoneDigits(m.chatId);
      const matched = contactPhones.find(cp => chatDigits.endsWith(cp) || cp.endsWith(chatDigits)) ?? chatDigits;
      if (!latestByPhone.has(matched)) latestByPhone.set(matched, m);
    }
    const replies = Array.from(latestByPhone.entries()).map(([phone, m]) => {
      const interest = this.classifyInterest(m.body);
      return {
        phone,
        name: contactMap.get(phone) ?? undefined,
        sessionId: m.sessionId,
        sessionName: sessionNameMap.get(m.sessionId) ?? m.sessionId,
        chatId: m.chatId,
        body: m.body || '',
        interest,
        timestamp: m.timestamp ?? Math.floor(new Date(m.createdAt).getTime() / 1000),
        createdAt: m.createdAt.toISOString(),
      };
    });
    const replied = replies.length;
    const interested = replies.filter(r => r.interest === 'interested').length;
    const notInterested = replies.filter(r => r.interest === 'not_interested').length;
    const other = replies.filter(r => r.interest === 'other').length;
    const pending = Math.max(0, contactPhones.length - replied);
    const bySessionMap = new Map<string, { sessionId: string; sessionName: string; replied: number; interested: number; notInterested: number; other: number }>();
    for (const r of replies) {
      const key = r.sessionId;
      const entry = bySessionMap.get(key) ?? { sessionId: r.sessionId, sessionName: r.sessionName, replied: 0, interested: 0, notInterested: 0, other: 0 };
      entry.replied++;
      if (r.interest === 'interested') entry.interested++;
      else if (r.interest === 'not_interested') entry.notInterested++;
      else entry.other++;
      bySessionMap.set(key, entry);
    }
    return {
      campaignId: id,
      campaignName: campaign.name,
      startedAt: campaign.startedAt,
      summary: { totalContacts: contactPhones.length, replied, interested, notInterested, other, pending },
      bySession: Array.from(bySessionMap.values()),
      replies: replies.sort((a, b) => b.timestamp - a.timestamp),
    };
  }

  async executionReport(id: string) {
    const cached = this.executionCache.get(id);
    if (cached && Date.now() - cached.at < EXECUTION_CACHE_TTL_MS) return cached.data;
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);

    const prevStatus = campaign.status;
    this.recomputeEstimatesSync(campaign);
    if (prevStatus !== campaign.status) await this.campaignRepository.save(campaign);

    const batchIds = campaign.batchIds ?? [];
    const sessionMap = new Map(campaign.sessions.map(s => [s.sessionId, s.sessionName]));
    const results: Array<{
      sessionId: string;
      sessionName: string;
      batchId: string;
      status: string;
      progress: { total: number; sent: number; failed: number; pending: number; cancelled: number };
      recipients: Array<{
        chatId: string;
        phone: string;
        status: string;
        messageId?: string;
        error?: string;
        errorCode?: string;
        sentAt?: string;
        blocked?: boolean;
      }>;
    }> = [];

    for (const batchId of batchIds) {
      const sessionId = [...sessionMap.keys()].find(sid => batchId.includes(sid.replace(/-/g, '').slice(0, 6)));
      if (!sessionId) continue;
      try {
        const batch = await this.bulkMessage.getBatchStatus(sessionId, batchId);
        results.push({
          sessionId,
          sessionName: sessionMap.get(sessionId) ?? sessionId,
          batchId,
          status: batch.status,
          progress: batch.progress,
          recipients: [], // Omitted to reduce payload size during polling
        });
      } catch {
        results.push({
          sessionId,
          sessionName: sessionMap.get(sessionId) ?? sessionId,
          batchId,
          status: 'unknown',
          progress: { total: 0, sent: 0, failed: 0, pending: 0, cancelled: 0 },
          recipients: [],
        });
      }
    }

    const runtime = this.runtimes.get(id);
    const liveSessions: Array<{
      sessionName: string;
      sessionId: string;
      totalBursts: number;
      nextBurstIndex: number;
      inFlight: boolean;
      activeBatchId: string | null;
      nextAvailableAt: number;
      now: number;
      dispatchedBurstCount: number;
    }> = [];
    if (runtime) {
      for (const [sid, sr] of runtime.sessions) {
        if (campaign.simulatedMode) {
          const displayBursts = (campaign.burstProgress ?? []).filter(b => b.sessionId === sid);
          const runningOrCompleted = displayBursts.filter(b => b.status === 'running' || b.status === 'completed' || b.status === 'failed').length;
          liveSessions.push({
            sessionName: sessionMap.get(sid) ?? sid,
            sessionId: sid,
            totalBursts: displayBursts.length,
            nextBurstIndex: runningOrCompleted,
            inFlight: displayBursts.some(b => b.status === 'running'),
            activeBatchId: sr.activeBatchId ?? null,
            nextAvailableAt: sr.nextAvailableAt,
            now: Date.now(),
            dispatchedBurstCount: runningOrCompleted,
          });
        } else {
          liveSessions.push({
            sessionName: sessionMap.get(sid) ?? sid,
            sessionId: sid,
            totalBursts: sr.bursts.length,
            nextBurstIndex: sr.nextBurstIndex,
            inFlight: sr.inFlight,
            activeBatchId: sr.activeBatchId ?? null,
            nextAvailableAt: sr.nextAvailableAt,
            now: Date.now(),
            dispatchedBurstCount: sr.nextBurstIndex,
          });
        }
      }
    }

    // Build per-session burst report from burstProgress
    const burstReport = (campaign.burstProgress ?? []).map(bp => ({
      sessionId: bp.sessionId,
      sessionName: bp.sessionName,
      burstIndex: bp.burstIndex,
      burstSize: bp.burstSize,
      batchId: bp.batchId,
      status: bp.status,
      sent: bp.sent,
      failed: bp.failed,
      blocked: bp.blocked,
      pending: bp.pending,
      contacts: undefined, // Omitted to reduce payload size during polling
      results: undefined, // Omitted to reduce payload size during polling
      startTime: bp.startTime,
      endTime: bp.endTime,
      estimatedStart: bp.estimatedStart,
      estimatedEnd: bp.estimatedEnd,
      cooldownMs: bp.cooldownMs,
      warmupMs: bp.warmupMs,
      progressPct: bp.burstSize > 0 ? Math.round(((bp.sent + bp.failed + bp.blocked) / bp.burstSize) * 100) : 0,
    }));

    const globalTiming = this.computeGlobalTiming(campaign);

    // Per-session summary scores (reply-rate if available via burstProgress? we use sent rate)
    const sessionScores = (campaign.sessionProgress ?? [])
      .map(p => {
        const bursts = (campaign.burstProgress ?? []).filter(b => b.sessionId === p.sessionId);
        const totalSent = bursts.reduce((a, b) => a + b.sent, 0) || p.sent;
        const totalBlocked = bursts.reduce((a, b) => a + b.blocked, 0) || (p as any).blocked || 0;
        const score = p.total > 0 ? Math.round((totalSent / p.total) * 100) : 0;
        return {
          sessionId: p.sessionId,
          sessionName: p.sessionName,
          total: p.total,
          sent: totalSent,
          failed: p.failed,
          blocked: totalBlocked,
          pending: p.pending,
          score,
          bursts: bursts.length,
        };
      })
      .sort((a, b) => b.score - a.score);

    const result = {
      campaignId: id,
      campaignName: campaign.name,
      status: campaign.status,
      sessionProgress: campaign.sessionProgress,
      burstProgress: campaign.burstProgress,
      burstReport,
      globalTiming,
      sessionScores,
      batches: results,
      live: runtime ? { sessions: liveSessions } : null,
    };
    this.executionCache.set(id, { data: result, at: Date.now() });
    return result;
  }

  async update(id: string, dto: Partial<CreateOutreachCampaignDto> & { caption?: string }): Promise<OutreachCampaignResponseDto> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    if (campaign.status === OutreachStatus.RUNNING) {
      throw new BadRequestException(`Campaign '${id}' is running. Stop it before updating.`);
    }
    // Update simple fields
    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.messageText !== undefined) campaign.messageText = dto.messageText;
    if ((dto as any).templateId !== undefined) (campaign as any).templateId = (dto as any).templateId;
    if ((dto as any).messageType !== undefined) (campaign as any).messageType = (dto as any).messageType;
    if ((dto as any).mediaData !== undefined) (campaign as any).mediaData = (dto as any).mediaData;
    if ((dto as any).extraMedia !== undefined) (campaign as any).extraMedia = (dto as any).extraMedia;
    if ((dto as any).isMulti !== undefined) (campaign as any).isMulti = (dto as any).isMulti;
    if ((dto as any).buttons !== undefined) (campaign as any).buttons = (dto as any).buttons;
    if ((dto as any).caption !== undefined && (campaign as any).mediaData) (campaign as any).mediaData.caption = (dto as any).caption;
    if (dto.variableMap !== undefined) campaign.variableMap = dto.variableMap as any;

    // If contacts or sessions changed, re-allocate distribution
    const contactsChanged = dto.contacts !== undefined;
    const sessionsChanged = dto.sessions !== undefined;
    if (contactsChanged || sessionsChanged) {
      const contacts = (dto.contacts ?? campaign.contacts) as any[];
      const sessionNames = (dto.sessions ?? campaign.sessions.map((s: any) => ({ sessionName: s.sessionName }))) as any[];
      const warmupSchedule = (dto.strategy as any)?.warmupSchedule ?? campaign.strategy.warmupSchedule;
      const { sessions, missing } = await this.resolveSessionPool(sessionNames.map((s: any) => s.sessionName), warmupSchedule, (dto.strategy as any)?.maxPerSessionPerDay ?? campaign.strategy.maxPerSessionPerDay, contacts.length);
      if (missing.length) throw new BadRequestException(`Unknown session(s): ${missing.join(', ')}`);
      const burstSize = (dto.strategy as any)?.burstSize ?? campaign.strategy.burstSize;
      const allocation = allocateOutreach(contacts.map((c: any) => ({ phone: c.phone, name: c.name })), sessions.map(s => ({ id: s.id, name: s.name, capacity: s.capacity })), burstSize);
      const distribution = allocation.sessions.map(s => ({ sessionId: s.id, sessionName: s.name, assigned: s.assigned, contacts: s.bursts.flatMap(b => b.contacts), bursts: s.bursts.map(b => ({ burstIndex: b.burstIndex, contacts: b.contacts })) }));
      campaign.contacts = contacts as any;
      campaign.sessions = sessions.map(s => ({ sessionName: s.name, sessionId: s.id })) as any;
      campaign.distribution = distribution as any;
      campaign.sessionProgress = distribution.map(d => ({ sessionId: d.sessionId, sessionName: d.sessionName, total: d.assigned, sent: 0, failed: 0, blocked: 0, pending: d.assigned })) as any;
      campaign.burstProgress = this.buildBurstProgress(distribution as any, campaign.strategy, null) as any;
      if (dto.strategy) {
        campaign.strategy = { ...campaign.strategy, ...dto.strategy, pacing: { ...campaign.strategy.pacing, ...(dto.strategy as any).pacing } } as any;
      }
    } else if (dto.strategy) {
      campaign.strategy = { ...campaign.strategy, ...dto.strategy, pacing: { ...campaign.strategy.pacing, ...(dto.strategy as any).pacing } } as any;
    }

    // Recalculate credits if messageType/extraMedia changed
    if ((dto as any).messageType || (dto as any).extraMedia || (dto as any).isMulti || dto.contacts) {
      const extra = (campaign as any).extraMedia;
      const isMultiCamp = (campaign as any).isMulti && extra;
      let cost: number;
      if (isMultiCamp) {
        const imgCount = extra.images?.length ?? 0;
        const hasVideo = extra.video ? 1 : 0;
        const hasDoc = extra.document ? 1 : 0;
        cost = 1 + imgCount * 2 + hasVideo * 2 + hasDoc * 2;
      } else {
        cost = (campaign as any).messageType === 'image' || (campaign as any).messageType === 'document' || (campaign as any).messageType === 'video' || (campaign as any).messageType === 'mixed' ? 2 : 1;
        if ((campaign as any).messageType === 'image' && extra?.images?.length) cost = 2 * extra.images.length;
      }
      (campaign as any).creditCost = cost;
      (campaign as any).totalCredits = campaign.contacts.length * cost;
    }

    const saved = await this.campaignRepository.save(campaign);
    this.logger.log(`campaign '${saved.name}' (${saved.id}) updated`);
    return this.toResponse(saved);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    if (campaign.status === OutreachStatus.RUNNING) {
      throw new BadRequestException(`Campaign '${id}' is running. Stop it before deleting.`);
    }
    this.stopRuntime(id);
    await this.campaignRepository.delete({ id });
    return { deleted: true };
  }

  private toResponse(campaign: OutreachCampaign): OutreachCampaignResponseDto {
    this.recomputeEstimates(campaign);
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      messageText: campaign.messageText,
      templateId: (campaign as any).templateId ?? null,
      messageType: (campaign as any).messageType ?? 'text',
      mediaData: (campaign as any).mediaData ?? null,
      extraMedia: (campaign as any).extraMedia ?? null,
      isMulti: (campaign as any).isMulti ?? false,
      buttons: (campaign as any).buttons ?? null,
      creditCost: (campaign as any).creditCost ?? 1,
      totalCredits: (campaign as any).totalCredits ?? 0,
      resellerId: (campaign as any).resellerId ?? null,
      userId: (campaign as any).userId ?? null,
      createdByEmail: (campaign as any).createdByEmail ?? null,
      createdByRole: (campaign as any).createdByRole ?? null,
      contactCount: campaign.contacts.length,
      sessionCount: campaign.sessions.length,
      sessionProgress: campaign.sessionProgress,
      burstProgress: campaign.burstProgress,
      globalTiming: this.computeGlobalTiming(campaign),
      batchIds: campaign.batchIds,
      distribution: campaign.distribution,
      strategy: campaign.strategy,
      sessions: campaign.sessions,
      error: campaign.error,
      startedAt: campaign.startedAt,
      completedAt: campaign.completedAt,
    };
  }

  onModuleDestroy(): void {
    for (const id of [...this.runtimes.keys()]) this.stopRuntime(id);
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
