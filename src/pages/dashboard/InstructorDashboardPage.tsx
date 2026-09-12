import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  GraduationCap,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  createCourseForInstructor,
  fetchInstructorCourses,
  resolveHostedLessonMediaPath,
} from '@/lib/courseRepository';
import { fetchExternalVideoDuration, uploadMediaFile } from '@/services/api';
import {
  deleteCourseRecord,
  deleteLessonMediaIfUnused,
  deleteModuleMediaIfUnused,
  readLocalCourses,
  readLocalUsers,
  writeLocalCourses,
  writeLocalUsers,
  type LocalCourseRecord,
} from '@/lib/localDb';

type CourseCategory = string;
type CourseStatus = 'Draft' | 'Published' | 'Review';

const courseCategorySuggestions = [
  'Design',
  'Development',
  'Data',
  'AI & Automation',
  'Marketing',
  'Business',
  'Productivity',
  'Leadership',
];

type LessonDraft = {
  id: string;
  title: string;
  duration: number;
  summary: string;
  type: 'Video' | 'Reading' | 'Exercise';
  videoName?: string | null;
  videoUrl?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
};

type ModuleDraft = {
  id: string;
  title: string;
  lessons: LessonDraft[];
};

type CourseDraft = {
  id: string;
  title: string;
  description: string;
  category: CourseCategory;
  aiModel: string;
  status: CourseStatus;
  modules: ModuleDraft[];
};

type CourseRow = CourseDraft & {
  students: number;
  completion: number;
  revenue: string;
};

const aiModelOptions = [
  'Coach Pro',
  'Code Mentor',
  'Project Planner',
  'Research Copilot',
];

const getDurationParts = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, Number.isFinite(totalSeconds) ? Math.round(totalSeconds) : 0);
  return {
    hours: Math.floor(safeSeconds / 3600),
    minutes: Math.floor((safeSeconds % 3600) / 60),
    seconds: safeSeconds % 60,
  };
};

const formatLessonDuration = (durationSeconds: number) => {
  const { hours, minutes, seconds } = getDurationParts(durationSeconds);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

const getVideoEmbedUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const youtubeMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
  if (youtubeMatch?.[1]) {
    return `https://www.youtube.com/embed/${youtubeMatch[1]}`;
  }

  const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/i);
  if (vimeoMatch?.[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return trimmed;
};

const isEmbeddableVideo = (value: string | null) => {
  if (!value) return false;

  const normalized = value.trim();
  if (!normalized) return false;

  return /(youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm|ogg)(\?|$))/i.test(normalized);
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const sanitizeMediaUrl = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('blob:')) return null;

  if (
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  return null;
};

const readVideoDurationFromFile = (file: File) => new Promise<number>((resolve) => {
  if (!file.type.toLowerCase().startsWith('video/')) {
    resolve(0);
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = objectUrl;

  video.onloadedmetadata = () => {
    const duration = Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : 0;
    URL.revokeObjectURL(objectUrl);
    resolve(duration);
  };

  video.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(0);
  };
});

const buildHostedMediaAssetPath = (file: File, kind: 'video' | 'attachment') =>
  resolveHostedLessonMediaPath(file.name, kind);

const getUploadKindFromFile = (file: File, fallbackKind: 'video' | 'attachment') => {
  const mimeType = file.type?.toLowerCase() ?? '';
  if (mimeType.startsWith('video/') || fallbackKind === 'video') {
    return 'video';
  }

  return 'attachment';
};

