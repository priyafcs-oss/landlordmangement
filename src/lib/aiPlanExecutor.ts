import type { AiPlanStep } from "@/lib/aiPlanTypes";
import type { Property } from "@/lib/types";

/** Every step type that targets a property carries a propertyRef — narrows the union for the
 * helpers below without each call site re-checking which step types have one. */
export type StepWithPropertyRef = Extract<AiPlanStep, { propertyRef: string }>;

export function stepHasPropertyRef(step: AiPlanStep): step is StepWithPropertyRef {
  return step.type !== "create_property";
}

/**
 * Resolves a step's propertyRef to a real property id — either:
 * - a "$stepN" placeholder, resolved from `resolvedIds` (the real id an EARLIER step's own dialog
 *   actually produced once it was saved — never guessed or reserved ahead of time, since nothing
 *   exists until a human clicks that dialog's Save), or
 * - a plain address, fuzzy-matched against the landlord's own existing properties.
 * Returns undefined when it can't be resolved yet (a "$stepN" whose step hasn't run) or at all
 * (an address that matches nothing) — the caller (AiPlanStepList) shows the step as blocked
 * rather than letting it open a dialog with no property to attach to.
 */
export function resolvePropertyRef(ref: string, properties: Property[], resolvedIds: Map<string, string>): string | undefined {
  if (ref.startsWith("$")) return resolvedIds.get(ref.slice(1));
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = properties.find((p) => p.address.trim().toLowerCase() === needle);
  if (exact) return exact.id;
  const partial = properties.find((p) => p.address.toLowerCase().includes(needle) || needle.includes(p.address.toLowerCase()));
  return partial?.id;
}

/** Whether this step's dependencies (so far, just its propertyRef) are satisfied enough to open
 * its dialog right now. A create_property step has no dependency and is always ready. */
export function isStepReady(step: AiPlanStep, properties: Property[], resolvedIds: Map<string, string>): boolean {
  if (!stepHasPropertyRef(step)) return true;
  return !!resolvePropertyRef(step.propertyRef, properties, resolvedIds);
}
