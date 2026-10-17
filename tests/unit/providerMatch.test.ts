import { describe, expect, it } from "vitest";
import { findProvider, namesLooselyMatch, rowBelongsToProvider } from "@/lib/providerMatch";

const providers = [
  { id: "a", name: "Sydney Water Corporation", abn: "49 776 225 038" },
  { id: "b", name: "Sydney Water", abn: null },
  { id: "c", name: "Jones Plumbing", abn: "11 111 111 111" },
  { id: "d", name: "Aircon", abn: null },
];

describe("findProvider — one rule for the app and the edge functions", () => {
  it("prefers the ABN over any name", () => {
    expect(findProvider(providers, "Sydney Water", "49776225038")?.id).toBe("a");
  });

  // The app's old copy took the first loose match, so "Sydney Water Corporation" (listed first)
  // beat the exact "Sydney Water".
  it("prefers an exact name over an earlier loose match", () => {
    expect(findProvider(providers, "sydney water")?.id).toBe("b");
  });

  it("matches a legal-suffix difference by whole words", () => {
    expect(findProvider(providers, "Jones Plumbing Pty Ltd")?.id).toBe("c");
  });

  it("never matches a same-named provider with a different ABN", () => {
    expect(findProvider(providers, "Jones Plumbing", "22 222 222 222")).toBeUndefined();
  });

  it("isn't a substring test", () => {
    expect(findProvider(providers, "BGS Airconditioning and Electricals")).toBeUndefined();
    expect(namesLooselyMatch("Aircon", "BGS Airconditioning")).toBe(false);
  });
});

describe("rowBelongsToProvider (provider pages)", () => {
  const provider = { id: "c", name: "Jones Plumbing" };
  it("matches by id or by name for rows with only a name", () => {
    expect(rowBelongsToProvider({ providerId: "c" }, provider)).toBe(true);
    expect(rowBelongsToProvider({ providerName: "Jones Plumbing Pty Ltd" }, provider)).toBe(true);
    expect(rowBelongsToProvider({ providerName: "Smith Electrical" }, provider)).toBe(false);
  });
});
