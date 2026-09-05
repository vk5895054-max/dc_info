import { useEffect, useMemo, useState, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileText, Loader2, Plus, Search, Trash2, Upload, X, Send } from 'lucide-react';
import { type MessageTemplate, type TemplatePayload } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCreateTemplateMutation,
  useDeleteTemplateMutation,
  useSessionsQuery,
  useTemplatesQuery,
  useUpdateTemplateMutation,
  useOutreachQuery,
  useOutreachDeleteMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { copyToClipboard } from '../utils/clipboard';
import './Templates.css';

type TemplateForm = {
  name: string;
  body: string;
  mediaType: string;
  mediaUrl: string;
};

const emptyForm: TemplateForm = {
  name: '',
  body: '',
  mediaType: 'text',
  mediaUrl: '',
};

const mediaTypes = ['text', 'image', 'document'] as const;
const mediaAccept: Record<string, string> = { image: 'image/*', document: '.pdf,.doc,.docx,.txt,.xlsx,.pptx,.zip,*/*', text: '*/*' };
const fallbackMime: Record<string, string> = { image: 'image/jpeg', document: 'application/pdf', text: 'text/plain' };

function extractPlaceholders(template: TemplateForm | MessageTemplate) {
  const source = [template.body].filter(Boolean).join('\n');
  return Array.from(new Set(Array.from(source.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g), match => match[1]))).sort();
}

function toPayload(form: TemplateForm, mediaFile: { base64: string; mimetype: string; filename: string } | null): TemplatePayload {
  const isText = form.mediaType === 'text';
  return {
    name: form.name.trim(),
    body: form.body.trim(),
    header: null,
    footer: null,
    mediaType: form.mediaType,
    mediaUrl: !isText ? (form.mediaUrl.trim() || null) : null,
    mediaBase64: !isText && mediaFile ? mediaFile.base64 : null,
    mimetype: !isText ? (mediaFile?.mimetype || fallbackMime[form.mediaType] || null) : null,
    filename: !isText ? (mediaFile?.filename || null) : null,
    caption: !isText ? (form.body.trim() || null) : null, // image text: body is caption
  };
}

function renderPreview(template: TemplateForm, values: Record<string, string>) {
  const render = (s: string) => s.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, k: string) => values[k] || `{{${k}}}`);
  const txt = render(template.body);
  if (template.mediaType !== 'text') return txt;
  return txt;
}

