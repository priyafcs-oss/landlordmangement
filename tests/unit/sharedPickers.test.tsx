import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PropertyBill } from "@/lib/types";

vi.mock("@/lib/store", () => ({
  useStore: () => ({
    state: {
      properties: [
        { id: "p1", alias: "Facer Ct", address: "10 Facer Ct" },
        { id: "p2", address: "5 Smith St" },
      ],
    },
  }),
}));

const { DwellingSelect } = await import("@/components/DwellingSelect");
const { DueInBadge, BillStatusBadge } = await import("@/components/StatusBadges");
const { PropertyOptions } = await import("@/components/PropertyOptions");

describe("shared pickers and badges", () => {
  it("DwellingSelect renders nothing for a single-dwelling property", () => {
    const { container } = render(<DwellingSelect units={[]} value="" onChange={() => undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("DwellingSelect defaults to the whole property", () => {
    render(
      <DwellingSelect
        units={[{ id: "u1", label: "Granny flat" }] as never}
        value=""
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("Shared / whole property")).toBeTruthy();
  });

  // Three property pickers listed only the address, never the nickname.
  it("PropertyOptions names properties by nickname, else address", () => {
    render(
      <Select open value="p1">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <PropertyOptions />
        </SelectContent>
      </Select>,
    );
    expect(screen.getAllByText("Facer Ct").length).toBeGreaterThan(0);
    expect(screen.getByText("5 Smith St")).toBeTruthy();
  });

  it("DueInBadge wording, full and compact", () => {
    const { rerender } = render(<DueInBadge days={3} />);
    expect(screen.getByText("3 days")).toBeTruthy();
    rerender(<DueInBadge days={-1} />);
    expect(screen.getByText("1 day overdue")).toBeTruthy();
    rerender(<DueInBadge days={-2} compact />);
    expect(screen.getByText("2d overdue")).toBeTruthy();
  });

  it("BillStatusBadge shows Overdue for a part-paid bill past due", () => {
    render(
      <BillStatusBadge
        bill={
          {
            id: "b",
            billType: "Water",
            amount: 100,
            paidAmount: 40,
            status: "Partial",
            dueDate: "2020-01-01",
          } as PropertyBill
        }
      />,
    );
    expect(screen.getByText("Overdue")).toBeTruthy();
  });
});
