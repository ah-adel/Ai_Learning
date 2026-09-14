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
};

export function AdminDashboardPage() {
  const { profile, fetchUsers, fetchAdminStats, fetchAdminCourses } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [models, setModels] = useState<LocalAiModelRecord[]>(() => readLocalAiModels());
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [stats, setStats] = useState<AdminStats>({
    total_users: 0,
    total_students: 0,
    total_instructors: 0,
    total_courses: 0,
    published_courses: 0,
    total_enrollments: 0,
  });
  const [courses, setCourses] = useState<Array<{ id: string; title: string; description: string; instructor_id: string; status?: string; is_published: boolean }>>([]);
  const [message, setMessage] = useState<string | null>(null);

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
        const [nextUsers, nextStats, nextCourses] = await Promise.all([
          fetchUsers(),
          fetchAdminStats(),
          fetchAdminCourses(),
        ]);
        if (!isMounted) return;
        setUsers(nextUsers);
        setStats(nextStats);
        setCourses(nextCourses.map((course) => ({
          ...course,
          status: course.is_published ? 'published' : 'draft',
        })));
      } catch (error) {
        console.error('Failed to load admin data from backend:', error);
        if (isMounted) {
          setUsers([]);
          setStats({ total_users: 0, total_students: 0, total_instructors: 0, total_courses: 0, published_courses: 0, total_enrollments: 0 });
          setCourses([]);
        }
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
    const activeLearners = Math.min(totalEnrollments, totalUsers);

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
    };
  }, [courses, models, stats, users]);

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
          System administration
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Admin Dashboard</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total users</p>
            <Users className="h-5 w-5 text-primary-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{summary.totalUsers}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {summary.students} students · {summary.instructors} instructors · {summary.admins} admins
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total courses</p>
            <ShieldCheck className="h-5 w-5 text-violet-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{summary.totalCourses}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {summary.publishedCourses} published · {summary.draftCourses} drafts
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total enrollments</p>
            <WalletCards className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{summary.totalEnrollments}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">live student enrollment records</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Active learners</p>
            <Activity className="h-5 w-5 text-cyan-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{summary.activeLearners}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">students with &gt;0% progress</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                Platform overview
              </p>
              <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Account distribution</h2>
            </div>
            <Users className="h-5 w-5 text-primary-500" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">Students</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.students}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">Instructors</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.instructors}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm text-gray-500 dark:text-gray-400">Admins</p>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.admins}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  Access overview
                </p>
                <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Security signals</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
                  <span>Verified accounts</span>
                  <span className="font-semibold">96%</span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white dark:bg-gray-900">
                  <div className="h-full w-[96%] rounded-full bg-emerald-500" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Suspended</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{summary.suspended}</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Pending reviews</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">4</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  Platform health
                </p>
                <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">System status</h2>
              </div>
              <Activity className="h-5 w-5 text-primary-500" />
            </div>

            <div className="mt-5 space-y-3">
              {[
                { label: 'Auth service', value: 'Healthy' },
                { label: 'Course ingestion', value: 'Healthy' },
                { label: 'AI tutor latency', value: 'Stable' },
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
              Platform access
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Users</h2>
          </div>
          <Users className="h-5 w-5 text-primary-500" />
        </div>

        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-gray-200">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-[0.08em] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Actions</th>
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
                      <option value="student">student</option>
                      <option value="instructor">instructor</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.status}
                      onChange={(event) => void updateUserStatus(user.id, event.target.value as 'active' | 'inactive' | 'suspended')}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="suspended">suspended</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => void deleteUser(user.id)}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      Delete
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
              moderation
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Course review queue</h2>
          </div>
          <ShieldCheck className="h-5 w-5 text-violet-500" />
        </div>

        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-gray-200">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-[0.08em] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="pb-3 pr-4">Course</th>
                <th className="pb-3 pr-4">Instructor</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Actions</th>
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
                      <option value="draft">draft</option>
                      <option value="published">published</option>
                      <option value="review">review</option>
                      <option value="archived">archived</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => void updateCourseStatus(course.id, 'published')}
                      className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      Publish
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
