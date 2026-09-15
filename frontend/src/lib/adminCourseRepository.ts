const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type AdminCourseStatus = 'draft' | 'published' | 'review' | 'archived' | 'rejected';

export type AdminCourse = {
  id: string;
  instructor_id: string;
  title: string;
  description: string;
  thumbnail_url?: string | null;
  price?: number;
  status: AdminCourseStatus;
  is_published: boolean;
  is_featured: boolean;
  modules?: Array<{ id: string; title: string; position: number; lessons: Array<{ id: string; title: string; video_url?: string | null; attachment_url?: string | null }> }>;
};

export type AdminCourseInspector = {
  course: AdminCourse;
  instructor: { id: string; full_name: string } | null;
  stats: { enrollment_count: number; completed_count: number; revenue: number };
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === 'object' ? payload.detail?.error : payload.detail;
    throw new Error(payload.error ?? detail ?? 'Admin course request failed.');
  }
  return (payload.data ?? payload) as T;
}

export function normalizeAdminMediaUrl(value: string | null | undefined, kind: 'thumbnail' | 'video' | 'attachment') {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('blob:')) return null;
  if (/^(https?:|data:|\/uploads\/)/i.test(trimmed)) return trimmed;
  const safeName = trimmed.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._/-]/g, '_');
  const folder = kind === 'video' ? 'videos' : kind === 'attachment' ? 'attachments' : 'thumbnails';
  return `/uploads/${folder}/${safeName}`;
}

export async function fetchAdminCourses() {
  return request<AdminCourse[]>('/api/admin/courses');
}

export async function fetchAdminCourseInspector(courseId: string) {
  return request<AdminCourseInspector>(`/api/admin/courses/${encodeURIComponent(courseId)}/inspector`);
}

export async function updateAdminCourseStatus(courseId: string, status: AdminCourseStatus) {
  return request<AdminCourse>(`/api/admin/courses/${encodeURIComponent(courseId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function updateAdminCourse(courseId: string, values: { instructor_id?: string; is_featured?: boolean }) {
  return request<AdminCourse>(`/api/admin/courses/${encodeURIComponent(courseId)}`, { method: 'PATCH', body: JSON.stringify(values) });
}

export async function deleteAdminCourse(courseId: string) {
  return request<{ deleted: boolean }>(`/api/admin/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
}