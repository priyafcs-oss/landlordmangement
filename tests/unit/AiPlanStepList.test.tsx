import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiPlanStepList } from "@/components/AiPlanStepList";
import type { AiPlanStep } from "@/lib/aiPlanTypes";
import type { Property } from "@/lib/types";

/**
 * Tests the REAL dependency-resolution logic in AiPlanStepList/aiPlanExecutor — only the four
 * leaf Add dialogs are mocked (to a plain button that fires the same onCreated/onSaved callback
 * the real dialog's Save button would, simulating "the human reviewed and saved"), since they're
 * heavy components with their own Supabase/store dependencies out of scope for this test. useStore
 * is mocked to a minimal, per-test-mutable portfolio via `mockProperties` below — `vi.doMock`
 * wouldn't retroactively affect AiPlanStepList's already-resolved static import of "@/lib/store",
 * so the mock factory instead reads a shared mutable array each render, which tests reassign
 * before rendering.
 */
const { mockProperties } = vi.hoisted(() => ({ mockProperties: { current: [] as Property[] } }));
vi.mock("@/lib/store", () => ({ useStore: () => ({ state: { properties: mockProperties.current } }) }));

// The real dialogs render `trigger`/`children` (already a <Button>, a real <button>) as a Radix
// DialogTrigger's `asChild` child — which clones the onClick onto that same element rather than
// wrapping it in another real DOM element. A wrapping <button onClick> here would nest <button>
// inside <button>, invalid HTML — a <span onClick> wrapper avoids that while staying clickable.
vi.mock("@/components/PropertyShared", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PropertyDialog: ({ trigger, onCreated }: any) => <span onClick={() => onCreated("prop-real-id")}>{trigger}</span>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TenantDialog: ({ children, onSaved }: any) => <span onClick={() => onSaved("tenant-real-id")}>{children}</span>,
}));
vi.mock("@/components/AddLoanDialog", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AddLoanDialog: ({ trigger, onCreated }: any) => <span onClick={() => onCreated("loan-real-id")}>{trigger}</span>,
}));
vi.mock("@/components/AddTransactionDialog", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AddTransactionDialog: ({ trigger, onSaved }: any) => <span onClick={() => onSaved("expense-real-id")}>{trigger}</span>,
}));

const steps: AiPlanStep[] = [
  { stepId: "step1", type: "create_property", summary: "Create a property at 5 Smith St", status: "pending", address: "5 Smith St" },
  {
    stepId: "step2",
    type: "create_tenant",
    summary: "Add tenant Jane paying $500/week",
    status: "pending",
    propertyRef: "$step1",
    tenantName: "Jane",
    rentAmount: 500,
    rentFrequency: "Weekly",
  },
];

describe("AiPlanStepList", () => {
  beforeEach(() => {
    mockProperties.current = [];
  });

  it("shows the first step actionable and the dependent step blocked, then unblocks it once step 1 is actually saved", () => {
    render(<AiPlanStepList steps={steps} />);

    expect(screen.getByText("Create property")).toBeInTheDocument();
    expect(screen.getByText(/waiting on step 1/i)).toBeInTheDocument();
    expect(screen.queryByText("Create tenant")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Create property"));

    // Step 1 is now "Done" and no longer offers its own action button.
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Create property")).not.toBeInTheDocument();
    // Step 2's propertyRef ("$step1") now resolves to the real id step 1's dialog returned —
    // it's no longer blocked and renders its own real action.
    expect(screen.queryByText(/waiting on step/i)).not.toBeInTheDocument();
    expect(screen.getByText("Create tenant")).toBeInTheDocument();
  });

  it("a step referencing an EXISTING property (not created by an earlier step) is actionable immediately", () => {
    const singleStep: AiPlanStep[] = [
      {
        stepId: "step1",
        type: "add_loan",
        summary: "Add a loan against 5 Smith St",
        status: "pending",
        propertyRef: "5 Smith St",
        lenderName: "Big Bank",
      },
    ];
    mockProperties.current = [{ id: "prop-1", address: "5 Smith St", purchasePrice: 500000, currentValue: 550000 }];

    render(<AiPlanStepList steps={singleStep} />);

    expect(screen.getByText("Add loan")).toBeInTheDocument();
    expect(screen.queryByText(/waiting on step/i)).not.toBeInTheDocument();
  });
});
