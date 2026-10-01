import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmounts any React Testing Library tree after each test so one test's rendered component
// can't leak DOM nodes/timers into the next.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement URL.createObjectURL/revokeObjectURL (a known, long-standing jsdom gap —
// it has no real Blob-backed object URL registry) — src/lib/files.ts's resolveDocumentUrl and
// src/hooks/useResolvedFileUrl.ts's revocation both call these directly, so any client-project
// test touching that path needs this minimal polyfill. Returns a fake but realistic "blob:" URL
// so tests can assert on its shape without needing a real browser.
if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
