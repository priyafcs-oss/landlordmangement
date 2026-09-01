import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2, Eye, ShieldCheck, Wrench, HardHat, FileText, X } from "lucide-react";
import { fmtCurrency, daysUntil } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import { DocumentLink } from "@/components/DocumentLink";
import { toast } from "sonner";
import type {
  Property,
  InsurancePolicy,
  InsuranceCoverType,
  InsuranceDocumentType,
  MaintenanceItem,
  MaintenanceItemType,
  MaintenancePriority,
  MaintenanceProjectType,
  MaintenanceStatus,
  ComplianceCertificate,
  ComplianceCertType,
  PropertyNote,
  Expense,
} from "@/lib/types";
import { COMPLIANCE_CERT_TYPES } from "@/lib/types";

const SHARED_UNIT = "__shared__";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Premises/dwelling scope select, shared by every dialog in this file — only rendered when the
 * property actually has units on file, same "shared vs a specific dwelling" pattern used across
 * ExpenseDialog/AddTransactionDialog. */
function UnitScopeField({ prop, unitId, onChange }: { prop: Property; unitId: string; onChange: (v: string) => void }) {
  if (!prop.units || prop.units.length === 0) return null;
  return (
    <Field label="Premises / scope">
      <Select value={unitId} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHARED_UNIT}>Whole property / shared</SelectItem>
          {prop.units.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------------------------------- */
/* Insurance                                                                                     */
/* ------------------------------------------------------------------------------------------- */

const COVER_TYPES: InsuranceCoverType[] = ["Landlord", "Building", "Contents", "Public Liability", "Strata", "Professional Indemnity"];
const INSURANCE_DOCUMENT_TYPES: InsuranceDocumentType[] = ["Policy Schedule / Renewal", "Certificate of Currency", "Product Disclosure / Supporting Document"];

function InsurancePolicyDialog({
  prop,
  policy,
  trigger,
}: {
  prop: Property;
  policy?: InsurancePolicy;
  trigger?: React.ReactNode;
}) {
  const { state, addInsurancePolicy, updateInsurancePolicy } = useStore();
  const [open, setOpen] = useState(false);
  const existingPolicies = state.insurancePolicies.filter((p) => p.propertyId === prop.id && p.id !== policy?.id);
  const [form, setForm] = useState({
    unitId: policy?.unitId ?? SHARED_UNIT,
    insurer: policy?.insurer ?? "",
    coverTypes: policy?.coverTypes ?? ([] as InsuranceCoverType[]),
    policyNumber: policy?.policyNumber ?? "",
    coverStart: policy?.coverStart ?? "",
    coverEnd: policy?.coverEnd ?? "",
    premium: policy?.premium !== undefined ? String(policy.premium) : "",
    premiumFrequency: policy?.premiumFrequency ?? "Annual",
    sumInsured: policy?.sumInsured !== undefined ? String(policy.sumInsured) : "",
    excess: policy?.excess !== undefined ? String(policy.excess) : "",
    coverageSummary: policy?.coverageSummary ?? "",
    documentType: policy?.documentType ?? ("Policy Schedule / Renewal" as InsuranceDocumentType),
    replacesPolicyId: policy?.replacesPolicyId ?? "",
    isSeparatePolicy: policy?.isSeparatePolicy ?? false,
    fileName: policy?.fileName ?? "",
    fileData: policy?.fileData ?? "",
  });

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    const data = await readFileAsDataUrl(f);
    setForm((s) => ({ ...s, fileName: f.name, fileData: data }));
  };

  const toggleCover = (t: InsuranceCoverType) =>
    setForm((f) => ({
      ...f,
      coverTypes: f.coverTypes.includes(t) ? f.coverTypes.filter((c) => c !== t) : [...f.coverTypes, t],
    }));

  const save = () => {
    if (!form.insurer.trim()) return toast.error("Insurer is required");
    const num = (s: string) => (s.trim() ? parseFloat(s) : undefined);
    const payload = {
      propertyId: prop.id,
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      insurer: form.insurer.trim(),
      coverTypes: form.coverTypes,
      policyNumber: form.policyNumber.trim() || undefined,
      coverStart: form.coverStart || undefined,
      coverEnd: form.coverEnd || undefined,
      premium: num(form.premium),
      premiumFrequency: form.premiumFrequency as InsurancePolicy["premiumFrequency"],
      sumInsured: num(form.sumInsured),
      excess: num(form.excess),
      coverageSummary: form.coverageSummary.trim() || undefined,
      documentType: form.documentType,
      replacesPolicyId: form.replacesPolicyId || undefined,
      isSeparatePolicy: form.isSeparatePolicy,
      fileName: form.fileName || undefined,
      fileData: form.fileData || undefined,
    };
    if (policy) {
      updateInsurancePolicy(policy.id, payload);
      toast.success("Policy updated");
    } else {
      addInsurancePolicy(payload);
      toast.success("Policy added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add policy
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit insurance policy" : "Add insurance policy"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Upload document</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {form.fileName && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
                <span className="truncate">{form.fileName}</span>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.fileName, form.fileData)}>
                  <Eye className="h-3 w-3" /> View
                </Button>
              </div>
            )}
          </div>

          <UnitScopeField prop={prop} unitId={form.unitId} onChange={(v) => setForm((f) => ({ ...f, unitId: v }))} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Insurer">
              <Input value={form.insurer} onChange={(e) => setForm((f) => ({ ...f, insurer: e.target.value }))} />
            </Field>
            <Field label="Policy number">
              <Input value={form.policyNumber} onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))} />
            </Field>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Cover types</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {COVER_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <Checkbox checked={form.coverTypes.includes(t)} onCheckedChange={() => toggleCover(t)} />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cover start">
              <Input type="date" value={form.coverStart} onChange={(e) => setForm((f) => ({ ...f, coverStart: e.target.value }))} />
            </Field>
            <Field label="Cover end">
              <Input type="date" value={form.coverEnd} onChange={(e) => setForm((f) => ({ ...f, coverEnd: e.target.value }))} />
            </Field>
            <Field label="Premium ($)">
              <Input type="number" value={form.premium} onChange={(e) => setForm((f) => ({ ...f, premium: e.target.value }))} />
            </Field>
            <Field label="Premium frequency">
              <Select value={form.premiumFrequency} onValueChange={(v) => setForm((f) => ({ ...f, premiumFrequency: v as "Annual" | "Monthly" | "Quarterly" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Annual">Annual</SelectItem>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                  <SelectItem value="Quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sum insured ($)">
              <Input type="number" value={form.sumInsured} onChange={(e) => setForm((f) => ({ ...f, sumInsured: e.target.value }))} />
            </Field>
            <Field label="Excess ($)">
              <Input type="number" value={form.excess} onChange={(e) => setForm((f) => ({ ...f, excess: e.target.value }))} />
            </Field>
          </div>

          <Field label="Coverage summary">
            <Textarea rows={2} value={form.coverageSummary} onChange={(e) => setForm((f) => ({ ...f, coverageSummary: e.target.value }))} />
          </Field>

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-xs font-medium">Document and renewal</div>
            <Field label="Selected document is">
              <Select value={form.documentType} onValueChange={(v) => setForm((f) => ({ ...f, documentType: v as InsuranceDocumentType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSURANCE_DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {existingPolicies.length > 0 && (
              <Field label="This renews / replaces">
                <Select value={form.replacesPolicyId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, replacesPolicyId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not a renewal / doesn't replace a policy</SelectItem>
                    {existingPolicies.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.insurer} {p.policyNumber ? `(${p.policyNumber})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={form.isSeparatePolicy} onCheckedChange={(v) => setForm((f) => ({ ...f, isSeparatePolicy: v === true }))} />
              Confirmed separate policy (not a duplicate of one already on file)
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save insurance policy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InsurancePolicyRow({ policy }: { policy: InsurancePolicy }) {
  const { deleteInsurancePolicy, state } = useStore();
  const prop = state.properties.find((p) => p.id === policy.propertyId);
  const expiring = policy.coverEnd ? daysUntil(policy.coverEnd) : undefined;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{policy.insurer}</span>
          {policy.coverTypes.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
          {expiring !== undefined && expiring <= 30 && (
            <Badge variant={expiring < 0 ? "destructive" : "outline"} className="text-[10px]">
              {expiring < 0 ? "Expired" : `Expires in ${expiring}d`}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
          {policy.policyNumber && <span>Policy #{policy.policyNumber}</span>}
          {policy.coverStart && policy.coverEnd && <span>{policy.coverStart} → {policy.coverEnd}</span>}
          {policy.premium !== undefined && <span>{fmtCurrency(policy.premium)} / {policy.premiumFrequency ?? "Annual"}</span>}
          {policy.sumInsured !== undefined && <span>Sum insured {fmtCurrency(policy.sumInsured)}</span>}
          {policy.excess !== undefined && <span>Excess {fmtCurrency(policy.excess)}</span>}
        </div>
        {policy.coverageSummary && <div className="mt-1 whitespace-pre-wrap">{policy.coverageSummary}</div>}
        {policy.fileData && (
          <button
            type="button"
            onClick={() => openBillDocument(policy.fileName, policy.fileData)}
            className="mt-1 inline-flex items-center gap-1 text-primary underline"
          >
            <FileText className="h-3 w-3" /> {policy.documentType ?? "Document"}
          </button>
        )}
      </div>
      {prop && (
        <div className="flex shrink-0 gap-1">
          <InsurancePolicyDialog
            prop={prop}
            policy={policy}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              if (confirm(`Delete this ${policy.insurer} policy?`)) {
                deleteInsurancePolicy(policy.id);
                toast.success("Policy removed");
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function PropertyInsuranceTab({ prop }: { prop: Property }) {
  const { state } = useStore();
  const policies = state.insurancePolicies
    .filter((p) => p.propertyId === prop.id)
    .sort((a, b) => (b.coverStart ?? "").localeCompare(a.coverStart ?? ""));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Every insurance policy held on this property, current and past.</div>
        <InsurancePolicyDialog prop={prop} />
      </div>
      {policies.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
          <ShieldCheck className="mx-auto mb-2 h-6 w-6" />
          No insurance policies on file yet.
        </div>
      ) : (
        <div className="space-y-2">
          {policies.map((p) => (
            <InsurancePolicyRow key={p.id} policy={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Maintenance                                                                                   */
/* ------------------------------------------------------------------------------------------- */

const MAINTENANCE_PRIORITIES: MaintenancePriority[] = ["Low", "Normal", "High", "Urgent"];
const MAINTENANCE_PROJECT_TYPES: MaintenanceProjectType[] = ["Renovation", "Major Works", "New Build", "Granny Flat", "Repair Project", "Other"];
const MAINTENANCE_STATUSES: MaintenanceStatus[] = ["New", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"];

function MaintenanceItemDialog({
  prop,
  itemType,
  item,
  trigger,
}: {
  prop: Property;
  itemType: MaintenanceItemType;
  item?: MaintenanceItem;
  trigger?: React.ReactNode;
}) {
  const { addMaintenanceItem, updateMaintenanceItem } = useStore();
  const [open, setOpen] = useState(false);
  const isRepair = (item?.itemType ?? itemType) === "Repair";
  const [form, setForm] = useState({
    unitId: item?.unitId ?? SHARED_UNIT,
    title: item?.title ?? "",
    description: item?.description ?? "",
    priority: item?.priority ?? ("Normal" as MaintenancePriority),
    tradeCategory: item?.tradeCategory ?? "",
    projectType: item?.projectType ?? ("Renovation" as MaintenanceProjectType),
    status: item?.status ?? ("New" as MaintenanceStatus),
    scheduledDate: item?.scheduledDate ?? "",
    startDate: item?.startDate ?? "",
    completedDate: item?.completedDate ?? "",
    cost: item?.cost !== undefined ? String(item.cost) : "",
    budget: item?.budget !== undefined ? String(item.budget) : "",
    progressNotes: item?.progressNotes ?? "",
    contractorName: item?.contractorName ?? "",
    contractorEmail: item?.contractorEmail ?? "",
    contractorPhone: item?.contractorPhone ?? "",
    sourceFileName: item?.sourceFileName ?? "",
    sourceFileData: item?.sourceFileData ?? "",
  });
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>(item?.photos ?? []);

  const onPhotos = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(async (f) => {
      const data = await readFileAsDataUrl(f);
      setPhotos((p) => [...p, { name: f.name, data }]);
    });
  };
  const handleDoc = async (f: File | undefined) => {
    if (!f) return;
    const data = await readFileAsDataUrl(f);
    setForm((s) => ({ ...s, sourceFileName: f.name, sourceFileData: data }));
  };

  const save = () => {
    if (!form.title.trim()) return toast.error(isRepair ? "Issue / job title is required" : "Project name is required");
    const num = (s: string) => (s.trim() ? parseFloat(s) : undefined);
    const payload = {
      propertyId: prop.id,
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      itemType: item?.itemType ?? itemType,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      priority: isRepair ? form.priority : undefined,
      tradeCategory: isRepair ? form.tradeCategory.trim() || undefined : undefined,
      projectType: !isRepair ? form.projectType : undefined,
      status: form.status,
      scheduledDate: isRepair ? form.scheduledDate || undefined : undefined,
      startDate: !isRepair ? form.startDate || undefined : undefined,
      completedDate: form.completedDate || undefined,
      cost: isRepair ? num(form.cost) : undefined,
      budget: !isRepair ? num(form.budget) : undefined,
      progressNotes: form.progressNotes.trim() || undefined,
      contractorName: form.contractorName.trim() || undefined,
      contractorEmail: form.contractorEmail.trim() || undefined,
      contractorPhone: form.contractorPhone.trim() || undefined,
      photos,
      sourceFileName: form.sourceFileName || undefined,
      sourceFileData: form.sourceFileData || undefined,
    };
    if (item) {
      updateMaintenanceItem(item.id, payload);
      toast.success("Updated");
    } else {
      addMaintenanceItem(payload);
      toast.success(isRepair ? "Repair item added" : "Major work project added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit" : "Add"} {isRepair ? "repair / small work item" : "major work project"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Supporting document</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => void handleDoc(e.target.files?.[0])} />
            {form.sourceFileName && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
                <span className="truncate">{form.sourceFileName}</span>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.sourceFileName, form.sourceFileData)}>
                  <Eye className="h-3 w-3" /> View
                </Button>
              </div>
            )}
          </div>

          <UnitScopeField prop={prop} unitId={form.unitId} onChange={(v) => setForm((f) => ({ ...f, unitId: v }))} />

          <Field label={isRepair ? "Issue / job title" : "Project name"}>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label={isRepair ? "Details and findings" : "Scope / description"}>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {isRepair ? (
              <>
                <Field label="Priority">
                  <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as MaintenancePriority }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MAINTENANCE_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Trade / category">
                  <Input value={form.tradeCategory} onChange={(e) => setForm((f) => ({ ...f, tradeCategory: e.target.value }))} placeholder="e.g. Plumbing" />
                </Field>
              </>
            ) : (
              <Field label="Project type">
                <Select value={form.projectType} onValueChange={(v) => setForm((f) => ({ ...f, projectType: v as MaintenanceProjectType }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_PROJECT_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as MaintenanceStatus }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {isRepair ? (
              <Field label="Scheduled / next due">
                <Input type="date" value={form.scheduledDate} onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))} />
              </Field>
            ) : (
              <Field label="Start date">
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </Field>
            )}
            <Field label="Completed date">
              <Input type="date" value={form.completedDate} onChange={(e) => setForm((f) => ({ ...f, completedDate: e.target.value }))} />
            </Field>
            {isRepair ? (
              <Field label="Out-of-pocket / actual job cost ($)">
                <Input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} />
              </Field>
            ) : (
              <Field label="Estimated cost / budget ($)">
                <Input type="number" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
              </Field>
            )}
          </div>

          <Field label="Progress notes">
            <Textarea rows={2} value={form.progressNotes} onChange={(e) => setForm((f) => ({ ...f, progressNotes: e.target.value }))} />
          </Field>

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-xs font-medium">Contractor</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Contractor / business">
                <Input value={form.contractorName} onChange={(e) => setForm((f) => ({ ...f, contractorName: e.target.value }))} />
              </Field>
              <Field label="Contractor email">
                <Input value={form.contractorEmail} onChange={(e) => setForm((f) => ({ ...f, contractorEmail: e.target.value }))} />
              </Field>
              <Field label="Contractor phone">
                <Input value={form.contractorPhone} onChange={(e) => setForm((f) => ({ ...f, contractorPhone: e.target.value }))} />
              </Field>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Job photos</Label>
            <Input type="file" accept="image/*" multiple onChange={(e) => onPhotos(e.target.files)} />
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.data} alt={p.name} className="h-16 w-16 rounded object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((ph) => ph.filter((_, idx) => idx !== i))}
                      className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>{item ? "Save" : isRepair ? "Save maintenance item" : "Save works project"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceItemRow({ item }: { item: MaintenanceItem }) {
  const { deleteMaintenanceItem, state } = useStore();
  const prop = state.properties.find((p) => p.id === item.propertyId);
  const amount = item.itemType === "Repair" ? item.cost : item.budget;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {item.itemType === "Repair" ? <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> : <HardHat className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="font-medium">{item.title}</span>
          <Badge variant="secondary" className="text-[10px]">
            {item.status}
          </Badge>
          {item.priority && (
            <Badge variant={item.priority === "Urgent" || item.priority === "High" ? "destructive" : "outline"} className="text-[10px]">
              {item.priority}
            </Badge>
          )}
          {item.projectType && (
            <Badge variant="outline" className="text-[10px]">
              {item.projectType}
            </Badge>
          )}
        </div>
        {item.description && <div className="mt-0.5 text-muted-foreground">{item.description}</div>}
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
          {item.tradeCategory && <span>{item.tradeCategory}</span>}
          {(item.scheduledDate || item.startDate) && <span>{item.itemType === "Repair" ? "Due" : "Start"} {item.scheduledDate || item.startDate}</span>}
          {item.completedDate && <span>Completed {item.completedDate}</span>}
          {amount !== undefined && <span>{fmtCurrency(amount)}</span>}
          {item.contractorName && <span>{item.contractorName}</span>}
        </div>
        {item.progressNotes && <div className="mt-1 whitespace-pre-wrap">{item.progressNotes}</div>}
        {item.photos.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.photos.map((p, i) => (
              <img key={i} src={p.data} alt={p.name} className="h-10 w-10 rounded object-cover" />
            ))}
          </div>
        )}
        {item.sourceFileData && (
          <button type="button" onClick={() => openBillDocument(item.sourceFileName, item.sourceFileData)} className="mt-1 inline-flex items-center gap-1 text-primary underline">
            <FileText className="h-3 w-3" /> Document
          </button>
        )}
      </div>
      {prop && (
        <div className="flex shrink-0 gap-1">
          <MaintenanceItemDialog
            prop={prop}
            itemType={item.itemType}
            item={item}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              if (confirm(`Delete "${item.title}"?`)) {
                deleteMaintenanceItem(item.id);
                toast.success("Removed");
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function WarrantyReceiptRow({ expense }: { expense: Expense }) {
  const expiring = expense.hasWarranty && expense.warrantyExpiry ? daysUntil(expense.warrantyExpiry) : undefined;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{expense.itemName}</span>
          {expiring !== undefined && (
            <Badge variant={expiring < 0 ? "destructive" : "outline"} className="text-[10px]">
              {expiring < 0 ? "Expired" : `Expires in ${expiring}d`}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
          <span>{fmtCurrency(expense.cost)}</span>
          <span>{expense.date}</span>
        </div>
        {expense.invoiceFileData && (
          <DocumentLink fileName={expense.invoiceFileName} fileData={expense.invoiceFileData} className="mt-1 inline-flex items-center gap-1 text-primary underline">
            <FileText className="h-3 w-3" /> Invoice
          </DocumentLink>
        )}
      </div>
    </div>
  );
}

export function PropertyMaintenanceTab({ prop }: { prop: Property }) {
  const { state } = useStore();
  const items = state.maintenanceItems
    .filter((m) => m.propertyId === prop.id)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const warrantyExpenses = state.expenses
    .filter((e) => e.propertyId === prop.id && (e.category === "Repairs & Maintenance" || e.hasWarranty))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">Repairs and major work projects tracked against this property.</div>
          <div className="flex gap-2">
            <MaintenanceItemDialog
              prop={prop}
              itemType="Repair"
              trigger={
                <Button size="sm" variant="outline" className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add a repair / small work item
                </Button>
              }
            />
            <MaintenanceItemDialog
              prop={prop}
              itemType="Major Work"
              trigger={
                <Button size="sm" className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add a major work item
                </Button>
              }
            />
          </div>
        </div>
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            <Wrench className="mx-auto mb-2 h-6 w-6" />
            No maintenance items yet.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((m) => (
              <MaintenanceItemRow key={m.id} item={m} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-4">
        <div className="mb-2 text-sm font-medium">Warranties &amp; receipts</div>
        <div className="mb-2 text-xs text-muted-foreground">
          AI-ingested repair/maintenance invoices and anything carrying a warranty.
        </div>
        {warrantyExpenses.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No warranties or maintenance receipts on file yet.
          </div>
        ) : (
          <div className="space-y-2">
            {warrantyExpenses.map((e) => (
              <WarrantyReceiptRow key={e.id} expense={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Compliance                                                                                    */
/* ------------------------------------------------------------------------------------------- */

function ComplianceCertificateDialog({
  prop,
  cert,
  trigger,
}: {
  prop: Property;
  cert?: ComplianceCertificate;
  trigger?: React.ReactNode;
}) {
  const { addComplianceCertificate, updateComplianceCertificate } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    certType: cert?.certType ?? ("Smoke Alarm" as ComplianceCertType),
    issuer: cert?.issuer ?? "",
    referenceNumber: cert?.referenceNumber ?? "",
    notes: cert?.notes ?? "",
    issueDate: cert?.issueDate ?? "",
    expiryDate: cert?.expiryDate ?? "",
    fileName: cert?.fileName ?? "",
    fileData: cert?.fileData ?? "",
  });

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    const data = await readFileAsDataUrl(f);
    setForm((s) => ({ ...s, fileName: f.name, fileData: data }));
  };

  const save = () => {
    const payload = {
      propertyId: prop.id,
      certType: form.certType,
      issuer: form.issuer.trim() || undefined,
      referenceNumber: form.referenceNumber.trim() || undefined,
      notes: form.notes.trim() || undefined,
      issueDate: form.issueDate || undefined,
      expiryDate: form.expiryDate || undefined,
      fileName: form.fileName || undefined,
      fileData: form.fileData || undefined,
    };
    if (cert) {
      updateComplianceCertificate(cert.id, payload);
      toast.success("Certificate updated");
    } else {
      addComplianceCertificate(payload);
      toast.success("Certificate added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add certificate
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cert ? "Edit compliance certificate" : "Add compliance certificate"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Upload document</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {form.fileName && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
                <span className="truncate">{form.fileName}</span>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.fileName, form.fileData)}>
                  <Eye className="h-3 w-3" /> View
                </Button>
              </div>
            )}
          </div>
          <Field label="Certificate type">
            <Select value={form.certType} onValueChange={(v) => setForm((f) => ({ ...f, certType: v as ComplianceCertType }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLIANCE_CERT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date">
              <Input type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Issuer / inspector">
            <Input value={form.issuer} onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))} placeholder="Search or add an issuer" />
          </Field>
          <Field label="Certificate / reference number">
            <Input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save compliance certificate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComplianceCertificateRow({ cert }: { cert: ComplianceCertificate }) {
  const { deleteComplianceCertificate, state } = useStore();
  const prop = state.properties.find((p) => p.id === cert.propertyId);
  const expiring = cert.expiryDate ? daysUntil(cert.expiryDate) : undefined;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{cert.certType}</span>
          {expiring !== undefined && expiring <= 60 && (
            <Badge variant={expiring < 0 ? "destructive" : "outline"} className="text-[10px]">
              {expiring < 0 ? "Expired" : `Due in ${expiring}d`}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
          {cert.issuer && <span>{cert.issuer}</span>}
          {cert.referenceNumber && <span>#{cert.referenceNumber}</span>}
          {cert.issueDate && <span>Issued {cert.issueDate}</span>}
          {cert.expiryDate && <span>Expires {cert.expiryDate}</span>}
        </div>
        {cert.notes && <div className="mt-1 whitespace-pre-wrap">{cert.notes}</div>}
        {cert.fileData && (
          <button type="button" onClick={() => openBillDocument(cert.fileName, cert.fileData)} className="mt-1 inline-flex items-center gap-1 text-primary underline">
            <FileText className="h-3 w-3" /> Document
          </button>
        )}
      </div>
      {prop && (
        <div className="flex shrink-0 gap-1">
          <ComplianceCertificateDialog
            prop={prop}
            cert={cert}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              if (confirm(`Delete this ${cert.certType} certificate?`)) {
                deleteComplianceCertificate(cert.id);
                toast.success("Removed");
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function PropertyCertificatesTab({ prop }: { prop: Property }) {
  const { state } = useStore();
  const certs = state.complianceCertificates
    .filter((c) => c.propertyId === prop.id)
    .sort((a, b) => (b.issueDate ?? b.created_at ?? "").localeCompare(a.issueDate ?? a.created_at ?? ""));

  return (
    <div className="space-y-4 text-sm">
      {prop.strataLevyAmount && (
        <div className="rounded border p-2 text-xs">
          <span className="text-muted-foreground">Strata levy </span>
          <span className="font-medium">{fmtCurrency(prop.strataLevyAmount)} / {prop.strataLevyFrequency ?? "—"}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Every compliance certificate/inspection result on file for this property.</div>
        <ComplianceCertificateDialog prop={prop} />
      </div>
      {certs.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
          No compliance certificates on file yet.
        </div>
      ) : (
        <div className="space-y-2">
          {certs.map((c) => (
            <ComplianceCertificateRow key={c.id} cert={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Notes                                                                                         */
/* ------------------------------------------------------------------------------------------- */

const NOTE_CATEGORIES = ["General", "Tenancy", "Finance", "Maintenance", "Compliance", "Insurance", "Other"];

function PropertyNoteDialog({ prop, note, trigger }: { prop: Property; note?: PropertyNote; trigger?: React.ReactNode }) {
  const { addPropertyNote, updatePropertyNote } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    unitId: note?.unitId ?? SHARED_UNIT,
    title: note?.title ?? "",
    category: note?.category ?? "General",
    tagsText: note?.tags?.join(", ") ?? "",
    reminderDate: note?.reminderDate ?? "",
    content: note?.content ?? "",
  });
  const [attachments, setAttachments] = useState<{ name: string; data: string }[]>(note?.attachments ?? []);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(async (f) => {
      const data = await readFileAsDataUrl(f);
      setAttachments((a) => [...a, { name: f.name, data }]);
    });
  };

  const save = () => {
    if (!form.title.trim()) return toast.error("Title is required");
    const payload = {
      propertyId: prop.id,
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      title: form.title.trim(),
      category: form.category || undefined,
      tags: form.tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      reminderDate: form.reminderDate || undefined,
      content: form.content.trim() || undefined,
      attachments,
    };
    if (note) {
      updatePropertyNote(note.id, payload);
      toast.success("Note updated");
    } else {
      addPropertyNote(payload);
      toast.success("Note added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add Note
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Note title" />
          </Field>
          <UnitScopeField prop={prop} unitId={form.unitId} onChange={(v) => setForm((f) => ({ ...f, unitId: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reminder date (optional)">
              <Input type="date" value={form.reminderDate} onChange={(e) => setForm((f) => ({ ...f, reminderDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Tags (comma-separated)">
            <Input value={form.tagsText} onChange={(e) => setForm((f) => ({ ...f, tagsText: e.target.value }))} placeholder="e.g. urgent, agent, renewal" />
          </Field>
          <Field label="Content">
            <Textarea rows={5} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          </Field>
          <div className="space-y-1">
            <Label className="text-xs">Attachments</Label>
            <Input type="file" multiple onChange={(e) => onFiles(e.target.files)} />
            {attachments.length > 0 && (
              <div className="space-y-1 pt-1">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs">
                    <span className="truncate">{a.name}</span>
                    <button type="button" onClick={() => setAttachments((att) => att.filter((_, idx) => idx !== i))}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>{note ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PropertyNoteRow({ note }: { note: PropertyNote }) {
  const { deletePropertyNote, state } = useStore();
  const prop = state.properties.find((p) => p.id === note.propertyId);
  const reminderDays = note.reminderDate ? daysUntil(note.reminderDate) : undefined;
  return (
    <div className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{note.title}</span>
          {note.category && (
            <Badge variant="secondary" className="text-[10px]">
              {note.category}
            </Badge>
          )}
          {note.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              {t}
            </Badge>
          ))}
          {reminderDays !== undefined && (
            <Badge variant={reminderDays <= 0 ? "destructive" : "outline"} className="text-[10px]">
              Reminder {note.reminderDate}
            </Badge>
          )}
        </div>
        {note.content && <div className="mt-1 whitespace-pre-wrap">{note.content}</div>}
        {note.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {note.attachments.map((a, i) => (
              <button key={i} type="button" onClick={() => openBillDocument(a.name, a.data)} className="inline-flex items-center gap-1 text-primary underline">
                <FileText className="h-3 w-3" /> {a.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {prop && (
        <div className="flex shrink-0 gap-1">
          <PropertyNoteDialog
            prop={prop}
            note={note}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              if (confirm(`Delete note "${note.title}"?`)) {
                deletePropertyNote(note.id);
                toast.success("Note deleted");
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function PropertyNotesTab({ prop }: { prop: Property }) {
  const { state } = useStore();
  const notes = state.propertyNotes
    .filter((n) => n.propertyId === prop.id)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Reminders, context and decisions kept against this property.</div>
        <PropertyNoteDialog prop={prop} />
      </div>
      {notes.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">No notes yet.</div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <PropertyNoteRow key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}
