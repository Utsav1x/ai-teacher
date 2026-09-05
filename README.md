# Lumina

An AI teacher that learns from your material, explains it aloud in your language, checks whether you understood, and adapts when you didn't.

Built for the **Bharat Academix AI Innovation Hackathon 2026**.

Upload a PDF, DOCX, PPTX or text file — or just name a topic — and Lumina builds a lesson grounded in that material, teaches it in a live classroom with a speaking avatar, asks questions at checkpoints, diagnoses the misconception behind a wrong answer, and adjusts what comes next.

---

## Demo

<!-- Replace with the walkthrough link before submitting -->
**Video walkthrough:** _add link here_

**Live app:** run locally — see [Quick start](#quick-start).

---

## What it does

| Capability | How it works |
|---|---|
| **Learns from your material** | PDF / DOCX / PPTX / TXT are parsed, cleaned, chunked and embedded. Lessons are generated from retrieved passages, not from the model's own memory. |
| **Teaches, rather than prints** | A live classroom with a speaking avatar, lip-synced narration, section-by-section pacing, and a transcript. |
| **Adapts to the learner** | Graded checkpoints through the lesson. Difficulty moves with performance, wrong answers are traced to a named misconception, and weak concepts are carried into the next lesson's prompt. |
| **Speaks 19 languages** | Neural voices for English, Hindi, Bengali, Gujarati, Kannada, Malayalam, Marathi, Tamil, Telugu, Urdu and nine more — server-side, so nothing depends on what the viewer's OS has installed. Language can be switched mid-lesson without losing your place. |
| **Answers questions** | Ask the teacher anything mid-lesson; answers are grounded in the same retrieved material. |
| **Produces video** | Export the lesson as an MP4 with narration and a lip-synced avatar, entirely in-browser. An optional D-ID integration renders a photorealistic presenter instead. |
| **Reports on progress** | Mastery per concept, strengths and weak areas, a learning path, and a next-step recommendation — all from real answer data. |

---

## How it works

```
Upload  ─▶  parse ─▶ clean ─▶ chunk ─▶ embed ─▶ pgvector
                                                    │
Topic   ─────────────────────────────────────▶  retrieve
                                                    │
                                                    ▼
                                          lesson generation (Gemini)
                                                    │
                    ┌───────────────────────────────┼───────────────────────────┐
                    ▼                               ▼                           ▼
              classroom UI                  neural TTS + visemes          video export
           (adaptive checkpoints)          (Edge TTS, 19 locales)      (MediaRecorder / D-ID)
                    │
                    ▼
          answer evaluation ─▶ misconception ─▶ difficulty adjustment ─▶ progress + report
```

**Retrieval.** Documents are chunked and embedded with `gemini-embedding-001` at 768 dimensions, stored in a pgvector column, and searched through a `match_material_chunks` SQL function using cosine distance. Lesson generation and the Ask-the-teacher endpoint both read from those retrieved passages.

**Quota resilience.** Gemini's free tier meters some models as low as 20 requests per day, per model. Requests walk a fallback chain of six models and retry transient failures with backoff, so an exhausted daily allowance degrades to a different model instead of a broken lesson.

**Narration.** Text-to-speech runs server-side over Microsoft Edge's neural voices — no API key, no quota — with Gemini TTS behind it as a fallback and the browser's Web Speech API behind that. Mouth shapes are derived per word from a six-viseme set with mappings for both Latin and Devanagari script, and timed against the real audio duration.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.3 (App Router, Turbopack), React 19, TypeScript 5.7 |
| Styling | Tailwind CSS v4, shadcn/ui, Base UI |
| Database | Supabase — Postgres, pgvector, Row-Level Security |
| Auth | Supabase Auth (email/password, Google, GitHub) |
| Storage | Supabase Storage for uploaded material |
| LLM | Google Gemini (`gemini-3.5-flash` by default, with a fallback chain) |
| Embeddings | `gemini-embedding-001`, 768 dimensions |
| Speech | `msedge-tts` neural voices, Gemini TTS fallback |
| Documents | `pdf-parse`, `mammoth` (DOCX), `adm-zip` (PPTX) |
| Video | MediaRecorder + Canvas; optional D-ID for a photorealistic presenter |

---

## Quick start

**Prerequisites:** Node.js 20+, pnpm, a Supabase project, and a Google AI Studio API key (free).

```bash
git clone https://github.com/Utsav1x/ai-teacher.git
cd ai-teacher
pnpm install
```

Copy the environment template and fill it in:

```bash
cp .env.example .env.local
```

You need at minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_AI_API_KEY`, and `NEXT_PUBLIC_USE_REAL_AI_TEACHER=true`. Every field is documented inline in `.env.example`.

> Without `NEXT_PUBLIC_USE_REAL_AI_TEACHER=true` the app serves hardcoded demo lessons with no error, whatever topic you type.

Run the seven migrations in `supabase/migrations/` **in filename order** through the Supabase SQL editor — `20260831_create_application_schema.sql` first. Full instructions and a verification query are in [docs/setup.md](docs/setup.md).

```bash
pnpm dev
```

Open <http://localhost:3000>.

**Windows note:** don't put the project inside a OneDrive-synced folder. File syncing interferes with Turbopack's watcher.

---

## Project structure

```
app/
  (app)/            classroom, dashboard, materials, progress, settings
  api/teacher/      lesson generation, answer evaluation, ask, speak,
                    translate, generate-video, video-status
  api/materials/    upload and document processing
  api/progress/     lesson, assessment and path persistence
lib/
  ai/
    document-processing/   parsers (PDF, DOCX, PPTX, TXT), cleaner, chunker
    rag/                   chunker, embedder, retriever
    teacher/               lesson generator, answer evaluator, prompts, translation
    providers/             Gemini provider with model fallback and retry
  speech/           TTS hook, viseme mapping, locale → voice tables
  video/            scene planner, frame renderer, recorder, D-ID provider
supabase/migrations/       seven SQL migrations, applied in filename order
docs/                      setup, architecture, database, authentication, video pipeline
```

---

## Documentation

| Document | Covers |
|---|---|
| [docs/setup.md](docs/setup.md) | Environment, migrations, verification |
| [docs/architecture.md](docs/architecture.md) | System design and data flow |
| [docs/database.md](docs/database.md) | Schema, tables, RLS policies |
| [docs/authentication.md](docs/authentication.md) | Auth flows and session handling |
| [docs/video-generation-pipeline.md](docs/video-generation-pipeline.md) | Scene planning and video rendering |
| `project_documentation.html` | Full written report |

---

## Optional: photorealistic video

The classroom's video export works out of the box with no configuration. To use D-ID's photorealistic presenter instead, add a `DID_API_KEY` to `.env.local` and restart. Without it, that panel simply reports it isn't configured and the built-in export continues to work.

D-ID is metered per clip, and each lesson submits up to six.

---

## Team

- **Utsav Golani** — [@Utsav1x](https://github.com/Utsav1x)
- **Ayush Kushwaha** — [@Ayushk1248](https://github.com/Ayushk1248)
- **Janhavi Khadse**
