export type HSV = {
    h: number;
    s: number;
    v: number;
};
export function normalizeHex(value: string): string | null {
    if (typeof value !== 'string')
        return null;
    const clean = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(clean))
        return `#${clean.toLowerCase()}`;
    if (/^[0-9a-f]{3}$/i.test(clean))
        return `#${[...clean].map(c => c + c).join('').toLowerCase()}`;
    return null;
}
export const hexRgb = (hex: string) => [1, 3, 5].map(i => parseInt((normalizeHex(hex) ?? '#ffffff').slice(i, i + 2), 16));
export const rgbHex = (rgb: readonly number[]) => {
    if (rgb.length !== 3 || rgb.some(n => !Number.isFinite(n)))
        throw new Error('RGB 需要三个有效数值');
    return '#' + rgb.map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
};
export function hexHsv(hex: string): HSV {
    const [r, g, b] = hexRgb(hex).map(n => n / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    return { h: d === 0 ? 0 : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
export function hsvHex({ h, s, v }: HSV) {
    if (![h, s, v].every(Number.isFinite))
        throw new Error('HSV 需要有效的色相、饱和度与亮度');
    const hue = (h % 360 + 360) % 360, sat = Math.max(0, Math.min(1, s)), val = Math.max(0, Math.min(1, v)), c = val * sat;
    const x = c * (1 - Math.abs(hue / 60 % 2 - 1)), m = val - c;
    const rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    return rgbHex(rgb.map(n => (n + m) * 255));
}
