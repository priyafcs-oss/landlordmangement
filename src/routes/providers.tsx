import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Users2, Plus, ChevronRight } from "lucide-react";
import { ProviderDialog } from "@/components/PropertyShared";
import type { AppState, Provider } from "@/lib/types";

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

/** Every property this provider has ever been paid on, derived from expenses/bills carrying its
 * providerId — deliberately not a stored join table (see the migration's own note). */
export function linkedPropertyIds(state: AppState, providerId: string): string[] {
  const ids = new Set<string>();
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
          {!provider.propertyId && (
            <Badge variant="outline" className="text-[10px]">
              Portfolio-wide
            </Badge>
          )}
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
        <ProviderDialog>
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add provider
          </Button>
        </ProviderDialog>
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
