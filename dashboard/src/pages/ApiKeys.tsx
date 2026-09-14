import { useState, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  useTable,
  tableFeatures,
  createColumnHelper,
  createCoreRowModel,
  columnVisibilityFeature,
  flexRender,
  type ColumnVisibilityState,
} from '@tanstack/react-table';
import {
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  KeyRound,
  AlertTriangle,
  AlertCircle,
  Coins,
  Edit2,
  Key,
  Search,
} from 'lucide-react';
import { resellerApi } from '../services/api';
import type { ApiKey } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useApiKeysQuery,
  useDeleteApiKeyMutation,
  useRevokeApiKeyMutation,
  useCreditTemplatesQuery,
  useCreateCreditTemplateMutation,
  useUpdateCreditTemplateMutation,
  useDeleteCreditTemplateMutation,
  useAddCreditsMutation,
  useDeductCreditsMutation,
  useCreditHistoryQuery,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/queries';
import './ApiKeys.css';

const roleNames = ['reseller', 'user', 'demo', 'admin', 'operator', 'viewer'] as const;

function useWindowSize() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return width;
}

const features = tableFeatures({
  columnVisibilityFeature,
  coreRowModel: createCoreRowModel(),
});

const columnHelper = createColumnHelper<typeof features, ApiKey>();

