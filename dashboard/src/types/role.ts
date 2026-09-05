// Role types for RBAC - DC Infotech: admin > reseller > user > demo
export type UserRole = 'admin' | 'operator' | 'viewer' | 'demo' | 'reseller' | 'user' | 'super_admin';

export interface RoleContextType {
  role: UserRole | null;
  setRole: (role: UserRole | null) => void;
  isAdmin: boolean;
  isOperator: boolean;
  isViewer: boolean;
  isDemo: boolean;
  isReseller: boolean;
  isUser: boolean;
  canWrite: boolean;
}
