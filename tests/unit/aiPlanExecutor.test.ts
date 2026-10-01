import { describe, expect, it } from "vitest";
import { isStepReady, resolvePropertyRef, stepHasPropertyRef } from "@/lib/aiPlanExecutor";
import type { AiPlanStep } from "@/lib/aiPlanTypes";
import type { Property } from "@/lib/types";

function property(overrides: Partial<Property>): Property {
  return { id: "prop-1", address: "5 Smith St, Sydney NSW", purchasePrice: 500000, currentValue: 550000, ...overrides };
}

const createPropertyStep: AiPlanStep = { stepId: "step1", type: "create_property", summary: "", status: "pending", address: "5 Smith St" };
const createTenantStep: AiPlanStep = {
  stepId: "step2",
  type: "create_tenant",
  summary: "",
  status: "pending",
  propertyRef: "$step1",
  tenantName: "Jane",
};

describe("stepHasPropertyRef", () => {
  it("is false for create_property (nothing to depend on yet) and true for every other v1 step type", () => {
    expect(stepHasPropertyRef(createPropertyStep)).toBe(false);
    expect(stepHasPropertyRef(createTenantStep)).toBe(true);
    expect(stepHasPropertyRef({ ...createTenantStep, type: "add_expense", itemName: "x" } as AiPlanStep)).toBe(true);
    expect(stepHasPropertyRef({ ...createTenantStep, type: "add_loan", lenderName: "x" } as AiPlanStep)).toBe(true);
  });
});

describe("resolvePropertyRef", () => {
  it("resolves a $stepN reference from the resolvedIds map", () => {
    const resolvedIds = new Map([["step1", "prop-real-id"]]);
    expect(resolvePropertyRef("$step1", [], resolvedIds)).toBe("prop-real-id");
  });

  it("returns undefined for a $stepN reference whose step hasn't completed yet", () => {
    expect(resolvePropertyRef("$step1", [], new Map())).toBeUndefined();
  });

  it("matches an existing property by exact address (case-insensitive)", () => {
    const properties = [property({ id: "prop-1", address: "5 Smith St, Sydney NSW" })];
    expect(resolvePropertyRef("5 smith st, sydney nsw", properties, new Map())).toBe("prop-1");
  });

  it("matches an existing property by partial/substring address", () => {
    const properties = [property({ id: "prop-1", address: "5 Smith St, Sydney NSW 2000" })];
    expect(resolvePropertyRef("5 Smith St", properties, new Map())).toBe("prop-1");
  });

  it("returns undefined when no property matches at all", () => {
    const properties = [property({ id: "prop-1", address: "5 Smith St, Sydney NSW" })];
    expect(resolvePropertyRef("99 Nowhere Ave", properties, new Map())).toBeUndefined();
  });

  it("returns undefined for an empty/blank reference", () => {
    expect(resolvePropertyRef("   ", [property({})], new Map())).toBeUndefined();
  });
});

describe("isStepReady", () => {
  it("a create_property step is always ready — nothing depends on anything yet", () => {
    expect(isStepReady(createPropertyStep, [], new Map())).toBe(true);
  });

  it("a dependent step is ready once its $stepN reference resolves", () => {
    expect(isStepReady(createTenantStep, [], new Map([["step1", "prop-real-id"]]))).toBe(true);
  });

  it("a dependent step is NOT ready while its $stepN reference is still unresolved", () => {
    expect(isStepReady(createTenantStep, [], new Map())).toBe(false);
  });

  it("a step referencing an existing property by address is ready immediately, no prior step needed", () => {
    const step: AiPlanStep = { ...createTenantStep, propertyRef: "5 Smith St, Sydney NSW" };
    expect(isStepReady(step, [property({ address: "5 Smith St, Sydney NSW" })], new Map())).toBe(true);
  });
});
