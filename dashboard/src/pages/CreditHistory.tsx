import { useEffect, useMemo, useState } from 'react';
import { Coins, History, Search, Loader2, ArrowUpCircle, ArrowDownCircle, Activity } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useApiKeysQuery, useCreditHistoryQuery } from '../hooks/queries';
import { useRole } from '../hooks/useRole';
import { PageHeader } from '../components/PageHeader';

export function CreditHistory() {
  useDocumentTitle('Credit History');
  const { role: userRole } = useRole();
  const { data: apiKeys = [], isLoading: keysLoading } = useApiKeysQuery();
  const [selectedId, setSelectedId] = useState<string>('');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // auto-select for user/demo (they only have own key in list)
  useEffect(() => {
    if (!selectedId && apiKeys.length > 0) setSelectedId(apiKeys[0].id);
  }, [apiKeys, selectedId]);

  const selectedKey = useMemo(() => (apiKeys as any[]).find(k => k.id === selectedId), [apiKeys, selectedId]);
  const { data: history = [], isLoading: histLoading } = useCreditHistoryQuery(selectedId, Boolean(selectedId));

  const filtered = useMemo(() => {
    let out = history as any[];
    if (typeFilter !== 'all') out = out.filter(h => h.messageType === typeFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      out = out.filter(h => [h.messageType, h.reference, String(h.units), String(h.balanceAfter)].some(v => (v || '').toString().toLowerCase().includes(s)));
    }
    return out;
  }, [history, q, typeFilter]);

  const stats = useMemo(() => {
    const adds = (history as any[]).filter(h => h.messageType === 'credit_add').reduce((a, h) => a + (h.units || 0), 0);
    const allocs = (history as any[]).filter(h => h.messageType === 'credit_allocate').reduce((a, h) => a + Math.abs(h.units || 0), 0);
    const deducts = (history as any[]).filter(h => h.messageType === 'credit_deduct').reduce((a, h) => a + Math.abs(h.units || 0), 0);
    const usage = (history as any[]).filter(h => !['credit_add','credit_allocate','credit_deduct'].includes(h.messageType)).reduce((a, h) => a + Math.abs(h.units || 0), 0);
    return { adds, allocs, deducts, usage };
  }, [history]);

  if (keysLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:300}}><Loader2 className="animate-spin" size={28}/></div>;

  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const isReseller = userRole === 'reseller';

  return (
    <div style={{padding:16}}>
      <PageHeader title="Credit History" subtitle={isAdmin ? 'Admin: superadmin → reseller & reseller → user allocations, deductions and per-message usage' : isReseller ? 'Reseller: your credits, allocations to users you created, and usage' : 'Your credits: allocations you received, deductions and per-message usage'} />
      {/* selector */}
      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:12, alignItems:'end'}}>
        <div style={{minWidth:260, flex:1, maxWidth:420}}>
          <label style={{fontSize:12, fontWeight:600, color:'var(--text-muted)'}}>{isAdmin || isReseller ? 'Select user / reseller' : 'Your account'}</label>
          <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-secondary, #0f172a)', color:'var(--text, #e2e8f0)'}}>
            {(apiKeys as any[]).map(k => <option key={k.id} value={k.id}>{k.name} — {k.role} — {k.creditsUsed||0}/{k.credits??'∞'} ({k.credits!=null? (k.credits-(k.creditsUsed||0))+' left':'unlimited'})</option>)}
          </select>
        </div>
        {selectedKey && (
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            <span style={{padding:'6px 10px', borderRadius:999, background:'#7c3aed', color:'#fff', fontSize:12, display:'flex', alignItems:'center', gap:6}}><Coins size={14}/>{selectedKey.creditsUsed||0}/{selectedKey.credits??'∞'} used · {selectedKey.credits!=null? Math.max(0, selectedKey.credits-(selectedKey.creditsUsed||0))+' left':'unlimited'}</span>
            <span style={{padding:'6px 10px', borderRadius:999, background:'#0ea5e9', color:'#fff', fontSize:12}}>Credit cost: {selectedKey.creditCost ? JSON.stringify(selectedKey.creditCost) : 'default 1/2'}</span>
          </div>
        )}
      </div>

      {/* summary cards */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10, marginBottom:12}}>
        <div style={{border:'1px solid #16a34a', borderRadius:10, padding:10, background:'var(--card-bg, #1e293b)'}}><div style={{fontSize:11, color:'#16a34a', display:'flex', alignItems:'center', gap:6, fontWeight:700}}><ArrowUpCircle size={14}/> Credit Adds (own raise)</div><div style={{fontWeight:800, fontSize:18}}>+{stats.adds}</div><small style={{color:'var(--text-muted)', fontSize:11}}>Admin / system allocations to this account</small></div>
        <div style={{border:'1px solid #7c3aed', borderRadius:10, padding:10, background:'var(--card-bg, #1e293b)'}}><div style={{fontSize:11, color:'#7c3aed', display:'flex', alignItems:'center', gap:6, fontWeight:700}}><ArrowDownCircle size={14}/> Allocated Out</div><div style={{fontWeight:800, fontSize:18}}>-{stats.allocs}</div><small style={{color:'var(--text-muted)', fontSize:11}}>Reseller → user transfers (parent deduction)</small></div>
        <div style={{border:'1px solid #dc2626', borderRadius:10, padding:10, background:'var(--card-bg, #1e293b)'}}><div style={{fontSize:11, color:'#dc2626', display:'flex', alignItems:'center', gap:6, fontWeight:700}}><ArrowDownCircle size={14}/> Deducted / Returned</div><div style={{fontWeight:800, fontSize:18}}>-{stats.deducts}</div><small style={{color:'var(--text-muted)', fontSize:11}}>Reseller deducts from users back to self</small></div>
        <div style={{border:'1px solid #0ea5e9', borderRadius:10, padding:10, background:'var(--card-bg, #1e293b)'}}><div style={{fontSize:11, color:'#0ea5e9', display:'flex', alignItems:'center', gap:6, fontWeight:700}}><Activity size={14}/> Usage</div><div style={{fontWeight:800, fontSize:18}}>{stats.usage}</div><small style={{color:'var(--text-muted)', fontSize:11}}>Per-message consumption (text/image/doc/video)</small></div>
      </div>

      <div style={{display:'flex', gap:8, marginBottom:12}}>
        <div style={{position:'relative', flex:1}}><Search size={16} style={{position:'absolute',left:8,top:10, color:'#94a3b8'}}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search type, reference, units" style={{width:'100%', padding:'8px 8px 8px 28px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-secondary, #0f172a)', color:'var(--text, #e2e8f0)'}} /></div>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-secondary, #0f172a)', color:'var(--text, #e2e8f0)'}}>
          <option value="all">All types</option>
          <option value="credit_add">credit_add (raise)</option>
          <option value="credit_allocate">credit_allocate (reseller→user)</option>
          <option value="credit_deduct">credit_deduct</option>
          <option value="text">text</option>
          <option value="image">image</option>
          <option value="document">document</option>
          <option value="video">video</option>
        </select>
        <span style={{padding:'8px 12px', fontSize:12, color:'var(--text-muted)'}}>{filtered.length}/{history.length}</span>
      </div>

      <div style={{border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', background:'var(--card-bg, #1e293b)'}}>
        <div style={{maxHeight:'65vh', overflow:'auto'}}>
          {histLoading ? <div style={{display:'flex',justifyContent:'center',padding:30}}><Loader2 className="animate-spin" size={24}/></div> : (
          <table style={{width:'100%', fontSize:13, borderCollapse:'collapse', background:'var(--card-bg, #1e293b)'}}>
            <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
              <tr>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Type</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Units</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Balance After</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Reference</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? <tr><td colSpan={5} style={{padding:20, textAlign:'center', color:'var(--text-muted)'}}><History size={18}/> No history yet — allocations and usage will appear here</td></tr> : filtered.map((h:any)=> {
                const isAdd = h.messageType==='credit_add';
                const isAlloc = h.messageType==='credit_allocate';
                const isDeduct = h.messageType==='credit_deduct';
                const color = isAdd ? '#16a34a' : isAlloc ? '#7c3aed' : isDeduct ? '#dc2626' : '#0ea5e9';
                const sign = h.units>0? `+${h.units}`: `${h.units}`;
                return (
                  <tr key={h.id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'10px 12px'}}><span style={{padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background: color, color:'#fff', textTransform:'uppercase'}}>{h.messageType}</span></td>
                    <td style={{padding:'10px 12px', fontWeight:700, color}}>{sign}</td>
                    <td style={{padding:'10px 12px'}}>{h.balanceAfter} left</td>
                    <td style={{padding:'10px 12px', maxWidth:260, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={h.reference||''}>{h.reference || '—'}</td>
                    <td style={{padding:'10px 12px'}}><small>{h.createdAt? new Date(h.createdAt).toLocaleString():'—'}</small></td>
                  </tr>
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
