export const SRT_ERROR_MESSAGE = "srt文件异常，无法导入";
export const VIDEO_READ_ERROR_MESSAGE = "视频无法读取，请选择可正常播放的视频文件。";
export const VIDEO_ASPECT_MESSAGE = "当前仅支持 9:16 视频导入，请选择符合比例的视频文件。";

export function validCueTime(cue: { start: unknown; end: unknown }) {
  return typeof cue.start === "number" && typeof cue.end === "number"
    && Number.isFinite(cue.start) && Number.isFinite(cue.end)
    && cue.start >= 0 && cue.end > cue.start;
}

function timestamp(source: string) {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(source.trim());
  if (!match) throw new Error(SRT_ERROR_MESSAGE);
  const [, hours, minutes, seconds, milliseconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

/** Validate every block before accepting any of the file. Overlapping cues are allowed. */
export function parseSrt(source: string) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error(SRT_ERROR_MESSAGE);
  return normalized.split(/\n[\t ]*\n+/).map((block, index) => {
    const lines = block.split("\n");
    const timingIndex = /^\d+\s*$/.test(lines[0]) ? 1 : 0;
    const timing = /^\s*(\S+)\s*-->\s*(\S+)\s*$/.exec(lines[timingIndex] ?? "");
    if (!timing) throw new Error(SRT_ERROR_MESSAGE);
    const start = timestamp(timing[1]), end = timestamp(timing[2]);
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]*>/g, "").trim();
    if (!validCueTime({ start, end }) || !text) throw new Error(SRT_ERROR_MESSAGE);
    return { id: `imported-${index}-${start}`, start, end, text, highlights: [] };
  });
}

/** Decode a frame in a detached element. The current engineering video stays untouched. */
export async function inspectVideo(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const video = document.createElement("video"), url = URL.createObjectURL(file);
  video.muted = true;
  video.preload = "auto";
  try {
    return await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
      const fail = () => reject(new Error(VIDEO_READ_ERROR_MESSAGE));
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      const timeout = window.setTimeout(() => { cleanup(); fail(); }, 15000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        video.onloadeddata = video.onerror = null;
      };
      video.onerror = () => { cleanup(); fail(); };
      video.onloadeddata = () => {
        cleanup();
        const { videoWidth: width, videoHeight: height, duration } = video;
        if (!width || !height || !Number.isFinite(duration) || duration <= 0) fail();
        else resolve({ width, height, duration });
      };
      signal?.addEventListener("abort", abort, { once: true });
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
