import type { Profile, UserRole } from '@/types/database.types';
import type {
  Course,
  Enrollment,
  Lesson,
  Module,
  Progress,
  User,
} from '@/types';
import { deleteEntityCleanupApi, type DeleteCleanupResult } from '@/services/api';
import { invalidateInstructorCourseCache, invalidateStudentEnrollmentCache } from '@/lib/dataCache';

export const localDatabaseConfig = {
  provider: 'sqlite',
  databaseUrl: import.meta.env.VITE_DATABASE_URL ?? 'sqlite:///./data/educational_platform.db',
  localDbPath: import.meta.env.VITE_DB_PATH ?? './data/educational_platform.db',
};

export type LocalInstructorPermission = {
  manageCourses: boolean;
  moderateStudents: boolean;
  viewAnalytics: boolean;
};

export type LocalUserRecord = User & {
  email: string;
  password: string;
  profile: Profile;
  role: UserRole;
  status?: 'active' | 'inactive' | 'suspended';
  specialty?: string;
  joinedAt?: string;
  permissions?: LocalInstructorPermission;
  courseIds?: string[];
};

export type CourseLessonRecord = Lesson & {
  summary: string;
  type: 'Video' | 'Reading' | 'Exercise';
  videoName?: string | null;
  videoUrl?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  moduleId?: string;
  title: string;
  duration: number;
  isFreePreview?: boolean;
};

export type CourseModuleRecord = Module & {
  lessons: CourseLessonRecord[];
};

export type LocalCourseRecord = Course & {
  description: string;
  category: string;
  aiModel?: string;
  instructorId: string;
  price: number;
  status: 'draft' | 'published' | 'review';
  thumbnail: string | null;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  isPublished: boolean;
  createdAt: string;
  modules?: CourseModuleRecord[];
};

// تعديل الدالة لتقبل جميع أنواع الروابط المحلية والمرفوعة
const sanitizeMediaUrl = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // السماح بالروابط المؤقتة (blob)، والملفات المخزنة كـ Base64 (data)، والمسارات المحلية
  if (
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('./uploads/') ||
    trimmed.startsWith('uploads/') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }

  return trimmed;
};

const getNormalizedMediaValue = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const sanitized = sanitizeMediaUrl(value);
    if (sanitized) return sanitized;
  }

  return null;
};

export function normalizeLessonMedia<T extends Partial<CourseLessonRecord>>(lesson: T): T & {
  videoUrl: string | null;
  attachmentUrl: string | null;
  videoName: string | null;
  attachmentName: string | null;
} {
  const record = lesson as Partial<CourseLessonRecord> & Record<string, unknown>;

  return {
    ...lesson,
    videoUrl: getNormalizedMediaValue(
      record.videoUrl as string | null | undefined,
      record.video_url as string | null | undefined,
      record.mediaUrl as string | null | undefined,
      record.media_url as string | null | undefined,
    ),
    attachmentUrl: getNormalizedMediaValue(
      record.attachmentUrl as string | null | undefined,
      record.attachment_url as string | null | undefined,
      record.fileUrl as string | null | undefined,
      record.file_url as string | null | undefined,
      record.attachmentPath as string | null | undefined,
      record.attachment_path as string | null | undefined,
    ),
    videoName: (record.videoName || record.video_name || record.videoFileName || null) as string | null,
    attachmentName: (record.attachmentName || record.attachment_name || record.fileName || record.file_name || null) as string | null,
  };
}

export function normalizeStoredCourse(course: Partial<LocalCourseRecord> | null | undefined): LocalCourseRecord | null {
  if (!course) return null;

  const normalizedModules = course.modules?.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => normalizeLessonMedia(lesson)),
  }));

  return {
    ...course,
    modules: normalizedModules,
  } as LocalCourseRecord;
}

export type LocalEnrollmentRecord = Enrollment & {
  userId: string;
  studentId: string;
  courseId: string;
  progress: number;
  status: 'active' | 'completed';
  enrolledAt: string;
  completedLessonIds: string[];
  progressPercentage: number;
};

export type LocalAiModelRecord = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  apiEndpoint: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalPlatformSettings = {
  adminName: string;
  adminEmail: string;
  companyName: string;
  siteName: string;
  timezone: string;
  allowStudentSignup: boolean;
  requireEmailVerification: boolean;
  autoPublishCourses: boolean;
  defaultTheme: 'system' | 'light' | 'dark';
  supportEmail: string;
  performancePlatformReferences: boolean;
};

