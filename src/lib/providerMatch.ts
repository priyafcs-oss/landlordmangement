import { findProvider } from "../../supabase/functions/_shared/providerMatch.ts";

// The provider-matching rule shared with the edge functions — one copy (see that file).
export {
  findProvider,
  namesLooselyMatch,
  rowBelongsToProvider,
} from "../../supabase/functions/_shared/providerMatch.ts";

/** The existing provider a vendor name (and ABN, when known) refers to — see findProvider. */
export function matchProviderByName<T extends { name: string; abn?: string | null }>(
  providers: T[],
  name: string,
  abn?: string | null,
): T | undefined {
  return findProvider(providers, name, abn);
}
