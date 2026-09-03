import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { Entity, EntityOwner, EntityType } from "@/lib/types";
import { toast } from "sonner";

const ENTITY_TYPES: EntityType[] = ["Individual", "Joint", "Trust", "SMSF", "Company"];

/** Add/edit form for an ownership entity — used both from the Entities list and an entity's own
 * detail page, so kept as a shared component rather than duplicated per caller. */
export function EntityDialog({ entity, children }: { entity?: Entity; children: React.ReactNode }) {
  const { addEntity, updateEntity } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entity?.name ?? "");
  const [type, setType] = useState<EntityType>(entity?.type ?? "Individual");
  const [owners, setOwners] = useState<EntityOwner[]>(
    entity?.owners?.length ? entity.owners : [{ name: "", percent: 100 }],
  );
  const [notes, setNotes] = useState(entity?.notes ?? "");

  const totalPercent = owners.reduce((sum, o) => sum + (Number(o.percent) || 0), 0);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setName(entity?.name ?? "");
      setType(entity?.type ?? "Individual");
      setOwners(entity?.owners?.length ? entity.owners : [{ name: "", percent: 100 }]);
      setNotes(entity?.notes ?? "");
    }
  };

  const save = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const cleanOwners = owners
      .filter((o) => o.name.trim())
      .map((o) => ({ name: o.name.trim(), percent: Number(o.percent) || 0 }));
    const payload = {
      name: name.trim(),
      type,
      owners: cleanOwners,
      notes: notes.trim() || undefined,
    };
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity ? "Edit entity" : "Add entity"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Manish & Priya Jain"
              />
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
                <span
                  className={`text-xs ${totalPercent !== 100 ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  Total {totalPercent}%
                </span>
              )}
            </div>
            {owners.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={o.name}
                  onChange={(e) =>
                    setOwners((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="Owner name"
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={o.percent}
                  onChange={(e) =>
                    setOwners((prev) =>
                      prev.map((x, idx) =>
                        idx === i ? { ...x, percent: Number(e.target.value) } : x,
                      ),
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
