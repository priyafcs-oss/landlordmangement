import { describe, expect, it } from "vitest";
import { buildTenantLedger } from "@/lib/calculations";
import { renderTemplate } from "@/lib/templates";
import type { Tenant, TenantInvoice } from "@/lib/types";

// rental.tsx passed outstanding={0}, so the 7-day arrears notice always said $0.00. It now passes
// the tenant ledger's total — this pins that the ledger total is what lands in the notice.
describe("7-day arrears notice", () => {
  it("states what the tenant actually owes", () => {
    const tenant = {
      id: "t1",
      name: "Sam",
      leaseStart: "2099-01-01",
      paidUpToDate: "2099-01-01",
      rentAmount: 500,
      rentFrequency: "Weekly",
    } as unknown as Tenant;
    const invoices = [
      {
        id: "i1",
        tenantId: "t1",
        chargeType: "Water Usage",
        amountDue: 261.59,
        dateIssued: "2026-10-17",
        dueDate: "2026-10-31",
        status: "Unpaid",
        description: "Water usage",
      },
    ] as TenantInvoice[];
    const { total } = buildTenantLedger(tenant, [], invoices);
    expect(total).toBeCloseTo(261.59, 2);
    const text = renderTemplate("arrears", { tenant, property: "10 Facer Ct", outstanding: total });
    expect(text).toContain("$261.59");
    expect(text).not.toContain("$0.00");
  });
});
