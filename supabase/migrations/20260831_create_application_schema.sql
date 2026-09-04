create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text,
  order_index integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lessons_course_order_unique unique (course_id, order_index)
);

create table if not exists public.user_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  progress_percentage numeric(5,2) not null default 0 check (progress_percentage >= 0 and progress_percentage <= 100),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  score numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question text not null,
  question_type text not null,
  correct_answer text,
  student_answer text,
  is_correct boolean not null default false
);

create table if not exists public.learning_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  score numeric(5,2) not null default 0,
  strong_areas text[] not null default '{}',
  weak_areas text[] not null default '{}',
  recommendations text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  file_type text,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create or replace function public.ensure_default_demo_course()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  if not exists (
    select 1
    from public.courses c
    where c.is_default = true
      and c.title = 'AI Teacher Demo'
  ) then
    insert into public.courses (title, description, is_default, created_by)
    values (
      'AI Teacher Demo',
      'Starter learning experience for new learners. A short introduction to how neural networks think and learn.',
      true,
      null
    )
    returning id into v_course_id;
  else
    select c.id into v_course_id
    from public.courses c
    where c.is_default = true
      and c.title = 'AI Teacher Demo'
    limit 1;
  end if;

  if not exists (
    select 1
    from public.lessons l
    join public.courses c on c.id = l.course_id
    where c.is_default = true
      and c.title = 'AI Teacher Demo'
      and l.title = 'Introduction to Neural Networks'
  ) then
    insert into public.lessons (course_id, title, description, order_index, content, is_default, created_by)
    values (
      v_course_id,
      'Introduction to Neural Networks',
      'A quick, beginner-friendly overview of what neural networks are and how they process information.',
      1,
      '{
        "summary": "Neural networks are systems inspired by the brain that learn patterns from data.",
        "objective": "Understand what neurons, layers, and activations do.",
        "keyPoints": ["Neurons process inputs and pass signals forward.", "Layers group neurons to build richer representations.", "Learning happens as the network adjusts weights through feedback."]
      }'::jsonb,
      true,
      null
    );
  end if;

  if not exists (
    select 1
    from public.lessons l
    join public.courses c on c.id = l.course_id
    where c.is_default = true
      and c.title = 'AI Teacher Demo'
      and l.title = 'How Neural Networks Learn'
  ) then
    insert into public.lessons (course_id, title, description, order_index, content, is_default, created_by)
    values (
      v_course_id,
      'How Neural Networks Learn',
      'See how feedback and repeated practice help the model improve its predictions over time.',
      2,
      '{
        "summary": "Networks learn by comparing outputs to target values and adjusting their internal weights.",
        "objective": "Understand prediction, error, and improvement.",
        "keyPoints": ["A loss function measures how far the prediction is from the target.", "Gradient descent nudges weights in the right direction.", "Repeated updates gradually improve performance."]
      }'::jsonb,
      true,
      null
    );
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  insert into public.profiles (id, username, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update set
    email = excluded.email,
    username = excluded.username,
    display_name = excluded.display_name;

  perform public.ensure_default_demo_course();

  select c.id into v_course_id
  from public.courses c
  where c.is_default = true
    and c.title = 'AI Teacher Demo'
  limit 1;

  insert into public.user_courses (user_id, course_id)
  select new.id, v_course_id
  where not exists (
    select 1
    from public.user_courses uc
    where uc.user_id = new.id and uc.course_id = v_course_id
  )
  on conflict (user_id, course_id) do nothing;

  insert into public.lesson_progress (user_id, lesson_id, status, progress_percentage, updated_at)
  select new.id, l.id, 'not_started', 0, now()
  from public.lessons l
  join public.courses c on c.id = l.course_id
  where c.is_default = true
    and c.title = 'AI Teacher Demo'
  on conflict (user_id, lesson_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.user_courses enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.learning_reports enable row level security;
alter table public.materials enable row level security;

create policy "Profiles are viewable by owner"
on public.profiles
for select
using (auth.uid() = id);

create policy "Profiles are editable by owner"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can insert own profile"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "Users can view default courses and their own content"
on public.courses
for select
using (
  is_default = true
  or created_by = auth.uid()
  or exists (
    select 1 from public.user_courses uc
    where uc.course_id = courses.id and uc.user_id = auth.uid()
  )
);

create policy "Users can create their own courses"
on public.courses
for insert
with check (created_by = auth.uid());

create policy "Users can update or delete their own courses"
on public.courses
for update using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "Users can delete their own non-default courses"
on public.courses
for delete using (created_by = auth.uid() and is_default = false);

create policy "Users can view lessons for default or accessible courses"
on public.lessons
for select
using (
  exists (
    select 1 from public.courses c
    where c.id = lessons.course_id
      and (
        c.is_default = true
        or c.created_by = auth.uid()
        or exists (
          select 1 from public.user_courses uc
          where uc.course_id = c.id and uc.user_id = auth.uid()
        )
      )
  )
);

create policy "Users can create lessons for their own courses"
on public.lessons
for insert
with check (
  exists (
    select 1 from public.courses c
    where c.id = course_id and c.created_by = auth.uid()
  )
);

create policy "Users can update or delete their own lessons"
on public.lessons
for update using (
  exists (
    select 1 from public.courses c
    where c.id = lessons.course_id and c.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.courses c
    where c.id = course_id and c.created_by = auth.uid()
  )
);

create policy "Users can delete their own lessons"
on public.lessons
for delete using (
  exists (
    select 1 from public.courses c
    where c.id = lessons.course_id and c.created_by = auth.uid()
  )
);

create policy "Users can view own enrollments"
on public.user_courses
for select
using (user_id = auth.uid());

create policy "Users can create own enrollments"
on public.user_courses
for insert
with check (user_id = auth.uid());

create policy "Users can delete own enrollments"
on public.user_courses
for delete using (user_id = auth.uid());

create policy "Users can view their own lesson progress"
on public.lesson_progress
for select
using (user_id = auth.uid());

create policy "Users can insert their own lesson progress"
on public.lesson_progress
for insert
with check (user_id = auth.uid());

create policy "Users can update their own lesson progress"
on public.lesson_progress
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete their own lesson progress"
on public.lesson_progress
for delete using (user_id = auth.uid());

create policy "Users can view their own assessments"
on public.assessments
for select
using (user_id = auth.uid());

create policy "Users can insert their own assessments"
on public.assessments
for insert
with check (user_id = auth.uid());

create policy "Users can update their own assessments"
on public.assessments
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete their own assessments"
on public.assessments
for delete using (user_id = auth.uid());

create policy "Users can view assessment questions for their own assessments"
on public.assessment_questions
for select
using (
  exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.user_id = auth.uid()
  )
);

create policy "Users can insert questions for their own assessments"
on public.assessment_questions
for insert
with check (
  exists (
    select 1 from public.assessments a
    where a.id = assessment_id and a.user_id = auth.uid()
  )
);

create policy "Users can update questions for their own assessments"
on public.assessment_questions
for update
using (
  exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.assessments a
    where a.id = assessment_id and a.user_id = auth.uid()
  )
);