const defaultProfile = (id: string, fullName: string, role: UserRole): Profile => ({
  id,
  full_name: fullName,
  role,
  avatar_url: null,
  bio: role === 'admin' ? 'Platform administrator.' : role === 'instructor' ? 'Instructor and course mentor.' : 'Active learner on the platform.',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const cleanSeedUsers = (): LocalUserRecord[] => {
  const now = new Date().toISOString();

  return [
    {
      id: 'admin-1',
      name: 'Platform Admin',
      email: MASTER_ADMIN_EMAIL,
      password: 'Ah.667788',
      role: 'admin',
      avatar: null,
      status: 'active',
      joinedAt: now,
      profile: defaultProfile('admin-1', 'Platform Admin', 'admin'),
      permissions: {
        manageCourses: true,
        moderateStudents: true,
        viewAnalytics: true,
      },
    },
    {
      id: 'instructor-1',
      name: 'Maya Brooks',
      email: 'instructor@learnflow.io',
      password: 'instructor123',
      role: 'instructor',
      avatar: null,
      status: 'active',
      specialty: 'AI & Automation',
      joinedAt: now,
      permissions: {
        manageCourses: true,
        moderateStudents: true,
        viewAnalytics: true,
      },
      courseIds: ['course-1'],
      profile: defaultProfile('instructor-1', 'Maya Brooks', 'instructor'),
    },
    {
      id: 'student-1',
      name: 'Ava Thompson',
      email: 'student@learnflow.io',
      password: 'student123',
      role: 'student',
      avatar: null,
      status: 'active',
      joinedAt: now,
      profile: defaultProfile('student-1', 'Ava Thompson', 'student'),
    },
  ];
};

const cleanSeedCourses = (): LocalCourseRecord[] => [
  {
    id: 'course-1',
    title: 'AI Productivity Foundations',
    description: 'Build practical AI workflows for writing, planning, analysis, and automation in real projects.',
    instructorId: 'instructor-1',
    price: 79,
    category: 'AI & Automation',
    status: 'published',
    thumbnail: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    aiModel: 'Coach Pro',
    difficulty: 'Beginner',
    isPublished: true,
    createdAt: new Date().toISOString(),
    modules: [
      {
        id: 'module-1',
        courseId: 'course-1',
        title: 'Getting Started with AI Workflows',
        order: 1,
        lessons: [
          {
            id: 'lesson-1',
            moduleId: 'module-1',
            title: 'Welcome and course overview',
            summary: 'Orientation to the learning path and how AI fits into daily work.',
            type: 'Video',
            duration: 420,
            isFreePreview: true,
            videoName: 'welcome-overview.mp4',
            videoUrl: 'https://www.youtube.com/watch?v=3JZ_D3ELwOQ',
            attachmentName: null,
            attachmentUrl: null,
          },
          {
            id: 'lesson-2',
            moduleId: 'module-1',
            title: 'Prompt structures that produce better answers',
            summary: 'Learn simple prompt patterns for clarity, context, and output quality.',
            type: 'Video',
            duration: 540,
            videoName: 'prompt-structures.mp4',
            videoUrl: 'https://www.youtube.com/watch?v=8pDm_kH4YKY',
            attachmentName: 'prompt-frameworks.pdf',
            attachmentUrl: 'https://example.com/files/prompt-frameworks.pdf',
          },
        ],
      },
      {
        id: 'module-2',
        courseId: 'course-1',
        title: 'Practical Productivity Systems',
        order: 2,
        lessons: [
          {
            id: 'lesson-3',
            moduleId: 'module-2',
            title: 'Summarizing research and meeting notes',
            summary: 'Convert scattered notes into clean summaries and action plans.',
            type: 'Reading',
            duration: 360,
            videoName: null,
            videoUrl: null,
            attachmentName: 'research-summary-template.md',
            attachmentUrl: 'https://example.com/files/research-summary-template.md',
          },
          {
            id: 'lesson-4',
            moduleId: 'module-2',
            title: 'Hands-on project: draft a weekly workflow',
            summary: 'Turn your daily tasks into a reusable AI-powered operating system.',
            type: 'Exercise',
            duration: 600,
            videoName: null,
            videoUrl: null,
            attachmentName: 'weekly-workflow-template.xlsx',
            attachmentUrl: 'https://example.com/files/weekly-workflow-template.xlsx',
          },
        ],
      },
    ],
  },
];

const defaultEnrollments: LocalEnrollmentRecord[] = [];

const defaultAiModels: LocalAiModelRecord[] = [
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    modelId: 'gpt-4o-mini',
    apiKey: 'sk-demo-key',
    apiEndpoint: 'https://api.openai.com/v1',
    systemPrompt: 'You are a helpful learning coach guiding students through practical, actionable steps.',
    temperature: 0.4,
    maxTokens: 1800,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    modelId: 'claude-3-5-sonnet',
    apiKey: 'anthropic-demo-key',
    apiEndpoint: 'https://api.anthropic.com',
    systemPrompt: 'Act as a thoughtful mentor who explains concepts clearly and provides structured instruction.',
    temperature: 0.6,
    maxTokens: 2200,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'gemini-2-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    modelId: 'gemini-2.0-flash',
    apiKey: '',
    apiEndpoint: 'https://generativelanguage.googleapis.com',
    systemPrompt: 'Provide concise, high-quality answers and scaffold learning tasks for students.',
    temperature: 0.7,
    maxTokens: 1200,
    isActive: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const MASTER_ADMIN_EMAIL = 'ah.adel2188@gmail.com';

const defaultSettings: LocalPlatformSettings = {
  adminName: 'Platform Admin',
  adminEmail: MASTER_ADMIN_EMAIL,
  companyName: 'LearnFlow AI',
  siteName: 'LearnFlow AI Academy',
  timezone: 'UTC',
  allowStudentSignup: true,
  requireEmailVerification: true,
  autoPublishCourses: false,
  defaultTheme: 'system',
  supportEmail: 'support@learnflow.io',
  performancePlatformReferences: true,
};

const memoryStore: Record<string, unknown> = {};

function readLocalStorageJSON<T>(key: string, fallback: T): T {
  if (key in memoryStore) {
    return memoryStore[key] as T;
  }

  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    if (!value) {
      memoryStore[key] = fallback;
      return fallback;
    }

    const parsed = JSON.parse(value) as T;
    memoryStore[key] = parsed ?? fallback;
    return parsed ?? fallback;
  } catch {
    memoryStore[key] = fallback;
    return fallback;
  }
}

function writeLocalStorageJSON<T>(key: string, value: T) {
  memoryStore[key] = value;
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  }
}

function isPersistableCourse(course: Partial<LocalCourseRecord> | null | undefined) {
  if (!course) return false;

  const title = typeof course.title === 'string' ? course.title.trim() : '';
  const description = typeof course.description === 'string' ? course.description.trim() : '';
  const instructorId = typeof course.instructorId === 'string' ? course.instructorId.trim() : '';

  if (!title || !description || !instructorId) return false;

  return true;
}

export function getLocalUserStoreKey() {
  return 'eduplatform_users';
}

export function getLocalSessionStoreKey() {
  return 'eduplatform_session';
}

export function getLocalProfilesKey() {
  return 'eduplatform_profiles';
}

export function getLocalCoursesKey() {
  return 'eduplatform_courses';
}

export function getLocalEnrollmentsKey() {
  return 'eduplatform_enrollments';
}

export function getLocalAiModelsKey() {
  return 'eduplatform_ai_models';
}

export function getLocalSettingsKey() {
  return 'eduplatform_settings';
}

export function getMasterAdminEmail() {
  return MASTER_ADMIN_EMAIL;
}

export function isMasterAdminEmail(email?: string | null): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === MASTER_ADMIN_EMAIL;
}

