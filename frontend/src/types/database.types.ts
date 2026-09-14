/**
 * Shared TypeScript types for the Educational Platform.
 * These mirror the Supabase database schema and are used across
 * the frontend for type-safe database queries.
 */

export type UserRole = 'student' | 'instructor' | 'admin';

export type ChatRole = 'user' | 'assistant' | 'system';

// -----------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileInsert = {
  id: string;
  full_name: string;
  role?: UserRole;
  avatar_url?: string | null;
  bio?: string | null;
};

export type ProfileUpdate = {
  full_name?: string;
  role?: UserRole;
  avatar_url?: string | null;
  bio?: string | null;
};

// -----------------------------------------------------------------------
// Courses
// -----------------------------------------------------------------------

export type Course = {
  id: string;
  instructor_id: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export type CourseInsert = {
  instructor_id?: string;
  title: string;
  description: string;
  thumbnail_url?: string | null;
  is_published?: boolean;
};

export type CourseUpdate = {
  title?: string;
  description?: string;
  thumbnail_url?: string | null;
  is_published?: boolean;
};

// -----------------------------------------------------------------------
// Course Modules
// -----------------------------------------------------------------------

export type CourseModule = {
  id: string;
  course_id: string;
  title: string;
  position: number;
  created_at: string;
}

export type CourseModuleInsert = {
  course_id: string;
  title: string;
  position?: number;
};

export type CourseModuleUpdate = {
  title?: string;
  position?: number;
};

// -----------------------------------------------------------------------
// Lessons
// -----------------------------------------------------------------------

export type Lesson = {
  id: string;
  module_id: string;
  title: string;
  content: string | null;
  video_url: string | null;
  position: number;
  duration_minutes: number | null;
  created_at: string;
}

export type LessonInsert = {
  module_id: string;
  title: string;
  content?: string | null;
  video_url?: string | null;
  position?: number;
  duration_minutes?: number | null;
};

export type LessonUpdate = {
  title?: string;
  content?: string | null;
  video_url?: string | null;
  position?: number;
  duration_minutes?: number | null;
};

// -----------------------------------------------------------------------
// Enrollments
// -----------------------------------------------------------------------

export type Enrollment = {
  id: string;
  student_id: string;
  course_id: string;
  enrolled_at: string;
  completed_at: string | null;
}

export type EnrollmentInsert = {
  student_id?: string;
  course_id: string;
};

export type EnrollmentUpdate = {
  completed_at?: string | null;
};

// -----------------------------------------------------------------------
// AI Models
// -----------------------------------------------------------------------

export type AiModelConfig = {
  temperature?: number;
  max_tokens?: number;
  api_endpoint?: string;
  system_prompt?: string;
  [key: string]: unknown;
}

export type AiModel = {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  is_active: boolean;
  config: AiModelConfig;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type AiModelInsert = {
  name: string;
  provider: string;
  model_id: string;
  is_active?: boolean;
  config?: AiModelConfig;
  created_by?: string;
};

export type AiModelUpdate = {
  name?: string;
  provider?: string;
  model_id?: string;
  is_active?: boolean;
  config?: AiModelConfig;
};

// -----------------------------------------------------------------------
// Student Progress
// -----------------------------------------------------------------------

export type StudentProgress = {
  id: string;
  student_id: string;
  lesson_id: string;
  course_id: string;
  is_completed: boolean;
  completed_at: string | null;
  last_accessed_at: string;
}

export type StudentProgressInsert = {
  student_id?: string;
  lesson_id: string;
  course_id: string;
  is_completed?: boolean;
  completed_at?: string | null;
  last_accessed_at?: string;
};

export type StudentProgressUpdate = {
  is_completed?: boolean;
  completed_at?: string | null;
  last_accessed_at?: string;
};

// -----------------------------------------------------------------------
// AI Chat History
// -----------------------------------------------------------------------

export type ChatMetadata = {
  tokens_used?: number;
  latency_ms?: number;
  model_response_id?: string;
  [key: string]: unknown;
}

export type AiChatMessage = {
  id: string;
  student_id: string;
  course_id: string | null;
  lesson_id: string | null;
  ai_model_id: string | null;
  role: ChatRole;
  content: string;
  metadata: ChatMetadata;
  created_at: string;
}

export type AiChatMessageInsert = {
  student_id?: string;
  course_id?: string | null;
  lesson_id?: string | null;
  ai_model_id?: string | null;
  role: ChatRole;
  content: string;
  metadata?: ChatMetadata;
};

// -----------------------------------------------------------------------
// Composite / Joined types (for queries with relations)
// -----------------------------------------------------------------------

export type CourseWithInstructor = Course & {
  instructor: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
};

export type CourseWithModules = Course & {
  course_modules: CourseModule[];
};

export type ModuleWithLessons = CourseModule & {
  lessons: Lesson[];
};

export type EnrollmentWithCourse = Enrollment & {
  course: Pick<Course, 'id' | 'title' | 'thumbnail_url' | 'description'>;
};

export type LessonWithProgress = Lesson & {
  student_progress: StudentProgress[];
};

// -----------------------------------------------------------------------
// Database type for Supabase client generics
// -----------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      courses: {
        Row: Course;
        Insert: CourseInsert;
        Update: CourseUpdate;
        Relationships: [];
      };
      course_modules: {
        Row: CourseModule;
        Insert: CourseModuleInsert;
        Update: CourseModuleUpdate;
        Relationships: [];
      };
      lessons: {
        Row: Lesson;
        Insert: LessonInsert;
        Update: LessonUpdate;
        Relationships: [];
      };
      enrollments: {
        Row: Enrollment;
        Insert: EnrollmentInsert;
        Update: EnrollmentUpdate;
        Relationships: [];
      };
      ai_models: {
        Row: AiModel;
        Insert: AiModelInsert;
        Update: AiModelUpdate;
        Relationships: [];
      };
      student_progress: {
        Row: StudentProgress;
        Insert: StudentProgressInsert;
        Update: StudentProgressUpdate;
        Relationships: [];
      };
      ai_chat_history: {
        Row: AiChatMessage;
        Insert: AiChatMessageInsert;
        Update: Partial<AiChatMessageInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      chat_role: ChatRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
