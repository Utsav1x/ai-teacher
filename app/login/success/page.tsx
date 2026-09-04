'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

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

export default function LoginSuccessPage() {
  return (
    <Suspense fallback={null}>
      <LoginSuccessContent />
    </Suspense>
  )
}

function LoginSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isSigningOut = searchParams.get('mode') === 'logout'
  const nextPath = searchParams.get('next') || (isSigningOut ? '/login?logged_out=1' : '/dashboard')

  useEffect(() => {
    const t = setTimeout(() => router.replace(nextPath), 2400)
    return () => clearTimeout(t)
  }, [nextPath, router])

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#0b0f1a]">
      <CircuitBackground />

      {/* Glow blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[10%] top-[20%]    h-72 w-72 rounded-full bg-blue-600/10      blur-[80px]" />
        <div className="absolute bottom-[15%] right-[8%] h-60 w-60 rounded-full bg-cyan-500/[.08]  blur-[70px]" />
      </div>

      {/* Success content */}
      <div className="relative z-10 flex flex-col items-center gap-5 anim-fade-up">
        {/* Checkmark */}
        <svg className="check-svg" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle className="check-circle" cx="26" cy="26" r="25" fill="none" />
          <path   className="check-mark"   fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>

        <h2 className="text-2xl font-bold text-white">{isSigningOut ? 'Signed out!' : 'Success!'}</h2>
        <p className="text-sm text-white/50">
          {isSigningOut ? 'Successfully signed out of ' : 'Successfully logged into '}
          <span className="font-semibold text-white/80">Lumina</span>
        </p>
        <p className="animate-pulse text-xs text-white/30">
          {isSigningOut ? 'Returning to login…' : 'Redirecting…'}
        </p>
      </div>

      <style>{`
        /* Whole block fades + rises in */
        @keyframes kFadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .anim-fade-up {
          animation: kFadeUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* SVG size */
        .check-svg {
          width: 110px;
          height: 110px;
          display: block;
          overflow: visible;
        }

        /* 1 — Circle draws itself */
        .check-circle {
          stroke: #22c55e;
          stroke-width: 2;
          stroke-dasharray: 166;
          stroke-dashoffset: 166;
          stroke-miterlimit: 10;
          animation: kStrokeCircle 0.7s cubic-bezier(0.65, 0, 0.45, 1) 0.15s forwards;
        }
        @keyframes kStrokeCircle { 100% { stroke-dashoffset: 0; } }

        /* 2 — Tick draws itself after circle finishes */
        .check-mark {
          stroke: #22c55e;
          stroke-width: 3;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 48;
          stroke-dashoffset: 48;
          animation: kStrokeTick 0.45s cubic-bezier(0.65, 0, 0.45, 1) 0.85s forwards;
        }
        @keyframes kStrokeTick { 100% { stroke-dashoffset: 0; } }

        /* 3 — Subtle bounce once tick is done */
        @keyframes kBounce {
          0%, 100% { transform: scale(1);    }
          40%       { transform: scale(1.1);  }
          70%       { transform: scale(0.96); }
        }
        .check-svg {
          animation: kBounce 0.38s cubic-bezier(0.36, 0.07, 0.19, 0.97) 1.3s both;
        }
      `}</style>
    </div>
  )
}
