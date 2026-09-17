import { useResolvedFileUrl } from "@/hooks/useResolvedFileUrl";

/** Renders a photo whose value may be a "storage:<path>" marker (src/lib/files.ts) — resolves it
 * to a signed URL first, showing a placeholder while that's in flight — or a legacy inline
 * `data:` URL, rendered directly with no round trip. */
export function StoredImage({ value, name, className }: { value: string; name?: string; className?: string }) {
  const src = useResolvedFileUrl(value);
  if (!src) return <div className={`${className ?? ""} animate-pulse bg-muted`} />;
  return <img src={src} alt={name} className={className} />;
}

/** Same resolution, wrapped in a download link — for the few galleries that pair each thumbnail
 * with a direct download (not just click-to-open via DocumentLink/openBillDocument). */
export function StoredImageLink({ value, name, className }: { value: string; name?: string; className?: string }) {
  const src = useResolvedFileUrl(value);
  return (
    <a href={src} download={name}>
      {src ? <img src={src} alt={name} className={className} /> : <div className={`${className ?? ""} animate-pulse bg-muted`} />}
    </a>
  );
}

/** Same resolution, for a stored video. */
export function StoredVideo({ value, className }: { value: string; className?: string }) {
  const src = useResolvedFileUrl(value);
  if (!src) return <div className={`${className ?? ""} animate-pulse bg-muted`} />;
  return <video src={src} controls className={className} />;
}
