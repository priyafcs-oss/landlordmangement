import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { AddBillDialog } from "@/components/AddBillDialog";
import { BillsBoard } from "@/components/BillsBoard";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [
      { title: "Bills — Landlord OS" },
      { name: "description", content: "Every outstanding bill across the portfolio, in one place." },
    ],
  }),
  component: BillsPage,
});

function BillsPage() {
  const { state } = useStore();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">Every bill across the portfolio — nothing slides quietly.</p>
        </div>
        <AddBillDialog />
      </div>

      <BillsBoard bills={state.bills} />
    </div>
  );
}
