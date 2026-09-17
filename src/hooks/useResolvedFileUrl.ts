import { useEffect, useState } from "react";
import { getSignedDocumentUrl } from "@/lib/files";

/**
 * Resolves a stored file value — a legacy inline `data:` URL (used as-is, no network round trip)
 * or a "storage:<path>" marker (src/lib/files.ts) — to a URL usable directly in `<img src>` or
 * `<a href>`. Returns undefined while a storage-backed value's signed URL is still loading.
 */
export function useResolvedFileUrl(value: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(value && !value.startsWith("storage:") ? value : undefined);

  useEffect(() => {
    if (!value || !value.startsWith("storage:")) {
      setUrl(value);
      return;
    }
    let cancelled = false;
    getSignedDocumentUrl(value).then((signed) => {
      if (!cancelled) setUrl(signed ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return url;
}
