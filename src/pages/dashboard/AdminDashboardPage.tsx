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
  readLocalCourses,
  readLocalEnrollments,
  readLocalUsers,
  writeLocalAiModels,
  type LocalAiModelRecord,
} from '@/lib/localDb';

export function AdminDashboardPage() {
  const { profile } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [models, setModels] = useState<LocalAiModelRecord[]>(() => readLocalAiModels());

  useEffect(() => {
    setModels(readLocalAiModels());
  }, [refreshKey]);

  useEffect(() => {
    const handleStorage = () => setRefreshKey((current) => current + 1);
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (!profile) {
    return null;
  }

  if (profile.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const users = useMemo(() => readLocalUsers(), [refreshKey]);
  const courses = useMemo(() => readLocalCourses(), [refreshKey]);
  const enrollments = useMemo(() => readLocalEnrollments(), [refreshKey]);

  const summary = useMemo(() => {
    const totalUsers = users.length;
    const students = users.filter((user) => user.role === 'student').length;
    const instructors = users.filter((user) => user.role === 'instructor').length;
    const admins = users.filter((user) => user.role === 'admin').length;
    const activeUsers = users.filter((user) => user.status === 'active').length;
    const suspended = users.filter((user) => user.status === 'suspended').length;
    const totalCourses = courses.length;
    const publishedCourses = courses.filter((course) => course.status === 'published' || course.isPublished).length;
    const draftCourses = totalCourses - publishedCourses;
    const totalEnrollments = enrollments.length;
    const activeLearners = new Set(
      enrollments
        .filter((entry) => Number(entry.progressPercentage ?? entry.progress ?? 0) > 0)
        .map((entry) => entry.studentId),
    ).size;
    const activeModels = models.filter((model) => model.isActive).length;

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
      activeModels,
    };
  }, [courses, enrollments, models, users]);

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
