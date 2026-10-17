import { describe, expect, it } from "vitest";
import { mapBillType, mapExpenseCategory } from "@/lib/calculations";
import { EXPENSE_CATEGORIES as SHARED_CATEGORIES } from "../../supabase/functions/_shared/classify.ts";
import { EXPENSE_CATEGORIES } from "@/lib/types";

// One module now classifies bills for both the app and the edge functions. These pin the
// behaviour the app's old copy got wrong.
describe("shared bill classifiers", () => {
  it("files land tax as Land Tax (the app's old copy had no Land Tax)", () => {
    expect(mapExpenseCategory("land_tax", "Revenue NSW")).toBe("Land Tax");
    expect(mapExpenseCategory(undefined, "Revenue NSW")).toBe("Land Tax");
    expect(mapBillType("land tax", "Revenue NSW")).toBe("Land Tax");
  });

  it('files "water rates" as Water, not Council Rates', () => {
    expect(mapBillType("water rates", "")).toBe("Water");
    expect(mapExpenseCategory("water_rates", "Sydney Water")).toBe("Water Charges");
  });

  it("uses the vendor name, and a trade vendor beats utility words in its name", () => {
    expect(mapBillType("", "Sydney Water")).toBe("Water");
    expect(mapBillType("", "BGS Airconditioning and Electricals")).toBe("Other");
    expect(mapExpenseCategory("", "BGS Airconditioning and Electricals")).toBe(
      "Repairs & Maintenance",
    );
    expect(mapBillType("", "Strata Plan 1234 Owners Corp")).toBe("Strata");
  });

  it("falls back to Sundry / Other", () => {
    expect(mapExpenseCategory(undefined, undefined)).toBe("Sundry Rental Expenses");
    expect(mapBillType(null, null)).toBe("Other");
  });

  it("only ever returns real app categories", () => {
    for (const c of SHARED_CATEGORIES) expect(EXPENSE_CATEGORIES).toContain(c);
  });
});
