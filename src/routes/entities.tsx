import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import type { Entity, EntityOwner, EntityType } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/entities")({
  head: () => ({
    meta: [
      { title: "Entities — Landlord OS" },
      { name: "description", content: "Ownership structures — individual, joint, trust or SMSF — and the properties held under each." },
    ],
  }),
  component: EntitiesPage,
});

const ENTITY_TYPES: EntityType[] = ["Individual", "Joint", "Trust", "SMSF", "Company"];

function EntityDialog({ entity, children }: { entity?: Entity; children: React.ReactNode }) {
  const { addEntity, updateEntity } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entity?.name ?? "");
  const [type, setType] = useState<EntityType>(entity?.type ?? "Individual");
  const [owners, setOwners] = useState<EntityOwner[]>(entity?.owners?.length ? entity.owners : [{ name: "", percent: 100 }]);
  const [notes, setNotes] = useState(entity?.notes ?? "");

  const totalPercent = owners.reduce((sum, o) => sum + (Number(o.percent) || 0), 0);

  const save = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const cleanOwners = owners
      .filter((o) => o.name.trim())
      .map((o) => ({ name: o.name.trim(), percent: Number(o.percent) || 0 }));
    const payload = { name: name.trim(), type, owners: cleanOwners, notes: notes.trim() || undefined };
    if (entity) {
      updateEntity(entity.id, payload);
      toast.success("Entity updated");
    } else {
      addEntity(payload);
      toast.success("Entity added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity ? "Edit entity" : "Add entity"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Manish & Priya Jain" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as EntityType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Owners</Label>
              {owners.length > 0 && (
                <span className={`text-xs ${totalPercent !== 100 ? "text-amber-600" : "text-muted-foreground"}`}>
                  Total {totalPercent}%
                </span>
              )}
            </div>
            {owners.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={o.name}
                  onChange={(e) =>
                    setOwners((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="Owner name"
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={o.percent}
                  onChange={(e) =>
                    setOwners((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, percent: Number(e.target.value) } : x)),
                    )
                  }
                  className="w-20"
                  title="Ownership %"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setOwners((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => setOwners((prev) => [...prev, { name: "", percent: 0 }])}
            >
              <Plus className="h-3 w-3" /> Add owner
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntityCard({ entity }: { entity: Entity }) {
  const { state, deleteEntity } = useStore();
  const properties = state.properties.filter((p) => p.entityId === entity.id);
  const propertyIds = properties.map((p) => p.id);
  const value = properties.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const debt = state.loans
    .filter((l) => propertyIds.includes(l.propertyId))
    .reduce((sum, l) => sum + (l.totalBalance || 0), 0);
  const equity = value - debt;

  return (
    <Card>
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
            {entity.notes && <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{entity.notes}</div>}
          </div>
          <div className="flex shrink-0 gap-1">
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
            Ownership structures — individual, joint, trust or SMSF — and the value/debt/equity held under each.
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
            No entities yet. Add one, then assign properties to it from Portfolio Manager.
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
          Unassigned: {unassigned.map((p) => p.alias || p.address).join(", ")} — set an entity on each from Portfolio
          Manager.
        </div>
      )}
    </div>
  );
}
