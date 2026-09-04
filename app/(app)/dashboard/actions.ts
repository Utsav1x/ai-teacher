'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateWeeklyGoal(minutes: number) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: 'No connection' }

  const { error } = await supabase.auth.updateUser({
    data: { weekly_goal_minutes: minutes }
  })

  if (error) return { error: error.message }
  
  revalidatePath('/dashboard')
  return { success: true }
}
