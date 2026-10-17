export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function gmailComposeUrl(to: string | undefined, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    to ?? "",
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Opens a blank tab for a Gmail draft — call this synchronously inside the click handler, BEFORE
 * any await. A browser only lets a page open a tab during the click's brief user-activation
 * window; fetching the attachment first (a Drive/Storage round trip) used to outlast it, so the
 * bill downloaded but the Gmail tab was silently popup-blocked. Null when blocked anyway.
 */
export function reserveComposeWindow(): Window | null {
  return window.open("about:blank", "_blank");
}

/** Points a reserved tab (or, failing that, a fresh one) at a prefilled Gmail draft. */
export function openGmailCompose(
  to: string | undefined,
  subject: string,
  body: string,
  reserved?: Window | null,
) {
  const url = gmailComposeUrl(to, subject, body);
  if (reserved && !reserved.closed) {
    reserved.location.href = url;
    reserved.focus();
  } else {
    window.open(url, "_blank");
  }
}
