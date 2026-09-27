import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Eye,
  PencilLine,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AdminCoursesEnhancements } from '@/components/dashboard/AdminCoursesEnhancements';
import { useTranslation } from '@/context/I18nContext';
import { fetchAdminCourses, deleteAdminCourse, updateAdminCourseStatus, type AdminCourse } from '@/lib/adminCourseRepository';
import { fetchAdminInstructors, type AdminInstructor } from '@/lib/adminInstructorRepository';

type CourseAdminRow = AdminCourse & {
  instructorName: string;
  enrollmentCount: number;
  averageProgress: number | null;
};

export function AdminCoursesPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t, formatNumber } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [instructors, setInstructors] = useState<AdminInstructor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);

    Promise.allSettled([fetchAdminCourses(), fetchAdminInstructors()]).then(([courseResult, instructorResult]) => {
      if (!isMounted) return;
      if (courseResult.status === 'fulfilled') {
        setCourses(courseResult.value);
      } else {
        console.error('Failed to load admin courses:', courseResult.reason);
        setLoadError(t('adminCourses.loadError'));
      }
      if (instructorResult.status === 'fulfilled') setInstructors(instructorResult.value);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [profile?.role, t]);

  const courseRows = useMemo<CourseAdminRow[]>(() => {
    const instructorMap = new Map(
      instructors.map((instructor) => [instructor.id, instructor.name]),
    );

    return courses
      .map((course) => {
        return {
          ...course,
          instructorName: instructorMap.get(course.instructor_id) ?? course.instructor_id,
          enrollmentCount: Number(course.enrollment_count ?? 0),
          averageProgress: null,
        };
      })
      .filter((course) => {
        const matchesSearch =
          !search ||
          course.title.toLowerCase().includes(search.toLowerCase()) ||
          course.instructorName.toLowerCase().includes(search.toLowerCase()) ||
          (course.category ?? '').toLowerCase().includes(search.toLowerCase());

        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'published' && (course.status === 'published' || course.is_published)) ||
          (statusFilter === 'draft' && !(course.status === 'published' || course.is_published));

        return matchesSearch && matchesStatus;
      });
  }, [courses, instructors, search, statusFilter]);

  if (!profile) return null;
  if (profile.role !== 'admin') return <Navigate to="/dashboard" replace />;

  const toggleCourseStatus = async (courseId: string) => {
    const course = courses.find((entry) => entry.id === courseId);
    if (!course) return;
    const nextStatus = course.status === 'published' || course.is_published ? 'draft' : 'published';
    setActionError(null);
    try {
      const updated = await updateAdminCourseStatus(courseId, nextStatus);
      setCourses((current) => current.map((entry) => entry.id === courseId ? { ...entry, ...updated } : entry));
    } catch (reason) {
      console.error('Failed to update course status:', reason);
      setActionError(t('adminCourses.moderationError'));
    }
  };

  const handleDeleteCourse = async (course: AdminCourse) => {
    const confirmed = window.confirm(
      `${t('common.deleteConfirm')} "${course.title}"`,
    );

    if (!confirmed) return;

    setActionError(null);
    try {
      await deleteAdminCourse(course.id);
      setCourses((current) => current.filter((entry) => entry.id !== course.id));
    } catch (reason) {
      console.error('Failed to delete course:', reason);
      setActionError(t('adminCourses.moderationError'));
    }
  };

  const openCoursePreview = (courseId: string) => {
    navigate(`/courses/${courseId}?preview=1`);
  };

  const openCourseEditor = (courseId: string) => {
    navigate(`/courses/${courseId}`);
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
            {t('courses.management')}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('courses.title')}
          </h1>
        </div>

        <button
          type="button"
          onClick={() => navigate('/dashboard/admin')}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {t('dashboard.backToOverview')}
        </button>
      </div>

      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="relative block">
            <span className="sr-only">{t('courses.search')}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('courses.searchPlaceholder')}
              className="input-field ps-10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">{t('common.status')}</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | 'published' | 'draft')}
              className="input-field"
            >
              <option value="all">{t('courses.allCourses')}</option>
              <option value="published">{t('common.published')}</option>
              <option value="draft">{t('common.draft')}</option>
            </select>
          </label>
        </div>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-red-600" role="alert">{loadError ?? actionError}</p>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              {t('courses.inventory')}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
              {formatNumber(courseRows.length)} {t('courses.course')}
            </h2>
          </div>
          <BookOpen className="h-5 w-5 text-primary-500" />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-start">
            <thead className="bg-gray-50 text-xs uppercase tracking-[0.12em] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
              <tr>
                <th className="px-5 py-3">{t('courses.course')}</th>
                <th className="px-5 py-3">{t('courses.instructor')}</th>
                <th className="px-5 py-3">{t('courses.category')}</th>
                <th className="px-5 py-3">{t('common.status')}</th>
                <th className="px-5 py-3">{t('courses.enrollments')}</th>
                <th className="px-5 py-3">{t('courses.avgProgress')}</th>
                <th className="px-5 py-3 text-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500">{t('common.loading')}</td></tr>
              ) : courseRows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500">{t('courses.noCourses')}</td></tr>
              ) : courseRows.map((course) => (
                <tr key={course.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-5 py-4">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{course.title}</p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{course.ai_model ?? t('courses.generalLearning')}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{course.instructorName}</td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{course.category}</td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => toggleCourseStatus(course.id)}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          course.status === 'published' || course.is_published
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {course.status === 'published' || course.is_published ? t('common.published') : t('common.draft')}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{course.enrollmentCount}</td>
                  <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{course.averageProgress === null ? '—' : `${course.averageProgress}%`}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openCoursePreview(course.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                        aria-label={`Preview ${course.title}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {t('courses.preview')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openCourseEditor(course.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-2 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-900/60 dark:bg-primary-950/20 dark:text-primary-300"
                        aria-label={`Edit ${course.title}`}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        {t('courses.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCourse(course)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300"
                        aria-label={`Delete ${course.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AdminCoursesEnhancements />
    </div>
  );
}
