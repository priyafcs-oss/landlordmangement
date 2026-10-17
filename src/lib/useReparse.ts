import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionErrorMessage } from "@/lib/files";
import { useStore } from "@/lib/store";

/**
 * Re-reads a staged proposal's document with a chosen parser (reparse-document) — "re-parse" on a
 * rent statement and "read as…" on an unclassified document both go through this. The function
 * deletes the original proposal server-side once its replacement is written, so this mirrors that
 * locally and pulls in just the new rows instead of re-fetching every table.
 */
export function useReparse(proposalId: string) {
  const { removeOne, refreshOne } = useStore();
  const [reparsing, setReparsing] = useState(false);

  const reparse = async (documentType: string, successMessage: string): Promise<boolean> => {
    setReparsing(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
        proposalId?: string;
        billId?: string;
      }>("reparse-document", { body: { proposalId, documentType } });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data?.ok) throw new Error(data?.error || "Couldn't read this document as that type");
      removeOne("aiProposals", proposalId);
      if (data.proposalId) await refreshOne("aiProposals", data.proposalId);
      if (data.billId) await refreshOne("bills", data.billId);
      toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read this document as that type");
      return false;
    } finally {
      setReparsing(false);
    }
  };

  return { reparse, reparsing };
}
