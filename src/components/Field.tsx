import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + input wrapper used throughout every Add/Edit dialog and form tab. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Small label + value tile used on stat/summary rows across property and portfolio pages. */
export function Stat({
  label,
  value,
  strong,
  negative,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md bg-muted p-3", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", strong && "text-base", negative && "text-destructive")}>{value}</div>
    </div>
  );
}
