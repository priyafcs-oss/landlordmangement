import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import type { BufferScopeType, CashBuffer } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/buffers")({
  head: () => ({
    meta: [
      { title: "Buffers — Landlord OS" },
      { name: "description", content: "Cash reserve targets, checked against balances you keep updated." },
    ],
  }),
  component: BuffersPage,
});

function monthlyExpenseEstimate(state: ReturnType<typeof useStore>["state"], scopeType: BufferScopeType, scopeId?: string) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const relevant = state.expenses.filter((e) => {
    if (e.date < cutoffIso) return false;
    if (scopeType === "Portfolio") return true;
    if (scopeType === "Asset") return e.assetId === scopeId;
    if (scopeType === "Entity") {
      const asset = state.assets.find((a) => a.id === e.assetId);
      return asset?.ownerEntityId === scopeId;
    }
    return true;
  });
  const total = relevant.reduce((s, e) => s + e.cost, 0);
  return total / 3;
}

function BufferDialog({ buffer, children }: { buffer?: CashBuffer; children?: React.ReactNode }) {
  const { state, addBuffer, updateBuffer } = useStore();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(buffer?.label ?? "");
  const [scopeType, setScopeType] = useState<BufferScopeType>(buffer?.scopeType ?? "Portfolio");
  const [scopeId, setScopeId] = useState(buffer?.scopeId ?? "");
  const [targetAmount, setTargetAmount] = useState(buffer?.targetAmount?.toString() ?? "");
  const [targetMonths, setTargetMonths] = useState(buffer?.targetMonths?.toString() ?? "3");
  const [currentBalance, setCurrentBalance] = useState(buffer?.currentBalance?.toString() ?? "");

  const save = () => {
    if (!label.trim()) return toast.error("Label is required");
    const payload = {
      label: label.trim(),
      scopeType,
      scopeId: scopeType === "Portfolio" ? undefined : scopeId || undefined,
      targetAmount: targetAmount ? parseFloat(targetAmount) : undefined,
      targetMonths: targetMonths ? parseFloat(targetMonths) : undefined,
      currentBalance: parseFloat(currentBalance) || 0,
    };
    if (buffer) {
      updateBuffer(buffer.id, payload);
      toast.success("Buffer updated");
    } else {
      addBuffer(payload);
      toast.success("Buffer added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add buffer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{buffer ? "Edit buffer" : "New buffer"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Portfolio emergency fund" />
            </Field>
          </div>
          <Field label="Scope">
            <Select value={scopeType} onValueChange={(v) => setScopeType(v as BufferScopeType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Portfolio">Whole portfolio</SelectItem>
                <SelectItem value="Entity">One entity</SelectItem>
                <SelectItem value="Asset">One asset</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scopeType === "Entity" && (
            <Field label="Entity">
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger><SelectValue placeholder="Select entity" /></SelectTrigger>
                <SelectContent>
                  {state.entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {scopeType === "Asset" && (
            <Field label="Asset">
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                <SelectContent>
                  {state.assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Target — flat amount (AUD)">
            <Input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Target — months of expenses">
            <Input type="number" value={targetMonths} onChange={(e) => setTargetMonths(e.target.value)} placeholder="optional" />
          </Field>
          <div className="col-span-2">
            <Field label="Current balance (AUD) — update this yourself">
              <Input type="number" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BufferCard({ buffer }: { buffer: CashBuffer }) {
  const { state, deleteBuffer } = useStore();
  const monthlyExpense = monthlyExpenseEstimate(state, buffer.scopeType, buffer.scopeId);
  const monthsCovered = monthlyExpense > 0 ? buffer.currentBalance / monthlyExpense : undefined;
  const target = buffer.targetAmount ?? (buffer.targetMonths ? buffer.targetMonths * monthlyExpense : undefined);
  const coveredPercent = target && target > 0 ? Math.min(100, Math.round((buffer.currentBalance / target) * 100)) : undefined;
  const scopeLabel =
    buffer.scopeType === "Portfolio"
      ? "Whole portfolio"
      : buffer.scopeType === "Entity"
        ? state.entities.find((e) => e.id === buffer.scopeId)?.name ?? "Entity"
        : state.assets.find((a) => a.id === buffer.scopeId)?.name ?? "Asset";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{buffer.label}</div>
            <Badge variant="outline" className="mt-1 text-[10px]">{scopeLabel}</Badge>
          </div>
          <div className="flex gap-1">
            <BufferDialog buffer={buffer}>
              <Button size="icon" variant="ghost" className="h-7 w-7"><Pencil className="h-3 w-3" /></Button>
            </BufferDialog>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                if (confirm(`Delete buffer "${buffer.label}"?`)) {
                  deleteBuffer(buffer.id);
                  toast.success("Buffer deleted");
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Current balance</div>
            <div className="mt-0.5 font-medium">{fmtCurrency(buffer.currentBalance)}</div>
          </div>
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Target</div>
            <div className="mt-0.5 font-medium">
              {target ? fmtCurrency(target) : "—"}
              {buffer.targetMonths ? ` (${buffer.targetMonths}mo)` : ""}
            </div>
          </div>
        </div>
        {coveredPercent !== undefined && (
          <div className="mt-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${coveredPercent >= 100 ? "bg-emerald-500" : coveredPercent >= 50 ? "bg-amber-500" : "bg-destructive"}`}
                style={{ width: `${coveredPercent}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{coveredPercent}% covered</div>
          </div>
        )}
        {monthsCovered !== undefined && (
          <div className="mt-1 text-xs text-muted-foreground">≈ {monthsCovered.toFixed(1)} months of recent expenses</div>
        )}
      </CardContent>
    </Card>
  );
}

function BuffersPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Buffers</h1>
        <p className="text-sm text-muted-foreground">
          Cash reserve targets — you update the balance yourself, this just tracks the target against it.
        </p>
      </div>
      <BuffersContent />
    </div>
  );
}

/** Extracted so the Assets left-nav can embed the same content without the page-level heading. */
export function BuffersContent() {
  const { state } = useStore();

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <BufferDialog />
      </div>

      {state.buffers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mx-auto mb-2 h-6 w-6" />
            No buffers set up yet.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.buffers.map((b) => (
          <BufferCard key={b.id} buffer={b} />
        ))}
      </div>
    </div>
  );
}
