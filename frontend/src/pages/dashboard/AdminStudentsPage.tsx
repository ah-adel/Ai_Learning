import { useEffect, useState } from 'react';
import { Ban, Download, Mail, RefreshCw, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { StudentsPage } from './StudentsPage';
import { useTranslation } from '@/context/I18nContext';
import { extractApiErrorMessage, errorMessage } from '@/lib/apiError';

type Student = {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  course_count: number;
  progress: number;
};

type Inspector = {
  student: Student;
  total_enrolled_courses: number;
  progress: number;
  platform_time_minutes: number;
  completion_certificates: number;
  enrollments: Array<{ id: string; title: string; completed_at: string | null }>;
  audit_log: Array<{ event: string; occurred_at: string; ip_address?: string }>;
};

export function AdminStudentsPage() {
  const { profile } = useAuth();
  const { t, formatNumber, formatDate } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = window.sessionStorage.getItem('learnflow_session_token');
    const response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(extractApiErrorMessage(payload, response.status));
    return payload.data as T;
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const data = await request<{ items: Student[]; total: number }>(
        `/api/admin/students?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}&status_filter=${status}&sort_by=${sortBy}`,
      );
      setStudents(data.items ?? []);
      setTotal(data.total ?? 0);
      setSelected([]);
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.loadError')));
      setMessageIsError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.role === 'admin') void loadStudents();
  }, [profile?.role, page, search, status, sortBy]);

  if (profile?.role !== 'admin') return <StudentsPage />;

  const selectedAll = students.length > 0 && students.every((student) => selected.includes(student.id));
  const toggleSelected = (id: string) =>
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const mutateStatus = async (ids: string[], nextStatus: 'active' | 'suspended') => {
    try {
      await Promise.all(ids.map((id) => request(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })));
      setStudents((current) => current.map((student) =>
        ids.includes(student.id) ? { ...student, status: nextStatus } : student,
      ));
      setSelected([]);
      setMessage(t('adminStudents.updatedAccounts', { count: formatNumber(ids.length) }));
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.updateError')));
      setMessageIsError(true);
    }
  };

  const openInspector = async (id: string) => {
    try {
      setInspector(await request<Inspector>(`/api/admin/students/${id}`));
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.profileError')));
      setMessageIsError(true);
    }
  };

  const deleteStudent = async (id: string) => {
    const student = students.find((entry) => entry.id === id);
    if (!window.confirm(t('adminStudents.deleteConfirm', { name: student?.name ?? '' }))) return;
    try {
      await request(`/api/admin/users/${id}`, { method: 'DELETE' });
      setStudents((current) => current.filter((entry) => entry.id !== id));
      setTotal((current) => Math.max(0, current - 1));
      setMessage(t('adminStudents.deleted'));
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.deleteError')));
      setMessageIsError(true);
    }
  };

  const resetPassword = async (id: string) => {
    try {
      const result = await request<{ temporary_password: string }>(`/api/admin/students/${id}/reset-password`, { method: 'POST' });
      setMessage(t('adminStudents.temporaryPasswordIssued', { password: result.temporary_password }));
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.passwordResetError')));
      setMessageIsError(true);
    }
  };

  const forceEnrollment = async (id: string) => {
    const courseId = window.prompt(t('common.selectCourseId'));
    if (!courseId) return;
    try {
      await request(`/api/admin/students/${id}/force-enrollment`, {
        method: 'POST',
        body: JSON.stringify({ course_id: courseId }),
      });
      setMessage(t('adminStudents.enrolled'));
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.enrollmentError')));
      setMessageIsError(true);
    }
  };

  const notifySelected = async () => {
    try {
      const result = await request<{ queued: number }>('/api/admin/students/bulk-notify', {
        method: 'POST',
        body: JSON.stringify({ student_ids: selected }),
      });
      setMessage(t('adminStudents.notificationsQueued', { count: formatNumber(result.queued) }));
      setMessageIsError(false);
    } catch (error) {
      setMessage(errorMessage(error, t('adminStudents.notificationError')));
      setMessageIsError(true);
    }
  };

  const exportCsv = () => {
    const rows = students.filter((student) => selected.includes(student.id));
    const csv = [
      [t('students.student'), t('common.email'), t('common.status'), t('students.courses'), t('students.progress')],
      ...rows.map((student) => [
        student.name,
        student.email,
        t(student.status === 'suspended' ? 'common.suspended' : `common.${student.status}` as 'common.active' | 'common.inactive'),
        String(student.course_count),
        `${student.progress}%`,
      ]),
    ].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'students.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const statusLabel = (studentStatus: Student['status']) => {
    if (studentStatus === 'suspended') return t('common.suspended');
    return studentStatus === 'active' ? t('common.active') : t('common.inactive');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{t('students.operations')}</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('students.management')}</h1>
        </div>
        <button type="button" onClick={() => void loadStudents()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" />
          {t('common.refresh')}
        </button>
      </div>

      <div className="card flex flex-wrap gap-3 p-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => { setPage(1); setSearch(event.target.value); }}
            placeholder={t('adminStudents.searchPlaceholder')}
            className="input-field ps-10"
          />
        </div>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="input-field w-44">
          <option value="all">{t('adminStudents.allStatuses')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="suspended">{t('common.suspended')}</option>
          <option value="inactive">{t('common.inactive')}</option>
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="input-field w-44">
          <option value="created_at">{t('adminStudents.sortNewest')}</option>
          <option value="name">{t('adminStudents.sortName')}</option>
          <option value="email">{t('adminStudents.sortEmail')}</option>
          <option value="status">{t('common.status')}</option>
        </select>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-950/20">
          <span className="me-2 text-sm font-semibold">{t('adminStudents.selectedCount', { count: formatNumber(selected.length) })}</span>
          <button type="button" onClick={() => void mutateStatus(selected, 'suspended')} className="btn-secondary">
            <Ban className="h-4 w-4" />
            {t('adminStudents.bulkSuspend')}
          </button>
          <button type="button" onClick={() => void notifySelected()} className="btn-secondary">
            <Mail className="h-4 w-4" />
            {t('adminStudents.emailNotification')}
          </button>
          <button type="button" onClick={exportCsv} className="btn-secondary">
            <Download className="h-4 w-4" />
            {t('adminStudents.exportCsv')}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-start text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/60">
              <tr>
                <th className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={selectedAll}
                    onChange={() => setSelected(selectedAll ? [] : students.map((student) => student.id))}
                    aria-label={t('adminStudents.selectAll')}
                  />
                </th>
                <th className="px-5 py-3">{t('students.student')}</th>
                <th className="px-5 py-3">{t('common.status')}</th>
                <th className="px-5 py-3">{t('students.courses')}</th>
                <th className="px-5 py-3">{t('students.progress')}</th>
                <th className="px-5 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? [1, 2, 3].map((item) => (
                <tr key={item}>
                  <td colSpan={6} className="px-5 py-5"><div className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td>
                </tr>
              )) : students.map((student) => (
                <tr key={student.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-5 py-4">
                    <input type="checkbox" checked={selected.includes(student.id)} onChange={() => toggleSelected(student.id)} aria-label={t('adminStudents.selectStudent', { name: student.name })} />
                  </td>
                  <td className="px-5 py-4">
                    <button type="button" onClick={() => void openInspector(student.id)} className="text-start">
                      <p className="font-semibold text-gray-900 hover:text-primary-600 dark:text-white">{student.name}</p>
                      <p className="text-xs text-gray-500">{student.email}</p>
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2 py-1 text-xs ${student.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {statusLabel(student.status)}
                    </span>
                  </td>
                  <td className="px-5 py-4">{formatNumber(student.course_count)}</td>
                  <td className="px-5 py-4">{formatNumber(student.progress)}%</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" title={student.status === 'suspended' ? t('students.activate') : t('students.suspend')} aria-label={student.status === 'suspended' ? t('students.activate') : t('students.suspend')} onClick={() => void mutateStatus([student.id], student.status === 'suspended' ? 'active' : 'suspended')} className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Ban className="h-4 w-4" />
                      </button>
                      <button type="button" title={t('adminStudents.resetPassword')} aria-label={t('adminStudents.resetPassword')} onClick={() => void resetPassword(student.id)} className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <ShieldCheck className="h-4 w-4" />
                      </button>
                      <button type="button" title={t('adminStudents.forceEnrollment')} aria-label={t('adminStudents.forceEnrollment')} onClick={() => void forceEnrollment(student.id)} className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <UserPlus className="h-4 w-4" />
                      </button>
                      <button type="button" title={t('adminStudents.deleteStudent')} onClick={() => void deleteStudent(student.id)} className="rounded p-1.5 text-red-600 hover:bg-red-50">
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && students.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-500">{t('students.empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-sm dark:border-gray-800">
          <span>{t('adminStudents.totalStudents', { count: formatNumber(total) })}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="btn-secondary disabled:opacity-50">
              {t('adminStudents.previous')}
            </button>
            <span className="px-2 py-2">{t('adminStudents.pageOf', { page: formatNumber(page), pages: formatNumber(pages) })}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))} className="btn-secondary disabled:opacity-50">
              {t('adminStudents.next')}
            </button>
          </div>
        </div>
      </div>

      {message && <p className={`rounded-xl px-4 py-3 text-sm ${messageIsError ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300' : 'bg-emerald-50 text-emerald-700'}`} role={messageIsError ? 'alert' : 'status'}>{message}</p>}

      {inspector && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setInspector(null)}>
          <aside className="ms-auto h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl dark:bg-gray-950" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-primary-600">{t('adminStudents.inspector')}</p>
                <h2 className="mt-2 text-2xl font-bold dark:text-white">{inspector.student.name}</h2>
                <p className="text-sm text-gray-500">{inspector.student.email}</p>
              </div>
              <button type="button" onClick={() => setInspector(null)} aria-label={t('common.close')}><X /></button>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="card p-4"><p className="text-xs text-gray-500">{t('adminStudents.enrolledCourses')}</p><p className="mt-2 text-2xl font-bold dark:text-white">{formatNumber(inspector.total_enrolled_courses)}</p></div>
              <div className="card p-4"><p className="text-xs text-gray-500">{t('students.progress')}</p><p className="mt-2 text-2xl font-bold dark:text-white">{formatNumber(inspector.progress)}%</p></div>
              <div className="card p-4"><p className="text-xs text-gray-500">{t('adminStudents.platformTime')}</p><p className="mt-2 text-2xl font-bold dark:text-white">{formatNumber(inspector.platform_time_minutes)} {t('adminStudents.minutesShort')}</p></div>
              <div className="card p-4"><p className="text-xs text-gray-500">{t('adminStudents.certificates')}</p><p className="mt-2 text-2xl font-bold dark:text-white">{formatNumber(inspector.completion_certificates)}</p></div>
            </div>
            <h3 className="mt-8 text-lg font-semibold dark:text-white">{t('adminStudents.auditLog')}</h3>
            <div className="mt-3 space-y-2">
              {inspector.audit_log.length ? inspector.audit_log.map((entry) => (
                <div key={`${entry.event}-${entry.occurred_at}`} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900">
                  <span className="font-medium dark:text-white">{entry.event}</span>
                  <span className="ms-2 text-gray-500">{entry.ip_address ?? t('adminStudents.ipUnavailable')} · {formatDate(entry.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              )) : <p className="text-sm text-gray-500">{t('adminStudents.noAuditEvents')}</p>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}