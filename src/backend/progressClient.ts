import type { SupabaseClient } from '@supabase/supabase-js';
import { parseServerProgress, type GoalChoice, type ServerEnrollment, type ServerProgress } from '../progress';

/** The signed-in ring, goal, and charts. Computed on the server at call time. */
export async function fetchMyProgress(client: SupabaseClient): Promise<ServerProgress> {
  const { data, error } = await client.rpc('my_progress');
  if (error) throw new Error(error.message);
  const doc = parseServerProgress(data);
  if (!doc) throw new Error('Progress came back in an unexpected shape.');
  return doc;
}

/** Close or update today's enrollment. The server decides the calendar day. */
export async function enrollGoal(client: SupabaseClient, choice: GoalChoice): Promise<ServerEnrollment | null> {
  const p = 'programId' in choice ? { programId: choice.programId } : { customDailyReps: choice.customDailyReps };
  const { data, error } = await client.rpc('enroll_goal', { p });
  if (error) throw new Error(error.message);
  const doc = data && typeof data === 'object' ? (data as ServerEnrollment) : null;
  return doc && typeof doc.id === 'string' ? doc : null;
}
