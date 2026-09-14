import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  type BlockKind,
  type RegistryContactRow,
  type RegistryBlockedRow,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useImportContactsMutation,
  useRecordBlockedMutation,
  useRegistryBlockedQuery,
  useRegistryContactsQuery,
  useRegistryRepliesQuery,
  useRemoveBlockedMutation,
  useSessionsQuery,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './Contacts.css';

/**
 * Parse the import input: each line may be a bare phone, `phone,name` (comma-separated), or a
 * CSV header row. Non-digit noise is stripped from the phone; the `name` is the second field.
 */
function parseImportText(text: string, fileContent?: string): { phone: string; name?: string }[] {
  const source = fileContent ?? text;
  const items: { phone: string; name?: string }[] = [];
  const seen = new Set<string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(',').map(p => p.trim());
    const phoneRaw = parts[0] ?? '';
    const digits = phoneRaw.replace(/[^0-9]/g, '');
    // Drop header rows and anything that is not digits.
    if (!digits || /[a-zA-Z]/.test(phoneRaw)) continue;
    // WhatsApp mobile numbers are 10-12 digits. Below 10 (e.g. 8-digit landlines, orphan rows)
    // or above 12 (overflow/multi-number rows) are junk and drop — prevents accidental imports.
    if (digits.length < 10 || digits.length > 12) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    items.push({ phone: digits, name: parts[1] || undefined });
  }
  return items;
}