export function deleteLocalUserById(userId: string, sessionUserEmail?: string | null): LocalUserRecord[] {
  const users = readLocalUsers();
  const targetUser = users.find((user) => user.id === userId);

  if (targetUser && isMasterAdminEmail(targetUser.email) && sessionUserEmail?.trim().toLowerCase() !== MASTER_ADMIN_EMAIL) {
    throw new Error('The master admin account can only be removed by the owner account.');
  }

  const nextUsers = users.filter((user) => user.id !== userId);
  writeLocalUsers(nextUsers);
  return nextUsers;
}

export function getMasterAdminUser(users: LocalUserRecord[] = readLocalUsers()): LocalUserRecord | undefined {
  return users.find((user) => isMasterAdminEmail(user.email));
}

export function isMasterAdminUser(user?: Partial<LocalUserRecord> | null): boolean {
  if (!user) return false;
  return isMasterAdminEmail(user.email) || user.id === getMasterAdminUser()?.id;
}

export function isPublicSignupRole(role: UserRole | null | undefined): role is 'student' | 'instructor' {
  return role === 'student' || role === 'instructor';
}

function protectMasterAdminUsers(users: LocalUserRecord[] = []): LocalUserRecord[] {
  const safeUsers = Array.isArray(users) ? users : [];
  const seededMaster = cleanSeedUsers().find((user) => isMasterAdminEmail(user.email));
  const existingMaster = safeUsers.find((user) => isMasterAdminEmail(user.email));

  const protectedMaster: LocalUserRecord = {
    ...(existingMaster ?? seededMaster ?? cleanSeedUsers()[0]),
    id: 'admin-1',
    name: 'Platform Admin',
    email: MASTER_ADMIN_EMAIL,
    password: 'Ah.667788',
    role: 'admin',
    status: 'active',
    joinedAt: existingMaster?.joinedAt ?? new Date().toISOString(),
    profile: {
      ...(existingMaster?.profile ?? defaultProfile('admin-1', 'Platform Admin', 'admin')),
      id: 'admin-1',
      full_name: 'Platform Admin',
      role: 'admin',
      bio: 'Platform administrator and system owner.',
      updated_at: new Date().toISOString(),
    },
    permissions: {
      manageCourses: true,
      moderateStudents: true,
      viewAnalytics: true,
      ...(existingMaster?.permissions ?? {}),
    },
  };

  const nextUsers = safeUsers.filter((user) => !isMasterAdminEmail(user.email));
  nextUsers.unshift(protectedMaster);

  return nextUsers.map((user) =>
    isMasterAdminEmail(user.email)
      ? {
          ...user,
          id: 'admin-1',
          name: 'Platform Admin',
          email: MASTER_ADMIN_EMAIL,
          password: 'Ah.667788',
          role: 'admin',
          status: 'active',
          profile: {
            ...user.profile,
            id: 'admin-1',
            full_name: 'Platform Admin',
            role: 'admin',
            bio: 'Platform administrator and system owner.',
            updated_at: new Date().toISOString(),
          },
          permissions: {
            manageCourses: true,
            moderateStudents: true,
            viewAnalytics: true,
            ...(user.permissions ?? {}),
          },
        }
      : user,
  );
}

