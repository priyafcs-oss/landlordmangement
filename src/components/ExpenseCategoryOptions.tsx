import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { CATEGORY_GROUPS } from "@/lib/calculations";

/** The expense categories, grouped by ATO treatment, inside any category <Select> — one list for
 * the bill, transaction and saved-bill forms and the Bills filter. */
export function ExpenseCategoryOptions() {
  return (
    <>
      {Object.entries(CATEGORY_GROUPS).map(([group, categories]) => (
        <SelectGroup key={group}>
          <SelectLabel>{group}</SelectLabel>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
