import { CAPTION_FONT_FACES, type CaptionFontFamily } from "./caption-fonts.ts";
export type EffectStyle = {
    palette?: [
        string,
        string,
        string
    ];
    font?: CaptionFontFamily;
    subFont?: CaptionFontFamily;
    textColor?: string;
    subColor?: string;
    accent?: string;
    fillMode?: "theme" | "custom";
    fillColor?: string;
    fillOpacity?: number;
};
export function validateEffectStyle(style?: EffectStyle) {
    if (style === undefined)
        return;
    if (!style || typeof style !== "object" || Array.isArray(style))
        throw new Error("效果卡片样式无效");
    if (style.palette !== undefined && (!Array.isArray(style.palette) || style.palette.length !== 3 || style.palette.some(c => !/^#[\da-f]{6}$/iu.test(c))))
        throw new Error("卡片主题色无效");
    for (const font of [style.font, style.subFont])
        if (font !== undefined && !Object.hasOwn(CAPTION_FONT_FACES, font))
            throw new Error("效果卡片字体无效");
    for (const color of [style.textColor, style.subColor, style.accent, style.fillColor])
        if (color !== undefined && (typeof color !== "string" || !/^#[\da-f]{6}$/iu.test(color)))
            throw new Error("效果卡片颜色无效");
    if (style.fillMode !== undefined && !["theme", "custom"].includes(style.fillMode))
        throw new Error("效果卡片配色模式无效");
    if (style.fillOpacity !== undefined && (typeof style.fillOpacity !== "number" || !Number.isFinite(style.fillOpacity) || style.fillOpacity < 0 || style.fillOpacity > 1))
        throw new Error("卡片底色不透明度需在 0–1 之间");
}
export function effectColors(style?: EffectStyle) {
    const color = style?.fillMode === "custom" ? style.fillColor ?? "#193b57" : style?.accent ?? "#f6bf0a";
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    const hi = Math.max(...rgb), lo = Math.min(...rgb), d = hi - lo;
    let hue = !d ? 0 : hi === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 : hi === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4;
    hue /= 6;
    const tone = (s: number, l: number) => {
        const a = s * Math.min(l, 1 - l);
        return "#" + [0, 8, 4].map((n) => { const k = (n + hue * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); }).join("");
    };
    return { base: style?.fillMode === "custom" ? color : tone(d ? .44 : 0, .16), active: tone(d ? .48 : 0, Math.min(.62, style?.fillMode === "custom" ? (hi + lo) / 2 + .14 : .32)), muted: tone(.08, .24), border: tone(.20, .61), number: tone(.22, .72) };
}
export function consecutiveIds(ids: string[], cues: {
    id: string;
}[]) {
    const indices = ids.map((id) => cues.findIndex((cue) => cue.id === id));
    return indices.length > 0 && indices.every((index, i) => index >= 0 && (!i || index === indices[i - 1] + 1));
}
/** Older projects may have a brand palette but no per-card accent yet. */
export function withEffectTheme<T extends {
    style?: EffectStyle;
}>(group: T, accent = "#f6bf0a", palette?: [
    string,
    string,
    string
]): T {
    return { ...group, style: { ...group.style, accent: group.style?.accent ?? accent, ...(palette ? { palette } : {}) } };
}
