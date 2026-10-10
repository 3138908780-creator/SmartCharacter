import type { ComboTemplate } from "./template-engine.ts";
import { CAPTION_FONT_FACES, resolveCaptionFont } from "./caption-fonts.ts";

export type TextStyle = { family: string; color: string; size: number; effect: "regular" | "bold" | "italic" | "bold-italic" };
export type Appearance = { normal: TextStyle; focus: TextStyle };
export type DemoPreset = { id: string; name: string; appearance: Appearance; updatedAt: string };
export type DemoDraft = { appearance: Appearance; updatedAt: string; basePresetId?: string };
export type DemoPresets = { ordinary?: DemoPreset; advanced?: Record<string, DemoPreset>; draft?: DemoDraft };

export const DEMO_FONT_SIZE_MIN = 12;
export const DEMO_FONT_SIZE_MAX = 240;
const effects = new Set(["regular", "bold", "italic", "bold-italic"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(value) && !["constructor", "prototype"].includes(value);

export function validDemoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}

/** The saved value is design font size, before the player fits its viewport. */
export function parseDemoAppearance(value: unknown): Appearance {
  if (!record(value)) throw new Error("字体样式格式不正确。");
  const parseStyle = (style: unknown): TextStyle => {
    if (!record(style) || typeof style.family !== "string" || !Object.hasOwn(CAPTION_FONT_FACES, style.family)
      || typeof style.color !== "string" || !/^#[\da-f]{6}$/iu.test(style.color)
      || typeof style.size !== "number" || !Number.isFinite(style.size) || style.size < DEMO_FONT_SIZE_MIN || style.size > DEMO_FONT_SIZE_MAX
      || typeof style.effect !== "string" || !effects.has(style.effect)) throw new Error("字体样式格式不正确。");
    return { family: style.family, color: style.color, size: style.size, effect: style.effect as TextStyle["effect"] };
  };
  return { normal: parseStyle(value.normal), focus: parseStyle(value.focus) };
}

export function defaultDemoAppearance(template: ComboTemplate): Appearance {
  const style = (role: "normal" | "focus"): TextStyle => {
    const finish = template[role], family = finish.fontFamily ?? template.font.family;
    // The original renderer used 900 even for Regular and Douyin font files.
    // Only an explicitly heavy/bold family becomes the editable bold effect.
    return { family, color: finish.color ?? template.defaults.accentColor, size: finish.size, effect: resolveCaptionFont(family, finish.weight).weight >= 700 ? "bold" : "regular" };
  };
  return { normal: style("normal"), focus: style("focus") };
}

export function parseDemoPresets(value: unknown): DemoPresets {
  if (!record(value)) throw new Error("样式预设格式不正确。");
  const parsePreset = (item: unknown, id: string): DemoPreset => {
    if (!record(item) || !validId(item.id) || item.id !== id || typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || !validDemoTimestamp(item.updatedAt)) throw new Error("样式预设格式不正确。");
    return { id, name: item.name, appearance: parseDemoAppearance(item.appearance), updatedAt: item.updatedAt };
  };
  const result: DemoPresets = {};
  if (value.ordinary !== undefined) result.ordinary = parsePreset(value.ordinary, "ordinary");
  if (value.advanced !== undefined) {
    if (!record(value.advanced) || Object.keys(value.advanced).length > 100) throw new Error("进阶版预设格式不正确。");
    result.advanced = Object.fromEntries(Object.entries(value.advanced).map(([id, item]) => {
      if (!validId(id) || id === "ordinary") throw new Error("进阶版预设编号不正确。");
      return [id, parsePreset(item, id)];
    }));
  }
  if (value.draft !== undefined) {
    const draft = value.draft;
    if (!record(draft) || !validDemoTimestamp(draft.updatedAt) || (draft.basePresetId !== undefined && !validId(draft.basePresetId))) throw new Error("样式草稿格式不正确。");
    result.draft = { appearance: parseDemoAppearance(draft.appearance), updatedAt: draft.updatedAt, ...(draft.basePresetId !== undefined ? { basePresetId: draft.basePresetId as string } : {}) };
  }
  return result;
}

/** Merge each saved identity separately so two tabs can add versions concurrently. */
export function mergeDemoPresets(left: DemoPresets = {}, right: DemoPresets = {}): DemoPresets {
  const newer = <T extends { updatedAt: string }>(a?: T, b?: T): T | undefined => !a ? b : !b ? a : Date.parse(a.updatedAt) > Date.parse(b.updatedAt) ? a : b;
  const ordinary = newer(left.ordinary, right.ordinary), draft = newer(left.draft, right.draft);
  const advanced = { ...left.advanced };
  for (const [id, preset] of Object.entries(right.advanced ?? {})) advanced[id] = newer(advanced[id], preset)!;
  return { ...(ordinary ? { ordinary } : {}), ...(left.advanced || right.advanced ? { advanced } : {}), ...(draft ? { draft } : {}) };
}
