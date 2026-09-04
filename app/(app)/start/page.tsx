'use client'

import { useState, useRef, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  ArrowLeft,
  FileText,
  Sparkles,
  UploadCloud,
  X,
  Lightbulb,
  Play,
  ChevronDown,
  Check,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/app/page-header'

// ─── Suggested topics ────────────────────────────────────────────────────────
const suggestedTopics = [
  'Introduction to Quantum Computing',
  'The French Revolution',
  'Linear Algebra Essentials',
  'How the Immune System Works',
  'Financial Statements 101',
]

// ─── Chip option sets ─────────────────────────────────────────────────────────
const LEVELS   = ['Beginner', 'Intermediate', 'Advanced']
const LANGUAGES = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Mandarin']
const TIMES    = ['10 min', '20 min', '40 min']
const GOALS    = ['General curiosity', 'Pass an exam', 'Apply at work', 'Refresh memory']

// ─── Naive auto-detect from prompt ───────────────────────────────────────────
function detectSettings(prompt: string) {
  const p = prompt.toLowerCase()
  const level =
    p.includes('beginner') || p.includes('basic') || p.includes('intro') ? 'Beginner'
    : p.includes('advanced') || p.includes('deep') || p.includes('expert') ? 'Advanced'
    : 'Intermediate'
  const time =
    p.includes('quick') || p.includes('brief') || p.includes('short') ? '10 min'
    : p.includes('deep') || p.includes('thorough') || p.includes('detail') ? '40 min'
    : '20 min'
  const goal =
    p.includes('exam') || p.includes('test') || p.includes('quiz') ? 'Pass an exam'
    : p.includes('work') || p.includes('job') || p.includes('practical') ? 'Apply at work'
    : p.includes('refresh') || p.includes('review') || p.includes('remind') ? 'Refresh memory'
    : 'General curiosity'
  return { level, language: 'English', time, goal }
}

// ─── Single-select chip row ───────────────────────────────────────────────────
function ChipRow({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
              active
                ? 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_0_1px_oklch(0.62_0.19_258_/_0.25)]'
                : 'border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {active && <Check className="size-3 shrink-0" />}
            {opt}
          </button>
        )
      })}
    </div>
  )
}

