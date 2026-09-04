'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsConfirmingLogout(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
      >
        <LogOut className="size-4" />
        Sign out
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
    </>
  )
}
