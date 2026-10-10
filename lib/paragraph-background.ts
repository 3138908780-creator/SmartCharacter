/** An independent RGBA layer. No source-video pixels enter this renderer. */
export const PARAGRAPH_BACKGROUNDS = { gray: "柔灰", grid: "网格", frosted: "磨砂", gradient: "暗色渐变" } as const;
export type ParagraphBackground = {
    mode?: "none" | "recommended" | "image";
    preset?: keyof typeof PARAGRAPH_BACKGROUNDS;
    dim: number; // Layer opacity; retained for compatibility with v9 projects.
    blur: number; // Softens only this layer's texture/image.
    image?: {
        dataUrl: string;
        name: string;
        width: number;
        height: number;
    };
};
export const backgroundMode = (background: ParagraphBackground) => background.mode ?? "recommended";
export function validateParagraphBackground(value: ParagraphBackground) {
    if (!value || typeof value !== "object" || !Number.isFinite(value.dim) || value.dim < 0 || value.dim > 1 || !Number.isFinite(value.blur) || value.blur < 0 || value.blur > 60
        || !["none", "recommended", "image"].includes(backgroundMode(value)) || value.preset !== undefined && !Object.hasOwn(PARAGRAPH_BACKGROUNDS, value.preset))
        throw new Error("段落卡片背景设置无效");
    if (backgroundMode(value) === "image" && !value.image)
        throw new Error("请先上传背景图片");
    if (value.image && (typeof value.image.dataUrl !== "string" || value.image.dataUrl.length > 4 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image.dataUrl)
        || typeof value.image.name !== "string" || value.image.name.length > 255 || ![value.image.width, value.image.height].every((n) => Number.isInteger(n) && n > 0 && n <= 1920)))
        throw new Error("背景图片无效，请重新上传（PNG、JPEG 或 WebP）");
}
// Browser Canvas and export Skia use the same primitives, crop, seeded texture
// and blur. Opacity/fade are applied afterwards, without rerasterizing each frame.
export function paintParagraphBackground(ctx: CanvasRenderingContext2D, background: ParagraphBackground, createSurface: (width: number, height: number) => HTMLCanvasElement, image?: {
    source: CanvasImageSource;
    width: number;
    height: number;
}) {
    validateParagraphBackground(background);
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    if (backgroundMode(background) === "none")
        return;
    if (backgroundMode(background) === "image" && !image)
        throw new Error("背景图片未能加载，请重新上传");
    const unit = height / 1920, blur = background.blur * unit, pad = Math.ceil(blur * 3) + 2;
    const surface = createSurface(width + pad * 2, height + pad * 2), paint = surface.getContext("2d")!;
    paint.translate(pad, pad);
    const preset = background.preset ?? "frosted";
    if (backgroundMode(background) === "image" && image) {
        const scale = Math.max(surface.width / image.width, surface.height / image.height);
        paint.drawImage(image.source, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
    }
    else {
        paint.fillStyle = "#24262b";
        paint.fillRect(-pad, -pad, surface.width, surface.height);
        if (preset === "gradient") {
            const gradient = paint.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, "#434957");
            gradient.addColorStop(.55, "#252a36");
            gradient.addColorStop(1, "#10151c");
            paint.fillStyle = gradient;
            paint.fillRect(-pad, -pad, surface.width, surface.height);
        }
        if (preset === "grid") {
            paint.strokeStyle = "#aeb8c5";
            paint.globalAlpha = .32;
            paint.lineWidth = Math.max(.5, unit * 1.5);
            const spacing = 100 * unit;
            paint.beginPath();
            for (let x = -spacing; x < width + pad; x += spacing) {
                paint.moveTo(x, -pad);
                paint.lineTo(x, height + pad);
            }
            for (let y = -spacing; y < height + pad; y += spacing) {
                paint.moveTo(-pad, y);
                paint.lineTo(width + pad, y);
            }
            paint.stroke();
            paint.globalAlpha = 1;
        }
        if (preset === "frosted") {
            let seed = 1297;
            const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
            for (let i = 0; i < 9000; i++) {
                paint.fillStyle = i % 2 ? "#b9bec6" : "#080c12";
                paint.globalAlpha = .04 + random() * .12;
                const x = -pad + random() * surface.width, y = -pad + random() * surface.height, radius = (1 + random() * 7) * unit;
                paint.fillRect(x, y, radius, radius);
            }
            paint.globalAlpha = 1;
        }
    }
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(surface, -pad, -pad);
    ctx.restore();
}
