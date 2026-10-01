/**
 * Client-side typed shape for a copilot-chat "plan" response — see
 * supabase/functions/_shared/planSchema.ts for the Gemini response schema this normalizes
 * (RawPlanStep there is the raw flat shape Gemini actually returns; duplicated here rather than
 * imported since the edge function and this app are separate Deno/Vite bundles).
 *
 * A step is only ever a PROPOSAL — see src/components/AiPlanStepList.tsx, which is the only place
 * a step's `status` ever moves off "pending", and only as a side effect of a human opening the
 * real Add dialog it maps to and clicking that dialog's own Save.
 */
export type StepStatus = "pending" | "done" | "failed";

interface BaseStep {
  stepId: string;
  summary: string;
  status: StepStatus;
  /** The real id the dialog's own onCreated/onSaved callback returned, once this step has
   * actually run — this is what a LATER step's "$stepN" propertyRef resolves to. */
  resultId?: string;
  error?: string;
}

export interface CreatePropertyStep extends BaseStep {
  type: "create_property";
  address: string;
  alias?: string;
}

export interface CreateTenantStep extends BaseStep {
  type: "create_tenant";
  /** Either an existing property's address (resolved against the portfolio) or "$stepN"
   * referencing an earlier create_property step — resolved to a real property id at render time,
   * never persisted as a raw reference anywhere. */
  propertyRef: string;
  tenantName: string;
  tenantEmail?: string;
  tenantPhone?: string;
  rentAmount?: number;
  rentFrequency?: "Weekly" | "Fortnightly" | "Monthly";
  leaseStart?: string;
  leaseExpiry?: string;
  leaseDuration?: "6 Months" | "12 Months" | "Periodic";
  bondAmount?: number;
}

export interface AddExpenseStep extends BaseStep {
  type: "add_expense";
  propertyRef: string;
  itemName: string;
  cost?: number;
  date?: string;
  category?: string;
}

export interface AddLoanStep extends BaseStep {
  type: "add_loan";
  propertyRef: string;
  lenderName: string;
  amount?: number;
  interestRate?: number;
  monthlyRepayment?: number;
}

export type AiPlanStep = CreatePropertyStep | CreateTenantStep | AddExpenseStep | AddLoanStep;

export interface RawPlanStep {
  stepId: string;
  type: string;
  summary: string;
  propertyRef?: string | null;
  address?: string | null;
  alias?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  rentAmount?: number | null;
  rentFrequency?: string | null;
  leaseStart?: string | null;
  leaseExpiry?: string | null;
  leaseDuration?: string | null;
  bondAmount?: number | null;
  expenseItemName?: string | null;
  expenseCost?: number | null;
  expenseDate?: string | null;
  expenseCategory?: string | null;
  loanLenderName?: string | null;
  loanAmount?: number | null;
  loanInterestRate?: number | null;
  loanMonthlyRepayment?: number | null;
}

const RENT_FREQUENCIES = new Set(["Weekly", "Fortnightly", "Monthly"]);
const LEASE_DURATIONS = new Set(["6 Months", "12 Months", "Periodic"]);

/** Converts Gemini's raw flat-object steps into the typed union above — a step missing a field
 * its type actually requires (or carrying an unrecognized `type`) is silently dropped rather than
 * rendered half-broken; better to under-propose than execute on a guess with a hole in it. */
export function normalizeSteps(raw: RawPlanStep[] | null | undefined): AiPlanStep[] {
  if (!raw) return [];
  const out: AiPlanStep[] = [];
  for (const s of raw) {
    const base = { stepId: s.stepId, summary: s.summary, status: "pending" as StepStatus };
    if (s.type === "create_property" && s.address) {
      out.push({ ...base, type: "create_property", address: s.address, alias: s.alias ?? undefined });
    } else if (s.type === "create_tenant" && s.propertyRef && s.tenantName) {
      out.push({
        ...base,
        type: "create_tenant",
        propertyRef: s.propertyRef,
        tenantName: s.tenantName,
        tenantEmail: s.tenantEmail ?? undefined,
        tenantPhone: s.tenantPhone ?? undefined,
        rentAmount: s.rentAmount ?? undefined,
        rentFrequency: s.rentFrequency && RENT_FREQUENCIES.has(s.rentFrequency) ? (s.rentFrequency as CreateTenantStep["rentFrequency"]) : undefined,
        leaseStart: s.leaseStart ?? undefined,
        leaseExpiry: s.leaseExpiry ?? undefined,
        leaseDuration: s.leaseDuration && LEASE_DURATIONS.has(s.leaseDuration) ? (s.leaseDuration as CreateTenantStep["leaseDuration"]) : undefined,
        bondAmount: s.bondAmount ?? undefined,
      });
    } else if (s.type === "add_expense" && s.propertyRef && s.expenseItemName) {
      out.push({
        ...base,
        type: "add_expense",
        propertyRef: s.propertyRef,
        itemName: s.expenseItemName,
        cost: s.expenseCost ?? undefined,
        date: s.expenseDate ?? undefined,
        category: s.expenseCategory ?? undefined,
      });
    } else if (s.type === "add_loan" && s.propertyRef && s.loanLenderName) {
      out.push({
        ...base,
        type: "add_loan",
        propertyRef: s.propertyRef,
        lenderName: s.loanLenderName,
        amount: s.loanAmount ?? undefined,
        interestRate: s.loanInterestRate ?? undefined,
        monthlyRepayment: s.loanMonthlyRepayment ?? undefined,
      });
    }
  }
  return out;
}
