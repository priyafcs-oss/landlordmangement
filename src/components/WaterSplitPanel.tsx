import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtCurrency } from "@/lib/calculations";
import { splitWaterTotal } from "@/lib/waterSplit";

/** Shown on a water bill with no usage line (typically a "your eBill is ready" email that only
 * carries the total) — the landlord types the usage charge from the bill and it's split into a
 * fixed line and a rechargeable usage line. Pre-filled from the last itemised bill's fixed charges
 * when there is one. */
export function WaterSplitPanel({
  total,
  lastFixed,
  hasDocument,
  onSplit,
}: {
  total: number;
  lastFixed: number | null;
  hasDocument: boolean;
  onSplit: (lines: { description: string; amount: number; kind: "fixed" | "usage" }[]) => void;
}) {
  const suggested = lastFixed !== null && lastFixed < total ? (total - lastFixed).toFixed(2) : "";
  const [usage, setUsage] = useState(suggested);
  useEffect(() => setUsage(suggested), [suggested]);

  const split = () => {
    const lines = splitWaterTotal(total, parseFloat(usage));
    if (!lines) return toast.error(`Enter a usage amount between $0 and ${fmtCurrency(total)}`);
    onSplit(lines);
  };

  return (
    <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
      <div className="flex items-start gap-1">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          This water bill isn't split into usage and fixed charges. Only <b>usage</b> can be
          recharged to the tenant.
          {hasDocument
            ? " Enter the usage charge from the bill to split it."
            : " The email only had the total. Download the bill PDF from the provider and drop it above to split it automatically, or enter the usage charge here."}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="shrink-0">Usage charges</span>
        <Input
          type="number"
          step="0.01"
          className="h-7 w-28 bg-background text-xs"
          value={usage}
          onChange={(e) => setUsage(e.target.value)}
          placeholder="0.00"
        />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={split}>
          Split
        </Button>
      </div>
      {suggested && (
        <div className="text-amber-800">
          Suggested from your last itemised bill's fixed charges ({fmtCurrency(lastFixed!)}). Check
          it against the bill.
        </div>
      )}
    </div>
  );
}
