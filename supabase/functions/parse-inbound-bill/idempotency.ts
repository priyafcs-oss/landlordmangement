import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * True when an insert failed only because a concurrent invocation (a Svix webhook retry racing
 * against itself — both pass the emailMessageId idempotency SELECT before either has inserted)
 * already inserted a row with the same emailMessageId first — not a real failure, just this
 * attempt losing that race. Postgres unique_violation is error code 23505.
 */
export function isDuplicateEmailMessageId(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "23505" && /emailmessageid/i.test(error.message ?? "");
}

/**
 * Re-fetches the row a losing race actually collided with, so the loser can report the SAME
 * success the winner got (e.g. `{ ok: true, billId }`) instead of a raw duplicate-key error —
 * the email genuinely was processed, just by the other concurrent attempt.
 */
export async function findByEmailMessageId(
  supabase: SupabaseClient,
  table: string,
  emailMessageId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase.from(table).select("id").eq("emailMessageId", emailMessageId).maybeSingle();
  return data;
}
