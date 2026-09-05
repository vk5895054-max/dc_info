import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Timer,
  Workflow,
  AlertTriangle,
  Ban,
  Send,
  Users,
  Trophy,
  Edit2,
  Trash2,
} from 'lucide-react';
import {
  type OutreachCampaign,
  type OutreachCampaignExecution,
  type OutreachLiveSession,
  type OutreachSessionAllocation,
  type OutreachBurstProgress,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCreateOutreachMutation,
  useOutreachActionMutation,
  useOutreachDeleteMutation,
  useOutreachUpdateMutation,
  useOutreachExecutionQuery,
  useOutreachQuery,
  useRegistryContactsQuery,
  useRegistryRepliesQuery,
  useSessionsQuery,
  useCreditTemplatesQuery,
} from '../hooks/queries';
import { templateApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import './Campaigns.css';

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'campaigns.statusScheduled',
  running: 'campaigns.statusRunning',
  completed: 'campaigns.statusCompleted',
  cancelled: 'campaigns.statusCancelled',
  failed: 'campaigns.statusFailed',
};

const DEFAULTS = {
  burstSize: 30,
  cooldownMinMs: 240000,
  cooldownMaxMs: 480000,
};

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function formatElapsed(start: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

function formatTimeOnly(iso?: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

// ── Global Timeline Header ───────────────────────────────────────────────
function GlobalTimeline({ campaign, execution }: { campaign: OutreachCampaign; execution?: OutreachCampaignExecution | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (campaign.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [campaign.status]);
  const timing = execution?.globalTiming ?? campaign.globalTiming;
  const startedAt = timing?.startedAt ?? campaign.startedAt;
  const estimatedFinish = timing?.estimatedFinish ?? null;
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const finishMs = estimatedFinish ? new Date(estimatedFinish).getTime() : null;
  const total = timing?.totalBursts ?? 0;
  const completed = timing?.completedBursts ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remainingMs = finishMs && startedMs ? Math.max(0, finishMs - now) : 0;

  return (
    <div className="campaigns-global-timeline">
      <div className="campaigns-global-timeline__row">
        <div className="campaigns-global-timeline__item">
          <span className="campaigns-global-timeline__label">{t('campaigns.startedAt') ?? 'Campaign started at'}</span>
          <span className="campaigns-global-timeline__value">{formatDateTime(startedAt)}</span>
        </div>
        <div className="campaigns-global-timeline__arrow">→</div>
        <div className="campaigns-global-timeline__item campaigns-global-timeline__item--now">
          <span className="campaigns-global-timeline__label">Now</span>
          <span className="campaigns-global-timeline__value">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {startedMs ? `· ${formatElapsed(startedMs, now)} elapsed` : ''}</span>
        </div>
        <div className="campaigns-global-timeline__arrow">→</div>
        <div className="campaigns-global-timeline__item">
          <span className="campaigns-global-timeline__label">{t('campaigns.estimatedFinish') ?? 'Estimated finish'}</span>
          <span className="campaigns-global-timeline__value campaigns-global-timeline__value--eta">{formatDateTime(estimatedFinish)} {campaign.status === 'running' && finishMs ? `· ${formatCountdown(remainingMs)} left` : ''}</span>
        </div>
      </div>
      <div className="campaigns-global-timeline__bar">
        <div className="campaigns-global-timeline__fill" style={{ width: `${pct}%` }} />
        <span className="campaigns-global-timeline__pct">{pct}% · {completed}/{total} bursts</span>
      </div>
      {timing && (
        <div className="campaigns-global-timeline__meta">
          {timing.remainingBursts} bursts remaining · avg {(campaign.strategy?.pacing.minDelayMs ?? 0 + (campaign.strategy?.pacing.maxDelayMs ?? 0))/2 ? `${Math.round(((campaign.strategy!.pacing.minDelayMs + campaign.strategy!.pacing.maxDelayMs)/2)/1000)}s/msg` : ''} · cooldown {formatMs(campaign.strategy?.cooldownMinMs ?? 0)}–{formatMs(campaign.strategy?.cooldownMaxMs ?? 0)}
        </div>
      )}
    </div>
  );
}

// ── Burst Card (visual separation + color coding + progress) ────────────
function BurstCard({ burst, now, totalBursts }: { burst: OutreachBurstProgress; now: number; totalBursts?: number }) {
  const isRunning = burst.status === 'running';
  const isPending = burst.status === 'pending';
  const isCompleted = burst.status === 'completed';
  const isFailed = burst.status === 'failed';
  const total = burst.burstSize;
  const sent = burst.sent;
  const failed = burst.failed;
  const blocked = burst.blocked;
  const pending = burst.pending;
  const pct = total > 0 ? Math.round(((sent) / total) * 100) : 0;

  // Timing
  const estimatedStart = burst.estimatedStart;
  const estimatedEnd = burst.estimatedEnd;
  const actualStart = burst.startTime;
  const actualEnd = burst.endTime;
  const countdown = isRunning && estimatedEnd ? Math.max(0, new Date(estimatedEnd).getTime() - now) : 0;

  const statusColor = isCompleted ? 'burst--done' : isRunning ? 'burst--running' : isFailed ? 'burst--failed' : 'burst--pending';

  return (
    <div className={`campaigns-burst-card ${statusColor}`}>
      <div className="campaigns-burst-card__head">
        <span className="campaigns-burst-card__num">Burst {burst.burstIndex + 1}</span>
        <span className={`campaigns-burst-card__status campaigns-burst-card__status--${burst.status}`}>{burst.status}</span>
        <span className="campaigns-burst-card__size"><Users size={12} /> {total} msgs</span>
      </div>

      {/* Status counts with color coding */}
      <div className="campaigns-burst-card__counts">
        <span className="count count--sent"><Send size={11} /> {sent} <small>sent</small></span>
        <span className="count count--failed"><AlertTriangle size={11} /> {failed} <small>failed</small></span>
        <span className="count count--blocked"><Ban size={11} /> {blocked} <small>blocked</small></span>
        <span className="count count--pending"><Clock size={11} /> {pending} <small>pending</small></span>
      </div>

      {/* Progress bar sent-vs-total per burst */}
      <div className="campaigns-burst-card__progress">
        <div className="campaigns-burst-card__track">
          <div className="campaigns-burst-card__fill" style={{ width: `${pct}%` }} />
          <div className="campaigns-burst-card__blocked" style={{ width: `${total ? Math.round((blocked/total)*100) : 0}%`, marginLeft: `${pct}%` }} />
        </div>
        <span className="campaigns-burst-card__pct">{pct}%</span>
      </div>

      {/* Timing: estimated vs actual */}
      <div className="campaigns-burst-card__timing">
        {isCompleted || isFailed ? (
          <>
            <span className="timing timing--actual"><Clock size={11} /> {formatTimeOnly(actualStart)} → {formatTimeOnly(actualEnd)}</span>
            <span className="timing timing--actual-detail">{actualStart ? new Date(actualStart).toLocaleString() : ''}</span>
          </>
        ) : isRunning ? (
          <>
            <span className="timing timing--live"><Timer size={11} /> {formatCountdown(countdown)} left · ends ~{formatTimeOnly(estimatedEnd)}</span>
            <div className="campaigns-burst-card__livebar"><div className="campaigns-burst-card__livefill" style={{ width: `${Math.min(100, Math.max(5, pct))}%` }} /></div>
          </>
        ) : (
          <>
            <span className="timing timing--est"><Clock size={11} /> est. {formatTimeOnly(estimatedStart)} → {formatTimeOnly(estimatedEnd)}</span>
            {burst.cooldownMs ? <span className="timing timing--cooldown">Warm-up/Rest {formatMs(burst.cooldownMs)} before next</span> : null}
          </>
        )}
      </div>

      {/* Cooldown label between bursts - only if not last burst */}
      {burst.cooldownMs && !isPending && totalBursts !== undefined && burst.burstIndex < totalBursts - 1 && <div className="campaigns-burst-card__cooldown">Resting {formatMs(burst.cooldownMs)} before Burst {burst.burstIndex + 2}</div>}
      {burst.cooldownMs && !isPending && totalBursts === undefined && <div className="campaigns-burst-card__cooldown">Resting {formatMs(burst.cooldownMs)} before Burst {burst.burstIndex + 2}</div>}

      {/* Per-recipient expandable (phone → status) */}
      {burst.results && burst.results.length > 0 && (
        <details className="campaigns-burst-card__recipients">
          <summary>{burst.results.length} recipients · show numbers</summary>
          <div className="campaigns-burst-card__recipient-list">
            {burst.results.map((r, idx) => (
              <div key={idx} className={`recipient recipient--${r.status}`}>
                <span className="recipient-phone">{r.phone} {r.name ? `(${r.name})` : ''}</span>
                <span className={`recipient-status recipient-status--${r.status}`}>{r.status}</span>
                {r.errorMessage && <span className="recipient-error" title={r.errorMessage}>{r.errorCode}: {r.errorMessage.slice(0, 80)}</span>}
                {r.sentAt && <span className="recipient-time">{new Date(r.sentAt).toLocaleTimeString()}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Per-Session Burst Report (collapsible) ───────────────────────────────
function SessionBurstReport({ session, bursts, now, expanded, onToggle }: { session: OutreachSessionAllocation; bursts: OutreachBurstProgress[]; now: number; expanded: boolean; onToggle: () => void }) {
  const sessionBursts = bursts.filter(b => b.sessionId === session.sessionId).sort((a, b) => a.burstIndex - b.burstIndex);
  const totalSent = sessionBursts.reduce((a, b) => a + b.sent, 0);
  const totalFailed = sessionBursts.reduce((a, b) => a + b.failed, 0);
  const totalBlocked = sessionBursts.reduce((a, b) => a + b.blocked, 0);
  const totalPending = sessionBursts.reduce((a, b) => a + b.pending, 0);
  const replyRate = sessionBursts.length ? Math.round((totalSent / session.assigned) * 100) : 0;

  return (
    <div className="campaigns-session-report">
      <button className="campaigns-session-report__header" onClick={onToggle}>
        <div className="campaigns-session-report__left">
          <span className="campaigns-session-report__name">{session.sessionName}</span>
          <span className="campaigns-session-report__meta">{session.assigned} contacts · {sessionBursts.length} bursts · score {replyRate}%</span>
          <span className="campaigns-session-report__counts">
            <span className="c c-sent">{totalSent} sent</span>
            <span className="c c-failed">{totalFailed} failed</span>
            <span className="c c-blocked">{totalBlocked} blocked</span>
            <span className="c c-pending">{totalPending} pending</span>
          </span>
        </div>
        <span className="campaigns-session-report__toggle">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>

      {expanded && (
        <div className="campaigns-session-report__body">
          {/* Burst cards grid */}
          <div className="campaigns-burst-grid">
            {sessionBursts.map(b => (
              <BurstCard key={b.burstIndex} burst={b} now={now} totalBursts={sessionBursts.length} />
            ))}
          </div>

          {/* Table fallback for dense scan */}
          <table className="campaigns-burst-table">
            <thead>
              <tr>
                <th>Burst</th><th>Size</th><th>Sent</th><th>Failed</th><th>Blocked</th><th>Pending</th><th>Reply %</th><th>Start</th><th>End</th><th>Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {sessionBursts.map(b => (
                <tr key={b.burstIndex} className={`row--${b.status}`}>
                  <td>#{b.burstIndex + 1}</td>
                  <td>{b.burstSize}</td>
                  <td className="td-sent">{b.sent}</td>
                  <td className="td-failed">{b.failed}</td>
                  <td className="td-blocked">{b.blocked}</td>
                  <td className="td-pending">{b.pending}</td>
                  <td>{b.burstSize ? Math.round((b.sent / b.burstSize)*100) : 0}%</td>
                  <td title={b.startTime ?? b.estimatedStart ?? ''}>{b.startTime ? formatTimeOnly(b.startTime) : `est ${formatTimeOnly(b.estimatedStart)}`}</td>
                  <td title={b.endTime ?? b.estimatedEnd ?? ''}>{b.endTime ? formatTimeOnly(b.endTime) : `est ${formatTimeOnly(b.estimatedEnd)}`}</td>
                  <td>{b.cooldownMs ? formatMs(b.cooldownMs) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCountdownLive(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function CampaignLiveView({
  campaign,
  execution,
}: {
  campaign: OutreachCampaign;
  execution?: OutreachCampaignExecution | null;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const running = campaign.status === 'running';
  const startedMs = campaign.startedAt ? new Date(campaign.startedAt).getTime() : 0;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const liveSessions = execution?.live?.sessions ?? [];
  const liveBySession = new Map<string, OutreachLiveSession>(liveSessions.map(s => [s.sessionName, s]));
  const bursts = execution?.burstReport ?? execution?.burstProgress ?? campaign.burstProgress ?? [];
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpandedSessions(prev => ({ ...prev, [id]: !prev[id] }));

  const burstsForTotals = bursts.length > 0 ? bursts : [];
  const sentFromBursts = burstsForTotals.reduce((a, b) => a + (b.sent ?? 0), 0);
  const sentFromProgress = (execution?.sessionProgress ?? campaign.sessionProgress ?? []).reduce((a, p) => a + (p.sent ?? 0), 0);
  const sent = sentFromBursts > 0 ? sentFromBursts : sentFromProgress;
  const totalFromBursts = burstsForTotals.reduce((a, b) => a + (b.burstSize ?? 0), 0);
  const total = totalFromBursts > 0 ? totalFromBursts : (execution?.sessionProgress?.reduce((a, p) => a + (p.total ?? 0), 0) ?? campaign.contactCount);

  if (!campaign.distribution || campaign.distribution.length === 0) return null;

  return (
    <div className="campaigns-live">
      <GlobalTimeline campaign={campaign} execution={execution} />

      <div className="campaigns-live__header">
        <div className="campaigns-live__elapsed">
          <Clock size={14} />
          <span className="campaigns-live__elapsed-label">{t('campaigns.elapsed')}</span>
          <span className="campaigns-live__elapsed-value">{startedMs ? formatElapsed(startedMs, now) : '0:00'}</span>
        </div>
        <div className="campaigns-live__totals">
          <span className="campaigns-live__total-sent">{sent}/{total} {t('campaigns.sentTotal')}</span>
          <span className="campaigns-live__pct">{total > 0 ? Math.round((sent / total) * 100) : 0}%</span>
        </div>
      </div>

      {/* Session scores ranking */}
      {execution?.sessionScores && execution.sessionScores.length > 0 && (
        <div className="campaigns-scores">
          <h4><Trophy size={14} /> Session scores (highest reply rate first)</h4>
          <div className="campaigns-scores__list">
            {execution.sessionScores.map(s => (
              <div key={s.sessionId} className="campaigns-scores__item">
                <span className="campaigns-scores__name">{s.sessionName}</span>
                <span className="campaigns-scores__score">{s.score}%</span>
                <span className="campaigns-scores__meta">{s.sent}/{s.total} · {s.blocked} blocked</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(campaign.distribution ?? []).map(session => {
        const live = liveBySession.get(session.sessionName);
        const isExpanded = expandedSessions[session.sessionId] ?? campaign.status === 'running';
        const countdown = live && !live.inFlight && live.nextAvailableAt > now ? live.nextAvailableAt - now : 0;
        return (
          <div key={session.sessionId}>
            <SessionBurstReport
              session={session}
              bursts={bursts as OutreachBurstProgress[]}
              now={now}
              expanded={isExpanded}
              onToggle={() => toggle(session.sessionId)}
            />
            {live && (
              <div className="campaigns-live__session-sub">
                {live.inFlight ? (
                  <span className="campaigns-live__badge campaigns-live__badge--sending">{t('campaigns.sending')}</span>
                ) : live.nextBurstIndex >= live.totalBursts && live.totalBursts > 0 ? (
                  <span className="campaigns-live__badge campaigns-live__badge--done">{t('campaigns.allSessionsDone')}</span>
                ) : (
                  <span className="campaigns-live__badge campaigns-live__badge--cooldown">Resting {formatCountdownLive(countdown)} before Burst {(live.nextBurstIndex ?? 0) + 1}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CampaignLiveViewWithData({ campaign }: { campaign: OutreachCampaign }) {
  const shouldPoll = campaign.status === 'running';
  const { data: execution } = useOutreachExecutionQuery(campaign.id, shouldPoll);
  return <CampaignLiveView campaign={campaign} execution={execution} />;
}

export function Campaigns() {
  const { t } = useTranslation();
  useDocumentTitle(t('campaigns.title'));
  const { canWrite } = useRole();
  const toast = useToast();

  const { data: campaigns = [], isLoading } = useOutreachQuery();
  const { data: registryContacts = [] } = useRegistryContactsQuery(2000);
  const { data: replies = [] } = useRegistryRepliesQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const { data: messageTemplates = [] } = useCreditTemplatesQuery();
  const readySessions = useMemo(() => sessions.filter(s => s.status === 'ready'), [sessions]);

  const createMutation = useCreateOutreachMutation();
  const actionMutation = useOutreachActionMutation();
  const deleteMutation = useOutreachDeleteMutation();
  const updateMutation = useOutreachUpdateMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [messageMode, setMessageMode] = useState<'custom' | 'template'>('custom');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageType, setMessageType] = useState<'text' | 'image' | 'document'>('text');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [useRegistry, setUseRegistry] = useState(false);
  const [customList, setCustomList] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<string[]>(readySessions.map(s => s.name));
  const [saveContactFirst, setSaveContactFirst] = useState(true);
  const [sessionTemplates, setSessionTemplates] = useState<Array<{ id: string; name: string; body: string; sessionName: string }>>([]);
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [contactFileName, setContactFileName] = useState('');
  const [editingCampaign, setEditingCampaign] = useState<OutreachCampaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutreachCampaign | null>(null);

  const replyBySession = useMemo(() => {
    const map = new Map<string, { replied: number; sent: number; blocked: number; reported: number }>();
    for (const r of replies) map.set(r.sessionName, r);
    return map;
  }, [replies]);

  // Fetch session templates for selected sessions and combine with credit templates — preserve flexible media fields like Message Tester
  const allTemplates = useMemo(() => {
    const creditList = messageTemplates.map(t => ({ id: t.id, name: `${t.name} (credit: ${t.type}/${t.creditCost})`, body: t.body, type: (t as any).mediaType || t.type, creditCost: t.creditCost, source: 'credit' as const, mediaUrl: (t as any).mediaUrl, mimetype: (t as any).mimetype, filename: (t as any).filename, caption: (t as any).caption, mediaBase64: (t as any).mediaBase64, supabasePath: (t as any).supabasePath, mediaType: (t as any).mediaType }));
    const sessionList = sessionTemplates.map((t: any) => ({ id: `sess-${t.id}`, name: `${t.name} [${t.sessionName}]`, body: t.body, type: t.mediaType || 'text' as const, creditCost: t.mediaType && t.mediaType!=='text' ? 2 : 1, source: 'session' as const, originalId: t.id, mediaUrl: t.mediaUrl, mediaBase64: t.mediaBase64, mimetype: t.mimetype, filename: t.filename, caption: t.caption, supabasePath: t.supabasePath, mediaType: t.mediaType, header: t.header, footer: t.footer }));
    return [...creditList, ...sessionList];
  }, [messageTemplates, sessionTemplates]);

  useEffect(() => {
    if (sessions.length === 0) { setSessionTemplates([]); return; }
    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length === 0) return;
    Promise.all(sessionIds.map(id => templateApi.list(id).catch(() => []))).then(results => {
      const flat = results.flat().map((t: any) => ({ id: t.id, name: t.name, body: t.body, header: t.header, footer: t.footer, mediaType: t.mediaType, mediaUrl: t.mediaUrl, mediaBase64: t.mediaBase64, mimetype: t.mimetype, filename: t.filename, caption: t.caption, supabasePath: t.supabasePath, sessionName: sessions.find(s => s.id === t.sessionId)?.name || t.sessionId }));
      setSessionTemplates(flat);
    });
  }, [sessions]);

  const handleManualAdd = () => {
    const digits = manualPhone.replace(/[^0-9]/g, '');
    if (!digits || digits.length < 5 || digits.length > 15) { toast.warning('Invalid phone'); return; }
    const line = manualName ? `${digits}, ${manualName}` : digits;
    setCustomList(prev => prev ? `${prev}\n${line}` : line);
    setManualPhone(''); setManualName('');
  };

  const handleContactFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setContactFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCustomList(prev => prev ? `${prev}\n${text}` : text);
    };
    reader.readAsText(file);
  };

  const contactValidation = useMemo(() => {
    const lines = customList.split(/\r?\n/).filter(l => l.trim());
    let valid = 0, invalid = 0, dup = 0;
    const seen = new Set<string>();
    for (const line of lines) {
      const digits = line.split(',')[0]?.replace(/[^0-9]/g, '') || '';
      if (!digits || digits.length < 5 || digits.length > 15) invalid++;
      else if (seen.has(digits)) dup++;
      else { valid++; seen.add(digits); }
    }
    return { total: lines.length, valid, invalid, dup };
  }, [customList]);

  const toggleSession = (name: string) => {
    setSelectedSessions(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name],
    );
  };

  const parseCustom = (): { phone: string; name?: string }[] => {
    const seen = new Set<string>();
    const items: { phone: string; name?: string }[] = [];
    for (const line of customList.split(/\r?\n/)) {
      const parts = line.split(',').map(p => p.trim());
      const digits = (parts[0] ?? '').replace(/[^0-9]/g, '');
      if (!digits || /[a-zA-Z]/.test(parts[0] ?? '') || seen.has(digits)) continue;
      if (digits.length < 5 || digits.length > 15) continue;
      seen.add(digits);
      items.push({ phone: digits, name: parts[1] || undefined });
    }
    return items;
  };

  const handleCreate = () => {
    const selectedTpl = messageMode === 'template' ? allTemplates.find(template => template.id === selectedTemplate) as any : null;
    // Flexible template: like Message Tester — image+text / file+text uses caption as message, media fields as payload (Supabase URL or base64)
    const tplMediaType = selectedTpl?.mediaType || selectedTpl?.type || 'text';
    const isTplMedia = tplMediaType && tplMediaType !== 'text' && (selectedTpl?.mediaUrl || selectedTpl?.mediaBase64 || selectedTpl?.supabasePath);
    const resolvedMessage = selectedTpl ? (isTplMedia ? (selectedTpl.caption || selectedTpl.body) : selectedTpl.body) : message;
    const resolvedType = selectedTpl ? (tplMediaType as 'text'|'image'|'document'|'video'|'audio') : messageType;
    const resolvedCreditCost = selectedTpl ? (selectedTpl.creditCost ?? (tplMediaType && tplMediaType!=='text' ? 2 : 1)) : (resolvedType === 'image' ? 2 : resolvedType === 'document' || resolvedType==='video' ? 2 : 1);
    const tplMediaData = isTplMedia ? { url: selectedTpl.mediaUrl || selectedTpl.supabasePath || undefined, base64: selectedTpl.mediaBase64 || undefined, mimetype: selectedTpl.mimetype || undefined, filename: selectedTpl.filename || undefined, caption: selectedTpl.caption || undefined } : undefined;
    const resolvedMedia = tplMediaData || (mediaBase64 ? { url: undefined, base64: mediaBase64, mimetype: mediaFile?.type, filename: mediaFile?.name } : undefined);
    const resolvedTemplateId = selectedTpl ? (selectedTpl.originalId || selectedTpl.id) : undefined;
    if (!name.trim() || !resolvedMessage.trim()) {
      toast.warning(t('campaigns.toasts.actionFailed'));
      return;
    }
    if (selectedSessions.length === 0) {
      toast.warning(t('campaigns.toasts.actionFailed'));
      return;
    }
    const contacts = useRegistry
      ? registryContacts.map(c => ({ phone: c.phone, name: c.name || undefined }))
      : parseCustom();
    if (contacts.length === 0) {
      toast.warning(t('campaigns.toasts.actionFailed'));
      return;
    }
    const totalCredits = contacts.length * resolvedCreditCost;

    createMutation.mutate(
      {
        name: name.trim(),
        messageText: resolvedMessage.trim(),
        templateId: resolvedTemplateId,
        messageType: resolvedType,
        mediaData: resolvedMedia,
        creditCost: resolvedCreditCost,
        totalCredits,
        contacts,
        sessions: selectedSessions.map(sessionName => ({ sessionName })),
        strategy: {
          burstSize: DEFAULTS.burstSize,
          cooldownMinMs: DEFAULTS.cooldownMinMs,
          cooldownMaxMs: DEFAULTS.cooldownMaxMs,
          preCheckNumbers: true,
          saveContactFirst,
        },
      } as any,
      {
        onSuccess: () => {
          toast.success(t('campaigns.toasts.created'));
          setShowCreate(false);
          setName('');
          setMessage('');
          setMessageMode('custom');
          setSelectedTemplate('');
          setMessageType('text');
          setMediaFile(null);
          setMediaBase64(null);
          setCustomList('');
        },
        onError: err => toast.error(t('campaigns.toasts.actionFailed'), (err as Error).message),
      },
    );
  };

  const handleAction = (campaign: OutreachCampaign, action: 'start' | 'stop') => {
    actionMutation.mutate(
      { action, id: campaign.id },
      {
        onSuccess: () => toast.success(t(`campaigns.toasts.${action === 'start' ? 'started' : 'stopped'}`)),
        onError: err => toast.error(t('campaigns.toasts.actionFailed'), (err as Error).message),
      },
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success(t('campaigns.toasts.deleted')); setDeleteTarget(null); },
      onError: err => toast.error(t('campaigns.toasts.actionFailed'), (err as Error).message),
    });
  };

  const openEdit = (campaign: OutreachCampaign) => {
    setEditingCampaign(campaign);
    setName(campaign.name);
    setMessage(campaign.messageText);
    // Try to restore template selection if campaign was from template
    if (campaign.templateId) {
      const found = allTemplates.find(t => (t as any).originalId === campaign.templateId || t.id === campaign.templateId);
      if (found) { setMessageMode('template'); setSelectedTemplate(found.id); }
      else { setMessageMode('custom'); setSelectedTemplate(''); }
      setMessageType((campaign.messageType as any) || 'text');
    } else {
      setMessageMode('custom');
      setMessageType((campaign.messageType as any) || 'text');
    }
    // Restore contacts as customList
    const lines = campaign.contacts?.map((c: any) => c.name ? `${c.phone}, ${c.name}` : c.phone).join('\n') || '';
    setCustomList(lines);
    const sessNames = campaign.sessions?.map((s: any) => s.sessionName) || campaign.distribution?.map((d: any) => d.sessionName) || [];
    setSelectedSessions(sessNames);
    setShowCreate(true);
  };

  const handleUpdate = () => {
    if (!editingCampaign) return;
    const selectedTpl = messageMode === 'template' ? allTemplates.find(template => template.id === selectedTemplate) as any : null;
    const tplMediaType = selectedTpl?.mediaType || selectedTpl?.type || 'text';
    const isTplMedia = tplMediaType && tplMediaType !== 'text' && (selectedTpl?.mediaUrl || selectedTpl?.mediaBase64 || selectedTpl?.supabasePath);
    const resolvedMessage = selectedTpl ? (isTplMedia ? (selectedTpl.caption || selectedTpl.body) : selectedTpl.body) : message;
    const resolvedType = selectedTpl ? (tplMediaType as any) : messageType;
    const tplMediaData = isTplMedia ? { url: selectedTpl.mediaUrl || selectedTpl.supabasePath || undefined, base64: selectedTpl.mediaBase64 || undefined, mimetype: selectedTpl.mimetype || undefined, filename: selectedTpl.filename || undefined, caption: selectedTpl.caption || undefined } : undefined;
    const resolvedMedia = tplMediaData || (mediaBase64 ? { url: undefined, base64: mediaBase64, mimetype: mediaFile?.type, filename: mediaFile?.name } : undefined);
    if (!name.trim() || !resolvedMessage.trim()) { toast.warning(t('campaigns.toasts.actionFailed')); return; }
    updateMutation.mutate({ id: editingCampaign.id, data: { name: name.trim(), messageText: resolvedMessage.trim(), templateId: selectedTpl ? (selectedTpl.originalId || selectedTpl.id) : null as any, messageType: resolvedType, mediaData: resolvedMedia as any } as any }, {
      onSuccess: () => { toast.success('Campaign updated'); setShowCreate(false); setEditingCampaign(null); setName(''); setMessage(''); setCustomList(''); },
      onError: err => toast.error(t('campaigns.toasts.actionFailed'), (err as Error).message),
    });
  };

  return (
    <div className="campaigns-page">
      <PageHeader
        title={t('campaigns.title')}
        subtitle={t('campaigns.subtitle')}
        actions={
          canWrite ? (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> {t('campaigns.newCampaign')}
            </button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="campaigns-loading">
          <Loader2 className="spin-slow" size={24} />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="campaigns-empty-page">
          <Workflow size={32} />
          <p>{t('campaigns.empty')}</p>
        </div>
      ) : (
        <div className="campaigns-list">
          {campaigns.map(c => {
            const stats = c.sessionProgress?.reduce(
              (acc, p) => ({ sent: acc.sent + p.sent, failed: acc.failed + p.failed, pending: acc.pending + p.pending, blocked: (acc.blocked ?? 0) + ((p as any).blocked ?? 0) }),
              { sent: 0, failed: 0, pending: 0, blocked: 0 },
            ) ?? { sent: 0, failed: 0, pending: 0, blocked: 0 };
            return (
              <section key={c.id} className="campaigns-card">
                <header className="campaigns-card__head">
                  <div>
                    <h2 className="campaigns-card__name">{c.name}</h2>
                    <span className={`campaigns-status campaigns-status--${c.status}`}>{t(STATUS_LABEL[c.status] ?? c.status)}</span>
                  </div>
                  <div className="campaigns-card__facts">
                    <span>{c.contactCount} {t('campaigns.contacts')}</span>
                    <span>{c.sessionCount} {t('campaigns.sessions')}</span>
                    <span>{c.strategy?.burstSize} {t('campaigns.burstSize')}</span>
                    {c.strategy?.cooldownMinMs != null && (
                      <span>
                        {t('campaigns.cooldown')} {formatMs(c.strategy.cooldownMinMs)}–{formatMs(c.strategy.cooldownMaxMs ?? c.strategy.cooldownMinMs)}
                      </span>
                    )}
                    {c.strategy?.maxPerSessionPerDay && <span>max {c.strategy.maxPerSessionPerDay}/sess</span>}
                    {c.messageType && <span>{c.messageType} {c.templateId ? `(template)` : '(custom)'} · {c.creditCost || 1} credits/msg</span>}
                    {c.totalCredits ? <span>Total: {c.totalCredits} credits</span> : null}
                    <span className="campaigns-sendstats">
                      <Activity size={13} /> {stats.sent} {t('campaigns.sentTotal')} · {stats.pending} {t('campaigns.pending')} · {stats.failed} {t('campaigns.failed')} {stats.blocked ? `· ${stats.blocked} blocked` : ''}
                    </span>
                  </div>
                  {canWrite && (
                    <div className="campaigns-card__actions" style={{display:'flex',gap:6, flexWrap:'wrap'}}>
                      {c.status === 'scheduled' && (
                        <>
                          <button className="btn-secondary" onClick={() => openEdit(c)} title="Edit"><Edit2 size={15} /> Edit</button>
                          <button className="btn-secondary" onClick={() => setDeleteTarget(c)} title={t('campaigns.delete')}><Trash2 size={15} /> {t('campaigns.delete')}</button>
                          <button className="btn-primary" onClick={() => handleAction(c, 'start')}>
                            <Play size={15} /> {t('campaigns.start')}
                          </button>
                        </>
                      )}
                      {c.status === 'running' && (
                        <button className="btn-secondary" onClick={() => handleAction(c, 'stop')}>
                          <Pause size={15} /> {t('campaigns.stop')}
                        </button>
                      )}
                      {(c.status === 'completed' || c.status === 'cancelled' || c.status === 'failed') && (
                        <>
                          <button className="btn-secondary" onClick={() => openEdit(c)} title="Edit"><Edit2 size={15} /> Edit</button>
                          <button className="btn-secondary" onClick={() => handleAction(c, 'start')} title={t('campaigns.restart')}>
                            <Play size={15} /> {t('campaigns.restart')}
                          </button>
                          <button className="btn-danger" onClick={() => setDeleteTarget(c)} title={t('campaigns.delete')}>
                            <Trash2 size={15} /> {t('campaigns.delete')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </header>

                <div className="campaigns-card__message">{c.messageText}</div>

                {(c.status === 'running' || c.status === 'completed' || !!c.burstProgress) && (
                  <CampaignLiveViewWithData campaign={c} />
                )}

                {(c.sessionProgress?.length ?? 0) > 0 && (
                  <div className="campaigns-progress">
                    {c.sessionProgress?.map(p => {
                      const rr = replyBySession.get(p.sessionName);
                      const barPct = p.total > 0 ? ((p.sent + p.failed + ((p as any).blocked ?? 0)) / p.total) * 100 : 0;
                      return (
                        <div key={p.sessionId} className="campaigns-progress__row">
                          <span className="campaigns-progress__name">{p.sessionName}</span>
                          <div className="campaigns-progress__track">
                            <div className="campaigns-progress__fill" style={{ width: `${barPct}%` }} />
                          </div>
                          <span className="campaigns-progress__nums">
                            {p.sent}/{p.total} {t('campaigns.sentTotal')}
                          </span>
                          <span className="campaigns-progress__reply">
                            {rr ? `${rr.replied} ${t('campaigns.replied')} · ${Math.round(rr.sent > 0 ? (rr.replied / rr.sent) * 100 : 0)}%` : ''}
                            {rr && (rr.blocked > 0 || rr.reported > 0) ? ` · B/R ${rr.blocked + rr.reported}` : ''}
                            {(p as any).blocked ? ` · blocked ${(p as any).blocked}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setEditingCampaign(null); }}
        title={editingCampaign ? 'Update Campaign' : t('campaigns.create.title')}
        className="campaigns-create-modal"
        footer={
          <>
            <button className="btn-secondary" onClick={() => { setShowCreate(false); setEditingCampaign(null); }}>
              {t('common.cancel')}
            </button>
            {editingCampaign ? (
              <button className="btn-primary" onClick={handleUpdate} disabled={updateMutation.isPending || !canWrite}>
                {updateMutation.isPending ? <Loader2 className="spin-slow" size={16} /> : <Edit2 size={16} />}{' '}Update
              </button>
            ) : (
              <button className="btn-primary" onClick={handleCreate} disabled={createMutation.isPending || !canWrite}>
                {createMutation.isPending ? <Loader2 className="spin-slow" size={16} /> : <Plus size={16} />}{' '}
                {t('campaigns.create.create')}
              </button>
            )}
          </>
        }
      >
        <div className="campaigns-form">
          <label className="campaigns-field">
            <span>{t('campaigns.create.name')}</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="wave-1" />
          </label>
          <label className="campaigns-field">
            <span>{t('campaigns.create.message')}</span>
            <select value={messageMode} onChange={e => setMessageMode(e.target.value as 'custom' | 'template')}>
              <option value="custom">Custom message</option>
              <option value="template">Use saved template</option>
            </select>
            {messageMode === 'template' ? (
              <>
                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}>
                  <option value="">Select a template</option>
                  {allTemplates.map(template => <option key={template.id} value={template.id}>{template.name} — {template.type} ({template.creditCost} credits)</option>)}
                </select>
                {selectedTemplate && (() => {
                  const tpl = allTemplates.find(t => t.id === selectedTemplate) as any;
                  const isMedia = tpl && tpl.mediaType && tpl.mediaType!=='text' && (tpl.mediaUrl || tpl.mediaBase64);
                  return tpl ? (
                    <div style={{marginTop:8, padding:12, background:'var(--bg-light, #f1f5f9)', border:'1px solid var(--border, #e2e8f0)', borderRadius:8, maxHeight:260, overflowY:'auto'}}>
                      <div style={{fontSize:12, fontWeight:600, color:'var(--text-primary, #0f172a)', marginBottom:6}}>Preview: {tpl.name} <span style={{fontWeight:400, color:'var(--text-muted, #64748b)'}}>({tpl.mediaType||tpl.type} · {tpl.creditCost} credits/msg){isMedia ? ' 📎 media' : ''}</span></div>
                      {isMedia && tpl.mediaUrl && tpl.mediaType==='image' && <img src={tpl.mediaUrl} alt="media" style={{maxWidth:'100%', maxHeight:120, borderRadius:6, marginBottom:6, border:'1px solid var(--border)'}} />}
                      {isMedia && tpl.mediaType==='image' && <div style={{fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word', background:'var(--bg-card, #ffffff)', padding:10, borderRadius:6, border:'1px solid var(--border, #cbd5e1)', color:'var(--text-primary, #0f172a)'}}>{tpl.caption || tpl.body}</div>}
                      {!isMedia && <div style={{fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word', background:'var(--bg-card, #ffffff)', padding:10, borderRadius:6, border:'1px solid var(--border, #cbd5e1)', color:'var(--text-primary, #0f172a)'}}>{tpl.body}</div>}
                      {isMedia && tpl.mediaType!=='image' && <div style={{fontSize:13, marginTop:6, color:'var(--text-muted)'}}>File: {tpl.filename||tpl.mediaUrl?.slice(0,40)} {tpl.mimetype ? `(${tpl.mimetype})` : ''} — caption: {tpl.caption || tpl.body}</div>}
                      <small style={{color:'var(--text-muted, #64748b)', marginTop:6, display:'block'}}>Total: {(useRegistry ? registryContacts.length : parseCustom().length) * tpl.creditCost} credits for {(useRegistry ? registryContacts.length : parseCustom().length)} contacts</small>
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              <>
                <div style={{display:'flex', gap:8, marginBottom:8}}>
                  <label style={{flex:1}}><input type="radio" checked={messageType==='text'} onChange={()=>setMessageType('text')} /> Text (1 credit)</label>
                  <label style={{flex:1}}><input type="radio" checked={messageType==='image'} onChange={()=>setMessageType('image')} /> Text+Image (2 credits)</label>
                  <label style={{flex:1}}><input type="radio" checked={messageType==='document'} onChange={()=>setMessageType('document')} /> Text+File (2 credits)</label>
                </div>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Hi {{name}}…" />
                {(messageType==='image' || messageType==='document') && (
                  <div style={{marginTop:8}}>
                    <input type="file" accept={messageType==='image' ? 'image/*' : '.pdf,.doc,.docx,.txt'} onChange={e=>{
                      const f=e.target.files?.[0]||null;
                      setMediaFile(f);
                      if(f){
                        const r=new FileReader();
                        r.onload=()=>setMediaBase64((r.result as string).split(',')[1]);
                        r.readAsDataURL(f);
                      } else setMediaBase64(null);
                    }} />
                    {mediaFile && <small>Selected: {mediaFile.name} ({(mediaFile.size/1024).toFixed(1)}KB)</small>}
                  </div>
                )}
                <small>{t('campaigns.create.messageHint')} · {messageType} — {messageType==='text'?1:2} credits/msg · Total: {(useRegistry ? registryContacts.length : parseCustom().length) * (messageType==='text'?1:2)} credits</small>
              </>
            )}
          </label>

          {/* <label className="campaigns-check">
            <input type="checkbox" checked={useRegistry} onChange={e => setUseRegistry(e.target.checked)} />
            {t('campaigns.create.fromRegistry')}
          </label> */}
          {/* <small className="campaigns-hint">{t('campaigns.create.fromRegistryHint')}</small> */}
          {useRegistry ? (
            <div className="campaigns-field">
              <span className="campaigns-count">{t('campaigns.create.ledCount', { count: registryContacts.length })}</span>
            </div>
          ) : (
            <div className="campaigns-field" style={{border:'1px solid #e2e8f0', borderRadius:8, padding:12, background:'black'}}>
              <span style={{fontWeight:600, fontSize:13, marginBottom:8, display:'block'}}>Add Contacts Manually or Upload</span>
              <div style={{display:'flex', gap:8, marginBottom:8}}>
                <input style={{flex:1, padding:'8px 10px', border:'1px solid #cbd5e1', borderRadius:8}} placeholder="Phone (e.g. 628123456789)" value={manualPhone} onChange={e=>setManualPhone(e.target.value)} />
                <input style={{flex:1, padding:'8px 10px', border:'1px solid #cbd5e1', borderRadius:8}} placeholder="Name (optional)" value={manualName} onChange={e=>setManualName(e.target.value)} />
                <button type="button" className="btn-secondary" onClick={handleManualAdd}>Add</button>
              </div>
              <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}>
                <label className="btn-secondary" style={{cursor:'pointer', padding:'6px 12px', borderRadius:8, border:'1px solid #e2e8f0', background:'black'}}>
                  <input type="file" accept=".csv,.txt" hidden onChange={handleContactFile} />
                  📁 Upload CSV/TXT
                </label>
                {contactFileName && <small style={{color:'#64748b'}}>{contactFileName}</small>}
              </div>
              <textarea value={customList} onChange={e => setCustomList(e.target.value)} rows={4} placeholder="628123456789, Alice&#10;628987654321" style={{width:'100%', padding:'8px 10px', border:'1px solid #cbd5e1', borderRadius:8}} />
              <div style={{marginTop:8, fontSize:12, display:'flex', gap:12, flexWrap:'wrap'}}>
                <span style={{color:'#166534', fontWeight:600}}>Valid: {contactValidation.valid}</span>
                <span style={{color:'#991b1b'}}>Invalid: {contactValidation.invalid}</span>
                <span style={{color:'#92400e'}}>Duplicates: {contactValidation.dup}</span>
                <span style={{color:'#64748b'}}>Total lines: {contactValidation.total}</span>
              </div>
              {/* {contactValidation.valid>0 && <div style={{marginTop:8, maxHeight:100, overflowY:'auto', background:'#333', padding:8, borderRadius:6, fontSize:12}}>{parseCustom().slice(0,5).map((c,i)=><div key={i}>{c.phone}{c.name?` — ${c.name}`:''}</div>)}{parseCustom().length>5 && <div>...and {parseCustom().length-5} more</div>}</div>} */}
            </div>
          )}

          <div className="campaigns-field">
            <span>{t('campaigns.create.sessionsLabel')}</span>
            <div className="campaigns-sessionpool">
              {readySessions.length === 0 ? (
                <small>—</small>
              ) : (
                readySessions.map(s => (
                  <label key={s.id} className="campaigns-sessionpool__item">
                    <input type="checkbox" checked={selectedSessions.includes(s.name)} onChange={() => toggleSession(s.name)} />
                    {s.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <div style={{padding:12, background:'var(--bg-card, #f8fafc)', borderRadius:8, border:'1px solid var(--border, #e2e8f0)', boxShadow:'0 1px 3px rgba(0,0,0,0.05)'}}>
            <strong style={{color:'var(--text-primary, #0f172a)', display:'flex', alignItems:'center', gap:6}}>💳 Credit Usage</strong>
            <div style={{fontSize:13, marginTop:6, color:'var(--text-primary, #334155)'}}>
              {(() => {
                const count = useRegistry ? registryContacts.length : parseCustom().length;
                const tpl = messageMode==='template' ? allTemplates.find(t=>t.id===selectedTemplate) as any : null;
                const cost = tpl ? tpl.creditCost : (messageType==='text'?1:2);
                const total = count * cost;
                return <span>{count} contacts × <span style={{background:'var(--bg-light, #e0f2fe)', padding:'2px 6px', borderRadius:4, fontWeight:600}}>{cost} credits</span> = <b style={{color:'var(--info, #2563eb)', fontSize:14}}>{total} credits</b> will be deducted from your account and assigned to reseller/user</span>;
              })()}
            </div>
          </div>
          <small className="campaigns-hint">Delivery pacing, burst limits, session caps and cooldowns are controlled by the server.</small>
          <label className="campaigns-check">
            <input type="checkbox" checked={saveContactFirst} onChange={e => setSaveContactFirst(e.target.checked)} />
            {t('campaigns.create.saveContactFirst')}
          </label>
        </div>
      </Modal>

      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Campaign" className="modal-sm" closeLabel={t('common.close')} footer={<><button className="btn-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button className="btn-danger" onClick={handleDeleteConfirm} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? <Loader2 size={16} className="spin-slow"/> : <Trash2 size={16}/>} Delete</button></>}>
          <p>Delete campaign <b>{deleteTarget.name}</b>? This cannot be undone. Only scheduled/completed/cancelled campaigns can be deleted.</p>
        </Modal>
      )}
    </div>
  );
}
