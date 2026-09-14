import { useMemo, useState } from 'react';
import { History, Search, Loader2, Download, FileSpreadsheet, Eye, X, MessageCircle, Send } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { outreachApi, messageApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { useRole } from '../hooks/useRole';
import { Modal } from '../components/Modal';
import { useToast } from '../hooks/useToast';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadBlob(content: string | Blob, mime: string, filename: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toExcelHtml(headers: string[], rows: string[][]): string {
  const head = headers.map(h => `<th style="background:#0f172a;color:#fff;padding:6px;border:1px solid #334155">${h}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px;border:1px solid #cbd5e1">${String(c ?? '').replace(/</g,'&lt;')}</td>`).join('')}</tr>`).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><style>table{border-collapse:collapse}th,td{font-family:Arial,sans-serif;font-size:11px}</style></head><body><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export function CampaignHistory() {
  useDocumentTitle('Campaign History');
  const { role } = useRole();
  const toast = useToast();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['outreach-history'],
    queryFn: outreachApi.history,
    staleTime: 15_000,
  });
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportSearch, setReportSearch] = useState('');
  const [reportStatus, setReportStatus] = useState<string>('all');
  const [reportTab, setReportTab] = useState<'delivery' | 'replies'>('delivery');
  const [replySessionFilter, setReplySessionFilter] = useState<string>('all');
  const [replyInterestFilter, setReplyInterestFilter] = useState<string>('all');
  const [replySearch, setReplySearch] = useState('');
  const [composer, setComposer] = useState<{ chatId: string; sessionId: string; phone: string } | null>(null);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);

  const filtered = useMemo(() => {
    let out = history as any[];
    if (statusFilter !== 'all') out = out.filter((h: any) => h.status === statusFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      out = out.filter((h: any) => [h.name, h.messageText, h.createdByEmail, h.createdByRole, h.status].some((v: any) => (v||'').toLowerCase().includes(s)));
    }
    return out;
  }, [history, q, statusFilter]);

  const counts = {
    ongoing: (history as any[]).filter((h: any) => h.status === 'running').length,
    scheduled: (history as any[]).filter((h: any) => h.status === 'scheduled').length,
    completed: (history as any[]).filter((h: any) => h.status === 'completed').length,
    failed: (history as any[]).filter((h: any) => h.status === 'failed' || h.status === 'cancelled').length,
  };

  // history-level exports (admin only)
  const exportHistoryCsv = () => {
    const headers = ['Campaign','Message','Type','Status','Contacts','CreatedBy Email','CreatedBy Role','CreatedAt','StartedAt','CompletedAt','TotalCredits'];
    const rows = filtered.map(h => [
      csvEscape(h.name),
      csvEscape((h.messageText||'').slice(0,200)),
      csvEscape((h as any).messageType||'text'),
      csvEscape(h.status),
      csvEscape(h.contactCount),
      csvEscape(h.createdByEmail||''),
      csvEscape(h.createdByRole||''),
      csvEscape(h.createdAt||''),
      csvEscape(h.startedAt||''),
      csvEscape(h.completedAt||''),
      csvEscape((h as any).totalCredits ?? ''),
    ]);
    const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8', `campaign-history-${new Date().toISOString().slice(0,10)}.csv`);
  };

  const exportHistoryExcel = () => {
    const headers = ['Campaign','Message','Type','Status','Contacts','CreatedBy Email','CreatedBy Role','CreatedAt','StartedAt','CompletedAt','TotalCredits'];
    const rows = filtered.map(h => [
      h.name,
      (h.messageText||'').slice(0,200),
      (h as any).messageType||'text',
      h.status,
      String(h.contactCount),
      h.createdByEmail||'',
      h.createdByRole||'',
      h.createdAt||'',
      h.startedAt||'',
      h.completedAt||'',
      String((h as any).totalCredits ?? ''),
    ]);
    const html = toExcelHtml(headers, rows);
    downloadBlob(html, 'application/vnd.ms-excel', `campaign-history-${new Date().toISOString().slice(0,10)}.xls`);
  };

  // per-campaign delivery report
  const { data: exec, isLoading: execLoading } = useQuery({
    queryKey: ['outreach', reportId, 'execution', 'full'],
    queryFn: () => outreachApi.execution(reportId!, true),
    enabled: Boolean(reportId) && reportTab==='delivery',
    staleTime: 15_000,
  });

  // campaign replies (session-wise + interest)
  const { data: repliesData, isLoading: repliesLoading } = useQuery({
    queryKey: ['outreach', reportId, 'replies'],
    queryFn: () => outreachApi.replies(reportId!),
    enabled: Boolean(reportId) && reportTab==='replies',
    staleTime: 15_000,
  });

  const isNoMessageDeliveredError = (msg?: string) => !!msg && msg.toLowerCase().includes('the engine returned no message');

  const reportRows = useMemo(() => {
    if (!exec) return [] as Array<{phone:string; name?:string; session:string; status:string; errorCode?:string; errorMessage?:string; sentAt?:string}>;
    const out: Array<{phone:string; name?:string; session:string; status:string; errorCode?:string; errorMessage?:string; sentAt?:string}> = [];
    const burstReport: any[] = (exec as any).burstReport ?? (exec as any).burstProgress ?? [];
    if (burstReport.length > 0) {
      for (const bp of burstReport) {
        const resultsByPhone = new Map((bp.results ?? []).map((r:any)=> [r.phone ?? r.chatId?.replace(/@.*/,'') ?? '', r]));
        for (const c of (bp.contacts ?? [])) {
          const r = resultsByPhone.get(c.phone);
          let status = 'pending';
          let errCode: string | undefined;
          let errMsg: string | undefined;
          let sentAt: string | undefined;
          if (r) {
            const blocked = (r as any).blocked;
            if (blocked) status = 'blocked';
            else status = ((r as any).status || '').toLowerCase();
            errCode = (r as any).errorCode;
            errMsg = (r as any).errorMessage;
            sentAt = (r as any).sentAt;
            if (status === 'failed' && blocked) status = 'blocked';
            if (status === 'failed' && isNoMessageDeliveredError(errMsg)) status = 'sent';
          } else if (bp.status === 'completed' || bp.status === 'failed') {
            status = 'pending';
          }
          out.push({ phone: c.phone, name: c.name, session: bp.sessionName ?? bp.sessionId, status, errorCode: errCode, errorMessage: errMsg, sentAt });
        }
        for (const r of (bp.results ?? [])) {
          if (!bp.contacts?.some((c:any)=> (c as any).phone===(r as any).phone)) {
            const blocked = (r as any).blocked;
            let s: any = blocked ? 'blocked' : ((r as any).status||'').toLowerCase();
            if (s === 'failed' && isNoMessageDeliveredError((r as any).errorMessage)) s = 'sent';
            out.push({ phone: (r as any).phone, name: (r as any).name, session: bp.sessionName ?? bp.sessionId, status: s, errorCode: (r as any).errorCode, errorMessage: (r as any).errorMessage, sentAt: (r as any).sentAt });
          }
        }
      }
    }
    if (out.length===0 && (exec as any).batches?.length) {
      for (const b of (exec as any).batches) {
        for (const r of (b.recipients ?? [])) {
          const blocked = (r as any).blocked;
          let s: any = blocked ? 'blocked' : (r.status||'').toLowerCase();
          const em = (r as any).errorMessage ?? (r as any).error;
          if (s === 'failed' && isNoMessageDeliveredError(em)) s = 'sent';
          out.push({ phone: r.phone ?? r.chatId?.replace(/@.*/,'') ?? r.chatId, name: undefined, session: b.sessionName, status: s, errorCode: (r as any).errorCode ?? (r as any).error, errorMessage: em, sentAt: (r as any).sentAt });
        }
      }
    }
    return out;
  }, [exec]);

  const filteredReport = useMemo(() => {
    let out = reportRows;
    if (reportStatus !== 'all') out = out.filter(r => r.status === reportStatus);
    if (reportSearch.trim()) {
      const s = reportSearch.toLowerCase();
      out = out.filter(r => [r.phone, r.name, r.session, r.status, r.errorCode, r.errorMessage].some(v=> (v||'').toLowerCase().includes(s)));
    }
    return out;
  }, [reportRows, reportSearch, reportStatus]);

  const reportCounts = useMemo(() => {
    const sent = reportRows.filter(r => r.status==='sent').length;
    const failed = reportRows.filter(r => r.status==='failed').length;
    const blocked = reportRows.filter(r => r.status==='blocked').length;
    const pending = reportRows.filter(r => r.status==='pending').length;
    return { sent, failed, blocked, pending, total: reportRows.length };
  }, [reportRows]);

  const exportReportCsv = () => {
    if (!exec) return;
    const headers = ['Campaign','Session','Phone','Name','Status','ErrorCode','ErrorMessage','SentAt'];
    const rows = filteredReport.map(r => [
      csvEscape((exec as any).campaignName || (history.find(h=>h.id===reportId)?.name || reportId)),
      csvEscape(r.session),
      csvEscape(r.phone),
      csvEscape(r.name||''),
      csvEscape(r.status),
      csvEscape(r.errorCode||''),
      csvEscape(r.errorMessage||''),
      csvEscape(r.sentAt||''),
    ]);
    const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
    const campName = (exec as any).campaignName?.replace(/[^a-z0-9_-]/gi,'_') || reportId;
    downloadBlob('\uFEFF'+csv,'text/csv;charset=utf-8',`campaign-report-${campName}-${new Date().toISOString().slice(0,10)}.csv`);
  };
  const exportReportExcel = () => {
    if (!exec) return;
    const headers = ['Campaign','Session','Phone','Name','Status','ErrorCode','ErrorMessage','SentAt'];
    const campName = (exec as any).campaignName || (history.find(h=>h.id===reportId)?.name || reportId) as string;
    const rows = filteredReport.map(r => [campName, r.session, r.phone, r.name||'', r.status, r.errorCode||'', r.errorMessage||'', r.sentAt||'']);
    const html = toExcelHtml(headers, rows);
    downloadBlob(html,'application/vnd.ms-excel',`campaign-report-${campName.replace(/[^a-z0-9_-]/gi,'_')}-${new Date().toISOString().slice(0,10)}.xls`);
  };

  // replies filtering
  const filteredReplies = useMemo(() => {
    if (!repliesData) return [] as any[];
    let out = repliesData.replies as any[];
    if (replySessionFilter !== 'all') out = out.filter((r:any)=> r.sessionName===replySessionFilter || r.sessionId===replySessionFilter);
    if (replyInterestFilter !== 'all') out = out.filter((r:any)=> r.interest===replyInterestFilter);
    if (replySearch.trim()) {
      const s = replySearch.toLowerCase();
      out = out.filter((r:any)=> [r.phone, r.name, r.sessionName, r.body, r.interest].some((v:any)=> (v||'').toString().toLowerCase().includes(s)));
    }
    return out;
  }, [repliesData, replySessionFilter, replyInterestFilter, replySearch]);

  const exportRepliesCsv = () => {
    if (!repliesData) return;
    const headers = ['Campaign','Session','Phone','Name','Interest','Message','CreatedAt'];
    const rows = filteredReplies.map((r:any)=> [
      csvEscape(repliesData.campaignName),
      csvEscape(r.sessionName),
      csvEscape(r.phone),
      csvEscape(r.name||''),
      csvEscape(r.interest),
      csvEscape(r.body||''),
      csvEscape(r.createdAt||''),
    ]);
    const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
    downloadBlob('\uFEFF'+csv,'text/csv;charset=utf-8',`campaign-replies-${repliesData.campaignName.replace(/[^a-z0-9_-]/gi,'_')}-${new Date().toISOString().slice(0,10)}.csv`);
  };
  const exportRepliesExcel = () => {
    if (!repliesData) return;
    const headers = ['Campaign','Session','Phone','Name','Interest','Message','CreatedAt'];
    const rows = filteredReplies.map((r:any)=> [repliesData.campaignName, r.sessionName, r.phone, r.name||'', r.interest, r.body||'', r.createdAt||'']);
    const html = toExcelHtml(headers, rows);
    downloadBlob(html,'application/vnd.ms-excel',`campaign-replies-${repliesData.campaignName.replace(/[^a-z0-9_-]/gi,'_')}-${new Date().toISOString().slice(0,10)}.xls`);
  };

  const handleDirectSend = async () => {
    if (!composer || !composerText.trim()) return;
    setSending(true);
    try {
      await messageApi.sendText(composer.sessionId, composer.chatId, composerText.trim());
      toast.success('Message sent');
      setComposer(null);
      setComposerText('');
    } catch (e:any) {
      toast.error('Send failed', e.message);
    } finally { setSending(false); }
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

      {isAdmin && (
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <button onClick={exportHistoryCsv} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #16a34a',background:'#16a34a',color:'#fff',fontWeight:600,cursor:'pointer'}}><Download size={16}/> Download CSV</button>
          <button onClick={exportHistoryExcel} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #0ea5e9',background:'#0ea5e9',color:'#fff',fontWeight:600,cursor:'pointer'}}><FileSpreadsheet size={16}/> Download Excel</button>
          <span style={{fontSize:12,color:'var(--text-muted)',alignSelf:'center'}}>Exports filtered list ({filtered.length} campaigns) — admin / superadmin only</span>
        </div>
      )}

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
        <div style={{maxHeight:'62vh', overflow:'auto'}}>
          <table style={{width:'100%', fontSize:13, borderCollapse:'collapse', background:'var(--card-bg, #1e293b)'}}>
            <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
              <tr>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Campaign</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Content</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Who</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Status</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Contacts</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Created</th>
                <th style={{textAlign:'left',padding:'10px 12px', borderBottom:'1px solid var(--border)'}}>Report</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? <tr><td colSpan={7} style={{padding:20, textAlign:'center', color:'var(--text-muted)'}}><History size={18}/> No history</td></tr> : filtered.map(h=> (
                <tr key={h.id} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600}}>{h.name}</div><small style={{color:'var(--text-muted)'}}>{h.messageType}</small></td>
                  <td style={{padding:'10px 12px', maxWidth:240}}><div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={h.messageText}>{h.messageText}</div></td>
                  <td style={{padding:'10px 12px'}}><div style={{fontWeight:600, textTransform:'capitalize'}}>{h.createdByRole || 'unknown'}</div><small style={{color:'var(--text-muted)', wordBreak:'break-all'}}>{h.createdByEmail || '—'}</small></td>
                  <td style={{padding:'10px 12px'}}><span style={{padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background: h.status==='running' ? '#f59e0b' : h.status==='completed' ? '#22c55e' : h.status==='scheduled' ? '#64748b' : '#ef4444', color:'#fff'}}>{h.status}</span></td>
                  <td style={{padding:'10px 12px'}}>{h.contactCount}</td>
                  <td style={{padding:'10px 12px'}}><small>{h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}</small></td>
                  <td style={{padding:'10px 12px'}}><button onClick={()=> { setReportId(h.id); setReportTab('delivery'); }} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-secondary)',cursor:'pointer',fontSize:12,fontWeight:600}}><Eye size={14}/> View Report</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {reportId && (
        <Modal open onClose={()=> setReportId(null)} title={`Campaign Report — ${history.find(h=>h.id===reportId)?.name ?? reportId}`}>
          <div style={{display:'flex',gap:6,marginBottom:12, borderBottom:'1px solid var(--border)', paddingBottom:8}}>
            <button onClick={()=> setReportTab('delivery')} style={{padding:'7px 14px',borderRadius:999,border: reportTab==='delivery'?'1px solid var(--primary)':'1px solid var(--border)', background: reportTab==='delivery'?'var(--primary-soft)':'var(--bg-white)', color: reportTab==='delivery'?'var(--primary-text)':'var(--text-secondary)', fontWeight:600, cursor:'pointer'}}>Delivery (sent/failed/blocked)</button>
            <button onClick={()=> setReportTab('replies')} style={{padding:'7px 14px',borderRadius:999,border: reportTab==='replies'?'1px solid #7c3aed':'1px solid var(--border)', background: reportTab==='replies'?'rgba(124,58,237,0.12)':'var(--bg-white)', color: reportTab==='replies'?'#7c3aed':'var(--text-secondary)', fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}><MessageCircle size={14}/> Replies (campaign-wise)</button>
          </div>

          {reportTab==='delivery' ? (
            execLoading ? <div style={{display:'flex',justifyContent:'center',padding:30}}><Loader2 className="animate-spin" size={28}/></div> : (
            <>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#22c55e',color:'#fff',fontSize:12}}>Sent {reportCounts.sent}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#ef4444',color:'#fff',fontSize:12}}>Failed {reportCounts.failed}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#f59e0b',color:'#fff',fontSize:12}}>Blocked {reportCounts.blocked}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#64748b',color:'#fff',fontSize:12}}>Pending {reportCounts.pending}</span>
                <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>{filteredReport.length}/{reportCounts.total} shown</span>
              </div>
              {isAdmin && (
                <div style={{display:'flex',gap:8,marginBottom:12}}>
                  <button onClick={exportReportCsv} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #16a34a',background:'#16a34a',color:'#fff',fontWeight:600,cursor:'pointer'}}><Download size={14}/> CSV</button>
                  <button onClick={exportReportExcel} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #0ea5e9',background:'#0ea5e9',color:'#fff',fontWeight:600,cursor:'pointer'}}><FileSpreadsheet size={14}/> Excel</button>
                  <span style={{fontSize:11,color:'var(--text-muted)',alignSelf:'center'}}>Per-recipient send status export (admin / superadmin)</span>
                </div>
              )}
              <div style={{display:'flex',gap:8,marginBottom:10}}>
                <div style={{position:'relative',flex:1}}><Search size={14} style={{position:'absolute',left:8,top:9, color:'#94a3b8'}}/><input value={reportSearch} onChange={e=>setReportSearch(e.target.value)} placeholder="Search phone, name, session, error" style={{width:'100%', padding:'7px 7px 7px 28px', border:'1px solid var(--border)', borderRadius:8, fontSize:13}} /></div>
                <select value={reportStatus} onChange={e=>setReportStatus(e.target.value)} style={{padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13}}>
                  <option value="all">All status</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
                  <option value="blocked">Blocked</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div style={{border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:'42vh', overflowY:'auto'}}>
                <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
                    <tr>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>Phone</th>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>Name</th>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>Session</th>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>Status</th>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>Error</th>
                      <th style={{textAlign:'left',padding:'8px 10px', borderBottom:'1px solid var(--border)'}}>SentAt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReport.length===0 ? <tr><td colSpan={6} style={{padding:16, textAlign:'center', color:'var(--text-muted)'}}>No recipients for this filter</td></tr> : filteredReport.slice(0,1000).map((r,idx)=> (
                      <tr key={idx} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'7px 10px', fontFamily:'monospace'}}>{r.phone}</td>
                        <td style={{padding:'7px 10px'}}>{r.name || '—'}</td>
                        <td style={{padding:'7px 10px'}}>{r.session}</td>
                        <td style={{padding:'7px 10px'}}><span style={{padding:'2px 7px', borderRadius:999, fontSize:10, fontWeight:700, color:'#fff', background: r.status==='sent'?'#22c55e': r.status==='blocked'?'#f59e0b': r.status==='failed'?'#ef4444':'#64748b', textTransform:'uppercase'}}>{r.status}</span></td>
                        <td style={{padding:'7px 10px', maxWidth:200, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={`${r.errorCode||''} ${r.errorMessage||''}`}>{r.errorCode ? `${r.errorCode}: ` : ''}{r.errorMessage || '—'}</td>
                        <td style={{padding:'7px 10px'}}><small>{r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredReport.length>1000 && <div style={{padding:8, textAlign:'center', fontSize:11, color:'var(--text-muted)'}}>Showing 1000 of {filteredReport.length} — download export for full file</div>}
              </div>
            </>
            )
          ) : (
            repliesLoading ? <div style={{display:'flex',justifyContent:'center',padding:30}}><Loader2 className="animate-spin" size={28}/></div> : !repliesData ? <div style={{padding:20, textAlign:'center', color:'var(--text-muted)'}}>No data</div> : (
            <>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#22c55e',color:'#fff',fontSize:12}}>Interested {repliesData.summary.interested}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#ef4444',color:'#fff',fontSize:12}}>Not interested {repliesData.summary.notInterested}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#64748b',color:'#fff',fontSize:12}}>Other {repliesData.summary.other}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#0ea5e9',color:'#fff',fontSize:12}}>Replied {repliesData.summary.replied}/{repliesData.summary.totalContacts}</span>
                <span style={{padding:'6px 10px',borderRadius:999,background:'#fff',border:'1px solid var(--border)',fontSize:12}}>Pending {repliesData.summary.pending}</span>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                {repliesData.bySession.map(s=> (
                  <span key={s.sessionId} style={{padding:'5px 10px',borderRadius:999,background:'var(--bg-secondary)',border:'1px solid var(--border)',fontSize:11}}><strong>{s.sessionName}</strong>: {s.replied} replied · <span style={{color:'#22c55e'}}>{s.interested} interested</span> · <span style={{color:'#ef4444'}}>{s.notInterested} not</span></span>
                ))}
              </div>
              <div style={{display:'flex',gap:8,marginBottom:10, flexWrap:'wrap'}}>
                <div style={{position:'relative',flex:1, minWidth:160}}><Search size={14} style={{position:'absolute',left:8,top:9, color:'#94a3b8'}}/><input value={replySearch} onChange={e=>setReplySearch(e.target.value)} placeholder="Search phone, name, message" style={{width:'100%', padding:'7px 7px 7px 28px', border:'1px solid var(--border)', borderRadius:8, fontSize:13}} /></div>
                <select value={replySessionFilter} onChange={e=>setReplySessionFilter(e.target.value)} style={{padding:'7px 8px', border:'1px solid var(--border)', borderRadius:8, fontSize:12}}>
                  <option value="all">All sessions</option>
                  {repliesData.bySession.map(s=> <option key={s.sessionId} value={s.sessionName}>{s.sessionName}</option>)}
                </select>
                <select value={replyInterestFilter} onChange={e=>setReplyInterestFilter(e.target.value)} style={{padding:'7px 8px', border:'1px solid var(--border)', borderRadius:8, fontSize:12}}>
                  <option value="all">All replies</option>
                  <option value="interested">Interested</option>
                  <option value="not_interested">Not interested</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {isAdmin && (
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <button onClick={exportRepliesCsv} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #16a34a',background:'#16a34a',color:'#fff',fontWeight:600,cursor:'pointer'}}><Download size={14}/> CSV</button>
                  <button onClick={exportRepliesExcel} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #0ea5e9',background:'#0ea5e9',color:'#fff',fontWeight:600,cursor:'pointer'}}><FileSpreadsheet size={14}/> Excel</button>
                  <span style={{fontSize:11,color:'var(--text-muted)',alignSelf:'center'}}>Export replies (session-wise)</span>
                </div>
              )}
              <div style={{border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:'36vh', overflowY:'auto'}}>
                <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0, background:'var(--bg-secondary, #0f172a)', zIndex:1}}>
                    <tr>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Phone</th>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Session</th>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Reply</th>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Interest</th>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Time</th>
                      <th style={{textAlign:'left',padding:'7px 8px', borderBottom:'1px solid var(--border)'}}>Send</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReplies.length===0 ? <tr><td colSpan={6} style={{padding:16, textAlign:'center', color:'var(--text-muted)'}}>No replies yet — replies after campaign start appear here</td></tr> : filteredReplies.slice(0,500).map((r:any, idx:number)=> (
                      <tr key={idx} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'7px 8px', fontFamily:'monospace', fontSize:11}}>{r.phone}<br/><small style={{color:'var(--text-muted)'}}>{r.name||''}</small></td>
                        <td style={{padding:'7px 8px', fontSize:11}}>{r.sessionName}</td>
                        <td style={{padding:'7px 8px', maxWidth:220}}><div style={{whiteSpace:'pre-wrap', wordBreak:'break-word', fontSize:12}} title={r.body}>{r.body.slice(0,180)}{r.body.length>180?'…':''}</div></td>
                        <td style={{padding:'7px 8px'}}><span style={{padding:'2px 7px', borderRadius:999, fontSize:10, fontWeight:700, color:'#fff', background: r.interest==='interested'?'#22c55e': r.interest==='not_interested'?'#ef4444':'#64748b', textTransform:'uppercase'}}>{r.interest==='interested'?'Interested': r.interest==='not_interested'?'Not interested':'Other'}</span></td>
                        <td style={{padding:'7px 8px', fontSize:11}}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                        <td style={{padding:'7px 8px'}}><button onClick={()=> setComposer({ chatId: r.chatId, sessionId: r.sessionId, phone: r.phone })} style={{display:'flex',alignItems:'center',gap:4,padding:'5px 8px',borderRadius:8,border:'1px solid var(--primary)',background:'var(--primary)',color:'#0f172a',fontSize:11,fontWeight:700,cursor:'pointer'}}><Send size={12}/> Reply</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {composer && (
                <div style={{marginTop:10, padding:10, border:'1px solid var(--primary)', borderRadius:10, background:'var(--primary-soft)'}}>
                  <div style={{fontSize:12, fontWeight:700, marginBottom:6, display:'flex', alignItems:'center', gap:6}}><MessageCircle size={14}/> Reply to {composer.phone} via {repliesData.bySession.find(s=>s.sessionId===composer.sessionId)?.sessionName ?? composer.sessionId}</div>
                  <textarea value={composerText} onChange={e=>setComposerText(e.target.value)} placeholder="Type your reply..." rows={3} style={{width:'100%', padding:'8px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, resize:'vertical'}} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                    <button onClick={()=> { setComposer(null); setComposerText(''); }} style={{padding:'7px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-white)',cursor:'pointer'}}>Cancel</button>
                    <button onClick={handleDirectSend} disabled={sending || !composerText.trim()} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:8,border:'none',background: sending||!composerText.trim()?'#94a3b8':'var(--primary)',color:'#0f172a',fontWeight:700,cursor:'pointer'}}><Send size={14}/>{sending?'Sending...':'Send'}</button>
                  </div>
                </div>
              )}
            </>
          ))}

              <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
                <button onClick={()=> setReportId(null)} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-secondary)',cursor:'pointer'}}><X size={14}/> Close</button>
              </div>
        </Modal>
      )}
    </div>
  );
}
