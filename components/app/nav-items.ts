import {
  Home,
  Sparkles,
  Library,
  FileQuestion,
  BarChart3,
  Waypoints,
  Settings,
  WandSparkles,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: typeof Home
}

export const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Learn',
    items: [
      { label: 'Home',           href: '/dashboard',  icon: Home      },
      { label: 'Start Learning', href: '/start',       icon: Sparkles  },
      { label: 'Materials',      href: '/materials',   icon: Library   },
      { label: 'Feature Studio', href: '/features',    icon: WandSparkles },
    ],
  },
  {
    title: 'Progress',
    items: [
      { label: 'Assessment',     href: '/progress/assessment', icon: FileQuestion },
      { label: 'Learning Report',href: '/progress/report',     icon: BarChart3    },
      { label: 'Learning Path',  href: '/progress/path',       icon: Waypoints    },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]
