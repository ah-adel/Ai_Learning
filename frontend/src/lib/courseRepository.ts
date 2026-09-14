import {
  persistInstructorCourse,
  readAuthenticInstructorCourses,
  readLocalCourses,
  readLocalEnrollments,
  type LocalCourseRecord,
} from '@/lib/localDb';
import {
  invalidateInstructorCourseCache,
  invalidateStudentEnrollmentCache,
  loadCachedData,
} from '@/lib/dataCache';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

function normalizeLessonType(value: unknown): 'Video' | 'Reading' | 'Exercise' {
  if (value === 'Reading' || value === 'Exercise') {
    return value;
  }

  return 'Video';
}

function normalizeApiCourseRecord(course: Record<string, unknown>): LocalCourseRecord {
  const modules = Array.isArray(course.modules) ? course.modules.map((module: Record<string, unknown>) => ({
    id: String((module as { id?: string }).id ?? crypto.randomUUID()),
    title: String((module as { title?: string }).title ?? 'Module'),
    courseId: String((module as { course_id?: string; courseId?: string }).course_id ?? (module as { course_id?: string; courseId?: string }).courseId ?? course.id ?? crypto.randomUUID()),
    order: Number((module as { position?: number }).position ?? 0),
    lessons: Array.isArray((module as { lessons?: unknown[] }).lessons)
      ? (module as { lessons: Array<Record<string, unknown>> }).lessons.map((lesson: Record<string, unknown>) => ({
          id: String((lesson as { id?: string }).id ?? crypto.randomUUID()),
          moduleId: String((lesson as { module_id?: string; moduleId?: string }).module_id ?? (lesson as { module_id?: string; moduleId?: string }).moduleId ?? module.id ?? crypto.randomUUID()),
          title: String((lesson as { title?: string }).title ?? 'Lesson'),
          summary: String((lesson as { content?: string }).content ?? 'Lesson content'),
          type: normalizeLessonType((lesson as { type?: string }).type),
          duration: Number((lesson as { duration_minutes?: number; duration?: number }).duration_minutes ?? (lesson as { duration_minutes?: number; duration?: number }).duration ?? 0),
          videoName: typeof (lesson as { video_name?: string }).video_name === 'string' ? String((lesson as { video_name?: string }).video_name) : null,
          videoUrl: typeof (lesson as { video_url?: string }).video_url === 'string' ? String((lesson as { video_url?: string }).video_url) : null,
          attachmentName: typeof (lesson as { attachment_name?: string }).attachment_name === 'string' ? String((lesson as { attachment_name?: string }).attachment_name) : null,
          attachmentUrl: typeof (lesson as { attachment_url?: string }).attachment_url === 'string' ? String((lesson as { attachment_url?: string }).attachment_url) : null,
          isFreePreview: false,
        }))
      : [],
  })) : [];

  return {
    id: String((course as { id?: string }).id ?? crypto.randomUUID()),
    title: String((course as { title?: string }).title ?? 'Untitled course'),
    description: String((course as { description?: string }).description ?? 'Course description'),
    instructorId: String((course as { instructor_id?: string; instructorId?: string }).instructor_id ?? (course as { instructor_id?: string; instructorId?: string }).instructorId ?? 'unknown-instructor'),
    price: Number((course as { price?: number }).price ?? 0),
    category: String((course as { category?: string }).category ?? 'General'),
    status: (course as { status?: string }).status === 'published' ? 'published' : 'draft',
    thumbnail: typeof (course as { thumbnail_url?: string }).thumbnail_url === 'string' ? String((course as { thumbnail_url?: string }).thumbnail_url) : null,
    difficulty: 'Beginner',
    isPublished: Boolean((course as { is_published?: boolean }).is_published ?? ((course as { status?: string }).status === 'published')), 
    createdAt: typeof (course as { created_at?: string }).created_at === 'string' ? String((course as { created_at?: string }).created_at) : new Date().toISOString(),
    aiModel: 'Coach Pro',
    modules,
  } satisfies LocalCourseRecord;
}

function uniqueCourseRecords(courses: LocalCourseRecord[]): LocalCourseRecord[] {
  return Array.from(
    new Map(courses.filter((course) => Boolean(course.id)).map((course) => [course.id, course])).values(),
  );
}

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

async function getAuthToken(): Promise<string> {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem('learnflow_session_token') ?? '';
}

