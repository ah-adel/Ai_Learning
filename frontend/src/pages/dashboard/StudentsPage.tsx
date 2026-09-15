import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  GraduationCap,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  readLocalCourses,
  readLocalEnrollments,
  readLocalUsers,
  writeLocalEnrollments,
  writeLocalUsers,
  type LocalCourseRecord,
  type LocalEnrollmentRecord,
} from '@/lib/localDb';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/context/I18nContext';

type StudentRow = {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  lastActive: string;
  courseCount: number;
  averageProgress: number;
  enrollments: Array<{
    id: string;
    courseId: string;
    courseTitle: string;
    progress: number;
    status: 'active' | 'completed';
  }>;
};

export function StudentsPage() {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLoading(true);
      setError(null);

      const users = readLocalUsers().filter((user) => user.role === 'student');
      const courses = readLocalCourses();
      const enrollments = readLocalEnrollments();
      const instructorCourseIds = profile?.role === 'instructor' && session?.userId
        ? new Set(courses.filter((course) => course.instructorId === session.userId).map((course) => course.id))
        : null;

      const nextStudents: StudentRow[] = users
        .map((user) => {
          const studentEnrollments = enrollments.filter((entry) => entry.studentId === user.id);
          const relevantEnrollments = instructorCourseIds
            ? studentEnrollments.filter((entry) => instructorCourseIds.has(entry.courseId))
            : studentEnrollments;

          const mapped = relevantEnrollments.map((entry) => {
            const course = courses.find((item) => item.id === entry.courseId);
            const progress = Number.isFinite(entry.progress) ? Number(entry.progress) : 0;
            return {
              id: entry.id,
              courseId: entry.courseId,
              courseTitle: course?.title ?? 'Unknown course',
              progress,
              status: entry.status,
            };
          });

          if (instructorCourseIds && mapped.length === 0) {
            return null;
          }

          return {
            id: user.id,
            name: user.profile.full_name,
            email: user.email,
            status: user.status ?? 'active',
            lastActive: 'Recently active',
            courseCount: mapped.length,
            averageProgress: mapped.length
              ? Math.round(mapped.reduce((sum, entry) => sum + entry.progress, 0) / mapped.length)
              : 0,
            enrollments: mapped,
          };
        })
        .filter((student): student is StudentRow => Boolean(student));

      setStudents(nextStudents);
      if (nextStudents.length > 0 && !selectedStudentId) {
        setSelectedStudentId(nextStudents[0].id);
      }
    } catch (loadError) {
      console.error('Failed to load students:', loadError);
      setError('Unable to load student records from the local platform database.');
    } finally {
      setLoading(false);
    }
  }, [profile?.role, selectedStudentId, session?.userId]);

  const courses = useMemo(() => readLocalCourses(), []);

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const matchesSearch =
        student.name.toLowerCase().includes(search.toLowerCase()) ||
        student.email.toLowerCase().includes(search.toLowerCase());
      const matchesCourse =
        courseFilter === 'all' ||
        student.enrollments.some((entry) => entry.courseId === courseFilter);

      return matchesSearch && matchesCourse;
    });
  }, [courseFilter, search, students]);

  const selectedStudent =
    filteredStudents.find((student) => student.id === selectedStudentId) ?? filteredStudents[0] ?? null;

  const updateStudentStatus = (studentId: string) => {
    const users = readLocalUsers();
    const nextUsers = users.map((user) =>
      user.id === studentId
        ? {
            ...user,
            status: (user.status === 'active' ? 'suspended' : 'active') as 'active' | 'suspended',
          }
        : user,
    );
    writeLocalUsers(nextUsers);
    setStudents((current) =>
      current.map((student) =>
        student.id === studentId
          ? { ...student, status: student.status === 'active' ? 'suspended' : 'active' }
          : student,
      ),
    );
  };

  const updateEnrollmentProgress = (enrollmentId: string, nextProgress: number) => {
    const enrollments = readLocalEnrollments();
    const nextEnrollments = enrollments.map((entry) =>
      entry.id === enrollmentId
        ? {
            ...entry,
            progress: nextProgress,
            status: (nextProgress >= 100 ? 'completed' : 'active') as 'active' | 'completed',
          }
        : entry,
    );
    writeLocalEnrollments(nextEnrollments);
    setStudents((current) =>
      current.map((student) => ({
        ...student,
        averageProgress: student.enrollments.length
          ? Math.round(
              student.enrollments.reduce((sum, entry) =>
                sum + (entry.id === enrollmentId ? nextProgress : entry.progress),
                0,
              ) / student.enrollments.length,
            )
          : 0,
        enrollments: student.enrollments.map((entry) =>
          entry.id === enrollmentId
            ? {
                ...entry,
                progress: nextProgress,
                status: (nextProgress >= 100 ? 'completed' : 'active') as 'active' | 'completed',
              }
            : entry,
        ),
      })),
    );
  };

  const removeEnrollment = (enrollmentId: string) => {
    const enrollments = readLocalEnrollments();
    const nextEnrollments = enrollments.filter((entry) => entry.id !== enrollmentId);
    writeLocalEnrollments(nextEnrollments);
    setStudents((current) =>
      current.map((student) => ({
        ...student,
        courseCount: student.enrollments.filter((entry) => entry.id !== enrollmentId).length,
        averageProgress:
          student.enrollments.filter((entry) => entry.id !== enrollmentId).length > 0
            ? Math.round(
                student.enrollments
                  .filter((entry) => entry.id !== enrollmentId)
                  .reduce((sum, entry) => sum + entry.progress, 0) /
                  student.enrollments.filter((entry) => entry.id !== enrollmentId).length,
              )
            : 0,
        enrollments: student.enrollments.filter((entry) => entry.id !== enrollmentId),
      })),
    );
  };

  if (loading) {
    return <LoadingState label={t('common.loading')} className="min-h-[30vh]" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
            {t('students.operations')}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('students.title')}</h1>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('students.search')}
              className="input-field w-full pl-10 sm:w-64"
            />
          </div>

          <select
            value={courseFilter}
            onChange={(event) => setCourseFilter(event.target.value)}
            className="input-field sm:w-52"
          >
            <option value="all">{t('students.allCourses')}</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr,0.9fr]">
        <div className="card overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('students.directory')}</h2>
              <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
                {filteredStudents.length} {t('students.activeStudents')}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-gray-50 text-xs uppercase tracking-[0.12em] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-3">{t('students.student')}</th>
                  <th className="px-5 py-3">{t('students.status')}</th>
                  <th className="px-5 py-3">{t('students.courses')}</th>
                  <th className="px-5 py-3">{t('students.progress')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr
                    key={student.id}
                    className={`cursor-pointer border-t border-gray-200 transition-colors dark:border-gray-800 ${
                      selectedStudent?.id === student.id ? 'bg-primary-50/60 dark:bg-primary-950/10' : 'hover:bg-gray-50 dark:hover:bg-gray-900/60'
                    }`}
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{student.name}</p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{student.email}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateStudentStatus(student.id);
                        }}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          student.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                        }`}
                      >
                        {student.status === 'active' ? t('common.active') : t('common.suspended')}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{student.courseCount}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-500"
                            style={{ width: `${student.averageProgress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          {student.averageProgress}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          {selectedStudent ? (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                      {t('students.profile')}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{selectedStudent.name}</h2>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/30 dark:text-primary-300">
                    <Users className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-5 space-y-4 text-sm text-gray-600 dark:text-gray-300">
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <span>{t('common.email')}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selectedStudent.email}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <span>Status</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selectedStudent.status}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <span>{t('common.lastActive')}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selectedStudent.lastActive}</span>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                      Enrollment manager
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{t('common.courseProgress')}</h2>
                  </div>
                  <GraduationCap className="h-5 w-5 text-primary-500" />
                </div>

                <div className="mt-5 space-y-4">
                  {selectedStudent.enrollments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
                      No courses are currently enrolled.
                    </div>
                  ) : (
                    selectedStudent.enrollments.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{entry.courseTitle}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{entry.status === 'completed' ? 'Completed' : 'In progress'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEnrollment(entry.id)}
                            className="text-xs font-medium text-red-600 transition-colors hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                          >
                            Remove
                          </button>
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>Progress</span>
                            <span className="font-medium text-gray-700 dark:text-gray-200">{entry.progress}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={entry.progress}
                            onChange={(event) => updateEnrollmentProgress(entry.id, Number(event.target.value))}
                            className="w-full accent-primary-600"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title={t('common.noStudents')}
              description={t('common.noStudentsDescription')}
              icon={<Users className="h-8 w-8" />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