export function seedLocalDatabase() {
  const seedUsers = cleanSeedUsers();
  const seedProfiles = seedUsers.map((user) => user.profile);
  const seedCourses = cleanSeedCourses();

  const memoryUsers = readLocalStorageJSON<LocalUserRecord[]>(getLocalUserStoreKey(), []);
  const enforcedUsers = protectMasterAdminUsers(memoryUsers.length ? memoryUsers : seedUsers);
  writeLocalStorageJSON(getLocalUserStoreKey(), enforcedUsers);

  const profiles = readLocalStorageJSON<Profile[]>(getLocalProfilesKey(), []);
  if (profiles.length === 0) {
    writeLocalStorageJSON(getLocalProfilesKey(), seedProfiles);
  }

  const courses = readLocalStorageJSON<LocalCourseRecord[]>(getLocalCoursesKey(), []);
  if (courses.length === 0) {
    writeLocalStorageJSON(getLocalCoursesKey(), seedCourses);
  }

  const enrollments = readLocalStorageJSON<LocalEnrollmentRecord[]>(getLocalEnrollmentsKey(), []);
  if (enrollments.length === 0) {
    writeLocalStorageJSON(getLocalEnrollmentsKey(), defaultEnrollments);
  }

  const aiModels = readLocalStorageJSON<LocalAiModelRecord[]>(getLocalAiModelsKey(), []);
  if (aiModels.length === 0) {
    writeLocalStorageJSON(getLocalAiModelsKey(), defaultAiModels);
  }

  const settings = readLocalStorageJSON<LocalPlatformSettings | null>(getLocalSettingsKey(), null);
  if (!settings) {
    writeLocalStorageJSON(getLocalSettingsKey(), defaultSettings);
  }
}

export function readLocalUsers(): LocalUserRecord[] {
  const users = readLocalStorageJSON<LocalUserRecord[]>(getLocalUserStoreKey(), []);
  return protectMasterAdminUsers(Array.isArray(users) ? users : []);
}

export function writeLocalUsers(users: LocalUserRecord[]) {
  const protectedUsers = protectMasterAdminUsers(Array.isArray(users) ? users : []);
  writeLocalStorageJSON(getLocalUserStoreKey(), protectedUsers);
}

export function ensureInstructorRecordsForCourses(courses: LocalCourseRecord[] = readLocalCourses()): LocalUserRecord[] {
  const users = readLocalUsers();
  const missingInstructors = courses
    .map((course) => course.instructorId)
    .filter((instructorId) => instructorId && !users.some((user) => user.id === instructorId));

  if (missingInstructors.length === 0) {
    return users;
  }

  const nextUsers = [...users];
  const createdAt = new Date().toISOString();

  missingInstructors.forEach((instructorId) => {
    nextUsers.push({
      id: instructorId,
      name: `Instructor ${instructorId.slice(0, 6)}`,
      email: `${instructorId}@learnflow.local`,
      password: 'instructor123',
      role: 'instructor',
      avatar: null,
      status: 'active',
      joinedAt: createdAt,
      profile: defaultProfile(instructorId, `Instructor ${instructorId.slice(0, 6)}`, 'instructor'),
      permissions: {
        manageCourses: true,
        moderateStudents: true,
        viewAnalytics: true,
      },
    });
  });

  writeLocalUsers(nextUsers);
  return nextUsers;
}

export function readAuthenticInstructorCourses(): LocalCourseRecord[] {
  const courses = readLocalCourses();
  const users = ensureInstructorRecordsForCourses(courses);

  return courses.filter((course) => {
    const instructor = users.find((user) => user.id === course.instructorId && user.role === 'instructor');
    return Boolean(instructor && course.title && course.description);
  });
}

export function readLocalInstructors(): LocalUserRecord[] {
  return readLocalUsers().filter((user) => user.role === 'instructor');
}

export function writeLocalInstructors(instructors: LocalUserRecord[]) {
  const users = readLocalUsers();
  const instructorIds = new Set(instructors.map((instructor) => instructor.id));
  const nextUsers = users.filter((user) => user.role !== 'instructor' || instructorIds.has(user.id));

  instructors.forEach((instructor) => {
    const existingIndex = nextUsers.findIndex((user) => user.id === instructor.id);
    if (existingIndex >= 0) {
      nextUsers[existingIndex] = instructor;
      return;
    }

    nextUsers.push(instructor);
  });

  writeLocalUsers(nextUsers);
}

