/**
 * Response schema + prompt for the AI Assistant's "plan mode" (copilot-chat) — lets a free-text
 * request like "create a property at 5 Smith St and add a tenant Jane paying $500/week" turn into
 * an ORDERED list of typed, human-reviewable steps instead of just a chat answer. The assistant
 * never writes anything itself: every step this schema can produce is only ever executed when a
 * landlord opens the real Add dialog it maps to (pre-filled from the step) and clicks that
 * dialog's own Save — see src/components/AiPlanStepList.tsx. This mirrors the existing
 * ai_intake_proposals "AI proposes, human approves" pattern used for inbound document parsing,
 * just without that table (a multi-step plan with cross-step dependencies doesn't fit its
 * one-row/one-kind/one-payload shape, and a plan that's never run doesn't need to survive a page
 * refresh — see AiPlanStepList's own doc comment).
 *
 * Gemini's responseSchema (like OpenAI's) has no true discriminated union, so — matching this
 * codebase's existing convention for large nullable-field extraction schemas (see
 * ParsedPropertyDocumentFields) — every step is ONE flat object with every possible field across
 * all v1 step types marked nullable, interpreted contextually by `type`.
 */
export const COPILOT_PLAN_STEP_TYPES = ["create_property", "create_tenant", "add_expense", "add_loan"] as const;

/** Raw shape Gemini actually returns per COPILOT_RESPONSE_SCHEMA below — one flat object with
 * every v1 step type's fields, all nullable. Mirrored client-side in src/lib/aiPlanTypes.ts
 * (Deno/Vite are separate bundles, so this is duplicated rather than imported across that
 * boundary — same convention this codebase already uses for other small cross-runtime shapes,
 * e.g. the MIME maps duplicated between src/lib/files.ts and _shared/storage.ts). */
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

export const COPILOT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    // Exactly one of answer/steps should be set — enforced by the prompt, not the schema (Gemini
    // can't express "exactly one of" either).
    answer: { type: "STRING", nullable: true },
    steps: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        properties: {
          stepId: { type: "STRING" }, // "step1", "step2", ... — later steps reference an earlier one via "$step1"
          type: { type: "STRING", enum: COPILOT_PLAN_STEP_TYPES },
          summary: { type: "STRING" }, // one-line human-readable description for the step-list UI
          // Used by create_tenant/add_expense/add_loan — either an existing property's address
          // (resolved client-side against the landlord's own properties) or "$stepN" referencing
          // an earlier create_property step's not-yet-real id.
          propertyRef: { type: "STRING", nullable: true },
          address: { type: "STRING", nullable: true },
          alias: { type: "STRING", nullable: true },
          tenantName: { type: "STRING", nullable: true },
          tenantEmail: { type: "STRING", nullable: true },
          tenantPhone: { type: "STRING", nullable: true },
          rentAmount: { type: "NUMBER", nullable: true },
          rentFrequency: { type: "STRING", enum: ["Weekly", "Fortnightly", "Monthly"], nullable: true },
          leaseStart: { type: "STRING", nullable: true },
          leaseExpiry: { type: "STRING", nullable: true },
          leaseDuration: { type: "STRING", enum: ["6 Months", "12 Months", "Periodic"], nullable: true },
          bondAmount: { type: "NUMBER", nullable: true },
          expenseItemName: { type: "STRING", nullable: true },
          expenseCost: { type: "NUMBER", nullable: true },
          expenseDate: { type: "STRING", nullable: true },
          expenseCategory: { type: "STRING", nullable: true },
          loanLenderName: { type: "STRING", nullable: true },
          loanAmount: { type: "NUMBER", nullable: true },
          loanInterestRate: { type: "NUMBER", nullable: true },
          loanMonthlyRepayment: { type: "NUMBER", nullable: true },
        },
        required: ["stepId", "type", "summary"],
      },
    },
  },
  required: [],
};

/**
 * `${systemPrompt}\n\n${turns}` flattened into a single Gemini text part — callGeminiJSON (see
 * ../parse-inbound-bill/gemini.ts) takes "parts" the way document extraction does, not a chat
 * messages array, so this is plan-mode's equivalent of that file's buildDocumentParts for a
 * document attachment.
 */
export function buildChatParts(systemPrompt: string, turns: { role: "user" | "assistant"; content: string }[]): Record<string, unknown>[] {
  const transcript = turns.map((t) => `${t.role === "user" ? "Landlord" : "Assistant"}: ${t.content}`).join("\n\n");
  return [{ text: `${systemPrompt}\n\n${transcript}` }];
}

