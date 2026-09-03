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
import { Plus, Trash2, FileUp, AlertTriangle, Eye, CheckCircle2, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayISO, fmtCurrency, itemAnnualClaims, ausFinancialYear, fyRange } from "@/lib/calculations";
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
  /** Hand-typed overrides of the computed Year N claim, keyed by year index (0 = Year 1) —
   * sparse, so a row that's never been touched costs nothing and still tracks the live formula. */
  overrides: Record<number, string>;
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
  overrides: {},
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // Hand-typed overrides of the report-level Annual Deductions table, keyed by year index — this
  // is the report's OWN stated Year N Div 40/Div 43 total (see reportAnnualSummary on
  // DepreciationItem), independent of any single item's own override.
  const [reportOverrides, setReportOverrides] = useState<Record<number, { div40?: string; div43?: string }>>({});

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
    setExpandedKeys(new Set());
    setReportOverrides({});
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
              overrides: {},
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

  const setOverride = (row: AssetRow, yearIndex: number, value: string) =>
    updateItem(row.key, { overrides: { ...row.overrides, [yearIndex]: value } });
  const resetOverride = (row: AssetRow, yearIndex: number) => {
    const next = { ...row.overrides };
    delete next[yearIndex];
    updateItem(row.key, { overrides: next });
  };

  const setReportOverride = (yearIndex: number, field: "div40" | "div43", value: string) =>
    setReportOverrides((prev) => ({ ...prev, [yearIndex]: { ...prev[yearIndex], [field]: value } }));
  const resetReportOverride = (yearIndex: number) =>
    setReportOverrides((prev) => {
      const next = { ...prev };
      delete next[yearIndex];
      return next;
    });

  const toggleExpanded = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onDivisionChange = (row: AssetRow, division: Division) =>
    // Switching a row to Div 43 forces Prime Cost along with it — see defaultMethodForDivision.
    updateItem(row.key, { division, method: division === "Div 43" ? "Prime Cost" : row.method });

  const onDescriptionBlur = (row: AssetRow) => {
    if (row.lifeYears) return;
    const suggested = suggestEffectiveLife(row.description);
    if (suggested) updateItem(row.key, { lifeYears: String(suggested) });
  };

  // Every item in one report shares the same start date for pro-rating its first year's claim.
  // Only an actual Effective From counts as a real anchor — falling back to the report date (or
  // today) would pro-rate Year 1 against a date that has nothing to do with when the asset was
  // actually acquired, understating it for no real reason. Until Effective From is filled in,
  // default to the start of the current financial year instead, so the preview shows a full,
  // round Year 1 rather than an arbitrary partial one.
  const startISO = form.effectiveFrom || fyRange(ausFinancialYear(todayISO())).start;

  const itemPreviews = items.map((it) => {
    const cost = parseFloat(it.cost) || 0;
    const life = parseFloat(it.lifeYears) || 1;
    const computed = cost > 0 ? itemAnnualClaims(cost, life, it.method, startISO) : [];
    const overrideMaxIndex = Object.keys(it.overrides).reduce((max, k) => Math.max(max, parseInt(k, 10)), -1);
    const years = Math.max(computed.length, overrideMaxIndex + 1);
    const claims = Array.from({ length: years }, (_, i) => {
      const raw = it.overrides[i];
      if (raw !== undefined && raw !== "") {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) return n;
      }
      return computed[i] ?? 0;
    });
    return { key: it.key, division: it.division, cost, computed, claims };
  });

  const totalClaimable = itemPreviews.reduce((s, p) => s + p.cost, 0);
  const scheduleYears = items.reduce((max, it) => Math.max(max, parseFloat(it.lifeYears) || 0), 0);
  const maxYears = Math.max(Math.ceil(scheduleYears), ...itemPreviews.map((p) => p.claims.length), 0);
  // The report's own Year N Div 40/Div 43 total defaults to the sum of every item's own (already
  // override-aware) claim for that year, but can be hand-corrected independently at the report
  // level too — e.g. to match the source document's own rounding, without having to track down
  // which single item accounts for the difference.
  const annualRows = Array.from({ length: Math.min(50, maxYears) }, (_, i) => {
    const computedDiv40 = itemPreviews.filter((p) => p.division === "Div 40").reduce((s, p) => s + (p.claims[i] ?? 0), 0);
    const computedDiv43 = itemPreviews.filter((p) => p.division === "Div 43").reduce((s, p) => s + (p.claims[i] ?? 0), 0);
    const override = reportOverrides[i];
    const div40Raw = override?.div40;
    const div43Raw = override?.div43;
    const div40 = div40Raw !== undefined && div40Raw !== "" && Number.isFinite(parseFloat(div40Raw)) ? parseFloat(div40Raw) : computedDiv40;
    const div43 = div43Raw !== undefined && div43Raw !== "" && Number.isFinite(parseFloat(div43Raw)) ? parseFloat(div43Raw) : computedDiv43;
    return { year: i + 1, div40, div43, total: div40 + div43, computedDiv40, computedDiv43, overridden: !!(div40Raw || div43Raw) };
  });
  const year1Div40 = annualRows[0]?.div40 ?? 0;
  const year1Div43 = annualRows[0]?.div43 ?? 0;
  const grandTotal = annualRows.reduce(
    (acc, r) => ({ div40: acc.div40 + r.div40, div43: acc.div43 + r.div43, total: acc.total + r.total }),
    { div40: 0, div43: 0, total: 0 },
  );

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
    const reportId = uid("dr");
    // Materialized once, at save time, from the (possibly hand-corrected) Annual Deductions
    // table — denormalized onto every item below, same as quantitySurveyor/reportDate/etc.
    const reportAnnualSummary = annualRows.map((r) => ({
      div40: Math.round(r.div40 * 100) / 100,
      div43: Math.round(r.div43 * 100) / 100,
    }));
    let savedCount = 0;
    items.forEach((it, idx) => {
      if (!it.description.trim() || !(parseFloat(it.cost) > 0)) return;
      savedCount++;
      const preview = itemPreviews[idx];
      addDepreciationItem({
        assetId,
        description: it.description.trim(),
        purchaseCost: parseFloat(it.cost) || 0,
        effectiveLifeYears: parseFloat(it.lifeYears) || 1,
        purchaseDate: form.effectiveFrom || undefined,
        method: it.method,
        division: it.division,
        // Materialized now, at save time, so this item's schedule is locked in from here on —
        // see the annualClaims field doc on DepreciationItem for why.
        annualClaims: preview.claims.map((c) => Math.round(c * 100) / 100),
        reportAnnualSummary,
        reportId,
        quantitySurveyor: form.quantitySurveyor || undefined,
        reportReference: form.reportReference || undefined,
        reportDate: form.reportDate || undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        sourceFileName: form.sourceFileName,
        sourceFileData: form.sourceFileData,
      });
    });

    if (savedCount === 0) return toast.error("Add at least one asset with a description and cost");

    setOpen(false);
    reset();
    toast.success(`Added ${savedCount} depreciation item(s) from report`);
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
              {items.map((it, idx) => {
                const preview = itemPreviews[idx];
                const isExpanded = expandedKeys.has(it.key);
                return (
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
                      <Button size="icon" variant="ghost" title="Delete asset" onClick={() => removeItem(it.key)}>
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
                        <Input
                          type="number"
                          value={it.overrides[0] ?? ""}
                          placeholder={(preview?.computed[0] ?? 0).toFixed(2)}
                          onChange={(e) => setOverride(it, 0, e.target.value)}
                        />
                      </Field>
                    </div>
                    {preview && preview.claims.length > 1 && (
                      <div>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => toggleExpanded(it.key)}
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {isExpanded ? "Hide" : "Edit"} full schedule ({preview.claims.length} years)
                        </button>
                        {isExpanded && (
                          <div className="mt-2 max-h-56 overflow-y-auto rounded border">
                            <table className="w-full text-xs" data-testid="item-schedule-table">
                              <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1 text-left font-normal">Year</th>
                                  <th className="px-2 py-1 text-left font-normal">Amount</th>
                                  <th className="w-8 px-2 py-1"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.claims.map((_, i) => {
                                  const overridden = it.overrides[i] !== undefined && it.overrides[i] !== "";
                                  return (
                                    <tr key={i} className="border-t">
                                      <td className="px-2 py-1">Year {i + 1}</td>
                                      <td className="px-2 py-1">
                                        <Input
                                          type="number"
                                          className="h-7"
                                          value={it.overrides[i] ?? ""}
                                          placeholder={(preview.computed[i] ?? 0).toFixed(2)}
                                          onChange={(e) => setOverride(it, i, e.target.value)}
                                        />
                                      </td>
                                      <td className="px-2 py-1">
                                        {overridden && (
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6"
                                            title="Reset to computed value"
                                            onClick={() => resetOverride(it, i)}
                                          >
                                            <RotateCcw className="h-3 w-3" />
                                          </Button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {annualRows.length > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-xs font-medium">Annual deductions (from the report)</div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full table-fixed text-xs">
                    <colgroup>
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "26%" }} />
                      <col style={{ width: "26%" }} />
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "12%" }} />
                    </colgroup>
                    <thead className="sticky top-0 bg-background text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-normal">Year</th>
                        <th className="py-1 text-right font-normal">Div 40</th>
                        <th className="py-1 text-right font-normal">Div 43</th>
                        <th className="py-1 text-right font-normal">Total</th>
                        <th className="py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualRows.map((r, i) => (
                        <tr key={r.year} className="border-t">
                          <td className="py-1">Year {r.year}</td>
                          <td className="py-1 pl-2">
                            <Input
                              type="number"
                              className="h-7 text-right"
                              value={reportOverrides[i]?.div40 ?? ""}
                              placeholder={r.computedDiv40.toFixed(2)}
                              onChange={(e) => setReportOverride(i, "div40", e.target.value)}
                            />
                          </td>
                          <td className="py-1 pl-2">
                            <Input
                              type="number"
                              className="h-7 text-right"
                              value={reportOverrides[i]?.div43 ?? ""}
                              placeholder={r.computedDiv43.toFixed(2)}
                              onChange={(e) => setReportOverride(i, "div43", e.target.value)}
                            />
                          </td>
                          <td className="py-1 text-right font-medium">{fmtCurrency(r.total)}</td>
                          <td className="py-1 text-center">
                            {r.overridden && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                title="Reset to computed value"
                                onClick={() => resetReportOverride(i)}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <table className="w-full table-fixed border-t pt-2 text-xs font-medium">
                  <colgroup>
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "12%" }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <td className="pt-2">Total (Year 1–{annualRows.length})</td>
                      <td className="pt-2 text-right">{fmtCurrency(grandTotal.div40)}</td>
                      <td className="pt-2 text-right">{fmtCurrency(grandTotal.div43)}</td>
                      <td className="pt-2 text-right">{fmtCurrency(grandTotal.total)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
