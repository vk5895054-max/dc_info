import { useMemo, useState } from 'react';
import { Phone, Wallet, Search, Loader2, RefreshCw, ShoppingCart, Ban, CheckCircle, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useGrizzlyBalanceQuery, useGrizzlyBalanceHistoryQuery, useGrizzlyOrdersQuery, useGrizzlyBuyMutation, useGrizzlySetStatusMutation, useGrizzlyTrackMutation } from '../hooks/queries';
import { grizzlyApi, type GrizzlyOrder, type GrizzlyAccountNumber } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../hooks/useToast';

function parseSmsCode(raw: string): string | null {
  const m = /STATUS_OK:(.+)$/.exec(raw) || /STATUS_WAIT_RETRY:(.+)$/.exec(raw);
  return m ? m[1].trim() : null;
}

function statusColor(status: string): string {
  if (status === 'OK') return '#16a34a';
  if (status === 'CANCEL') return '#dc2626';
  if (status === 'WAIT_CODE' || status === 'WAIT_RETRY' || status === 'WAIT_RESEND') return '#0ea5e9';
  if (status === 'pending') return '#f59e0b';
  return '#64748b';
}

export function GrizzlySms() {
  useDocumentTitle('Grizzly SMS');
  const toast = useToast();
  const { data: balance, isLoading: balLoading, refetch: refetchBalance, error: balError } = useGrizzlyBalanceQuery();
  const { data: balanceHistory = [] } = useGrizzlyBalanceHistoryQuery(20);
  const { data: orders = [], isLoading: ordersLoading, refetch: refetchOrders } = useGrizzlyOrdersQuery(100);
  const buyMutation = useGrizzlyBuyMutation();
  const setStatusMutation = useGrizzlySetStatusMutation();
  const trackMutation = useGrizzlyTrackMutation();

  const [service, setService] = useState('wa');
  const [country, setCountry] = useState('22');
  const [maxPrice, setMaxPrice] = useState('0.85');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [liveStatus, setLiveStatus] = useState<Record<string, { status: string; raw: string; loading?: boolean }>>({});
  const [lookupId, setLookupId] = useState('');
  const [acctToken, setAcctToken] = useState(() => { try { return sessionStorage.getItem('grizzly_acct_token') || ''; } catch { return ''; } });
  const [acctNumbers, setAcctNumbers] = useState<GrizzlyAccountNumber[]>([]);
  const [acctLoading, setAcctLoading] = useState(false);
  const [acctError, setAcctError] = useState('');
  const [acctQ, setAcctQ] = useState('');
  const [acctExpanded, setAcctExpanded] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders as GrizzlyOrder[];
    return (orders as GrizzlyOrder[]).filter(o =>
      [o.phone, o.activationId, o.service, o.country, o.status, String(o.priceUsed ?? '')]
        .some(v => (v || '').toString().toLowerCase().includes(s)),
    );
  }, [orders, q]);

  const stats = useMemo(() => {
    const list = orders as GrizzlyOrder[];
    const total = list.length;
    const active = list.filter(o => !['CANCEL', 'OK'].includes(o.status)).length;
    const spent = list.reduce((a, o) => a + (Number(o.priceUsed) || 0), 0);
    return { total, active, spent };
  }, [orders]);

  const handleBuy = async () => {
    try {
      const payload: { service?: string; country?: string; maxPrice?: number } = {
        service: service.trim() || 'wa',
        country: country.trim() || '22',
      };
      const mp = Number(maxPrice);
      if (maxPrice.trim() !== '' && Number.isFinite(mp) && mp > 0) payload.maxPrice = mp;
      const order = await buyMutation.mutateAsync(payload);
      toast.success(`Number bought: ${order.phone} (${order.activationId}) @ $${order.priceUsed}`);
      void refetchOrders();
      void refetchBalance();
    } catch (e: any) {
      toast.error('Buy failed', e?.message || 'Buy failed');
    }
  };

  const handleRefreshStatus = async (activationId: string) => {
    setLiveStatus(prev => ({ ...prev, [activationId]: { status: '...', raw: '', loading: true } }));
    try {
      const res = await grizzlyApi.status(activationId);
      setLiveStatus(prev => ({ ...prev, [activationId]: { ...res } }));
      void refetchOrders();
    } catch (e: any) {
      setLiveStatus(prev => ({ ...prev, [activationId]: { status: 'ERROR', raw: e?.message || 'failed' } }));
      toast.error('Status check failed', e?.message || 'failed');
    }
  };

  const handleSetStatus = async (activationId: string, status: string) => {
    const label = status === '8' ? 'cancel (refund)' : status === '6' ? 'complete (keep charged)' : `status ${status}`;
    if (!window.confirm(`Set ${activationId} to ${label}?`)) return;
    try {
      await setStatusMutation.mutateAsync({ activationId, status });
      toast.success(`Activation ${activationId} → ${label}: ok`);
      void refetchOrders();
      void refetchBalance();
      void handleRefreshStatus(activationId);
    } catch (e: any) {
      toast.error('setStatus failed', e?.message || 'failed');
    }
  };

  const handleLookup = async () => {
    const id = lookupId.trim();
    if (!id) return;
    await handleRefreshStatus(id);
  };

  const handleLoadAccountNumbers = async () => {
    setAcctLoading(true);
    setAcctError('');
    try {
      const list = await grizzlyApi.accountNumbers(acctToken.trim() || undefined);
      setAcctNumbers(list);
      try {
        if (acctToken.trim()) sessionStorage.setItem('grizzly_acct_token', acctToken.trim());
        else sessionStorage.removeItem('grizzly_acct_token');
      } catch { /* ignore */ }
      toast.success(`Loaded ${list.length} bought number(s) from Grizzly account`);
    } catch (e: any) {
      setAcctError(e?.message || 'Failed to load account numbers');
      toast.error('Account numbers failed', e?.message || 'failed');
    } finally {
      setAcctLoading(false);
    }
  };

  const handleImportAll = async () => {
    if (acctNumbers.length === 0) return;
    if (!window.confirm(`Import ${acctNumbers.length} account number(s) into your profile list?`)) return;
    let ok = 0;
    for (const n of acctNumbers) {
      try {
        await trackMutation.mutateAsync({ activationId: String(n.id), phone: n.number, service: n.service_code || 'wa', country: n.country_code || '22' });
        ok++;
      } catch { /* keep going */ }
    }
    toast.success(`Imported ${ok}/${acctNumbers.length} into your list`);
    void refetchOrders();
  };

  const acctFiltered = acctQ.trim()
    ? acctNumbers.filter(n => [n.number, String(n.id), n.code, n.service_name, n.service_code, n.country_name, String(n.provider_id), n.price].some(v => (v || '').toString().toLowerCase().includes(acctQ.trim().toLowerCase())))
    : acctNumbers;

  const handleTrack = async (activationId: string, phone?: string) => {
    const id = (activationId || lookupId).trim();
    if (!id) return;
    try {
      const order = await trackMutation.mutateAsync({ activationId: id, phone: phone || undefined, service: service.trim() || 'wa', country: country.trim() || '22' });
      toast.success(`Tracked ${order.activationId} (${order.phone || 'no phone'}) — now in your list`);
      void refetchOrders();
    } catch (e: any) {
      toast.error('Track failed', e?.message || 'failed');
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <PageHeader
        title="Grizzly SMS"
        subtitle="India (22) WhatsApp (wa) virtual numbers — balance, bought numbers and full activation info. Buy = getNumber, Cancel (8) = refund, Complete (6) = keep charged."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { void refetchBalance(); void refetchOrders(); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        }
      />

      {/* balance + stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ border: '1px solid #16a34a', borderRadius: 10, padding: 12, background: 'var(--card-bg, #1e293b)' }}>
          <div style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}><Wallet size={14} /> LIVE BALANCE</div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>
            {balLoading ? <Loader2 className="animate-spin" size={20} /> : balError ? <span style={{ color: '#dc2626', fontSize: 13 }}>Not configured / key error</span> : `$${balance?.balance ?? '—'}`}
          </div>
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{balance?.raw || 'ACCESS_BALANCE via /grizzlysms/balance'}</small>
        </div>
        <div style={{ border: '1px solid #0ea5e9', borderRadius: 10, padding: 12, background: 'var(--card-bg, #1e293b)' }}>
          <div style={{ fontSize: 11, color: '#0ea5e9', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}><Phone size={14} /> BOUGHT NUMBERS</div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>{stats.total}</div>
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{stats.active} active · ${stats.spent.toFixed(2)} total priceUsed</small>
        </div>
        <div style={{ border: '1px solid #7c3aed', borderRadius: 10, padding: 12, background: 'var(--card-bg, #1e293b)' }}>
          <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700 }}>INDIA wa PRICE</div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>$0.85</div>
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>country 22 · service wa · ladder 1 → 0.85 → 0.75</small>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--card-bg, #1e293b)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>BALANCE HISTORY ({balanceHistory.length})</div>
          <div style={{ fontSize: 12, maxHeight: 60, overflow: 'auto', marginTop: 4 }}>
            {(balanceHistory as any[]).slice(0, 5).map(h => (
              <div key={h.id}>${h.balance} · {h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</div>
            ))}
            {balanceHistory.length === 0 && <span style={{ color: 'var(--text-muted)' }}>No snapshots yet — hit Refresh</span>}
          </div>
        </div>
      </div>

      {/* my bought numbers — live from Grizzly account API */}
      <div style={{ border: '1px solid #0ea5e9', borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--card-bg, #1e293b)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={15} /> My bought numbers — live from Grizzly account {acctNumbers.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>({acctFiltered.length}/{acctNumbers.length})</span>}</div>
        <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Token lasts ~1 hour. Server env already has one — just hit Load. If expired, paste a fresh Bearer token from grizzlysms.com (kept only in this tab's session).</small>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input type="password" value={acctToken} onChange={e => setAcctToken(e.target.value)} placeholder="Fresh Bearer token (optional if server env set)" style={{ flex: 1, minWidth: 220, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} />
          <button onClick={handleLoadAccountNumbers} disabled={acctLoading} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#0ea5e9', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            {acctLoading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Load my numbers
          </button>
          {acctNumbers.length > 0 && (
            <button onClick={handleImportAll} disabled={trackMutation.isPending} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #16a34a', background: 'transparent', color: '#16a34a', fontWeight: 700 }}>
              Import all into my list
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}><Search size={16} style={{ position: 'absolute', left: 8, top: 10, color: '#94a3b8' }} /><input value={acctQ} onChange={e => setAcctQ(e.target.value)} placeholder="Search number, id, code, provider" style={{ width: '100%', padding: '8px 8px 8px 28px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} /></div>
        </div>
        {acctError && <div style={{ marginTop: 8, color: '#dc2626', fontSize: 13 }}>{acctError}</div>}
        {acctNumbers.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
            <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #0f172a)', zIndex: 1 }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}></th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Number</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>SMS code</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>$</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Service</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Country</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Provider</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Created → End</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {acctFiltered.map(n => {
                    const open = !!acctExpanded[n.id];
                    return (
                      <>
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 10px' }}><button onClick={() => setAcctExpanded(p => ({ ...p, [n.id]: !p[n.id] }))} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                          <td style={{ padding: '8px 10px', fontWeight: 800, fontFamily: 'monospace' }}>+{n.number}</td>
                          <td style={{ padding: '8px 10px' }}>{n.code ? <span style={{ padding: '2px 10px', borderRadius: 999, background: '#16a34a', color: '#fff', fontWeight: 800, fontFamily: 'monospace' }}>{n.code}</span> : '—'}</td>
                          <td style={{ padding: '8px 10px' }}>${Number(n.price).toFixed(2)}</td>
                          <td style={{ padding: '8px 10px' }}>{n.service_name} ({n.service_code})</td>
                          <td style={{ padding: '8px 10px' }}>{n.country_name} ({n.country_code}, +{n.country_phone_code})</td>
                          <td style={{ padding: '8px 10px' }}>#{n.provider_id}</td>
                          <td style={{ padding: '8px 10px' }}><span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: n.is_active ? '#16a34a' : '#64748b', color: '#fff' }}>{n.is_active ? `ACTIVE/${n.status}` : `done/${n.status}`}</span></td>
                          <td style={{ padding: '8px 10px', fontSize: 11 }}>{n.created_at}<br />→ {n.end_at}</td>
                          <td style={{ padding: '8px 10px' }}><button onClick={() => handleTrack(String(n.id), n.number)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #0ea5e9', background: 'transparent', color: '#0ea5e9', fontSize: 11, cursor: 'pointer' }}>Track</button></td>
                        </tr>
                        {open && (
                          <tr key={`${n.id}-full`} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary, #0f172a)' }}>
                            <td></td>
                            <td colSpan={9} style={{ padding: '8px 10px', fontSize: 12 }}>
                              <div><b>Full info:</b> id={n.id} · number=+{n.number} · code={n.code || '—'} · price=${n.price} · service={n.service_name} ({n.service_code}) · country={n.country_name} ({n.country_code}, +{n.country_phone_code}) · provider=#{n.provider_id} · status={n.status} · is_active={n.is_active} · multiple_sms={String(n.multiple_sms)}</div>
                              <div>created={n.created_at} · end={n.end_at} · allow_cancel_sec={n.allow_cancel_sec} · sms_tip={n.sms_tip || '—'}</div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* buy box */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--card-bg, #1e293b)' }}>
        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><ShoppingCart size={15} /> Buy number (India default)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ fontSize: 12 }}>Service<br /><input value={service} onChange={e => setService(e.target.value)} placeholder="wa" style={{ width: 110, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} /></label>
          <label style={{ fontSize: 12 }}>Country<br /><input value={country} onChange={e => setCountry(e.target.value)} placeholder="22" style={{ width: 110, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} /></label>
          <label style={{ fontSize: 12 }}>Max price $<br /><input value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="0.85" style={{ width: 110, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} /></label>
          <button onClick={handleBuy} disabled={buyMutation.isPending} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#16a34a', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            {buyMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <ShoppingCart size={15} />} Buy
          </button>
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Charged live from Grizzly balance. Cancel (8) refunds if done quickly (wait ~2 min — early cancel is denied).</small>
        </div>
      </div>

      {/* lookup + track any activation (covers numbers bought outside dc_info, e.g. via CLI) */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--card-bg, #1e293b)' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Lookup any activation (even if bought via CLI / MCP)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="activationId e.g. 634953698" style={{ flex: 1, minWidth: 200, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} />
          <button onClick={handleLookup} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }}>Check</button>
          <button onClick={() => handleTrack(lookupId)} disabled={trackMutation.isPending || !lookupId.trim()} style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#0ea5e9', color: '#fff', fontWeight: 700 }}>
            {trackMutation.isPending ? 'Tracking…' : 'Track into my list'}
          </button>
        </div>
        {lookupId.trim() && liveStatus[lookupId.trim()] && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Status: <b>{liveStatus[lookupId.trim()].status}</b> · raw: <code>{liveStatus[lookupId.trim()].raw}</code>
            {parseSmsCode(liveStatus[lookupId.trim()].raw) && <span style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 999, background: '#16a34a', color: '#fff', fontWeight: 800 }}>SMS: {parseSmsCode(liveStatus[lookupId.trim()].raw)}</span>}
          </div>
        )}
        <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Your 2 CLI test numbers: 634953292 (cancelled, +918886660039) · 634953698 (cancelled, +919217726651) — paste either id above, Check, then Track into my list. Quick track:</small>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <button onClick={() => handleTrack('634953292', '918886660039')} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #0ea5e9', background: 'transparent', color: '#0ea5e9', fontSize: 12, cursor: 'pointer' }}>Track 634953292</button>
          <button onClick={() => handleTrack('634953698', '919217726651')} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #0ea5e9', background: 'transparent', color: '#0ea5e9', fontSize: 12, cursor: 'pointer' }}>Track 634953698</button>
        </div>
      </div>

      {/* search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}><Search size={16} style={{ position: 'absolute', left: 8, top: 10, color: '#94a3b8' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search phone, activationId, status" style={{ width: '100%', padding: '8px 8px 8px 28px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)' }} /></div>
        <span style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length}/{orders.length}</span>
      </div>

      {/* orders table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--card-bg, #1e293b)' }}>
        <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
          {ordersLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 className="animate-spin" size={24} /></div> : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #0f172a)', zIndex: 1 }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}></th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Phone</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Activation</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Svc/Country</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>$</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Status / SMS</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Bought</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}><Phone size={18} /> No bought numbers in dc_info DB yet — buy one above. (CLI test numbers live only on Grizzly side; use Lookup.)</td></tr> : filtered.map((o: GrizzlyOrder) => {
                  const live = liveStatus[o.activationId];
                  const raw = live?.raw || o.rawResponse || '';
                  const code = parseSmsCode(raw);
                  const isOpen = !!expanded[o.activationId];
                  return (
                    <>
                      <tr key={o.activationId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px' }}><button onClick={() => setExpanded(p => ({ ...p, [o.activationId]: !p[o.activationId] }))} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></td>
                        <td style={{ padding: '10px 12px', fontWeight: 800, fontFamily: 'monospace' }}>{o.phone || '—'}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{o.activationId}</td>
                        <td style={{ padding: '10px 12px' }}>{o.service}/{o.country}</td>
                        <td style={{ padding: '10px 12px' }}>${o.priceUsed ?? '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: statusColor(live?.status || o.status), color: '#fff' }}>{live?.loading ? '...' : (live?.status || o.status)}</span>
                          {code && <span style={{ marginLeft: 6, padding: '2px 10px', borderRadius: 999, background: '#16a34a', color: '#fff', fontWeight: 800, fontFamily: 'monospace' }}>{code}</span>}
                        </td>
                        <td style={{ padding: '10px 12px' }}><small>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</small></td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button title="Refresh live status + SMS" onClick={() => handleRefreshStatus(o.activationId)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}><RefreshCw size={12} /></button>
                            <button title="Resend SMS (3)" onClick={() => handleSetStatus(o.activationId, '3')} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #0ea5e9', background: 'transparent', color: '#0ea5e9', cursor: 'pointer', fontSize: 11 }}><RotateCcw size={12} />3</button>
                            <button title="Complete (6) — keep charged" onClick={() => handleSetStatus(o.activationId, '6')} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #16a34a', background: 'transparent', color: '#16a34a', cursor: 'pointer', fontSize: 11 }}><CheckCircle size={12} />6</button>
                            <button title="Cancel (8) — refund" onClick={() => handleSetStatus(o.activationId, '8')} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #dc2626', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}><Ban size={12} />8</button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${o.activationId}-full`} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary, #0f172a)' }}>
                          <td></td>
                          <td colSpan={7} style={{ padding: '10px 12px', fontSize: 12 }}>
                            <div><b>Full info:</b> id={o.id} · phone={o.phone} · activation={o.activationId} · service={o.service} · country={o.country} · priceUsed=${o.priceUsed} · status={o.status} · created={o.createdAt} · updated={o.updatedAt}</div>
                            <div style={{ marginTop: 4 }}>live raw: <code style={{ wordBreak: 'break-all' }}>{live?.raw || o.rawResponse || '—'}</code></div>
                            <div>stored raw: <code style={{ wordBreak: 'break-all' }}>{o.rawResponse || '—'}</code></div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
