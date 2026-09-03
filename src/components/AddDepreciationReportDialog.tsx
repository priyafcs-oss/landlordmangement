import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Stat } from "@/components/Field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileUp, AlertTriangle, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayISO, fmtCurrency, itemAnnualClaims } from "@/lib/calculations";
import { suggestEffectiveLife } from "@/lib/atoEffectiveLife";
import { matchPropertyByAddress } from "@/lib/addressMatch";
import {
  openBillDocument,
  MAX_AI_UPLOAD_BYTES,
  formatFileSize,
  readFileAsBase64,
  isSupportedDocumentFile,
  ACCEPTED_DOCUMENT_TYPES_LABEL,
  ACCEPTED_DOCUMENT_TYPES_ACCEPT,
} from "@/lib/files";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { DepreciationItem } from "@/lib/types";

const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);

type Division = NonNullable<DepreciationItem["division"]>;
type Method = NonNullable<DepreciationItem["method"]>;

interface AssetRow {
  key: string;
  description: string;
  division: Division;
  method: Method;
  cost: string;
  lifeYears: string;
}

interface ExtractResult {
  ok?: boolean;
  error?: string;
  quantity_surveyor?: string;
  report_reference?: string;
  report_date?: string;
  effective_from?: string;
  property_address?: string;
  items?: { description: string; division?: string; cost: number; life_years?: number }[];
}

/** Division 43 (capital works) is only ever claimable on a straight-line basis under ATO rules —
 * unlike Div 40 (plant & equipment), it has no diminishing-value option, so the Method field is
 * locked to Prime Cost whenever a row's tax category is Div 43. */
function defaultMethodForDivision(division: Division): Method {
  return division === "Div 43" ? "Prime Cost" : "Diminishing Value";
}

const blankAsset = (): AssetRow => ({
  key: uid("da"),
  description: "",
  division: "Div 40",
  method: defaultMethodForDivision("Div 40"),
  cost: "",
  lifeYears: "",
});

function mapDivision(raw?: string): Division {
  return (raw ?? "").toLowerCase().includes("43") || (raw ?? "").toLowerCase().includes("capital works") ? "Div 43" : "Div 40";
}

/**
 * Bulk QS-report upload for depreciation — mirrors AddBillDialog's document-pane-plus-extract
 * shape. Always scoped to a single already-known assetId (called from a property's own
 * Depreciation tab), so unlike AddBillDialog there's no property picker — the property section
 * below is read-only context plus an address-mismatch check, not a switcher.
 */
