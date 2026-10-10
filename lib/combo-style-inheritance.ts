import type { MemoryPosition } from "./export-style-memory.ts";
export const DEFAULT_KEYWORD_POSITION = { x: 50, y: 78 } as const;

type ComboStyle = { position: MemoryPosition; preferredPosition?: MemoryPosition; scale: number; requestedScale?: number; accentColor: string; manualLayout?: boolean };
type TemplateStyle = { editable: readonly string[]; defaults: { position?: MemoryPosition; accentColor: string } };
export type RememberedComboStyle = { position?: MemoryPosition; scale?: number; accentColor?: string };

/** Apply automatic preferences after template selection, before safe placement.
 * Starting from shared keyword defaults prevents an earlier video's orientation or a
 * different template's appearance from leaking into a newly created combo.
 * This function never creates manual edit provenance. */
export function inheritComboStyle<T extends ComboStyle>(combo: T, template: TemplateStyle, remembered: RememberedComboStyle, manualFields: readonly string[] = []): T {
  const next = { ...combo };
  if (!combo.manualLayout && !manualFields.includes("position") && template.editable.includes("position")) {
    const position = remembered.position ?? DEFAULT_KEYWORD_POSITION;
    next.position = { ...position };
    next.preferredPosition = { ...position };
  }
  if (!combo.manualLayout && !manualFields.includes("scale") && template.editable.includes("scale")) {
    next.scale = remembered.scale ?? 1;
    next.requestedScale = next.scale;
  }
  if (!manualFields.includes("accentColor") && template.editable.includes("accentColor")) next.accentColor = remembered.accentColor ?? template.defaults.accentColor;
  return next;
}
