import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/Field";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { User, FileText, ChevronDown, ChevronUp, X, Plus } from "lucide-react";
import { inspectLeaseTemplate, LEASE_DATA_FIELDS, carryOverMapping } from "@/lib/leaseTemplate";
import type { LeaseTemplateConfig, LeaseTemplateField, ContactPerson } from "@/lib/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Landlord OS" },
      { name: "description", content: "Manage your landlord profile and notification preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { state, updateLandlordProfile } = useStore();
  const [form, setForm] = useState(state.landlordProfile);

  useEffect(() => {
    setForm(state.landlordProfile);
  }, [state.landlordProfile]);

  const save = () => {
    updateLandlordProfile(form);
    toast.success("Profile saved");
  };

  const additionalLandlords = form.additionalLandlords ?? [];
  const updateAdditionalLandlord = (idx: number, patch: Partial<ContactPerson>) => {
    setForm((f) => {
      const next = [...(f.additionalLandlords ?? [])];
      next[idx] = { ...next[idx], ...patch };
      return { ...f, additionalLandlords: next };
    });
  };
  const addAdditionalLandlord = () =>
    setForm((f) => ({ ...f, additionalLandlords: [...(f.additionalLandlords ?? []), { name: "" }] }));
  const removeAdditionalLandlord = (idx: number) =>
    setForm((f) => ({ ...f, additionalLandlords: (f.additionalLandlords ?? []).filter((_, i) => i !== idx) }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your contact details are used for bill reminders, tenant notices and system alerts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Landlord Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="Email address">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Additional landlords / owners</div>
                <div className="text-xs text-muted-foreground">
                  Co-owners on title — offered when generating a tenancy agreement.
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addAdditionalLandlord}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {additionalLandlords.map((l, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <Field label="Name">
                  <Input value={l.name} onChange={(e) => updateAdditionalLandlord(idx, { name: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={l.email ?? ""}
                    onChange={(e) => updateAdditionalLandlord(idx, { email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    inputMode="tel"
                    value={l.phone ?? ""}
                    onChange={(e) => updateAdditionalLandlord(idx, { phone: e.target.value })}
                  />
                </Field>
                <Button size="icon" variant="ghost" onClick={() => removeAdditionalLandlord(idx)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="text-sm font-medium">Notification preferences</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Email notifications</div>
                <div className="text-xs text-muted-foreground">
                  Bill reminders and compliance alerts are prepared with your email pre-filled.
                </div>
              </div>
              <Switch
                checked={form.notifyEmail}
                onCheckedChange={(v) => setForm({ ...form, notifyEmail: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">SMS notifications</div>
                <div className="text-xs text-muted-foreground">
                  Reserved — will be used when SMS delivery is wired up.
                </div>
              </div>
              <Switch
                checked={form.notifySms}
                onCheckedChange={(v) => setForm({ ...form, notifySms: v })}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save}>Save profile</Button>
          </div>
        </CardContent>
      </Card>

      <LeaseTemplateSettings />
      <TenantInfoStatementSettings />
    </div>
  );
}

function TenantInfoStatementSettings() {
  const { state, updateTenantInfoStatement } = useStore();
  const doc = state.tenantInfoStatement;

  const handleUpload = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "application/pdf") return toast.error("Please upload a PDF file");
    const reader = new FileReader();
    reader.onload = () => {
      updateTenantInfoStatement({ fileName: f.name, fileData: String(reader.result), uploadedAt: new Date().toISOString() });
      toast.success("Tenant Information Statement uploaded");
    };
    reader.readAsDataURL(f);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Tenant Information Statement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The official NSW Fair Trading Tenant Information Statement — appended after the filled
          tenancy agreement every time you generate one, since it's required to accompany the
          agreement.
        </p>
        <Input type="file" accept="application/pdf" onChange={(e) => handleUpload(e.target.files?.[0])} className="max-w-xs" />
        {doc && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-xs">
            <div>
              <div className="font-medium">{doc.fileName}</div>
              <div className="text-muted-foreground">Uploaded {new Date(doc.uploadedAt).toLocaleString("en-AU")}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => updateTenantInfoStatement(null)}>
              Remove
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeaseTemplateSettings() {
  const { state, updateLeaseTemplate } = useStore();
  const template = state.leaseTemplate;
  const [busy, setBusy] = useState(false);
  const [showFields, setShowFields] = useState(false);
  // Local editable copy so mapping changes are only persisted on explicit Save.
  const [mapping, setMapping] = useState<LeaseTemplateConfig["mapping"]>(template?.mapping ?? {});

  useEffect(() => {
    setMapping(template?.mapping ?? {});
  }, [template]);

  const handleUpload = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "application/pdf") return toast.error("Please upload a PDF file");
    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = String(reader.result);
      setBusy(true);
      try {
        const fields = await inspectLeaseTemplate(fileData);
        if (fields.length === 0) {
          toast.error("No fillable form fields found — this PDF may not be a fillable template.");
        }
        // Most field names survive between revisions of the same form — only re-map what
        // actually changed, instead of making the landlord redo everything from scratch.
        const { mapping: carried, carriedCount, droppedCount } = carryOverMapping(template?.mapping ?? {}, fields);
        const next: LeaseTemplateConfig = {
          fileName: f.name,
          fileData,
          uploadedAt: new Date().toISOString(),
          fields,
          mapping: carried,
        };
        updateLeaseTemplate(next);
        setMapping(carried);
        if (Object.keys(template?.mapping ?? {}).length > 0) {
          toast.success(
            `Template uploaded — carried over ${carriedCount} field mapping(s)` +
              (droppedCount ? `, ${droppedCount} need re-mapping` : ""),
          );
        } else {
          toast.success(`Template uploaded — found ${fields.length} fillable field(s)`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not read this PDF");
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(f);
  };

  const setFieldMapping = (ourKey: string, pdfField: string) => {
    setMapping((m) => {
      const next = { ...m };
      if (!pdfField || pdfField === "__none__") {
        delete next[ourKey];
      } else {
        next[ourKey] = { pdfField };
      }
      return next;
    });
  };

  const toggleChoiceGroup = (ourKey: string) => {
    setMapping((m) => {
      const current = m[ourKey];
      const turningOn = !current?.isChoiceGroup;
      return {
        ...m,
        [ourKey]: turningOn
          ? { pdfField: "", valueMap: current?.valueMap ?? {}, isChoiceGroup: true }
          : { pdfField: "", valueMap: current?.valueMap ?? {} },
      };
    });
  };

  const setValueMapEntry = (ourKey: string, fromValue: string, toOption: string) => {
    setMapping((m) => {
      const current = m[ourKey];
      if (!current) return m;
      return { ...m, [ourKey]: { ...current, valueMap: { ...(current.valueMap ?? {}), [fromValue]: toOption } } };
    });
  };

  const removeValueMapEntry = (ourKey: string, fromValue: string) => {
    setMapping((m) => {
      const current = m[ourKey];
      if (!current?.valueMap) return m;
      const nextValueMap = { ...current.valueMap };
      delete nextValueMap[fromValue];
      return { ...m, [ourKey]: { ...current, valueMap: nextValueMap } };
    });
  };

  const saveMapping = () => {
    if (!template) return;
    updateLeaseTemplate({ ...template, mapping });
    toast.success("Field mapping saved");
  };

  const fieldByName = (name: string) => template?.fields.find((f) => f.name === name);
  const checkboxFieldNames = template?.fields.filter((f) => f.type === "checkbox").map((f) => f.name) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Lease Agreement Template
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Upload your current official fillable tenancy agreement (e.g. your state's Fair Trading
          standard form). New tenancy agreements are generated by filling this exact document —
          nothing here is invented; it's your own sourced template plus the fields you map below.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => handleUpload(e.target.files?.[0])}
            className="max-w-xs"
          />
          {busy && <span className="text-xs text-muted-foreground">Reading PDF…</span>}
        </div>

        {template && (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{template.fileName}</div>
              <div className="text-muted-foreground">
                Uploaded {new Date(template.uploadedAt).toLocaleString("en-AU")} • {template.fields.length}{" "}
                fillable field(s) found
              </div>
            </div>

            {template.fields.length > 0 && (
              <Collapsible open={showFields} onOpenChange={setShowFields}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="w-full justify-between">
                    View raw field names found in this PDF
                    {showFields ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 max-h-56 overflow-y-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left">Field name</th>
                        <th className="px-2 py-1 text-left">Type</th>
                        <th className="px-2 py-1 text-left">Options</th>
                      </tr>
                    </thead>
                    <tbody>
                      {template.fields.map((f) => (
                        <tr key={f.name} className="border-t">
                          <td className="px-2 py-1 font-mono">{f.name}</td>
                          <td className="px-2 py-1">{f.type}</td>
                          <td className="px-2 py-1">{f.options?.join(", ") ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="space-y-4">
              <div className="text-sm font-medium">Field mapping</div>
              {(["Agreement", "Landlord", "Property", "Tenant"] as const).map((group) => (
                <div key={group} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{group}</div>
                  {LEASE_DATA_FIELDS.filter((f) => f.group === group).map((f) => {
                    const rowMapping = mapping[f.key];
                    const isChoice = rowMapping?.isChoiceGroup ?? false;
                    const targetField = !isChoice && rowMapping ? fieldByName(rowMapping.pdfField) : undefined;
                    return (
                      <div key={f.key} className="rounded-md border p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-[220px] text-xs">{f.label}</span>
                          {!isChoice && (
                            <Select
                              value={rowMapping?.pdfField || "__none__"}
                              onValueChange={(v) => setFieldMapping(f.key, v)}
                            >
                              <SelectTrigger className="h-8 w-[260px] text-xs">
                                <SelectValue placeholder="Not mapped" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Not on this form</SelectItem>
                                {template.fields.map((pf) => (
                                  <SelectItem key={pf.name} value={pf.name}>
                                    {pf.name} ({pf.type})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {checkboxFieldNames.length > 0 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-muted-foreground"
                              onClick={() => toggleChoiceGroup(f.key)}
                            >
                              {isChoice ? "Use a single field instead" : "This is several checkboxes, not one field"}
                            </Button>
                          )}
                        </div>
                        {isChoice ? (
                          <ChoiceGroupEditor
                            checkboxFieldNames={checkboxFieldNames}
                            valueMap={rowMapping?.valueMap ?? {}}
                            onSet={(from, to) => setValueMapEntry(f.key, from, to)}
                            onRemove={(from) => removeValueMapEntry(f.key, from)}
                          />
                        ) : (
                          targetField &&
                          (targetField.type === "radio" || targetField.type === "dropdown") && (
                            <ValueMapEditor
                              targetField={targetField}
                              valueMap={rowMapping?.valueMap ?? {}}
                              onSet={(from, to) => setValueMapEntry(f.key, from, to)}
                              onRemove={(from) => removeValueMapEntry(f.key, from)}
                            />
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={saveMapping}>Save field mapping</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ValueMapEditor({
  targetField,
  valueMap,
  onSet,
  onRemove,
}: {
  targetField: LeaseTemplateField;
  valueMap: Record<string, string>;
  onSet: (from: string, to: string) => void;
  onRemove: (from: string) => void;
}) {
  const [newFrom, setNewFrom] = useState("");
  const options = targetField.options ?? [];

  return (
    <div className="mt-2 space-y-1 rounded bg-muted/30 p-2">
      <div className="text-[11px] text-muted-foreground">
        Map our value → this field's real option (e.g. "Hardwired" → "{options[0] ?? "…"}")
      </div>
      {Object.entries(valueMap).map(([from, to]) => (
        <div key={from} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate font-mono">{from}</span>
          <span>→</span>
          <Select value={to} onValueChange={(v) => onSet(from, v)}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(from)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          placeholder="e.g. true, Hardwired, Weekly"
          value={newFrom}
          onChange={(e) => setNewFrom(e.target.value)}
          className="h-7 w-28 text-xs"
        />
        <span className="text-xs">→</span>
        <Select
          value=""
          onValueChange={(v) => {
            if (newFrom) {
              onSet(newFrom, v);
              setNewFrom("");
            }
          }}
        >
          <SelectTrigger className="h-7 w-[180px] text-xs">
            <SelectValue placeholder="pick option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ChoiceGroupEditor({
  checkboxFieldNames,
  valueMap,
  onSet,
  onRemove,
}: {
  checkboxFieldNames: string[];
  valueMap: Record<string, string>;
  onSet: (from: string, to: string) => void;
  onRemove: (from: string) => void;
}) {
  const [newFrom, setNewFrom] = useState("");

  return (
    <div className="mt-2 space-y-1 rounded bg-muted/30 p-2">
      <div className="text-[11px] text-muted-foreground">
        Map our value → the checkbox to tick for it (e.g. "12 Months" → "Check Box 3.2"). A value
        left unmapped ticks nothing.
      </div>
      {Object.entries(valueMap).map(([from, to]) => (
        <div key={from} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate font-mono">{from}</span>
          <span>→</span>
          <Select value={to} onValueChange={(v) => onSet(from, v)}>
            <SelectTrigger className="h-7 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {checkboxFieldNames.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(from)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          placeholder="e.g. 12 Months, true, Hardwired"
          value={newFrom}
          onChange={(e) => setNewFrom(e.target.value)}
          className="h-7 w-32 text-xs"
        />
        <span className="text-xs">→</span>
        <Select
          value=""
          onValueChange={(v) => {
            if (newFrom) {
              onSet(newFrom, v);
              setNewFrom("");
            }
          }}
        >
          <SelectTrigger className="h-7 w-[220px] text-xs">
            <SelectValue placeholder="pick checkbox" />
          </SelectTrigger>
          <SelectContent>
            {checkboxFieldNames.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
