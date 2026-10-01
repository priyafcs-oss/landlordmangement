import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { PropertyDialog, TenantDialog } from "@/components/PropertyShared";
import { AddLoanDialog } from "@/components/AddLoanDialog";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { resolvePropertyRef, stepHasPropertyRef } from "@/lib/aiPlanExecutor";
import type { AiPlanStep } from "@/lib/aiPlanTypes";

/**
 * Renders a copilot-chat "plan" response (src/routes/copilot.tsx) as an ordered, approvable step
 * list instead of a chat bubble. Each row opens the SAME real Add dialog a manual entry would
 * use, pre-filled from the AI's understanding of the request — only that dialog's own Save button
 * actually creates anything; the assistant itself never writes to the database. A step targeting
 * a property an earlier step in this same plan is creating stays disabled ("Waiting on step N")
 * until that earlier step is actually saved and returns its real id — nothing is ever resolved
 * ahead of time, since nothing exists until a human approves it.
 *
 * Step statuses live only in this component's local state, not persisted anywhere — consistent
 * with this feature's "plans are ephemeral, only what's actually run is durable" design. A page
 * refresh losing an un-run plan is cheap to recover from (just ask again); a step that DID run
 * already left behind an ordinary, independently-valid real row, so a later step failing or being
 * abandoned is never rolled back.
 */
export function AiPlanStepList({ steps: initialSteps }: { steps: AiPlanStep[] }) {
  const { state } = useStore();
  const [steps, setSteps] = useState<AiPlanStep[]>(initialSteps);

  const resolvedIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of steps) if (s.status === "done" && s.resultId) map.set(s.stepId, s.resultId);
    return map;
  }, [steps]);

  const markDone = (stepId: string, resultId: string) =>
    setSteps((prev) => prev.map((s) => (s.stepId === stepId ? { ...s, status: "done", resultId } : s)));

  return (
    <div className="max-w-[85%] space-y-2 rounded-2xl border bg-muted/40 p-3">
      <div className="text-xs font-medium text-muted-foreground">Proposed steps — review and run each one</div>
      {steps.map((step, i) => {
        const ready = !stepHasPropertyRef(step) || !!resolvePropertyRef(step.propertyRef, state.properties, resolvedIds);
        const blockedOnStepId = !ready && stepHasPropertyRef(step) && step.propertyRef.startsWith("$") ? step.propertyRef.slice(1) : undefined;
        const blockedOnIndex = blockedOnStepId ? steps.findIndex((s) => s.stepId === blockedOnStepId) : -1;

        return (
          <div key={step.stepId} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2.5">
            <div className="flex items-center gap-2 text-sm">
              {step.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : step.status === "failed" ? (
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span>
                <span className="font-medium">Step {i + 1}.</span> {step.summary}
              </span>
            </div>
            {step.status === "done" ? (
              <Badge variant="secondary" className="shrink-0">
                Done
              </Badge>
            ) : !ready ? (
              <Badge variant="outline" className="shrink-0 text-xs">
                Waiting on step {blockedOnIndex >= 0 ? blockedOnIndex + 1 : "?"}
              </Badge>
            ) : (
              <StepRunner step={step} resolvedIds={resolvedIds} onDone={(id) => markDone(step.stepId, id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepRunner({ step, resolvedIds, onDone }: { step: AiPlanStep; resolvedIds: Map<string, string>; onDone: (resultId: string) => void }) {
  const { state } = useStore();

  if (step.type === "create_property") {
    return (
      <PropertyDialog
        property={null}
        onDone={() => {}}
        initialAddress={step.address}
        onCreated={onDone}
        trigger={<Button size="sm">Create property</Button>}
      />
    );
  }

  // Every other v1 step type has a propertyRef — resolved here rather than trusted from the
  // parent's "ready" check, since that check and this render can't share narrowing across a
  // component boundary. Returns null (renders nothing) only if genuinely not resolvable, which
  // the parent's own "ready" gate already prevents from being reached in practice.
  const propertyId = resolvePropertyRef(step.propertyRef, state.properties, resolvedIds);
  if (!propertyId) return null;

  if (step.type === "create_tenant") {
    return (
      <TenantDialog
        propertyId={propertyId}
        initialValues={{
          name: step.tenantName,
          email: step.tenantEmail,
          phone: step.tenantPhone,
          rentAmount: step.rentAmount,
          rentFrequency: step.rentFrequency,
          leaseStart: step.leaseStart,
          leaseExpiry: step.leaseExpiry,
          leaseDuration: step.leaseDuration,
          bondAmount: step.bondAmount,
        }}
        onSaved={onDone}
      >
        <Button size="sm">Create tenant</Button>
      </TenantDialog>
    );
  }

  if (step.type === "add_loan") {
    return (
      <AddLoanDialog
        propertyId={propertyId}
        initialValues={{ bankName: step.lenderName, originalAmount: step.amount, interestRate: step.interestRate, monthlyEmi: step.monthlyRepayment }}
        onCreated={onDone}
        trigger={<Button size="sm">Add loan</Button>}
      />
    );
  }

  // add_expense — AddTransactionDialog's line-item form shape doesn't map onto a single flat
  // initialValues prop the way the other three dialogs' simpler forms do; the step's own summary
  // text above already shows what to enter, and the dialog opens with just the property locked.
  return <AddTransactionDialog propertyId={propertyId} trigger={<Button size="sm">Add expense</Button>} onSaved={onDone} />;
}