export function readLocalProfiles(): Profile[] {
  return readLocalStorageJSON<Profile[]>(getLocalProfilesKey(), []);
}

export function writeLocalProfiles(profiles: Profile[]) {
  writeLocalStorageJSON(getLocalProfilesKey(), profiles);
}

export function readLocalCourses(): LocalCourseRecord[] {
  const storedCourses = readLocalStorageJSON<LocalCourseRecord[]>(getLocalCoursesKey(), []);
  const normalizedCourses = storedCourses.map(normalizeStoredCourse).filter(Boolean) as LocalCourseRecord[];
  const validCourses = normalizedCourses.filter((course) => isPersistableCourse(course));

  if (validCourses.length !== normalizedCourses.length) {
    writeLocalStorageJSON(getLocalCoursesKey(), validCourses);
  }

  return validCourses;
}

export function writeLocalCourses(courses: LocalCourseRecord[]) {
  const sanitizedCourses = courses
    .map(normalizeStoredCourse)
    .filter(Boolean)
    .filter((course) => isPersistableCourse(course)) as LocalCourseRecord[];

  writeLocalStorageJSON(getLocalCoursesKey(), sanitizedCourses);
  invalidateInstructorCourseCache();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('learnflow-course-changed', {
      detail: { timestamp: Date.now() },
    }));
  }
}

function getLessonMediaUrls(lesson: Partial<CourseLessonRecord> | null | undefined): string[] {
  const urls = [lesson?.videoUrl, lesson?.attachmentUrl].filter((value): value is string => typeof value === 'string');
  return [...new Set(urls.map((url) => sanitizeMediaUrl(url)).filter((url): url is string => Boolean(url)))];
}

export function getCourseMediaUrls(course: Partial<LocalCourseRecord> | null | undefined): string[] {
  if (!course) return [];

  const urls = new Set<string>();

  if (typeof course.thumbnail === 'string') {
    const thumbnailUrl = sanitizeMediaUrl(course.thumbnail);
    if (thumbnailUrl) urls.add(thumbnailUrl);
  }

  for (const module of course.modules ?? []) {
    for (const lesson of module.lessons ?? []) {
      for (const url of getLessonMediaUrls(lesson)) {
        urls.add(url);
      }
    }
  }

  return Array.from(urls);
}

export function isMediaUrlReferencedElsewhere(
  url: string,
  courses: LocalCourseRecord[] = readLocalCourses(),
  exclusion?: { courseId?: string; lessonId?: string; moduleId?: string },
): boolean {
  const normalized = sanitizeMediaUrl(url);
  if (!normalized) return false;

  for (const course of courses) {
    if (exclusion?.courseId && course.id === exclusion.courseId) {
      if (!exclusion.lessonId && !exclusion.moduleId) {
        continue;
      }
    }

    if (course.thumbnail === normalized) {
      const matchesCourseSkip = exclusion?.courseId === course.id && !exclusion.lessonId && !exclusion.moduleId;
      if (!matchesCourseSkip) return true;
    }

    for (const module of course.modules ?? []) {
      if (exclusion?.courseId === course.id && exclusion?.moduleId === module.id) {
        continue;
      }

      for (const lesson of module.lessons ?? []) {
        if (exclusion?.courseId === course.id && exclusion?.lessonId === lesson.id) {
          continue;
        }

        if (lesson.videoUrl === normalized || lesson.attachmentUrl === normalized) {
          return true;
        }
      }
    }
  }

  return false;
}

export function getUnsharedMediaUrls(
  urls: Iterable<string>,
  courses: LocalCourseRecord[] = readLocalCourses(),
  exclusion?: { courseId?: string; lessonId?: string; moduleId?: string },
): string[] {
  const uniqueUrls = new Set<string>();

  for (const rawUrl of urls) {
    const normalized = sanitizeMediaUrl(rawUrl);
    if (!normalized) continue;
    uniqueUrls.add(normalized);
  }

  return Array.from(uniqueUrls).filter((url) => !isMediaUrlReferencedElsewhere(url, courses, exclusion));
}

export async function cleanupUnusedMediaUrls(
  urls: Iterable<string>,
  entity: Partial<Record<string, unknown>> & { id?: string; type?: string } = {},
  courses: LocalCourseRecord[] = readLocalCourses(),
  exclusion?: { courseId?: string; lessonId?: string; moduleId?: string },
): Promise<DeleteCleanupResult> {
  const removableUrls = getUnsharedMediaUrls(urls, courses, exclusion);

  if (!removableUrls.length) {
    return {
      entityId: typeof entity.id === 'string' ? entity.id : null,
      deletedFiles: [],
      purgedCollections: [],
      errors: [],
    };
  }

  const cleanupPayload = {
    ...entity,
    type: entity.type ?? 'resource',
    files: removableUrls.map((url) => ({ url })),
    url: removableUrls[0],
  };

  try {
    return await deleteEntityCleanupApi(cleanupPayload as Record<string, unknown>);
  } catch (error) {
    console.warn('Media cleanup failed for unshared files; preserving database state.', error);
    return {
      entityId: typeof entity.id === 'string' ? entity.id : null,
      deletedFiles: [],
      purgedCollections: [],
      errors: [{ message: error instanceof Error ? error.message : 'Media cleanup failed.' }],
    };
  }
}

