import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailTenant,
  inspectionEmail,
  inspectionIssueEmail,
  leaseEmail,
  ledgerEmail,
  rechargeEmail,
  rentReceivedEmail,
  signOff,
} from "@/lib/tenantEmails";

// Every tenant email signs off the same way — these used to end "Thanks" (no name), "The Landlord",
// or the landlord's name, depending on the screen.
describe("tenant emails", () => {
  it("sign off with the landlord's name, or The Landlord", () => {
    expect(signOff("Jane Smith")).toBe("Thanks,\nJane Smith");
    expect(signOff("", "Kind regards")).toBe("Kind regards,\nThe Landlord");
  });

  it("every builder ends with the same sign-off", () => {
    const name = "Jane Smith";
    const bodies = [
      rechargeEmail({
        tenantName: "Sam",
        billType: "Water",
        description: "Water usage",
        amount: 261.59,
        landlordName: name,
      }).body,
      inspectionEmail({
        tenantName: "Sam",
        propertyLabel: "10 Facer Ct",
        inspectionType: "Routine",
        date: "2026-11-01",
        landlordName: name,
      }).body,
      inspectionIssueEmail({
        tenantName: "Sam",
        propertyLabel: "10 Facer Ct",
        inspectionType: "Routine",
        issue: "Leaking tap",
        landlordName: name,
      }).body,
      rentReceivedEmail({
        tenantName: "Sam",
        amount: 500,
        paidUpTo: "2026-11-01",
        landlordName: name,
      }).body,
      ledgerEmail({ tenantName: "Sam", totalOutstanding: 0, landlordName: name }).body,
      leaseEmail({ tenantName: "Sam", propertyLabel: "10 Facer Ct", landlordName: name }).body,
    ];
    for (const b of bodies) expect(b.endsWith(`\n${name}`)).toBe(true);
  });

  it("inspection email covers upcoming and completed", () => {
    const upcoming = inspectionEmail({
      tenantName: "Sam",
      propertyLabel: "10 Facer Ct",
      inspectionType: "Routine",
      date: "2026-11-01",
    });
    expect(upcoming.subject).toBe("Upcoming routine inspection — 10 Facer Ct");
    expect(upcoming.body).toContain("scheduled for 2026-11-01 at 10 Facer Ct");
    const done = inspectionEmail({
      tenantName: "Sam",
      propertyLabel: "10 Facer Ct",
      inspectionType: "Routine",
      date: "2026-11-01",
      completed: true,
    });
    expect(done.subject).toBe("Inspection — 10 Facer Ct");
    expect(done.body).toContain("Following up on the routine inspection on 2026-11-01");
  });

  it("rent received states the amount, date and paid-up-to", () => {
    const m = rentReceivedEmail({
      tenantName: "Sam",
      propertyLabel: "10 Facer Ct",
      amount: 1170,
      date: "2026-10-15",
      paidUpTo: "2026-10-28",
    });
    expect(m.subject).toBe("Rent received — 10 Facer Ct");
    expect(m.body).toContain("$1,170.00 on 2026-10-15");
    expect(m.body).toContain("paid up to 2026-10-28");
  });

  it("ledger email states the outstanding total", () => {
    expect(
      ledgerEmail({
        tenantName: "Sam",
        propertyLabel: "10 Facer Ct",
        totalOutstanding: 261.59,
        paidUpTo: "2026-10-28",
      }).body,
    ).toContain("Total outstanding: $261.59");
  });
});

describe("recharge email", () => {
  it("opens with a greeting line and closes inviting questions", () => {
    const body = rechargeEmail({
      tenantName: "Sam",
      propertyLabel: "10 Facer Ct",
      billType: "Water",
      description: "Water usage",
      amount: 261.59,
      landlordName: "Jane Smith",
    }).body;
    expect(body.startsWith("Hi Sam,\n\nI hope you are well.\n\n")).toBe(true);
    expect(
      body.endsWith("Please let me know if you have any questions.\n\nThanks,\nJane Smith"),
    ).toBe(true);
  });
});

// The Gmail tab used to be opened only after the attachment had been fetched from Drive/Storage —
// by then the click's user activation had lapsed, so the browser blocked the tab and the landlord
// was left with just the downloaded bill.
describe("emailTenant", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the draft tab synchronously, then points it at Gmail", async () => {
    const draft = { closed: false, location: { href: "about:blank" }, focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(draft as unknown as Window);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    const pending = emailTenant(
      { name: "Sam", email: "sam@example.com" },
      { subject: "Water", body: "Hi" },
      { blob: new Blob(["%PDF"]), fileName: "bill.pdf" },
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    await pending;
    expect(open).toHaveBeenCalledTimes(1);
    expect(draft.location.href).toContain("https://mail.google.com/mail/?view=cm");
    expect(draft.location.href).toContain("to=sam%40example.com");
  });

  it("opens no tab when no tenant is selected", async () => {
    const open = vi.spyOn(window, "open");
    await emailTenant(undefined, { subject: "s", body: "b" });
    expect(open).not.toHaveBeenCalled();
  });
});
