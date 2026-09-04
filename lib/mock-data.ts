/**
 * Static landing-page copy.
 *
 * This file once held stand-in data for the whole app — dashboard figures,
 * lesson content, quiz questions, chat threads. All of that now comes from
 * Supabase or the AI engine, and those exports have been removed so nothing can
 * accidentally render a fabricated number again.
 *
 * What remains is genuine static content: the marketing copy on the public
 * landing page, which describes the product rather than standing in for data.
 */

import {
  BookOpen,
  Brain,
  FlaskConical,
  LineChart,
  Sparkles,
  Waypoints,
} from 'lucide-react'

export type Feature = {
  title: string
  description: string
  icon: typeof Brain
}

export const features: Feature[] = [
  {
    title: 'Learns from your material',
    description:
      'Upload a PDF, DOCX, PPTX, or text file — or just name a topic — and Lumina builds a structured curriculum around it.',
    icon: BookOpen,
  },
  {
    title: 'Personalized to you',
    description:
      'Set your level, language, pace, and preferred teaching style. Every lesson adapts to how you learn best.',
    icon: Sparkles,
  },
  {
    title: 'A live AI classroom',
    description:
      'Sit in an interactive session with an AI teacher that explains aloud, checks understanding, and answers questions.',
    icon: Brain,
  },
  {
    title: 'Assessments that adapt',
    description:
      'Graded checkpoints get harder or easier as you go, and name the specific misconception behind a wrong answer.',
    icon: FlaskConical,
  },
  {
    title: 'Clear progress reports',
    description:
      'See strong and weak areas, mastery over time, and concrete next steps after every session.',
    icon: LineChart,
  },
  {
    title: 'A guided learning path',
    description:
      'A visual roadmap connects every concept so you always know what to learn next and why.',
    icon: Waypoints,
  },
]

export const howItWorks = [
  {
    step: '01',
    title: 'Add your material',
    description: 'Drop in a document or pick a topic. Lumina reads and organizes it for you.',
  },
  {
    step: '02',
    title: 'Personalize the plan',
    description: 'Choose level, language, pace, and style. We generate a tailored lesson plan.',
  },
  {
    step: '03',
    title: 'Learn in the AI classroom',
    description: 'Attend guided sessions, ask anything, and take quick adaptive checks.',
  },
  {
    step: '04',
    title: 'Review your report',
    description: 'Get a clear breakdown of mastery and a roadmap for what to learn next.',
  },
]
