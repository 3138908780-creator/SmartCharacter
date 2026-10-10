import { CAPTION_FONT_FACES } from './caption-fonts.ts';
export type PreviewRect = Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
}>;
export type PreviewColor = Readonly<{
    hex: string;
    r: number;
    g: number;
    b: number;
    a: number;
    x: number;
    y: number;
}>;
export type PreviewColorSnapshot = Readonly<{
    rect: PreviewRect;
    width: number;
    height: number;
    imageUrl: string;
    sample: (clientX: number, clientY: number) => PreviewColor | null;
}>;
export type PreviewColorErrorCode = 'stage-unavailable' | 'video-not-ready' | 'canvas-unreadable' | 'resource-unavailable' | 'font-unavailable' | 'unsupported-paint' | 'aborted';
export class PreviewColorSamplingError extends Error {
    readonly code: PreviewColorErrorCode;
    constructor(code: PreviewColorErrorCode, message: string) { super(message); this.name = 'PreviewColorSamplingError'; this.code = code; }
}
/** Explicit preview-only helpers, never all buttons or aria-hidden paint layers. */
export const PREVIEW_COLOR_EXCLUDE = '[data-preview-color-exclude],.unsafe,.safe-frame,.safe-warning,.face-avoidance-box,.alignment-guide,.resize-handle,.editorial-part-box,.shared-canvas-hitbox,.paragraph-background-error';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const abort = (signal?: AbortSignal) => {
    if (signal?.aborted)
        throw new PreviewColorSamplingError('aborted', '已取消吸色');
};
const validRect = (r: PreviewRect) => [r.left, r.top, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
/** Coordinates are relative to the *displayed stage*, not the video source.
 * Thus contain/letterbox offsets remain in the captured composite and cannot
 * accidentally sample unrelated source-video pixels behind a black bar. */
export function previewPointToPixel(rect: PreviewRect, width: number, height: number, clientX: number, clientY: number) {
    if (!validRect(rect) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || ![clientX, clientY].every(Number.isFinite))
        return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height)
        return null;
    return { x: Math.max(0, Math.min(width - 1, Math.floor(x / rect.width * width))), y: Math.max(0, Math.min(height - 1, Math.floor(y / rect.height * height))) };
}
/** Copies pixels; subsequent canvas/DOM/source-buffer changes cannot feed back. */
export function createPreviewColorSnapshot(pixels: Uint8ClampedArray, width: number, height: number, rect: PreviewRect, imageUrl = ''): PreviewColorSnapshot {
    if (!validRect(rect) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height * 4 !== pixels.length)
        throw new PreviewColorSamplingError('stage-unavailable', '预览画面尺寸无效');
    const frozenPixels = new Uint8ClampedArray(pixels), frozenRect = Object.freeze({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    return Object.freeze({ rect: frozenRect, width, height, imageUrl, sample(clientX: number, clientY: number): PreviewColor | null {
            const point = previewPointToPixel(frozenRect, width, height, clientX, clientY);
            if (!point)
                return null;
            const at = (point.y * width + point.x) * 4, [r, g, b, a] = frozenPixels.subarray(at, at + 4);
            // A fully transparent pixel has no visible color. Do not invent black.
            if (!a)
                return null;
            return Object.freeze({ ...point, r, g, b, a, hex: '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('') });
        } });
}
/** CSSOM normally resolves quoted literal content; unsupported generated assets
 * fail explicitly rather than omitting visible paint from the snapshot. */
export function snapshotPseudoText(content: string): string | null {
    if (!content || content === 'none' || content === 'normal')
        return null;
    const tokens = content.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g);
    if (!tokens || tokens.join(' ').replace(/\s/g, '') !== content.replace(/\s/g, ''))
        throw new PreviewColorSamplingError('unsupported-paint', '当前预览含无法冻结的伪元素，请先暂停动画后重试');
    return tokens.map(token => token.slice(1, -1).replace(/\\([\da-f]{1,6})\s?|\\(.)/giu, (_m, hex, escaped) => hex ? String.fromCodePoint(parseInt(hex, 16)) : escaped)).join('');
}
/** Rewrites paint URLs, including nested SVG fragment references, to data-only
 * resources so foreignObject cannot silently omit external fonts or textures. */
export async function inlineSnapshotCssUrls(css: string, inline: (url: string) => Promise<string>) {
    const expression = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gu;
    const matches = [...css.matchAll(expression)], replacements = await Promise.all(matches.map(async (match) => `url("${(await inline(match[1] ?? match[2] ?? match[3])).replaceAll('"', '%22')}")`));
    let result = '', offset = 0;
    matches.forEach((match, i) => { result += css.slice(offset, match.index) + replacements[i]; offset = match.index! + match[0].length; });
    return result + css.slice(offset);
}
function readablePng(canvas: HTMLCanvasElement) {
    try {
        return canvas.toDataURL('image/png');
    }
    catch {
        throw new PreviewColorSamplingError('canvas-unreadable', '浏览器禁止读取此视频或图片的颜色（跨域限制）；请重新关联本地素材');
    }
}
function videoPng(video: HTMLVideoElement, doc: Document) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.seeking)
        throw new PreviewColorSamplingError('video-not-ready', '视频当前帧尚未就绪，请等待画面加载后再吸色');
    const frame = doc.createElement('canvas');
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    const ctx = frame.getContext('2d');
    if (!ctx)
        throw new PreviewColorSamplingError('canvas-unreadable', '浏览器无法读取预览画面');
    try {
        ctx.drawImage(video, 0, 0);
    }
    catch {
        throw new PreviewColorSamplingError('video-not-ready', '无法读取视频当前帧，请等待加载或重新关联本地视频');
    }
    return readablePng(frame);
}
const resourceCache = new Map<string, Promise<string>>();
function awaitSnapshotWork<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    abort(signal);
    if (!signal)
        return work;
    return new Promise<T>((resolve, reject) => {
        const cancelled = () => reject(new PreviewColorSamplingError('aborted', '已取消吸色'));
        signal.addEventListener('abort', cancelled, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
    });
}
function blobDataUrl(blob: Blob, view: Window & typeof globalThis) {
    return new Promise<string>((resolve, reject) => {
        const reader = new view.FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new PreviewColorSamplingError('resource-unavailable', '无法读取预览中的字体或图片'));
        reader.readAsDataURL(blob);
    });
}
/** Called after pausing playback and settling React/font rendering. All visible
 * computed styles and video/canvas pixels are copied synchronously before any
 * await. Only that private clone is subsequently hydrated and rasterized.
 * No screen capture, EyeDropper, service, or flat-renderer approximation. */
