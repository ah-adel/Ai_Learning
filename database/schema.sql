CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'instructor', 'admin')) DEFAULT 'student',
  avatar TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
  specialty TEXT,
  permissions TEXT NOT NULL DEFAULT '{"manage_courses":1,"moderate_students":1,"view_analytics":1}',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'instructor', 'admin')) DEFAULT 'student',
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  instructor_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  thumbnail_url TEXT,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE courses SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS instructor_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  specialty TEXT NOT NULL DEFAULT 'General Instruction',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '{"manage_courses":1,"moderate_students":1,"view_analytics":1}',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS instructor_course_assignments (
  id TEXT PRIMARY KEY,
  instructor_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (instructor_id, course_id),
  FOREIGN KEY (instructor_id) REFERENCES instructor_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_modules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  video_url TEXT,
  video_name TEXT,
  attachment_url TEXT,
  attachment_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES course_modules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_student_course_unique
  ON enrollments(student_id, course_id);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courses_select_public ON courses;
CREATE POLICY courses_select_public
  ON courses FOR SELECT
  USING (is_published = TRUE OR current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = instructor_id);

DROP POLICY IF EXISTS courses_write_owners ON courses;
CREATE POLICY courses_write_owners
  ON courses FOR ALL
  USING (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = instructor_id)
  WITH CHECK (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = instructor_id);

DROP POLICY IF EXISTS modules_select_public ON course_modules;
CREATE POLICY modules_select_public
  ON course_modules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = course_modules.course_id
      AND (c.is_published = TRUE OR current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ));

DROP POLICY IF EXISTS modules_write_owners ON course_modules;
CREATE POLICY modules_write_owners
  ON course_modules FOR ALL
  USING (EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = course_modules.course_id
      AND (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = course_modules.course_id
      AND (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ));

DROP POLICY IF EXISTS lessons_select_public ON lessons;
CREATE POLICY lessons_select_public
  ON lessons FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM course_modules cm
    JOIN courses c ON c.id = cm.course_id
    WHERE cm.id = lessons.module_id
      AND (c.is_published = TRUE OR current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ));

DROP POLICY IF EXISTS lessons_write_owners ON lessons;
CREATE POLICY lessons_write_owners
  ON lessons FOR ALL
  USING (EXISTS (
    SELECT 1
    FROM course_modules cm
    JOIN courses c ON c.id = cm.course_id
    WHERE cm.id = lessons.module_id
      AND (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM course_modules cm
    JOIN courses c ON c.id = cm.course_id
    WHERE cm.id = lessons.module_id
      AND (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = c.instructor_id)
  ));

DROP POLICY IF EXISTS enrollments_user_access ON enrollments;
CREATE POLICY enrollments_user_access
  ON enrollments FOR ALL
  USING (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = student_id)
  WITH CHECK (current_user = 'postgres' OR current_setting('request.jwt.claim.sub', true) = student_id);

CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  config TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_chat_history (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')) DEFAULT 'user',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE CASCADE
);

INSERT INTO users (
  id, name, email, password, role, avatar, status, specialty, permissions, joined_at, created_at, updated_at
)
VALUES (
  'admin-1',
  'Platform Admin',
  'ah.adel2188@gmail.com',
  'Ah.667788',
  'admin',
  NULL,
  'active',
  NULL,
  '{"manage_courses":1,"moderate_students":1,"view_analytics":1}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (
  id, full_name, role, avatar_url, bio, created_at, updated_at
)
VALUES (
  'admin-1',
  'Platform Admin',
  'admin',
  NULL,
  'Platform administrator and system owner.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_profiles_user ON instructor_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_instructor_assignments_instructor ON instructor_course_assignments(instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_assignments_course ON instructor_course_assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_student ON student_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_student ON ai_chat_history(student_id);
