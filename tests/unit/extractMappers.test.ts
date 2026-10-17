import { describe, expect, it } from "vitest";
import {
  agreementFieldsFromExtract,
  loanFieldsFromPayload,
  loanPayloadFromExtract,
} from "@/lib/extractMappers";
import { defaultMethodForDivision, methodAfterDivisionChange } from "@/lib/calculations";

describe("loan document mapping (Add Loan dialog + loan proposal card)", () => {
  const read = loanPayloadFromExtract({
    lender_name: "ANZ",
    loan_amount: 828840.47,
    interest_rate: 6.04,
    monthly_repayment: 4185.35,
    next_repayment_date: "2026-11-01",
    has_offset_account: true,
    bsb: null,
  });

  it("maps the AI result onto loan fields", () => {
    expect(loanFieldsFromPayload(read)).toEqual({
      bankName: "ANZ",
      originalAmount: 828840.47,
      totalBalance: 828840.47,
      interestRate: 6.04,
      monthlyEmi: 4185.35,
      nextRepaymentDate: "2026-11-01",
      dueDayOfMonth: 1,
      hasOffsetAccount: true,
    });
  });

  // new Date("2026-11-01").getDate() parses as UTC and gives 31 in a timezone behind UTC.
  it("reads the due day straight off the date", () => {
    expect(loanFieldsFromPayload({ ...read, nextRepaymentDate: "2026-11-01" }).dueDayOfMonth).toBe(
      1,
    );
    expect(loanFieldsFromPayload({ ...read, nextRepaymentDate: "2026-11-28" }).dueDayOfMonth).toBe(
      28,
    );
    expect(
      loanFieldsFromPayload({ ...read, nextRepaymentDate: undefined }).dueDayOfMonth,
    ).toBeUndefined();
  });
});

describe("agency agreement mapping", () => {
  it("fills each fee with its own GST flag and counts the terms found", () => {
    const { fields, found } = agreementFieldsFromExtract({
      management_fee_percent: 6.6,
      management_fee_gst_inclusive: true,
      letting_fee_weeks_rent: 1,
      admin_fee_amount: 5.5,
      admin_fee_frequency: "Per Statement",
      agent_pays_water_usage: false,
      notice_period_days: null,
      agency_name: "Vibrant Realtors",
    });
    expect(fields).toEqual({
      managementFeePercent: "6.6",
      managementFeeGstInclusive: true,
      lettingFeeWeeksRent: "1",
      lettingFeeGstInclusive: false,
      adminFeeAmount: "5.5",
      adminFeeGstInclusive: false,
      adminFeeFrequency: "Per Statement",
      agentPaysWaterUsage: false,
    });
    expect(found).toBe(5);
  });

  it("finds nothing in an empty read", () => {
    expect(agreementFieldsFromExtract({ agency_name: "X" })).toEqual({ fields: {}, found: 0 });
  });
});

describe("depreciation Div 43 rule", () => {
  it("Div 43 is always Prime Cost", () => {
    expect(defaultMethodForDivision("Div 43")).toBe("Prime Cost");
    expect(defaultMethodForDivision("Div 40")).toBe("Diminishing Value");
    expect(methodAfterDivisionChange("Div 43", "Diminishing Value")).toBe("Prime Cost");
    expect(methodAfterDivisionChange("Div 40", "Prime Cost")).toBe("Prime Cost");
  });
});