create policy "Users can delete questions for their own assessments"
on public.assessment_questions
for delete
using (
  exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.user_id = auth.uid()
  )
);

create policy "Users can view their own learning reports"
on public.learning_reports
for select
using (user_id = auth.uid());

create policy "Users can insert their own learning reports"
on public.learning_reports
for insert
with check (user_id = auth.uid());

create policy "Users can update their own learning reports"
on public.learning_reports
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete their own learning reports"
on public.learning_reports
for delete using (user_id = auth.uid());

create policy "Users can view their own materials"
on public.materials
for select
using (user_id = auth.uid());

create policy "Users can insert their own materials"
on public.materials
for insert
with check (user_id = auth.uid());

create policy "Users can update their own materials"
on public.materials
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete their own materials"
on public.materials
for delete using (user_id = auth.uid());

insert into public.courses (title, description, is_default, created_by)
select 'AI Teacher Demo',
       'Starter learning experience for new learners. A short introduction to how neural networks think and learn.',
       true,
       null
where not exists (
  select 1
  from public.courses c
  where c.is_default = true
    and c.title = 'AI Teacher Demo'
);

insert into public.lessons (course_id, title, description, order_index, content, is_default, created_by)
select c.id,
       'Introduction to Neural Networks',
       'A quick, beginner-friendly overview of what neural networks are and how they process information.',
       1,
       '{
         "summary": "Neural networks are systems inspired by the brain that learn patterns from data.",
         "objective": "Understand what neurons, layers, and activations do.",
         "keyPoints": ["Neurons process inputs and pass signals forward.", "Layers group neurons to build richer representations.", "Learning happens as the network adjusts weights through feedback."]
       }'::jsonb,
       true,
       null
from public.courses c
where c.is_default = true
  and c.title = 'AI Teacher Demo'
  and not exists (
    select 1
    from public.lessons l
    where l.course_id = c.id
      and l.title = 'Introduction to Neural Networks'
  );

insert into public.lessons (course_id, title, description, order_index, content, is_default, created_by)
select c.id,
       'How Neural Networks Learn',
       'See how feedback and repeated practice help the model improve its predictions over time.',
       2,
       '{
         "summary": "Networks learn by comparing outputs to target values and adjusting their internal weights.",
         "objective": "Understand prediction, error, and improvement.",
         "keyPoints": ["A loss function measures how far the prediction is from the target.", "Gradient descent nudges weights in the right direction.", "Repeated updates gradually improve performance."]
       }'::jsonb,
       true,
       null
from public.courses c
where c.is_default = true
  and c.title = 'AI Teacher Demo'
  and not exists (
    select 1
    from public.lessons l
    where l.course_id = c.id
      and l.title = 'How Neural Networks Learn'
  );

insert into public.user_courses (user_id, course_id)
select p.id, c.id
from public.profiles p
cross join public.courses c
where c.is_default = true
  and c.title = 'AI Teacher Demo'
  and not exists (
    select 1
    from public.user_courses uc
    where uc.user_id = p.id and uc.course_id = c.id
  );

insert into public.lesson_progress (user_id, lesson_id, status, progress_percentage, updated_at)
select p.id, l.id, 'not_started', 0, now()
from public.profiles p
join public.lessons l on true
join public.courses c on c.id = l.course_id
where c.is_default = true
  and c.title = 'AI Teacher Demo'
  and not exists (
    select 1
    from public.lesson_progress lp
    where lp.user_id = p.id and lp.lesson_id = l.id
  );

create index if not exists idx_profiles_username on public.profiles(username);
create index if not exists idx_courses_created_by on public.courses(created_by);
create index if not exists idx_lessons_course_id on public.lessons(course_id);
create index if not exists idx_user_courses_user_id on public.user_courses(user_id);
create index if not exists idx_lesson_progress_user_id on public.lesson_progress(user_id);
create index if not exists idx_lesson_progress_lesson_id on public.lesson_progress(lesson_id);
create index if not exists idx_assessments_user_id on public.assessments(user_id);
create index if not exists idx_learning_reports_user_id on public.learning_reports(user_id);
create index if not exists idx_materials_user_id on public.materials(user_id);
