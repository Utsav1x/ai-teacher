-- Seed the mock learning path used by the dashboard and assessment flow.
-- Safe to run more than once.

DO $$
DECLARE
  demo_course_id uuid;
BEGIN
  SELECT id INTO demo_course_id
  FROM public.courses
  WHERE title = 'AI Teacher Demo'
    AND is_default = true
  LIMIT 1;

  IF demo_course_id IS NULL THEN
    INSERT INTO public.courses (title, description, is_default, created_by)
    VALUES (
      'AI Teacher Demo',
      'A short starter path covering the foundations of neural networks.',
      true,
      NULL
    )
    RETURNING id INTO demo_course_id;
  END IF;

  INSERT INTO public.lessons (
    course_id, title, description, order_index, content, is_default, created_by
  )
  VALUES
    (
      demo_course_id,
      'Introduction to Neural Networks',
      'Understand neurons, layers, and activation functions.',
      1,
      '{"engineKey":"ai-teacher-demo-lesson-1"}'::jsonb,
      true,
      NULL
    ),
    (
      demo_course_id,
      'How Neural Networks Learn',
      'Understand prediction, error, and gradient descent.',
      2,
      '{"engineKey":"ai-teacher-demo-lesson-2"}'::jsonb,
      true,
      NULL
    )
  ON CONFLICT (course_id, order_index) DO NOTHING;

  INSERT INTO public.profiles (id, email, username, display_name)
  SELECT
    id,
    email,
    COALESCE(raw_user_meta_data->>'username', split_part(COALESCE(email, 'learner'), '@', 1)),
    COALESCE(raw_user_meta_data->>'full_name', split_part(COALESCE(email, 'Learner'), '@', 1))
  FROM auth.users
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_courses (user_id, course_id)
  SELECT id, demo_course_id
  FROM public.profiles
  ON CONFLICT DO NOTHING;

  INSERT INTO public.lesson_progress (user_id, lesson_id, status, progress_percentage)
  SELECT uc.user_id, lesson.id, 'not_started', 0
  FROM public.user_courses uc
  JOIN public.lessons lesson ON lesson.course_id = demo_course_id
  ON CONFLICT DO NOTHING;
END $$;

CREATE TABLE IF NOT EXISTS public.learning_activity (
  user_id       uuid not null references auth.users(id) on delete cascade,
  activity_date date not null default current_date,
  study_minutes integer not null default 0 check (study_minutes >= 0),
  created_at    timestamptz not null default now(),
  primary key (user_id, activity_date)
);

ALTER TABLE public.learning_activity
  ADD COLUMN IF NOT EXISTS study_minutes integer not null default 0;

ALTER TABLE public.learning_activity ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_activity' AND policyname = 'Users can read own learning activity') THEN
    CREATE POLICY "Users can read own learning activity"
      ON public.learning_activity FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_activity' AND policyname = 'Users can insert own learning activity') THEN
    CREATE POLICY "Users can insert own learning activity"
      ON public.learning_activity FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_activity' AND policyname = 'Users can update own learning activity') THEN
    CREATE POLICY "Users can update own learning activity"
      ON public.learning_activity FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'courses' AND policyname = 'Anyone can read default courses') THEN
    CREATE POLICY "Anyone can read default courses"
      ON public.courses FOR SELECT
      USING (is_default = true OR created_by = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lessons' AND policyname = 'Anyone can read default lessons') THEN
    CREATE POLICY "Anyone can read default lessons"
      ON public.lessons FOR SELECT
      USING (is_default = true OR created_by = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_courses' AND policyname = 'Users can read own courses') THEN
    CREATE POLICY "Users can read own courses"
      ON public.user_courses FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesson_progress' AND policyname = 'Users can read own lesson progress') THEN
    CREATE POLICY "Users can read own lesson progress"
      ON public.lesson_progress FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesson_progress' AND policyname = 'Users can insert own lesson progress') THEN
    CREATE POLICY "Users can insert own lesson progress"
      ON public.lesson_progress FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesson_progress' AND policyname = 'Users can update own lesson progress') THEN
    CREATE POLICY "Users can update own lesson progress"
      ON public.lesson_progress FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Allow multiple attempts for the same lesson. The application displays the latest attempt.
DROP INDEX IF EXISTS public.assessment_results_user_lesson_key;

CREATE OR REPLACE FUNCTION public.handle_new_user_demo_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_course_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, username, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(COALESCE(NEW.email, 'learner'), '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'Learner'), '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO demo_course_id
  FROM public.courses
  WHERE title = 'AI Teacher Demo'
    AND is_default = true
  LIMIT 1;

  INSERT INTO public.user_courses (user_id, course_id)
  VALUES (NEW.id, demo_course_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.lesson_progress (user_id, lesson_id, status, progress_percentage)
  SELECT NEW.id, id, 'not_started', 0
  FROM public.lessons
  WHERE course_id = demo_course_id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_demo_path ON auth.users;
CREATE TRIGGER on_auth_user_created_demo_path
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_demo_path();
