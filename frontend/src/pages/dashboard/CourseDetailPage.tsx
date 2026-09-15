import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  PencilLine,
  PlayCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { VideoPlayer } from '@/components/dashboard/VideoPlayer';
import {
  deleteCourseRecord,
  deleteLessonMediaIfUnused,
  deleteModuleMediaIfUnused,
  normalizeEnrollmentProgress,
  readLocalCourses,
  readLocalEnrollments,
  readLocalUsers,
  upsertEnrollmentProgress,
  writeLocalCourses,
  writeLocalEnrollments,
  writeLocalUsers,
  type CourseLessonRecord,
  type CourseModuleRecord,
  type LocalCourseRecord,
  type LocalEnrollmentRecord,
} from '@/lib/localDb';
import { uploadMediaFile, fetchExternalVideoDuration } from '@/services/api';
import { fetchCourseById } from '@/lib/courseRepository';

type CourseLesson = CourseLessonRecord;
type CourseModule = CourseModuleRecord;

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

const getMediaValue = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const sanitized = sanitizeMediaUrl(value);
    if (sanitized) return sanitized;
  }

  return null;
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

const normalizeLessonMedia = (lesson: Partial<CourseLesson>): CourseLesson => {
  const record = lesson as Partial<CourseLesson> & Record<string, unknown>;
  const nextLesson = { ...lesson } as CourseLesson;

  nextLesson.videoUrl = getMediaValue(
    record.videoUrl as string | null | undefined,
    record.video_url as string | null | undefined,
    record.mediaUrl as string | null | undefined,
    record.media_url as string | null | undefined,
  );
  nextLesson.attachmentUrl = getMediaValue(
    record.attachmentUrl as string | null | undefined,
    record.attachment_url as string | null | undefined,
    record.fileUrl as string | null | undefined,
    record.file_url as string | null | undefined,
    record.attachmentPath as string | null | undefined,
    record.attachment_path as string | null | undefined,
  );
  nextLesson.videoName = getMediaValue(
    record.videoName as string | null | undefined,
    record.video_name as string | null | undefined,
    record.videoFileName as string | null | undefined,
  );
  nextLesson.attachmentName = getMediaValue(
    record.attachmentName as string | null | undefined,
    record.attachment_name as string | null | undefined,
    record.fileName as string | null | undefined,
    record.file_name as string | null | undefined,
  );

  return nextLesson;
};

const normalizeCourseModules = (modules: CourseModule[] = []): CourseModule[] =>
  modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => normalizeLessonMedia(lesson as CourseLessonRecord)),
  }));

const validateCourseLesson = (lesson: CourseLesson) => {
  if (!lesson.title.trim()) {
    return 'Each lesson must include a title.';
  }

  if (!Number(lesson.duration) || Number(lesson.duration) <= 0) {
    return 'Each lesson must include a valid duration.';
  }

  const lessonVideo = getMediaValue(lesson.videoUrl, (lesson as Partial<CourseLesson> & Record<string, unknown>).video_url as string | null | undefined);
  const lessonAttachment = getMediaValue(lesson.attachmentUrl, (lesson as Partial<CourseLesson> & Record<string, unknown>).attachment_url as string | null | undefined);

  if (!lessonVideo && !lessonAttachment) {
    return 'Each lesson needs either a video upload or an attached document like a PDF.';
  }

  return '';
};