// ─── Collapsible chip field ───────────────────────────────────────────────────
function ChipField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between text-left"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {value}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>
      {open && (
        <div className="pt-1">
          <ChipRow options={options} value={value} onChange={(v) => { onChange(v); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Step = 'input' | 'confirm'

type UploadedFile = {
  name: string
  /** uploading → stored in Supabase; indexing → parsed, chunked and embedded. */
  status: 'uploading' | 'indexing' | 'ready' | 'error'
  /** Set once the file exists in the `materials` table. Scopes RAG retrieval. */
  materialId?: string
  /** Chunks that received an embedding — retrieval ignores any without one. */
  chunks?: number
  error?: string
}

export default function StartLearningPage() {
  const router  = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // Step 1 state
  const [step,     setStep]     = useState<Step>('input')
  const [dragging, setDragging] = useState(false)
  const [files,    setFiles]    = useState<UploadedFile[]>([])
  const [topic,    setTopic]    = useState('')

  // Step 2 state — auto-detected, user-editable
  const [level,    setLevel]    = useState('Intermediate')
  const [language, setLanguage] = useState('English')
  const [time,     setTime]     = useState('20 min')
  const [goal,     setGoal]     = useState('General curiosity')

  // ── file helpers ──
  /**
   * Uploads each file, then indexes it. Both steps are required before the
   * lesson generator can retrieve anything: `/api/materials` only stores the
   * file, and retrieval ignores chunks that have no embedding.
   */
  async function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)

    // Show every file immediately so the upload does not look frozen.
    const startIndex = files.length
    setFiles((prev) => [
      ...prev,
      ...incoming.map((f) => ({ name: f.name, status: 'uploading' as const })),
    ])

    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i]!
      const slot = startIndex + i

      const patch = (update: Partial<UploadedFile>) =>
        setFiles((prev) => prev.map((f, idx) => (idx === slot ? { ...f, ...update } : f)))

      try {
        const form = new FormData()
        form.append('file', file)

        const uploadRes = await fetch('/api/materials', { method: 'POST', body: form })
        const uploadData = await uploadRes.json()

        if (!uploadRes.ok) {
          patch({ status: 'error', error: uploadData?.error ?? 'Upload failed' })
          continue
        }

        const materialId = uploadData?.material?.id as string | undefined
        if (!materialId) {
          patch({ status: 'error', error: 'Upload returned no material id' })
          continue
        }

        patch({ status: 'indexing', materialId })

        const processRes = await fetch(`/api/materials/${materialId}/process`, { method: 'POST' })
        const processData = await processRes.json()

        if (!processRes.ok) {
          patch({
            status: 'error',
            error: processData?.details ?? processData?.error ?? 'Indexing failed',
          })
          continue
        }

        patch({ status: 'ready', chunks: processData?.result?.embeddedChunks ?? 0 })
      } catch (err) {
        patch({ status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    void addFiles(e.dataTransfer.files)
  }

  const readyFiles = files.filter((f) => f.status === 'ready')
  const busyFiles = files.some((f) => f.status === 'uploading' || f.status === 'indexing')
  const canContinue = (readyFiles.length > 0 || topic.trim().length > 0) && !busyFiles

  // ── step transition ──
  function handleContinue() {
    // Auto-detect settings from the prompt, then move to confirm step
    if (topic.trim()) {
      const detected = detectSettings(topic)
      setLevel(detected.level)
      setTime(detected.time)
      setGoal(detected.goal)
    }
    setStep('confirm')
  }

  function handleBack() {
    setStep('input')
  }

  // ── Step 1: Input ──────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="flex flex-col gap-8 step-enter">
        <PageHeader
          eyebrow="Start learning"
          title="What would you like to learn?"
          description="Upload your material or describe what you want to learn in your own words."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upload */}
          <Card>
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <UploadCloud className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Upload material</h2>
                  <p className="text-xs text-muted-foreground">PDF, DOCX, or PPTX up to 25 MB</p>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
                  dragging
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
                )}
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <UploadCloud className="size-6" />
                </span>
                <div>
                  <p className="text-sm font-medium">Drag &amp; drop your file, or click to browse</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your document stays private and is only used to build your lessons
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">PDF</Badge>
                  <Badge variant="secondary">DOCX</Badge>
                  <Badge variant="secondary">PPTX</Badge>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {files.map((file, i) => (
                    <li
                      key={`${file.name}-${i}`}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>

                        {file.status === 'uploading' && (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Uploading
                          </span>
                        )}
                        {file.status === 'indexing' && (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-primary">
                            <Loader2 className="size-3 animate-spin" />
                            Indexing
                          </span>
                        )}
                        {file.status === 'ready' && (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-success">
                            <CheckCircle2 className="size-3.5" />
                            {file.chunks ? `${file.chunks} chunks` : 'Indexed'}
                          </span>
                        )}
                        {file.status === 'error' && (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="size-3.5" />
                            Failed
                          </span>
                        )}

                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      </div>

                      {file.status === 'error' && file.error && (
                        <p className="pl-7 text-xs text-destructive/90">{file.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Topic + prompt */}
          <Card>
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                  <Sparkles className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Describe what you want to learn</h2>
                  <p className="text-xs text-muted-foreground">Write naturally — Lumina understands context</p>
                </div>
              </div>

              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Explain neural networks intuitively, I'm a beginner and have about 20 minutes…"
                className="min-h-36 flex-1 resize-none rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lightbulb className="size-3.5" />
                  Quick starters
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestedTopics.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className="rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col-reverse items-center justify-between gap-4 rounded-2xl border border-border bg-card/40 p-5 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Lumina will read your input and propose a lesson setup to confirm.
          </p>
          <Button
            size="lg"
            disabled={!canContinue}
            onClick={handleContinue}
            className="h-10 w-full gap-2 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground sm:w-auto"
          >
            Continue
            <ArrowRight className="size-4" />
          </Button>
        </div>

        <style>{`
          @keyframes stepEnter {
            from { opacity: 0; transform: translateX(-24px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          .step-enter { animation: stepEnter 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
        `}</style>
      </div>
    )
  }

  // ── Step 2: Confirm ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8 step-enter-right">
      <PageHeader
        eyebrow="Almost ready"
        title="Review your lesson setup"
        description="Lumina read your request and filled these in. Change anything or just start."
      />

      {/* The original prompt — primary, read-only display */}
      <Card className="border-primary/30">
        <CardContent className="flex flex-col gap-3 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your request
          </p>
          {readyFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {readyFiles.map((file) => (
                <span
                  key={file.materialId ?? file.name}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs"
                >
                  <FileText className="size-3.5 text-primary" />
                  {file.name}
                </span>
              ))}
            </div>
          )}
          {topic.trim() && (
            <p className="text-sm leading-relaxed text-foreground">
              &ldquo;{topic.trim()}&rdquo;
            </p>
          )}
          <button
            type="button"
            onClick={handleBack}
            className="self-start text-xs text-primary underline-offset-2 hover:underline"
          >
            Edit
          </button>
        </CardContent>
      </Card>

      {/* Editable chips — secondary */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Detected settings</p>
            <span className="text-xs text-muted-foreground">tap any to change</span>
          </div>

          <div className="flex flex-col gap-4 divide-y divide-border/60">
            <ChipField label="Level"     value={level}    options={LEVELS}    onChange={setLevel}    />
            <div className="pt-4">
              <ChipField label="Language"  value={language} options={LANGUAGES} onChange={setLanguage} />
            </div>
            <div className="pt-4">
              <ChipField label="Time"      value={time}     options={TIMES}     onChange={setTime}     />
            </div>
            <div className="pt-4">
              <ChipField label="Goal"      value={goal}     options={GOALS}     onChange={setGoal}     />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col-reverse items-center justify-between gap-4 rounded-2xl border border-border bg-card/40 p-5 sm:flex-row">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <Button
          size="lg"
          onClick={() => {
            // Persist session data for the classroom page
            const timeMinutes = parseInt(time) || 20
            const materialIds = readyFiles
              .map((f) => f.materialId)
              .filter((id): id is string => Boolean(id))

            const session = {
              topic:
                topic.trim() ||
                (readyFiles.length > 0
                  ? `The uploaded material: ${readyFiles.map((f) => f.name).join(', ')}`
                  : 'General Learning'),
              // Retrieval only runs when this is non-empty — see lesson-generator.ts.
              materialIds,
              preferences: {
                level,
                language,
                goal,
                timeMinutes,
              },
            }
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('lumina_lesson_session', JSON.stringify(session))
            }
            router.push('/lesson-plan')
          }}
          className="h-10 w-full gap-2 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground sm:w-auto"
        >
          <Play className="size-4" />
          Start Lesson
        </Button>
      </div>

      <style>{`
        @keyframes stepEnterRight {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .step-enter-right { animation: stepEnterRight 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes stepEnter {
          from { opacity: 0; transform: translateX(-24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .step-enter { animation: stepEnter 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
    </div>
  )
}
