import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Search, Loader2 } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { outreachApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { useState } from 'react';

export function CampaignHistory() {
  const { t } = useTranslation();
  useDocumentTitle('Campaign History');
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['outreach-history'],
    queryFn: outreachApi.history,
    staleTime: 15_000,
  });
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let out = history;
    if (statusFilter !== 'all') out = out.filter(h => h.status === statusFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      out = out.filter(h => [h.name, h.messageText, h.createdByEmail, h.createdByRole, h.status].some(v => (v||'').toLowerCase().includes(s)));
    }
    return out;
  }, [history, q, statusFilter]);

  const counts = {
    ongoing: history.filter(h => h.status === 'running').length,
    scheduled: history.filter(h => h.status === 'scheduled').length,
    completed: history.filter(h => h.status === 'completed').length,
    failed: history.filter(h => h.status === 'failed' || h.status === 'cancelled').length,
  };

  if (isLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:300}}><Loader2 className="animate-spin" size={28}/></div>;

  return (
    <div className="campaigns-page" style={{padding:16}}>
      <PageHeader title="Campaign History" subtitle={`All campaigns — who ran them, what was sent, and status (light)`} />
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
        <span style={{padding:'6px 10px',borderRadius:999,background:'#f59e0b',color:'#fff',fontSize:12}}>Ongoing {counts.ongoing}</span>
        <span style={{padding:'6px 10px',borderRadius:999,background:'#64748b',color:'#fff',fontSize:12}}>Scheduled {counts.scheduled}</span>
        <span style={{padding:'6px 10px',borderRadius:999,background:'#22c55e',color:'#fff',fontSize:12}}>Completed {counts.completed}</span>
        <span style={{padding:'6px 10px',borderRadius:999,background:'#ef4444',color:'#fff',fontSize:12}}>Failed/Cancelled {counts.failed}</span>
        <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>{filtered.length}/{history.length}</span>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <div style={{position:'relative',flex:1}}><Search size={16} style={{position:'absolute',left:8,top:10, color:'#94a3b8'}}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, content, creator, role" style={{width:'100%', padding:'8px 8px 8px 28px', border:'1px solid var(--border)', borderRadius:8}} /></div>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8}}>
          <option value="all">All status</option>
          <option value="running">Ongoing</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div style={{border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', background:'var(--card-bg, #1e293b)'}}>
        <div style={{maxHeight:'70vh', overflow:'auto'}}>
          <table style={{width:'100%', fontSize:13, borderCollapse:'collapse', background:'var(--card-bg, #1e293b)'}}>
            <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
              <tr>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Campaign</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Content</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Who</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Status</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Contacts</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? <tr><td colSpan={6} style={{padding:20, textAlign:'center', color:'var(--text-muted)'}}><History size={18}/> No history</td></tr> : filtered.map(h=> (
                <tr key={h.id} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600}}>{h.name}</div><small style={{color:'var(--text-muted)'}}>{h.messageType}</small></td>
                  <td style={{padding:'10px 12px', maxWidth:260}}><div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={h.messageText}>{h.messageText}</div></td>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600, textTransform:'capitalize'}}>{h.createdByRole || 'unknown'}</div><small style={{color:'var(--text-muted)', wordBreak:'break-all'}}>{h.createdByEmail || '—'}</small></td>
                  <td style={{padding:'10px 12px'}}><span style={{padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background: h.status==='running' ? '#f59e0b' : h.status==='completed' ? '#22c55e' : h.status==='scheduled' ? '#64748b' : '#ef4444', color:'#fff'}}>{h.status}</span></td>
                  <td style={{padding:'10px 12px'}}>{h.contactCount}</td>
                  <td style={{padding:'10px 12px'}}><small>{h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
