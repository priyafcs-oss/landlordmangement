import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillRow } from "@/components/BillRow";
import { Coins, LineChart, Plus, Building2, ArrowRight, FileText } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { Asset, AssetType, GoldDetails, EtfDetails, BillType } from "@/lib/types";
import { PropertyDialog, AiProposalsSection } from "@/components/PropertyShared";
import { toast } from "sonner";

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "Assets — Landlord OS" },
      { name: "description", content: "Everything you own — property, gold, ETFs — in one register." },
    ],
  }),
  component: AssetsPage,
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const NON_PROPERTY_TYPES: Exclude<AssetType, "Property">[] = ["Gold", "ETF"];

function AssetDialog({ asset, children }: { asset?: Asset; children?: React.ReactNode }) {
  const { state, addAsset, updateAsset } = useStore();
  const [open, setOpen] = useState(false);
  const existingGold = asset ? state.goldDetails.find((g) => g.assetId === asset.id) : undefined;
  const existingEtf = asset ? state.etfDetails.find((e) => e.assetId === asset.id) : undefined;

  const [assetType, setAssetType] = useState<Exclude<AssetType, "Property">>(
    (asset?.assetType as Exclude<AssetType, "Property">) ?? "Gold",
  );
  const [name, setName] = useState(asset?.name ?? "");
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ?? "");
  const [purchaseCost, setPurchaseCost] = useState(asset?.purchaseCost?.toString() ?? "");
  const [currentValue, setCurrentValue] = useState(asset?.currentValue?.toString() ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");

  const [gramsHeld, setGramsHeld] = useState(existingGold?.gramsHeld?.toString() ?? "");
  const [form, setForm] = useState(existingGold?.form ?? "Bar");
  const [storageLocation, setStorageLocation] = useState(existingGold?.storageLocation ?? "");

  const [ticker, setTicker] = useState(existingEtf?.ticker ?? "");
  const [exchange, setExchange] = useState(existingEtf?.exchange ?? "ASX");
  const [unitsHeld, setUnitsHeld] = useState(existingEtf?.unitsHeld?.toString() ?? "");
  const [avgCostPerUnit, setAvgCostPerUnit] = useState(existingEtf?.avgCostPerUnit?.toString() ?? "");

  const save = () => {
    if (!name.trim()) return toast.error("Name is required");
    const common = {
      assetType,
      name: name.trim(),
      purchaseDate: purchaseDate || undefined,
      purchaseCost: purchaseCost ? parseFloat(purchaseCost) : undefined,
      currentValue: parseFloat(currentValue) || 0,
      status: "Active" as const,
      notes: notes || undefined,
    };
    const details =
      assetType === "Gold"
        ? { goldDetails: { form: form as GoldDetails["form"], gramsHeld: gramsHeld ? parseFloat(gramsHeld) : undefined, storageLocation: storageLocation || undefined } }
        : { etfDetails: { ticker: ticker || undefined, exchange: exchange || undefined, unitsHeld: unitsHeld ? parseFloat(unitsHeld) : undefined, avgCostPerUnit: avgCostPerUnit ? parseFloat(avgCostPerUnit) : undefined } };

    if (asset) {
      updateAsset(asset.id, common, details);
      toast.success("Asset updated");
    } else {
      addAsset(common, details);
      toast.success("Asset added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm" variant="outline" className="gap-1">
            <Plus className="h-4 w-4" /> Add Gold / ETF
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{asset ? "Edit asset" : "New asset"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={assetType} onValueChange={(v) => setAssetType(v as typeof assetType)} disabled={!!asset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NON_PROPERTY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={assetType === "Gold" ? "e.g. Perth Mint bars" : "e.g. VAS — Vanguard Australian Shares"}
              />
            </Field>
          </div>

          {assetType === "Gold" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Form">
                <Select value={form} onValueChange={(v) => setForm(v as typeof form)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bar">Bar</SelectItem>
                    <SelectItem value="Coin">Coin</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Grams held">
                <Input type="number" value={gramsHeld} onChange={(e) => setGramsHeld(e.target.value)} />
              </Field>
              <div className="col-span-2">
                <Field label="Storage location">
                  <Input value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} placeholder="e.g. Home safe, bank vault" />
                </Field>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ticker">
                <Input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="e.g. VAS" />
              </Field>
              <Field label="Exchange">
                <Input value={exchange} onChange={(e) => setExchange(e.target.value)} />
              </Field>
              <Field label="Units held">
                <Input type="number" value={unitsHeld} onChange={(e) => setUnitsHeld(e.target.value)} />
              </Field>
              <Field label="Avg cost per unit">
                <Input type="number" value={avgCostPerUnit} onChange={(e) => setAvgCostPerUnit(e.target.value)} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase date">
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </Field>
            <Field label="Purchase cost (AUD)">
              <Input type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} />
            </Field>
            <div className="col-span-2">
              <Field label="Current value (AUD)">
                <Input type="number" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAssetTransactionDialog({ assetId }: { assetId: string }) {
  const { addExpense } = useStore();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"Income" | "Expense">("Expense");
  const [itemName, setItemName] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(todayISO());

  const save = () => {
    if (!itemName.trim()) return toast.error("Description is required");
    if (!cost || parseFloat(cost) <= 0) return toast.error("Amount must be greater than 0");
    addExpense({
      itemName: itemName.trim(),
      cost: parseFloat(cost),
      date,
      assetId,
      direction,
      taxCategory: "Immediate Deduction",
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "manual",
    });
    toast.success("Transaction logged");
    setOpen(false);
    setItemName("");
    setCost("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> Log transaction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a transaction</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction">
            <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Expense">Expense (money out)</SelectItem>
                <SelectItem value="Income">Income (money in)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Sold 50g gold, ETF dividend, brokerage fee" />
            </Field>
          </div>
          <Field label="Amount (AUD)">
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetDetailSheet({ assetId, onClose }: { assetId: string | null; onClose: () => void }) {
  const { state, markBillPaid, deleteBill } = useStore();
  const asset = state.assets.find((a) => a.id === assetId);
  const gold = asset ? state.goldDetails.find((g) => g.assetId === asset.id) : undefined;
  const etf = asset ? state.etfDetails.find((e) => e.assetId === asset.id) : undefined;
  const transactions = asset ? state.expenses.filter((e) => e.assetId === asset.id).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  const bills = asset ? state.bills.filter((b) => b.assetId === asset.id) : [];
  const docs = transactions.filter((t) => t.invoiceFileData);

  return (
    <Sheet open={!!assetId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{asset?.name}</SheetTitle>
        </SheetHeader>
        {asset && (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="bills">Bills</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Current value" value={fmtCurrency(asset.currentValue)} />
                <Stat label="Purchase cost" value={asset.purchaseCost ? fmtCurrency(asset.purchaseCost) : "—"} />
                <Stat
                  label="Gain / loss"
                  value={asset.purchaseCost ? fmtCurrency(asset.currentValue - asset.purchaseCost) : "—"}
                />
                <Stat label="Purchase date" value={asset.purchaseDate || "—"} />
                {gold && <Stat label="Grams held" value={gold.gramsHeld ? `${gold.gramsHeld}g (${gold.form ?? "—"})` : "—"} />}
                {gold && <Stat label="Storage" value={gold.storageLocation || "—"} />}
                {etf && <Stat label="Ticker" value={etf.ticker ? `${etf.ticker} (${etf.exchange ?? "—"})` : "—"} />}
                {etf && <Stat label="Units held" value={etf.unitsHeld ? `${etf.unitsHeld} @ ${fmtCurrency(etf.avgCostPerUnit ?? 0)}` : "—"} />}
              </div>
              {asset.notes && <div className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">{asset.notes}</div>}
              <AssetDialog asset={asset}>
                <Button size="sm" variant="outline">
                  Edit asset
                </Button>
              </AssetDialog>
            </TabsContent>

            <TabsContent value="transactions" className="space-y-2 text-sm">
              <div className="flex justify-end">
                <AddAssetTransactionDialog assetId={asset.id} />
              </div>
              {transactions.length === 0 && <div className="text-xs text-muted-foreground">No transactions logged yet.</div>}
              {transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border p-2 text-xs">
                  <div>
                    <div className="font-medium">{t.itemName}</div>
                    <div className="text-muted-foreground">{t.date}</div>
                  </div>
                  <div className={t.direction === "Income" ? "text-emerald-600" : "text-destructive"}>
                    {t.direction === "Income" ? "+" : "−"}
                    {fmtCurrency(t.cost)}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="bills" className="space-y-2 text-sm">
              {bills.length === 0 && <div className="text-xs text-muted-foreground">No bills for this asset.</div>}
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  onPaid={() => {
                    markBillPaid(b.id);
                    toast.success("Marked paid");
                  }}
                  onDelete={() => {
                    if (confirm(`Delete this ${b.billType} bill?`)) {
                      deleteBill(b.id);
                      toast.success("Bill removed");
                    }
                  }}
                />
              ))}
            </TabsContent>

            <TabsContent value="documents" className="space-y-2 text-sm">
              {docs.length === 0 && <div className="text-xs text-muted-foreground">No documents attached yet.</div>}
              {docs.map((t) => (
                <a
                  key={t.id}
                  href={t.invoiceFileData}
                  download={t.invoiceFileName}
                  className="flex items-center gap-2 rounded border p-2 text-xs text-primary underline"
                >
                  <FileText className="h-3.5 w-3.5" /> {t.invoiceFileName || t.itemName}
                </a>
              ))}
            </TabsContent>

            <TabsContent value="notes" className="text-sm">
              <NotesEditor asset={asset} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NotesEditor({ asset }: { asset: Asset }) {
  const { updateAsset } = useStore();
  const [notes, setNotes] = useState(asset.notes ?? "");
  return (
    <div className="space-y-2">
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} />
      <Button
        size="sm"
        onClick={() => {
          updateAsset(asset.id, { notes: notes || undefined });
          toast.success("Notes saved");
        }}
      >
        Save notes
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function assetIcon(type: AssetType) {
  if (type === "Property") return <Building2 className="h-3.5 w-3.5" />;
  if (type === "Gold") return <Coins className="h-3.5 w-3.5" />;
  return <LineChart className="h-3.5 w-3.5" />;
}

function AssetsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"__all__" | AssetType>("__all__");

  const filtered = state.assets
    .filter((a) => a.status !== "Archived")
    .filter((a) => typeFilter === "__all__" || a.assetType === typeFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalValue = filtered.reduce((s, a) => s + a.currentValue, 0);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-muted-foreground">Everything you own, in one register — property, gold, ETFs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PropertyDialog property={null} onDone={() => {}} />
          <AssetDialog />
        </div>
      </div>

      <AiProposalsSection />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All types</SelectItem>
            <SelectItem value="Property">Property</SelectItem>
            <SelectItem value="Gold">Gold</SelectItem>
            <SelectItem value="ETF">ETF</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          Total value: <span className="font-medium text-foreground">{fmtCurrency(totalValue)}</span>
        </div>
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">No assets yet.</CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => {
          const gain = a.purchaseCost !== undefined ? a.currentValue - a.purchaseCost : undefined;
          return (
            <Card
              key={a.id}
              className="cursor-pointer hover:border-primary/50"
              onClick={() => (a.assetType === "Property" ? navigate({ to: "/assets/$assetId", params: { assetId: a.id } }) : setDrawerId(a.id))}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {assetIcon(a.assetType)}
                      <Badge variant="outline" className="text-[10px]">
                        {a.assetType}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate font-medium">{a.name}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Current value</div>
                    <div className="text-lg font-semibold">{fmtCurrency(a.currentValue)}</div>
                  </div>
                  {gain !== undefined && (
                    <div className={`text-xs font-medium ${gain >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                      {gain >= 0 ? "+" : ""}
                      {fmtCurrency(gain)}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AssetDetailSheet assetId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}
