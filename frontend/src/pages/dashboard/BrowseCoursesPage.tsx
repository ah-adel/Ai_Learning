import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock3, Filter, Search, Star, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { enrollStudentInCourse, fetchPublishedCourses } from '@/lib/courseRepository';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ensureInstructorRecordsForCourses,
  readLocalEnrollments,
  type LocalCourseRecord,
  type LocalEnrollmentRecord,
  writeLocalEnrollments,
} from '@/lib/localDb';

type CourseDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';
type CourseCategory = 'Design' | 'Development' | 'Data' | 'AI & Automation' | 'Marketing';

type CatalogCourse = {
  id: string;
  title: string;
  category: CourseCategory;
  difficulty: CourseDifficulty;
  duration: string;
  lessons: number;
  rating: number;
  students: string;
  instructor: string;
  description: string;
  outcomes: string[];
  accent: string;
  enrolled: boolean;
};

const categories = ['All', 'Design', 'Development', 'Data', 'AI & Automation', 'Marketing'] as const;
const difficulties = ['All', 'Beginner', 'Intermediate', 'Advanced'] as const;
const courseGradients = [
  'from-violet-500 to-indigo-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-sky-500 to-cyan-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
];

function formatCourseDuration(course: LocalCourseRecord): string {
  const totalSeconds = course.modules
    ?.flatMap((module) => module.lessons)
    .reduce((sum, lesson) => sum + Number(lesson.duration ?? 0), 0) ?? 0;

  if (!totalSeconds) return 'New course';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLearnerCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }

  return `${count}`;
}