export function Contacts() {
  const { t } = useTranslation();
  useDocumentTitle(t('contacts.title'));
  const { canWrite } = useRole();
  const toast = useToast();

  const { data: contacts = [], isLoading: loadingContacts } = useRegistryContactsQuery(2000);
  const { data: blockedResp } = useRegistryBlockedQuery(true);
  const { data: replies = [] } = useRegistryRepliesQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const readySessions = useMemo(() => sessions.filter(s => s.status === 'ready'), [sessions]);

  const importMutation = useImportContactsMutation();
  const recordMutation = useRecordBlockedMutation();
  const removeMutation = useRemoveBlockedMutation();

  // Import form state
  const [importText, setImportText] = useState('');
  const [checkWhatsApp, setCheckWhatsApp] = useState(false);
  const [verifyWhatsApp, setVerifyWhatsApp] = useState(false);
  const [saveToWhatsApp, setSaveToWhatsApp] = useState(false);
  const [sessionForSave, setSessionForSave] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Blocked/record form state
  const [blockPhone, setBlockPhone] = useState('');
  const [blockKind, setBlockKind] = useState<BlockKind>('blocked');

  // List filters
  const [searchTerm, setSearchTerm] = useState('');
  const [replyFilter, setReplyFilter] = useState<'all' | 'replied' | 'noreply'>('all');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const filteredContacts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return contacts.filter(c => {
      if (replyFilter === 'replied' && !c.replied) return false;
      if (replyFilter === 'noreply' && c.replied) return false;
      if (!q) return true;
      return c.phone.includes(q) || (c.name?.toLowerCase() ?? '').includes(q);
    });
  }, [contacts, searchTerm, replyFilter]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, RegistryContactRow[]>();
    for (const c of filteredContacts) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    // sort dates descending (newest first)
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredContacts]);

  const visibleGroups = useMemo(() => {
    if (selectedDate === 'all') return dateGroups;
    return dateGroups.filter(([k]) => k === selectedDate);
  }, [dateGroups, selectedDate]);

  const formatDateLabel = (isoDate: string) => {
    const d = new Date(isoDate + 'T00:00:00');
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (isoDate === today) return 'Today';
    if (isoDate === yest) return 'Yesterday';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const toggleDate = (key: string) => {
    setExpandedDates(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // auto-expand first 2 dates when data loads
  const hasAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (!hasAutoExpandedRef.current && dateGroups.length > 0) {
      hasAutoExpandedRef.current = true;
      setExpandedDates(new Set(dateGroups.slice(0, 2).map(([k]) => k)));
    }
  }, [dateGroups]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  };

  const handleImport = () => {
    const items = parseImportText(importText);
    if (items.length === 0) {
      toast.warning(t('contacts.toasts.importFailed'), t('contacts.importHint'));
      return;
    }
    importMutation.mutate(
      {
        items,
        checkWhatsAppAddressbook: checkWhatsApp,
        verifyOnWhatsApp: verifyWhatsApp,
        saveToWhatsApp,
        sessionName: saveToWhatsApp ? sessionForSave || undefined : undefined,
      },
      {
        onSuccess: res => {
          toast.success(
            t('contacts.toasts.imported', {
              added: res.added,
              duplicatesLocal: res.duplicatesLocal + res.duplicatesWhatsApp,
              notOnWhatsApp: verifyWhatsApp ? res.notOnWhatsApp : 0,
            }),
          );
          setImportText('');
        },
        onError: err => toast.error(t('contacts.toasts.importFailed'), (err as Error).message),
      },
    );
  };

  const handleRecordBlocked = () => {
    const digits = blockPhone.replace(/[^0-9]/g, '');
    if (!digits) return;
    recordMutation.mutate(
      { phone: digits, kind: blockKind },
      {
        onSuccess: () => {
          toast.success(t('contacts.toasts.recorded'));
          setBlockPhone('');
        },
        onError: err => toast.error(t('contacts.toasts.actionFailed'), (err as Error).message),
      },
    );
  };

  const handleRemoveBlocked = (row: RegistryBlockedRow) => {
    removeMutation.mutate(
      { phone: row.phone, kind: row.kind as BlockKind },
      {
        onSuccess: () => toast.success(t('contacts.toasts.removed')),
        onError: err => toast.error(t('contacts.toasts.actionFailed'), (err as Error).message),
      },
    );
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="contacts-page">
      <PageHeader
        title={t('contacts.title')}
        subtitle={t('contacts.subtitle')}
        actions={
          canWrite ? (
            <label className="file-import-btn" htmlFor="contacts-csv">
              <Download size={16} />
              <span>
                <Upload size={14} style={{ marginRight: 4 }} />
                {t('contacts.fileName')}
              </span>
            </label>
          ) : undefined
        }
      />

      {canWrite && <input ref={fileInputRef} id="contacts-csv" type="file" accept=".csv,.txt" hidden onChange={handleFile} />}

      <div className="contacts-grid">
        {/* ── Import card ── */}
        <section className="contacts-card contacts-import">
          <h2 className="contacts-card__title">
            <Upload size={18} /> {t('contacts.importCard')}
          </h2>
          <p className="contacts-card__hint">{t('contacts.importHint')}</p>
          <textarea
            className="contacts-import__textarea"
            placeholder={t('contacts.pastePlaceholder')}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={5}
          />
          <div className="contacts-import__options">
            <label className="contacts-check">
              <input type="checkbox" checked={checkWhatsApp} onChange={e => setCheckWhatsApp(e.target.checked)} />
              {t('contacts.checkWhatsApp')}
            </label>
            <label className="contacts-check">
              <input type="checkbox" checked={verifyWhatsApp} onChange={e => setVerifyWhatsApp(e.target.checked)} />
              {t('contacts.verifyWhatsApp')}
            </label>
            <label className="contacts-check">
              <input type="checkbox" checked={saveToWhatsApp} onChange={e => setSaveToWhatsApp(e.target.checked)} />
              {t('contacts.saveToWhatsApp')}
            </label>
            {saveToWhatsApp && (
              <label className="contacts-select">
                <span>{t('contacts.sessionForSave')}</span>
                <select value={sessionForSave} onChange={e => setSessionForSave(e.target.value)}>
                  <option value="">{t('contacts.allReady')}</option>
                  {readySessions.map(s => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button className="btn-primary contacts-import__btn" onClick={handleImport} disabled={!importText.trim() || importMutation.isPending}>
            {importMutation.isPending ? (
              <>
                <Loader2 className="spin-slow" size={16} /> {t('contacts.importing')}
              </>
            ) : (
              <>
                <Plus size={16} /> {t('contacts.importBtn')}
              </>
            )}
          </button>
          {importMutation.data && !importMutation.isPending && (
            <div className="contacts-import__result">
              <div>
                <strong>{importMutation.data.added}</strong> {t('contacts.added')}
              </div>
              <div>
                <strong>{importMutation.data.duplicatesLocal}</strong> {t('contacts.duplicatesLocal')}
              </div>
              <div>
                <strong>{importMutation.data.duplicatesWhatsApp}</strong> {t('contacts.duplicatesWhatsApp')}
              </div>
              <div>
                <strong>{importMutation.data.invalid}</strong> {t('contacts.invalid')}
              </div>
              <div>
                <strong>{importMutation.data.total}</strong> {t('contacts.total')}
              </div>
            </div>
          )}
        </section>

        {/* ── Leads list — date-wise grouped ── */}
        <section className="contacts-card contacts-list">
          <h2 className="contacts-card__title">
            <Users size={18} /> {t('contacts.listTitle')} <span className="contacts-count">{contacts.length}</span>
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              {dateGroups.length > 0 ? `${dateGroups.length} import${dateGroups.length>1?'s':''} · date wise` : ''}
            </span>
          </h2>
          {/* date filter chips */}
          {dateGroups.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <button
                onClick={() => setSelectedDate('all')}
                style={{
                  padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: selectedDate==='all'?700:500,
                  border: selectedDate==='all' ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: selectedDate==='all' ? 'var(--primary-soft)' : 'var(--bg-white)', color: selectedDate==='all' ? 'var(--primary-text)' : 'var(--text-secondary)', cursor: 'pointer'
                }}
              >
                All dates ({contacts.length})
              </button>
              {dateGroups.map(([d, arr]) => (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  style={{
                    padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: selectedDate===d?700:500,
                    border: selectedDate===d ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: selectedDate===d ? 'var(--primary-soft)' : 'var(--bg-white)', color: selectedDate===d ? 'var(--primary-text)' : 'var(--text-secondary)', cursor: 'pointer'
                  }}
                  title={`${formatDateLabel(d)} · ${arr.length} contacts`}
                >
                  {formatDateLabel(d)} · {arr.length}
                </button>
              ))}
            </div>
          )}
          <div className="contacts-list__toolbar">
            <div className="contacts-search">
              <Search size={16} />
              <input
                placeholder={t('contacts.searchPlaceholder')}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              aria-label={t('contacts.replyYes')}
              value={replyFilter}
              onChange={e => setReplyFilter(e.target.value as 'all' | 'replied' | 'noreply')}
            >
              <option value="all">{t('contacts.listTitle')}</option>
              <option value="replied">{t('contacts.replyYes')}</option>
              <option value="noreply">{t('contacts.replyNo')}</option>
            </select>
          </div>

          {loadingContacts ? (
            <div className="contacts-empty">
              <Loader2 className="spin-slow" size={20} />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="contacts-empty">
              <Users size={24} />
              <p>{t('contacts.emptyLeads')}</p>
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="contacts-empty">
              <Users size={24} />
              <p>No contacts for this filter</p>
            </div>
          ) : (
            <div style={{ maxHeight: 520, overflowY: 'auto', paddingRight: 2 }}>
              {visibleGroups.map(([dateKey, group]) => {
                const isExpanded = expandedDates.has(dateKey);
                const repliedInGroup = group.filter(c => c.replied).length;
                return (
                  <div key={dateKey} style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-white)' }}>
                    <button
                      onClick={() => toggleDate(dateKey)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        padding: '10px 12px', background: isExpanded ? 'var(--primary-soft)' : 'var(--bg-card)', border: 'none', cursor: 'pointer', textAlign: 'left'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                        <span style={{ background: 'var(--bg-white)', border: '1px solid var(--border)', borderRadius: 8, padding: '3px 8px', fontSize: 11 }}>{formatDateLabel(dateKey)}</span>
                        {new Date(dateKey).toLocaleDateString(undefined, { weekday: 'short' })} · {group.length} saved
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>{formatDate(dateGroups.find(([k])=>k===dateKey)?.[1][0]?.createdAt ?? dateKey)}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                        {repliedInGroup > 0 && <span style={{ background: 'rgba(29,185,84,0.14)', color: 'var(--success-text)', borderRadius: 999, padding: '2px 7px', fontWeight: 600 }}>{repliedInGroup} replied</span>}
                        <span style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', fontSize: 12 }}>▼</span>
                      </span>
                    </button>
                    {isExpanded && (
                      <ul className="contacts-leadlist" style={{ maxHeight: 'none', overflow: 'visible', borderTop: '1px solid var(--border)', margin: 0 }}>
                        {group.map((c: RegistryContactRow) => (
                          <li key={c.id} className="contacts-lead" style={{ padding: '10px 12px' }}>
                            <div className="contacts-lead__main">
                              <div className="contacts-lead__phone">{c.phone}</div>
                              {c.name && <div className="contacts-lead__name">{c.name}</div>}
                            </div>
                            <div className="contacts-lead__meta">
                              {c.replied ? (
                                <span className="contacts-reply contacts-reply--yes">
                                  <RotateCcw size={13} /> {t('contacts.replyYes')} · {t('contacts.incoming', { count: c.incomingCount })}
                                </span>
                              ) : (
                                <span className="contacts-reply contacts-reply--no">{t('contacts.replyNo')}</span>
                              )}
                              <span className="contacts-lead__date">{new Date(c.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {t('contacts.addedOn', { date: formatDate(c.createdAt) })}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {dateGroups.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>Import history: {dateGroups.map(([k, arr]) => `${formatDateLabel(k)} (${arr.length})`).join(' · ')}</span>
              <span style={{ marginLeft: 'auto' }}>{filteredContacts.length} shown · {contacts.length} total</span>
            </div>
          )}
        </section>

        {/* ── Blocked / Reported registry ── */}
        <section className="contacts-card contacts-blocked">
          <h2 className="contacts-card__title">
            <ShieldAlert size={18} /> {t('contacts.blockedTitle')}
          </h2>

          {canWrite && (
            <div className="contacts-blocked__record">
              <input
                placeholder={t('contacts.recordPlaceholder')}
                value={blockPhone}
                onChange={e => setBlockPhone(e.target.value)}
              />
              <select aria-label={t('contacts.recordKind')} value={blockKind} onChange={e => setBlockKind(e.target.value as BlockKind)}>
                <option value="blocked">{t('contacts.kindBlocked')}</option>
                <option value="reported">{t('contacts.kindReported')}</option>
              </select>
              <button className="btn-secondary" onClick={handleRecordBlocked} disabled={!blockPhone.trim()}>
                {t('contacts.recordBtn')}
              </button>
            </div>
          )}

          {blockedResp?.items.length === 0 ? (
            <div className="contacts-empty">
              <ShieldCheck size={24} />
              <p>{t('contacts.blockedCard')}</p>
            </div>
          ) : (
            <ul className="contacts-blocked__list">
              {blockedResp?.items.map(row => (
                <li key={row.id} className="contacts-blocked__item">
                  <span className={`contacts-kind contacts-kind--${row.kind}`}>
                    {row.kind === 'reported' ? t('contacts.kindReported') : t('contacts.kindBlocked')}
                  </span>
                  <span className="contacts-blocked__phone">{row.phone}</span>
                  <span className="contacts-blocked__src">
                    {row.source === 'engine' ? t('contacts.sourceEngine') : t('contacts.sourceManual')}
                  </span>
                  <button className="btn-icon btn-danger" onClick={() => handleRemoveBlocked(row)} title={t('contacts.removeBlocked')}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {blockedResp && blockedResp.engineBlocked.length > 0 && (
            <div className="contacts-engine">
              <span className="contacts-card__label">{t('contacts.engineBlocked')}</span>
              <ul className="contacts-engine__list">
                {blockedResp.engineBlocked.map(p => (
                  <li key={p} className="contacts-engine__item">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ── Reply tracking per session ── */}
        <section className="contacts-card contacts-replies">
          <h2 className="contacts-card__title">
            <RotateCcw size={18} /> {t('contacts.repliesTitle')}
          </h2>
          {replies.length === 0 ? (
            <div className="contacts-empty">
              <p>{t('contacts.repliesEmpty')}</p>
            </div>
          ) : (
            <table className="contacts-replies__table">
              <thead>
                <tr>
                  <th>{t('sessions.title')}</th>
                  <th>{t('contacts.sent')}</th>
                  <th>{t('contacts.replyYes')}</th>
                  <th>{t('contacts.replyRate')}</th>
                  <th>{t('contacts.blockedCount')}</th>
                  <th>{t('contacts.reportedCount')}</th>
                </tr>
              </thead>
              <tbody>
                {replies.map(r => (
                  <tr key={r.sessionId}>
                    <td>{r.sessionName}</td>
                    <td>{r.sent}</td>
                    <td>{r.replied}</td>
                    <td>{Math.round(r.replyRate * 100)}%</td>
                    <td>{r.blocked}</td>
                    <td>{r.reported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {!canWrite && <p className="contacts-viewonly">{t('contacts.roles.viewOnly')}</p>}
    </div>
  );
}
