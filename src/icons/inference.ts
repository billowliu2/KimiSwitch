/**
 * Infer a brand icon from a provider name via case-insensitive substring matching.
 * First match wins — order matters (more specific keywords first).
 *
 * Example: "Claude CN Relay" → matches "claude" → returns { iconKey: "anthropic", color: "#D4915D" }
 */

import { BRAND_ICONS, type BrandIcon } from "./brands";

export interface InferenceResult {
  iconKey: string;
  icon: BrandIcon;
}

/** Flattened keyword map derived from brands.ts; order follows BRAND_ICONS definition. */
const KEYWORD_MAP: { keyword: string; iconKey: string }[] = [];
for (const [iconKey, { keywords }] of Object.entries(BRAND_ICONS)) {
  for (const keyword of keywords) {
    KEYWORD_MAP.push({ keyword: keyword.toLowerCase(), iconKey });
  }
}

export function inferIcon(name: string): InferenceResult | null {
  const lower = name.toLowerCase();
  for (const { keyword, iconKey } of KEYWORD_MAP) {
    if (lower.includes(keyword)) {
      return { iconKey, icon: BRAND_ICONS[iconKey] };
    }
  }
  return null;
}