export function BrowseCoursesPage() {
  const { session } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<(typeof categories)[number]>('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState<(typeof difficulties)[number]>('All');
  const [selectedCourse, setSelectedCourse] = useState<CatalogCourse | null>(null);
  const [catalogCourses, setCatalogCourses] = useState<CatalogCourse[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session?.userId) {
      setEnrolledIds([]);
      setCatalogCourses([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const loadCatalog = async () => {
      try {
        const authenticCourses = await fetchPublishedCourses();
        const users = ensureInstructorRecordsForCourses(authenticCourses);
        const enrollments = readLocalEnrollments();

        if (!isMounted) return;

        const mappedCourses: CatalogCourse[] = authenticCourses.map((course, index) => {
          const instructor = users.find((user) => user.id === course.instructorId);
          const lessonCount = course.modules?.reduce((total, module) => total + module.lessons.length, 0) ?? 0;
          const learnerCount = enrollments.filter((entry) => entry.courseId === course.id).length;

          return {
            id: course.id,
            title: course.title,
            category: (course.category ?? 'Development') as CourseCategory,
            difficulty: (course.difficulty ?? 'Beginner') as CourseDifficulty,
            duration: formatCourseDuration(course),
            lessons: lessonCount,
            rating: 4.8,
            students: formatLearnerCount(learnerCount),
            instructor: instructor?.profile.full_name ?? 'Verified instructor',
            description: course.description,
            outcomes: [
              'Instructor-led curriculum',
              'Hands-on exercises',
              'Career-ready learning path',
            ],
            accent: courseGradients[index % courseGradients.length],
            enrolled: false,
          };
        });

        setCatalogCourses(mappedCourses);
        setEnrolledIds(
          readLocalEnrollments()
            .filter((entry) => entry.studentId === session.userId)
            .map((entry) => entry.courseId),
        );
      } catch (error) {
        console.error('Failed to load published courses:', error);
        if (isMounted) setCatalogCourses([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadCatalog();

    return () => {
      isMounted = false;
    };
  }, [session?.userId]);

  const filteredCourses = useMemo(() => {
    return catalogCourses.filter((course) => {
      const matchesSearch =
        !search ||
        `${course.title} ${course.instructor} ${course.description}`
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchesCategory =
        selectedCategory === 'All' || course.category === selectedCategory;
      const matchesDifficulty =
        selectedDifficulty === 'All' || course.difficulty === selectedDifficulty;

      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [catalogCourses, search, selectedCategory, selectedDifficulty]);

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory('All');
    setSelectedDifficulty('All');
  };

  const handleEnroll = async (courseId: string) => {
    if (!session?.userId) return;

    const existingEnrollments = readLocalEnrollments();
    const alreadyEnrolled = existingEnrollments.some(
      (entry) => entry.studentId === session.userId && entry.courseId === courseId,
    );

    if (!alreadyEnrolled) {
      const backendSucceeded = await enrollStudentInCourse(session.userId, courseId);
      if (backendSucceeded) {
        const nextEnrollment: LocalEnrollmentRecord = {
          id: `${session.userId}:${courseId}`,
          userId: session.userId,
          studentId: session.userId,
          courseId,
          completedLessonIds: [],
          progressPercentage: 0,
          progress: 0,
          status: 'active',
          enrolledAt: new Date().toISOString(),
        };

        const nextEnrollments = [...existingEnrollments.filter((entry) => !(entry.studentId === session.userId && entry.courseId === courseId)), nextEnrollment];
        writeLocalEnrollments(nextEnrollments);
      }

      setEnrolledIds((current) => (current.includes(courseId) ? current : [...current, courseId]));
      setCatalogCourses((current) => current.map((course) =>
        course.id === courseId ? { ...course, enrolled: true } : course,
      ));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('learnflow-enrollment-changed', {
          detail: { studentIds: [session.userId], timestamp: Date.now() },
        }));
      }
    }

    setSelectedCourse((course) =>
      course ? { ...course, enrolled: true } : course,
    );
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
            Explore learning
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Browse Courses
          </h1>
        </div>

        <div className="flex w-full max-w-lg items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses or instructors"
            className="w-full border-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <Filter className="h-4 w-4 text-primary-500" />
          Filters
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              Category
            </p>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedCategory === category
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
              Difficulty
            </p>
            <div className="flex flex-wrap gap-2">
              {difficulties.map((level) => (
                <button
                  key={level}
                  onClick={() => setSelectedDifficulty(level)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedDifficulty === level
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing <span className="font-semibold text-gray-900 dark:text-white">{filteredCourses.length}</span> courses
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading courses" aria-busy="true">
          {[1, 2, 3].map((skeleton) => (
            <div key={skeleton} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="h-28 animate-pulse bg-gray-200 dark:bg-gray-800" />
              <div className="space-y-4 p-5">
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-6 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800/70" />
                <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800/70" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredCourses.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredCourses.map((course) => {
          const isEnrolled = enrolledIds.includes(course.id);

          return (
            <article
              key={course.id}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-transform hover:-translate-y-0.5 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className={`h-28 bg-gradient-to-br ${course.accent}`} />

              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {course.category}
                  </span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {course.difficulty}
                  </span>
                </div>

                <h3 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
                  {course.title}
                </h3>

                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{course.description}</p>

                <div className="mt-4 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>{course.instructor}</span>
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-warning-400 text-warning-400" />
                    {course.rating}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    {course.duration}
                  </span>
                  <span>{course.lessons} lessons</span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    onClick={() => setSelectedCourse(course)}
                    className="btn-secondary flex-1 justify-center"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => handleEnroll(course.id)}
                    className={`flex-1 justify-center ${isEnrolled ? 'btn-secondary' : 'btn-primary'}`}
                  >
                    {isEnrolled ? 'Enrolled' : 'Enroll'}
                  </button>
                </div>
              </div>
            </article>
          );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen className="h-7 w-7" />}
          title="No courses found"
          description="There are no published courses matching your current search and filters."
          action={(
            <button type="button" onClick={clearFilters} className="btn-primary">
              Clear filters
            </button>
          )}
        />
      )}

      {selectedCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <div className={`h-32 bg-gradient-to-br ${selectedCourse.accent}`} />

            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                    {selectedCourse.category}
                    <span className="text-gray-300 dark:text-gray-700">•</span>
                    {selectedCourse.difficulty}
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                    {selectedCourse.title}
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedCourse(null)}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  aria-label="Close preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>{selectedCourse.instructor}</span>
                <span>{selectedCourse.duration}</span>
                <span>{selectedCourse.lessons} lessons</span>
                <span className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-warning-400 text-warning-400" />
                  {selectedCourse.rating} rating
                </span>
              </div>

              <p className="mt-5 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {selectedCourse.description}
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {selectedCourse.outcomes.map((outcome) => (
                  <div
                    key={outcome}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {outcome}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                    Learners
                  </p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedCourse.students}
                  </p>
                </div>

                <button
                  onClick={() => {
                    handleEnroll(selectedCourse.id);
                    setSelectedCourse(null);
                  }}
                  className={enrolledIds.includes(selectedCourse.id) ? 'btn-secondary' : 'btn-primary'}
                >
                  {enrolledIds.includes(selectedCourse.id) ? 'Enrolled' : 'Enroll now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
