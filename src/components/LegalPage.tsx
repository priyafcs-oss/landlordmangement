import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * The public Privacy Policy and Terms of Service pages (src/routes/privacy.tsx, terms.tsx) —
 * Google's OAuth consent-screen verification needs both at public URLs, so like /maintenance
 * they render outside AuthGate (see __root.tsx's PUBLIC_PATHS).
 */

export const LEGAL_UPDATED = "18 October 2026";
/** Shown as the contact address on both pages; left out entirely when blank. */
export const LEGAL_CONTACT_EMAIL = "";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">Landlord OS</span>
        <nav className="flex gap-4 text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-6 space-y-6 text-sm leading-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
        {children}
      </div>
    </div>
  );
}

export function LegalContact() {
  return LEGAL_CONTACT_EMAIL ? (
    <p>
      Questions? Email <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
    </p>
  ) : null;
}
