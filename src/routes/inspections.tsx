import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Plus,
  Trash2,
  Sparkles,
  ClipboardCheck,
  TriangleAlert,
  CalendarClock,
  FileText,
  CheckCircle2,
  Wrench,
  Mail,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { todayISO, daysUntil, inspectionDueStatus, addMonths, propertyInspectionCadenceDays } from "@/lib/calculations";
import { openGmailCompose } from "@/lib/emailPdf";
import type { Inspection, InspectionIssue, ChecklistItem, ChecklistRoom, Property, Tenant } from "@/lib/types";
import { DEFAULT_INSPECTION_ROOMS } from "@/lib/types";
import { DocumentLink } from "@/components/DocumentLink";

export const Route = createFileRoute("/inspections")({
  head: () => ({
    meta: [
      { title: "Inspections — Landlord OS" },
      { name: "description", content: "Book inspections, track due dates, upload reports and flag issues." },
    ],
  }),
  component: InspectionsPage,
});

function currentTenantOf(propertyId: string, tenants: Tenant[]): Tenant | undefined {
  return tenants.find((t) => t.propertyId === propertyId);
}

function InspectionsPage() {
  const { state } = useStore();

  const overdueScheduled = state.inspections.filter(
    (i) => i.status === "Scheduled" && i.date < todayISO(),
  );
  const overdueProperties = state.properties.filter((p) => {
    if (overdueScheduled.some((i) => i.propertyId === p.id)) return false; // already counted above
    return (
      inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p)).overdue &&
      !hasFutureScheduled(p.id, state.inspections)
    );
  });

  const upcoming = state.inspections
    .filter((i) => i.status === "Scheduled" && i.date >= todayISO())
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inspections</h1>
          <p className="text-sm text-muted-foreground">
            Book inspections, track what's due, upload reports and flag issues.
          </p>
        </div>
        <BookInspectionDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="h-4 w-4 text-destructive" />
            Overdue ({overdueScheduled.length + overdueProperties.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {overdueScheduled.length === 0 && overdueProperties.length === 0 && (
            <div className="text-sm text-muted-foreground">Nothing overdue.</div>
          )}
          {overdueScheduled.map((i) => (
            <InspectionRow key={i.id} inspection={i} overdue />
          ))}
          {overdueProperties.map((p) => {
            const status = inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p));
            const tenant = currentTenantOf(p.id, state.tenants);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div>
                  <div className="font-medium">{p.alias || p.address}</div>
                  <div className="text-xs text-muted-foreground">
                    {tenant?.name ?? "No tenant"} •{" "}
                    {status.last ? `Last inspected ${status.last.date}` : "No inspection on record"}
                  </div>
                </div>
                <BookInspectionDialog defaultPropertyId={p.id} trigger={<Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><CalendarClock className="h-3 w-3" /> Book</Button>} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            Upcoming ({upcoming.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 && <div className="text-sm text-muted-foreground">Nothing booked yet.</div>}
          {upcoming.map((i) => (
            <InspectionRow key={i.id} inspection={i} />
          ))}
        </CardContent>
      </Card>

      <CalendarOverview />

      <div className="space-y-3">
        {state.properties.map((property) => (
          <PropertyInspectionGroup key={property.id} property={property} />
        ))}
      </div>
    </div>
  );
}

/** Month-grid view — each day is colour-coded by the "worst" status among that day's inspections (overdue > scheduled > completed), so clustering and gaps are visible at a glance. Click a day to see (and act on) what's booked. */
function CalendarOverview() {
  const { state } = useStore();
  const [selected, setSelected] = useState<Date | undefined>(undefined);

  const byDay = new Map<string, Inspection[]>();
  for (const i of state.inspections) {
    if (!i.date) continue;
    const list = byDay.get(i.date) ?? [];
    list.push(i);
    byDay.set(i.date, list);
  }

  const overdueDates: Date[] = [];
  const scheduledDates: Date[] = [];
  const completedDates: Date[] = [];
  for (const [date, items] of byDay) {
    const d = new Date(date);
    if (items.some((i) => i.status === "Scheduled" && i.date < todayISO())) overdueDates.push(d);
    else if (items.some((i) => i.status === "Scheduled")) scheduledDates.push(d);
    else completedDates.push(d);
  }

  // Local-date formatting, not toISOString(): the calendar hands back a local-midnight Date, and
  // converting that to UTC would roll it back a day for any positive UTC offset (e.g. Australia).
  const selectedIso = selected
    ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
    : undefined;
  const selectedInspections = selectedIso ? (byDay.get(selectedIso) ?? []) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 lg:flex-row">
        <div>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            modifiers={{ overdue: overdueDates, scheduled: scheduledDates, completed: completedDates }}
            modifiersClassNames={{
              overdue: "bg-destructive/20 rounded-md",
              scheduled: "bg-blue-500/15 rounded-md",
              completed: "bg-emerald-500/15 rounded-md",
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" /> Overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500/60" /> Scheduled
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" /> Completed
            </span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="text-sm font-medium">{selected ? selected.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : "Select a day to see what's booked"}</div>
          {selected && selectedInspections.length === 0 && (
            <div className="text-sm text-muted-foreground">Nothing booked this day.</div>
          )}
          {selectedInspections.map((i) => (
            <InspectionRow key={i.id} inspection={i} overdue={i.status === "Scheduled" && i.date < todayISO()} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function hasFutureScheduled(propertyId: string, inspections: Inspection[]): boolean {
  return inspections.some((i) => i.propertyId === propertyId && i.status === "Scheduled" && i.date >= todayISO());
}

/** When a property has an inspection frequency set, completing an inspection books the next one automatically. */
function autoBookNext(
  completed: Inspection,
  properties: Property[],
  inspections: Inspection[],
  addInspection: (i: Omit<Inspection, "id">) => void,
) {
  const property = properties.find((p) => p.id === completed.propertyId);
  const freq = property?.inspectionFrequencyMonths;
  if (!freq || hasFutureScheduled(completed.propertyId, inspections)) return;
  addInspection({
    propertyId: completed.propertyId,
    tenantId: completed.tenantId,
    date: addMonths(completed.date, freq),
    type: completed.type,
    status: "Scheduled",
  });
  toast.success(`Next inspection auto-booked for ${addMonths(completed.date, freq)}`);
}

/** One line in the Overdue/Upcoming lists — property, tenant, date, and the three actions the user asked for: done, reschedule, view. */
function InspectionRow({ inspection, overdue }: { inspection: Inspection; overdue?: boolean }) {
  const { state, updateInspection, addInspection } = useStore();
  const property = state.properties.find((p) => p.id === inspection.propertyId);
  const tenant = state.tenants.find((t) => t.id === inspection.tenantId) ?? currentTenantOf(inspection.propertyId, state.tenants);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState(inspection.date);

  const markDone = () => {
    updateInspection(inspection.id, { status: "Completed" });
    autoBookNext(inspection, state.properties, state.inspections, addInspection);
    toast.success("Marked as done");
  };

  const saveReschedule = () => {
    updateInspection(inspection.id, { date: newDate });
    setRescheduling(false);
    toast.success(`Rescheduled to ${newDate}`);
  };

  const emailTenant = () => {
    if (!tenant?.email) return toast.error("This tenant has no email on file");
    const propertyLabel = property?.alias || property?.address || "";
    openGmailCompose(
      tenant.email,
      `Upcoming ${inspection.type.toLowerCase()} inspection — ${propertyLabel}`,
      `Hi ${tenant.name},\n\nJust a heads up that a ${inspection.type.toLowerCase()} inspection is scheduled for ${inspection.date} at ${propertyLabel}.\n\nPlease let us know if this time doesn't work.\n\nThanks,\n${state.landlordProfile.fullName || "The Landlord"}`,
    );
  };

  const daysAway = daysUntil(inspection.date);

  return (
    <div className={`rounded-md border p-3 text-sm ${overdue ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{property?.alias || property?.address}</div>
          <div className="text-xs text-muted-foreground">
            {tenant?.name ?? "No tenant"} • {inspection.type} • {inspection.date}
            {overdue && " — overdue"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {overdue ? (
            <Badge variant="destructive">Overdue</Badge>
          ) : (
            <Badge variant={daysAway <= 7 ? "destructive" : "outline"}>
              {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
            </Badge>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={markDone}>
            <CheckCircle2 className="h-3 w-3" /> Done
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setRescheduling((r) => !r)}>
            <CalendarClock className="h-3 w-3" /> Reschedule
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={emailTenant}>
            <Mail className="h-3 w-3" /> Email tenant
          </Button>
          <InspectionDetailDialog inspection={inspection}>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
              View
            </Button>
          </InspectionDetailDialog>
        </div>
      </div>
      {rescheduling && (
        <div className="mt-2 flex items-center gap-2">
          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-8 w-40" />
          <Button size="sm" className="h-8" onClick={saveReschedule}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function PropertyInspectionGroup({ property }: { property: Property }) {
  const { state } = useStore();
  const inspections = state.inspections
    .filter((i) => i.propertyId === property.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const status = inspectionDueStatus(property.id, state.inspections, propertyInspectionCadenceDays(property));
  const [open, setOpen] = useState(false);

  if (inspections.length === 0) return null;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{property.alias || property.address}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                {status.last ? `Last inspected ${status.last.date}` : "Never inspected"} • {inspections.length} record(s)
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2">
            {inspections.map((i) => {
              const openIssues = (i.issues ?? []).filter((iss) => iss.status !== "Resolved");
              return (
                <div key={i.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{i.type} Inspection</span>
                      <Badge variant={i.status === "Completed" ? "secondary" : "outline"}>{i.status}</Badge>
                      {openIssues.length > 0 && <Badge variant="destructive">{openIssues.length} open issue(s)</Badge>}
                      {i.fileFileName && <Badge variant="outline">📎 Report</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      <InspectionDetailDialog inspection={i}>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          Open
                        </Button>
                      </InspectionDetailDialog>
                      <DeleteInspectionButton id={i.id} />
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{i.date}</div>
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
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

/** Lightweight booking only — property, tenant (auto), date, type. No checklist prompts. Supports booking several properties for one day at once. */
function BookInspectionDialog({
  defaultPropertyId,
  trigger,
}: {
  defaultPropertyId?: string;
  trigger?: React.ReactNode;
}) {
  const { state, addInspection } = useStore();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<Inspection["type"]>("Routine");

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      const preselect = defaultPropertyId
        ? [defaultPropertyId]
        : state.properties
            .filter((p) => inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p)).overdue)
            .map((p) => p.id);
      setSelected(new Set(preselect));
      setDate(todayISO());
      setType("Routine");
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
    for (const propertyId of selected) {
      const tenant = currentTenantOf(propertyId, state.tenants);
      addInspection({ propertyId, tenantId: tenant?.id, date, type, status: "Scheduled" });
    }
    toast.success(`Booked ${selected.size} inspection(s) for ${date}`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <CalendarClock className="h-4 w-4" /> Book Inspections
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book inspections</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Type">
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
              const status = inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p));
              const tenant = currentTenantOf(p.id, state.tenants);
              return (
                <label key={p.id} className="flex items-center gap-2 rounded p-1.5 text-sm hover:bg-muted/50">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  <span className="flex-1">
                    {p.alias || p.address}
                    {tenant && <span className="text-muted-foreground"> — {tenant.name}</span>}
                  </span>
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
          <Button onClick={save}>Book {selected.size || ""} inspection(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** View/act on an existing inspection: mark done, reschedule, upload a report, flag issues (create maintenance items / follow up with the tenant), and — optionally — fill in a full room-by-room checklist. */
function InspectionDetailDialog({ inspection, children }: { inspection: Inspection; children: React.ReactNode }) {
  const { state, updateInspection, addInspection, addMaintenanceRequest, consumeAiBudget } = useStore();
  const [open, setOpen] = useState(false);
  const property = state.properties.find((p) => p.id === inspection.propertyId);
  const tenant = state.tenants.find((t) => t.id === inspection.tenantId) ?? currentTenantOf(inspection.propertyId, state.tenants);

  const [date, setDate] = useState(inspection.date);
  const [status, setStatus] = useState<Inspection["status"]>(inspection.status);
  const [notes, setNotes] = useState(inspection.notes ?? "");
  const [signature, setSignature] = useState(inspection.signature ?? "");
  const [fileFileName, setFileFileName] = useState(inspection.fileFileName ?? "");
  const [fileData, setFileData] = useState(inspection.fileData ?? "");
  const [issues, setIssues] = useState<InspectionIssue[]>(inspection.issues ?? []);
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [newIssuePhoto, setNewIssuePhoto] = useState<{ name: string; data: string } | undefined>();
  const [showChecklist, setShowChecklist] = useState(false);
  const [rooms, setRooms] = useState<ChecklistRoom[]>(
    inspection.rooms ?? DEFAULT_INSPECTION_ROOMS[inspection.type].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })),
  );
  const [newRoom, setNewRoom] = useState("");
  const [analysing, setAnalysing] = useState<string | null>(null);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setDate(inspection.date);
      setStatus(inspection.status);
      setNotes(inspection.notes ?? "");
      setSignature(inspection.signature ?? "");
      setFileFileName(inspection.fileFileName ?? "");
      setFileData(inspection.fileData ?? "");
      setIssues(inspection.issues ?? []);
      setRooms(
        inspection.rooms ??
          DEFAULT_INSPECTION_ROOMS[inspection.type].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })),
      );
      setShowChecklist(false);
    }
  };

  const persist = (patch: Partial<Inspection>) => updateInspection(inspection.id, patch);

  const handleReportFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const name = f.name;
      const data = String(reader.result);
      setFileFileName(name);
      setFileData(data);
      persist({ fileFileName: name, fileData: data });
      toast.success("Report attached");
    };
    reader.readAsDataURL(f);
  };

  const handleIssuePhoto = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setNewIssuePhoto({ name: f.name, data: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const addIssue = () => {
    if (!newIssueDesc.trim()) return toast.error("Describe the issue");
    const issue: InspectionIssue = {
      id: crypto.randomUUID(),
      description: newIssueDesc.trim(),
      photoData: newIssuePhoto?.data,
      photoName: newIssuePhoto?.name,
      status: "Open",
    };
    const next = [...issues, issue];
    setIssues(next);
    persist({ issues: next });
    setNewIssueDesc("");
    setNewIssuePhoto(undefined);
  };

  const removeIssue = (id: string) => {
    const next = issues.filter((i) => i.id !== id);
    setIssues(next);
    persist({ issues: next });
  };

  const updateIssue = (id: string, patch: Partial<InspectionIssue>) => {
    const next = issues.map((i) => (i.id === id ? { ...i, ...patch } : i));
    setIssues(next);
    persist({ issues: next });
  };

  const createMaintenanceFromIssue = async (issue: InspectionIssue) => {
    if (!property) return;
    await addMaintenanceRequest({
      propertyId: property.id,
      propertyAddressTyped: property.address,
      category: "Other",
      description: issue.description,
      urgency: "Medium",
      photos: issue.photoData ? [{ name: issue.photoName ?? "issue.jpg", data: issue.photoData }] : [],
      contactName: state.landlordProfile.fullName || "Landlord",
      contactPhone: state.landlordProfile.phone || "",
      contactEmail: state.landlordProfile.email || "",
      source: "landlord",
    });
    updateIssue(issue.id, { status: "Maintenance Logged" });
    toast.success("Maintenance job logged");
  };

  const followUpWithTenant = (issue: InspectionIssue) => {
    if (!tenant?.email) return toast.error("This tenant has no email on file");
    const propertyLabel = property?.alias || property?.address || "";
    openGmailCompose(
      tenant.email,
      `Follow-up from ${inspection.type.toLowerCase()} inspection — ${propertyLabel}`,
      `Hi ${tenant.name},\n\nFollowing up on the recent inspection — we noted: ${issue.description}\n\nCould you let us know a good time to address this, or if it's already resolved?\n\nThanks,\n${state.landlordProfile.fullName || "The Landlord"}`,
    );
  };

  const markDone = () => {
    setStatus("Completed");
    persist({ status: "Completed" });
    autoBookNext({ ...inspection, date }, state.properties, state.inspections, addInspection);
    toast.success("Marked as done");
  };

  // --- optional detailed checklist (unchanged behaviour, just collapsed by default) ---
  const onTypeChangeRooms = () => {
    setRooms(DEFAULT_INSPECTION_ROOMS[inspection.type].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })));
  };
  const updateItem = (ri: number, ii: number, patch: Partial<ChecklistItem>) =>
    setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: r.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : r)));
  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return toast.error("Enter a room name");
    setRooms((rs) => [...rs, { name, items: [] }]);
    setNewRoom("");
  };
  const removeRoom = (ri: number) => setRooms((rs) => rs.filter((_, i) => i !== ri));
  const addItem = (ri: number) => setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: [...r.items, { label: "" }] } : r)));
  const removeItem = (ri: number, ii: number) => setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: r.items.filter((_, j) => j !== ii) } : r)));
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
    setAnalysing(`${ri}-${ii}`);
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

  const saveAll = () => {
    const flat: ChecklistItem[] = rooms.flatMap((r) => r.items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: `${r.name}: ${i.label}` })));
    persist({
      date,
      status,
      notes: notes || undefined,
      signature: signature || undefined,
      rooms,
      checklist: flat,
    });
    setOpen(false);
    toast.success("Inspection updated");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {inspection.type} Inspection — {property?.alias || property?.address}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status === "Completed" ? "secondary" : "outline"}>{status}</Badge>
          <span className="text-muted-foreground">{tenant?.name ?? "No tenant"}</span>
          {status !== "Completed" && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={markDone}>
              <CheckCircle2 className="h-3 w-3" /> Mark done
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              if (!tenant?.email) return toast.error("This tenant has no email on file");
              const propertyLabel = property?.alias || property?.address || "";
              openGmailCompose(
                tenant.email,
                `${status === "Completed" ? "Inspection" : "Upcoming inspection"} — ${propertyLabel}`,
                `Hi ${tenant.name},\n\n${
                  status === "Completed"
                    ? `Following up on the ${inspection.type.toLowerCase()} inspection on ${date}.`
                    : `Just a heads up that a ${inspection.type.toLowerCase()} inspection is scheduled for ${date} at ${propertyLabel}.`
                }\n\nThanks,\n${state.landlordProfile.fullName || "The Landlord"}`,
              );
            }}
          >
            <Mail className="h-3 w-3" /> Email tenant
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                persist({ date: e.target.value });
              }}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onValueChange={(v) => {
                const next = v as Inspection["status"];
                setStatus(next);
                persist({ status: next });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Scheduled">Scheduled</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Report</div>
          <Input type="file" accept="application/pdf,image/*" onChange={(e) => handleReportFile(e.target.files?.[0])} />
          {fileFileName && fileData && (
            <DocumentLink fileName={fileFileName} fileData={fileData} className="inline-flex items-center gap-1 text-xs text-primary underline">
              <FileText className="h-3 w-3" /> {fileFileName}
            </DocumentLink>
          )}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Issues ({issues.length})</div>
          {issues.map((issue) => (
            <div key={issue.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div>{issue.description}</div>
                  {issue.photoData && <img src={issue.photoData} alt={issue.photoName} className="mt-1 h-14 w-14 rounded object-cover" />}
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeIssue(issue.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={issue.status === "Resolved" ? "secondary" : "outline"} className="text-[10px]">
                  {issue.status}
                </Badge>
                {issue.status !== "Maintenance Logged" && (
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => createMaintenanceFromIssue(issue)}>
                    <Wrench className="h-3 w-3" /> Create maintenance item
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => followUpWithTenant(issue)}>
                  <Mail className="h-3 w-3" /> Follow up with tenant
                </Button>
                {issue.status !== "Resolved" && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => updateIssue(issue.id, { status: "Resolved" })}>
                    Mark resolved
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <Textarea
              placeholder="Describe an issue noted in the report or on-site…"
              value={newIssueDesc}
              onChange={(e) => setNewIssueDesc(e.target.value)}
              className="min-h-16"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Input type="file" accept="image/*" className="h-8 max-w-[220px] text-xs" onChange={(e) => handleIssuePhoto(e.target.files?.[0])} />
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addIssue}>
                <Plus className="h-3 w-3" /> Add issue
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Digital signature (typed name)">
            <Input placeholder="e.g. Alex Landlord" value={signature} onChange={(e) => setSignature(e.target.value)} />
          </Field>
        </div>

        <Collapsible open={showChecklist} onOpenChange={setShowChecklist}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full justify-between">
              Detailed room-by-room checklist (optional)
              {showChecklist ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="New room name" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} className="h-8 max-w-[200px]" />
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addRoom}>
                <Plus className="h-3 w-3" /> Add room
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={onTypeChangeRooms}>
                Reset to {inspection.type} template
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
                  {room.items.length === 0 && <div className="p-3 text-xs text-muted-foreground">No checklist items — add one.</div>}
                  {room.items.map((c, ii) => (
                    <div key={ii} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <Input placeholder="Checklist item" value={c.label} onChange={(e) => updateItem(ri, ii, { label: e.target.value })} className="h-8" />
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
                          <Input type="file" accept="image/*" className="h-7 max-w-[190px] text-xs" onChange={(e) => itemPhoto(ri, ii, e.target.files?.[0])} />
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
                        <Input placeholder="Condition remarks" value={c.notes ?? ""} onChange={(e) => updateItem(ri, ii, { notes: e.target.value })} className="h-8" />
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
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter>
          <Button onClick={saveAll}>Save</Button>
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