export function AddDepreciationReportDialog({ assetId }: { assetId?: string }) {
  const { state, addDepreciationItem } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extractOk, setExtractOk] = useState(false);
  const [extractEmpty, setExtractEmpty] = useState(false);
  const [extractedAddress, setExtractedAddress] = useState<string | undefined>();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const asset = state.assets.find((a) => a.id === assetId);
  const prop = asset ? state.properties.find((p) => p.id === asset.linkedPropertyId || p.assetId === asset.id) : undefined;

  const blankForm = () => ({
    quantitySurveyor: "",
    reportReference: "",
    reportDate: todayISO(),
    effectiveFrom: "",
    sourceFileName: undefined as string | undefined,
    sourceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());
  const [items, setItems] = useState<AssetRow[]>([blankAsset()]);
  // Bumped on every reset() so an extraction still in flight when the dialog is closed/reset
  // can tell its own result is stale and skip applying it, instead of repopulating a "blank"
  // form with a previous, unrelated upload's data once the Gemini call finally resolves.
  const generationRef = useRef(0);

  const reset = () => {
    generationRef.current++;
    setForm(blankForm());
    setItems([blankAsset()]);
    setExtractOk(false);
    setExtractEmpty(false);
    setExtractedAddress(undefined);
    setBannerDismissed(false);
  };

  const extract = async (file: File) => {
    if (!isSupportedDocumentFile(file)) {
      return toast.error(`${file.name} isn't a PDF or image — the AI reader (and the preview pane) only support those. Try exporting/saving it as a PDF first.`);
    }
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    const generation = generationRef.current;
    setBusy(true);
    setExtractOk(false);
    setExtractEmpty(false);
    try {
      const base64 = await readFileAsBase64(file);
      if (generationRef.current !== generation) return;
      setForm((f) => ({ ...f, sourceFileName: file.name, sourceFileData: base64 }));

      const { data, error } = await supabase.functions.invoke<ExtractResult>("extract-depreciation-report", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (generationRef.current !== generation) return;
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this report");
        return;
      }

      setForm((f) => ({
        ...f,
        quantitySurveyor: data.quantity_surveyor ?? f.quantitySurveyor,
        reportReference: data.report_reference ?? f.reportReference,
        reportDate: data.report_date ?? f.reportDate,
        effectiveFrom: data.effective_from ?? f.effectiveFrom,
      }));
      setExtractedAddress(data.property_address || undefined);
      setBannerDismissed(false);

      if (data.items?.length) {
        setItems(
          data.items.map((it) => {
            const division = mapDivision(it.division);
            return {
              key: uid("da"),
              description: it.description ?? "",
              division,
              method: defaultMethodForDivision(division),
              cost: it.cost ? String(it.cost) : "",
              lifeYears: it.life_years ? String(it.life_years) : String(suggestEffectiveLife(it.description ?? "") ?? ""),
            };
          }),
        );
        setExtractOk(true);
        toast.success(`Extracted ${data.items.length} asset(s) — review before saving`);
      } else {
        setExtractEmpty(true);
        toast.warning("Couldn't find asset line items in this file — add them manually below");
      }
    } catch (e) {
      if (generationRef.current === generation) toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      if (generationRef.current === generation) setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void extract(f);
  };

  const addItem = () => setItems((rows) => [...rows, blankAsset()]);
  const removeItem = (key: string) => setItems((rows) => rows.filter((r) => r.key !== key));
  const updateItem = (key: string, patch: Partial<AssetRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onDivisionChange = (row: AssetRow, division: Division) =>
    // Switching a row to Div 43 forces Prime Cost along with it — see defaultMethodForDivision.
    updateItem(row.key, { division, method: division === "Div 43" ? "Prime Cost" : row.method });

  const onDescriptionBlur = (row: AssetRow) => {
    if (row.lifeYears) return;
    const suggested = suggestEffectiveLife(row.description);
    if (suggested) updateItem(row.key, { lifeYears: String(suggested) });
  };

  // Every item in one report shares the same start date for pro-rating its first year's claim —
  // effectiveFrom (settlement/purchase date) if known, else the report's own date, else today.
  const startISO = form.effectiveFrom || form.reportDate || todayISO();
  const itemPreviews = items.map((it) => {
    const cost = parseFloat(it.cost) || 0;
    const life = parseFloat(it.lifeYears) || 1;
    return { key: it.key, division: it.division, cost, claims: cost > 0 ? itemAnnualClaims(cost, life, it.method, startISO) : [] };
  });
  const totalClaimable = itemPreviews.reduce((s, p) => s + p.cost, 0);
  const year1Div40 = itemPreviews.filter((p) => p.division === "Div 40").reduce((s, p) => s + (p.claims[0] ?? 0), 0);
  const year1Div43 = itemPreviews.filter((p) => p.division === "Div 43").reduce((s, p) => s + (p.claims[0] ?? 0), 0);
  const scheduleYears = items.reduce((max, it) => Math.max(max, parseFloat(it.lifeYears) || 0), 0);
  const maxYears = Math.min(50, Math.ceil(scheduleYears));
  const annualRows = Array.from({ length: maxYears }, (_, i) => {
    const div40 = itemPreviews.filter((p) => p.division === "Div 40").reduce((s, p) => s + (p.claims[i] ?? 0), 0);
    const div43 = itemPreviews.filter((p) => p.division === "Div 43").reduce((s, p) => s + (p.claims[i] ?? 0), 0);
    return { year: i + 1, div40, div43, total: div40 + div43 };
  });

  const propertyMismatch = (() => {
    if (!extractedAddress || !prop) return undefined;
    const matched = matchPropertyByAddress(state.properties, extractedAddress);
    if (matched && matched.id !== prop.id) return { extracted: extractedAddress, actual: prop.alias || prop.address };
    return undefined;
  })();

  const missingAssetDetails = items.some((it) => it.description.trim() && !(parseFloat(it.cost) > 0 && parseFloat(it.lifeYears) > 0));
  const bannerReasons: string[] = [];
  if (extractEmpty) bannerReasons.push("No asset line items could be read from this file — add them manually below.");
  if (missingAssetDetails) bannerReasons.push("Some assets are missing a cost or an effective life.");
  if (propertyMismatch) bannerReasons.push(`The report reads as "${propertyMismatch.extracted}" — different to ${propertyMismatch.actual}. Check the address before saving.`);
  const showBanner = !bannerDismissed && !!form.sourceFileName && bannerReasons.length > 0;

  const save = () => {
    if (!assetId) return toast.error("No property/asset selected");
    const valid = items.filter((it) => it.description.trim() && parseFloat(it.cost) > 0);
    if (valid.length === 0) return toast.error("Add at least one asset with a description and cost");

    const reportId = uid("dr");
    for (const it of valid) {
      addDepreciationItem({
        assetId,
        description: it.description.trim(),
        purchaseCost: parseFloat(it.cost) || 0,
        effectiveLifeYears: parseFloat(it.lifeYears) || 1,
        purchaseDate: form.effectiveFrom || undefined,
        method: it.method,
        division: it.division,
        reportId,
        quantitySurveyor: form.quantitySurveyor || undefined,
        reportReference: form.reportReference || undefined,
        reportDate: form.reportDate || undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        sourceFileName: form.sourceFileName,
        sourceFileData: form.sourceFileData,
      });
    }

    setOpen(false);
    reset();
    toast.success(`Added ${valid.length} depreciation item(s) from report`);
  };

  const keepDocumentFiledOnly = () => {
    setOpen(false);
    reset();
    toast("Closed without saving any depreciation items.");
  };

  const addMissingAssetDetails = () => {
    setBannerDismissed(true);
    if (items.every((it) => !it.description.trim())) addItem();
    toast("Fill in the highlighted assets below, then save.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="h-3 w-3" /> Add depreciation report
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden">
        <DialogHeader className="flex-row items-start justify-between space-y-0 pr-10">
          <div>
            <DialogTitle>New depreciation report</DialogTitle>
            <div className="text-xs text-muted-foreground">Upload a quantity surveyor's report for AI extraction, or enter assets manually.</div>
          </div>
          <Button onClick={save} disabled={busy} className="shrink-0">
            Save report
          </Button>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-hidden text-sm md:grid-cols-2">
          <div className="space-y-3 overflow-y-auto pr-1">
            <div
              className={
                "rounded-md border-2 border-dashed p-6 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <FileUp className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">
                  {busy ? "Reading report…" : "Drop a QS report here, or choose a file."}
                </div>
                <div className="text-xs text-muted-foreground">Accepts {ACCEPTED_DOCUMENT_TYPES_LABEL}</div>
                <Input
                  type="file"
                  accept={ACCEPTED_DOCUMENT_TYPES_ACCEPT}
                  className="h-8 max-w-[240px] text-xs"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void extract(f);
                  }}
                />
              </div>
              {form.sourceFileName && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                  <span className="truncate text-xs">{form.sourceFileName}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 gap-1 text-xs"
                    onClick={() => openBillDocument(form.sourceFileName, form.sourceFileData)}
                  >
                    <Eye className="h-3 w-3" /> View
                  </Button>
                </div>
              )}
              {extractOk && (
                <div className="mt-2 flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs text-emerald-900">
                  <CheckCircle2 className="h-3 w-3 shrink-0" /> Assets extracted — review before saving.
                </div>
              )}
            </div>

            <BillDocumentViewer fileName={form.sourceFileName} fileData={form.sourceFileData} />
          </div>

          <div className="space-y-4 overflow-y-auto pl-1">
            {showBanner && (
              <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Check the incomplete report details
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {bannerReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBannerDismissed(true)}>
                    I reviewed the shown details
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addMissingAssetDetails}>
                    Add missing asset details
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={keepDocumentFiledOnly}>
                    Keep document filed only
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Total claimable" value={fmtCurrency(totalClaimable)} strong />
              <Stat label="Year 1 · Div 40" value={fmtCurrency(year1Div40)} />
              <Stat label="Year 1 · Div 43" value={fmtCurrency(year1Div43)} />
              <Stat label="Schedule" value={scheduleYears > 0 ? `${Math.ceil(scheduleYears)} yrs` : "—"} />
            </div>

            {prop && (
              <div className="space-y-1 rounded-md border p-3">
                <div className="text-xs font-medium text-muted-foreground">Property</div>
                <div className="text-sm">{prop.alias || prop.address}</div>
                {propertyMismatch && (
                  <div className="flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    The report reads as "{propertyMismatch.extracted}" — different to the property you opened this from ({propertyMismatch.actual}). Please check the address before saving.
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quantity surveyor">
                <Input value={form.quantitySurveyor} onChange={(e) => setForm((f) => ({ ...f, quantitySurveyor: e.target.value }))} />
              </Field>
              <Field label="Report reference">
                <Input value={form.reportReference} onChange={(e) => setForm((f) => ({ ...f, reportReference: e.target.value }))} />
              </Field>
              <Field label="Report date">
                <Input type="date" value={form.reportDate} onChange={(e) => setForm((f) => ({ ...f, reportDate: e.target.value }))} />
              </Field>
              <Field label="Effective from">
                <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
              </Field>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Depreciating assets</div>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addItem}>
                  <Plus className="h-3 w-3" /> Add item
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={it.key} className="space-y-2 rounded border p-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label="Asset">
                        <Input
                          value={it.description}
                          onChange={(e) => updateItem(it.key, { description: e.target.value })}
                          onBlur={() => onDescriptionBlur(it)}
                          placeholder="e.g. hot water system, carpet"
                        />
                      </Field>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeItem(it.key)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Field label="Tax category">
                      <Select value={it.division} onValueChange={(v) => onDivisionChange(it, v as Division)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Div 40">Division 40</SelectItem>
                          <SelectItem value="Div 43">Division 43</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Opening value">
                      <Input type="number" value={it.cost} onChange={(e) => updateItem(it.key, { cost: e.target.value })} />
                    </Field>
                    <Field label="Method">
                      <Select
                        value={it.method}
                        onValueChange={(v) => updateItem(it.key, { method: v as Method })}
                        disabled={it.division === "Div 43"}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Prime Cost">Prime cost</SelectItem>
                          <SelectItem value="Diminishing Value">Diminishing value</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Effective life (yrs)">
                      <Input type="number" value={it.lifeYears} onChange={(e) => updateItem(it.key, { lifeYears: e.target.value })} />
                    </Field>
                    <Field label="Year 1 deduction">
                      <Input disabled value={fmtCurrency(itemPreviews[idx]?.claims[0] ?? 0)} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            {annualRows.length > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-xs font-medium">Annual deductions (from the report)</div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-normal">Year</th>
                        <th className="py-1 text-right font-normal">Div 40</th>
                        <th className="py-1 text-right font-normal">Div 43</th>
                        <th className="py-1 text-right font-normal">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualRows.map((r) => (
                        <tr key={r.year} className="border-t">
                          <td className="py-1">Year {r.year}</td>
                          <td className="py-1 text-right">{fmtCurrency(r.div40)}</td>
                          <td className="py-1 text-right">{fmtCurrency(r.div43)}</td>
                          <td className="py-1 text-right font-medium">{fmtCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
