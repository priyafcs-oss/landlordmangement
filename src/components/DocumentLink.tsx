import { openBillDocument } from "@/lib/files";

/**
 * Opens a stored file (base64/data-URL) in a new tab via a blob: URL, instead of the
 * `<a href={base64} download>` pattern this replaces everywhere — that pattern either forces a
 * save-to-disk with no viewer, or (when the stored value is raw base64 rather than a full data
 * URL, which is the more common case in this codebase) fails outright since the browser treats
 * the base64 text itself as a navigation target. See openBillDocument for the underlying blob-URL
 * mechanics and why data: URIs can't just be opened directly in a new tab.
 */
export function DocumentLink({
  fileName,
  fileData,
  className,
  children,
}: {
  fileName?: string;
  fileData?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openBillDocument(fileName, fileData)}
      className={"cursor-pointer border-0 bg-transparent p-0 text-left font-inherit " + (className ?? "")}
    >
      {children}
    </button>
  );
}