const uploadLessonMediaFile = async (
  file: File,
  kind: 'video' | 'attachment',
  options?: {
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> => {
  const normalizedKind = getUploadKindFromFile(file, kind);
  return uploadMediaFile(file, normalizedKind, options);
};

const validateLessonDraft = (lesson: LessonDraft) => {
  if (!lesson.title.trim()) {
    return 'Each lesson must include a title.';
  }

  if (!Number(lesson.duration) || Number(lesson.duration) <= 0) {
    return 'Each lesson must include a valid video duration.';
  }

  const videoUrl = sanitizeMediaUrl(lesson.videoUrl);
  const attachmentUrl = sanitizeMediaUrl(lesson.attachmentUrl);

  if (!videoUrl && !attachmentUrl) {
    return 'Each lesson needs either a valid video URL, uploaded video, or document attachment like a PDF.';
  }

  return '';
};

const initialCourses: CourseRow[] = [];

const emptyDraft = (): CourseDraft => ({
  id: crypto.randomUUID(),
  title: '',
  description: '',
  category: 'Design',
  aiModel: aiModelOptions[0],
  status: 'Draft',
  modules: [
    {
      id: crypto.randomUUID(),
      title: 'Module 1',
      lessons: [{
        id: crypto.randomUUID(),
        title: 'Welcome lesson',
        duration: 12 * 60,
        summary: 'Introduce the course and make the first learning milestone clear.',
        type: 'Video',
        videoName: null,
        videoUrl: null,
        attachmentName: null,
        attachmentUrl: null,
      }],
    },
  ],
});

const buildDraftFromCourse = (course: Partial<CourseDraft> & { id: string; title: string; description: string; category: string; aiModel?: string; status?: CourseStatus; modules?: ModuleDraft[]; }): CourseDraft => ({
  id: course.id,
  title: course.title ?? '',
  description: course.description ?? '',
  category: course.category ?? 'Design',
  aiModel: course.aiModel ?? aiModelOptions[0],
  status: course.status ?? 'Draft',
  modules: (course.modules ?? []).map((module) => ({
    ...module,
    lessons: (module.lessons ?? []).map((lesson) => ({
      ...lesson,
      duration: Number(lesson.duration) || 0,
      summary: lesson.summary ?? '',
      type: lesson.type ?? 'Video',
      videoName: lesson.videoName ?? null,
      videoUrl: lesson.videoUrl ?? null,
      attachmentName: lesson.attachmentName ?? null,
      attachmentUrl: lesson.attachmentUrl ?? null,
    })),
  })),
});

export function InstructorDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const [courses, setCourses] = useState<CourseRow[]>(initialCourses);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(1);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CourseDraft>(emptyDraft());
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const [uploadStatusByKey, setUploadStatusByKey] = useState<
    Record<string, { progress: number; isUploading: boolean; error: string | null; loadedBytes: number; totalBytes: number; abortController?: AbortController }>
  >({});

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editCourseId = params.get('editCourse');
    if (!editCourseId) return;

    const targetCourse = courses.find((course) => course.id === editCourseId);
    if (targetCourse) {
      openBuilderForCourse(targetCourse);
      navigate('/instructor', { replace: true });
    }
  }, [courses, location.search, navigate]);

  useEffect(() => {
    if (!session?.userId) {
      setCourses([]);
      return;
    }

    let isMounted = true;

    const loadCourses = async () => {
      const savedCourses = await fetchInstructorCourses(session.userId);
      if (!isMounted) return;

      setCourses(
        savedCourses.map((course) => ({
          id: course.id,
          title: course.title,
          description: course.description,
          category: course.category,
          aiModel: course.aiModel ?? 'Coach Pro',
          status: course.isPublished ? 'Published' : 'Draft',
          students: 0,
          completion: 0,
          revenue: '$0',
          modules: course.modules ?? [],
        })),
      );
    };

    void loadCourses();

    return () => {
      isMounted = false;
    };
  }, [session?.userId]);

  const stats = useMemo(() => {
    const totalStudents = courses.reduce((sum, course) => sum + course.students, 0);
    const avgCompletion = courses.length
      ? Math.round(courses.reduce((sum, course) => sum + course.completion, 0) / courses.length)
      : 0;
    const published = courses.filter((course) => course.status === 'Published').length;
    const review = courses.filter((course) => course.status === 'Review').length;

    return {
      totalStudents,
      avgCompletion,
      published,
      review,
    };
  }, [courses]);

  const updateDraft = <K extends keyof CourseDraft>(key: K, value: CourseDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateLessonDuration = (
    moduleIndex: number,
    lessonIndex: number,
    unit: 'hours' | 'minutes' | 'seconds',
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, currentModuleIndex) =>
        currentModuleIndex === moduleIndex
          ? {
              ...module,
              lessons: module.lessons.map((lesson, currentLessonIndex) => {
                if (currentLessonIndex !== lessonIndex) {
                  return lesson;
                }

                const currentParts = getDurationParts(lesson.duration);
                const nextValue = Number(value) || 0;
                const sanitizedValue = unit === 'hours' ? Math.max(0, nextValue) : Math.min(59, Math.max(0, nextValue));

                const nextParts = {
                  hours: currentParts.hours,
                  minutes: currentParts.minutes,
                  seconds: currentParts.seconds,
                };

                nextParts[unit] = sanitizedValue;

                return {
                  ...lesson,
                  duration: nextParts.hours * 3600 + nextParts.minutes * 60 + nextParts.seconds,
                };
              }),
            }
          : module,
      ),
    }));
  };

  const addModule = () => {
    resetUploadStatusState();
    setDraft((current) => ({
      ...current,
      modules: [
        ...current.modules,
        {
          id: crypto.randomUUID(),
          title: `Module ${current.modules.length + 1}`,
          lessons: [
            {
              id: crypto.randomUUID(),
              title: 'New lesson',
              duration: 10 * 60,
              summary: 'Introduce the new topic to learners.',
              type: 'Video',
              videoName: null,
              videoUrl: null,
              attachmentName: null,
              attachmentUrl: null,
            },
          ],
        },
      ],
    }));
  };

  const addLesson = (moduleIndex: number) => {
    resetUploadStatusState();
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) =>
        index === moduleIndex
          ? {
              ...module,
              lessons: [
                ...module.lessons,
                {
                  id: crypto.randomUUID(),
                  title: `Lesson ${module.lessons.length + 1}`,
                  duration: 12 * 60,
                  summary: 'Explain the concept clearly and provide a practical recap.',
                  type: 'Video',
                  videoName: null,
                  videoUrl: null,
                  attachmentName: null,
                  attachmentUrl: null,
                },
              ],
            }
          : module,
      ),
    }));
  };

  const removeLesson = async (moduleIndex: number, lessonId: string) => {
    const courseDraft = draft;
    const module = courseDraft.modules[moduleIndex];
    const targetLesson = module?.lessons.find((lesson) => lesson.id === lessonId);

    if (courseDraft.id && targetLesson) {
      try {
        await deleteLessonMediaIfUnused(courseDraft.id, lessonId, targetLesson);
      } catch (error) {
        console.warn('Lesson media cleanup failed while removing a lesson draft.', error);
      }
    }

    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) =>
        index === moduleIndex
          ? {
              ...module,
              lessons: module.lessons.filter((lesson) => lesson.id !== lessonId),
            }
          : module,
      ),
    }));
  };

  const uploadStateKey = (moduleIndex: number, lessonIndex: number, kind: 'video' | 'attachment') =>
    `${moduleIndex}:${lessonIndex}:${kind}`;

  const resetUploadStatusState = () => {
    setUploadStatusByKey({});
  };

  const setUploadState = (
    key: string,
    values: Partial<{ progress: number; isUploading: boolean; error: string | null; loadedBytes: number; totalBytes: number; abortController: AbortController | undefined }>,
  ) => {
    setUploadStatusByKey((current) => ({
      ...current,
      [key]: {
        progress: current[key]?.progress ?? 0,
        isUploading: current[key]?.isUploading ?? false,
        error: current[key]?.error ?? null,
        loadedBytes: current[key]?.loadedBytes ?? 0,
        totalBytes: current[key]?.totalBytes ?? 0,
        abortController: current[key]?.abortController,
        ...values,
      },
    }));
  };

  const cancelUpload = (key: string) => {
    setUploadStatusByKey((current) => {
      const upload = current[key];
      if (upload?.abortController) {
        upload.abortController.abort();
      }

      return {
        ...current,
        [key]: {
          ...upload,
          progress: 0,
          isUploading: false,
          error: 'Upload cancelled.',
          loadedBytes: upload?.loadedBytes ?? 0,
          totalBytes: upload?.totalBytes ?? 0,
          abortController: undefined,
        },
      };
    });
  };

  const handleLessonVideoUpload = async (
    moduleIndex: number,
    lessonIndex: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const key = uploadStateKey(moduleIndex, lessonIndex, 'video');
    const controller = new AbortController();
    const detectedDuration = await readVideoDurationFromFile(file);
    setUploadState(key, { progress: 0, isUploading: true, error: null, loadedBytes: 0, totalBytes: file.size, abortController: controller });

    try {
      const hostedVideoPath = await uploadLessonMediaFile(file, 'video', {
        signal: controller.signal,
        onProgress: (progress) => setUploadState(key, {
          progress,
          isUploading: true,
          error: null,
          loadedBytes: Math.round((progress / 100) * file.size),
          totalBytes: file.size,
        }),
      });
      if (!hostedVideoPath.startsWith('/uploads/')) {
        throw new Error('Upload did not return a valid hosted video path.');
      }

      setUploadState(key, { progress: 100, isUploading: false, error: null, loadedBytes: file.size, totalBytes: file.size, abortController: undefined });

      const resolvedDuration = await new Promise<number>((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = hostedVideoPath;
        video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : detectedDuration || 0);
        video.onerror = () => resolve(detectedDuration || 0);
      });

      setDraft((current) => ({
        ...current,
        modules: current.modules.map((module, currentModuleIndex) =>
          currentModuleIndex === moduleIndex
            ? {
                ...module,
                lessons: module.lessons.map((lesson, currentLessonIndex) =>
                  currentLessonIndex === lessonIndex
                    ? {
                        ...lesson,
                        duration: resolvedDuration > 0 ? resolvedDuration : lesson.duration,
                        summary: lesson.summary || 'Video lesson with instructor walkthrough.',
                        type: 'Video',
                        videoName: file.name,
                        videoUrl: hostedVideoPath,
                      }
                    : lesson,
                ),
              }
            : module,
        ),
      }));
    } catch (uploadError) {
      const message = uploadError instanceof DOMException && uploadError.name === 'AbortError'
        ? 'Upload cancelled.'
        : uploadError instanceof Error
          ? uploadError.message
          : 'The uploaded video could not be stored. Please try another file or use an external link.';

      console.error('Failed to process uploaded lesson video:', uploadError);
      setUploadState(key, { progress: 0, isUploading: false, error: message, loadedBytes: 0, totalBytes: file.size, abortController: undefined });
      setBuilderError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleLessonAttachmentUpload = async (
    moduleIndex: number,
    lessonIndex: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const key = uploadStateKey(moduleIndex, lessonIndex, 'attachment');
    const controller = new AbortController();
    setUploadState(key, { progress: 0, isUploading: true, error: null, loadedBytes: 0, totalBytes: file.size, abortController: controller });

    try {
      const hostedAttachmentPath = await uploadLessonMediaFile(file, 'attachment', {
        signal: controller.signal,
        onProgress: (progress) => setUploadState(key, {
          progress,
          isUploading: true,
          error: null,
          loadedBytes: Math.round((progress / 100) * file.size),
          totalBytes: file.size,
        }),
      });
      if (!hostedAttachmentPath.startsWith('/uploads/')) {
        throw new Error('Upload did not return a valid hosted attachment path.');
      }

      setUploadState(key, { progress: 100, isUploading: false, error: null, loadedBytes: file.size, totalBytes: file.size, abortController: undefined });

      setDraft((current) => ({
        ...current,
        modules: current.modules.map((module, currentModuleIndex) =>
          currentModuleIndex === moduleIndex
            ? {
                ...module,
                lessons: module.lessons.map((lesson, currentLessonIndex) =>
                  currentLessonIndex === lessonIndex
                    ? {
                        ...lesson,
                        attachmentName: file.name,
                        attachmentUrl: hostedAttachmentPath,
                      }
                    : lesson,
                ),
              }
            : module,
        ),
      }));
    } catch (uploadError) {
      const message = uploadError instanceof DOMException && uploadError.name === 'AbortError'
        ? 'Upload cancelled.'
        : uploadError instanceof Error
          ? uploadError.message
          : 'The uploaded file could not be stored. Please try another file or use an external link.';

      console.error('Failed to process uploaded attachment:', uploadError);
      setUploadState(key, { progress: 0, isUploading: false, error: message, loadedBytes: 0, totalBytes: file.size, abortController: undefined });
      setBuilderError(message);
    } finally {
      event.target.value = '';
    }
  };

  const validateDraftContent = () => {
    for (const module of draft.modules) {
      for (const lesson of module.lessons) {
        const error = validateLessonDraft(lesson);
        if (error) {
          return error;
        }
      }
    }

    return '';
  };

  const openBuilderForCourse = (courseOverride?: CourseRow) => {
    resetUploadStatusState();
    setBuilderError(null);
    setBuilderStep(1);
    setDraft(
      courseOverride
        ? buildDraftFromCourse(courseOverride)
        : emptyDraft(),
    );
    setIsBuilderOpen(true);
  };

  const saveCourse = async () => {
    if (!session?.userId) {
      setBuilderError('You must be signed in as an instructor to save a course.');
      return;
    }

    const validationError = validateDraftContent();
    if (validationError) {
      setBuilderError(validationError);
      return;
    }

    try {
      setBuilderError(null);
      setIsSavingCourse(true);

      const nextCourseId = draft.id || crypto.randomUUID();
      const nextCourseRecord: LocalCourseRecord = {
        id: nextCourseId,
        title: draft.title.trim() || 'Untitled course',
        description: draft.description.trim() || 'New course created by the instructor workspace.',
        instructorId: session.userId,
        price: 0,
        category: draft.category,
        status: draft.status.toLowerCase() as 'draft' | 'published' | 'review',
        thumbnail: null,
        aiModel: draft.aiModel,
        difficulty: 'Beginner',
        isPublished: draft.status === 'Published',
        createdAt: new Date().toISOString(),
        modules: draft.modules.map((module) => ({
          id: module.id,
          title: module.title || `Module ${module.id.slice(0, 4)}`,
          lessons: module.lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title || 'New lesson',
            duration: Number(lesson.duration) || 1,
            summary: lesson.summary || 'Instructor-created lesson.',
            type: lesson.type || 'Video',
            videoName: lesson.videoName,
            videoUrl: lesson.videoUrl,
            attachmentName: lesson.attachmentName,
            attachmentUrl: lesson.attachmentUrl,
          })),
        })),
      };

      await createCourseForInstructor(nextCourseRecord, session.userId);

      const savedCourses = await fetchInstructorCourses(session.userId);
      setCourses(
        savedCourses.map((course) => ({
          id: course.id,
          title: course.title,
          description: course.description,
          category: course.category,
          aiModel: course.aiModel ?? 'Coach Pro',
          status: course.isPublished ? 'Published' : 'Draft',
          students: 0,
          completion: 0,
          revenue: '$0',
          modules: course.modules ?? [],
        })),
      );

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('learnflow-course-changed', {
          detail: { instructorId: session.userId, timestamp: Date.now() },
        }));
      }
      resetUploadStatusState();
      setIsBuilderOpen(false);
      setBuilderStep(1);
      setDraft(emptyDraft());
    } catch (error) {
      console.error('Failed to save course:', error);
      const message = error instanceof Error ? error.message : 'Course could not be saved. Please try again.';
      setBuilderError(message);
    } finally {
      setIsSavingCourse(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!draft.id || !session?.userId) return;

    const confirmed = window.confirm(`Delete "${draft.title || 'this course'}"? This removes the course and all related modules, lessons, and uploaded content.`);
    if (!confirmed) return;

    const courseToDelete: LocalCourseRecord = {
      ...readLocalCourses().find((course) => course.id === draft.id),
      id: draft.id,
      title: draft.title.trim() || 'Untitled course',
      description: draft.description.trim() || 'Course deleted from instructor workspace.',
      instructorId: session.userId,
      price: 0,
      category: draft.category,
      status: draft.status.toLowerCase() as 'draft' | 'published' | 'review',
      thumbnail: null,
      aiModel: draft.aiModel,
      difficulty: 'Beginner',
      isPublished: draft.status === 'Published',
      createdAt: new Date().toISOString(),
      modules: draft.modules.map((module) => ({
        id: module.id,
        title: module.title,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          duration: Number(lesson.duration) || 0,
          summary: lesson.summary,
          type: lesson.type,
          videoName: lesson.videoName ?? null,
          videoUrl: lesson.videoUrl ?? null,
          attachmentName: lesson.attachmentName ?? null,
          attachmentUrl: lesson.attachmentUrl ?? null,
        })),
      })),
    };

    await deleteCourseRecord(courseToDelete);

    setCourses((current) => current.filter((course) => course.id !== draft.id));
    setBuilderError(null);
    setIsBuilderOpen(false);
    setBuilderStep(1);
    setDraft(emptyDraft());
    navigate('/instructor', { replace: true });
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
            Instructor workspace
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Instructor Dashboard
          </h1>
        </div>

        <button
          type="button"
          onClick={() => openBuilderForCourse()}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" />
          New course
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Courses</p>
            <BookOpen className="h-5 w-5 text-primary-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{courses.length}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">total active course tracks</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Students</p>
            <Users className="h-5 w-5 text-violet-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{stats.totalStudents}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">enrolled learners</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Completion</p>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{stats.avgCompletion}%</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">average course progress</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">AI model</p>
            <BrainCircuit className="h-5 w-5 text-cyan-600" />
          </div>
          <p className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">{stats.published}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">published with tutor support</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.8fr,1fr]">
        <div className="card overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Course management</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-gray-50 text-xs uppercase tracking-[0.12em] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-3">Course</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Students</th>
                  <th className="px-5 py-3">Completion</th>
                  <th className="px-5 py-3">Revenue</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{course.title}</p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{course.aiModel}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{course.category}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          course.status === 'Published'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                            : course.status === 'Review'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {course.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{course.students}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-500"
                            style={{ width: `${course.completion}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          {course.completion}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-white">{course.revenue}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openBuilderForCourse(course)}
                          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:border-primary-200 hover:text-primary-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-primary-800 dark:hover:text-primary-300"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/courses/${course.id}?preview=1`)}
                          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                Course health
              </p>
              <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Performance overview</h2>
            </div>
            <GraduationCap className="h-5 w-5 text-primary-500" />
          </div>

          {courses.length === 0 || stats.totalStudents === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
              <p className="font-medium text-gray-700 dark:text-gray-200">No performance data yet</p>
              <p className="mt-2">
                Publish courses and enroll learners to generate analytics for this dashboard.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-primary-50 p-4 dark:bg-primary-950/20">
                <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                  <span>Active learners</span>
                  <span className="font-semibold text-primary-700 dark:text-primary-300">{stats.totalStudents}</span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white dark:bg-gray-900">
                  <div
                    className="h-full rounded-full bg-primary-600"
                    style={{ width: `${Math.min(stats.totalStudents * 10, 100)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                    <span>Average course completion</span>
                    <span className="font-medium text-gray-900 dark:text-white">{stats.avgCompletion}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(stats.avgCompletion, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Review queue</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    {stats.review} items
                  </span>
                </div>
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  Review-ready courses will appear here once you activate and publish them.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {isBuilderOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/60 p-4 backdrop-blur-sm">
          <div className="mx-auto my-4 w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                  Course builder
                </p>
                <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                  {draft.id ? 'Edit course' : 'Create a new course'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  resetUploadStatusState();
                  setBuilderError(null);
                  setIsBuilderOpen(false);
                }}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="Close builder"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-3">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        builderStep === step
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      {step}
                    </div>
                    <span
                      className={builderStep === step ? 'font-medium text-gray-900 dark:text-white' : ''}
                    >
                      {step === 1 ? 'Basics' : step === 2 ? 'Modules' : 'Publish'}
                    </span>
                    {step < 3 && <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5">
              {builderStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="label-text">Course title</label>
                    <input
                      value={draft.title}
                      onChange={(event) => updateDraft('title', event.target.value)}
                      className="input-field"
                      placeholder="e.g. Prompt Engineering Masterclass"
                    />
                  </div>

                  <div>
                    <label className="label-text">Description</label>
                    <textarea
                      value={draft.description}
                      onChange={(event) => updateDraft('description', event.target.value)}
                      rows={5}
                      className="input-field resize-none"
                      placeholder="Describe what learners will master in this course..."
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="label-text">Category</label>
                      <input
                        value={draft.category}
                        list="course-category-suggestions"
                        onChange={(event) => updateDraft('category', event.target.value)}
                        className="input-field"
                        placeholder="Type or choose a category"
                      />
                      <datalist id="course-category-suggestions">
                        {courseCategorySuggestions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="label-text">AI model assignment</label>
                      <select
                        value={draft.aiModel}
                        onChange={(event) => updateDraft('aiModel', event.target.value)}
                        className="input-field"
                      >
                        {aiModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {builderStep === 2 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Modules and lessons</h3>
                    <button type="button" onClick={addModule} className="btn-secondary">
                      <Plus className="h-4 w-4" />
                      Add module
                    </button>
                  </div>

                  {draft.modules.map((module, moduleIndex) => (
                    <div key={module.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                      <div className="flex items-center justify-between gap-3">
                        <input
                          value={module.title}
                          onChange={(event) => {
                            setDraft((current) => ({
                              ...current,
                              modules: current.modules.map((item, index) =>
                                index === moduleIndex ? { ...item, title: event.target.value } : item,
                              ),
                            }));
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const moduleToRemove = draft.modules[moduleIndex];
                            if (draft.id && moduleToRemove) {
                              try {
                                await deleteModuleMediaIfUnused(draft.id, moduleToRemove.id, moduleToRemove);
                              } catch (error) {
                                console.warn('Module media cleanup failed while removing a module draft.', error);
                              }
                            }

                            setDraft((current) => ({
                              ...current,
                              modules: current.modules.filter((_, index) => index !== moduleIndex),
                            }));
                          }}
                          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800 dark:hover:text-red-400"
                          aria-label="Remove module"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        {module.lessons.map((lesson, lessonIndex) => {
                          const durationParts = getDurationParts(lesson.duration);

                          return (
                            <div key={lesson.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950/40">
                              <div className="flex items-center gap-3">
                                <FileText className="h-4 w-4 text-gray-400" />
                                <input
                                  value={lesson.title}
                                  onChange={(event) => {
                                    setDraft((current) => ({
                                      ...current,
                                      modules: current.modules.map((item, modulePosition) =>
                                        modulePosition === moduleIndex
                                          ? {
                                              ...item,
                                              lessons: item.lessons.map((entry, lessonPosition) =>
                                                lessonPosition === lessonIndex
                                                  ? { ...entry, title: event.target.value }
                                                  : entry,
                                              ),
                                            }
                                          : item,
                                      ),
                                    }));
                                  }}
                                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                                />
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
                                  {formatLessonDuration(lesson.duration)}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeLesson(moduleIndex, lesson.id)}
                                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800 dark:hover:text-red-400"
                                  aria-label="Delete lesson"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>

                              <div className="grid gap-2 md:grid-cols-3">
                                {(['hours', 'minutes', 'seconds'] as const).map((unit) => (
                                  <label key={unit} className="block text-xs text-gray-500 dark:text-gray-400">
                                    <span className="mb-1 block uppercase tracking-[0.12em]">{unit}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={unit === 'hours' ? 99 : 59}
                                      value={durationParts[unit]}
                                      onChange={(event) => updateLessonDuration(moduleIndex, lessonIndex, unit, event.target.value)}
                                      className="input-field"
                                    />
                                  </label>
                                ))}
                              </div>

                              <div className="space-y-2">
                                {lesson.videoUrl ? (
                                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-black dark:border-gray-700">
                                    {isEmbeddableVideo(lesson.videoUrl) && getVideoEmbedUrl(lesson.videoUrl)?.startsWith('http') ? (
                                      <iframe
                                        src={getVideoEmbedUrl(lesson.videoUrl)!}
                                        title={lesson.title}
                                        className="h-28 w-full"
                                        allowFullScreen
                                      />
                                    ) : (
                                      <video
                                        controls
                                        src={lesson.videoUrl}
                                        className="h-28 w-full bg-black object-cover"
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    No video uploaded yet
                                  </div>
                                )}

                                <div className="grid gap-3 md:grid-cols-2">
<label className="block md:col-span-2">
                                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">External video URL</span>
                                  <input
                                    type="url"
                                    value={lesson.videoUrl ?? ''}
                                    onChange={(event) => {
                                      const nextValue = event.target.value.trim();
                                      setDraft((current) => ({
                                        ...current,
                                        modules: current.modules.map((module, currentModuleIndex) =>
                                          currentModuleIndex === moduleIndex
                                            ? {
                                                ...module,
                                                lessons: module.lessons.map((item, currentLessonIndex) =>
                                                  currentLessonIndex === lessonIndex
                                                    ? {
                                                        ...item,
                                                        videoUrl: sanitizeMediaUrl(nextValue) ?? nextValue,
                                                        videoName: nextValue ? `${item.title} (external video)` : item.videoName,
                                                      }
                                                    : item,
                                                ),
                                              }
                                            : module,
                                        ),
                                      }));

                                      if (!nextValue) return;

                                      void fetchExternalVideoDuration(nextValue).then((duration) => {
                                        if (duration <= 0) return;

                                        setDraft((current) => ({
                                          ...current,
                                          modules: current.modules.map((module, currentModuleIndex) =>
                                            currentModuleIndex === moduleIndex
                                              ? {
                                                  ...module,
                                                  lessons: module.lessons.map((item, currentLessonIndex) =>
                                                    currentLessonIndex === lessonIndex
                                                      ? { ...item, duration }
                                                      : item,
                                                  ),
                                                }
                                              : module,
                                          ),
                                        }));
                                      }).catch(() => {
                                        // Fallback to the stored lesson duration when metadata cannot be resolved.
                                      });
                                    }}
                                    placeholder="https://youtube.com/watch?v=... or https://example.com/video.mp4"
                                    className="input-field"
                                  />
                                </label>

                                <label className="block">
                                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">Video file</span>
                                  <input
                                    type="file"
                                    accept="video/*"
                                    onClick={(event) => {
                                      const target = event.currentTarget as HTMLInputElement;
                                      target.value = '';
                                    }}
                                    onChange={(event) => handleLessonVideoUpload(moduleIndex, lessonIndex, event)}
                                    className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-full file:border-0 file:bg-primary-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-primary-700 dark:text-gray-300"
                                  />
                                </label>

                                <label className="block">
                                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">Attachment</span>
                                  <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg"
                                    onClick={(event) => {
                                      const target = event.currentTarget as HTMLInputElement;
                                      target.value = '';
                                    }}
                                    onChange={(event) => handleLessonAttachmentUpload(moduleIndex, lessonIndex, event)}
                                    className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-full file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-violet-700 dark:text-gray-300"
                                  />
                                </label>
                              </div>

                              {(['video', 'attachment'] as const).map((kind) => {
                                const uploadKey = uploadStateKey(moduleIndex, lessonIndex, kind);
                                const uploadState = uploadStatusByKey[uploadKey];
                                if (!uploadState) return null;

                                return (
                                  <div key={uploadKey} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-950">
                                    <div className="flex items-center justify-between text-[10px] font-medium text-gray-600 dark:text-gray-300">
                                      <div className="flex items-center gap-2">
                                        {uploadState.isUploading ? (
                                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                                        ) : uploadState.error ? (
                                          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                                        ) : (
                                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                        )}
                                        <span>{uploadState.error ? 'Upload failed' : uploadState.isUploading ? `${kind === 'video' ? 'Video' : 'Document'} upload` : 'Upload complete'}</span>
                                      </div>
                                      <span>{uploadState.error ? 'Failed' : `${uploadState.progress}%`}</span>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                                      <span>{formatFileSize(uploadState.loadedBytes)} / {formatFileSize(uploadState.totalBytes)}</span>
                                      {!uploadState.error && !uploadState.isUploading && <span>Ready</span>}
                                    </div>

                                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 shadow-sm dark:bg-gray-800">
                                      <div
                                        className={`h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 shadow-sm transition-all duration-300 ${uploadState.error ? 'bg-gradient-to-r from-red-500 to-red-600' : ''}`}
                                        style={{ width: `${Math.min(Math.max(uploadState.progress, 0), 100)}%` }}
                                      />
                                    </div>

                                    {uploadState.isUploading && (
                                      <button
                                        type="button"
                                        onClick={() => cancelUpload(uploadKey)}
                                        className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-medium text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                                      >
                                        Cancel upload
                                      </button>
                                    )}

                                    {uploadState.error && (
                                      <p className="text-[10px] text-red-600 dark:text-red-300">{uploadState.error}</p>
                                    )}
                                  </div>
                                );
                              })}

                              <label className="block">
                                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">External attachment URL</span>
                                <input
                                  type="url"
                                  value={lesson.attachmentUrl ?? ''}
                                  onChange={(event) => {
                                    const nextValue = event.target.value.trim();
                                    setDraft((current) => ({
                                      ...current,
                                      modules: current.modules.map((module, currentModuleIndex) =>
                                        currentModuleIndex === moduleIndex
                                          ? {
                                              ...module,
                                              lessons: module.lessons.map((item, currentLessonIndex) =>
                                                currentLessonIndex === lessonIndex
                                                  ? {
                                                      ...item,
                                                      attachmentUrl: sanitizeMediaUrl(nextValue) ?? nextValue,
                                                      attachmentName: nextValue ? `${item.title} attachment` : item.attachmentName,
                                                    }
                                                  : item,
                                              ),
                                            }
                                          : module,
                                      ),
                                    }));
                                  }}
                                  placeholder="https://example.com/lesson-notes.pdf"
                                  className="input-field"
                                />
                              </label>

                                {(lesson.videoName || lesson.attachmentName) && (
                                  <div className="space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                                    {lesson.videoName && <p>Video: {lesson.videoName}</p>}
                                    {lesson.attachmentName && (
                                      <p>
                                        Attachment: {' '}
                                        <a
                                          href={lesson.attachmentUrl ?? '#'}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="font-medium text-primary-600 underline dark:text-primary-300"
                                        >
                                          {lesson.attachmentName}
                                        </a>
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex justify-end">
                        <button type="button" onClick={() => addLesson(moduleIndex)} className="btn-secondary">
                          <Plus className="h-4 w-4" />
                          Add lesson
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {builderStep === 3 && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-950/20">
                    <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-sm font-semibold">Ready to publish</span>
                    </div>
                    <h3 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">{draft.title || 'Untitled course'}</h3>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                      {draft.description || 'Add a compelling description to help students understand the value of the course.'}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Category</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{draft.category}</p>
                    </div>
                    <div className="card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">AI model</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{draft.aiModel}</p>
                    </div>
                    <div className="card p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Modules</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{draft.modules.length}</p>
                    </div>
                  </div>
                </div>
              )}

              {builderError && (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  {builderError}
                </div>
              )}

              <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-5 dark:border-gray-800">
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                  {draft.id && (
                    <button
                      type="button"
                      onClick={handleDeleteCourse}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Course
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  {builderStep > 1 && (
                    <button type="button" onClick={() => setBuilderStep((step) => step - 1)} className="btn-secondary">
                      Back
                    </button>
                  )}

                  {builderStep < 3 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (builderStep === 2) {
                          const validationError = validateDraftContent();
                          if (validationError) {
                            setBuilderError(validationError);
                            return;
                          }
                        }

                        setBuilderError(null);
                        setBuilderStep((step) => step + 1);
                      }}
                      className="btn-primary"
                    >
                      Continue
                    </button>
                  ) : (
                    <button type="button" onClick={saveCourse} className="btn-primary" disabled={isSavingCourse}>
                      {isSavingCourse ? 'Saving…' : 'Save course'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