function buildDefaultCourseModules(courseTitle: string): CourseModule[] {
  return [
    {
      id: `${courseTitle}-orientation`,
      title: 'Orientation',
      lessons: [
        {
          id: `${courseTitle}-orientation-1`,
          title: 'Welcome and learning roadmap',
          duration: 8 * 60,
          summary: 'Get oriented to the course structure and best practices for upcoming modules.',
          type: 'Video',
          attachmentName: null,
          attachmentUrl: null,
        },
        {
          id: `${courseTitle}-orientation-2`,
          title: 'Career outcomes and milestones',
          duration: 6 * 60,
          summary: 'Connect each lesson to practical outcomes and skills you can apply immediately.',
          type: 'Reading',
          attachmentName: null,
          attachmentUrl: null,
        },
      ],
    },
    {
      id: `${courseTitle}-core`,
      title: 'Core concepts',
      lessons: [
        {
          id: `${courseTitle}-core-1`,
          title: 'Foundational frameworks',
          duration: 14 * 60,
          summary: 'Study the key concepts and methods behind the subject area.',
          type: 'Video',
          attachmentName: null,
          attachmentUrl: null,
        },
        {
          id: `${courseTitle}-core-2`,
          title: 'Applied exercise',
          duration: 12 * 60,
          summary: 'Use a small practical exercise to reinforce the framework you just learned.',
          type: 'Exercise',
          attachmentName: null,
          attachmentUrl: null,
        },
      ],
    },
  ];
}

