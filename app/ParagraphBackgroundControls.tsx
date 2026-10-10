import { useEffect, useRef, useState } from "react";
import { backgroundMode, PARAGRAPH_BACKGROUNDS, type ParagraphBackground } from "../lib/paragraph-background";
export function ParagraphBackgroundControls({ background, onChange, onBegin, onEnd }: {
    background: ParagraphBackground;
    onChange: (background: ParagraphBackground, preview?: boolean) => void;
    onBegin: () => void;
    onEnd: () => void;
}) {
    const imageInput = useRef<HTMLInputElement>(null), uploadSequence = useRef(0);
    const [uploading, setUploading] = useState(false), [choosingImage, setChoosingImage] = useState(false), [error, setError] = useState("");
    const latest = useRef({ background, onChange });
    useEffect(() => { latest.current = { background, onChange }; }, [background, onChange]);
    useEffect(() => { const sequence = uploadSequence; return () => { sequence.current++; }; }, []);
    const mode = choosingImage ? "image" : backgroundMode(background);
    const updateBackground = (patch: Partial<ParagraphBackground>, preview = false) => latest.current.onChange({ ...latest.current.background, ...patch }, preview);
    async function uploadImage(file: File) {
        const sequence = ++uploadSequence.current;
        setUploading(true);
        setError("");
        let bitmap: ImageBitmap | undefined;
        try {
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
                throw new Error("请选择 PNG、JPEG 或 WebP 图片");
            if (file.size > 15 * 1024 * 1024)
                throw new Error("请选择 15 MB 以内的图片");
            bitmap = await createImageBitmap(file);
            const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
            const canvas = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(bitmap.width * ratio)), height: Math.max(1, Math.round(bitmap.height * ratio)) });
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/webp", .88);
            if (dataUrl.length > 4 * 1024 * 1024)
                throw new Error("图片内容过大，请缩小后重新上传");
            if (sequence === uploadSequence.current) {
                setChoosingImage(false);
                updateBackground({ mode: "image", image: { dataUrl, name: file.name.slice(0, 255), width: canvas.width, height: canvas.height } });
            }
        }
        catch (error) {
            if (sequence === uploadSequence.current)
                setError(error instanceof Error ? error.message : "图片读取失败，请重试");
        }
        finally {
            bitmap?.close();
            if (sequence === uploadSequence.current)
                setUploading(false);
        }
    }
    return <div className="paragraph-background-controls">
        <section className="paragraph-settings" aria-labelledby="paragraph-background-title">
          <h3 id="paragraph-background-title">背景底层</h3>
          <div className="paragraph-background-choices" role="group" aria-label="背景底层">
            {([["none", "无底"], ["recommended", "推荐底"], ["image", "上传图片底"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => {
                uploadSequence.current++;
                setUploading(false);
                setChoosingImage(key === "image" && !background.image);
                if (key !== "image" || background.image)
                    updateBackground({ mode: key });
                setError("");
            }}>{label}</button>)}
          </div>
          {mode === "recommended" && <div className="paragraph-preset-choices" role="group" aria-label="推荐背景">{Object.entries(PARAGRAPH_BACKGROUNDS).map(([key, label]) => <button type="button" key={key} aria-pressed={(background.preset ?? "frosted") === key} onClick={() => updateBackground({ preset: key as keyof typeof PARAGRAPH_BACKGROUNDS, blur: key === "gray" || key === "grid" ? 0 : 8 })}>{label}</button>)}</div>}
          {mode === "image" && <div className="paragraph-image-upload"><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file)
                    void uploadImage(file);
            }}/><button type="button" disabled={uploading} onClick={() => imageInput.current?.click()}>{uploading ? "正在读取图片…" : background.image ? "更换背景图片" : "选择背景图片"}</button><small>{background.image?.name ?? "PNG / JPEG / WebP · 15 MB 以内"}</small></div>}
          {choosingImage && <p className="pro-hint">选择图片后生效；当前底层暂时保留。</p>}
          {mode === "none" && <p className="pro-hint">只出现卡片，保留原视频画面。</p>}
        </section>
        <details className="paragraph-settings"><summary>背景效果</summary>
          <fieldset className="control-list" disabled={mode === "none" || choosingImage}>
            <label><span>底层不透明度</span><div className="range-control"><input aria-label="底层不透明度" type="range" min="0" max="100" value={Math.round(background.dim * 100)} onPointerDown={onBegin} onKeyDown={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} onKeyUp={onEnd} onChange={(event) => updateBackground({ dim: Number(event.target.value) / 100 }, true)}/><output>{Math.round(background.dim * 100)}%</output></div></label>
            <label><span>纹理 / 图片柔化</span><div className="range-control"><input aria-label="纹理或图片柔化" disabled={mode === "recommended" && background.preset === "gray"} type="range" min="0" max="60" value={background.blur} onPointerDown={onBegin} onKeyDown={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} onKeyUp={onEnd} onChange={(event) => updateBackground({ blur: Number(event.target.value) }, true)}/><output>{background.blur}</output></div></label>
          </fieldset>
          <p className="pro-hint">仅影响新增底层；柔化不会模糊原视频。底层只在这张卡片的时段出现。</p>
        </details>
    {error && <p className="paragraph-error" role="alert">{error}</p>}
  </div>;
}
