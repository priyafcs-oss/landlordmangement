import { describe, expect, it } from "vitest";
import { normalizeSteps, type RawPlanStep } from "@/lib/aiPlanTypes";

function raw(overrides: Partial<RawPlanStep>): RawPlanStep {
  return { stepId: "step1", type: "create_property", summary: "test step", ...overrides };
}

describe("normalizeSteps", () => {
  it("returns an empty array for null/undefined input", () => {
    expect(normalizeSteps(null)).toEqual([]);
    expect(normalizeSteps(undefined)).toEqual([]);
  });

  it("normalizes a valid create_property step", () => {
    const [step] = normalizeSteps([raw({ type: "create_property", address: "5 Smith St", alias: "The Smith St house" })]);
    expect(step).toMatchObject({ type: "create_property", address: "5 Smith St", alias: "The Smith St house", status: "pending" });
  });

  it("drops a create_property step with no address", () => {
    expect(normalizeSteps([raw({ type: "create_property", address: null })])).toEqual([]);
  });

  it("normalizes a valid create_tenant step, including a $stepN propertyRef", () => {
    const [step] = normalizeSteps([
      raw({
        stepId: "step2",
        type: "create_tenant",
        propertyRef: "$step1",
        tenantName: "Jane",
        rentAmount: 500,
        rentFrequency: "Weekly",
        leaseDuration: "12 Months",
      }),
    ]);
    expect(step).toMatchObject({
      type: "create_tenant",
      propertyRef: "$step1",
      tenantName: "Jane",
      rentAmount: 500,
      rentFrequency: "Weekly",
      leaseDuration: "12 Months",
    });
  });

  it("drops a create_tenant step missing propertyRef or tenantName", () => {
    expect(normalizeSteps([raw({ type: "create_tenant", propertyRef: null, tenantName: "Jane" })])).toEqual([]);
    expect(normalizeSteps([raw({ type: "create_tenant", propertyRef: "5 Smith St", tenantName: null })])).toEqual([]);
  });

  it("silently discards an out-of-enum rentFrequency/leaseDuration rather than passing it through", () => {
    const [step] = normalizeSteps([
      raw({ type: "create_tenant", propertyRef: "5 Smith St", tenantName: "Jane", rentFrequency: "Daily", leaseDuration: "Forever" }),
    ]);
    expect(step).toMatchObject({ type: "create_tenant", rentFrequency: undefined, leaseDuration: undefined });
  });

  it("normalizes a valid add_expense step", () => {
    const [step] = normalizeSteps([
      raw({ type: "add_expense", propertyRef: "5 Smith St", expenseItemName: "Pest control", expenseCost: 220, expenseDate: "2026-10-05" }),
    ]);
    expect(step).toMatchObject({ type: "add_expense", propertyRef: "5 Smith St", itemName: "Pest control", cost: 220, date: "2026-10-05" });
  });

  it("drops an add_expense step with no expenseItemName", () => {
    expect(normalizeSteps([raw({ type: "add_expense", propertyRef: "5 Smith St", expenseItemName: null })])).toEqual([]);
  });

  it("normalizes a valid add_loan step", () => {
    const [step] = normalizeSteps([
      raw({ type: "add_loan", propertyRef: "5 Smith St", loanLenderName: "Big Bank", loanAmount: 500000, loanInterestRate: 5.5 }),
    ]);
    expect(step).toMatchObject({ type: "add_loan", propertyRef: "5 Smith St", lenderName: "Big Bank", amount: 500000, interestRate: 5.5 });
  });

  it("drops a step with an unrecognized type entirely", () => {
    expect(normalizeSteps([raw({ type: "delete_everything" })])).toEqual([]);
  });

  it("preserves ordering and drops invalid steps in place rather than reordering valid ones", () => {
    const steps = normalizeSteps([
      raw({ stepId: "step1", type: "create_property", address: "5 Smith St" }),
      raw({ stepId: "step2", type: "create_tenant", propertyRef: "$step1", tenantName: null }), // dropped
      raw({ stepId: "step3", type: "add_loan", propertyRef: "$step1", loanLenderName: "Big Bank" }),
    ]);
    expect(steps.map((s) => s.stepId)).toEqual(["step1", "step3"]);
  });
});
