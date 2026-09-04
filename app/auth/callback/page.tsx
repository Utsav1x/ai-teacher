'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { handleOAuthCallback } from '@/lib/auth/supabase-auth'

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-svh items-center justify-center bg-[#0b0f1a] p-4">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-cyan-400 mx-auto" />
          <p className="text-sm text-white/60">Signing you in...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  )
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')
  const [isProcessing, setIsProcessing] = useState(true)

  useEffect(() => {
    processCallback()
  }, [])

  async function processCallback() {
    try {
      const result = await handleOAuthCallback()

      if (!result.success) {
        setError(result.error?.message || 'Authentication failed')
        // Redirect to login after showing error
        setTimeout(() => {
          router.push(`/login?error=${encodeURIComponent(result.error?.message || 'Authentication failed')}`)
        }, 2000)
        return
      }

      if (result.linkingMessage) {
        setError(result.linkingMessage)
      }

      // Show the success transition before continuing to setup or dashboard.
      router.replace(`/login/success?next=${encodeURIComponent(result.redirectUrl)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      setTimeout(() => {
        router.push(`/login?error=${encodeURIComponent(message)}`)
      }, 2000)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-[#0b0f1a] p-4">
      <div className="text-center">
        {isProcessing ? (
          <>
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-cyan-400 mx-auto" />
            <p className="text-sm text-white/60">Signing you in...</p>
          </>
        ) : error ? (
          <>
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 max-w-sm">
              <p className="font-medium">Authentication Error</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
            <p className="text-xs text-white/40 mt-4">Redirecting to login...</p>
          </>
        ) : (
          <>
            <div className="mb-4 text-lg text-cyan-400">✓</div>
            <p className="text-sm text-white/60">Redirecting...</p>
          </>
        )}
      </div>
    </div>
  )
}
