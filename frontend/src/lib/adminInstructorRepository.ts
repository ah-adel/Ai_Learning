import type { AdminCourse } from '@/lib/adminCourseRepository';
import { extractApiErrorMessage } from '@/lib/apiError';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type PayoutStatus = 'pending' | 'paid';

export type AdminInstructor = {
  id: string;
  name: string;
  email: string;
  specialty?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  verification_status: VerificationStatus;
  verification_document_url?: string | null;
  is_verified: boolean;
  payout_status: PayoutStatus;
  payout_processed_at?: string | null;
  total_courses: number;
  enrolled_students: number;
  total_earnings: number;
  platform_commission: number;
  joined_at?: string | null;
  permissions?: Record<string, boolean | number>;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractApiErrorMessage(payload, response.status));
  return (payload.data ?? payload) as T;
}

export function fetchAdminInstructors() { return request<AdminInstructor[]>('/api/admin/instructors'); }
export function createAdminInstructor(payload: { full_name: string; email: string; password: string; specialty: string; status: AdminInstructor['status']; permissions: Record<string, boolean>; course_ids: string[] }) { return request<AdminInstructor>('/api/admin/instructors', { method: 'POST', body: JSON.stringify(payload) }); }
export function updateAdminInstructor(instructorId: string, values: Partial<Pick<AdminInstructor, 'name' | 'email' | 'specialty' | 'verification_status' | 'is_verified' | 'payout_status' | 'status' | 'permissions'>>) { return request<Partial<AdminInstructor>>(`/api/admin/instructors/${encodeURIComponent(instructorId)}`, { method: 'PATCH', body: JSON.stringify({ ...values, ...(values.name ? { full_name: values.name } : {}) }) }); }
export function deleteAdminInstructor(instructorId: string) { return request<{ deleted: boolean }>(`/api/admin/instructors/${encodeURIComponent(instructorId)}`, { method: 'DELETE' }); }
export function prepareInstructorImpersonation(instructorId: string) { return request<{ user_id: string; role: 'instructor'; email: string; access_token: string }>(`/api/admin/instructors/${encodeURIComponent(instructorId)}/impersonate`, { method: 'POST' }); }
export function reassignInstructorCourses(instructorId: string, courseIds: string[]) { return request<{ reassigned: boolean }>(`/api/admin/instructors/${encodeURIComponent(instructorId)}/courses`, { method: 'PUT', body: JSON.stringify({ course_ids: courseIds }) }); }
export function fetchAdminCourseInventory() { return request<AdminCourse[]>('/api/admin/courses'); }