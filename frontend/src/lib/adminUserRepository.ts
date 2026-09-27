import { extractApiErrorMessage } from '@/lib/apiError';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'instructor' | 'admin';
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string | null;
  specialty?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AdminUserCreate = {
  full_name: string;
  email: string;
  password: string;
  role: AdminUser['role'];
  status?: AdminUser['status'];
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error('Unable to connect to the server.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractApiErrorMessage(payload, response.status));
  return (payload.data ?? payload) as T;
}

export function fetchAdminUsers() {
  return request<AdminUser[]>('/api/admin/users');
}

export function createAdminUser(payload: AdminUserCreate) {
  return request<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
}

export function createAdminAdministrator(payload: Omit<AdminUserCreate, 'role'>) {
  return createAdminUser({ ...payload, role: 'admin' });
}

export function deleteAdminUser(userId: string) {
  return request<{ deleted: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}