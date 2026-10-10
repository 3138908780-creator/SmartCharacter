import { useEffect, useRef, useState } from "react";
import { backgroundMode, paintParagraphBackground, type ParagraphBackground } from "../lib/paragraph-background";
export function ParagraphBackgroundLayer({ background, opacity, width, height }: {
    background: ParagraphBackground;
    opacity: number;
    width: number;
    height: number;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        const target = canvas.current!, ctx = target.getContext("2d")!;
        ctx.clearRect(0, 0, width, height);
        async function draw() {
            let bitmap: ImageBitmap | undefined;
            try {
                if (backgroundMode(background) === "image" && background.image) {
                    const response = await fetch(background.image.dataUrl);
                    bitmap = await createImageBitmap(await response.blob());
                }
                if (cancelled)
                    return;
                paintParagraphBackground(ctx, background, (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }), bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : undefined);
                setError("");
            }
            catch {
                if (!cancelled)
                    setError("背景图片无法显示，请在编辑卡片内容中重新上传");
            }
            finally {
                bitmap?.close();
            }
        }
        void draw();
        return () => { cancelled = true; };
    }, [background, width, height]);
    return <><canvas ref={canvas} width={width} height={height} className="paragraph-background-layer" style={{ opacity }} aria-hidden="true"/>{error && <span className="paragraph-background-error" role="alert">{error}</span>}</>;
}