export async function deleteCourseRecord(course: LocalCourseRecord) {
  const currentCourses = readLocalCourses();
  const payloadCourse = currentCourses.find((item) => item.id === course.id) ?? course;
  const removableUrls = getUnsharedMediaUrls(getCourseMediaUrls(payloadCourse), currentCourses, { courseId: payloadCourse.id });

  const token = typeof window !== 'undefined' ? window.sessionStorage.getItem('learnflow_session_token') ?? '' : '';
  if (!token) {
    throw new Error('Authentication is required to delete a course.');
  }

  const response = await fetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/courses/${encodeURIComponent(payloadCourse.id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error ?? `Course deletion failed: ${response.status}`);
  }

  invalidateInstructorCourseCache(payloadCourse.instructorId);
  invalidateStudentEnrollmentCache();

  try {
    await cleanupUnusedMediaUrls(removableUrls, {
      id: payloadCourse.id,
      type: 'course',
      title: payloadCourse.title,
    }, currentCourses, { courseId: payloadCourse.id });
  } catch (error) {
    console.warn('Course cleanup endpoint unavailable; continuing with local purge only.', error);
  }

  const nextCourses = currentCourses.filter((item) => item.id !== payloadCourse.id);
  writeLocalCourses(nextCourses);

  const users = readLocalUsers();
  writeLocalUsers(
    users.map((user) => ({
      ...user,
      courseIds: (user.courseIds ?? []).filter((courseId) => courseId !== payloadCourse.id),
    })),
  );

  writeLocalEnrollments(readLocalEnrollments().filter((entry) => entry.courseId !== payloadCourse.id));

  return nextCourses;
}

export function persistInstructorCourse(course: LocalCourseRecord, instructorId: string) {
  const normalizedInstructorId = typeof instructorId === 'string' ? instructorId.trim() : '';
  const normalizedCourse: LocalCourseRecord = {
    ...course,
    instructorId: normalizedInstructorId,
    title: typeof course.title === 'string' && course.title.trim() ? course.title.trim() : 'Untitled course',
    description: typeof course.description === 'string' && course.description.trim() ? course.description.trim() : 'New course created by the instructor workspace.',
    category: typeof course.category === 'string' && course.category.trim() ? course.category.trim() : 'General',
    aiModel: typeof course.aiModel === 'string' && course.aiModel.trim() ? course.aiModel.trim() : 'Coach Pro',
    modules: Array.isArray(course.modules) && course.modules.length > 0
      ? course.modules.map((module) => ({
          ...module,
          title: module.title?.trim() || 'Module',
          lessons: (module.lessons ?? []).map((lesson) => ({
            ...lesson,
            title: lesson.title?.trim() || 'Lesson',
            summary: lesson.summary?.trim() || 'Instructor-created lesson.',
            duration: Number.isFinite(Number(lesson.duration)) ? Number(lesson.duration) : 1,
            type: lesson.type || 'Video',
          })),
        }))
      : [
          {
            id: crypto.randomUUID(),
            title: 'Module 1',
            lessons: [
              {
                id: crypto.randomUUID(),
                title: 'Lesson 1',
                duration: 1,
                summary: 'Instructor-created lesson.',
                type: 'Video',
                videoName: null,
                videoUrl: null,
                attachmentName: null,
                attachmentUrl: null,
              },
            ],
          },
        ],
  };

  if (!isPersistableCourse(normalizedCourse)) {
    throw new Error('Course validation failed: missing instructor or required course data.');
  }

  const users = readLocalUsers();
  const hasInstructor = users.some((user) => user.id === normalizedInstructorId);

  const nextUsers: LocalUserRecord[] = hasInstructor
    ? users.map((user) =>
        user.id === normalizedInstructorId
          ? {
              ...user,
              courseIds: Array.from(new Set([...(user.courseIds ?? []), normalizedCourse.id])),
            }
          : user,
      )
    : [
        ...users,
        {
          id: normalizedInstructorId,
          name: `Instructor ${normalizedInstructorId.slice(0, 6)}`,
          email: `${normalizedInstructorId}@learnflow.local`,
          password: 'instructor123',
          role: 'instructor',
          avatar: null,
          status: 'active',
          profile: defaultProfile(normalizedInstructorId, `Instructor ${normalizedInstructorId.slice(0, 6)}`, 'instructor'),
          permissions: {
            manageCourses: true,
            moderateStudents: true,
            viewAnalytics: true,
          },
          courseIds: [normalizedCourse.id],
        },
      ];

  const existingCourses = readLocalCourses();
  const nextCourses: LocalCourseRecord[] = [
    { ...normalizedCourse, instructorId: normalizedInstructorId },
    ...existingCourses.filter((current) => current.id !== normalizedCourse.id),
  ];

  writeLocalUsers(nextUsers);
  writeLocalCourses(nextCourses);

  return {
    users: nextUsers,
    courses: nextCourses,
  };
}

