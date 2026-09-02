import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/Field";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileUp, AlertTriangle, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/calculations";
import { suggestEffectiveLife } from "@/lib/atoEffectiveLife";
import { openBillDocument, MAX_AI_UPLOAD_BYTES, formatFileSize, readFileAsBase64 } from "@/lib/files";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { DepreciationItem } from "@/lib/types";

const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);

interface AssetRow {
  key: string;
  description: string;
  division: NonNullable<DepreciationItem["division"]>;
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
  items?: { description: string; division?: string; cost: number; life_years?: number }[];
}

const blankAsset = (): AssetRow => ({
  key: uid("da"),
  description: "",
  division: "Div 40",
  cost: "",
  lifeYears: "",
});

function mapDivision(raw?: string): NonNullable<DepreciationItem["division"]> {
  return (raw ?? "").toLowerCase().includes("43") || (raw ?? "").toLowerCase().includes("capital works") ? "Div 43" : "Div 40";
}

/**
 * Bulk QS-report upload for depreciation — mirrors AddBillDialog's document-pane-plus-extract
 * shape. Always scoped to a single already-known assetId (called from a property's own
 * Depreciation tab), so unlike AddBillDialog there's no property picker.
 */
export function AddDepreciationReportDialog({ assetId }: { assetId?: string }) {
  const { addDepreciationItem } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extractOk, setExtractOk] = useState(false);
  const [extractEmpty, setExtractEmpty] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
  };

  const extract = async (file: File) => {
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

      if (data.items?.length) {
        setItems(
          data.items.map((it) => ({
            key: uid("da"),
            description: it.description ?? "",
            division: mapDivision(it.division),
            cost: it.cost ? String(it.cost) : "",
            lifeYears: it.life_years ? String(it.life_years) : String(suggestEffectiveLife(it.description ?? "") ?? ""),
          })),
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

  const onDescriptionBlur = (row: AssetRow) => {
    if (row.lifeYears) return;
    const suggested = suggestEffectiveLife(row.description);
    if (suggested) updateItem(row.key, { lifeYears: String(suggested) });
  };

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
        method: "Diminishing Value",
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
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New depreciation report</DialogTitle>
          <div className="text-xs text-muted-foreground">Upload a quantity surveyor's report for AI extraction, or enter assets manually.</div>
        </DialogHeader>

        <div className="grid gap-4 text-sm md:grid-cols-[340px_1fr]">
          <div className="space-y-3">
            <div
              className={
                "rounded-md border border-dashed p-3 transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {busy ? "Reading report…" : "Drop a QS report here, or choose a file."}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="application/pdf,image/*"
                    className="h-8 text-xs"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void extract(f);
                    }}
                  />
                  <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
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
              {extractEmpty && (
                <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Couldn't find asset line items — the document is still attached, fill in the assets manually.
                </div>
              )}
            </div>

            <BillDocumentViewer fileName={form.sourceFileName} fileData={form.sourceFileData} />
          </div>

          <div className="space-y-4">
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
              <div className="text-xs font-medium">Depreciating assets</div>
              {items.map((it) => (
                <div key={it.key} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
                  <Field label="Description">
                    <Input
                      value={it.description}
                      onChange={(e) => updateItem(it.key, { description: e.target.value })}
                      onBlur={() => onDescriptionBlur(it)}
                      placeholder="e.g. hot water system, carpet"
                    />
                  </Field>
                  <Field label="Division">
                    <Select value={it.division} onValueChange={(v) => updateItem(it.key, { division: v as AssetRow["division"] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Div 40">Div 40</SelectItem>
                        <SelectItem value="Div 43">Div 43</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Cost">
                    <Input type="number" value={it.cost} onChange={(e) => updateItem(it.key, { cost: e.target.value })} />
                  </Field>
                  <Field label="Life (yrs)">
                    <Input type="number" value={it.lifeYears} onChange={(e) => updateItem(it.key, { lifeYears: e.target.value })} />
                  </Field>
                  <Button size="icon" variant="ghost" onClick={() => removeItem(it.key)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="gap-1" onClick={addItem}>
                <Plus className="h-3 w-3" /> Add item
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
