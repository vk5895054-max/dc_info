import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MousePointerClick } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import { useSessionsQuery } from '../hooks/queries';
import { outreachApi } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import './WappBtn.css';

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function WappBtn() {
  const { t: _t } = useTranslation();
  void _t;
  useDocumentTitle('Wapp Btn Message');
  const { canWrite } = useRole() as any;
  const toast = useToast();
  const { data: sessions = [] } = useSessionsQuery();
  const readySessions = useMemo(() => sessions.filter(s => s.status === 'ready'), [sessions]);

  const [numbers, setNumbers] = useState('');
  const [campName, setCampName] = useState('');
  const [textMessage, setTextMessage] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [visitUrl, setVisitUrl] = useState('');
  const [callNumber, setCallNumber] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => {
    const lines = numbers.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for(const line of lines){
      const digits = line.replace(/[^0-9]/g,'');
      if(digits.length>=10 && digits.length<=15 && !seen.has(digits)){ valid.push(digits); seen.add(digits); }
      else if(digits) invalid.push(line);
    }
    return { valid, invalid, count: valid.length };
  }, [numbers]);

  const toggleSession = (name: string) => setSelectedSessions(prev=> prev.includes(name) ? prev.filter(s=>s!==name) : [...prev, name]);

  const handleFile = (f: File | null) => {
    if(!f) return;
    if(f.size > IMAGE_MAX_BYTES){ toast.warning('Image exceeds 2 MB'); return; }
    setMediaFile(f);
    const r = new FileReader();
    r.onload = () => setMediaBase64((r.result as string).split(',')[1]||'');
    r.readAsDataURL(f);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0] as File | undefined;
    if(f) handleFile(f);
  };

  const validVisit = !visitUrl || /^https?:\/\/.+/i.test(visitUrl.trim());
  const visitOk = visitUrl.trim().length===0 || validVisit;
  const callDigits = callNumber.replace(/\D/g,'');
  const validCall = !callNumber || /^\d{10}$/.test(callDigits);
  const callOk = callNumber.trim().length===0 || validCall;

  const handleSubmit = async () => {
    if(!campName.trim() || !textMessage.trim()){ toast.warning('Campname and text message required'); return; }
    if(parsed.count < 1){ toast.warning('Add at least 1 number'); return; }
    if(parsed.count < 1000){ const ok = confirm(`Note: Minimum 1000 numbers required. You have ${parsed.count}. Continue anyway?`); if(!ok) return; }
    if(visitUrl && !/^https?:\/\/.+/i.test(visitUrl.trim())){ toast.warning('Visit Now must be http:// or https:// URL'); return; }
    if(callNumber && !/^\d{10}$/.test(callDigits)){ toast.warning('Call Now must be 10 digit Indian number'); return; }
    if(selectedSessions.length===0){ toast.warning('Select at least one session'); return; }
    if(schedule && !scheduleAt){ toast.warning('Pick schedule date/time'); return; }
    setSubmitting(true);
    try {
      const buttons: Array<{type:string;text:string;value:string}> = [];
      if(visitUrl.trim()) buttons.push({ type: 'url', text: 'Visit Now', value: visitUrl.trim() });
      if(callDigits) buttons.push({ type: 'call', text: 'Call Now', value: callDigits });
      const contacts = parsed.valid.map(phone=> ({ phone }));
      const mediaData: any = mediaBase64 ? { base64: mediaBase64, mimetype: mediaFile?.type, filename: mediaFile?.name } : null;
      const payload: any = {
        name: campName.trim(),
        messageText: textMessage.trim(),
        messageType: mediaData ? (mediaFile?.type?.startsWith('image') ? 'image' : 'document') : 'buttons',
        mediaData,
        buttons: buttons.length? buttons : undefined,
        contacts,
        sessions: selectedSessions.map(sessionName=> ({ sessionName })),
        strategy: { burstSize: 30, cooldownMinMs: 240000, cooldownMaxMs: 480000, preCheckNumbers: false, saveContactFirst: false },
      };
      const camp = await outreachApi.create(payload);
      toast.success(`Wapp Btn campaign created: ${camp.name} (${camp.id})`);
      if(!schedule){
        await outreachApi.start(camp.id);
        toast.success('Campaign started');
      } else {
        toast.success(`Scheduled for ${scheduleAt}`);
      }
      setCampName(''); setTextMessage(''); setNumbers(''); setVisitUrl(''); setCallNumber(''); setMediaFile(null); setMediaBase64(null);
    } catch(e){ toast.error('Submit failed', e instanceof Error? e.message:String(e)); } finally { setSubmitting(false); }
  };

  return (
    <div className="wappbtn-page">
      <PageHeader title="Wapp Btn Message" subtitle="send btn wa message" />
      <div style={{color:'#ef4444', fontSize:12, marginBottom:8, textAlign:'center'}}>Note:Minimum 1000 number required for campaig. Do Not send any fraud or abuse Message.If we found any such content Your account will be suspended</div>
      <div className="wappbtn-layout">
        <div className="wappbtn-left">
          <div className="wappbtn-left-head">Numbers</div>
          <textarea value={numbers} onChange={e=>setNumbers(e.target.value)} placeholder="919876543210&#10;919876543211" className="wappbtn-numbers" rows={22} />
          <label className="wappbtn-schedule"><input type="checkbox" checked={schedule} onChange={e=>setSchedule(e.target.checked)} /> Schedule</label>
          {schedule && <input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)} className="wappbtn-input" style={{marginTop:6}} />}
          <div style={{fontSize:11, marginTop:6, display:'flex', gap:8, flexWrap:'wrap'}}>
            <span style={{color:'#166534'}}>Valid: {parsed.count}</span>
            <span style={{color:'#991b1b'}}>Invalid: {parsed.invalid.length}</span>
          </div>
          <div style={{marginTop:8}}>
            <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>Sessions (ready)</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {readySessions.length===0 ? <small>— no ready sessions</small> : readySessions.map(s=> <label key={s.id} style={{display:'flex', alignItems:'center', gap:4, fontSize:12, padding:'4px 8px', border:'1px solid var(--border)', borderRadius:6}}><input type="checkbox" checked={selectedSessions.includes(s.name)} onChange={()=>toggleSession(s.name)} />{s.name}</label>)}
            </div>
            {selectedSessions.length===0 && <small style={{color:'#ef4444'}}>Select at least one</small>}
          </div>
        </div>
        <div className="wappbtn-right">
          <div className="wappbtn-campname-row">
            <span className="wappbtn-camp-label">Campname</span>
            <input value={campName} onChange={e=>setCampName(e.target.value)} className="wappbtn-camp-input" placeholder="" />
          </div>
          <textarea value={textMessage} onChange={e=>setTextMessage(e.target.value)} placeholder="text message" className="wappbtn-text" rows={6} />
          <div className="wappbtn-media-row">
            <div className={`wappbtn-drop ${dragOver?'drag-over':''}`} onDragOver={e=>{e.preventDefault(); setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop} onClick={()=> document.getElementById('wappbtn-file')?.click()}>
              {mediaFile ? <><div style={{fontWeight:600}}>{mediaFile.name}</div><small>{(mediaFile.size/1024/1024).toFixed(2)} MB</small><button type="button" className="btn-secondary" style={{marginTop:6}} onClick={e=>{e.stopPropagation(); setMediaFile(null); setMediaBase64(null);}}>Remove</button></> : <>Drag & Drop Media(image,pdf)or<br/>Click to Browse Media</>}
              <input id="wappbtn-file" type="file" accept="image/*,.pdf" hidden onChange={e=>{ const f=e.target.files?.[0]||null; handleFile(f as File); e.currentTarget.value=''; }} />
            </div>
            <div className="wappbtn-btns-col">
              <div className="wappbtn-btn-row">
                <span className="wappbtn-btn-label">Visit Now</span>
                <input value={visitUrl} onChange={e=>setVisitUrl(e.target.value)} placeholder="http://" className={`wappbtn-btn-input ${visitOk?'':'invalid'}`} />
              </div>
              {!visitOk && <small style={{color:'#ef4444'}}>Enter valid http(s):// URL e.g. https://mycompany.com</small>}
              {visitUrl && <small style={{color:'#16a34a'}}>Share URL: https://mycompany.com → button Visit Now</small>}
              <div className="wappbtn-btn-row">
                <span className="wappbtn-btn-label">Call Now</span>
                <input value={callNumber} onChange={e=>setCallNumber(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="10 Digit number" maxLength={10} className={`wappbtn-btn-input ${callOk?'':'invalid'}`} />
              </div>
              {!callOk && <small style={{color:'#ef4444'}}>Enter 10 digit Indian number</small>}
              {callNumber && <small style={{color:'#16a34a'}}>Call button will dial +91 {callDigits}</small>}
            </div>
          </div>
          <div style={{color:'#14b8a6', fontSize:12, textAlign:'center', marginTop:6}}>Image Upload <span style={{color:'#ef4444'}}>(Max file size 2 MB.)</span></div>
          <div style={{display:'flex', justifyContent:'center', marginTop:16}}>
            <button className="wappbtn-submit" onClick={handleSubmit} disabled={submitting || !canWrite}>
              {submitting ? <Loader2 size={16} className="spin-slow" /> : null} Submit Now
            </button>
          </div>
          <div style={{marginTop:12, display:'flex', gap:8, justifyContent:'center'}}>
            <span style={{fontSize:11, color:'#64748b'}}><MousePointerClick size={12} /> Buttons preview: {visitUrl?`[Visit Now → ${visitUrl}] `:''}{callNumber?`[Call Now → +91 ${callDigits}]`:''}{!visitUrl&&!callNumber?'— add URL/phone above':''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
