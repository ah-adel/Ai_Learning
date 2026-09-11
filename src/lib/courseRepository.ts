import {
  persistInstructorCourse,
  readAuthenticInstructorCourses,
  readLocalCourses,
  readLocalEnrollments,
  type LocalCourseRecord,
} from '@/lib/localDb';
import { loadCachedData } from '@/lib/dataCache';

export function resolveHostedLessonMediaPath(fileName: string, kind: 'video' | 'attachment') {
  const safeName = (fileName ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const normalizedName = safeName || `${kind}-${Date.now()}.bin`;
  const directory = kind === 'video' ? '/uploads/videos' : '/uploads/attachments';
  return `${directory}/${normalizedName}`;
}

export function normalizeLessonMediaUrl(value: string | null | undefined) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('blob:')) return null;

  if (
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  return null;
}

export function normalizeCourseLessonMediaPaths(course: LocalCourseRecord): LocalCourseRecord {
  return {
    ...course,
    modules: (course.modules ?? []).map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        videoUrl: normalizeLessonMediaUrl(lesson.videoUrl) ?? lesson.videoUrl ?? null,
        attachmentUrl: normalizeLessonMediaUrl(lesson.attachmentUrl) ?? lesson.attachmentUrl ?? null,
      })),
    })),
  };
}

export async function createCourseForInstructor(course: LocalCourseRecord, instructorId: string): Promise<LocalCourseRecord> {
  try {
    const persistedCourse = normalizeCourseLessonMediaPaths(course);
    persistInstructorCourse(persistedCourse, instructorId);
    return persistedCourse;
  } catch (localError) {
    console.error('Local instructor course persistence failed:', {
      localError,
      instructorId,
      courseId: course.id,
      title: course.title,
    });
    throw localError;
  }
}

export async function fetchInstructorCourses(instructorId: string): Promise<LocalCourseRecord[]> {
  return loadCachedData(`instructor-courses:${instructorId}`, () =>
    readLocalCourses()
      .filter((course) => course.instructorId === instructorId)
      .map(normalizeCourseLessonMediaPaths),
  );
}

export async function fetchPublishedCourses(): Promise<LocalCourseRecord[]> {
  return loadCachedData('published-courses', () =>
    readAuthenticInstructorCourses().map(normalizeCourseLessonMediaPaths),
  );
}

export async function fetchStudentEnrolledCourses(studentId: string): Promise<LocalCourseRecord[]> {
  return loadCachedData(`student-enrolled-courses:${studentId}`, () => {
    const enrollments = readLocalEnrollments().filter((entry) => entry.studentId === studentId);
    const courseIds = new Set(enrollments.map((entry) => entry.courseId));

    return readLocalCourses()
      .filter((course) => courseIds.has(course.id))
      .map(normalizeCourseLessonMediaPaths);
  });
}
