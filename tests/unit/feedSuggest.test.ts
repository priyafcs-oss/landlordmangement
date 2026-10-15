import { describe, expect, it } from "vitest";
import {
  isRentMultiple,
  keywordExpenseCategory,
  matchTenantByText,
  nonPropertyReason,
  parseBankFeedLine,
  suggestFeedLine,
  type FeedLine,
  type SuggestContext,
} from "@/lib/feedSuggest";
import type { PropertyBill, Provider, ProviderProperty, Tenant } from "@/lib/types";

const facer = {
  id: "t1",
  name: "Jane Facer",
  propertyId: "p1",
  leaseStart: "2026-03-14",
  rentAmount: 1170,
  rentFrequency: "Weekly",
  paidUpToDate: "2026-09-25",
} as unknown as Tenant;
const sam = {
  id: "t2",
  name: "Sam Lee",
  propertyId: "p2",
  leaseStart: "2026-01-01",
  rentAmount: 650,
  rentFrequency: "Weekly",
  bankReference: "REF-SL-2026",
  paidUpToDate: "2026-10-01",
} as unknown as Tenant;

const ctx = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  tenants: [facer, sam],
  providers: [],
  providerProperties: [],
  bills: [],
  ...over,
});
const deposit = (description: string, amount: number, date = "2026-10-03"): FeedLine => ({
  date,
  description,
  amount,
  direction: "in",
});
const debit = (description: string, amount: number, extra: Partial<FeedLine> = {}): FeedLine => ({
  date: "2026-10-03",
  description,
  amount,
  direction: "out",
  ...extra,
});

describe("never rent: transfers, salary and other income", () => {
  // Real lines from the landlord's everyday-account statement that were all flagged as rent.
  it.each([
    ["Funds transfer From linked account xx7814 - Internal transfer", 2340],
    ["Funds transfer From linked account xx7814 - Internal transfer", 1170],
    ["SALARY UNIVERSITY OF SYDNEY", 4682.17],
    ["Payroll ACME PTY LTD", 3510],
    ["Interest paid", 1170],
    ["ATO tax refund", 1170],
  ])("%s ($%s)", (description, amount) => {
    expect(suggestFeedLine(deposit(description, amount), ctx())).toBeNull();
  });

  it("an internal transfer out isn't flagged as an expense either", () => {
    expect(nonPropertyReason("Transfer to linked account xx7814", "out")).toBe("transfer");
    expect(
      suggestFeedLine(debit("Internal transfer to savings - repairs fund", 500), ctx()),
    ).toBeNull();
  });

  it("an amount alone never makes a deposit rent (the old fallback guessed the one tenant it fit)", () => {
    expect(suggestFeedLine(deposit("DEPOSIT 88213", 1170), ctx())).toBeNull();
    expect(suggestFeedLine(deposit("DEPOSIT 88213", 650), ctx())).toBeNull();
  });
});

describe("rent deposits", () => {
  it("names the tenant + whole weeks of rent → rent for that tenant", () => {
    expect(suggestFeedLine(deposit("TRANSFER FROM J FACER RENT", 1170), ctx())).toMatchObject({
      kind: "rent",
      category: "Gross Rent",
      tenantId: "t1",
      propertyId: "p1",
    });
    expect(suggestFeedLine(deposit("FACER JANE", 2340), ctx())?.tenantId).toBe("t1");
  });

  it("names the tenant but the amount isn't whole weeks of rent (to the dollar) → not rent", () => {
    expect(suggestFeedLine(deposit("J FACER water", 60.23), ctx())).toBeNull();
    // 4 × 1170 = 4680; the old ±2% tolerance accepted this.
    expect(suggestFeedLine(deposit("J FACER", 4682.17), ctx())).toBeNull();
  });

  it("the tenant's bank reference is enough on its own", () => {
    expect(suggestFeedLine(deposit("PAYMENT REF-SL-2026", 300), ctx())?.tenantId).toBe("t2");
  });

  it("a deposit dated after the tenant vacated isn't their rent", () => {
    const gone = { ...facer, vacatingDate: "2026-09-01" } as Tenant;
    expect(suggestFeedLine(deposit("J FACER", 1170), ctx({ tenants: [gone] }))).toBeNull();
  });
});

