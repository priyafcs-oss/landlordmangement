import { describe, expect, it } from "vitest";
import { annualInterestOf, estimateLoanInterest } from "@/lib/calculations";

const loans = [
  { propertyId: "p1", totalBalance: 500_000, interestRate: 6, status: "Active" as const },
  { propertyId: "p1", totalBalance: 100_000, interestRate: 7, status: "Active" as const },
  { propertyId: "p1", totalBalance: 999_999, interestRate: 9, status: "Paid Off" as const },
  { propertyId: "p2", totalBalance: 300_000, interestRate: 5, status: "Active" as const },
];
const FY = { start: "2025-07-01", end: "2026-06-30" };

describe("estimateLoanInterest", () => {
  it("sums every active loan on the property for a full year", () => {
    // 30,000 + 7,000; the paid-off loan and p2's loan don't count.
    expect(estimateLoanInterest({ loans, expenses: [], propertyId: "p1", ...FY })).toBeCloseTo(
      37_000,
      0,
    );
  });

  it("pro-rates a part year", () => {
    const half = estimateLoanInterest({
      loans,
      expenses: [],
      propertyId: "p2",
      start: "2025-07-01",
      end: "2025-12-30",
    });
    expect(half).toBeCloseTo((15_000 * 183) / 365, 2);
  });

  // The tax summary added the estimate on top of real interest already in its expense total.
  it("is zero once real interest has been posted for the property in the period", () => {
    const expenses = [
      {
        propertyId: "p1",
        category: "Interest on Loan" as const,
        cost: 2_500,
        date: "2025-08-01",
        direction: "Expense" as const,
      },
    ];
    expect(estimateLoanInterest({ loans, expenses, propertyId: "p1", ...FY })).toBe(0);
    // Interest posted outside the period, or on another property, doesn't suppress it.
    expect(estimateLoanInterest({ loans, expenses, propertyId: "p2", ...FY })).toBeGreaterThan(0);
    expect(
      estimateLoanInterest({
        loans,
        expenses,
        propertyId: "p1",
        start: "2026-07-01",
        end: "2027-06-30",
      }),
    ).toBeGreaterThan(0);
  });

  it("annual interest of one loan", () => {
    expect(annualInterestOf({ totalBalance: 200_000, interestRate: 5.5 })).toBe(11_000);
  });
});