export function getEnrollmentProgressFromLessonSet(
  course: LocalCourseRecord | null | undefined,
  completedLessonIds: Iterable<string>,
): number {
  if (!course) return 0;

  const allLessons = (course.modules ?? []).flatMap((module) => module.lessons ?? []);
  const totalLessons = allLessons.length;
  if (!totalLessons) return 0;

  const uniqueCompleted = Array.from(new Set([...completedLessonIds]));
  const completedCount = uniqueCompleted.filter((lessonId) => allLessons.some((lesson) => lesson.id === lessonId)).length;
  return Math.min(100, Math.round((completedCount / totalLessons) * 100));
}

export function getLessonMediaReferenceSet(course: LocalCourseRecord | null | undefined): Set<string> {
  const mediaSet = new Set<string>();
  if (!course) return mediaSet;

  for (const module of course.modules ?? []) {
    for (const lesson of module.lessons ?? []) {
      for (const url of getLessonMediaUrls(lesson)) {
        mediaSet.add(url);
      }
    }
  }

  return mediaSet;
}

export async function deleteLessonMediaIfUnused(
  courseId: string,
  lessonId: string,
  lesson: Partial<CourseLessonRecord> | null | undefined,
): Promise<DeleteCleanupResult> {
  const courses = readLocalCourses();
  const targetCourse = courses.find((course) => course.id === courseId);
  if (!targetCourse) {
    return { entityId: lessonId, deletedFiles: [], purgedCollections: [], errors: [] };
  }

  const lessonUrls = getLessonMediaUrls(lesson ?? {});
  if (!lessonUrls.length) {
    return { entityId: lessonId, deletedFiles: [], purgedCollections: [], errors: [] };
  }

  return cleanupUnusedMediaUrls(lessonUrls, { id: lessonId, type: 'lesson' }, courses, {
    courseId,
    lessonId,
  });
}

export async function deleteModuleMediaIfUnused(
  courseId: string,
  moduleId: string,
  module: { lessons?: Array<Partial<CourseLessonRecord>> } | null | undefined,
): Promise<DeleteCleanupResult> {
  const courses = readLocalCourses();
  const targetCourse = courses.find((course) => course.id === courseId);
  if (!targetCourse) {
    return { entityId: moduleId, deletedFiles: [], purgedCollections: [], errors: [] };
  }

  const moduleUrls = (module?.lessons ?? []).flatMap((lesson) => getLessonMediaUrls(lesson));
  if (!moduleUrls.length) {
    return { entityId: moduleId, deletedFiles: [], purgedCollections: [], errors: [] };
  }

  return cleanupUnusedMediaUrls(moduleUrls, { id: moduleId, type: 'module' }, courses, {
    courseId,
    moduleId,
  });
}

export function normalizeEnrollmentProgress(
  enrollment: LocalEnrollmentRecord | null | undefined,
  course: LocalCourseRecord | null | undefined,
): LocalEnrollmentRecord | null {
  if (!enrollment) return null;

  const completedLessonIds = Array.from(new Set((enrollment.completedLessonIds ?? []).filter(Boolean)));
  const progressPercentage = getEnrollmentProgressFromLessonSet(course, completedLessonIds);
  const normalizedProgress = Math.max(0, Math.min(100, Number.isFinite(enrollment.progress) ? Number(enrollment.progress) : progressPercentage));

  return {
    ...enrollment,
    completedLessonIds,
    progress: Math.max(progressPercentage, normalizedProgress),
    progressPercentage: Math.max(progressPercentage, normalizedProgress),
    status: progressPercentage >= 100 ? 'completed' : 'active',
    userId: enrollment.userId || enrollment.studentId,
    studentId: enrollment.studentId || enrollment.userId,
  };
}

