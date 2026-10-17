import { SelectItem } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { propertyLabel } from "@/lib/format";

/** The property choices inside any property <Select> — every picker lists the same properties,
 * named the same way (three used to show only the address, never the nickname). */
export function PropertyOptions({ valuePrefix = "" }: { valuePrefix?: string }) {
  const { state } = useStore();
  return (
    <>
      {state.properties.map((p) => (
        <SelectItem key={p.id} value={valuePrefix + p.id}>
          {propertyLabel(p)}
        </SelectItem>
      ))}
    </>
  );
}
