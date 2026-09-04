# Setup Guide

## Prerequisites

- Node.js 18+ (developed on 24)
- pnpm — `npm install -g pnpm`
- A Supabase project (free tier is enough)
- A Google AI Studio API key (free, no card)

> **Do not clone into a OneDrive, Dropbox, or iCloud folder.** Turbopack writes
> thousands of small files into `.next`, and cloud sync clients intercept those
> writes. The dev server crashes with `The cloud file provider exited
> unexpectedly`, surfacing as a bare Internal Server Error. Use a plain local
> path such as `C:\dev\ai-teacher`.

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

| Variable | Where to find it | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` | Yes — uploads and indexing |
| `GOOGLE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key | Yes |
| `NEXT_PUBLIC_USE_REAL_AI_TEACHER` | Set to `true` | Yes |
| `GEMINI_MODEL` | Optional override, e.g. `gemini-3.5-flash` | No |

**`NEXT_PUBLIC_USE_REAL_AI_TEACHER` is not optional in practice.** Without it the
app falls back to `MockTeacherEngine` and serves hardcoded lessons with no error.

`.env.local` is gitignored. Never commit the service-role key — it bypasses
row-level security.

## 3. Run the migrations

Supabase Dashboard → **SQL Editor** → run each file in `supabase/migrations/`
**in filename order**:

1. `20260831_create_application_schema.sql` — core tables, RLS, seed data
2. `20260831_lesson_progress_persistence.sql` — progress columns
3. `20260831_assessment_results.sql` — assessment results
4. `20260831_materials_storage.sql` — materials table + storage bucket
5. `20260902_rag_embeddings.sql` — pgvector, `material_chunks`, `match_material_chunks`
6. `20260903_document_processing.sql` — processing status and chunk metadata
7. `20260904_seed_demo_learning_path.sql` — `learning_activity` + demo course

Files 5 and 6 are easy to miss and fail **silently**: retrieval returns zero
chunks while lessons still generate, so the teacher quietly stops being grounded
in uploaded documents. File 7 is required by the dashboard.

Verify with:

```sql
select
  to_regclass('public.material_chunks')     is not null as chunks,
  to_regclass('public.learning_activity')   is not null as activity,
  exists(select 1 from pg_proc
         where proname='match_material_chunks')          as rpc,
  exists(select 1 from information_schema.columns
         where table_name='materials'
           and column_name='processing_status')          as doc_processing;
```

All four must be `true`.

## 4. Configure OAuth (optional)

Supabase → **Authentication → Providers**. Enable Google and/or GitHub with a
callback of `https://<project>.supabase.co/auth/v1/callback`. Email and password
sign-up works without this.

## 5. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## 6. Verify the AI layer

Sign up, then in DevTools → Console:

```js
await (await fetch('/api/teacher/generate-lesson', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: 'Photosynthesis',
    preferences: {
      level: 'Beginner', language: 'Hindi',
      goal: 'General curiosity', timeMinutes: 20
    }
  })
})).json()
```

A `{ lesson: … }` object in Hindi confirms the key, model, prompt contract and
JSON parsing all work.

| Response | Meaning |
|---|---|
| `401` | Not signed in |
| `503` | `GOOGLE_AI_API_KEY` missing — restart after editing `.env.local` |
| `404` | Model name not available to your key — set `GEMINI_MODEL` |
| `429` | Daily free-tier quota spent for that model; the provider falls through a model chain |

## 7. Build for production

```bash
pnpm build
pnpm start
```

## Notes

- `next.config.mjs` sets `typescript.ignoreBuildErrors: true`, so a successful
  build does **not** mean the types are clean. Run `pnpm exec tsc --noEmit`.
- Free-tier Gemini quota is granted **per model per day** and is small — 20
  requests/day on some models. The provider walks a fallback chain when one is
  exhausted.
- Narration uses Microsoft Edge neural voices, which need no key and have no
  quota. Gemini TTS is the fallback.
