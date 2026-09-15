import { useEffect, useMemo, useState } from 'react';
import { Ban, Download, Mail, RefreshCw, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { StudentsPage } from './StudentsPage';
import { useTranslation } from '@/context/I18nContext';

type Student = { id: string; name: string; email: string; status: 'active' | 'inactive' | 'suspended'; created_at: string; course_count: number; progress: number };
type Inspector = { student: Student; total_enrolled_courses: number; progress: number; platform_time_minutes: number; completion_certificates: number; enrollments: Array<{ id: string; title: string; completed_at: string | null }>; audit_log: Array<{ event: string; occurred_at: string; ip_address?: string }> };

export function AdminStudentsPage() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = window.sessionStorage.getItem('learnflow_session_token');
    const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    return payload.data as T;
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const data = await request<{ items: Student[]; total: number }>(`/api/admin/students?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}&status_filter=${status}&sort_by=${sortBy}`);
      setStudents(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load students.'); } finally { setLoading(false); }
  };

  useEffect(() => { if (profile?.role === 'admin') void loadStudents(); }, [profile?.role, page, pageSize, search, status, sortBy]);

  if (profile?.role !== 'admin') return <StudentsPage />;

  const selectedAll = students.length > 0 && students.every((student) => selected.includes(student.id));
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const mutateStatus = async (ids: string[], nextStatus: 'active' | 'suspended') => {
    try { await Promise.all(ids.map((id) => request(`/api/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }))); setStudents((current) => current.map((student) => ids.includes(student.id) ? { ...student, status: nextStatus } : student)); setSelected([]); setMessage(`Updated ${ids.length} student account(s).`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update students.'); }
  };
  const openInspector = async (id: string) => { try { setInspector(await request<Inspector>(`/api/admin/students/${id}`)); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load student profile.'); } };
  const deleteStudent = async (id: string) => { if (!window.confirm(t('common.deleteConfirm'))) return; try { await request(`/api/admin/users/${id}`, { method: 'DELETE' }); setStudents((current) => current.filter((student) => student.id !== id)); setMessage('Student account deleted.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete student.'); } };
  const resetPassword = async (id: string) => { try { await request(`/api/admin/students/${id}/reset-password`, { method: 'POST' }); setMessage('Password reset notification queued.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to reset password.'); } };
  const forceEnrollment = async (id: string) => { const courseId = window.prompt(t('common.selectCourseId')); if (!courseId) return; try { await request(`/api/admin/students/${id}/force-enrollment`, { method: 'POST', body: JSON.stringify({ course_id: courseId }) }); setMessage('Student enrolled successfully.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to enroll student.'); } };
  const exportCsv = () => { const rows = students.filter((student) => selected.includes(student.id)); const csv = [['Name', 'Email', 'Status', 'Courses', 'Progress'], ...rows.map((student) => [student.name, student.email, student.status, String(student.course_count), `${student.progress}%`])].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'students.csv'; link.click(); URL.revokeObjectURL(link.href); };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{t('students.operations')}</p><h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('students.management')}</h1></div><button type="button" onClick={() => void loadStudents()} className="btn-secondary"><RefreshCw className="h-4 w-4" />{t('common.refresh')}</button></div>
    <div className="card flex flex-wrap gap-3 p-4"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search name or email" className="input-field pl-10" /></div><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="input-field w-44"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="input-field w-44"><option value="created_at">Newest</option><option value="name">Name</option><option value="email">Email</option><option value="status">Status</option></select></div>
    {selected.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-950/20"><span className="mr-2 text-sm font-semibold">{selected.length} selected</span><button type="button" onClick={() => void mutateStatus(selected, 'suspended')} className="btn-secondary"><Ban className="h-4 w-4" />Bulk suspend</button><button type="button" onClick={async () => { try { await request('/api/admin/students/bulk-notify', { method: 'POST', body: JSON.stringify({ student_ids: selected }) }); setMessage('Email notifications queued.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to queue emails.'); } }} className="btn-secondary"><Mail className="h-4 w-4" />Email notification</button><button type="button" onClick={exportCsv} className="btn-secondary"><Download className="h-4 w-4" />Export CSV</button></div>}
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/60"><tr><th className="px-5 py-3"><input type="checkbox" checked={selectedAll} onChange={() => setSelected(selectedAll ? [] : students.map((student) => student.id))} aria-label="Select all students" /></th><th className="px-5 py-3">Student</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Courses</th><th className="px-5 py-3">Progress</th><th className="px-5 py-3">Actions</th></tr></thead><tbody>{loading ? [1, 2, 3].map((item) => <tr key={item}><td colSpan={6} className="px-5 py-5"><div className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>) : students.map((student) => <tr key={student.id} className="border-t border-gray-200 dark:border-gray-800"><td className="px-5 py-4"><input type="checkbox" checked={selected.includes(student.id)} onChange={() => toggleSelected(student.id)} aria-label={`Select ${student.name}`} /></td><td className="px-5 py-4"><button type="button" onClick={() => void openInspector(student.id)} className="text-left"><p className="font-semibold text-gray-900 hover:text-primary-600 dark:text-white">{student.name}</p><p className="text-xs text-gray-500">{student.email}</p></button></td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs ${student.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{student.status}</span></td><td className="px-5 py-4">{student.course_count}</td><td className="px-5 py-4">{student.progress}%</td><td className="px-5 py-4"><div className="flex flex-wrap gap-1"><button type="button" title="Suspend" onClick={() => void mutateStatus([student.id], student.status === 'suspended' ? 'active' : 'suspended')} className="rounded p-1.5 hover:bg-gray-100"><Ban className="h-4 w-4" /></button><button type="button" title="Reset password" onClick={() => void resetPassword(student.id)} className="rounded p-1.5 hover:bg-gray-100"><ShieldCheck className="h-4 w-4" /></button><button type="button" title="Force enrollment" onClick={() => void forceEnrollment(student.id)} className="rounded p-1.5 hover:bg-gray-100"><UserPlus className="h-4 w-4" /></button><button type="button" title="Delete student" onClick={() => void deleteStudent(student.id)} className="rounded p-1.5 text-red-600 hover:bg-red-50">Delete</button></div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-sm dark:border-gray-800"><span>{total} students</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="btn-secondary">Previous</button><span className="px-2 py-2">{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="btn-secondary">Next</button></div></div></div>
    {message && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
    {inspector && <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setInspector(null)}><aside className="ml-auto h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl dark:bg-gray-950" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-[0.14em] text-primary-600">Student inspector</p><h2 className="mt-2 text-2xl font-bold dark:text-white">{inspector.student.name}</h2><p className="text-sm text-gray-500">{inspector.student.email}</p></div><button type="button" onClick={() => setInspector(null)} aria-label="Close inspector"><X /></button></div><div className="mt-6 grid grid-cols-2 gap-3"><div className="card p-4"><p className="text-xs text-gray-500">Enrolled courses</p><p className="mt-2 text-2xl font-bold dark:text-white">{inspector.total_enrolled_courses}</p></div><div className="card p-4"><p className="text-xs text-gray-500">Progress</p><p className="mt-2 text-2xl font-bold dark:text-white">{inspector.progress}%</p></div><div className="card p-4"><p className="text-xs text-gray-500">Platform time</p><p className="mt-2 text-2xl font-bold dark:text-white">{inspector.platform_time_minutes}m</p></div><div className="card p-4"><p className="text-xs text-gray-500">Certificates</p><p className="mt-2 text-2xl font-bold dark:text-white">{inspector.completion_certificates}</p></div></div><h3 className="mt-8 text-lg font-semibold dark:text-white">Audit log</h3><div className="mt-3 space-y-2">{inspector.audit_log.length ? inspector.audit_log.map((entry) => <div key={`${entry.event}-${entry.occurred_at}`} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900"><span className="font-medium dark:text-white">{entry.event}</span><span className="ml-2 text-gray-500">{entry.ip_address ?? 'IP unavailable'} · {entry.occurred_at}</span></div>) : <p className="text-sm text-gray-500">No login audit events are recorded yet.</p>}</div></aside></div>}
    <StudentsPage />
  </div>;
}