export function upsertEnrollmentProgress(
  studentId: string,
  courseId: string,
  completedLessonIds: Iterable<string>,
  course: LocalCourseRecord | null | undefined,
): LocalEnrollmentRecord | null {
  const enrollments = readLocalEnrollments();
  const nextCompleted = Array.from(new Set([...completedLessonIds].filter(Boolean)));
  const progressPercentage = getEnrollmentProgressFromLessonSet(course, nextCompleted);

  const nextEnrollment: LocalEnrollmentRecord = {
    id: `${studentId}:${courseId}`,
    userId: studentId,
    studentId,
    courseId,
    completedLessonIds: nextCompleted,
    progress: progressPercentage,
    progressPercentage,
    status: progressPercentage >= 100 ? 'completed' : 'active',
    enrolledAt: new Date().toISOString(),
  };

  const existingIndex = enrollments.findIndex(
    (entry) => entry.studentId === studentId && entry.courseId === courseId,
  );

  if (existingIndex >= 0) {
    const updated = normalizeEnrollmentProgress({
      ...enrollments[existingIndex],
      ...nextEnrollment,
      completedLessonIds: nextCompleted,
      progress: progressPercentage,
      progressPercentage,
      status: progressPercentage >= 100 ? 'completed' : 'active',
    }, course);
    const nextEnrollments = [...enrollments];
    nextEnrollments[existingIndex] = updated ?? nextEnrollment;
    writeLocalEnrollments(nextEnrollments);
    return updated ?? nextEnrollment;
  }

  const nextEnrollments = [...enrollments, nextEnrollment];
  writeLocalEnrollments(nextEnrollments);
  return nextEnrollment;
}

export function readLocalEnrollments(): LocalEnrollmentRecord[] {
  const enrollments = readLocalStorageJSON<Partial<LocalEnrollmentRecord>[]>(getLocalEnrollmentsKey(), []);
  return enrollments.map((entry) => {
    const progressPercentage = Number.isFinite(entry.progressPercentage)
      ? Number(entry.progressPercentage)
      : Number.isFinite(entry.progress)
        ? Number(entry.progress)
        : 0;
    const progress = Number.isFinite(entry.progress)
      ? Number(entry.progress)
      : progressPercentage;

    return {
      ...entry,
      id: entry.id ?? `${entry.studentId ?? entry.userId ?? 'student'}:${entry.courseId}`,
      userId: entry.userId || entry.studentId || 'unknown-user',
      studentId: entry.studentId || entry.userId || 'unknown-user',
      courseId: entry.courseId ?? '',
      completedLessonIds: Array.from(new Set((entry.completedLessonIds ?? []).filter(Boolean))),
      progress,
      progressPercentage,
      status: entry.status === 'completed' || progress >= 100 ? 'completed' : 'active',
      enrolledAt: entry.enrolledAt ?? new Date().toISOString(),
    } as LocalEnrollmentRecord;
  });
}

export function writeLocalEnrollments(enrollments: LocalEnrollmentRecord[]) {
  const normalizedEnrollments = enrollments.map((entry) => {
    const progressPercentage = Number.isFinite(entry.progressPercentage)
      ? Number(entry.progressPercentage)
      : Number.isFinite(entry.progress)
        ? Number(entry.progress)
        : 0;
    const progress = Number.isFinite(entry.progress)
      ? Number(entry.progress)
      : progressPercentage;

    return {
      ...entry,
      userId: entry.userId || entry.studentId,
      studentId: entry.studentId || entry.userId,
      completedLessonIds: Array.from(new Set((entry.completedLessonIds ?? []).filter(Boolean))),
      progress,
      progressPercentage,
      status: progress >= 100 ? 'completed' : 'active',
    };
  });

  writeLocalStorageJSON(getLocalEnrollmentsKey(), normalizedEnrollments);

  const changedStudentIds = Array.from(new Set(normalizedEnrollments.map((entry) => entry.studentId).filter(Boolean)));
  for (const studentId of changedStudentIds) {
    invalidateStudentEnrollmentCache(studentId);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('learnflow-enrollment-changed', {
      detail: { studentIds: changedStudentIds, timestamp: Date.now() },
    }));
  }
}

export function readLocalAiModels(): LocalAiModelRecord[] {
  return readLocalStorageJSON<LocalAiModelRecord[]>(getLocalAiModelsKey(), []);
}

export function writeLocalAiModels(models: LocalAiModelRecord[]) {
  writeLocalStorageJSON(getLocalAiModelsKey(), models);
}

export function readLocalSettings(): LocalPlatformSettings {
  return readLocalStorageJSON<LocalPlatformSettings | null>(getLocalSettingsKey(), null) ?? defaultSettings;
}

export function writeLocalSettings(settings: LocalPlatformSettings) {
  writeLocalStorageJSON(getLocalSettingsKey(), settings);
}

export function readLocalSession() {
  if (typeof window === 'undefined') return null;

  try {
    const rawSession = window.sessionStorage.getItem(getLocalSessionStoreKey()) ?? window.localStorage.getItem(getLocalSessionStoreKey());
    return rawSession ? JSON.parse(rawSession) : null;
  } catch {
    return null;
  }
}

export function writeLocalSession(session: { userId: string; email: string } | null) {
  if (typeof window === 'undefined') return;

  if (!session) {
    window.sessionStorage.removeItem(getLocalSessionStoreKey());
    window.localStorage.removeItem(getLocalSessionStoreKey());
    return;
  }

  window.sessionStorage.setItem(getLocalSessionStoreKey(), JSON.stringify(session));
}