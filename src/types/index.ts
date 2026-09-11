export type UserRole = 'admin' | 'instructor' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string | null;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  instructorId: string;
  price?: number;
  category: string;
  status: 'draft' | 'published' | 'review' | 'Draft' | 'Published' | 'Review';
  thumbnail?: string | null;
  createdAt: string;
}

export interface Module {
  id: string;
  courseId?: string;
  title: string;
  order?: number;
}

export interface Lesson {
  id: string;
  moduleId?: string;
  title: string;
  videoUrl?: string | null;
  duration: number;
  isFreePreview?: boolean;
}

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  completedLessonIds: string[];
  progressPercentage: number;
}

export interface Progress {
  userId: string;
  courseId: string;
  completedLessonIds: string[];
  progressPercentage: number;
}
