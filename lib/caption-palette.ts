export const DEFAULT_ACCENT = "#f6bf0a";
export const SECONDARY_ACCENT = "#e85d3f";
export const WARM_ACCENTS = [DEFAULT_ACCENT, "#ffdf55", SECONDARY_ACCENT] as const;
export function warmAccent(value?: string) {
  return WARM_ACCENTS.find((color) => color === value?.toLowerCase()) ?? DEFAULT_ACCENT;
}
