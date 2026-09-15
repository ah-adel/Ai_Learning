import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Activity,
  Bot,
  CheckCircle2,
  KeyRound,
  Power,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  readLocalAiModels,
  writeLocalAiModels,
  type LocalAiModelRecord,
} from '@/lib/localDb';
import type { UserRole } from '@/types/database.types';
import { useTranslation } from '@/context/I18nContext';

type DashboardUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AdminStats = {
  total_users: number;
  total_students: number;
  total_instructors: number;
  total_courses: number;
  published_courses: number;
  total_enrollments: number;
  total_revenue: number;
};

type ActivityEvent = { id: string; event_type: string; subject: string; detail: string; occurred_at: string };
type MonthlyPoint = { month: string; enrollments: number; revenue: number };
type SystemStatus = { maintenance_mode: boolean; python_version: string; platform: string; process_id: number; memory_mb: number; uptime_seconds: number };

const EMPTY_STATS: AdminStats = { total_users: 0, total_students: 0, total_instructors: 0, total_courses: 0, published_courses: 0, total_enrollments: 0, total_revenue: 0 };

async function fetchAdminResource<T>(path: string): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  return payload.data as T;
}

export function AdminDashboardPage() {
  const { profile, fetchUsers, fetchAdminStats, fetchAdminCourses } = useAuth();
  const { t, formatNumber, formatCurrency, formatDate } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [models, setModels] = useState<LocalAiModelRecord[]>(() => readLocalAiModels());
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
  const [courses, setCourses] = useState<Array<{ id: string; title: string; description: string; instructor_id: string; status?: string; is_published: boolean }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    setModels(readLocalAiModels());
  }, [refreshKey]);

  useEffect(() => {
    const handleStorage = () => setRefreshKey((current) => current + 1);
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadAdminData() {
      if (!profile || profile.role !== 'admin') {
        return;
      }

      try {
        const [nextUsers, nextStats, nextCourses, nextActivity, nextMonthly, nextSystem] = await Promise.all([
          fetchUsers(),
          fetchAdminStats(),
          fetchAdminCourses(),
          fetchAdminResource<ActivityEvent[]>('/api/admin/activity'),
          fetchAdminResource<MonthlyPoint[]>('/api/admin/analytics'),
          fetchAdminResource<SystemStatus>('/api/admin/system'),
        ]);
        if (!isMounted) return;
        setUsers(nextUsers);
        setStats(nextStats);
        setCourses(nextCourses.map((course) => ({
          ...course,
          status: course.is_published ? 'published' : 'draft',
        })));
        setActivity(nextActivity);
        setMonthly(nextMonthly);
        setSystem(nextSystem);
        setMaintenance(nextSystem.maintenance_mode);
      } catch (error) {
        console.error('Failed to load admin data from backend:', error);
        if (isMounted) {
          setUsers([]);
          setStats(EMPTY_STATS);
          setCourses([]);
          setActivity([]);
          setMonthly([]);
          setSystem(null);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadAdminData();
    return () => {
      isMounted = false;
    };
  }, [fetchAdminCourses, fetchAdminStats, fetchUsers, profile]);

  if (!profile) {
    return null;
  }

  if (profile.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const summary = useMemo(() => {
    const totalUsers = stats.total_users || users.length;
    const students = stats.total_students || users.filter((user) => user.role === 'student').length;
    const instructors = stats.total_instructors || users.filter((user) => user.role === 'instructor').length;
    const admins = users.filter((user) => user.role === 'admin').length || 1;
    const totalCourses = stats.total_courses || courses.length;
    const publishedCourses = stats.published_courses || courses.filter((course) => course.is_published || course.status === 'published').length;
    const draftCourses = Math.max(totalCourses - publishedCourses, 0);
    const totalEnrollments = stats.total_enrollments || 0;
    const activeUsers = users.filter((user) => user.status === 'active').length;
    const suspended = users.filter((user) => user.status === 'suspended').length;
    const activeLearners = stats.total_students;

    return {
      totalUsers,
      students,
      instructors,
      admins,
      activeUsers,
      suspended,
      totalCourses,
      publishedCourses,
      draftCourses,
      totalEnrollments,
      activeLearners,
      activeModels: models.filter((model) => model.isActive).length,
      revenue: stats.total_revenue,
    };
  }, [courses, models, stats, users]);

  const translateActivityDetail = (detail: string) => {
    if (detail === 'student') return t('common.studentRole');
    if (detail === 'instructor') return t('common.instructorRole');
    if (detail === 'admin') return t('common.adminRole');
    if (detail === 'published') return t('common.published');
    if (detail === 'draft') return t('common.draft');
    return detail;
  };

  const setMaintenanceMode = async (enabled: boolean) => {
    try {
      const token = window.sessionStorage.getItem('learnflow_session_token');
      const response = await fetch('/api/admin/system/maintenance', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ enabled }) });
      if (!response.ok) throw new Error('Unable to update maintenance mode.');
      setMaintenance(enabled);
      setMessage(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update maintenance mode.'); }
  };

  const purgeCache = async () => {
    try {
      await fetchAdminResource<{ purged: boolean }>('/api/admin/system/cache/purge');
      setMessage('Application cache purge requested.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to purge cache.'); }
  };

  const updateModelSetting = <K extends keyof LocalAiModelRecord>(
    modelId: string,
    key: K,
    value: LocalAiModelRecord[K],
  ) => {
    const nextModels = models.map((model) =>
      model.id === modelId ? { ...model, [key]: value } : model,
    );

    setModels(nextModels);
    writeLocalAiModels(nextModels);
  };

  const authHeaders = () => {
    const token = window.sessionStorage.getItem('learnflow_session_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const updateUserRole = async (userId: string, role: UserRole) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Unable to update user role.');
      }
      setMessage(`Updated user role to ${role}.`);
      const nextUsers = await fetchUsers();
      setUsers(nextUsers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update user role.');
    }
  };

  const updateUserStatus = async (userId: string, status: 'active' | 'inactive' | 'suspended') => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Unable to update user status.');
      }
      setMessage(`Updated user status to ${status}.`);
      const nextUsers = await fetchUsers();
      setUsers(nextUsers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update user status.');
    }
  };

  const updateCourseStatus = async (courseId: string, status: 'draft' | 'published' | 'review' | 'archived') => {
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Unable to update course status.');
      }
      setMessage(`Updated course status to ${status}.`);
      const nextStats = await fetchAdminStats();
      const nextCourses = await fetchAdminCourses();
      setStats(nextStats);
      setCourses(nextCourses.map((course) => ({ ...course, status: course.is_published ? 'published' : 'draft' })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update course status.');
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Unable to delete user.');
      }
      setMessage('User deleted successfully.');
      const nextUsers = await fetchUsers();
      setUsers(nextUsers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete user.');
    }
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-col gap-2">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
          {t('dashboard.eyebrow')}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{t('dashboard.title')}</h1>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5" aria-busy="true" aria-label="Loading admin metrics">
          {[1, 2, 3, 4, 5].map((item) => <div key={item} className="card h-36 animate-pulse bg-gray-100 dark:bg-gray-900" />)}
        </div>
      ) : (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.totalRevenue')}</p>
            <Users className="h-5 w-5 text-primary-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.revenue)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.recordedRevenue')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.activeStudents')}</p>
            <ShieldCheck className="h-5 w-5 text-violet-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.students)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.activeStudentAccounts')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.publishedCourses')}</p>
            <WalletCards className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.publishedCourses)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.studentCatalog')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.activeInstructors')}</p>
            <Activity className="h-5 w-5 text-cyan-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.instructors)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.activeInstructorAccounts')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between"><p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.systemHealth')}</p><Activity className="h-5 w-5 text-emerald-600" /></div>
          <p className="mt-4 text-3xl font-bold text-emerald-600">{system ? t('common.online') : t('common.unknown')}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.runtimeStatus')}</p>
        </div>
      </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.totalUsers')}</p>
          <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.totalUsers)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatNumber(summary.students)} {t('common.students')} · {formatNumber(summary.instructors)} {t('common.instructors')} · {formatNumber(summary.admins)} {t('common.admins')}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.totalCourses')}</p>
          <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.totalCourses)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatNumber(summary.publishedCourses)} {t('common.published')} · {formatNumber(summary.draftCourses)} {t('common.draft')}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.totalEnrollments')}</p>
          <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.totalEnrollments)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.liveRecords')}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.activeLearners')}</p>
          <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{formatNumber(summary.activeLearners)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.representedStudents')}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">{t('dashboard.liveActivity')}</p><h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.auditStream')}</h2></div><Activity className="h-5 w-5 text-primary-500" /></div>
          <div className="overflow-x-auto p-5">
            {activity.length === 0 ? <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('dashboard.noEvents')}</p> : <table className="min-w-full text-left text-sm"><thead><tr className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-800"><th className="pb-3 pr-4">{t('common.actions')}</th><th className="pb-3 pr-4">{t('courses.course')}</th><th className="pb-3">{t('common.when')}</th></tr></thead><tbody>{activity.map((event) => <tr key={`${event.event_type}-${event.id}`} className="border-b border-gray-100 last:border-0 dark:border-gray-800"><td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">{event.event_type === 'enrollment' ? t('dashboard.enrollments') : event.event_type === 'course' ? `${t('courses.course')} ${translateActivityDetail(event.detail)}` : translateActivityDetail(event.detail)}</td><td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{event.subject}</td><td className="py-3 text-xs text-gray-500">{formatDate(event.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)}</tbody></table>}
          </div>
        </div>

        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">{t('dashboard.financialTrend')}</p>
          <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.monthlyActivity')}</h2>
          <div className="mt-5 space-y-3">
            {monthly.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">{t('dashboard.noMonthlyData')}</p> : monthly.map((point) => { const max = Math.max(...monthly.map((item) => item.enrollments), 1); return <div key={point.month}><div className="mb-1 flex justify-between text-xs text-gray-500"><span>{point.month}</span><span>{formatNumber(point.enrollments)} {t('dashboard.enrollments')} · {formatCurrency(point.revenue)}</span></div><div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-primary-500" style={{ width: `${(point.enrollments / max) * 100}%` }} /></div></div>; })}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">{t('dashboard.runtimeOperations')}</p><h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.runtimeOperations')}</h2></div><Power className="h-5 w-5 text-primary-500" /></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <button type="button" onClick={() => void setMaintenanceMode(!maintenance)} className={`rounded-xl border p-4 text-left transition-colors ${maintenance ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60'}`}><span className="text-sm font-semibold text-gray-900 dark:text-white">{t('dashboard.maintenanceMode')}</span><span className="mt-1 block text-xs text-gray-500">{maintenance ? t('dashboard.enabledClickToggle') : t('dashboard.disabledClickToggle')}</span></button>
          <button type="button" onClick={() => void purgeCache()} className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left hover:border-primary-300 dark:border-gray-800 dark:bg-gray-900/60"><span className="text-sm font-semibold text-gray-900 dark:text-white">{t('dashboard.purgeCache')}</span><span className="mt-1 block text-xs text-gray-500">{t('dashboard.purgeCacheDescription')}</span></button>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60"><span className="text-sm font-semibold text-gray-900 dark:text-white">{t('dashboard.runtimeMetrics')}</span><span className="mt-1 block text-xs text-gray-500">{system ? `${system.platform} · Python ${system.python_version} · ${formatNumber(system.memory_mb)} MB` : t('dashboard.metricsUnavailable')}</span></div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                {t('dashboard.platformAccess')}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.accountDistribution')}</h2>
            </div>
            <Users className="h-5 w-5 text-primary-500" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.students')}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.students}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.instructors')}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.instructors}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.admins')}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.admins}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  {t('dashboard.accessOverview')}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.securitySignals')}</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
                  <span>{t('dashboard.verifiedAccounts')}</span>
                  <span className="font-semibold">{summary.totalUsers ? Math.round((summary.activeUsers / summary.totalUsers) * 100) : 0}%</span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white dark:bg-gray-900">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.totalUsers ? Math.round((summary.activeUsers / summary.totalUsers) * 100) : 0}%` }} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.suspended')}</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.suspended}</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.pendingReviews')}</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{courses.filter((course) => course.status === 'review').length}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  {t('dashboard.platformHealth')}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.systemStatus')}</h2>
              </div>
              <Activity className="h-5 w-5 text-primary-500" />
            </div>

            <div className="mt-5 space-y-3">
              {[
                { label: t('dashboard.fastApiService'), value: system ? t('dashboard.healthy') : t('common.unknown') },
                { label: t('dashboard.databaseData'), value: isLoading ? t('common.loading') : t('dashboard.connected') },
                { label: t('dashboard.aiTutorService'), value: system ? t('dashboard.available') : t('common.unknown') },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                  <span className="text-sm text-gray-600 dark:text-gray-300">{item.label}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              {t('dashboard.platformAccess')}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.users')}</h2>
          </div>
          <Users className="h-5 w-5 text-primary-500" />
        </div>

        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-gray-200">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-[0.08em] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="pb-3 pr-4">{t('common.user')}</th>
                <th className="pb-3 pr-4">{t('common.role')}</th>
                <th className="pb-3 pr-4">{t('common.status')}</th>
                <th className="pb-3 pr-4">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-200 last:border-b-0 dark:border-gray-800">
                  <td className="py-3 pr-4">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{user.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.role}
                      onChange={(event) => void updateUserRole(user.id, event.target.value as UserRole)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <option value="student">{t('common.students')}</option>
                      <option value="instructor">{t('common.instructors')}</option>
                      <option value="admin">{t('common.admins')}</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.status}
                      onChange={(event) => void updateUserStatus(user.id, event.target.value as 'active' | 'inactive' | 'suspended')}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <option value="active">{t('common.active')}</option>
                      <option value="inactive">{t('common.inactive')}</option>
                      <option value="suspended">{t('dashboard.suspended')}</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => void deleteUser(user.id)}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              {t('dashboard.moderation')}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('dashboard.courseReviewQueue')}</h2>
          </div>
          <ShieldCheck className="h-5 w-5 text-violet-500" />
        </div>

        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-gray-200">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-[0.08em] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="pb-3 pr-4">{t('courses.course')}</th>
                <th className="pb-3 pr-4">{t('courses.instructor')}</th>
                <th className="pb-3 pr-4">{t('common.status')}</th>
                <th className="pb-3 pr-4">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id} className="border-b border-gray-200 last:border-b-0 dark:border-gray-800">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-gray-900 dark:text-white">{course.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{course.description}</div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-gray-500 dark:text-gray-400">{course.instructor_id}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={course.is_published ? 'published' : 'draft'}
                      onChange={(event) => void updateCourseStatus(course.id, event.target.value as 'draft' | 'published' | 'review' | 'archived')}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <option value="draft">{t('common.draft')}</option>
                      <option value="published">{t('common.published')}</option>
                      <option value="review">{t('dashboard.pendingReviews')}</option>
                      <option value="archived">{t('common.inactive')}</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => void updateCourseStatus(course.id, 'published')}
                      className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      {t('common.published')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              Model configuration
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">AI Models</h2>
          </div>
          <Bot className="h-5 w-5 text-primary-500" />
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-3">
          {models.map((model) => (
            <div key={model.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{model.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{model.provider}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateModelSetting(model.id, 'isActive', !model.isActive)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    model.isActive
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <Power className="h-3.5 w-3.5" />
                  {model.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <KeyRound className="h-4 w-4" />
                    API key status
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      model.apiKey ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                    }`}
                  >
                    {model.apiKey ? 'Configured' : 'Missing'}
                  </span>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                    <span className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      Temperature
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">{model.temperature.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={model.temperature}
                    onChange={(event) => updateModelSetting(model.id, 'temperature', Number(event.target.value))}
                    className="w-full accent-primary-600"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-gray-600 dark:text-gray-300">Max tokens</label>
                  <input
                    type="number"
                    min={100}
                    max={32000}
                    step={100}
                    value={model.maxTokens}
                    onChange={(event) => updateModelSetting(model.id, 'maxTokens', Number(event.target.value) || 100)}
                    className="input-field"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
