import { Field } from "@/components/Field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHARED_UNIT } from "@/lib/constants";
import type { PropertyUnit } from "@/lib/types";

/**
 * "Which dwelling is this for?" — the whole property, or one unit (a house and its granny flat).
 * Renders nothing for a property with no units on file. One picker for bills, transactions,
 * tenants and the property records tabs (each used to write its own, with three different wordings
 * for the shared option).
 */
export function DwellingSelect({
  units,
  value,
  onChange,
  label = "Dwelling",
}: {
  units: PropertyUnit[] | undefined;
  value: string;
  onChange: (unitId: string) => void;
  label?: string;
}) {
  if (!units || units.length === 0) return null;
  return (
    <Field label={label}>
      <Select value={value || SHARED_UNIT} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHARED_UNIT}>Shared / whole property</SelectItem>
          {units.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
