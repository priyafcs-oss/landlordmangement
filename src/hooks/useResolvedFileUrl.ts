import { useEffect, useRef, useState } from "react";
import { resolveDocumentUrl } from "@/lib/files";

const NEEDS_RESOLUTION_PREFIX = /^(storage:|gdrive:)/;

/**
 * Resolves a stored file value — a legacy inline `data:` URL (used as-is, no network round trip)
 * or a "storage:<path>"/"gdrive:<fileId>" marker (src/lib/files.ts) — to a URL usable directly in
 * `<img src>` or `<a href>`. Returns undefined while a storage-backed value's URL is still loading.
 *
 * resolveDocumentUrl builds a fresh blob: URL from files.ts's own cached Blob on every call, so
 * this hook owns (and revokes) its own object URL rather than sharing one across mounts —
 * revoking it here on unmount/change can never yank the URL out from under a different
 * still-mounted consumer resolving the same marker. URL.revokeObjectURL is a documented no-op on
 * a string that isn't a blob: URL, so this is safe unconditionally for the legacy data: URL case too.
 */
export function useResolvedFileUrl(value: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(value && !NEEDS_RESOLUTION_PREFIX.test(value) ? value : undefined);
  const objectUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!value || !NEEDS_RESOLUTION_PREFIX.test(value)) {
      setUrl(value);
      return;
    }
    let cancelled = false;
    resolveDocumentUrl(undefined, value).then((resolved) => {
      if (cancelled) {
        if (resolved) URL.revokeObjectURL(resolved);
        return;
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = resolved ?? undefined;
      setUrl(resolved ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return url;
}
