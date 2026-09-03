/**
 * Commonly-cited ATO effective-life figures (years) for typical residential rental Div 40 plant &
 * equipment — a reference to speed up data entry, not a guaranteed-current ATO determination.
 * Always confirm against the landlord's own QS report or the current ATO ruling before relying on it.
 */
const ATO_EFFECTIVE_LIFE: { label: string; keywords: string[]; years: number }[] = [
  { label: "Hot water system", keywords: ["hot water"], years: 12 },
  { label: "Air conditioning unit", keywords: ["air conditioner", "air conditioning", "aircon", "split system", "ducted"], years: 10 },
  { label: "Carpet", keywords: ["carpet"], years: 8 },
  { label: "Vinyl/laminate flooring", keywords: ["vinyl", "floating floor", "laminate floor"], years: 10 },
  { label: "Blinds", keywords: ["blind"], years: 10 },
  { label: "Curtains", keywords: ["curtain"], years: 6 },
  { label: "Dishwasher", keywords: ["dishwasher"], years: 8 },
  { label: "Cooktop/oven", keywords: ["oven", "cooktop", "stove"], years: 12 },
  { label: "Rangehood", keywords: ["rangehood"], years: 12 },
  { label: "Garage door motor", keywords: ["garage door", "garage motor"], years: 15 },
  { label: "Smoke alarm", keywords: ["smoke alarm"], years: 6 },
  { label: "Ceiling fan", keywords: ["ceiling fan"], years: 5 },
  { label: "Exhaust fan", keywords: ["exhaust fan"], years: 10 },
  { label: "Clothes dryer", keywords: ["clothes dryer"], years: 8 },
  { label: "Washing machine", keywords: ["washing machine"], years: 8 },
  { label: "Refrigerator", keywords: ["refrigerator", "fridge"], years: 10 },
  { label: "Microwave", keywords: ["microwave"], years: 8 },
  { label: "Pool pump/filter", keywords: ["pool pump", "pool filter"], years: 8 },
  { label: "Solar panel system", keywords: ["solar panel", "solar system"], years: 20 },
  { label: "Security/alarm system", keywords: ["intercom", "security system", "alarm system"], years: 10 },
  { label: "TV antenna", keywords: ["tv antenna", "television antenna"], years: 10 },
  { label: "Ducted vacuum system", keywords: ["vacuum system", "ducted vacuum"], years: 10 },
  { label: "Automatic door closer", keywords: ["door closer", "automatic door"], years: 10 },
  { label: "Light fitting", keywords: ["light fitting", "light fixture"], years: 10 },
];

export interface AtoEffectiveLifeMatch {
  label: string;
  years: number;
}

/** Full match (category label + years), for surfacing "this is what matched" in the UI rather
 * than silently filling a number in. All entries are Div 40 plant & equipment — a match doesn't
 * imply anything about Div 43 (capital works), which has no ATO effective-life list at all;
 * that's always whatever the QS report's own building-cost schedule states. */
export function lookupAtoEffectiveLife(description: string): AtoEffectiveLifeMatch | undefined {
  const text = description.trim().toLowerCase();
  if (!text) return undefined;
  const match = ATO_EFFECTIVE_LIFE.find((e) => e.keywords.some((k) => text.includes(k)));
  return match ? { label: match.label, years: match.years } : undefined;
}

export function suggestEffectiveLife(description: string): number | undefined {
  return lookupAtoEffectiveLife(description)?.years;
}