export function ApiKeys() {
  const { t } = useTranslation();
  const toast = useToast();
  const { role: userRole } = useRole();
  const queryClient = useQueryClient();
  useDocumentTitle(t('apiKeys.title'));
  const { data: apiKeys = [], isLoading: loading, isError: apiKeysError } = useApiKeysQuery();
  const { data: creditTemplates = [] } = useCreditTemplatesQuery();
  const deleteMutation = useDeleteApiKeyMutation();
  const revokeMutation = useRevokeApiKeyMutation();
  const createTemplateMutation = useCreateCreditTemplateMutation();
  const updateTemplateMutation = useUpdateCreditTemplateMutation();
  const deleteTemplateMutation = useDeleteCreditTemplateMutation();
  const addCreditsMutation = useAddCreditsMutation();
  const deductCreditsMutation = useDeductCreditsMutation();
  const [showModal, setShowModal] = useState(false);
  const [newKey, setNewKey] = useState({ name: '', role: 'user' as string, credits: '100', textCost: '1', imageCost: '2', docCost: '2', email: '', password: '' });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'revoke'; id: string; name: string } | null>(null);
  const [creditModal, setCreditModal] = useState<{ id: string; name: string } | null>(null);
  const { data: creditHistory = [] } = useCreditHistoryQuery(creditModal?.id || '', Boolean(creditModal));
  const [addAmount, setAddAmount] = useState('50');
  const [deductAmount, setDeductAmount] = useState('10');
  const [tableSearch, setTableSearch] = useState('');
  const [templateModal, setTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [tplForm, setTplForm] = useState({ name: '', body: `Hey! 👋 Kamal here from **Infyle Technologies** 😊\n\nAre you planning to build or upgrade anything tech-related for your business? 🚀\n\nWe can help with:\n🌐 Websites — ₹15K onwards\n📱 Mobile Apps — ₹35K onwards\n💻 CRM / Custom Software — ₹40K onwards\n🤖 AI Solutions — ₹50K onwards\n\nHave an idea in mind? Just reply **"Hi"** and I'll share some relevant work + pricing. 😊\n\nLet's build something awesome! 🚀`, type: 'text', creditCost: '1' });
  const [showpass, setShowPass] = useState(false);
  const [ownPwModal, setOwnPwModal] = useState(false);
  const [ownOldPw, setOwnOldPw] = useState('');
  const [ownNewPw, setOwnNewPw] = useState('');
  const [resellerPwModal, setResellerPwModal] = useState<{ id:string; email:string }|null>(null);
  const [newPwForUser, setNewPwForUser] = useState('');
  const windowWidth = useWindowSize();
  const isMobile = windowWidth < 768;
  const isSmall = windowWidth < 640;
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});

  useEffect(() => {
    setColumnVisibility({ key: !isSmall, lastUsed: !isMobile });
  }, [isMobile, isSmall]);

  const isSuperAdmin = (() => { try { return (sessionStorage.getItem('openwa_admin_email')||'').toLowerCase()==='infyle@infyle.com'; } catch { return false; }})();
  const isAdmin = isSuperAdmin || userRole === 'admin' || userRole === 'super_admin';
  const availableRoles = (() => {
    if (isSuperAdmin) return ['admin','reseller','user','demo','operator','viewer'] as const;
    if (userRole === 'admin' || userRole === 'super_admin') return ['reseller','user','demo','operator','viewer'] as const;
    if (userRole === 'reseller') return ['reseller','user','demo'] as const; // reseller can create reseller with credit deduction
    return ['user'] as const;
  })();

  const filteredApiKeys = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return apiKeys as any[];
    return (apiKeys as any[]).filter(k => [k.name, k.role, k.keyPrefix, String(k.credits ?? ''), String(k.creditsUsed ?? ''), k.isActive ? 'active':'revoked'].some(v => String(v).toLowerCase().includes(q)));
  }, [apiKeys, tableSearch]);

  const handleCreate = async () => {
    if (!newKey.name) return;
    if (!newKey.email || !newKey.password) {
      toast.error('A login email and password are required');
      return;
    }
    try {
      const res = await fetch('/api/auth/reseller/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': sessionStorage.getItem('openwa_api_key') || '',
            'X-Admin-Email': sessionStorage.getItem('openwa_admin_email') || 'infyle@infyle.com',
          },
          body: JSON.stringify({
            email: newKey.email.trim().toLowerCase(),
            password: newKey.password,
            role: newKey.role,
            name: newKey.name,
            credits: Number(newKey.credits) || 0,
            creditCost: {
              text: Number(newKey.textCost) || 1,
              image: Number(newKey.imageCost) || 2,
              document: Number(newKey.docCost) || 2,
              video: Number(newKey.imageCost) || 2,
              campaign: Number(newKey.textCost) || 1,
              default: Number(newKey.textCost) || 1,
            },
          }),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to create user');
      setCreatedKey('created');
      toast.success(`${newKey.role} ${newKey.email} created ${userRole==='reseller' ? `— ${newKey.credits} credits deducted from your balance` : ''}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
      setNewKey({ name: '', role: 'user', credits: '100', textCost: '1', imageCost: '2', docCost: '2', email: '', password: '' });
    } catch (err) {
      toast.error(t('apiKeys.createBtn'), err instanceof Error ? err.message : t('common.unknownError'));
    }
  };

  const handleRevoke = async (id: string) => {
    try { await revokeMutation.mutateAsync(id); } catch (err) { toast.error(t('apiKeys.actions.revoke'), err instanceof Error ? err.message : t('common.unknownError')); }
  };
  const handleDelete = async (id: string) => {
    try { await deleteMutation.mutateAsync(id); } catch (err) { toast.error(t('apiKeys.actions.delete'), err instanceof Error ? err.message : t('common.unknownError')); }
  };
  const confirmAndExecute = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete') handleDelete(confirmAction.id);
    else handleRevoke(confirmAction.id);
    setConfirmAction(null);
  };
  const handleAddCredits = async () => {
    if (!creditModal) return;
    try {
      await addCreditsMutation.mutateAsync({ id: creditModal.id, amount: Number(addAmount) || 0 });
      toast.success(`Added ${addAmount} credits to ${creditModal.name}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.creditHistory(creditModal.id) });
    } catch (e) { toast.error('Failed to add credits', (e as Error).message); }
  };
  const handleDeductCredits = async () => {
    if (!creditModal) return;
    try {
      await deductCreditsMutation.mutateAsync({ id: creditModal.id, amount: Number(deductAmount) || 0 });
      toast.success(`Deducted ${deductAmount} credits from ${creditModal.name} — returned to your balance`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.creditHistory(creditModal.id) });
    } catch (e) { toast.error('Failed to deduct credits', (e as Error).message); }
  };
  const handleOwnPw = async () => {
    if (!ownOldPw || !ownNewPw) { toast.error('Enter old and new password'); return; }
    try { await resellerApi.changeOwnPassword(ownOldPw, ownNewPw); toast.success('Own password updated'); setOwnPwModal(false); setOwnOldPw(''); setOwnNewPw(''); } catch(e:any){ toast.error('Failed', e.message); }
  };
  const handleResellerPw = async () => {
    if (!resellerPwModal || !newPwForUser) { toast.error('Enter new password'); return; }
    try {
      // need to map apiKeyId -> resellerUser id: fetch list and find
      const listRes = await fetch('/api/auth/reseller/list', { headers: { 'X-API-Key': sessionStorage.getItem('openwa_api_key')||'', 'X-Admin-Email': sessionStorage.getItem('openwa_admin_email')||'' } });
      const list = await listRes.json().catch(()=>[]);
      const target = (Array.isArray(list)? list: []).find((u:any)=> u.apiKeyId===resellerPwModal.id || u.id===resellerPwModal.id);
      const targetId = target?.id || resellerPwModal.id;
      await resellerApi.changeUserPassword(targetId, newPwForUser);
      toast.success(`Password updated for ${resellerPwModal.email}`);
      setResellerPwModal(null); setNewPwForUser('');
    } catch(e:any){ toast.error('Failed', e.message); }
  };

  const handleCreateTemplate = async () => {
    try {
      if (editingTemplate) {
        await updateTemplateMutation.mutateAsync({ id: editingTemplate.id, data: { name: tplForm.name, body: tplForm.body, creditCost: Number(tplForm.creditCost) } as any });
        toast.success('Template updated');
      } else {
        await createTemplateMutation.mutateAsync({ name: tplForm.name || 'New Template', body: tplForm.body, type: tplForm.type, creditCost: Number(tplForm.creditCost) || 1 });
        toast.success('Template created');
      }
      setTemplateModal(false);
      setEditingTemplate(null);
    } catch (e) { toast.error('Failed', (e as Error).message); }
  };

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: () => t('apiKeys.columns.name'),
          cell: info => <span className="name-cell">{info.getValue()}</span>,
        }),
        columnHelper.accessor('role', {
          header: () => 'Role / Panel',
          cell: info => {
            const r = info.getValue() as string;
            const label = r === 'reseller' ? 'Reseller Panel' : r === 'user' ? 'User Panel' : r;
            const color = r === 'reseller' ? '#7c3aed' : r === 'user' ? '#0ea5e9' : r === 'admin' || r === 'super_admin' ? '#dc2626' : '#64748b';
            return <span className="permission-badge" style={{ background: color, color: '#fff', padding: '2px 8px', borderRadius: 999 }}>{label} ({r})</span>;
          },
        }),
        columnHelper.display({
          id: 'credits',
          header: () => 'Credits (used / total · remaining)',
          cell: info => {
            const k = info.row.original as any;
            const isCreditRole = ['reseller','user','demo'].includes(k.role);
            if (!isCreditRole && k.credits == null) return <span style={{ color: '#94a3b8' }}>Admin — unlimited</span>;
            const remaining = k.credits != null ? (k.credits - (k.creditsUsed || 0)) : null;
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <Coins size={14} /> {k.creditsUsed || 0} / {k.credits ?? '∞'} {remaining != null && <small style={{ color: remaining < 10 ? '#ef4444' : '#64748b', fontWeight: 400 }}>({remaining} left)</small>}
              </span>
            );
          },
        }),
        columnHelper.accessor('isActive', {
          header: () => t('apiKeys.columns.status'),
          cell: info => (
            <span className={`status-badge ${info.getValue() ? 'active' : 'inactive'}`}>
              {info.getValue() ? t('apiKeys.statuses.active') : t('apiKeys.statuses.revoked')}
            </span>
          ),
        }),
        columnHelper.accessor('lastUsedAt', {
          id: 'lastUsed',
          header: () => t('apiKeys.columns.lastUsed'),
          cell: info => <span className="last-used">{info.getValue() ? new Date(info.getValue()!).toLocaleDateString() : t('common.never')}</span>,
        }),
        columnHelper.display({
          id: 'actions',
          header: () => t('apiKeys.columns.actions'),
          cell: info => {
            const apiKey = info.row.original;
            const canManageCredits = apiKey.isActive && ((apiKey as any).role === 'reseller' || (apiKey as any).role === 'user' || (apiKey as any).role === 'demo') && (isAdmin || userRole === 'reseller');
            const canChangePw = (isAdmin || userRole === 'reseller') && (apiKey as any).role !== 'admin' && (apiKey as any).role !== 'super_admin';
            return (
              <span className="actions-cell">
                {canManageCredits && (
                  <button className="icon-btn" onClick={() => setCreditModal({ id: apiKey.id, name: apiKey.name })} title="Credits — add/deduct & history"><Coins size={16} /></button>
                )}
                {canChangePw && (
                  <button className="icon-btn" onClick={() => setResellerPwModal({ id: apiKey.id, email: apiKey.name })} title="Change password (reseller→user)"><Key size={16} /></button>
                )}
                {apiKey.isActive && (
                  <button className="icon-btn" onClick={() => setConfirmAction({ type: 'revoke', id: apiKey.id, name: apiKey.name })} title={t('apiKeys.actions.revoke')}><RefreshCw size={16} /></button>
                )}
                <button className="icon-btn danger" onClick={() => setConfirmAction({ type: 'delete', id: apiKey.id, name: apiKey.name })} title={t('apiKeys.actions.delete')}><Trash2 size={16} /></button>
              </span>
            );
          },
        }),
      ]),
    [t],
  );

  const table = useTable({ features, data: filteredApiKeys as any, columns, state: { columnVisibility }, onColumnVisibilityChange: setColumnVisibility });

  if (loading) {
    return <div className="api-keys-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><Loader2 className="animate-spin" size={32} /></div>;
  }

  return (
    <div className="api-keys-page">
      <PageHeader
        title="Manage Users"
        subtitle="Create reseller and user accounts, allocate credits, and manage access"
        actions={<>
          <button className="btn-secondary" onClick={()=> setOwnPwModal(true)} style={{ display:'flex', alignItems:'center', gap:6 }}><Key size={14}/> Change My Password</button>
          {isAdmin && <button className="btn-secondary" onClick={() => { setTplForm({ name: '', body: '', type: 'text', creditCost: '1' }); setEditingTemplate(null); setTemplateModal(true); }}><Edit2 size={16} /> Manage Message Credits</button>}
          <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={18} />Manage</button>
        </>}
      />

      {apiKeysError && <div className="error-banner" role="alert"><AlertCircle size={20} /><span className="error-banner-text">{t('dashboard.loadError')}</span></div>}

      {/* Reseller vs User credit overview — admin sees both panels */}
      {(() => {
        const resellers = apiKeys.filter((k: any) => k.role === 'reseller');
        const users = apiKeys.filter((k: any) => k.role === 'user' || k.role === 'demo');
        const sum = (arr: any[]) => arr.reduce((a, k) => a + (k.credits ?? 0), 0);
        const used = (arr: any[]) => arr.reduce((a, k) => a + (k.creditsUsed ?? 0), 0);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ border: '1px solid #7c3aed', borderRadius: 12, padding: 12, background: 'var(--card-bg, #1e293b)', color: 'var(--text, #e2e8f0)' }}>
              <div style={{ fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={16} /> Reseller Panel — {resellers.length} resellers</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>{used(resellers)} / {sum(resellers) || '∞'} credits used · {Math.max(0, sum(resellers)-used(resellers))} remaining</div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{resellers.slice(0,6).map((r: any) => <span key={r.id} style={{ fontSize: 12, background: 'var(--bg-secondary, #0f172a)', border: '1px solid var(--border, #334155)', borderRadius: 999, padding: '2px 8px', color: 'var(--text, #e2e8f0)' }}>{r.name}: {r.creditsUsed||0}/{r.credits??'∞'}</span>)}{resellers.length>6 && <small style={{ color: 'var(--text-muted)' }}>+{resellers.length-6} more</small>}</div>
            </div>
            <div style={{ border: '1px solid #0ea5e9', borderRadius: 12, padding: 12, background: 'var(--card-bg, #1e293b)', color: 'var(--text, #e2e8f0)' }}>
              <div style={{ fontWeight: 700, color: '#0ea5e9', display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={16} /> User Panel — {users.length} users</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>{used(users)} / {sum(users) || '∞'} credits used · {Math.max(0, sum(users)-used(users))} remaining</div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{users.slice(0,6).map((u: any) => <span key={u.id} style={{ fontSize: 12, background: 'var(--bg-secondary, #0f172a)', border: '1px solid var(--border, #334155)', borderRadius: 999, padding: '2px 8px', color: 'var(--text, #e2e8f0)' }}>{u.name}: {u.creditsUsed||0}/{u.credits??'∞'}</span>)}{users.length>6 && <small style={{ color: 'var(--text-muted)' }}>+{users.length-6} more</small>}</div>
            </div>
          </div>
        );
      })()}

      {/* Credit Templates - admin only */}
      {isAdmin && (
        <div className="credit-templates-panel">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Coins size={18} /> Message Credit Costs (admin editable)</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Each message type has its own credit cost. Text=1, Image/PDF=2 by default. Admin can edit content and cost; demo users consume credits per send.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12, marginTop: 12 }}>
            {creditTemplates.map((tpl: any) => (
              <div key={tpl.id} style={{ border: '1px solid var(--border, #334155)', borderRadius: 10, padding: 12, background: 'var(--card-bg, #1e293b)', color: 'var(--text, #e2e8f0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{tpl.name} <small style={{ color: 'var(--text-muted, #94a3b8)' }}>{tpl.type}</small></strong>
                  <span style={{ background: 'var(--bg-secondary, #334155)', color: 'var(--text, #e2e8f0)', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}><Coins size={12} /> {tpl.creditCost} credits</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto', background: 'var(--bg-secondary, #0f172a)', color: 'var(--text, #e2e8f0)', padding: 8, borderRadius: 6, border: '1px solid var(--border, #334155)' }}>{tpl.body.slice(0, 200)}{tpl.body.length > 200 ? '…' : ''}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => { setEditingTemplate(tpl); setTplForm({ name: tpl.name, body: tpl.body, type: tpl.type, creditCost: String(tpl.creditCost) }); setTemplateModal(true); }}><Edit2 size={12} /> Edit</button>
                  <button className="btn-danger" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => deleteTemplateMutation.mutate(tpl.id)}><Trash2 size={12} /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <Modal open onClose={() => { setShowModal(false); setCreatedKey(null); }} title={createdKey ? t('apiKeys.createdTitle') : t('apiKeys.modalTitle')} closeLabel={t('common.close')}
          footer={!createdKey ? <>
            <button className="btn-secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={handleCreate} disabled={!newKey.name}>{t('common.create')}</button>
          </> : undefined}
        >
          {createdKey ? (
            <div>
              <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Account created successfully. The user can sign in with the email and password you provided.</p>
            </div>
          ) : (
            <>
              <label htmlFor="ak-1">{t('common.name')}</label>
              <input id="ak-1" type="text" placeholder={t('apiKeys.namePlaceholder')} value={newKey.name} onChange={e => setNewKey({ ...newKey, name: e.target.value })} />
              <label htmlFor="ak-2">{t('common.role')}</label>
              <select id="ak-2" value={newKey.role} onChange={e => setNewKey({ ...newKey, role: e.target.value })}>
                {availableRoles.slice(0,4).map(r => <option key={r} value={r}>{t(`apiKeys.roles.${r}`) ?? r}</option>)}
                {/* {!availableRoles.includes('demo' as any) && <option value="demo">demo</option>} */}
              </select>
              <div>
                <br />
                <span>Create UserName and Password</span>
                <div style={{ marginTop:10, padding: 12, border: '1px solid #e2e8f0', borderRadius: 8,  display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label>Login ID</label>
                  <input type="text" value={newKey.email} onChange={e => setNewKey({ ...newKey, email: e.target.value })} placeholder="vikas@vikas.com / vikas123 / vikas_12345" />
                  <label>Password (for login)</label>
                  <div style={{display: 'flex', alignItems : 'center', gap: 10, cursor: 'pointer'}}>
                    <input type={showpass ? "text" : "password"} value={newKey.password} onChange={e => setNewKey({ ...newKey, password: e.target.value })} placeholder="••••••••" />
                  <button style={{}} onClick={() => setShowPass(!showpass)}>{showpass ? "Hide" : "Show"}</button>
                  </div>
                  <small style={{ color: '#64748b' }}>Login ID can be any format: vikas@vikas.com, vikas123, vikas_12345, vikas-12345677. The account signs in via dashboard login using this ID and password.</small>
                  <label>Credits to allocate</label>
                  <input type="number" value={newKey.credits} onChange={e => setNewKey({ ...newKey, credits: e.target.value })} placeholder="100" />
                  {isAdmin && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                      <label>Text cost<input type="number" value={newKey.textCost} onChange={e => setNewKey({ ...newKey, textCost: e.target.value })} /></label>
                      <label>Image cost<input type="number" value={newKey.imageCost} onChange={e => setNewKey({ ...newKey, imageCost: e.target.value })} /></label>
                      <label>File/PDF cost<input type="number" value={newKey.docCost} onChange={e => setNewKey({ ...newKey, docCost: e.target.value })} /></label>
                    </div>
                  )}
                  <small style={{ color: '#64748b' }}>{userRole==='reseller' ? `Reseller: ${newKey.credits||0} credits will be deducted from your balance (remaining = your credits − allocated).` : 'Usage shown per user: sent vs remaining. For reseller, allocations deduct from parent credits.'}</small>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {creditModal && (
        <Modal open onClose={() => setCreditModal(null)} title={`Credits — ${creditModal.name}`}>
          {(() => {
            const k = (apiKeys as any[]).find(x => x.id === creditModal.id);
            const remaining = k ? (k.credits != null ? (k.credits - (k.creditsUsed || 0)) : null) : null;
            return (
              <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-secondary, #0f172a)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Coins size={14} /> {k?.creditsUsed || 0} / {k?.credits ?? '∞'} used · {remaining != null ? `${remaining} remaining` : 'unlimited'} {k?.credits != null && remaining != null && remaining < 10 && <span style={{ color: '#ef4444' }}>(low)</span>}</div>
                <small style={{ color: 'var(--text-muted)' }}>Own raise = credit_add, reseller allocations = credit_allocate, usage = text/image etc., deduct = credit_deduct</small>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <label>Amount to add (from your balance if reseller)</label>
              <input type="number" value={addAmount} onChange={e => setAddAmount(e.target.value)} />
              <button className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={handleAddCredits} disabled={addCreditsMutation.isPending}><Coins size={14} /> Add Credits</button>
              <small style={{ color: '#64748b' }}>{userRole==='reseller' ? 'Deducts from your own credits and gives to this user' : 'Admin adds credits directly'}</small>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <label>Amount to deduct (return to you)</label>
              <input type="number" value={deductAmount} onChange={e => setDeductAmount(e.target.value)} />
              <button className="btn-secondary" style={{ marginTop: 8, width: '100%' }} onClick={handleDeductCredits} disabled={deductCreditsMutation.isPending}>Deduct Credits</button>
              <small style={{ color: '#64748b' }}>Only reseller → own users. Returns credits to your balance.</small>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => setCreditModal(null)}>{t('common.close')}</button>
          </div>
          <h4 style={{ marginTop: 16 }}>Credit history — allocations, deductions & usage</h4>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 8px' }}>Shows admin/superadmin → reseller and reseller → user allocations, plus per-message usage (own credits raise & consumption).</p>
          {creditHistory.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No usage recorded yet — allocations from admin/reseller and message usage will appear here.</p> : (
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {creditHistory.map(entry => {
                const isAdd = entry.messageType === 'credit_add';
                const isAllocate = entry.messageType === 'credit_allocate';
                const isDeduct = entry.messageType === 'credit_deduct';
                const isUsage = !['credit_add','credit_allocate','credit_deduct'].includes(entry.messageType);
                const color = isAdd ? '#16a34a' : isAllocate ? '#7c3aed' : isDeduct ? '#dc2626' : '#0ea5e9';
                const sign = entry.units > 0 ? `+${entry.units}` : `${entry.units}`;
                return (
                  <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--border)', background: isUsage ? 'transparent' : 'var(--bg-secondary, #f8fafc)' }}>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, color }}>{sign} <small style={{ textTransform: 'uppercase', fontSize: 11 }}>{entry.messageType}</small></span>
                      {entry.reference && <small style={{ color: '#64748b', fontSize: 11 }}>{entry.reference}</small>}
                    </span>
                    <small style={{ textAlign: 'right' }}>{entry.balanceAfter} left<br />{new Date(entry.createdAt).toLocaleString()}</small>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {templateModal && (
        <Modal open onClose={() => { setTemplateModal(false); setEditingTemplate(null); }} title={editingTemplate ? 'Edit Message' : 'Create Message Template'}>
          <label>Name</label><input value={tplForm.name} onChange={e => setTplForm({ ...tplForm, name: e.target.value })} placeholder="Default Text" />
          <label>Type</label>
          <select value={tplForm.type} onChange={e => setTplForm({ ...tplForm, type: e.target.value })}>
            <option value="text">Text (1 credit)</option>
            <option value="image">Image (+file) (2 credits)</option>
            <option value="document">File/PDF (2 credits)</option>
            <option value="video">Video</option>
          </select>
          <label>Body (editable by admin)</label>
          <textarea rows={6} value={tplForm.body} onChange={e => setTplForm({ ...tplForm, body: e.target.value })} />
          <label>Credit cost for this message</label><input type="number" value={tplForm.creditCost} onChange={e => setTplForm({ ...tplForm, creditCost: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn-secondary" onClick={() => setTemplateModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreateTemplate}>{editingTemplate ? 'Update' : 'Create'}</button>
          </div>
        </Modal>
      )}

      {ownPwModal && (
        <Modal open onClose={()=> setOwnPwModal(false)} title="Change My Password">
          <label>Current password</label><input type="password" value={ownOldPw} onChange={e=> setOwnOldPw(e.target.value)} placeholder="Current" />
          <label>New password (min 3)</label><input type="password" value={ownNewPw} onChange={e=> setOwnNewPw(e.target.value)} placeholder="New" />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn-secondary" onClick={()=> setOwnPwModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleOwnPw}>Update</button>
          </div>
        </Modal>
      )}
      {resellerPwModal && (
        <Modal open onClose={()=> setResellerPwModal(null)} title={`Change password — ${resellerPwModal.email}`}>
          <p style={{ fontSize:12, color:'var(--text-muted)' }}>Reseller can change password of users they created. Admin can change any.</p>
          <label>New password (min 3)</label><input type="password" value={newPwForUser} onChange={e=> setNewPwForUser(e.target.value)} placeholder="New password" />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn-secondary" onClick={()=> setResellerPwModal(null)}>Cancel</button>
            <button className="btn-primary" onClick={handleResellerPw}>Update</button>
          </div>
        </Modal>
      )}

      <div style={{ position:'relative', marginBottom:12, maxWidth:420 }}>
        <Search size={16} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
        <input
          value={tableSearch}
          onChange={e=> setTableSearch(e.target.value)}
          placeholder={`${t('common.search')} users, role, credits...`}
          style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-white)', color:'var(--text-primary)', fontSize:13 }}
        />
        {tableSearch && <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:11, color:'var(--text-muted)' }}>{filteredApiKeys.length}/{apiKeys.length}</span>}
      </div>

      <div className="api-keys-content">
        <div className="keys-table-container">
          {filteredApiKeys.length === 0 ? (
            <div className="empty-table-state"><KeyRound size={48} strokeWidth={1} /><h3>{apiKeys.length===0 ? t('apiKeys.empty.title') : `No match for "${tableSearch}"`}</h3><p>{apiKeys.length===0 ? t('apiKeys.empty.description') : `No users match your search`}</p></div>
          ) : (
            <table className="keys-table">
              <thead>{table.getHeaderGroups().map(headerGroup => (<tr key={headerGroup.id} className="table-row header">{headerGroup.headers.map(header => (<th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>))}</tr>))}</thead>
              <tbody>{table.getRowModel().rows.map(row => (<tr key={row.id} className="table-row">{row.getVisibleCells().map(cell => (<td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>))}</tr>))}</tbody>
            </table>
          )}
        </div>

        <div className="permissions-reference">
          <h3>{t('apiKeys.rolesTitle')}</h3>
          <div className="permissions-list">
            {roleNames.map(r => (<div key={r} className="perm-item"><code>{r}</code><span>{t(`apiKeys.roleDescriptions.${r}`) ?? `${r} account — messaging, campaigns, contacts and session access`}</span></div>))}
          </div>
          <div style={{ marginTop: 12, padding: 12, background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border, #334155)', color: 'var(--text-muted, #94a3b8)', borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: 'var(--text, #e2e8f0)' }}>Demo user panel:</strong> When you create a demo user with credits (e.g. 10 or 100), that user’s dashboard will only show <em>Campaigns</em> and <em>Dashboard stats</em>. Usage is tracked per message type (text/image/file) using the costs above.
          </div>
        </div>
      </div>

      {confirmAction && (
        <Modal open onClose={() => setConfirmAction(null)} title={confirmAction.type === 'delete' ? t('apiKeys.confirm.deleteTitle') : t('apiKeys.confirm.revokeTitle')} className="confirm-modal" closeLabel={t('common.close')}
          footer={<>
            <button className="btn-secondary" onClick={() => setConfirmAction(null)}>{t('common.cancel')}</button>
            <button className="btn-danger" onClick={confirmAndExecute}>{confirmAction.type === 'delete' ? t('apiKeys.confirm.delete') : t('apiKeys.confirm.revoke')}</button>
          </>}
        >
          <div className="confirm-icon-wrapper"><AlertTriangle size={48} className="confirm-warning-icon" /></div>
          <p className="confirm-message"><Trans i18nKey={confirmAction.type === 'delete' ? 'apiKeys.confirm.deleteMessage' : 'apiKeys.confirm.revokeMessage'} values={{ name: confirmAction.name }} components={{ strong: <strong /> }} /></p>
        </Modal>
      )}
    </div>
  );
}
