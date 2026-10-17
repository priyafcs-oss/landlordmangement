import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/publicPaths";

// Google's OAuth verification fetches the privacy policy and terms without a session — behind
// AuthGate they'd just show the sign-in screen.
describe("isPublicPath", () => {
  it("lets the maintenance form, privacy policy and terms through without sign-in", () => {
    expect(isPublicPath("/maintenance")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/terms")).toBe(true);
  });

  it("keeps every other page behind sign-in", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/termsheet")).toBe(false);
  });
});
