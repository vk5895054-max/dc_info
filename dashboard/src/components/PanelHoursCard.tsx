import { useState, useEffect } from 'react';
import { Clock, Save, Loader2, Check, X, Coins } from 'lucide-react';
import { panelApi, apiKeyApi } from '../services/api';
import { useToast } from '../hooks/useToast';

export function PanelHoursCard() {
  const toast = useToast();
  const [hours, setHours] = useState<{ enabled: boolean; startHour: number; endHour: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [start, setStart] = useState(10);
  const [end, setEnd] = useState(18);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    panelApi.getHours().then(h => {
      setHours(h);
      setStart(h.startHour);
      setEnd(h.endHour);
      setEnabled(h.enabled);
    }).catch(()=>{});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await panelApi.setHours({ enabled, startHour: start, endHour: end });
      setHours(res);
      toast.success(enabled ? `Panel active ${start}:00 - ${end}:00 for reseller/user` : 'Panel time restriction disabled');
    } catch (e:any) { toast.error('Save failed', e.message); }
    finally { setSaving(false); }
  };

  const [requests, setRequests] = useState<any[]>([]);
  const [loadingReq, setLoadingReq] = useState(false);
  const [creditMap, setCreditMap] = useState<Record<string,string>>({});

  const loadRequests = async () => {
    setLoadingReq(true);
    try {
      const res = await panelApi.listRequests();
      setRequests(res);
    } catch {} finally { setLoadingReq(false); }
  };
  useEffect(()=>{ loadRequests(); }, []);

  const approve = async (id:string, hours:number) => {
    try { await panelApi.updateRequest(id, { status:'approved', grantedHours:hours }); toast.success('Access granted'); loadRequests(); } catch(e:any){ toast.error('Failed', e.message); }
  };
  const reject = async (id:string) => {
    try { await panelApi.updateRequest(id, { status:'rejected' }); toast.success('Rejected'); loadRequests(); } catch(e:any){ toast.error('Failed', e.message); }
  };
  const fetchCredit = async (email:string, id:string) => {
    try {
      // find reseller user by email via auth/reseller/list then get credit history
      const res = await fetch('/api/auth/reseller/list', { headers: { 'X-API-Key': sessionStorage.getItem('openwa_api_key')||'', 'X-Admin-Email': sessionStorage.getItem('openwa_admin_email')||'' } });
      const list = await res.json().catch(()=>[]);
      const user = (Array.isArray(list)? list: []).find((u:any)=> u.email?.toLowerCase()===email.toLowerCase());
      if (!user?.apiKeyId) { setCreditMap(m=>({...m,[id]:'No credit data'})); return; }
      const hist = await apiKeyApi.getCreditHistory(user.apiKeyId);
      const summary = hist.slice(0,3).map((h:any)=> `${h.messageType}:${h.units}`).join(', ') || 'No history';
      const bal = user.credits != null ? `${user.creditsUsed||0}/${user.credits} remaining ${Math.max(0,(user.credits||0)-(user.creditsUsed||0))}` : 'unlimited';
      setCreditMap(m=>({...m,[id]: `${bal} | recent: ${summary}`}));
    } catch { setCreditMap(m=>({...m,[id]:'Failed to load credit history'})); }
  };

  if (!hours) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-white)', marginBottom: 16 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 10 }}>
        <Clock size={18} /> <strong>Panel Access Hours</strong> <span style={{ fontSize:12, color:'var(--text-muted)' }}>(admin/super_admin only)</span>
      </div>
      <p style={{ fontSize:13, color:'var(--text-secondary)', margin:'0 0 12px' }}>
        When enabled, <b>reseller</b> and <b>user</b> can use the panel only between the set hours. Outside hours they see highlighted notice (not blocked) and can request access.
      </p>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, fontWeight:600 }}>
          <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> Enable 10am-6pm lock
        </label>
        <span style={{ display:'flex', alignItems:'center', gap:6, opacity: enabled?1:0.5 }}>
          <span style={{ fontSize:13 }}>From</span>
          <select value={start} onChange={e=>setStart(Number(e.target.value))} disabled={!enabled} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--border)' }}>
            {Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}:00</option>)}
          </select>
          <span style={{ fontSize:13 }}>to</span>
          <select value={end} onChange={e=>setEnd(Number(e.target.value))} disabled={!enabled} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--border)' }}>
            {Array.from({length:25},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}:00</option>)}
          </select>
        </span>
        <button className="btn-primary" onClick={save} disabled={saving} style={{ marginLeft:'auto' }}>
          {saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} Save
        </button>
      </div>
      <small style={{ color:'var(--text-muted)', display:'block', marginTop:8 }}>Timezone: Asia/Kolkata (IST). Example: 10-18 = 10am-6pm. Highlighted banner shown outside hours, not force stop.</small>

      <div style={{ marginTop:16, borderTop:'1px solid var(--border)', paddingTop:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <strong style={{ fontSize:13 }}>Access Requests (pick username + credit history + time of usage)</strong>
          <button onClick={loadRequests} style={{ padding:'5px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-white)', cursor:'pointer', fontSize:12 }}>Refresh</button>
        </div>
        {loadingReq ? <div style={{ padding:12, textAlign:'center' }}><Loader2 size={16} className="animate-spin"/></div> : requests.length===0 ? <div style={{ fontSize:12, color:'var(--text-muted)', padding:8 }}>No requests yet. Reseller/user outside hours will see “Request access” on the banner.</div> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:300, overflowY:'auto' }}>
            {requests.map((r:any)=> (
              <div key={r.id} style={{ border:'1px solid var(--border)', borderRadius:8, padding:10, background: r.status==='pending'?'#fffbeb': r.status==='approved'?'#ecfdf5':'#fef2f2' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:600, fontSize:13 }}>{r.email} <small style={{ color:'var(--text-muted)' }}>({r.role})</small></span>
                  <span style={{ fontSize:11, padding:'2px 7px', borderRadius:999, background: r.status==='pending'?'#f59e0b': r.status==='approved'?'#22c55e':'#ef4444', color:'#fff', textTransform:'uppercase' }}>{r.status}</span>
                </div>
                <div style={{ fontSize:12, marginTop:4 }}><b>Time of usage:</b> {r.requestedHours} {r.reason? `· ${r.reason}`:''}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)' }}>Requested: {new Date(r.createdAt).toLocaleString()} {r.grantedUntil? `· granted until ${new Date(r.grantedUntil).toLocaleString()}`:''}</div>
                <div style={{ fontSize:11, marginTop:6, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                  <button onClick={()=> fetchCredit(r.email, r.id)} style={{ padding:'4px 8px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-white)', cursor:'pointer', display:'flex', alignItems:'center', gap:4, fontSize:11 }}><Coins size={12}/> View credit history</button>
                  {creditMap[r.id] && <span style={{ color:'var(--text-secondary)' }}>{creditMap[r.id]}</span>}
                </div>
                {r.status==='pending' && (
                  <div style={{ display:'flex', gap:6, marginTop:8 }}>
                    <button onClick={()=> approve(r.id, 4)} style={{ padding:'6px 10px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}><Check size={14}/> Approve 4h</button>
                    <button onClick={()=> approve(r.id, 8)} style={{ padding:'6px 10px', borderRadius:6, border:'none', background:'#16a34a', color:'#fff', fontWeight:600, cursor:'pointer' }}>Approve 8h</button>
                    <button onClick={()=> reject(r.id)} style={{ padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'#fff', color:'#ef4444', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}><X size={14}/> Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