export function CourseDetailPage() {
  const { courseId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [course, setCourse] = useState<LocalCourseRecord | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [instructorName, setInstructorName] = useState('Instructor');
  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resumeLessonId, setResumeLessonId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'resources'>('overview');
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [uploadStatusByKey, setUploadStatusByKey] = useState<
    Record<string, { progress: number; isUploading: boolean; error: string | null; loadedBytes: number; totalBytes: number; abortController?: AbortController }>
  >({});

  const isPreviewPath = location.pathname.includes('/preview') || /^\/instructor\/.*\/preview$/.test(location.pathname);
  const isPreviewMode = new URLSearchParams(location.search).get('preview') === '1' || isPreviewPath;
  const isInstructorOwner = Boolean(
    course && session?.userId && course.instructorId === session.userId && profile?.role === 'instructor',
  );
  const isAdminEditor = profile?.role === 'admin';
  const canEditCourse = isInstructorOwner || isAdminEditor;
  const shouldRenderStudentExperience = isPreviewMode || !canEditCourse;

  const handleCourseFieldChange = <K extends 'title' | 'description' | 'category' | 'aiModel'>(
    key: K,
    value: string,
  ) => {
    setCourse((current) => (current ? { ...current, [key]: value } : current));
  };

  useEffect(() => {
    if (!courseId || !session?.userId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadCourse = async () => {
    try {
      setLoading(true);
      setError(null);

      const courses = readLocalCourses();
      const normalizedId = courseId.trim().toLowerCase();
      const localCourse = courses.find((item) => item.id.trim().toLowerCase() === normalizedId) ?? null;
      const selectedCourse = await fetchCourseById(courseId) ?? localCourse;
      if (!isMounted) return;
      setCourse(selectedCourse);

      if (selectedCourse) {
        const instructors = readLocalUsers().filter((user) => user.role === 'instructor');
        const instructor = instructors.find((user) => user.id === selectedCourse.instructorId);
        setInstructorName(instructor?.profile.full_name ?? 'Instructor');

        const nextModules = normalizeCourseModules(
          selectedCourse.modules?.length ? selectedCourse.modules : buildDefaultCourseModules(selectedCourse.title),
        );
        setModules(nextModules);

        const enrollment = normalizeEnrollmentProgress(
          readLocalEnrollments().find(
            (entry) => entry.studentId === session.userId && entry.courseId === selectedCourse.id,
          ),
          selectedCourse,
        );

        const allLessons = nextModules.flatMap((module) => module.lessons);
        const initialCompleted = enrollment?.completedLessonIds?.length
          ? enrollment.completedLessonIds
          : allLessons.slice(0, Math.max(0, Math.min(allLessons.length, Math.round(((enrollment?.progress ?? 0) / 100) * allLessons.length)))).map((lesson) => lesson.id);
        setCompletedLessonIds(initialCompleted);

        const params = new URLSearchParams(location.search);
        const requestedResume = params.get('resume') === '1';
        const requestedLessonId = params.get('lessonId');

        if (requestedResume) {
          const resumeTarget = requestedLessonId && allLessons.some((lesson) => lesson.id === requestedLessonId)
            ? requestedLessonId
            : allLessons.find((lesson) => !initialCompleted.includes(lesson.id))?.id ?? allLessons[0]?.id ?? null;
          setResumeLessonId(resumeTarget);
          setSelectedLessonId(resumeTarget);
        } else {
          const fallbackLessonId = allLessons[0]?.id ?? null;
          setResumeLessonId(null);
          setSelectedLessonId(fallbackLessonId);
        }
      }
    } catch (loadError) {
      console.error('Failed to load course details:', loadError);
      setError('Unable to load this course from the local platform database.');
    } finally {
      if (isMounted) {
      setLoading(false);
      }
    }
    };

    void loadCourse();
    return () => {
      isMounted = false;
    };
  }, [courseId, session?.userId, location.search]);

  useEffect(() => {
    if (!resumeLessonId) return;

    const target = document.getElementById(resumeLessonId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('ring-2', 'ring-primary-500', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-gray-950');
    }
  }, [resumeLessonId, modules]);

  const allLessons = useMemo(() => modules.flatMap((module) => module.lessons), [modules]);
  const selectedLesson = useMemo(() => {
    if (!allLessons.length) return null;
    if (selectedLessonId && allLessons.some((lesson) => lesson.id === selectedLessonId)) {
      return allLessons.find((lesson) => lesson.id === selectedLessonId) ?? allLessons[0];
    }
    return allLessons[0];
  }, [allLessons, selectedLessonId]);
  const completionPercent = useMemo(() => {
    if (!allLessons.length) return 0;
    return Math.round((completedLessonIds.length / allLessons.length) * 100);
  }, [allLessons.length, completedLessonIds.length]);

  useEffect(() => {
    if (!allLessons.length) {
      setSelectedLessonId(null);
      return;
    }

    if (!selectedLessonId || !allLessons.some((lesson) => lesson.id === selectedLessonId)) {
      setSelectedLessonId(resumeLessonId ?? allLessons[0].id);
    }
  }, [allLessons, resumeLessonId, selectedLessonId]);

  const selectedLessonVideoUrl = selectedLesson ? getMediaValue(
    selectedLesson.videoUrl,
    (selectedLesson as Partial<CourseLesson> & Record<string, unknown>).video_url as string | null | undefined,
  ) : null;
  const selectedLessonAttachmentUrl = selectedLesson ? getMediaValue(
    selectedLesson.attachmentUrl,
    (selectedLesson as Partial<CourseLesson> & Record<string, unknown>).attachment_url as string | null | undefined,
  ) : null;

  const handleToggleLesson = (lessonId: string) => {
    if (!course || !session?.userId || isInstructorOwner) return;

    const nextCompleted = completedLessonIds.includes(lessonId)
      ? completedLessonIds.filter((id) => id !== lessonId)
      : [...completedLessonIds, lessonId];

    setCompletedLessonIds(nextCompleted);

    const optimisticProgress = Math.round((nextCompleted.length / Math.max(allLessons.length, 1)) * 100);
    const nextStatus: 'active' | 'completed' = optimisticProgress >= 100 ? 'completed' : 'active';
    const enrollments = readLocalEnrollments();
    const nextEnrollments: LocalEnrollmentRecord[] = enrollments.map((entry) =>
      entry.studentId === session.userId && entry.courseId === course.id
        ? {
            ...entry,
            completedLessonIds: nextCompleted,
            progressPercentage: optimisticProgress,
            progress: optimisticProgress,
            status: nextStatus,
          }
        : entry,
    );
    writeLocalEnrollments(nextEnrollments);

    const nextEnrollment = upsertEnrollmentProgress(session.userId, course.id, nextCompleted, course);
    if (nextEnrollment) {
      writeLocalEnrollments(
        readLocalEnrollments().map((entry) =>
          entry.studentId === session.userId && entry.courseId === course.id
            ? {
                ...entry,
                ...nextEnrollment,
                completedLessonIds: nextCompleted,
                progress: nextEnrollment.progressPercentage,
                progressPercentage: nextEnrollment.progressPercentage,
                status: nextEnrollment.status,
              }
            : entry,
        ),
      );
    }
  };

  const handlePlayLessonMedia = (
    lesson: CourseLesson,
    lessonVideoUrl: string | null,
    lessonAttachmentUrl: string | null,
  ) => {
    setSelectedLessonId(lesson.id);
    setActiveTab('overview');

    const mediaTarget = document.getElementById(`lesson-media-${lesson.id}`) as HTMLVideoElement | HTMLIFrameElement | null;

    if (mediaTarget) {
      mediaTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (lessonVideoUrl) {
      const videoElement = mediaTarget instanceof HTMLVideoElement ? mediaTarget : null;
      if (videoElement) {
        void videoElement.play().catch(() => undefined);
        return;
      }

      if (mediaTarget) return;
    }

    if (lessonAttachmentUrl) {
      window.open(lessonAttachmentUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleAddModule = () => {
    resetUploadStateForNewLesson();
    setModules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: `Module ${current.length + 1}`,
        lessons: [
          {
            id: crypto.randomUUID(),
            title: 'New lesson',
            duration: 10 * 60,
            summary: 'Add the lesson summary and launch content here.',
            type: 'Video',
            videoName: null,
            videoUrl: null,
            attachmentName: null,
            attachmentUrl: null,
          },
        ],
      },
    ]);
  };

  const handleAddLesson = (moduleIndex: number) => {
    resetUploadStateForNewLesson();
    setModules((current) =>
      current.map((module, index) =>
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
    );
  };

  const handleDeleteLesson = async (moduleIndex: number, lessonId: string) => {
    const currentModule = modules[moduleIndex];
    const targetLesson = currentModule?.lessons.find((lesson) => lesson.id === lessonId);

    if (course && targetLesson) {
      try {
        await deleteLessonMediaIfUnused(course.id, lessonId, targetLesson);
      } catch (error) {
        console.warn('Lesson media cleanup failed; keeping the lesson deletion state intact.', error);
      }
    }

    setModules((current) =>
      current.map((module, index) =>
        index === moduleIndex
          ? { ...module, lessons: module.lessons.filter((lesson) => lesson.id !== lessonId) }
          : module,
      ),
    );
  };

  const handleDeleteModule = async (moduleIndex: number) => {
    const currentModule = modules[moduleIndex];

    if (course && currentModule) {
      try {
        await deleteModuleMediaIfUnused(course.id, currentModule.id, currentModule);
      } catch (error) {
        console.warn('Module media cleanup failed; keeping the module deletion state intact.', error);
      }
    }

    setModules((current) => current.filter((_, index) => index !== moduleIndex));
  };

  const handleLessonDurationChange = (
    moduleIndex: number,
    lessonIndex: number,
    unit: 'hours' | 'minutes' | 'seconds',
    value: string,
  ) => {
    setModules((current) =>
      current.map((module, currentModuleIndex) =>
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
    );
  };

  const uploadStateKey = (moduleIndex: number, lessonIndex: number, kind: 'video' | 'attachment') =>
    `${moduleIndex}:${lessonIndex}:${kind}`;

  const resetUploadStateForNewLesson = () => {
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

      const nextDuration = await new Promise<number>((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = hostedVideoPath;
        video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : detectedDuration || 0);
        video.onerror = () => resolve(detectedDuration || 0);
      });

      setModules((current) =>
        current.map((module, currentModuleIndex) =>
          currentModuleIndex === moduleIndex
            ? {
                ...module,
                lessons: module.lessons.map((lesson, currentLessonIndex) =>
                  currentLessonIndex === lessonIndex
                    ? {
                        ...lesson,
                        duration: nextDuration > 0 ? nextDuration : lesson.duration,
                        type: 'Video',
                        videoName: file.name,
                        videoUrl: hostedVideoPath,
                      }
                    : lesson,
                ),
              }
            : module,
        ),
      );
    } catch (uploadError) {
      const message = uploadError instanceof DOMException && uploadError.name === 'AbortError'
        ? 'Upload cancelled.'
        : uploadError instanceof Error
          ? uploadError.message
          : 'The uploaded lesson video could not be stored. Please choose another file or use an external link.';

      console.error('Failed to process uploaded lesson video:', uploadError);
      setUploadState(key, { progress: 0, isUploading: false, error: message, loadedBytes: 0, totalBytes: file.size, abortController: undefined });
      setSaveError(message);
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

      setModules((current) =>
        current.map((module, currentModuleIndex) =>
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
      );
    } catch (uploadError) {
      const message = uploadError instanceof DOMException && uploadError.name === 'AbortError'
        ? 'Upload cancelled.'
        : uploadError instanceof Error
          ? uploadError.message
          : 'The uploaded attachment could not be stored. Please choose another file or provide a direct URL.';

      console.error('Failed to process uploaded attachment:', uploadError);
      setUploadState(key, { progress: 0, isUploading: false, error: message, loadedBytes: 0, totalBytes: file.size, abortController: undefined });
      setSaveError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveCourseEdits = () => {
    if (!course || !session?.userId) return;

    if (!canEditCourse) {
      setSaveError('Only the course owner or an administrator can save changes for this course.');
      return;
    }

    for (const module of modules) {
      for (const lesson of module.lessons) {
        const validationError = validateCourseLesson(lesson);
        if (validationError) {
          setSaveError(validationError);
          return;
        }
      }
    }

    setSaveError(null);

    const updatedCourse = {
      ...course,
      modules,
    };

    const nextCourses = readLocalCourses().map((item) =>
      item.id === course.id ? updatedCourse : item,
    );
    writeLocalCourses(nextCourses);
    setCourse(updatedCourse);
  };

  const handleDeleteCourse = async () => {
    if (!course || !session?.userId) return;

    const confirmed = window.confirm(`Delete "${course.title}"? This removes the course and all related enrollment data.`);
    if (!confirmed) return;

    try {
      await deleteCourseRecord(course);
    } catch (error) {
      console.warn('Course deletion cleanup failed; falling back to local course removal.', error);
      writeLocalCourses(readLocalCourses().filter((item) => item.id !== course.id));

      const users = readLocalUsers();
      writeLocalUsers(
        users.map((user) => ({
          ...user,
          courseIds: (user.courseIds ?? []).filter((courseId) => courseId !== course.id),
        })),
      );

      writeLocalEnrollments(readLocalEnrollments().filter((entry) => entry.courseId !== course.id));
    }

    navigate('/courses');
  };

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          Loading course content…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!course) {
    return (
      <div className="space-y-4">
        <Link to="/courses" className="btn-secondary w-fit">
          <ArrowLeft className="directional-icon h-4 w-4" />
          Back to My Courses
        </Link>
        <div className="card p-6 text-sm text-gray-600 dark:text-gray-300">
          This course could not be found. Try returning to your enrolled course list.
        </div>
      </div>
    );
  }

  const renderStudentPlayer = () => {
    const currentLesson = selectedLesson ?? allLessons[0] ?? null;
    const currentVideoUrl = currentLesson ? getMediaValue(
      currentLesson.videoUrl,
      (currentLesson as Partial<CourseLesson> & Record<string, unknown>).video_url as string | null | undefined,
    ) : null;
    const currentAttachmentUrl = currentLesson ? getMediaValue(
      currentLesson.attachmentUrl,
      (currentLesson as Partial<CourseLesson> & Record<string, unknown>).attachment_url as string | null | undefined,
    ) : null;

    return (
      <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
        <aside className="card overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">Course outline</p>
            <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{course.title}</h2>
          </div>

          <div className="space-y-3 p-3">
            {modules.map((module, moduleIndex) => {
              const isExpanded = expandedModules[module.id] ?? true;
              const moduleLessons = module.lessons;

              return (
                <div key={module.id} className="rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60">
                  <button
                    type="button"
                    onClick={() => setExpandedModules((current) => ({ ...current, [module.id]: !isExpanded }))}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                        Module {moduleIndex + 1}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{module.title}</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                      {moduleLessons.length}
                    </span>
                  </button>

                  {isExpanded && (
                    <ul className="space-y-2 border-t border-gray-200 px-2 pb-2 pt-2 dark:border-gray-800">
                      {moduleLessons.map((lesson) => {
                        const isSelected = lesson.id === currentLesson?.id;
                        const isComplete = completedLessonIds.includes(lesson.id);

                        return (
                          <li key={lesson.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLessonId(lesson.id);
                                setActiveTab('overview');
                              }}
                              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200 dark:bg-primary-950/20 dark:text-primary-300 dark:ring-primary-800/60'
                                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                              }`}
                            >
                              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                                isComplete
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                  : 'bg-white text-gray-500 dark:bg-gray-950 dark:text-gray-300'
                              }`}>
                                {isComplete ? '✓' : moduleIndex + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{lesson.title}</span>
                                <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-gray-400">
                                  {formatLessonDuration(lesson.duration)}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="space-y-6">
          {isPreviewMode && (
            <div className="card border-primary-200 bg-primary-50/80 p-4 dark:border-primary-900/60 dark:bg-primary-950/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">Preview Mode (Instructor View)</p>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Review the course exactly as students will experience it.</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/instructor?editCourse=${encodeURIComponent(course.id)}`)}
                  className="btn-secondary"
                >
                  <PencilLine className="h-4 w-4" />
                  Edit Course
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            {currentLesson && (
              <>
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">Now playing</p>
                      <h2 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{currentLesson.title}</h2>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      {course.category}
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  {currentVideoUrl ? (
                    <div id={`lesson-media-${currentLesson.id}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-black shadow-sm dark:border-gray-800">
                      {isEmbeddableVideo(currentVideoUrl) && getVideoEmbedUrl(currentVideoUrl)?.startsWith('http') ? (
                        <iframe
                          src={getVideoEmbedUrl(currentVideoUrl)!}
                          title={currentLesson.title}
                          className="h-[420px] w-full"
                          allowFullScreen
                        />
                      ) : (
                        <VideoPlayer src={currentVideoUrl} title={currentLesson.title} className="min-h-[280px]" />
                      )}
                    </div>
                  ) : (
                    <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
                      No video is attached to this lesson yet.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  activeTab === 'overview'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('resources')}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  activeTab === 'resources'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Resources
              </button>
            </div>

            {activeTab === 'overview' && currentLesson ? (
              <div className="mt-5 space-y-5">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800 dark:text-gray-300">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatLessonDuration(currentLesson.duration)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 dark:bg-gray-800 dark:text-gray-300">
                    <FileText className="h-3.5 w-3.5" />
                    {currentLesson.type}
                  </span>
                </div>

                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Instructor</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{instructorName}</p>
                </div>

                <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                  {currentLesson.summary || course.description}
                </p>

                {shouldRenderStudentExperience && !canEditCourse && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => currentLesson && handleToggleLesson(currentLesson.id)}
                      className={`btn-secondary ${
                        completedLessonIds.includes(currentLesson.id)
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
                          : ''
                      }`}
                    >
                      {completedLessonIds.includes(currentLesson.id) ? 'Mark Incomplete' : 'Mark Complete'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Lesson resources</p>
                </div>

                {currentAttachmentUrl ? (
                  <a
                    href={currentAttachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-primary-600 hover:bg-primary-50 dark:border-gray-700 dark:bg-gray-900 dark:text-primary-300 dark:hover:bg-primary-950/20"
                  >
                    <FileText className="h-4 w-4" />
                    Download attachment
                  </a>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No resources are attached to this lesson yet.</p>
                )}

                {currentLesson?.attachmentName && (
                  <p className="text-sm text-gray-600 dark:text-gray-300">Attachment: {currentLesson.attachmentName}</p>
                )}
              </div>
            )}

            {activeTab === 'resources' && (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Course overview</p>
                  <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{course.description}</p>
                </div>

                {currentLesson && (
                  <div className="space-y-3">
                    {currentVideoUrl ? (
                      <a
                        href={currentVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:underline dark:text-primary-300"
                      >
                        <PlayCircle className="h-4 w-4" />
                        Open media source
                      </a>
                    ) : null}

                    {currentAttachmentUrl ? (
                      <a
                        href={currentAttachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:underline dark:text-primary-300"
                      >
                        <FileText className="h-4 w-4" />
                        Download lesson resource
                      </a>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No downloadable resource for this lesson.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link to="/courses" className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-300">
            <ArrowLeft className="directional-icon h-4 w-4" />
            Back to My Courses
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{course.title}</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
          <Sparkles className="h-3.5 w-3.5" />
          {course.category}
        </div>
      </div>

      {!isPreviewMode && canEditCourse && (
        <div className="card p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                Course editing
              </p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">Edit course setup</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={handleAddModule}>
                <Plus className="h-4 w-4" />
                Add module
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveCourseEdits}>
                Save changes
              </button>
              <button type="button" className="btn-secondary border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30" onClick={handleDeleteCourse}>
                Delete course
              </button>
            </div>
          </div>

          {saveError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
              {saveError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="label-text">Course title</label>
              <input
                value={course.title}
                onChange={(event) => handleCourseFieldChange('title', event.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="label-text">Description</label>
              <textarea
                rows={4}
                value={course.description}
                onChange={(event) => handleCourseFieldChange('description', event.target.value)}
                className="input-field resize-none"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label-text">Category</label>
                <input
                  value={course.category}
                  list="course-category-suggestions"
                  onChange={(event) => handleCourseFieldChange('category', event.target.value)}
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
                  value={course.aiModel ?? 'Coach Pro'}
                  onChange={(event) => handleCourseFieldChange('aiModel', event.target.value)}
                  className="input-field"
                >
                  <option value="Coach Pro">Coach Pro</option>
                  <option value="Code Mentor">Code Mentor</option>
                  <option value="Project Planner">Project Planner</option>
                  <option value="Research Copilot">Research Copilot</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {shouldRenderStudentExperience ? renderStudentPlayer() : (
        <div className="space-y-4">
          {modules.map((module, moduleIndex) => (
            <div key={module.id} className="card overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex w-full items-center gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                      Module {moduleIndex + 1}
                    </div>
                    <input
                      value={module.title}
                      onChange={(event) =>
                        setModules((current) =>
                          current.map((item, index) =>
                            index === moduleIndex ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteModule(moduleIndex)}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800 dark:hover:text-red-400"
                    aria-label="Delete module"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {module.lessons.length} lessons
                  </span>
                </div>
              </div>

              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {module.lessons.map((lesson, lessonIndex) => {
                  const isComplete = completedLessonIds.includes(lesson.id);
                  const lessonVideoUrl = getMediaValue(
                    lesson.videoUrl,
                    (lesson as Partial<CourseLesson> & Record<string, unknown>).video_url as string | null | undefined,
                  );
                  const lessonAttachmentUrl = getMediaValue(
                    lesson.attachmentUrl,
                    (lesson as Partial<CourseLesson> & Record<string, unknown>).attachment_url as string | null | undefined,
                  );

                  return (
                    <div
                      key={lesson.id}
                      id={lesson.id}
                      className={`px-5 py-4 transition-colors ${resumeLessonId === lesson.id ? 'bg-primary-50/80 dark:bg-primary-950/20' : ''}`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="flex items-start gap-3 w-full">
                          <button
                            type="button"
                            aria-label={`Play ${lesson.title}`}
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                              isComplete
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                            }`}
                            onClick={() => handlePlayLessonMedia(lesson, lessonVideoUrl, lessonAttachmentUrl)}
                          >
                            {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                          </button>

                          <div className="w-full space-y-3">
                            <div className="flex flex-col gap-3 lg:flex-row">
                              <input
                                value={lesson.title}
                                onChange={(event) =>
                                  setModules((current) =>
                                    current.map((item, modulePos) =>
                                      modulePos === moduleIndex
                                        ? {
                                            ...item,
                                            lessons: item.lessons.map((entry, lessonPos) =>
                                              lessonPos === lessonIndex
                                                ? { ...entry, title: event.target.value }
                                                : entry,
                                            ),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                              />
                              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
                                {formatLessonDuration(lesson.duration)}
                              </div>
                            </div>

                            <div className="grid gap-2 md:grid-cols-3">
                              {(['hours', 'minutes', 'seconds'] as const).map((unit) => {
                                const durationParts = getDurationParts(lesson.duration);

                                return (
                                  <label key={unit} className="block text-xs text-gray-500 dark:text-gray-400">
                                    <span className="mb-1 block uppercase tracking-[0.12em]">{unit}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={unit === 'hours' ? 99 : 59}
                                      value={durationParts[unit]}
                                      onChange={(event) =>
                                        handleLessonDurationChange(moduleIndex, lessonIndex, unit, event.target.value)
                                      }
                                      className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                                    />
                                  </label>
                                );
                              })}
                            </div>

                            <textarea
                              rows={2}
                              value={lesson.summary ?? ''}
                              placeholder="Lesson summary"
                              onChange={(event) =>
                                setModules((current) =>
                                  current.map((item, modulePos) =>
                                    modulePos === moduleIndex
                                      ? {
                                          ...item,
                                          lessons: item.lessons.map((entry, lessonPos) =>
                                            lessonPos === lessonIndex
                                              ? { ...entry, summary: event.target.value }
                                              : entry,
                                          ),
                                        }
                                      : item,
                                  ),
                                )
                              }
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                            />

                            <div className="space-y-3 text-xs">
                              <div className="flex flex-wrap gap-3">
                                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                                  <Upload className="h-3.5 w-3.5" />
                                  {lesson.videoName ? 'Replace Video' : 'Upload Video'}
                                  <input
                                    type="file"
                                    accept="video/*"
                                    className="hidden"
                                    onChange={(event) => handleLessonVideoUpload(moduleIndex, lessonIndex, event)}
                                  />
                                </label>

                                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                                  <FileText className="h-3.5 w-3.5" />
                                  {lesson.attachmentName ? 'Replace Document' : 'Upload Document'}
                                  <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                                    className="hidden"
                                    onChange={(event) => handleLessonAttachmentUpload(moduleIndex, lessonIndex, event)}
                                  />
                                </label>
                              </div>

                              {(['video', 'attachment'] as const).map((kind) => {
                                const uploadKey = uploadStateKey(moduleIndex, lessonIndex, kind);
                                const uploadState = uploadStatusByKey[uploadKey];
                                if (!uploadState) return null;

                                return (
                                  <div key={uploadKey} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-950">
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
                                        className={`h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-300 shadow-sm ${uploadState.error ? 'bg-gradient-to-r from-red-500 to-red-600' : ''}`}
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
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteLesson(moduleIndex, lesson.id)}
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800 dark:hover:text-red-400"
                            aria-label="Delete lesson"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-gray-200 bg-gray-50/50 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/30">
                <button
                  type="button"
                  onClick={() => handleAddLesson(moduleIndex)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add lesson to Module {moduleIndex + 1}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}