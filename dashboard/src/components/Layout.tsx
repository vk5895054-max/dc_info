import { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  // Webhook, // commented per request - hidden from nav
  FileText,
  ClipboardList,
  Users,
  Workflow,
  LogOut,
  // Send, // Message Tester - commented per request
  // Server, // Infrastructure - commented per request
  // Puzzle, // Plugins - commented per request
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  // Languages, // Language switcher - commented per request
  UserCircle,
  History,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { type UserRole } from '../hooks/useRole';
// import { languageOptions, resolveSupportedLanguage, rtlLanguages, type SupportedLanguage } from '../i18n';
import { healthApi } from '../services/api';
import './Layout.css';

interface LayoutProps {
  onLogout: () => void;
  userRole: UserRole | null;
}

const allNavItems = [
  { to: '/', icon: LayoutDashboard, key: 'dashboard' as const, roles: ['admin','super_admin','reseller','user','demo','operator','viewer'] },
  { to: '/sessions', icon: Smartphone, key: 'sessions' as const, roles: ['admin','super_admin'] },
  { to: '/chats', icon: MessageSquare, key: 'chats' as const, roles: ['admin','super_admin'] },
  // { to: '/webhooks', icon: Webhook, key: 'webhooks' as const, roles: ['admin','super_admin'] }, // commented per request
  { to: '/templates', icon: ClipboardList, key: 'templates' as const, roles: ['admin','super_admin','reseller'] },
  { to: '/contacts', icon: Users, key: 'contacts' as const, roles: ['admin','super_admin'] },
  { to: '/campaigns', icon: Workflow, key: 'campaigns' as const, roles: ['admin','super_admin','reseller','user','demo'] },
  { to: '/campaign-history', icon: History, key: 'campaignHistory' as const, roles: ['admin','super_admin'] },
  { to: '/template-history', icon: FileText, key: 'templateHistory' as const, roles: ['admin','super_admin'] },
  { to: '/api-keys', icon: Users, key: 'apiKeys' as const, roles: ['admin','super_admin','reseller'] },
  // { to: '/message-tester', icon: Send, key: 'messageTester' as const, roles: ['admin','super_admin','reseller','user','demo'] }, // commented per request
  // { to: '/infrastructure', icon: Server, key: 'infrastructure' as const, roles: ['admin','super_admin'] }, // commented per request
  // { to: '/plugins', icon: Puzzle, key: 'plugins' as const, roles: ['admin','super_admin'] }, // commented per request
  { to: '/logs', icon: FileText, key: 'logs' as const, roles: ['admin','super_admin'] },
];

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export function Layout({ onLogout, userRole }: LayoutProps) {
  const { t } = useTranslation();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const ThemeIcon = themeIcons[theme];
  const themeLabel = t(`theme.${theme}`);

  const navItems = allNavItems.filter(item => {
    if (!userRole) return false;
    return (item as any).roles.includes(userRole);
  });

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  // Show the build-time version immediately, then replace it with the live running version from the
  // backend so a stale-built bundle can't display the wrong number. Falls back silently on error.
  const [version, setVersion] = useState(__APP_VERSION__);
  // const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  // const languageMenuRef = useRef<HTMLDivElement>(null); // language switcher commented

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let active = true;
    healthApi
      .check()
      .then(info => {
        if (active && info?.version) setVersion(info.version);
      })
      .catch(() => {
        /* keep the build-time fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleNavClick = () => {
    if (isMobile) setIsMobileOpen(false);
  };

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  // language switcher logic commented per request
  const toggleCollapse = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);
  const isRtl = false; // rtl disabled with language switcher

  return (
    <div className="layout">
      {isMobile && (
        <header className="mobile-header">
          <button className="mobile-menu-btn" onClick={toggleMobile} aria-label={t('common.expand')}>
            {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div className="mobile-brand">
            <img src="/img.jpeg" alt="DC Infotech" className="sidebar-logo" />
            <span className="brand-name">{t('common.appName')}</span>
          </div>
          <div style={{ width: 40 }} />
        </header>
      )}

      {isMobile && isMobileOpen && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''} ${isMobileOpen ? 'open' : ''}`}
      >
        <div className="sidebar-header">
          <img src="/img.jpeg" alt="DC Infotech" className="sidebar-logo" />
          {!isCollapsed && (
            <div className="sidebar-brand">
              <span className="brand-name">{t('common.appName')}</span>
              <span className="brand-version">v{version}</span>
            </div>
          )}
        </div>
        {!isCollapsed && userRole && (
          <div style={{ margin: '8px 12px', padding: '8px 10px', borderRadius: 10, background: 'var(--bg-secondary, #1e293b)', border: '1px solid var(--border, #334155)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserCircle size={20} style={{ color: userRole==='reseller' ? '#7c3aed' : userRole==='user' ? '#0ea5e9' : userRole==='admin' || userRole==='super_admin' ? '#ef4444' : '#64748b' }} />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text, #e2e8f0)' }}>{userRole === 'super_admin' ? 'Super Admin Panel' : userRole === 'admin' ? 'Admin Panel' : userRole === 'reseller' ? 'Reseller Panel' : userRole === 'user' ? 'User Panel' : `${userRole} Panel`}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>{(() => { try { return sessionStorage.getItem('openwa_admin_email') || ''; } catch { return ''; }})()}</span>
            </div>
          </div>
        )}

        {!isMobile && (
          <button
            className="collapse-toggle"
            onClick={toggleCollapse}
            title={isCollapsed ? t('common.expand') : t('common.collapse')}
            aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
          >
            {isCollapsed ? (
              isRtl ? (
                <ChevronLeft size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            ) : isRtl ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        )}

        <nav className="sidebar-nav">
          {navItems.map(({ to, icon: Icon, key }) => {
            const label = t(`nav.${key}`);
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                end={to === '/'}
                onClick={handleNavClick}
                title={isCollapsed ? label : undefined}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {/* Language switcher commented per request */}
          <div className="appearance-menu">
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              title={t('theme.toggleTo', { value: t(resolvedTheme === 'dark' ? 'theme.light' : 'theme.dark') })}
              aria-label={t('theme.toggleTo', { value: t(resolvedTheme === 'dark' ? 'theme.light' : 'theme.dark') })}
            >
              <span className="appearance-button-cue" aria-hidden="true">
                <ThemeIcon size={16} />
              </span>
              {!isCollapsed && <span>{themeLabel}</span>}
            </button>
          </div>
          <button className="logout-btn" onClick={onLogout} title={isCollapsed ? t('common.logout') : undefined}>
            <LogOut size={20} />
            {!isCollapsed && <span>{t('common.logout')}</span>}
          </button>
        </div>
      </aside>

      <main className={`main-content ${isCollapsed ? 'expanded' : ''} ${isMobile ? 'mobile' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
