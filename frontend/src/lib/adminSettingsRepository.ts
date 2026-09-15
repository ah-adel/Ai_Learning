export type AdminSettings = {
  platform_name: string;
  support_email: string;
  currency: string;
  default_language: string;
  default_theme: 'system' | 'light' | 'dark';
  enforce_mfa: boolean;
  jwt_expiration_minutes: number;
  password_min_length: number;
  password_require_uppercase: boolean;
  password_require_number: boolean;
  password_require_symbol: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_from_email: string;
  smtp_use_tls: boolean;
};

export type StorageSnapshot = { videos: { bytes: number; files: number }; attachments: { bytes: number; files: number } };
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === 'object' ? payload.detail?.error : payload.detail;
    throw new Error(payload.error ?? detail ?? 'Admin settings request failed.');
  }
  return (payload.data ?? payload) as T;
}

export function fetchAdminSettings() { return request<AdminSettings>('/api/admin/settings'); }
export function saveAdminSettings(settings: AdminSettings) { return request<AdminSettings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }); }
export function fetchStorageSnapshot() { return request<StorageSnapshot>('/api/admin/storage'); }
export function runStorageCleanup() { return request<{ deleted_files: string[]; errors: Array<{ path: string; message: string }>; storage: StorageSnapshot }>('/api/admin/storage/cleanup', { method: 'POST' }); }
export function sendTestEmail(payload: { recipient: string; host: string; port: number; username: string; password: string; from_email: string; use_tls: boolean }) { return request<{ sent: boolean }>('/api/admin/settings/test-email', { method: 'POST', body: JSON.stringify(payload) }); }