export function Templates() {
  const { t } = useTranslation();
  useDocumentTitle(t('templates.title'));
  const { canWrite } = useRole();
  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const toast = useToast();
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [mediaFile, setMediaFile] = useState<{ base64: string; mimetype: string; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [testChatId, setTestChatId] = useState('');
  const [testSending, setTestSending] = useState(false);

  const { data: templates = [], isLoading: loadingTemplates } = useTemplatesQuery(selectedSessionId, !!selectedSessionId);
  const createMutation = useCreateTemplateMutation();
  const updateMutation = useUpdateTemplateMutation();
  const deleteMutation = useDeleteTemplateMutation();
  const { data: campaigns = [] } = useOutreachQuery();
  const deleteCampaignMutation = useOutreachDeleteMutation();

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const placeholders = useMemo(() => extractPlaceholders(form), [form]);
  const preview = useMemo(() => renderPreview(form, previewValues), [form, previewValues]);
  const filteredTemplates = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(temp => [temp.name, temp.body, (temp as any).mediaUrl].filter(Boolean).some(v => v!.toLowerCase().includes(q)));
  }, [searchTerm, templates]);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => { if (!selectedSessionId && sessions.length > 0) setSelectedSessionId(sessions[0].id); }, [selectedSessionId, sessions]);
  useEffect(() => { setPreviewValues(cur => { const nxt: Record<string,string> = {}; for (const k of placeholders) nxt[k]=cur[k]||''; return nxt; }); }, [placeholders]);

  const resetForm = () => { setForm(emptyForm); setEditingTemplate(null); setPreviewValues({}); setMediaFile(null); };
  const openEdit = (tpl: MessageTemplate) => {
    setEditingTemplate(tpl);
    setForm({ name: tpl.name, body: tpl.body, mediaType: (tpl as any).mediaType||'text', mediaUrl: (tpl as any).mediaUrl||'' });
    setMediaFile(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value='';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1]||'';
      setMediaFile({ base64, mimetype: f.type || fallbackMime[form.mediaType], filename: f.name });
    };
    reader.readAsDataURL(f);
  };

  const handleSave = async () => {
    if (!selectedSessionId || !form.name.trim() || !form.body.trim()) return;
    try {
      if (editingTemplate) {
        await updateMutation.mutateAsync({ sessionId: selectedSessionId, id: editingTemplate.id, data: toPayload(form, mediaFile) });
        toast.success(t('templates.toasts.updated'));
      } else {
        await createMutation.mutateAsync({ sessionId: selectedSessionId, data: toPayload(form, mediaFile) });
        toast.success(t('templates.toasts.created'));
      }
      resetForm();
    } catch (err) { toast.error(t(editingTemplate ? 'templates.toasts.updateFailed' : 'templates.toasts.createFailed', { message: err instanceof Error ? err.message : t('common.unknownError') })); }
  };

  const handleDelete = async () => {
    if (!selectedSessionId || !deleteTarget) return;
    try { await deleteMutation.mutateAsync({ sessionId: selectedSessionId, id: deleteTarget.id }); toast.success(t('templates.toasts.deleted')); if (editingTemplate?.id===deleteTarget.id) resetForm(); setDeleteTarget(null); } catch (err) { toast.error(t('templates.toasts.deleteFailed', { message: err instanceof Error ? err.message : t('common.unknownError') })); }
  };

  const copyName = async (name: string) => { if (await copyToClipboard(name)) toast.success(t('templates.toasts.copied')); };

  const handleTestSend = async () => {
    if (!selectedSessionId || !editingTemplate || !testChatId.trim()) { toast.error('Select template and enter chatId (e.g. 9198...@c.us)'); return; }
    setTestSending(true);
    try {
      // Use send-template endpoint — backend will dispatch as image/file+caption like Message Tester (non-bulk)
      const res = await fetch(`/api/sessions/${selectedSessionId}/messages/send-template`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': sessionStorage.getItem('openwa_api_key')||'' }, body: JSON.stringify({ chatId: testChatId.trim(), templateId: editingTemplate.id }) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.message||'Send failed');
      toast.success(`Test sent: ${data.messageId||'ok'}`);
    } catch (e) { toast.error('Test send failed', e instanceof Error? e.message: String(e)); } finally { setTestSending(false); }
  };

  if (loadingSessions) return <div className="templates-page templates-loading"><Loader2 className="animate-spin" size={32} /></div>;

  return (
    <div className="templates-page">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle') + ' — flexible: image+text, file+text like Message Tester (Supabase)'} actions={
        <select className="templates-session-select" aria-label={t('templates.sessionSelect')} value={selectedSessionId} onChange={e=>{setSelectedSessionId(e.target.value); resetForm();}}>
          {sessions.length===0 && <option value="">{t('templates.noSessions')}</option>}
          {sessions.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      } />

      {sessions.length===0 ? <div className="templates-empty-page"><FileText size={48} strokeWidth={1}/><h3>{t('templates.empty.noSessionsTitle')}</h3><p>{t('templates.empty.noSessionsDesc')}</p></div> : (
        <div className="templates-workspace">
          <aside className="templates-library">
            <div className="templates-library-header"><div><h2>{t('templates.savedTitle')}</h2><span>{t('templates.count', { count: templates.length })}</span></div><button className="btn-primary templates-new-btn" onClick={resetForm} disabled={!canWrite}><Plus size={16}/>{t('templates.newTemplate')}</button></div>
            <div className="templates-search"><Search size={16}/><input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder={t('common.search')} /></div>
            {loadingTemplates ? <div className="templates-loading-inline"><Loader2 className="animate-spin" size={24}/></div> : templates.length===0 ? <div className="templates-empty-list"><FileText size={40} strokeWidth={1}/><h3>{t('templates.empty.title')}</h3><p>{t('templates.empty.description')}</p></div> : filteredTemplates.length===0 ? <div className="templates-empty-list compact"><Search size={32} strokeWidth={1.5}/><h3>{t('templates.empty.title')}</h3></div> : (
              <div className="template-list" role="list">
                {filteredTemplates.map(tpl=>{
                  const ph=extractPlaceholders(tpl as any); const isSel=editingTemplate?.id===tpl.id;
                  const mt=(tpl as any).mediaType||'text';
                  return <button key={tpl.id} className={`template-list-item ${isSel?'selected':''}`} onClick={()=>openEdit(tpl)} type="button">
                    <span className="template-list-title">{tpl.name} <small style={{color: mt==='text'?'#94a3b8': '#22c55e'}}> [{mt}]</small></span>
                    <span className="template-list-body">{(tpl as any).caption || tpl.body}</span>
                    <span className="template-list-meta">{ph.length>0? ph.map(k=>`{{${k}}}`).join(' '): t('templates.noPlaceholders')}</span>
                    {(tpl as any).mediaUrl && <span style={{fontSize:11, color:'#0ea5e9', wordBreak:'break-all'}}>{(tpl as any).mediaUrl.slice(0,60)}</span>}
                  </button>;
                })}
              </div>
            )}
          </aside>

          <section className="template-editor">
            <div className="template-editor-header"><div><h2>{editingTemplate? t('templates.editTitle'): t('templates.createTitle')}</h2><p>{selectedSession? t('templates.sessionHint', { name: selectedSession.name }):''}</p></div>
              <div className="template-header-actions">
                {editingTemplate && <button className="icon-btn" title={t('templates.actions.copyName')} onClick={()=>void copyName(editingTemplate.name)} type="button"><Copy size={16}/></button>}
                {editingTemplate && canWrite && <button className="icon-btn danger" title={t('common.delete')} onClick={()=>setDeleteTarget(editingTemplate)} type="button"><Trash2 size={16}/></button>}
              </div>
            </div>

            <div className="template-form">
              <div className="form-group"><label htmlFor="tpl-1">{t('common.name')}</label><input id="tpl-1" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} placeholder={t('templates.namePlaceholder')} disabled={!canWrite} /></div>
              <div className="form-group"><label>Type</label><div style={{display:'flex',gap:6}}>{mediaTypes.map(m=> <button key={m} type="button" onClick={()=>setForm({...form, mediaType:m})} style={{padding:'8px 14px', borderRadius:8, border: form.mediaType===m?'1px solid #22c55e':'1px solid var(--border)', background: form.mediaType===m?'#22c55e':'var(--bg-secondary)', color: form.mediaType===m?'#fff':'var(--text)', fontWeight: form.mediaType===m?700:400}}>{m==='text'?'Text': m==='image'?'Image + Text':'File / PDF + Text'}</button>)}</div></div>

              {form.mediaType!=='text' && (
                <>
                  <div className="form-group"><label>{form.mediaType==='image' ? 'Image URL (or upload)' : 'File URL (or upload PDF/DOC)'}</label><input value={form.mediaUrl} onChange={e=>setForm({...form, mediaUrl:e.target.value})} placeholder="https://... or upload below" disabled={!canWrite} /></div>
                  <div className="form-group">
                    {mediaFile ? <div className="file-selected"><span className="file-name" title={mediaFile.filename}>{mediaFile.filename}</span><button type="button" className="remove-file-btn" onClick={()=>setMediaFile(null)}><X size={14}/> Remove</button></div> : <button type="button" className="browse-btn" onClick={()=>fileRef.current?.click()}><Upload size={14}/> {form.mediaType==='image' ? 'Upload Image' : 'Upload File'}</button>}
                    <input ref={fileRef} type="file" style={{display:'none'}} accept={mediaAccept[form.mediaType]} onChange={handleFile} />
                  </div>
                  {form.mediaType==='image' && (mediaFile || form.mediaUrl) && <div style={{border:'1px solid var(--border)', borderRadius:8, padding:8, background:'var(--bg-secondary)'}}><img src={mediaFile ? `data:${mediaFile.mimetype};base64,${mediaFile.base64}` : form.mediaUrl} alt="preview" style={{maxWidth:'100%', maxHeight:200, borderRadius:6, display:'block', margin:'0 auto'}} /><small style={{color:'var(--text-muted)', display:'block', textAlign:'center', marginTop:6}}>Image preview — will be sent as native WhatsApp image</small></div>}
                  {form.mediaType==='document' && (mediaFile || form.mediaUrl) && <div style={{border:'1px solid var(--border)', borderRadius:8, padding:8, background:'var(--bg-secondary)', display:'flex', alignItems:'center', gap:10}}><FileText size={32} /><div><div style={{fontWeight:600}}>{mediaFile?.filename || form.mediaUrl.split('/').pop() || 'document'}</div><small style={{color:'var(--text-muted)'}}>{mediaFile?.mimetype || 'application/pdf'} — will be sent as native file with text</small></div></div>}
                </>
              )}

              <div className="form-group body-field"><label htmlFor="tpl-3">{form.mediaType==='image' ? 'Text (caption with image)' : form.mediaType==='document' ? 'Text (caption with file)' : t('templates.body')}</label><textarea id="tpl-3" value={form.body} onChange={e=>setForm({...form, body:e.target.value})} placeholder={form.mediaType==='image' ? 'Hi {{name}} see this image' : form.mediaType==='document' ? 'Hi {{name}} see attached file' : t('templates.bodyPlaceholder')} rows={form.mediaType!=='text'?4:8} disabled={!canWrite} /></div>

              <div className="template-editor-actions">
                <button className="btn-secondary" onClick={resetForm} disabled={isSaving} type="button">{t('common.cancel')}</button>
                <button className="btn-primary" onClick={handleSave} disabled={!canWrite || isSaving || !selectedSessionId || !form.name.trim() || !form.body.trim()} type="button">{isSaving? <Loader2 size={18} className="animate-spin"/>: <Plus size={18}/>}{canWrite? t(editingTemplate? 'templates.saveChanges':'templates.createTemplate'): t('templates.viewOnly')}</button>
              </div>

              {editingTemplate && (
                <>
                  <div style={{marginTop:16, padding:12, border:'1px solid var(--border)', borderRadius:10, background:'var(--card-bg)'}}>
                    <label>Test send (like Message Tester — non-bulk, uses template media+caption)</label>
                    <div style={{display:'flex', gap:8, marginTop:6}}>
                      <input value={testChatId} onChange={e=>setTestChatId(e.target.value)} placeholder="9198...@c.us or group id" style={{flex:1}} />
                      <button className="btn-primary" onClick={handleTestSend} disabled={testSending || !testChatId.trim()} type="button">{testSending? <Loader2 size={16} className="animate-spin"/>: <Send size={16}/>} Test</button>
                    </div>
                    <small style={{color:'var(--text-muted)'}}>Sends via `POST /sessions/:id/messages/send-template` — if template has image/file, sent as native media with caption (does not look bulk).</small>
                  </div>
                  <div style={{marginTop:12, padding:12, border:'1px solid var(--border)', borderRadius:10, background:'var(--bg-secondary, #0f172a)'}}>
                    <div style={{fontWeight:700, fontSize:13, marginBottom:8, display:'flex', alignItems:'center', gap:6}}><FileText size={14}/> Campaigns using this template — delete / update</div>
                    {campaigns.filter((c:any)=> c.templateId===editingTemplate.id).length===0 ? <small style={{color:'var(--text-muted)'}}>No campaigns use this template yet. Create one in Campaigns → Use saved template.</small> : campaigns.filter((c:any)=> c.templateId===editingTemplate.id).map((c:any)=> (
                      <div key={c.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:8, marginBottom:6}}>
                        <div><div style={{fontWeight:600, fontSize:13}}>{c.name} <small style={{color:'var(--text-muted)'}}>({c.status})</small></div><small style={{color:'var(--text-muted)'}}>{c.contactCount} contacts · {c.messageType} · {c.totalCredits} credits</small></div>
                        <div style={{display:'flex', gap:6}}>
                          <button className="icon-btn danger" title="Delete campaign" onClick={async()=>{ if(!confirm(`Delete campaign ${c.name}?`)) return; try{ await deleteCampaignMutation.mutateAsync(c.id); toast.success('Campaign deleted'); }catch(e){ toast.error('Delete failed', e instanceof Error? e.message:String(e)); } }}><Trash2 size={14}/></button>
                        </div>
                      </div>
                    ))}
                    <small style={{color:'var(--text-muted)', marginTop:6, display:'block'}}>Update campaign: go to <b>Campaigns</b> → <b>Edit</b> (scheduled only). Delete works here and in Campaigns (scheduled/completed/cancelled).</small>
                  </div>
                </>
              )}
            </div>
          </section>

          <aside className="template-preview">
            <div className="template-preview-header"><h2>{t('templates.previewTitle')}</h2><span>{placeholders.length}</span></div>
            <div className="template-preview-message">
              {form.mediaType==='image' && (mediaFile || form.mediaUrl) && <img src={mediaFile ? `data:${mediaFile.mimetype};base64,${mediaFile.base64}` : form.mediaUrl} alt="preview" style={{width:'100%', maxHeight:160, objectFit:'cover', borderRadius:8, marginBottom:8, border:'1px solid var(--border)'}} />}
              {form.mediaType==='document' && (mediaFile || form.mediaUrl) && <div style={{display:'flex', alignItems:'center', gap:8, padding:8, background:'var(--bg-secondary)', borderRadius:8, marginBottom:8, border:'1px solid var(--border)'}}><FileText size={24} /><span style={{fontSize:13, wordBreak:'break-all'}}>{mediaFile?.filename || form.mediaUrl.split('/').pop()}</span></div>}
              <pre style={{margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{preview || t('templates.previewEmpty')}</pre>
              {form.mediaType!=='text' && <small style={{color:'var(--text-muted)', marginTop:6, display:'block'}}>WhatsApp preview — {form.mediaType==='image'?'image':'file'} on top, text as caption below</small>}
            </div>
            <div className="template-variable-panel">
              {placeholders.length>0 ? <div className="placeholder-list">{placeholders.map(k=> <label key={k}><span>{`{{${k}}}`}</span><input value={previewValues[k]||''} onChange={e=>setPreviewValues({...previewValues, [k]:e.target.value})} placeholder={t('templates.previewValuePlaceholder')} /></label>)}</div> : <p className="template-muted">{t('templates.noPlaceholders')}</p>}
            </div>
          </aside>
        </div>
      )}

      {deleteTarget && <Modal open onClose={()=>setDeleteTarget(null)} title={t('templates.deleteTitle')} className="modal-sm" closeLabel={t('common.close')} footer={<><button className="btn-secondary" onClick={()=>setDeleteTarget(null)}>{t('common.cancel')}</button><button className="btn-danger" onClick={handleDelete} disabled={deleteMutation.isPending}>{deleteMutation.isPending? <Loader2 size={18} className="animate-spin"/>: <Trash2 size={18}/>}{t('common.delete')}</button></>}><p>{t('templates.deleteConfirm', { name: deleteTarget.name })}</p></Modal>}
    </div>
  );
}
