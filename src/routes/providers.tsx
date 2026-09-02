import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Users2, Plus, ChevronRight, GitMerge } from "lucide-react";
import { ProviderDialog } from "@/components/PropertyShared";
import type { AppState, Provider } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/providers")({
  head: () => ({
    meta: [
      { title: "Providers — Landlord OS" },
      {
        name: "description",
        content: "Every council, agent, insurer and trade contact across the portfolio, with cross-property payment history.",
      },
    ],
  }),
  component: ProvidersPage,
});

/** Every property this provider is associated with — tagged via provider_properties (the join
 * table findOrCreateProvider/ensureProviderProperty populate whenever a provider is linked from
 * anywhere: a Tenancy tab agent, a statement/bill vendor, a manually entered expense), UNIONED
 * with properties it's actually been paid on according to expenses/bills carrying its providerId
 * FK. The FK alone used to be the only source here, but that field is rarely populated — most
 * paths only ever set the plain-text providerName on an Expense/Bill, matching by name, not the
 * FK — so a provider linked everywhere else in the app still showed "No linked properties yet". */
export function linkedPropertyIds(state: AppState, providerId: string): string[] {
  const ids = new Set<string>();
  for (const pp of state.providerProperties) if (pp.providerId === providerId) ids.add(pp.propertyId);
  for (const e of state.expenses) if (e.providerId === providerId && e.propertyId) ids.add(e.propertyId);
  for (const b of state.bills) if (b.providerId === providerId && b.propertyId) ids.add(b.propertyId);
  return Array.from(ids);
}

function ProviderListRow({ provider }: { provider: Provider }) {
  const { state } = useStore();
  const addresses = linkedPropertyIds(state, provider.id)
    .map((id) => state.properties.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => p.alias || p.address);
  const details = [provider.phone, provider.email].filter(Boolean).join(" · ");

  return (
    <Link
      to="/providers/$providerId"
      params={{ providerId: provider.id }}
      className="flex items-center justify-between gap-3 rounded border p-3 text-sm hover:bg-muted/50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{provider.name}</span>
          <Badge variant="secondary" className="text-[10px]">
            {provider.role}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {details && <span>{details}</span>}
          {provider.abn && <span>ABN {provider.abn}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {addresses.length === 0 ? "No linked properties yet" : addresses.join(", ")}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * Fixes a duplicate real-world business that ended up as two separate Provider rows — the same
 * agency added from two different properties' Providers tabs before findOrCreateProvider deduped
 * portfolio-wide, or a name typed two slightly different ways. Picks a survivor, re-points every
 * reference (provider_agreements, provider_properties, expenses, property_bills,
 * maintenance_items, provider_documents) from the other row onto the survivor via
 * store.mergeProviders, then deletes the duplicate. Deliberately simple — a landlord tool for a
 * rare cleanup, not a polished flow — but the underlying merge is done correctly and safely (see
 * mergeProviders in store.tsx).
 */
function MergeProvidersDialog() {
  const { state, mergeProviders } = useStore();
  const [open, setOpen] = useState(false);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [survivor, setSurvivor] = useState<"a" | "b">("a");

  const a = state.providers.find((p) => p.id === aId);
  const b = state.providers.find((p) => p.id === bId);
  const sorted = [...state.providers].sort((x, y) => x.name.localeCompare(y.name));

  const merge = () => {
    if (!a || !b) return toast.error("Pick both providers to merge");
    if (a.id === b.id) return toast.error("Pick two different providers");
    const survivorId = survivor === "a" ? a.id : b.id;
    const duplicateId = survivor === "a" ? b.id : a.id;
    mergeProviders(survivorId, duplicateId);
    toast.success(`Merged "${survivor === "a" ? b.name : a.name}" into "${survivor === "a" ? a.name : b.name}"`);
    setOpen(false);
    setAId("");
    setBId("");
    setSurvivor("a");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <GitMerge className="h-4 w-4" /> Merge providers
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge two providers</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Use this when the same real-world business ended up as two separate contacts. Every agreement, property tag,
          expense, bill, maintenance item and document on the one you don't keep moves onto the one you do, then the
          duplicate is deleted. This can't be undone.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Provider A</Label>
            <Select value={aId} onValueChange={setAId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={p.id === bId}>
                    {p.name} ({p.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Provider B</Label>
            <Select value={bId} onValueChange={setBId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={p.id === aId}>
                    {p.name} ({p.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {a && b && (
            <div className="space-y-1">
              <Label className="text-xs">Keep which one?</Label>
              <RadioGroup value={survivor} onValueChange={(v) => setSurvivor(v as "a" | "b")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="a" id="survivor-a" />
                  <Label htmlFor="survivor-a" className="text-sm font-normal">
                    {a.name} — delete {b.name}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="b" id="survivor-b" />
                  <Label htmlFor="survivor-b" className="text-sm font-normal">
                    {b.name} — delete {a.name}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!a || !b} onClick={merge}>
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProvidersContent() {
  const { state } = useStore();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...state.providers].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q) || (p.abn ?? "").toLowerCase().includes(q),
    );
  }, [state.providers, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-xs text-muted-foreground">
            Every council, agent, insurer and trade contact across the portfolio — bills and payment history roll up here
            regardless of which property they were on.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <MergeProvidersDialog />
          <ProviderDialog>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Add provider
            </Button>
          </ProviderDialog>
        </div>
      </div>

      <Input placeholder="Search by name, role, or ABN…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Users2 className="mx-auto mb-2 h-6 w-6" />
            {state.providers.length === 0 ? "No providers yet." : "No providers match this search."}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((p) => (
          <ProviderListRow key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

function ProvidersPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <ProvidersContent />
    </div>
  );
}