export async function capturePreviewColorSnapshot(stage: HTMLElement, options: {
    video?: HTMLVideoElement;
    signal?: AbortSignal;
    pixelRatio?: number;
} = {}): Promise<PreviewColorSnapshot> {
    const { signal } = options;
    abort(signal);
    const doc = stage?.ownerDocument, view = doc?.defaultView;
    if (!doc || !view || !stage.isConnected)
        throw new PreviewColorSamplingError('stage-unavailable', '预览窗口暂不可用');
    const box = stage.getBoundingClientRect(), rect = { left: box.left, top: box.top, width: box.width, height: box.height };
    if (!validRect(rect))
        throw new PreviewColorSamplingError('stage-unavailable', '预览窗口尚未显示');
    const video = options.video ?? stage.querySelector('video');
    if (!video || !stage.contains(video))
        throw new PreviewColorSamplingError('video-not-ready', '请先关联并加载视频，再从预览中吸色');
    if (video.readyState < 2 || video.seeking || !video.videoWidth || !video.videoHeight)
        throw new PreviewColorSamplingError('video-not-ready', '视频当前帧尚未就绪，请稍后再吸色');
    const ratio = options.pixelRatio ?? view.devicePixelRatio ?? 1;
    if (!Number.isFinite(ratio) || ratio <= 0)
        throw new PreviewColorSamplingError('stage-unavailable', '吸色快照比例无效');
    const resolution = Math.max(1, Math.min(3, ratio)), width = Math.max(1, Math.round(rect.width * resolution)), height = Math.max(1, Math.round(rect.height * resolution));
    if (width * height > 16000000)
        throw new PreviewColorSamplingError('stage-unavailable', '预览窗口过大，请缩小后再吸色');
    const fonts = new Set<keyof typeof CAPTION_FONT_FACES>(), clonedElements: Element[] = [];
    const copyStyle = (source: CSSStyleDeclaration, target: CSSStyleDeclaration) => {
        for (let i = 0; i < source.length; i++) {
            const key = source.item(i);
            target.setProperty(key, source.getPropertyValue(key), source.getPropertyPriority(key));
        }
        target.setProperty('animation', 'none', 'important');
        target.setProperty('transition', 'none', 'important');
        target.setProperty('caret-color', 'transparent', 'important');
    };
    const rememberFonts = (css: CSSStyleDeclaration) => {
        for (const family of css.fontFamily.split(',').map(name => name.trim().replace(/^["']|["']$/g, '')))
            if (Object.hasOwn(CAPTION_FONT_FACES, family)) {
                if (!doc.fonts.check(`${css.fontWeight} ${css.fontSize} "${family}"`))
                    throw new PreviewColorSamplingError('font-unavailable', '字幕字体仍在加载，请稍后再吸色');
                fonts.add(family as keyof typeof CAPTION_FONT_FACES);
            }
    };
    const clone = (source: Node): Node | null => {
        if (source.nodeType === 3)
            return doc.createTextNode(source.textContent ?? '');
        if (source.nodeType !== 1)
            return null;
        const element = source as Element;
        if (element.matches(PREVIEW_COLOR_EXCLUDE) || ['SCRIPT', 'STYLE', 'LINK', 'IFRAME', 'OBJECT', 'EMBED', 'TRACK'].includes(element.tagName.toUpperCase()))
            return null;
        const css = view.getComputedStyle(element);
        if (css.display === 'none' || css.visibility === 'hidden' || css.contentVisibility === 'hidden')
            return null;
        if (css.backdropFilter && css.backdropFilter !== 'none')
            throw new PreviewColorSamplingError('unsupported-paint', '当前预览包含浏览器无法可靠冻结的背景滤镜，暂不能吸色');
        let target: Element;
        if (element.tagName === 'VIDEO') {
            target = doc.createElement('img');
            target.setAttribute('src', videoPng(element as HTMLVideoElement, doc));
        }
        else if (element.tagName === 'IMG') {
            const image = element as HTMLImageElement;
            if (!image.complete || !image.naturalWidth || !image.naturalHeight)
                throw new PreviewColorSamplingError('resource-unavailable', '预览图片尚未加载完成，请稍后再吸色');
            const surface = doc.createElement('canvas');
            surface.width = image.naturalWidth;
            surface.height = image.naturalHeight;
            const paint = surface.getContext('2d');
            if (!paint)
                throw new PreviewColorSamplingError('canvas-unreadable', '浏览器无法读取预览图片');
            try {
                paint.drawImage(image, 0, 0);
            }
            catch {
                throw new PreviewColorSamplingError('resource-unavailable', '预览图片无法读取，请改用本地素材');
            }
            target = doc.createElement('img');
            target.setAttribute('src', readablePng(surface));
        }
        else if (element.tagName === 'CANVAS') {
            const canvas = element as HTMLCanvasElement;
            if (!canvas.width || !canvas.height)
                return null;
            target = doc.createElement('img');
            target.setAttribute('src', readablePng(canvas));
        }
        else {
            target = element.cloneNode(false) as Element;
            for (const attribute of [...target.attributes])
                if (/^on/i.test(attribute.name) || ['srcset', 'loading', 'autoplay', 'controls', 'contenteditable'].includes(attribute.name))
                    target.removeAttribute(attribute.name);
        }
        const style = (target as HTMLElement | SVGElement).style;
        copyStyle(css, style);
        // This border marks selection/out-of-safe-area, not exported caption paint.
        if (element.classList.contains('caption-layer')) {
            style.setProperty('border-color', 'transparent', 'important');
            style.setProperty('outline', 'none', 'important');
        }
        clonedElements.push(target);
        if ([...element.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim()))
            rememberFonts(css);
        if (!['VIDEO', 'CANVAS', 'IMG', 'image'].includes(element.tagName)) {
            const pseudo = (name: '::before' | '::after') => {
                const paint = view.getComputedStyle(element, name), content = snapshotPseudoText(paint.content);
                if (content === null || paint.display === 'none')
                    return null;
                const node = doc.createElement('span');
                node.textContent = content;
                copyStyle(paint, node.style);
                node.style.setProperty('content', 'normal');
                rememberFonts(paint);
                clonedElements.push(node);
                return node;
            };
            const before = pseudo('::before');
            if (before)
                target.append(before);
            for (const child of [...element.childNodes]) {
                const copied = clone(child);
                if (copied)
                    target.append(copied);
            }
            const after = pseudo('::after');
            if (after)
                target.append(after);
        }
        return target;
    };
    const frozenRoot = clone(stage) as HTMLElement | null;
    if (!frozenRoot)
        throw new PreviewColorSamplingError('stage-unavailable', '预览窗口尚未显示');
    const originalRootStyle = view.getComputedStyle(stage);
    if (originalRootStyle.transform !== 'none')
        throw new PreviewColorSamplingError('unsupported-paint', '预览窗口存在整体变形，暂不能准确吸色');
    Object.assign(frozenRoot.style, { position: 'relative', left: '0px', top: '0px', right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`, minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none', margin: '0', transform: 'none', boxShadow: 'none', overflow: 'hidden' });
    // All dependencies below belong to an already-frozen clone; no more reads of
    // the live video/DOM are allowed after this point.
    const inline = async (raw: string): Promise<string> => {
        abort(signal);
        const value = raw.trim();
        if (value.startsWith('#') || value.startsWith('data:'))
            return value;
        const url = new URL(value, doc.baseURI), current = new URL(doc.URL);
        if (url.hash && url.origin === current.origin && url.pathname === current.pathname && url.search === current.search)
            return url.hash;
        if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.protocol !== 'blob:' && url.origin !== current.origin)
            throw new PreviewColorSamplingError('resource-unavailable', '预览包含不可读取的外部图片；请改用本地素材后吸色');
        const key = url.href;
        if (!resourceCache.has(key)) {
            const controller = new view.AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
            resourceCache.set(key, view.fetch(key, { signal: controller.signal }).then(response => {
                if (!response.ok)
                    throw new Error('resource response');
                return response.blob();
            }).then(blob => blobDataUrl(blob, view)).catch(() => { resourceCache.delete(key); throw new PreviewColorSamplingError('resource-unavailable', '预览中的图片或字体无法读取，请加载完成后重试'); }).finally(() => clearTimeout(timeout)));
        }
        const data = await awaitSnapshotWork(resourceCache.get(key)!, signal);
        abort(signal);
        return data;
    };
    await Promise.all(clonedElements.map(async (element) => {
        const style = (element as HTMLElement | SVGElement).style;
        const css = await inlineSnapshotCssUrls(style.cssText, inline);
        style.cssText = css;
        for (const attribute of ['src', 'href', 'xlink:href'])
            if (element.hasAttribute(attribute)) {
                const value = element.getAttribute(attribute)!;
                if (value)
                    element.setAttribute(attribute, await inline(value));
            }
    }));
    const fontCss = await Promise.all([...fonts].map(async (family) => {
        const face = CAPTION_FONT_FACES[family];
        try {
            return `@font-face{font-family:${JSON.stringify(family)};src:url("${await inline(new URL(`/fonts/${face.file}`, doc.baseURI).href)}");font-weight:${face.weight};font-style:normal;font-display:block;}`;
        }
        catch (error) {
            if (error instanceof PreviewColorSamplingError && error.code === 'aborted')
                throw error;
            throw new PreviewColorSamplingError('font-unavailable', '预览字体无法嵌入快照，请等待字体加载后重试');
        }
    }));
    abort(signal);
    const fontStyle = doc.createElementNS(XHTML_NS, 'style');
    fontStyle.textContent = fontCss.join('\n');
    frozenRoot.prepend(fontStyle);
    const serializer = new view.XMLSerializer(), markup = serializer.serializeToString(frozenRoot);
    const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${rect.width} ${rect.height}"><foreignObject x="0" y="0" width="${rect.width}" height="${rect.height}">${markup}</foreignObject></svg>`;
    // A data: image (not a blob: foreignObject) is origin-clean in Chromium. It
    // also forces all dependencies to be inline; no network runs during paint.
    const encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const raster = new view.Image();
    await new Promise<void>((resolve, reject) => {
        const cancel = () => { cleanup(); reject(new PreviewColorSamplingError('aborted', '已取消吸色')); };
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); raster.onload = null; raster.onerror = null; };
        raster.onload = () => { cleanup(); resolve(); };
        raster.onerror = () => { cleanup(); reject(new PreviewColorSamplingError('unsupported-paint', '当前浏览器无法冻结合成预览，暂不能吸色')); };
        const timer = setTimeout(() => { cleanup(); reject(new PreviewColorSamplingError('unsupported-paint', '合成预览快照超时，请稍后重试')); }, 15000);
        signal?.addEventListener('abort', cancel, { once: true });
        raster.src = encoded;
    });
    abort(signal);
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        throw new PreviewColorSamplingError('canvas-unreadable', '浏览器无法读取合成预览');
    try {
        ctx.drawImage(raster, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height);
        // A ready video covers part of the stage: a totally empty raster indicates
        // unsupported foreignObject paint, not a legitimate selectable black frame.
        if (!pixels.data.some((value, index) => index % 4 === 3 && value > 0))
            throw new PreviewColorSamplingError('unsupported-paint', '浏览器未能绘制合成预览，暂不能吸色');
        return createPreviewColorSnapshot(pixels.data, width, height, rect, readablePng(canvas));
    }
    catch (error) {
        if (error instanceof PreviewColorSamplingError)
            throw error;
        throw new PreviewColorSamplingError('canvas-unreadable', '浏览器禁止读取合成画面；请确认视频与图片来自本地');
    }
}
