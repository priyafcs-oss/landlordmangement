import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, FileText, Download, ClipboardCheck, Wrench, Sparkles } from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO } from "@/lib/calculations";
import { toast } from "sonner";
import type { Expense, Inspection, ChecklistItem, ChecklistRoom } from "@/lib/types";
import { INSPECTION_TEMPLATES, DEFAULT_INSPECTION_ROOMS } from "@/lib/types";


export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses & Tax — Landlord OS" },
      { name: "description", content: "Log expenses, inspections and generate EOFY tax summaries." },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Expenses, Maintenance &amp; Tax</h1>
        <p className="text-sm text-muted-foreground">
          Log outgoings, inspections and generate ATO-ready EOFY reports.
        </p>
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
          <TabsTrigger value="eofy">EOFY Report</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab fy={fy} setFy={setFy} />
        </TabsContent>
        <TabsContent value="inspections" className="mt-4">
          <InspectionsTab />
        </TabsContent>
        <TabsContent value="eofy" className="mt-4">
          <EofyReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExpensesTab({ fy, setFy }: { fy: string; setFy: (v: string) => void }) {
  const { state, deleteExpense } = useStore();
  const { start, end } = fyRange(fy);
  const filtered = state.expenses.filter((e) => e.date >= start && e.date <= end);

  const fys = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) {
      years.push(`${y}-${y + 1}`);
    }
    return years;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fys.map((y) => (
              <SelectItem key={y} value={y}>
                FY {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ExpenseDialog />
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No expenses logged for FY {fy}.
            </CardContent>
          </Card>
        )}
        {filtered.map((e) => {
          const prop = state.properties.find((p) => p.id === e.propertyId);
          return (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{e.itemName}</span>
                    <Badge variant="outline">{e.taxCategory}</Badge>
                    {e.rechargeToTenant && <Badge variant="secondary">Recharged</Badge>}
                    {e.hasWarranty && e.warrantyExpiry && (
                      <Badge variant="outline">Warranty {e.warrantyExpiry}</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.date} • {prop?.address}
                    {e.invoiceFileName && <> • 📎 {e.invoiceFileName}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right font-medium">{fmtCurrency(e.cost)}</div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      deleteExpense(e.id);
                      toast.success("Expense removed");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ExpenseDialog() {
  const { state, addExpense, addInvoice } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    itemName: "",
    cost: "",
    date: todayISO(),
    propertyId: state.properties[0]?.id ?? "",
    taxCategory: "Immediate Deduction" as Expense["taxCategory"],
    hasWarranty: false,
    warrantyExpiry: "",
    rechargeToTenant: false,
    tenantId: "",
    invoiceFileName: "",
    invoiceFileData: "",
  });

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((s) => ({ ...s, invoiceFileName: f.name, invoiceFileData: String(reader.result) }));
    };
    reader.readAsDataURL(f);
  };

  const submit = () => {
    if (!form.itemName || !form.propertyId) return toast.error("Item and property required");
    const cost = parseFloat(form.cost) || 0;
    addExpense({
      itemName: form.itemName,
      cost,
      date: form.date,
      propertyId: form.propertyId,
      taxCategory: form.taxCategory,
      hasWarranty: form.hasWarranty,
      warrantyExpiry: form.hasWarranty ? form.warrantyExpiry : undefined,
      rechargeToTenant: form.rechargeToTenant,
      tenantId: form.rechargeToTenant ? form.tenantId : undefined,
      invoiceFileName: form.invoiceFileName || undefined,
      invoiceFileData: form.invoiceFileData || undefined,
    });
    if (form.rechargeToTenant && form.tenantId) {
      addInvoice({
        tenantId: form.tenantId,
        chargeType: "Other",
        amountDue: cost,
        dateIssued: form.date,
        dueDate: new Date(new Date(form.date).getTime() + 14 * 86400000).toISOString().slice(0, 10),
        status: "Unpaid",
        description: form.itemName,
      });
      toast.success("Expense logged and recharged to tenant");
    } else {
      toast.success("Expense logged");
    }
    setOpen(false);
    setForm({
      itemName: "",
      cost: "",
      date: todayISO(),
      propertyId: state.properties[0]?.id ?? "",
      taxCategory: "Immediate Deduction",
      hasWarranty: false,
      warrantyExpiry: "",
      rechargeToTenant: false,
      tenantId: "",
      invoiceFileName: "",
      invoiceFileData: "",
    });
  };

  const tenantsForProp = state.tenants.filter((t) => t.propertyId === form.propertyId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Log Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New expense / maintenance</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item">
            <Input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
          </Field>
          <Field label="Cost (AUD)">
            <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Property">
            <Select value={form.propertyId} onValueChange={(v) => setForm({ ...form, propertyId: v })}>
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
          <Field label="ATO Tax Category">
            <Select
              value={form.taxCategory}
              onValueChange={(v) => setForm({ ...form, taxCategory: v as Expense["taxCategory"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Immediate Deduction">Immediate Deduction</SelectItem>
                <SelectItem value="Capital Works">Capital Works</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Invoice attachment">
            <Input type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
          </Field>
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Has warranty?</div>
              <div className="text-xs text-muted-foreground">Track expiry for insurance claims.</div>
            </div>
            <Switch checked={form.hasWarranty} onCheckedChange={(v) => setForm({ ...form, hasWarranty: v })} />
          </div>
          {form.hasWarranty && (
            <Field label="Warranty expiry">
              <Input
                type="date"
                value={form.warrantyExpiry}
                onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })}
              />
            </Field>
          )}
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Recharge to tenant?</div>
              <div className="text-xs text-muted-foreground">
                Auto-generates a tenant invoice for this amount.
              </div>
            </div>
            <Switch
              checked={form.rechargeToTenant}
              onCheckedChange={(v) => setForm({ ...form, rechargeToTenant: v })}
            />
          </div>
          {form.rechargeToTenant && (
            <Field label="Tenant">
              <Select value={form.tenantId} onValueChange={(v) => setForm({ ...form, tenantId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenantsForProp.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InspectionsTab() {
  const { state, deleteInspection } = useStore();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <InspectionDialog />
      </div>
      <div className="grid gap-3">
        {state.inspections.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No inspections logged yet.
            </CardContent>
          </Card>
        )}
        {state.inspections.map((i) => {
          const prop = state.properties.find((p) => p.id === i.propertyId);
          const passed = (i.checklist ?? []).filter((c) => c.result === "Pass").length;
          const failed = (i.checklist ?? []).filter((c) => c.result === "Fail").length;
          return (
            <Card key={i.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{i.type} Inspection</span>
                    <Badge variant={i.status === "Completed" ? "secondary" : "outline"}>{i.status}</Badge>
                    {i.checklist && i.checklist.length > 0 && (
                      <Badge variant="outline">
                        {passed} pass / {failed} fail
                      </Badge>
                    )}
                    {i.signature && <Badge variant="outline">Signed: {i.signature}</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {i.date} • {prop?.address}
                    {i.fileFileName && <> • 📎 {i.fileFileName}</>}
                    {i.photos && i.photos.length > 0 && <> • {i.photos.length} photo(s)</>}
                  </div>
                  {i.notes && <div className="mt-1 text-xs">{i.notes}</div>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    deleteInspection(i.id);
                    toast.success("Inspection removed");
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function InspectionDialog() {
  const { state, addInspection, consumeAiBudget } = useStore();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState(state.properties[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<Inspection["type"]>("Routine");
  const [status, setStatus] = useState<Inspection["status"]>("Scheduled");
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState("");
  const [fileFileName, setFileFileName] = useState("");
  const [fileData, setFileData] = useState("");
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>([]);
  const [rooms, setRooms] = useState<ChecklistRoom[]>(
    DEFAULT_INSPECTION_ROOMS.Routine.map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })),
  );
  const [newRoom, setNewRoom] = useState("");
  const [analysing, setAnalysing] = useState<string | null>(null);

  const onTypeChange = (v: Inspection["type"]) => {
    setType(v);
    setRooms(DEFAULT_INSPECTION_ROOMS[v].map((r) => ({ name: r.name, items: r.items.map((i) => ({ ...i })) })));
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
      rs.map((r, i) =>
        i === ri ? { ...r, items: r.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : r,
      ),
    );

  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return toast.error("Enter a room name");
    setRooms((rs) => [...rs, { name, items: [] }]);
    setNewRoom("");
  };
  const removeRoom = (ri: number) => setRooms((rs) => rs.filter((_, i) => i !== ri));
  const addItem = (ri: number) =>
    setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: [...r.items, { label: "" }] } : r)));
  const removeItem = (ri: number, ii: number) =>
    setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, items: r.items.filter((_, j) => j !== ii) } : r)));

  const itemPhoto = (ri: number, ii: number, f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => updateItem(ri, ii, { photoName: f.name, photoData: String(reader.result) });
    reader.readAsDataURL(f);
  };

  /** AI vision draft remark — gated by the daily AI budget firewall. */
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Log Inspection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New inspection</DialogTitle>
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
                  onChange={(e) =>
                    setRooms((rs) => rs.map((r, i) => (i === ri ? { ...r, name: e.target.value } : r)))
                  }
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
          <Button
            onClick={() => {
              if (!propertyId) return toast.error("Property required");
              const flat: ChecklistItem[] = rooms.flatMap((r) =>
                r.items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: `${r.name}: ${i.label}` })),
              );
              addInspection({
                propertyId,
                date,
                type,
                status,
                notes,
                fileFileName: fileFileName || undefined,
                fileData: fileData || undefined,
                rooms,
                checklist: flat,
                photos,
                signature: signature || undefined,
              });
              setOpen(false);
              toast.success("Inspection logged");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function EofyReport() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [propertyId, setPropertyId] = useState(state.properties[0]?.id ?? "");
  const [fy, setFy] = useState(currentFY);
  const [report, setReport] = useState<null | {
    gross: number;
    byCategory: Record<string, number>;
    interest: number;
    total: number;
    net: number;
    property: string;
  }>(null);

  const generate = () => {
    const prop = state.properties.find((p) => p.id === propertyId);
    if (!prop) return toast.error("Select a property");
    const { start, end } = fyRange(fy);
    const tenants = state.tenants.filter((t) => t.propertyId === propertyId);
    const tenantIds = tenants.map((t) => t.id);
    const gross = state.ledger
      .filter((e) => tenantIds.includes(e.tenantId) && e.date >= start && e.date <= end && e.type === "Rent Payment")
      .reduce((s, e) => s + e.credit, 0);
    const expenses = state.expenses.filter(
      (e) => e.propertyId === propertyId && e.date >= start && e.date <= end,
    );
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.taxCategory] = (byCategory[e.taxCategory] ?? 0) + e.cost;
    }
    const totalExp = expenses.reduce((s, e) => s + e.cost, 0);
    const loan = state.loans.find((l) => l.propertyId === propertyId);
    const interest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
    setReport({
      gross,
      byCategory,
      interest,
      total: totalExp,
      net: gross - totalExp - interest,
      property: prop.address,
    });
  };

  const download = () => {
    if (!report) return;
    const lines = [
      "EOFY Tax Summary",
      `Property: ${report.property}`,
      `Financial Year: ${fy}`,
      "",
      `Gross Rent Collected: ${fmtCurrency(report.gross)}`,
      "",
      "Expenses by ATO Category:",
      ...Object.entries(report.byCategory).map(([k, v]) => `  ${k}: ${fmtCurrency(v)}`),
      `Total Expenses: ${fmtCurrency(report.total)}`,
      "",
      `Estimated Loan Interest Paid: ${fmtCurrency(report.interest)}`,
      "",
      `Net Taxable Profit/Loss: ${fmtCurrency(report.net)}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `EOFY-${fy}-${report.property.slice(0, 20)}.txt`;
    a.click();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">EOFY Statement Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Field label="Financial year">
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }).map((_, i) => {
                  const y = new Date().getFullYear() - 2 + i;
                  const v = `${y}-${y + 1}`;
                  return (
                    <SelectItem key={v} value={v}>
                      FY {v}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={generate}>Generate</Button>
          </div>
        </div>

        {report && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Property</div>
                <div className="font-medium">{report.property}</div>
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={download}>
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Gross rent collected" value={fmtCurrency(report.gross)} />
              <Stat label="Total expenses" value={fmtCurrency(report.total)} />
              <Stat label="Loan interest (est.)" value={fmtCurrency(report.interest)} />
              <Stat
                label="Net taxable profit / loss"
                value={fmtCurrency(report.net)}
                strong
                negative={report.net < 0}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">Expenses by category</div>
              {Object.entries(report.byCategory).map(([k, v]) => (
                <div key={k} className="flex justify-between border-t py-1">
                  <span>{k}</span>
                  <span>{fmtCurrency(v)}</span>
                </div>
              ))}
              {Object.keys(report.byCategory).length === 0 && (
                <div className="text-xs text-muted-foreground">No expenses in this period.</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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

function Stat({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 font-medium " + (strong ? "text-base " : "") + (negative ? "text-destructive" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
