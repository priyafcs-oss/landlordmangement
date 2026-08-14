import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles, ClipboardCheck, TriangleAlert, CalendarClock, FileText } from "lucide-react";
import { toast } from "sonner";
import { todayISO, daysUntil, inspectionDueStatus } from "@/lib/calculations";
import type { Inspection, ChecklistItem, ChecklistRoom, Property } from "@/lib/types";
import { DEFAULT_INSPECTION_ROOMS } from "@/lib/types";

export const Route = createFileRoute("/inspections")({
  head: () => ({
    meta: [
      { title: "Inspections — Landlord OS" },
      { name: "description", content: "Schedule, track and report on property inspections." },
    ],
  }),
  component: InspectionsPage,
});

function InspectionsPage() {
  const { state } = useStore();

  const dueList = state.properties
    .map((p) => ({ property: p, status: inspectionDueStatus(p.id, state.inspections) }))
    .sort((a, b) => (a.status.daysSinceLast ?? Infinity) < (b.status.daysSinceLast ?? Infinity) ? 1 : -1)
    .filter((r) => r.status.overdue || (r.status.dueDate && daysUntil(r.status.dueDate) <= 30));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inspections</h1>
          <p className="text-sm text-muted-foreground">
            Due dates, batch scheduling and inspection reports across your portfolio.
          </p>
        </div>
        <div className="flex gap-2">
          <BatchScheduleDialog />
          <InspectionFormDialog>
            <Button variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> Log Inspection
            </Button>
          </InspectionFormDialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
            Due &amp; overdue ({dueList.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dueList.length === 0 && (
            <div className="text-sm text-muted-foreground">Nothing due in the next 30 days.</div>
          )}
          {dueList.map(({ property, status }) => (
            <div key={property.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{property.alias || property.address}</div>
                <div className="text-xs text-muted-foreground">
                  {status.last
                    ? `Last inspected ${status.last.date} (${status.daysSinceLast} days ago)`
                    : "No inspection on record"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={status.overdue ? "destructive" : "outline"}>
                  {status.overdue
                    ? "Overdue"
                    : status.dueDate
                      ? `Due in ${daysUntil(status.dueDate)} days`
                      : "Due"}
                </Badge>
                <InspectionFormDialog defaultPropertyId={property.id}>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    <CalendarClock className="h-3 w-3" /> Schedule
                  </Button>
                </InspectionFormDialog>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {state.properties.map((property) => (
          <PropertyInspectionGroup key={property.id} property={property} />
        ))}
      </div>
    </div>
  );
}

function PropertyInspectionGroup({ property }: { property: Property }) {
  const { state } = useStore();
  const inspections = state.inspections
    .filter((i) => i.propertyId === property.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const status = inspectionDueStatus(property.id, state.inspections);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{property.alias || property.address}</span>
          <Badge variant={status.overdue ? "destructive" : "outline"} className="text-xs font-normal">
            {status.last ? `Last inspected ${status.last.date}` : "Never inspected"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {inspections.length === 0 && (
          <div className="text-sm text-muted-foreground">No inspections logged for this property yet.</div>
        )}
        {inspections.map((i) => {
          const failed = (i.checklist ?? []).filter((c) => c.result === "Fail");
          return (
            <div key={i.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{i.type} Inspection</span>
                  <Badge variant={i.status === "Completed" ? "secondary" : "outline"}>{i.status}</Badge>
                  {failed.length > 0 && <Badge variant="destructive">{failed.length} issue(s)</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <InspectionFormDialog inspection={i}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      {i.status === "Scheduled" ? "Complete" : "Edit"}
                    </Button>
                  </InspectionFormDialog>
                  <ReportViewDialog inspection={i} propertyLabel={property.alias || property.address} />
                  <DeleteInspectionButton id={i.id} />
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{i.date}</div>
              {failed.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-destructive">
                  {failed.slice(0, 3).map((f, idx) => (
                    <li key={idx}>
                      {f.label}
                      {f.notes ? ` — ${f.notes}` : ""}
                    </li>
                  ))}
                  {failed.length > 3 && <li>+{failed.length - 3} more</li>}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DeleteInspectionButton({ id }: { id: string }) {
  const { deleteInspection } = useStore();
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={() => {
        deleteInspection(id);
        toast.success("Inspection removed");
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

/** Select multiple properties + one date + one type — creates a lightweight "Scheduled" stub for each, so a full day of inspections can be booked in one action. */
function BatchScheduleDialog() {
  const { state, addInspection } = useStore();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<Inspection["type"]>("Routine");

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      const dueIds = state.properties
        .filter((p) => inspectionDueStatus(p.id, state.inspections).overdue)
        .map((p) => p.id);
      setSelected(new Set(dueIds));
      setDate(todayISO());
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    if (selected.size === 0) return toast.error("Select at least one property");
    const rooms: ChecklistRoom[] = DEFAULT_INSPECTION_ROOMS[type].map((r) => ({
      name: r.name,
      items: r.items.map((i) => ({ ...i })),
    }));
    for (const propertyId of selected) {
      addInspection({ propertyId, date, type, status: "Scheduled", rooms, checklist: [] });
    }
    toast.success(`Scheduled ${selected.size} inspection(s) for ${date}`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <CalendarClock className="h-4 w-4" /> Book Inspections
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book inspections for one day</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Type (loads room template)">
            <Select value={type} onValueChange={(v) => setType(v as Inspection["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Entry">Entry</SelectItem>
                <SelectItem value="Routine">Routine</SelectItem>
                <SelectItem value="Exit">Exit</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Properties (overdue ones pre-selected)</div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {state.properties.map((p) => {
              const status = inspectionDueStatus(p.id, state.inspections);
              return (
                <label key={p.id} className="flex items-center gap-2 rounded p-1.5 text-sm hover:bg-muted/50">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  <span className="flex-1">{p.alias || p.address}</span>
                  {status.overdue && (
                    <Badge variant="destructive" className="text-[10px]">
                      Overdue
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Schedule {selected.size || ""} inspection(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only viewer for a logged inspection — the "quickly access the report" ask. */
function ReportViewDialog({ inspection, propertyLabel }: { inspection: Inspection; propertyLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
          <FileText className="h-3 w-3" /> Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {inspection.type} Inspection — {propertyLabel}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{inspection.date}</span>
            <Badge variant={inspection.status === "Completed" ? "secondary" : "outline"}>{inspection.status}</Badge>
            {inspection.signature && <span>Signed: {inspection.signature}</span>}
          </div>
          {inspection.notes && <div>{inspection.notes}</div>}
          {inspection.fileFileName && inspection.fileData && (
            <a href={inspection.fileData} download={inspection.fileFileName} className="inline-flex items-center gap-1 text-primary underline">
              <FileText className="h-3 w-3" /> {inspection.fileFileName}
            </a>
          )}
          {(inspection.rooms ?? []).map((room, ri) => (
            <div key={ri} className="rounded border">
              <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium">{room.name}</div>
              <div className="divide-y">
                {room.items.map((item, ii) => (
                  <div key={ii} className="flex items-start justify-between gap-2 p-2 text-xs">
                    <div>
                      <div>{item.label}</div>
                      {item.notes && <div className="text-muted-foreground">{item.notes}</div>}
                    </div>
                    {item.result && (
                      <Badge variant={item.result === "Fail" ? "destructive" : "outline"} className="shrink-0">
                        {item.result}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {inspection.photos && inspection.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {inspection.photos.map((p, i) => (
                <img key={i} src={p.data} alt={p.name} className="h-16 w-16 rounded object-cover" />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Create a new inspection, or (when `inspection` is passed) edit/complete an existing one — e.g. filling in the checklist for a batch-scheduled stub. */
function InspectionFormDialog({
  inspection,
  defaultPropertyId,
  children,
}: {
  inspection?: Inspection;
  defaultPropertyId?: string;
  children: React.ReactNode;
}) {
  const { state, addInspection, updateInspection, consumeAiBudget } = useStore();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState(inspection?.propertyId ?? defaultPropertyId ?? state.properties[0]?.id ?? "");
  const [date, setDate] = useState(inspection?.date ?? todayISO());
  const [type, setType] = useState<Inspection["type"]>(inspection?.type ?? "Routine");
  const [status, setStatus] = useState<Inspection["status"]>(inspection?.status ?? "Scheduled");
  const [notes, setNotes] = useState(inspection?.notes ?? "");
  const [signature, setSignature] = useState(inspection?.signature ?? "");
  const [fileFileName, setFileFileName] = useState(inspection?.fileFileName ?? "");
  const [fileData, setFileData] = useState(inspection?.fileData ?? "");
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>(inspection?.photos ?? []);
  const [rooms, setRooms] = useState<ChecklistRoom[]>(
    inspection?.rooms ?? DEFAULT_INSPECTION_ROOMS[type].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })),
  );
  const [newRoom, setNewRoom] = useState("");
  const [analysing, setAnalysing] = useState<string | null>(null);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setPropertyId(inspection?.propertyId ?? defaultPropertyId ?? state.properties[0]?.id ?? "");
      setDate(inspection?.date ?? todayISO());
      setType(inspection?.type ?? "Routine");
      setStatus(inspection?.status ?? "Scheduled");
      setNotes(inspection?.notes ?? "");
      setSignature(inspection?.signature ?? "");
      setFileFileName(inspection?.fileFileName ?? "");
      setFileData(inspection?.fileData ?? "");
      setPhotos(inspection?.photos ?? []);
      setRooms(
        inspection?.rooms ??
          DEFAULT_INSPECTION_ROOMS[inspection?.type ?? "Routine"].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })),
      );
    }
  };

  const onTypeChange = (v: Inspection["type"]) => {
    setType(v);
    if (!inspection) setRooms(DEFAULT_INSPECTION_ROOMS[v].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })));
  };

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFileFileName(f.name);
      setFileData(String(reader.result));
    };
    reader.readAsDataURL(f);
  };

  const onPhotos = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setPhotos((ps) => [...ps, { name: f.name, data: String(reader.result) }]);
      reader.readAsDataURL(f);
    });
  };

  const updateItem = (ri: number, ii: number, patch: Partial<ChecklistItem>) =>
    setRooms((rs) =>
      rs.map((r, i) => (i === ri ? { ...r, items: r.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : r)),
    );

  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return toast.error("Enter a room name");
    setRooms((rs) => [...rs, { name, items: [] }]);
    setNewRoom("");
  };
  const removeRoom = (ri: number) => setRooms((rs) => rs.filter((_, i) => i !== ri));
  const addItem = (ri: number) => setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: [...r.items, { label: "" }] } : r)));
  const removeItem = (ri: number, ii: number) =>
    setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: r.items.filter((_, j) => j !== ii) } : r)));

  const itemPhoto = (ri: number, ii: number, f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => updateItem(ri, ii, { photoName: f.name, photoData: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const analysePhoto = async (ri: number, ii: number) => {
    const item = rooms[ri]?.items[ii];
    if (!item?.photoData) return toast.error("Attach a photo to this item first");
    const budget = consumeAiBudget();
    if (!budget.ok) return toast.error(budget.reason ?? "AI unavailable");
    const key = `${ri}-${ii}`;
    setAnalysing(key);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: item.photoData, context: `${rooms[ri]?.name} — ${item.label}` }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { remark } = (await res.json()) as { remark: string };
      updateItem(ri, ii, { notes: remark });
      toast.success("Draft remark added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI analysis failed");
    } finally {
      setAnalysing(null);
    }
  };

  const save = () => {
    if (!propertyId) return toast.error("Property required");
    const flat: ChecklistItem[] = rooms.flatMap((r) =>
      r.items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: `${r.name}: ${i.label}` })),
    );
    const payload = {
      propertyId,
      date,
      type,
      status,
      notes: notes || undefined,
      fileFileName: fileFileName || undefined,
      fileData: fileData || undefined,
      rooms,
      checklist: flat,
      photos,
      signature: signature || undefined,
    };
    if (inspection) updateInspection(inspection.id, payload);
    else addInspection(payload);
    setOpen(false);
    toast.success(inspection ? "Inspection updated" : "Inspection logged");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{inspection ? "Edit inspection" : "New inspection"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Property">
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Type (loads room template)">
            <Select value={type} onValueChange={(v) => onTypeChange(v as Inspection["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Entry">Entry</SelectItem>
                <SelectItem value="Routine">Routine</SelectItem>
                <SelectItem value="Exit">Exit</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as Inspection["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Scheduled">Scheduled</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Condition report PDF">
            <Input type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
            {fileFileName && <div className="mt-1 text-xs text-muted-foreground">📎 {fileFileName}</div>}
          </Field>
          <Field label="General photos">
            <Input type="file" accept="image/*" multiple onChange={(e) => onPhotos(e.target.files)} />
            {photos.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {photos.map((p, i) => (
                  <img key={i} src={p.data} alt={p.name} className="h-10 w-10 rounded object-cover" />
                ))}
              </div>
            )}
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Digital signature (typed name)">
            <Input placeholder="e.g. Alex Landlord" value={signature} onChange={(e) => setSignature(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">{type} room checklist</div>
            <Input
              placeholder="New room name"
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
              className="h-8 max-w-[200px]"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addRoom}>
              <Plus className="h-3 w-3" /> Add room
            </Button>
          </div>

          {rooms.map((room, ri) => (
            <div key={ri} className="rounded border">
              <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
                <Input
                  value={room.name}
                  onChange={(e) => setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, name: e.target.value } : r)))}
                  className="h-7 max-w-[240px] text-sm font-medium"
                />
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => addItem(ri)}>
                  <Plus className="h-3 w-3" /> Item
                </Button>
                <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => removeRoom(ri)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="divide-y">
                {room.items.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">No checklist items — add one.</div>
                )}
                {room.items.map((c, ii) => (
                  <div key={ii} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <Input
                        placeholder="Checklist item"
                        value={c.label}
                        onChange={(e) => updateItem(ri, ii, { label: e.target.value })}
                        className="h-8"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {(["Pass", "Fail", "N/A"] as const).map((r) => (
                          <Button
                            key={r}
                            size="sm"
                            variant={c.result === r ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => updateItem(ri, ii, { result: r })}
                          >
                            {r}
                          </Button>
                        ))}
                        <Input
                          type="file"
                          accept="image/*"
                          className="h-7 max-w-[190px] text-xs"
                          onChange={(e) => itemPhoto(ri, ii, e.target.files?.[0])}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={analysing === `${ri}-${ii}`}
                          onClick={() => analysePhoto(ri, ii)}
                        >
                          <Sparkles className="h-3 w-3" />
                          {analysing === `${ri}-${ii}` ? "Analysing…" : "AI remark"}
                        </Button>
                      </div>
                      <Input
                        placeholder="Condition remarks"
                        value={c.notes ?? ""}
                        onChange={(e) => updateItem(ri, ii, { notes: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      {c.photoData && <img src={c.photoData} alt={c.photoName} className="h-14 w-14 rounded object-cover" />}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeItem(ri, ii)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
