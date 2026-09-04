'use client'

import { useMemo, useState } from 'react'
import {
  AudioLines,
  BookOpenCheck,
  BrainCircuit,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileAudio,
  FileText,
  FlaskConical,
  Gamepad2,
  GitBranch,
  ImageUp,
  Languages,
  ListChecks,
  MessageCircleQuestion,
  Network,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/app/page-header'

const features = [
  { title: 'Socratic AI Mode', group: 'Classroom', description: 'Learn through carefully sequenced questions that make you reason before revealing the answer.', icon: MessageCircleQuestion, href: '/classroom', action: 'Open classroom' },
  { title: 'Voice Classroom', group: 'Classroom', description: 'Listen, pause, replay, and control narration speed while Maya teaches in your chosen language.', icon: Volume2, href: '/classroom', action: 'Open classroom' },
  { title: 'Adaptive Difficulty', group: 'Classroom', description: 'Checkpoint difficulty responds to each answer, moving between warm-up, core, and application questions.', icon: BrainCircuit, href: '/classroom', action: 'Try adaptive lesson' },
  { title: 'Teach-Back Mode', group: 'Practice', description: 'Explain a concept in your own words and receive a clarity, accuracy, and gap analysis.', icon: AudioLines, href: '/classroom', action: 'Practice teach-back' },
  { title: 'Mistake Journal', group: 'Practice', description: 'Turn repeated mistakes into a focused review queue with the exact concept to revisit.', icon: RotateCcw, href: '/progress/report', action: 'View review report' },
  { title: 'Spaced Repetition', group: 'Practice', description: 'Keep important concepts fresh with reviews scheduled around your recall strength.', icon: CalendarClock, href: '/progress/path', action: 'View learning path' },
  { title: 'Document-to-Course', group: 'Create', description: 'Upload PDF, DOCX, PPTX, TXT, or Markdown and turn source material into a guided course.', icon: FileText, href: '/start', action: 'Upload material' },
  { title: 'Visual Concept Maps', group: 'Create', description: 'See the relationships between lessons, prerequisites, and mastered concepts at a glance.', icon: Network, href: '/progress/path', action: 'Explore concept path' },
  { title: 'Image and Whiteboard Understanding', group: 'Create', description: 'Bring handwritten notes, diagrams, and screenshots into the learning conversation.', icon: ImageUp, href: '/start', action: 'Add visual material' },
  { title: 'Source-Verified Answers', group: 'Create', description: 'Keep explanations grounded in your uploaded material and the source context behind each answer.', icon: ShieldCheck, href: '/materials', action: 'View materials' },
  { title: 'AI Study Planner', group: 'Plan', description: 'Shape a realistic study rhythm around your deadline, available time, and current mastery.', icon: CalendarClock, href: '/progress/path', action: 'Plan a study week' },
  { title: 'Exam Simulation', group: 'Plan', description: 'Test yourself under time pressure with targeted questions and a detailed post-exam breakdown.', icon: ClipboardCheck, href: '/progress/assessment', action: 'Start assessment' },
  { title: 'Real-World Projects', group: 'Plan', description: 'Turn a concept into an applied project, case study, experiment, or practical assignment.', icon: FlaskConical, href: '/start', action: 'Create a project lesson' },
  { title: 'Multiple Teacher Styles', group: 'Personalize', description: 'Switch between patient tutor, exam coach, visual explainer, strict mentor, and Socratic guide.', icon: Users, href: '/setup-profile', action: 'Personalize teacher' },
  { title: 'Multilingual Learning', group: 'Personalize', description: 'Learn and hear lessons in the language that helps the idea click fastest.', icon: Languages, href: '/start', action: 'Choose a language' },
  { title: 'Learning Replay', group: 'Progress', description: 'Revisit the lesson summary, questions, weak areas, and recommended next step.', icon: Play, href: '/progress/report', action: 'Open report' },
  { title: 'Personal Knowledge Graph', group: 'Progress', description: 'Track concepts as mastered, developing, or needing attention across every lesson.', icon: GitBranch, href: '/progress/report', action: 'View mastery' },
  { title: 'Progress RPG', group: 'Progress', description: 'Make the path visible with skill levels, milestones, streaks, and unlockable challenges.', icon: Gamepad2, href: '/progress/path', action: 'Open learning path' },
  { title: 'Collaborative Study Rooms', group: 'Together', description: 'Study with others while the AI moderates discussion, questions, and shared understanding.', icon: Users, href: '/dashboard', action: 'Invite study partners' },
  { title: 'Offline Study Packs', group: 'Together', description: 'Package lessons, questions, and review notes for focused study away from the network.', icon: FileAudio, href: '/materials', action: 'Build a study pack' },
]

const groups = ['All', 'Classroom', 'Practice', 'Create', 'Plan', 'Personalize', 'Progress', 'Together']

export default function FeaturesPage() {
  const [selectedGroup, setSelectedGroup] = useState('All')
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<string[]>([])

  const visibleFeatures = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return features.filter((feature) => {
      const matchesGroup = selectedGroup === 'All' || feature.group === selectedGroup
      const matchesQuery = !normalized || `${feature.title} ${feature.description}`.toLowerCase().includes(normalized)
      return matchesGroup && matchesQuery
    })
  }, [query, selectedGroup])

  function toggleFeature(title: string) {
    setEnabled((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title])
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Feature studio"
        title="Your learning system, expanded"
        description="Explore every way Lumina can help you understand, practice, and remember more."
        actions={
          <LinkButton
            href="/start"
            size="lg"
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent text-primary-foreground"
          >
            <Sparkles className="size-4" />
            Start a lesson
          </LinkButton>
        }
      />

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-card to-accent/10 p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <Badge className="mb-4 gap-1.5"><BookOpenCheck className="size-3.5" />20 learning instruments</Badge>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">Build a study practice that feels like yours.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Turn on the tools that fit your next goal. Existing tools open directly; new modes are ready to become part of your lesson flow.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/40 p-3"><p className="text-xl font-semibold">{enabled.length}</p><p className="text-xs text-muted-foreground">Active tools</p></div>
            <div className="rounded-2xl border border-border/70 bg-background/40 p-3"><p className="text-xl font-semibold">{features.length}</p><p className="text-xs text-muted-foreground">Available</p></div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Feature categories">
          {groups.map((group) => (
            <button key={group} type="button" role="tab" aria-selected={selectedGroup === group} onClick={() => setSelectedGroup(group)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', selectedGroup === group ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
              {group}
            </button>
          ))}
        </div>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground lg:w-64">
          <Search className="size-4" />
          <span className="sr-only">Search features</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
        </label>
      </div>

      <section aria-label="Learning features" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleFeatures.map((feature) => {
          const Icon = feature.icon
          const isEnabled = enabled.includes(feature.title)
          return (
            <Card key={feature.title} className={cn('group transition-all hover:-translate-y-0.5 hover:border-primary/40', isEnabled && 'border-primary/50 bg-primary/[0.04]')}>
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <Badge variant="outline">{feature.group}</Badge>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
                  <button type="button" onClick={() => toggleFeature(feature.title)} className={cn('inline-flex items-center gap-1.5 text-xs font-medium transition-colors', isEnabled ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
                    <span className={cn('grid size-4 place-items-center rounded border', isEnabled ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                      {isEnabled && <Check className="size-3" />}
                    </span>
                    {isEnabled ? 'Active' : 'Add tool'}
                  </button>
                  <LinkButton
                    href={feature.href}
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                  >
                    {feature.action}
                    <ChevronRight className="size-3.5" />
                  </LinkButton>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {visibleFeatures.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No tools match that search.</div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground"><ListChecks className="size-4 text-primary" />Your selected tools are saved for this session.</div>
    </div>
  )
}