export async function saveCourseForInstructor(course: LocalCourseRecord, instructorId: string, mode: 'create' | 'update' = 'create'): Promise<LocalCourseRecord> {
  const normalizedCourse = normalizeCourseLessonMediaPaths(course);
  const token = await getAuthToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/courses${mode === 'update' ? `/${encodeURIComponent(normalizedCourse.id)}` : ''}`, {
      method: mode === 'update' ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
      body: JSON.stringify({
        id: mode === 'update' ? normalizedCourse.id : undefined,
        instructor_id: instructorId,
        title: normalizedCourse.title,
        description: normalizedCourse.description,
        thumbnail_url: normalizedCourse.thumbnail,
        status: normalizedCourse.isPublished ? 'published' : 'draft',
        is_published: normalizedCourse.isPublished,
        modules: (normalizedCourse.modules ?? []).map((module) => ({
          id: module.id,
          title: module.title,
          position: module.order ?? 0,
          lessons: (module.lessons ?? []).map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            content: lesson.summary,
            video_url: lesson.videoUrl,
            video_name: lesson.videoName,
            attachment_url: lesson.attachmentUrl,
            attachment_name: lesson.attachmentName,
            position: 0,
            duration_minutes: lesson.duration ? Math.max(1, Math.round(Number(lesson.duration) / 60)) : 0,
          })),
        })),
      }),
    });

    if (response.ok) {
      const payload = await response.json().catch(() => ({ data: null }));
      const apiCourse = payload?.data ?? null;
      if (apiCourse) {
        const nextCourse = normalizeApiCourseRecord(apiCourse as Record<string, unknown>);
        persistInstructorCourse(nextCourse, instructorId);
        invalidateInstructorCourseCache(instructorId);
        return nextCourse;
      }
    }

    if (mode === 'update') {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? `Course update failed: ${response.status}`);
    }

    const fallbackCourse = persistInstructorCourse(normalizedCourse, instructorId);
    invalidateInstructorCourseCache(instructorId);
    return fallbackCourse.courses.find((entry) => entry.id === normalizedCourse.id) ?? normalizedCourse;
  } catch (error) {
    if (mode === 'update') {
      throw error;
    }
    console.warn('Backend course creation failed; falling back to local persistence.', error);
    const fallbackCourse = persistInstructorCourse(normalizedCourse, instructorId);
    invalidateInstructorCourseCache(instructorId);
    return fallbackCourse.courses.find((entry) => entry.id === normalizedCourse.id) ?? normalizedCourse;
  }
}

export function createCourseForInstructor(course: LocalCourseRecord, instructorId: string): Promise<LocalCourseRecord> {
  return saveCourseForInstructor(course, instructorId, 'create');
}

export function updateCourseForInstructor(course: LocalCourseRecord, instructorId: string): Promise<LocalCourseRecord> {
  return saveCourseForInstructor(course, instructorId, 'update');
}

export async function fetchCourseById(courseId: string): Promise<LocalCourseRecord | null> {
  const normalizedId = courseId.trim().toLowerCase();
  if (!normalizedId) return null;
  const token = await getAuthToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/courses/${encodeURIComponent(courseId.trim())}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    });
    if (response.ok) {
      const payload = await response.json().catch(() => ({ data: null }));
      return payload?.data ? normalizeCourseLessonMediaPaths(normalizeApiCourseRecord(payload.data as Record<string, unknown>)) : null;
    }
  } catch (error) {
    console.warn('Remote course detail request failed; using local fallback.', error);
  }

  const localCourse = readLocalCourses().find((course) => course.id.trim().toLowerCase() === normalizedId);
  return localCourse ? normalizeCourseLessonMediaPaths(localCourse) : null;
}

export async function fetchInstructorCourses(instructorId: string): Promise<LocalCourseRecord[]> {
  return loadCachedData(`instructor-courses:${instructorId}`, async () => {
    const token = await getAuthToken();

    try {
      const response = await fetch(`${API_BASE_URL}/api/courses`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Instructor courses request failed: ${response.status}`);
      }

      const payload = await response.json().catch(() => ({ data: [] }));
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const normalized = rows.map((course: Record<string, unknown>) => normalizeApiCourseRecord(course));
      return uniqueCourseRecords(normalized).map(normalizeCourseLessonMediaPaths);
    } catch (error) {
      console.warn('Falling back to local instructor course catalog:', error);
      return readLocalCourses()
        .filter((course) => course.instructorId === instructorId)
        .map(normalizeCourseLessonMediaPaths);
    }
  });
}

export async function fetchPublishedCourses(): Promise<LocalCourseRecord[]> {
  return loadCachedData('published-courses', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/public`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Public courses request failed: ${response.status}`);
      }

      const payload = await response.json().catch(() => ({ data: [] }));
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const normalized = rows.map((course: Record<string, unknown>) => normalizeApiCourseRecord(course));
      return uniqueCourseRecords(normalized).map(normalizeCourseLessonMediaPaths);
    } catch (error) {
      console.warn('Falling back to local published course catalog:', error);
      return uniqueCourseRecords(readAuthenticInstructorCourses())
        .filter((course) => course.isPublished && course.status === 'published')
        .map(normalizeCourseLessonMediaPaths);
    }
  });
}

export async function enrollStudentInCourse(studentId: string, courseId: string): Promise<boolean> {
  const token = await getAuthToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/courses/${encodeURIComponent(courseId)}/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? `Enrollment failed: ${response.status}`);
    }

    invalidateStudentEnrollmentCache(studentId);
    return true;
  } catch (error) {
    console.warn('Backend enrollment failed; keeping local fallback.', error);
    return false;
  }
}

export async function unenrollStudentFromCourse(studentId: string, courseId: string): Promise<boolean> {
  const token = await getAuthToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/courses/${encodeURIComponent(courseId)}/enroll`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? `Unenrollment failed: ${response.status}`);
    }

    invalidateStudentEnrollmentCache(studentId);
    return true;
  } catch (error) {
    console.warn('Backend unenrollment failed; keeping local fallback.', error);
    return false;
  }
}

export async function fetchStudentEnrolledCourses(studentId: string): Promise<LocalCourseRecord[]> {
  return loadCachedData(`student-enrolled-courses:${studentId}`, async () => {
    const token = await getAuthToken();

    try {
      const response = await fetch(`${API_BASE_URL}/api/student/courses`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Student courses request failed: ${response.status}`);
      }

      const payload = await response.json().catch(() => ({ data: [] }));
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const normalized = rows.map((course: Record<string, unknown>) => normalizeApiCourseRecord(course));
      return uniqueCourseRecords(normalized).map(normalizeCourseLessonMediaPaths);
    } catch (error) {
      console.warn('Falling back to local student enrollment catalog:', error);
      const enrollments = readLocalEnrollments().filter((entry) => entry.studentId === studentId);
      const courseIds = new Set(enrollments.map((entry) => entry.courseId));

      return readLocalCourses()
        .filter((course) => courseIds.has(course.id))
        .map(normalizeCourseLessonMediaPaths);
    }
  });
}
