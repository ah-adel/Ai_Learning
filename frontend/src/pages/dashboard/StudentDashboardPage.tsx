import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock3,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AITutorChat } from '@/components/dashboard/AITutorChat';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/context/I18nContext';
import { fetchStudentEnrolledCourses, unenrollStudentFromCourse } from '@/lib/courseRepository';
import {
  ensureInstructorRecordsForCourses,
  readLocalEnrollments,
  type LocalCourseRecord,
  writeLocalEnrollments,
} from '@/lib/localDb';

type EnrolledCourse = {
  id: string;
  title: string;
  category: string;
  duration: string;
  lessons: number;
  progress: number;
  nextLesson: string;
  nextLessonId: string | null;
  instructor: string;
  accent: string;
};

const courseGradients = [
  'from-violet-500 to-indigo-600',
  'from-sky-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
];

function getCourseDuration(course: LocalCourseRecord): string {
  const totalSeconds = course.modules
    ?.flatMap((module) => module.lessons)
    .reduce((sum, lesson) => sum + Number(lesson.duration ?? 0), 0) ?? 0;

  if (!totalSeconds) return 'New course';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function getNextLessonName(course: LocalCourseRecord): string {
  const firstLesson = course.modules
    ?.flatMap((module) => module.lessons)
    .find((lesson) => lesson.title)?.title;

  return firstLesson ?? 'Start your first lesson';
}

function getNextLessonId(course: LocalCourseRecord): string | null {
  return course.modules
    ?.flatMap((module) => module.lessons)
    .find((lesson) => lesson.title)?.id ?? null;
}

export const StudentDashboardPage = memo(function StudentDashboardPage() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTutorOpen, setIsTutorOpen] = useState(false);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });

    const layoutRoot = document.querySelector('main');
    if (layoutRoot instanceof HTMLElement) {
      layoutRoot.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    if (!session?.userId) {
      setEnrolledCourses([]);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadCourses = async () => {
      try {
        const authenticCourses = await fetchStudentEnrolledCourses(session.userId);
        const users = ensureInstructorRecordsForCourses(authenticCourses);
        const enrollments = readLocalEnrollments().filter(
          (entry) => entry.studentId === session.userId && authenticCourses.some((course) => course.id === entry.courseId),
        );

        const mappedCourses = enrollments
          .map((entry) => {
            const course = authenticCourses.find((item) => item.id === entry.courseId);
            if (!course) return null;

            const instructor = users.find((user) => user.id === course.instructorId);
            const lessonCount = course.modules?.reduce((sum, module) => sum + module.lessons.length, 0) ?? 0;
            const progress = Number.isFinite(entry.progressPercentage)
              ? entry.progressPercentage
              : Number.isFinite(entry.progress)
                ? entry.progress
                : 0;

            return {
              id: course.id,
              title: course.title,
              category: course.category,
              duration: getCourseDuration(course),
              lessons: lessonCount,
              progress,
              nextLesson: getNextLessonName(course),
              nextLessonId: getNextLessonId(course),
              instructor: instructor?.profile.full_name ?? 'Verified instructor',
              accent: courseGradients[Math.abs(course.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % courseGradients.length],
            } satisfies EnrolledCourse;
          })
          .filter((course): course is EnrolledCourse => Boolean(course));

        if (isMounted) setEnrolledCourses(mappedCourses);
      } catch (error) {
        console.error('Failed to load student dashboard courses:', error);
        if (isMounted) setEnrolledCourses([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const handleEnrollmentChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ studentIds?: string[] }>;
      const changedStudentIds = customEvent.detail?.studentIds ?? [];
      if (!changedStudentIds.length || changedStudentIds.includes(session.userId)) {
        void loadCourses();
      }
    };

    void loadCourses();
    window.addEventListener('learnflow-enrollment-changed', handleEnrollmentChange);

    return () => {
      isMounted = false;
      window.removeEventListener('learnflow-enrollment-changed', handleEnrollmentChange);
    };
  }, [session?.userId]);

  const totalProgress = useMemo(() => {
    if (!enrolledCourses.length) return 0;
    return Math.round(
      enrolledCourses.reduce((sum, course) => sum + course.progress, 0) / enrolledCourses.length,
    );
  }, [enrolledCourses]);

  const handleUnenroll = useCallback(async (courseId: string) => {
    if (!session?.userId) return;

    const course = enrolledCourses.find((item) => item.id === courseId);
    const confirmed = window.confirm(
      course ? `Cancel your enrollment in "${course.title}"?` : 'Cancel this enrollment?',
    );

    if (!confirmed) return;

    await unenrollStudentFromCourse(session.userId, courseId);
    const nextEnrollments = readLocalEnrollments().filter(
      (entry) => !(entry.studentId === session.userId && entry.courseId === courseId),
    );

    writeLocalEnrollments(nextEnrollments);
    setEnrolledCourses((current) => current.filter((item) => item.id !== courseId));
  }, [enrolledCourses, session?.userId]);

  const completedCourses = enrolledCourses.filter((course) => course.progress >= 100).length;

  const handleExploreCourses = useCallback(() => {
    console.log('Explore Courses clicked');
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    navigate('/browse');
  }, [navigate]);

  if (!session?.userId) {
    return (
      <div className="card p-6 text-sm text-gray-600 dark:text-gray-300">
        {t('students.signInDashboard')}
      </div>
    );
  }

  if (loading) {
    return <LoadingState label={t('students.loadingPlan')} />;
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
            {t('students.workspace')}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('students.dashboard')}
          </h1>
        </div>

        <button
          type="button"
          onClick={handleExploreCourses}
          className="btn-primary transition-transform hover:-translate-y-0.5"
          style={{
            cursor: 'pointer',
            zIndex: 10,
            pointerEvents: 'auto',
            position: 'relative',
          }}
        >
          {t('students.explore')}
          <ArrowRight className="directional-icon h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={t('students.enrolled')}
          value={enrolledCourses.length}
          hint={t('students.activeCourses')}
          icon={<BookOpen className="h-5 w-5" />}
          accent="primary"
        />

        <StatCard
          label={t('students.avgProgress')}
          value={`${totalProgress}%`}
          hint={t('students.allPaths')}
          icon={<TrendingUp className="h-5 w-5" />}
          accent="emerald"
        />

        <StatCard
          label={t('students.completed')}
          value={completedCourses}
          hint={t('students.milestones')}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accent="violet"
        />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('students.continueLearning')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('students.continueDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Sparkles className="h-3.5 w-3.5" />
            {enrolledCourses.length} {t('students.activePaths')}
          </div>
        </div>

        {enrolledCourses.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={t('students.noPaths')}
              description={t('students.noPathsDescription')}
              icon={<BookOpen className="h-8 w-8" />}
              action={
                <Link to="/browse" className="btn-primary">
                  {t('students.explore')}
                  <ArrowRight className="directional-icon h-4 w-4" />
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 xl:grid-cols-3">
            {enrolledCourses.map((course) => (
              <article
                key={course.id}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <div className={`h-28 bg-gradient-to-br ${course.accent}`} />

                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {course.category}
                    </span>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {course.duration}
                    </span>
                  </div>

                  <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                    {course.title}
                  </h3>

                  <div className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                    <span>{course.instructor}</span>
                    <span>{course.lessons} {t('students.lessons')}</span>
                  </div>

                  <div className="mt-4">
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

                  <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
                    <div className="flex items-center gap-2 text-xs font-medium text-primary-600 dark:text-primary-300">
                      <Clock3 className="h-3.5 w-3.5" />
                      {t('students.nextUp')}
                    </div>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{course.nextLesson}</p>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="btn-secondary flex-1 justify-center"
                      onClick={() => navigate(`/courses/${course.id}?resume=1&lessonId=${course.nextLessonId ?? ''}`)}
                    >
                      {t('students.resume')}
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex-1 justify-center"
                      onClick={() => navigate(`/courses/${course.id}`)}
                    >
                      {t('students.view')}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="mt-3 w-full justify-center border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/30"
                    onClick={() => handleUnenroll(course.id)}
                  >
                    {t('students.unenroll')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-6 right-6 z-50 flex items-end justify-end gap-3" style={{ pointerEvents: 'none' }}>
        {isTutorOpen && (
          <button
            type="button"
            aria-label={t('ai.closeChat')}
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px]"
            onClick={() => setIsTutorOpen(false)}
          />
        )}

        <div
          className={`z-50 transition-all duration-300 ease-out ${
            isTutorOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[120%] opacity-0'
          }`}
        >
          <div className="w-[min(92vw,420px)] overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-primary-50 via-white to-violet-50 px-4 py-3 dark:border-gray-800 dark:from-primary-950/20 dark:via-gray-950 dark:to-violet-950/20">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white shadow-lg shadow-primary-600/20">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-600 dark:text-primary-300">
                    {t('ai.tutor')}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('ai.assistant')}</p>
                </div>
              </div>

              <button
                type="button"
                aria-label={t('ai.closeChat')}
                onClick={() => setIsTutorOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-hidden">
              <AITutorChat />
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label={t('ai.openTutor')}
          onClick={() => setIsTutorOpen((open) => !open)}
          className="group relative flex items-center gap-3 rounded-full border border-primary-200 bg-primary-600 px-4 py-3 text-left text-white shadow-xl shadow-primary-600/25 transition-all hover:-translate-y-0.5 hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-100 dark:border-primary-800 dark:focus:ring-primary-900/50"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
            <Bot className="h-5 w-5" />
          </span>

          <span className="hidden sm:block">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-100">
              {t('ai.tutor')}
            </span>
            <span className="block text-sm font-semibold text-white">{t('ai.assistant')}</span>
          </span>

          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[9px] font-bold text-emerald-950 shadow-sm">
            •
          </span>
        </button>
      </div>
    </div>
  );
});
