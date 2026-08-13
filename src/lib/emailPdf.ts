export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function openGmailCompose(to: string | undefined, subject: string, body: string) {
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    to ?? "",
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(gmailUrl, "_blank");
}

/**
 * Downloads a PDF and opens Gmail's web compose prefilled, asking the landlord to attach the
 * file they just downloaded. No email link (mailto: or any provider's compose URL) can attach a
 * file automatically — that's a browser security restriction, not something any web app can
 * work around — so this is the most complete flow actually achievable from a link.
 */
export function downloadPdfAndEmailViaGmail(params: {
  blob: Blob;
  fileName: string;
  to: string | undefined;
  subject: string;
  body: string;
}) {
  downloadBlob(params.blob, params.fileName);
  openGmailCompose(params.to, params.subject, params.body);
}
