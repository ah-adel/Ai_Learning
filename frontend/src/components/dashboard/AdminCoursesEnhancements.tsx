import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, Eye, ExternalLink, Flag, X } from 'lucide-react';
import {
  fetchAdminCourseInspector,
  fetchAdminCourses,
  normalizeAdminMediaUrl,
  updateAdminCourse,
  updateAdminCourseStatus,
  type AdminCourse,
  type AdminCourseInspector,
} from '@/lib/adminCourseRepository';
import { fetchAdminInstructors, type AdminInstructor } from '@/lib/adminInstructorRepository';
import { useTranslation } from '@/context/I18nContext';

type Tab = 'all' | 'review' | 'published' | 'archived';

export function AdminCoursesEnhancements() {
  const { t, formatNumber, formatCurrency } = useTranslation();
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [instructors, setInstructors] = useState<AdminInstructor[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [inspector, setInspector] = useState<AdminCourseInspector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([fetchAdminCourses(), fetchAdminInstructors()])
      .then(([courseResult, instructorResult]) => {
        if (!isMounted) return;
        if (courseResult.status === 'fulfilled') setCourses(courseResult.value);
        else {
          console.error('Failed to load course moderation data:', courseResult.reason);
          setError(t('adminCourses.loadError'));
        }
        if (instructorResult.status === 'fulfilled') setInstructors(instructorResult.value);
      });

    return () => {
      isMounted = false;
    };
  }, [t]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'all', label: t('courses.allCourses') },
    { id: 'review', label: t('dashboard.pendingReviews') },
    { id: 'published', label: t('common.published') },
    { id: 'archived', label: t('adminCourses.archived') },
  ];

  const visible = useMemo(
    () => courses.filter((course) =>
      tab === 'all' ||
      (tab === 'archived'
        ? course.status === 'archived' || course.status === 'rejected'
        : course.status === tab),
    ),
    [courses, tab],
  );

  const moderate = async (courseId: string, status: 'published' | 'archived' | 'rejected') => {
    setBusy(courseId);
    setError(null);
    try {
      const updated = await updateAdminCourseStatus(courseId, status);
      setCourses((current) => current.map((course) =>
        course.id === courseId ? { ...course, ...updated } : course,
      ));
    } catch (reason: unknown) {
      console.error('Course moderation failed:', reason);
      setError(t('adminCourses.moderationError'));
    } finally {
      setBusy(null);
    }
  };

  const feature = async (course: AdminCourse) => {
    setBusy(course.id);
    setError(null);
    try {
      const updated = await updateAdminCourse(course.id, { is_featured: !course.is_featured });
      setCourses((current) => current.map((entry) =>
        entry.id === course.id ? { ...entry, ...updated } : entry,
      ));
    } catch (reason: unknown) {
      console.error('Featured course update failed:', reason);
      setError(t('adminCourses.featureError'));
    } finally {
      setBusy(null);
    }
  };

  const reassign = async (course: AdminCourse, instructorId: string) => {
    setBusy(course.id);
    setError(null);
    try {
      const updated = await updateAdminCourse(course.id, { instructor_id: instructorId });
      setCourses((current) => current.map((entry) =>
        entry.id === course.id ? { ...entry, ...updated } : entry,
      ));
    } catch (reason: unknown) {
      console.error('Instructor reassignment failed:', reason);
      setError(t('adminCourses.reassignError'));
    } finally {
      setBusy(null);
    }
  };

  const openInspector = async (courseId: string) => {
    setError(null);
    try {
      setInspector(await fetchAdminCourseInspector(courseId));
    } catch (reason: unknown) {
      console.error('Course curriculum inspection failed:', reason);
      setError(t('adminCourses.inspectorError'));
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'review') return t('dashboard.pendingReviews');
    if (status === 'published') return t('common.published');
    if (status === 'archived') return t('adminCourses.archived');
    if (status === 'rejected') return t('adminCourses.rejected');
    return t('common.draft');
  };

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-gray-200 p-5 dark:border-gray-800">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('adminCourses.courseModeration')}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-start">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/60">
            <tr>
              <th className="px-5 py-3">{t('adminCourses.moderationCourse')}</th>
              <th className="px-5 py-3">{t('courses.instructor')}</th>
              <th className="px-5 py-3">{t('common.status')}</th>
              <th className="px-5 py-3">{t('adminCourses.curriculum')}</th>
              <th className="px-5 py-3 text-end">{t('adminCourses.controls')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((course) => {
              const lessonCount = course.modules?.reduce((total, module) => total + module.lessons.length, 0) ?? 0;
              const instructorName = instructors.find((instructor) => instructor.id === course.instructor_id)?.name ?? course.instructor_id;

              return (
                <tr key={course.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-5 py-4">
                    <p className="font-semibold">{course.title}</p>
                    <p className="text-sm text-gray-500">
                      {course.is_featured ? t('adminCourses.featured') : t('adminCourses.standardListing')}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <select
                      aria-label={t('adminCourses.reassignInstructor', { course: course.title })}
                      value={course.instructor_id}
                      onChange={(event) => void reassign(course, event.target.value)}
                      className="input-field py-2 text-sm"
                    >
                      <option value={course.instructor_id}>{instructorName}</option>
                      {instructors.filter((instructor) => instructor.id !== course.instructor_id).map((instructor) => (
                        <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
                      {statusLabel(course.status)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">
                    {t('adminCourses.lessonCount', { count: formatNumber(lessonCount) })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="icon-button" title={t('adminCourses.inspectCurriculum')} aria-label={t('adminCourses.inspectCurriculum')} onClick={() => void openInspector(course.id)}>
                        <Eye className="h-4 w-4" />
                      </button>
                      {course.status === 'review' && (
                        <>
                          <button type="button" className="icon-button text-emerald-600" title={t('adminCourses.approve')} aria-label={t('adminCourses.approve')} disabled={busy === course.id} onClick={() => void moderate(course.id, 'published')}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" className="icon-button text-red-600" title={t('adminCourses.reject')} aria-label={t('adminCourses.reject')} disabled={busy === course.id} onClick={() => void moderate(course.id, 'rejected')}>
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {course.status !== 'archived' && course.status !== 'rejected' && (
                        <button type="button" className="icon-button text-amber-600" title={t('adminCourses.archive')} aria-label={t('adminCourses.archive')} disabled={busy === course.id} onClick={() => void moderate(course.id, 'archived')}>
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                      <button type="button" className={`icon-button ${course.is_featured ? 'text-primary-600' : 'text-gray-400'}`} title={course.is_featured ? t('adminCourses.removeFeatured') : t('adminCourses.setFeatured')} aria-label={course.is_featured ? t('adminCourses.removeFeatured') : t('adminCourses.setFeatured')} onClick={() => void feature(course)}>
                        <Flag className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-500">{t('adminCourses.noCourses')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inspector && (
        <div className="border-t border-gray-200 p-5 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-primary-600">{t('adminCourses.courseInspector')}</p>
              <h3 className="text-lg font-semibold">{inspector.course.title}</h3>
            </div>
            <button type="button" className="icon-button" title={t('common.close')} aria-label={t('common.close')} onClick={() => setInspector(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            {t('adminCourses.inspectorSummary', {
              enrollments: formatNumber(inspector.stats.enrollment_count),
              completed: formatNumber(inspector.stats.completed_count),
              revenue: formatCurrency(inspector.stats.revenue),
            })}
          </p>
          <div className="mt-4 space-y-3">
            {inspector.course.modules?.map((module) => (
              <div key={module.id}>
                <p className="font-medium">{module.title}</p>
                {module.lessons.map((lesson) => {
                  const video = normalizeAdminMediaUrl(lesson.video_url, 'video');
                  const attachment = normalizeAdminMediaUrl(lesson.attachment_url, 'attachment');
                  return (
                    <div key={lesson.id} className="flex flex-wrap items-center gap-3 ps-4 text-sm text-gray-600">
                      <span>{lesson.title}</span>
                      {video && <a href={video} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600"><ExternalLink className="h-3 w-3" />{t('adminCourses.video')}</a>}
                      {attachment && <a href={attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600"><ExternalLink className="h-3 w-3" />{t('adminCourses.attachment')}</a>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}