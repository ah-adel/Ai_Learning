import { useEffect, useMemo, useState, useCallback } from 'react';
import { ArrowRight, BookOpen, BriefcaseBusiness, CheckCircle2, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/context/I18nContext';
import { fetchInstructorCourses, fetchStudentEnrolledCourses, unenrollStudentFromCourse } from '@/lib/courseRepository';
import {
  readLocalEnrollments,
  readLocalUsers,
  writeLocalEnrollments,
} from '@/lib/localDb';

type CourseRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  instructorName: string;
  progress: number;
  status: 'active' | 'completed';
  lessonsCount: number;
};

export function CoursesPage() {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const { t } = useTranslation();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const handleUnenroll = async (courseId: string) => {
    if (!session?.userId) return;

    const course = courses.find((item) => item.id === courseId);
    const confirmed = window.confirm(
      course ? `Cancel your enrollment in "${course.title}"?` : 'Cancel this enrollment?',
    );

    if (!confirmed) return;

    const backendSucceeded = await unenrollStudentFromCourse(session.userId, courseId);
    const nextEnrollments = readLocalEnrollments().filter(
      (entry) => !(entry.studentId === session.userId && entry.courseId === courseId),
    );

    writeLocalEnrollments(nextEnrollments);
    setCourses((current) => current.filter((item) => item.id !== courseId));
    if (backendSucceeded || typeof window !== 'undefined') {
      window.dispatchEvent(new Event('enrollmentChange'));
    }
  };

  const loadCourses = useCallback(async () => {
    if (!session?.userId) {
      setLoading(false);
      setCourses([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const allUsers = readLocalUsers();
      const enrollments = readLocalEnrollments();
      const allCourses = profile?.role === 'instructor'
        ? await fetchInstructorCourses(session.userId)
        : await fetchStudentEnrolledCourses(session.userId);

      const activeCourses = profile?.role === 'instructor'
        ? allCourses.filter((course) => course.instructorId === session.userId)
        : allCourses.filter((course) =>
            enrollments.some((entry) => entry.studentId === session.userId && entry.courseId === course.id),
          );

      const mappedCourses: CourseRow[] = activeCourses.map((course) => {
        const instructor = allUsers.find((user) => user.id === course.instructorId);
        const enrollment = enrollments.find(
          (entry) => entry.studentId === session.userId && entry.courseId === course.id,
        );

        return {
          id: course.id,
          title: course.title,
          description: course.description,
          category: course.category,
          instructorName: instructor?.profile.full_name ?? 'Instructor',
          progress: enrollment?.progress ?? 0,
          status: enrollment?.status ?? 'active',
          lessonsCount: course.modules?.reduce((sum, module) => sum + module.lessons.length, 0) ?? 0,
        };
      });

      setCourses(mappedCourses);
    } catch (loadError) {
      console.error('Failed to load user course list:', loadError);
      setError('Unable to load your course list from the saved data source.');
    } finally {
      setLoading(false);
    }
  }, [profile?.role, session?.userId]);

  useEffect(() => {
    void loadCourses();

    // الاستماع لأي تغيير في التسجيلات (طالب) أو إنشاء الكورسات (مدرس)
    const handleSync = () => {
      void loadCourses();
    };

    window.addEventListener('enrollmentChange', handleSync);
    window.addEventListener('courseChange', handleSync);
    window.addEventListener('storage', handleSync);

    return () => {
      window.removeEventListener('enrollmentChange', handleSync);
      window.removeEventListener('courseChange', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [loadCourses]);

  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;

      return (
        course.title.toLowerCase().includes(query) ||
        course.instructorName.toLowerCase().includes(query) ||
        course.description.toLowerCase().includes(query)
      );
    });
  }, [courses, search]);

  const averageProgress = useMemo(() => {
    if (!courses.length) return 0;
    return Math.round(courses.reduce((sum, course) => sum + course.progress, 0) / courses.length);
  }, [courses]);

  if (!session?.userId) {
    return (
      <div className="card p-6 text-sm text-gray-600 dark:text-gray-300">
      {t('students.signInDashboard')}
      </div>
    );
  }

  if (loading) {
    return <LoadingState label={t('courses.loadingCourses')} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
            {profile?.role === 'instructor' ? t('courses.teachingWorkspace') : t('courses.studentLearning')}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('nav.myCourses')}</h1>
        </div>

        <div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('courses.search')}
            className="w-full border-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={t('students.activeCourses')}
          value={courses.length}
          hint={t('courses.inLearningPlan')}
          icon={<BookOpen className="h-5 w-5" />}
          accent="primary"
        />

        <StatCard
          label={t('students.avgProgress')}
          value={`${averageProgress}%`}
          hint={t('students.allPaths')}
          icon={<Sparkles className="h-5 w-5" />}
          accent="emerald"
        />

        <StatCard
          label={t('students.completed')}
          value={courses.filter((course) => course.progress >= 100).length}
          hint={t('courses.coursesFinished')}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accent="violet"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {filteredCourses.length === 0 ? (
        <EmptyState
          title={t('courses.noCourses')}
          description={t('courses.noCoursesDescription')}
          icon={<BriefcaseBusiness className="h-8 w-8" />}
          action={
            <button type="button" className="btn-primary" onClick={() => navigate('/browse')}>
              {t('students.explore')}
              <ArrowRight className="directional-icon h-4 w-4" />
            </button>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredCourses.map((course) => (
            <article key={course.id} className="card overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
                    {course.category}
                  </span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {course.status === 'completed' ? t('common.completed') : t('courses.inProgress')}
                  </span>
                </div>
                <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">{course.title}</h2>
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('courses.instructor')}</p>
                  <p className="mt-1 font-medium text-gray-700 dark:text-gray-200">{course.instructorName}</p>
                </div>

                <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{course.description}</p>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
                    <span>{t('students.progress')}</span>
                    <span>{course.progress}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-500"
                      style={{ width: `${course.progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
                  <span>{course.lessonsCount} {t('students.lessons')}</span>
                  <span>{course.progress >= 100 ? t('courses.readyReview') : t('courses.keepGoing')}</span>
                </div>

                {profile?.role === 'instructor' ? (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="btn-secondary flex-1 justify-center"
                      onClick={() => navigate(`/instructor?editCourse=${encodeURIComponent(course.id)}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex-1 justify-center"
                      onClick={() => navigate(`/courses/${course.id}?preview=1`)}
                    >
                      View
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="btn-secondary flex-1 justify-center"
                      onClick={() => navigate(`/courses/${course.id}?resume=1`)}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex-1 justify-center"
                      onClick={() => navigate(`/courses/${course.id}`)}
                    >
                      View
                    </button>
                  </div>
                )}

                {!profile || profile.role === 'student' ? (
                  <button
                    type="button"
                    className="mt-3 w-full justify-center border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/30"
                    onClick={() => handleUnenroll(course.id)}
                  >
                    Unenroll
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}