import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import type { Entity } from "@/lib/types";
import { EntityDialog } from "@/components/EntityDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/entities")({
  head: () => ({
    meta: [
      { title: "Entities — Landlord OS" },
      {
        name: "description",
        content:
          "Ownership structures — individual, joint, trust or SMSF — and the properties held under each.",
      },
    ],
  }),
  component: EntitiesPage,
});

function EntityCard({ entity }: { entity: Entity }) {
  const { state, deleteEntity } = useStore();
  const navigate = useNavigate();
  const properties = state.properties.filter((p) => p.entityId === entity.id);
  const propertyIds = properties.map((p) => p.id);
  const value = properties.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const debt = state.loans
    .filter((l) => propertyIds.includes(l.propertyId))
    .reduce((sum, l) => sum + (l.totalBalance || 0), 0);
  const equity = value - debt;

  return (
    <Card
      role="button"
      tabIndex={0}
      className="cursor-pointer transition-colors hover:bg-muted/40"
      onClick={() => void navigate({ to: "/entities/$entityId", params: { entityId: entity.id } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void navigate({ to: "/entities/$entityId", params: { entityId: entity.id } });
        }
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{entity.name}</span>
              <Badge variant="secondary">{entity.type}</Badge>
            </div>
            {entity.owners.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {entity.owners.map((o) => `${o.name} ${o.percent}%`).join(" · ")}
              </div>
            )}
            {entity.notes && (
              <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                {entity.notes}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
            <EntityDialog entity={entity}>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <Pencil className="h-3 w-3" />
              </Button>
            </EntityDialog>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                if (
                  confirm(
                    properties.length > 0
                      ? `Delete "${entity.name}"? ${properties.length} propert${properties.length === 1 ? "y" : "ies"} linked to it will become unassigned.`
                      : `Delete "${entity.name}"?`,
                  )
                ) {
                  deleteEntity(entity.id);
                  toast.success("Entity deleted");
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Value</div>
            <div className="mt-0.5 font-medium">{fmtCurrency(value)}</div>
          </div>
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Debt</div>
            <div className="mt-0.5 font-medium">{fmtCurrency(debt)}</div>
          </div>
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Equity</div>
            <div className="mt-0.5 font-medium">{fmtCurrency(equity)}</div>
          </div>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {properties.length === 0
            ? "No properties assigned."
            : properties.map((p) => p.alias || p.address).join(", ")}
        </div>
      </CardContent>
    </Card>
  );
}

function EntitiesPage() {
  const { state } = useStore();
  const unassigned = state.properties.filter((p) => !p.entityId);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entities</h1>
          <p className="text-sm text-muted-foreground">
            Ownership structures — individual, joint, trust or SMSF — and the value/debt/equity held
            under each.
          </p>
        </div>
        <EntityDialog>
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add entity
          </Button>
        </EntityDialog>
      </div>

      {state.entities.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Building2 className="mx-auto mb-2 h-6 w-6" />
            No entities yet. Add one, then assign properties to it from Assets.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {state.entities.map((e) => (
          <EntityCard key={e.id} entity={e} />
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Unassigned: {unassigned.map((p) => p.alias || p.address).join(", ")} — set an entity on
          each from Portfolio Manager.
        </div>
      )}
    </div>
  );
}
