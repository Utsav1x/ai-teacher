'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Logo } from '@/components/logo'
import { signInWithEmail, signInWithOAuth } from '@/lib/auth/supabase-auth'

// ─── Circuit-board SVG background ────────────────────────────────────────────
function CircuitBackground() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id="circuit" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
          <line x1="0"   y1="20"  x2="40"  y2="20"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="80"  y1="20"  x2="120" y2="20"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="0"   y1="60"  x2="30"  y2="60"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="90"  y1="60"  x2="120" y2="60"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="0"   y1="100" x2="50"  y2="100" stroke="#7eb8f7" strokeWidth="1" />
          <line x1="70"  y1="100" x2="120" y2="100" stroke="#7eb8f7" strokeWidth="1" />
          <line x1="40"  y1="0"   x2="40"  y2="40"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="40"  y1="60"  x2="40"  y2="120" stroke="#7eb8f7" strokeWidth="1" />
          <line x1="80"  y1="0"   x2="80"  y2="20"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="80"  y1="60"  x2="80"  y2="100" stroke="#7eb8f7" strokeWidth="1" />
          <line x1="20"  y1="20"  x2="20"  y2="60"  stroke="#7eb8f7" strokeWidth="1" />
          <line x1="100" y1="60"  x2="100" y2="100" stroke="#7eb8f7" strokeWidth="1" />
          <circle cx="40"  cy="20"  r="2.5" fill="#7eb8f7" />
          <circle cx="80"  cy="20"  r="2.5" fill="#7eb8f7" />
          <circle cx="20"  cy="60"  r="2.5" fill="#7eb8f7" />
          <circle cx="100" cy="60"  r="2.5" fill="#7eb8f7" />
          <circle cx="40"  cy="100" r="2.5" fill="#7eb8f7" />
          <circle cx="80"  cy="100" r="2.5" fill="#7eb8f7" />
          <circle cx="40"  cy="60"  r="2.5" fill="#7eb8f7" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#circuit)" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  )
}

type LoadingProvider = 'google' | 'github' | null

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="relative flex min-h-svh items-center justify-center bg-[#0b0f1a]">
        <div className="size-8 animate-spin rounded-full border-4 border-white/20 border-t-cyan-400" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<LoadingProvider | 'email'>(null)
  const [error, setError] = useState(searchParams.get('error') || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const loggedOut = searchParams.get('logged_out') === '1'

  useEffect(() => {
    function restorePage() {
      setLoading(null)
    }

    window.addEventListener('pageshow', restorePage)
    return () => window.removeEventListener('pageshow', restorePage)
  }, [])

  async function handleSignIn(provider: 'google' | 'github') {
    setError('')
    setLoading(provider)

    try {
      const { error } = await signInWithOAuth(provider)
      if (error) {
        throw error
      }
    } catch {
      setLoading(null)
      setError('Something went wrong. Please try again.')
    }
  }

  async function handleEmailLogin() {
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.')
      return
    }

    setLoading('email')

    try {
      const { data, error } = await signInWithEmail(email.trim(), password)

      if (error) {
        throw error
      }

      if (data?.user) {
        router.push('/login/success')
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setError(/invalid login credentials/i.test(messageText) ? 'Invalid email or password.' : messageText)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#0b0f1a]">
      <CircuitBackground />

      {/* Glow blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[10%] top-[20%]    h-72 w-72 rounded-full bg-blue-600/10      blur-[80px]" />
        <div className="absolute bottom-[15%] right-[8%] h-60 w-60 rounded-full bg-cyan-500/[.08]  blur-[70px]" />
      </div>

      {/* ── Login card ── */}
      <div
        className="anim-slide-in-up relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 px-8 py-10 shadow-2xl backdrop-blur-xl"
      >
        <div className="mb-6 flex justify-center">
          <Logo href="/" />
        </div>

        {loggedOut && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
            Successfully logged out of Lumina
          </div>
        )}

        <h1 className="mb-2 text-center text-xl font-semibold text-white">
          {loggedOut ? 'See you again soon!' : 'Welcome 👋 Let&apos;s Get Started!'}
        </h1>
        <p className="mb-7 text-center text-sm text-white/40">
          {loggedOut ? 'Log back in when you are ready to continue.' : 'Sign in to continue to Lumina'}
        </p>

        {error && (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-center text-sm text-red-400">
            {error}
          </p>
        )}

        {/* Three main choices */}
        <div className="mb-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => handleSignIn('google')}
            disabled={loading !== null}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/15 bg-white/[.08] py-3 text-sm font-medium text-white/90 transition hover:bg-white/[.12] hover:border-white/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading === 'google' ? <Spinner /> : <GoogleIcon />}
            Continue with Google
          </button>

          <button
            type="button"
            onClick={() => handleSignIn('github')}
            disabled={loading !== null}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/15 bg-white/[.08] py-3 text-sm font-medium text-white/90 transition hover:bg-white/[.12] hover:border-white/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading === 'github' ? <Spinner /> : <GitHubIcon />}
            Continue with GitHub
          </button>
        </div>

        {/* Email login section */}
        <div className="rounded-xl border border-white/10 bg-slate-950/20 p-4">
          <p className="mb-4 text-center text-sm font-medium text-white/60">Or continue with email</p>
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-400/50"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-400/50"
            />
            <button
              type="button"
              onClick={handleEmailLogin}
              disabled={loading !== null}
              className="flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 py-3 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
            >
              {loading === 'email' ? 'Logging in...' : 'Log In'}
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-center text-xs">
            <a href="#" className="text-cyan-400 hover:text-cyan-300 transition">
              Forgot Password?
            </a>
            <p className="text-white/40">
              Don't have an account?{' '}
              <a href="/signup" className="text-cyan-400 hover:text-cyan-300 transition">
                Sign Up
              </a>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes kSlideInUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .anim-slide-in-up {
          animation: kSlideInUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

      `}</style>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="size-5 animate-spin text-white/60" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  )
}
