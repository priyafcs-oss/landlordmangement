export interface EmailLink {
  label: string;
  url: string;
}

const LINK_RE = /<(https:\/\/[^>\s]+)>/g;

/** Links in a forwarded plain-text email, Gmail-style — each `<https://…>` labelled by the text
 * just before it on the same line, or by the previous non-empty line when the link sits on its own
 * line ("View bill\n<https://…>"). Only https links, first occurrence of each URL. */
export function extractEmailLinks(body: string | undefined): EmailLink[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const seen = new Set<string>();
  const links: EmailLink[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      let label = line.slice(0, m.index).replace(LINK_RE, "").trim();
      for (let j = i - 1; !label && j >= 0; j--) label = lines[j].replace(LINK_RE, "").trim();
      links.push({ label, url });
    }
  });
  return links;
}

/** The link that opens the bill itself — "View bill" and similar, falling back to "Pay now"
 * (which on most utility portals lands on the same logged-in bill page). */
export function pickBillLink(links: EmailLink[]): EmailLink | undefined {
  return (
    links.find((l) =>
      /view (your )?(e-?)?bill|view invoice|download (your )?bill|see your bill/i.test(l.label),
    ) ?? links.find((l) => /pay now/i.test(l.label))
  );
}

/** The portal login page to remember as a provider's portalUrl — the bill link minus its
 * per-bill query string (a one-off GUID that's no use for the next bill). */
export function portalOrigin(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? `${u.origin}${u.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

/** Splits text into plain chunks and https links, for rendering a clickable email body. */
export function linkifySegments(text: string): ({ text: string } | { url: string })[] {
  const out: ({ text: string } | { url: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ url: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
