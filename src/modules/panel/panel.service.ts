import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PanelHours {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23, exclusive
  timezone?: string;
}

export interface PanelRequest {
  id: string;
  email: string;
  role: string;
  requestedHours: string; // e.g. "19:00-22:00" or "10pm" etc, store as provided
  requestedAt: string; // ISO
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  grantedUntil?: string | null; // ISO when approved until
  createdAt: string;
}

export interface PanelOverride {
  email: string;
  grantedUntil: string; // ISO
  grantedBy?: string;
}

const DEFAULT: PanelHours = { enabled: false, startHour: 10, endHour: 18, timezone: 'Asia/Kolkata' };

function dataPath(): string {
  // data/ lives next to dist in prod, and at project root in dev
  const candidates = [
    path.resolve(process.cwd(), 'data', 'panel-hours.json'),
    path.resolve(__dirname, '..', '..', '..', 'data', 'panel-hours.json'),
    path.resolve(__dirname, '..', 'data', 'panel-hours.json'),
  ];
  for (const p of candidates) {
    try {
      const dir = path.dirname(p);
      if (fs.existsSync(dir) || fs.existsSync(path.dirname(dir))) return p;
    } catch {}
  }
  return candidates[0];
}
function requestsPath(): string {
  return path.join(path.dirname(dataPath()), 'panel-requests.json');
}
function overridesPath(): string {
  return path.join(path.dirname(dataPath()), 'panel-overrides.json');
}

@Injectable()
export class PanelService {
  private file = dataPath();

  get(): PanelHours {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return {
          enabled: !!raw.enabled,
          startHour: Number.isFinite(raw.startHour) ? Math.max(0, Math.min(23, Math.trunc(raw.startHour))) : DEFAULT.startHour,
          endHour: Number.isFinite(raw.endHour) ? Math.max(1, Math.min(24, Math.trunc(raw.endHour))) : DEFAULT.endHour,
          timezone: raw.timezone || DEFAULT.timezone,
        };
      }
    } catch {}
    return { ...DEFAULT };
  }

  save(p: PanelHours): PanelHours {
    const next: PanelHours = {
      enabled: !!p.enabled,
      startHour: Math.max(0, Math.min(23, Math.trunc(p.startHour))),
      endHour: Math.max(1, Math.min(24, Math.trunc(p.endHour))),
      timezone: p.timezone || DEFAULT.timezone,
    };
    if (next.startHour >= next.endHour) {
      // allow wrap like 22-6? For now enforce start<end, else disable
      next.enabled = false;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    } catch {}
    return next;
  }

  isBlocked(role?: string, email?: string): { blocked: boolean; hours?: PanelHours } {
    const h = this.get();
    if (!h.enabled) return { blocked: false, hours: h };
    if (!role || !['reseller', 'user', 'demo'].includes(role)) return { blocked: false, hours: h };
    // check per-user override granted by admin
    if (email) {
      const overrides = this.getOverrides();
      const ov = overrides.find(o => o.email.toLowerCase() === email.toLowerCase());
      if (ov && ov.grantedUntil) {
        const until = new Date(ov.grantedUntil);
        if (until.getTime() > Date.now()) return { blocked: false, hours: h };
      }
    }
    // Use server local time; for IST we assume server in IST or use timezone offset? Keep local.
    const now = new Date();
    // If timezone is Asia/Kolkata, use IST offset (UTC+5:30) when server is UTC
    let hour = now.getHours();
    if (h.timezone === 'Asia/Kolkata') {
      // Convert to IST if server not IST: get UTC hour +5.5
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const ist = new Date(utc + 5.5 * 3600000);
      hour = ist.getHours();
    }
    const blocked = hour < h.startHour || hour >= h.endHour;
    return { blocked, hours: h };
  }

  // —— Requests & overrides ——
  private readRequests(): PanelRequest[] {
    try {
      const p = requestsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return [];
  }
  private writeRequests(list: PanelRequest[]) {
    try {
      const p = requestsPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(list, null, 2));
    } catch {}
  }
  private getOverrides(): PanelOverride[] {
    try {
      const p = overridesPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return [];
  }
  private writeOverrides(list: PanelOverride[]) {
    try {
      const p = overridesPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(list, null, 2));
    } catch {}
  }

  listRequests(): PanelRequest[] {
    return this.readRequests().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  listRequestsFor(email: string): PanelRequest[] {
    return this.readRequests().filter(r => r.email.toLowerCase() === email.toLowerCase()).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  }
  createRequest(dto: { email: string; role: string; requestedHours: string; reason?: string }): PanelRequest {
    const list = this.readRequests();
    const now = new Date().toISOString();
    const req: PanelRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      email: dto.email.toLowerCase().trim(),
      role: dto.role,
      requestedHours: dto.requestedHours,
      reason: dto.reason,
      requestedAt: now,
      status: 'pending',
      createdAt: now,
      grantedUntil: null,
    };
    list.push(req);
    this.writeRequests(list);
    return req;
  }
  updateRequest(id: string, status: 'approved' | 'rejected', grantedHours?: number, grantedBy?: string): PanelRequest | null {
    const list = this.readRequests();
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const req = list[idx];
    req.status = status;
    if (status === 'approved') {
      // grant for requested duration or default 4 hours
      const hours = Number.isFinite(grantedHours) ? Math.max(1, Math.min(24, Math.trunc(grantedHours!))) : 4;
      const until = new Date(Date.now() + hours * 3600000).toISOString();
      req.grantedUntil = until;
      // also write override
      const overrides = this.getOverrides().filter(o => o.email.toLowerCase() !== req.email.toLowerCase());
      overrides.push({ email: req.email, grantedUntil: until, grantedBy });
      this.writeOverrides(overrides);
    } else {
      req.grantedUntil = null;
    }
    list[idx] = req;
    this.writeRequests(list);
    return req;
  }
}
