import { useMemo, useState } from 'react';
import { History, Search, Loader2, FileText } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { useSessionsQuery } from '../hooks/queries';
import { templateApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';

export function TemplateHistory() {
  const { data: sessions = [] } = useSessionsQuery();
  const firstSessionId = sessions[0]?.id || '';
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['template-history', firstSessionId],
    queryFn: async () => {
      if (!firstSessionId) return [];
      try {
        const res = await templateApi.history(firstSessionId);
        return res as any[];
      } catch {
        // fallback: fetch per session and aggregate
        const results = await Promise.all(sessions.map(s => templateApi.list(s.id).catch(() => [])));
        const flat = results.flat();
        return flat.map((t: any) => ({ id: t.id, name: t.name, body: (t.body||'').slice(0,120), mediaType: t.mediaType||'text', createdByEmail: t.createdByEmail||null, createdByRole: t.createdByRole||null, sessionId: t.sessionId, createdAt: t.createdAt }));
      }
    },
    enabled: !!firstSessionId,
    staleTime: 15_000,
  });
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return history;
    const s = q.toLowerCase();
    return history.filter(h => [h.name, h.body, h.createdByEmail, h.createdByRole, h.mediaType].some(v => (v||'').toLowerCase().includes(s)));
  }, [history, q]);

  if (!firstSessionId) return <div style={{padding:20, color:'var(--text-muted)'}}>No sessions — create a session first</div>;
  if (isLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:300}}><Loader2 className="animate-spin" size={28}/></div>;

  return (
    <div className="campaigns-page" style={{padding:16}}>
      <PageHeader title="Template History" subtitle="All templates — who created them, content and type (light)" />
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <div style={{position:'relative',flex:1}}><Search size={16} style={{position:'absolute',left:8,top:10, color:'#94a3b8'}}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, content, creator, role" style={{width:'100%', padding:'8px 8px 8px 28px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-secondary, #0f172a)', color:'var(--text, #e2e8f0)'}} /></div>
        <span style={{padding:'8px 12px', fontSize:12, color:'var(--text-muted)'}}>{filtered.length}/{history.length}</span>
      </div>
      <div style={{border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', background:'var(--card-bg, #1e293b)'}}>
        <div style={{maxHeight:'70vh', overflow:'auto'}}>
          <table style={{width:'100%', fontSize:13, borderCollapse:'collapse', background:'var(--card-bg, #1e293b)'}}>
            <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
              <tr>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Template</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Content</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Type</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Who</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? <tr><td colSpan={5} style={{padding:20, textAlign:'center', color:'var(--text-muted)'}}><History size={18}/> No history</td></tr> : filtered.map(h=> (
                <tr key={h.id} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600, display:'flex', alignItems:'center', gap:6}}><FileText size={14}/>{h.name}</div><small style={{color:'var(--text-muted)'}}>{h.sessionId?.slice(0,8)}</small></td>
                  <td style={{padding:'10px 12px', maxWidth:260}}><div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={h.body}>{h.body}</div></td>
                  <td style={{padding:'10px 12px'}}><span style={{padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background: h.mediaType==='image' ? '#22c55e' : h.mediaType==='document' ? '#0ea5e9' : '#64748b', color:'#fff'}}>{h.mediaType||'text'}</span></td>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600, textTransform:'capitalize'}}>{h.createdByRole || 'unknown'}</div><small style={{color:'var(--text-muted)', wordBreak:'break-all'}}>{h.createdByEmail || '—'}</small></td>
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
