'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LogOut, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/logo'
import { LinkButton } from '@/components/ui/link-button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { navSections } from '@/components/app/nav-items'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function UserCard() {
  const [user, setUser] = useState<{ name?: string; email?: string; image?: string } | null>(null)
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return

    supabase.auth.getUser().then(({ data }) => {
      const sessionUser = data.user
      setUser({
        name: sessionUser?.user_metadata?.full_name || sessionUser?.email?.split('@')[0] || 'User',
        email: sessionUser?.email || '',
        image: sessionUser?.user_metadata?.avatar_url || undefined,
      })
    })
  }, [])

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?'

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
      {user?.image ? (
        <Image
          src={user.image}
          alt={user.name ?? 'User avatar'}
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
          {initials}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user?.name ?? 'Loading…'}</p>
        <p className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</p>
      </div>
      <button
        type="button"
        aria-label="Sign out"
        onClick={() => setIsConfirmingLogout(true)}
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="size-4" />
      </button>

      {isConfirmingLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm border-border/80 bg-[#111827]/95 p-0 shadow-2xl">
            <div className="p-6">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Confirm sign out
              </p>
              <h3 className="mt-3 text-2xl font-semibold text-foreground">Are you sure?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                You will be signed out and returned to the home page.
              </p>

              <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" size="sm" onClick={() => setIsConfirmingLogout(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setIsConfirmingLogout(false)
                    const supabase = createSupabaseBrowserClient()
                    if (!supabase) {
                      window.location.href = '/'
                      return
                    }

                    supabase.auth.signOut().then(() => {
                      window.location.href = '/login/success?mode=logout'
                    })
                  }}
                >
                  Log out
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-2">
        <Logo />
      </div>

      <LinkButton
        href="/start"
        onClick={onNavigate}
        className="w-full justify-center gap-2 bg-gradient-to-r from-primary to-accent py-2 text-primary-foreground"
      >
        <Sparkles className="size-4" />
        Start New Lesson
      </LinkButton>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-primary/15 text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 transition-colors',
                          active
                            ? 'text-primary'
                            : 'text-muted-foreground group-hover:text-foreground',
                        )}
                      />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <UserCard />
    </div>
  )
}

export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-border/60 bg-sidebar/60 backdrop-blur-xl lg:block">
      <SidebarContent />
    </aside>
  )
}