describe("matchTenantByText", () => {
  it("doesn't match on a first name or a word fragment", () => {
    expect(matchTenantByText([sam], "SAMSUNG ELECTRONICS")).toBeUndefined();
    expect(matchTenantByText([sam], "Sam's coffee")).toBeUndefined();
    expect(matchTenantByText([facer], "Surface pro")).toBeUndefined();
  });

  it("matches surname as a whole word, full name, or reference", () => {
    expect(matchTenantByText([facer], "TFR FACER")?.via).toBe("name");
    expect(matchTenantByText([sam], "from Sam Lee")?.tenant.id).toBe("t2");
    expect(matchTenantByText([sam], "REF-SL-2026 thanks")?.via).toBe("reference");
  });
});

describe("isRentMultiple", () => {
  it("whole periods to within $1", () => {
    expect(isRentMultiple(1170, 1170)).toBe(true);
    expect(isRentMultiple(3510, 1170)).toBe(true);
    expect(isRentMultiple(1170.5, 1170)).toBe(true);
  });
  it("rejects near misses and implausibly many periods", () => {
    expect(isRentMultiple(1100, 1170)).toBe(false);
    expect(isRentMultiple(4682.17, 1170)).toBe(false);
    expect(isRentMultiple(1170 * 12, 1170)).toBe(false);
  });
});

describe("expenses are flagged", () => {
  const bill = {
    id: "b1",
    propertyId: "p1",
    providerName: "Sydney Water",
    billType: "Water",
    amount: 312.4,
    dueDate: "2026-10-10",
    status: "Unpaid",
    category: "Water Charges",
  } as unknown as PropertyBill;
  const plumber = {
    id: "pr1",
    name: "Ace Plumbing",
    defaultCategory: "Repairs & Maintenance",
  } as unknown as Provider;
  const link = { id: "pp1", providerId: "pr1", propertyId: "p1" } as ProviderProperty;

  it("a debit paying an unpaid bill suggests marking that bill paid", () => {
    expect(
      suggestFeedLine(debit("BPAY SYDNEY WATER", 312.4), ctx({ bills: [bill] })),
    ).toMatchObject({
      kind: "bill",
      billId: "b1",
      propertyId: "p1",
    });
  });

  it("a debit to a known provider uses its default category and its only property", () => {
    expect(
      suggestFeedLine(
        debit("ACE PLUMBING INV 2231", 280),
        ctx({ providers: [plumber], providerProperties: [link] }),
      ),
    ).toMatchObject({ kind: "expense", category: "Repairs & Maintenance", propertyId: "p1" });
  });

  it("a debit that reads like a property cost is flagged even when the property is unknown", () => {
    const s = suggestFeedLine(debit("BPAY STRATA PLAN 12345 LEVY", 950), ctx());
    expect(s).toMatchObject({ kind: "expense", category: "Strata Levies" });
    expect(s?.propertyId).toBeUndefined();
  });

  it("uses the statement's own property when it has one", () => {
    expect(
      suggestFeedLine(debit("Council rates Q2", 480, { propertyId: "p2" }), ctx())?.propertyId,
    ).toBe("p2");
  });

  it("everyday personal spending isn't flagged", () => {
    expect(suggestFeedLine(debit("WOOLWORTHS 1234", 85.2), ctx())).toBeNull();
    expect(suggestFeedLine(debit("ORIGIN ENERGY", 210), ctx())).toBeNull();
  });

  it("keywordExpenseCategory", () => {
    expect(keywordExpenseCategory("Land Tax - Revenue NSW")).toBe("Land Tax");
    expect(keywordExpenseCategory("Jim's Mowing")).toBe("Gardening / Lawn Mowing");
    expect(keywordExpenseCategory("Netflix")).toBeUndefined();
  });
});

describe("parseBankFeedLine (Rental hub → Bank Feed Import)", () => {
  it("doesn't read the year as the amount", () => {
    expect(parseBankFeedLine("2026-07-01 REF-SK-2026 Sarah Kim $720.00")).toEqual({
      amount: 720,
      date: "2026-07-01",
    });
  });

  it("reads DD/MM/YYYY dates and thousands separators", () => {
    expect(parseBankFeedLine("25/09/2026 J FACER 1,170.00")).toEqual({
      amount: 1170,
      date: "2026-09-25",
    });
  });

  it("no date → amount only; no amount → null", () => {
    expect(parseBankFeedLine("J FACER $1170")).toEqual({ amount: 1170, date: undefined });
    expect(parseBankFeedLine("no money here")).toBeNull();
  });
});
