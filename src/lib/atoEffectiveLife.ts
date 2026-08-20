/**
 * Commonly-cited ATO effective-life figures (years) for typical residential rental Div 40 plant &
 * equipment — a reference to speed up data entry, not a guaranteed-current ATO determination.
 * Always confirm against the landlord's own QS report or the current ATO ruling before relying on it.
 */
const ATO_EFFECTIVE_LIFE: { keywords: string[]; years: number }[] = [
  { keywords: ["hot water"], years: 12 },
  { keywords: ["air conditioner", "air conditioning", "aircon", "split system", "ducted"], years: 10 },
  { keywords: ["carpet"], years: 8 },
  { keywords: ["vinyl", "floating floor", "laminate floor"], years: 10 },
  { keywords: ["blind"], years: 10 },
  { keywords: ["curtain"], years: 6 },
  { keywords: ["dishwasher"], years: 8 },
  { keywords: ["oven", "cooktop", "stove"], years: 12 },
  { keywords: ["rangehood"], years: 12 },
  { keywords: ["garage door", "garage motor"], years: 15 },
  { keywords: ["smoke alarm"], years: 6 },
  { keywords: ["ceiling fan"], years: 5 },
  { keywords: ["exhaust fan"], years: 10 },
  { keywords: ["clothes dryer"], years: 8 },
  { keywords: ["washing machine"], years: 8 },
  { keywords: ["refrigerator", "fridge"], years: 10 },
  { keywords: ["microwave"], years: 8 },
  { keywords: ["pool pump", "pool filter"], years: 8 },
  { keywords: ["solar panel", "solar system"], years: 20 },
  { keywords: ["intercom", "security system", "alarm system"], years: 10 },
  { keywords: ["tv antenna", "television antenna"], years: 10 },
  { keywords: ["vacuum system", "ducted vacuum"], years: 10 },
  { keywords: ["door closer", "automatic door"], years: 10 },
  { keywords: ["light fitting", "light fixture"], years: 10 },
];

export function suggestEffectiveLife(description: string): number | undefined {
  const text = description.trim().toLowerCase();
  if (!text) return undefined;
  const match = ATO_EFFECTIVE_LIFE.find((e) => e.keywords.some((k) => text.includes(k)));
  return match?.years;
}
