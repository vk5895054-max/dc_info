import { useEffect, useState } from 'react';
import { Clock, Send } from 'lucide-react';
import { panelApi } from '../services/api';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

export function PanelGate({ children }: { children: React.ReactNode }) {
  const { role } = useRole();
  const toast = useToast();
  const isRestricted = role === 'reseller' || role === 'user' || role === 'demo';
  const [blocked, setBlocked] = useState(false);
  const [hours, setHours] = useState<{ startHour:number; endHour:number } | null>(null);
  const [showReq, setShowReq] = useState(false);
  const [reqHours, setReqHours] = useState('19:00-22:00');
  const [reqReason, setReqReason] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isRestricted) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await panelApi.check();
        if (!alive) return;
        setBlocked(!!res.blocked);
        setHours({ startHour: res.startHour, endHour: res.endHour });
      } catch {
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset()*60000;
        const ist = new Date(utc + 5.5*3600000);
        const h = ist.getHours();
        setBlocked(h < 10 || h >= 18);
        setHours({ startHour: 10, endHour: 18 });
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [isRestricted, role]);

  const s = String(hours?.startHour ?? 10).padStart(2,'0');
  const e = String(hours?.endHour ?? 18).padStart(2,'0');

  const submitRequest = async () => {
    if (!reqHours.trim()) { toast.error('Enter time of usage e.g. 19:00-22:00'); return; }
    setSending(true);
    try {
      await panelApi.createRequest({ requestedHours: reqHours.trim(), reason: reqReason.trim() || undefined });
      toast.success('Request sent to admin');
      setShowReq(false);
      setReqReason('');
    } catch (err:any) { toast.error('Request failed', err.message); }
    finally { setSending(false); }
  };

  return (
    <>
      {blocked && (
        <div style={{ background:'linear-gradient(90deg,#f59e0b,#f97316)',width: '100%', color:'#fff', padding:'10px 16px', display:'flex', alignItems:'center', gap:10, justifyContent:'center', fontWeight:600, fontSize:13, position:'absolute', top:0, zIndex:1000, boxShadow:'0 2px 8px rgba(0,0,0,0.15)', flexWrap:'wrap' }}>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}><Clock size={16} /> Panel will be available {s}:00 – {e}:00 IST — currently outside window (you can still use panel)</span>
          <button onClick={()=> setShowReq(true)} style={{ marginLeft:8, background:'#fff', color:'#f97316', border:'none', borderRadius:999, padding:'5px 12px', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}><Send size={14}/> Request access</button>
        </div>
      )}
      {showReq && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60, padding:16 }} onClick={()=> setShowReq(false)}>
          <div style={{ background:'var(--bg-white)', borderRadius:12, padding:20, width:420, maxWidth:'100%' }} onClick={e=> e.stopPropagation()}>
            <h3 style={{ margin:'0 0 8px', display:'flex', alignItems:'center', gap:8 }}><Clock size={16}/> Request panel access</h3>
            <p style={{ fontSize:12, color:'var(--text-muted)', margin:'0 0 10px' }}>Pick your username is auto-filled from login, add time of usage (e.g. 19:00-22:00 or 7pm-10pm). Admin will see your credit history and time.</p>
            <label style={{ display:'block', fontSize:12, fontWeight:600, marginBottom:4 }}>Time of usage</label>
            <input value={reqHours} onChange={e=> setReqHours(e.target.value)} placeholder="19:00-22:00" style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, marginBottom:10 }} />
            <label style={{ display:'block', fontSize:12, fontWeight:600, marginBottom:4 }}>Reason (optional)</label>
            <input value={reqReason} onChange={e=> setReqReason(e.target.value)} placeholder="Need to send campaign after hours" style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, marginBottom:12 }} />
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={()=> setShowReq(false)} style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-white)', cursor:'pointer' }}>Cancel</button>
              <button onClick={submitRequest} disabled={sending} style={{ padding:'8px 14px', borderRadius:8, border:'none', background:'#7c3aed', color:'#fff', fontWeight:600, cursor:'pointer' }}>{sending?'Sending...':'Send request'}</button>
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
