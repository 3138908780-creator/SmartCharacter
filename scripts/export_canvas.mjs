#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { projectSupportsSharedCanvas, renderProjectFrame } from "../lib/canvas-renderer.ts";
import { fitCaptionToSafeArea } from "../lib/runtime-policy.ts";
import { displayVideoSize } from "../lib/card-aspect.ts";
import { validateExportProject } from "./project-validation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = join(root, "public", "fonts");
const fontPaths = {
  "SC Source Han Sans": join(fontDir, "NotoSansCJKsc-Regular.otf"),
  "SC Source Han Serif": join(fontDir, "NotoSerifCJKsc-Regular.otf"),
  "SC LXGW WenKai": join(fontDir, "LXGWWenKai-Regular.ttf"),
  "SC Smiley Sans": join(fontDir, "SmileySans-Oblique.ttf"),
  "SC Douyin Sans": join(fontDir, "DouyinSansBold.ttf"),
  "SC Ma Shan Zheng": join(fontDir, "MaShanZheng-Regular.ttf"),
  "SC Long Cang": join(fontDir, "LongCang-Regular.ttf"),
  "SC Liu Jian Mao Cao": join(fontDir, "LiuJianMaoCao-Regular.ttf"),
  "SC Zhi Mang Xing": join(fontDir, "ZhiMangXing-Regular.ttf"),
  "SC Tiejili": join(fontDir, "TiejiliSC-Regular.ttf"),
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function probeVideo(path) {
  const result = spawnSync(process.env.SC_FFPROBE_PATH || (process.env.SC_RUNTIME_VERIFIED ? (()=>{throw new Error("缺少已校验的 FFprobe 组件路径")})() : "ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration", "-of", "json", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "无法读取视频参数");
  const data = JSON.parse(result.stdout);
  const stream = data.streams[0];
  const [numerator, denominator] = String(stream.avg_frame_rate || "30/1").split("/").map(Number);
  const rotation = Number(stream.side_data_list?.find(value => value.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  return { ...displayVideoSize(Number(stream.width), Number(stream.height), rotation), fps: numerator / Math.max(1, denominator) || 30, duration: Number(data.format.duration) };
}

async function writeFrame(stream, bytes) {
  if (stream.write(bytes)) return;
  await new Promise((resolvePromise, reject) => {
    const onDrain = () => { stream.off("error", onError); resolvePromise(); };
    const onError = (error) => { stream.off("drain", onDrain); reject(error); };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function main() {
  const videoPath = argument("--video");
  const projectPath = argument("--project");
  const outputPath = argument("--output");
  if (!videoPath || !projectPath || !outputPath) throw new Error("缺少 --video、--project 或 --output 参数");

  const [project, library] = await Promise.all([
    readFile(projectPath, "utf8").then(JSON.parse),
    readFile(join(root, "effects", "templates.json"), "utf8").then(JSON.parse),
  ]);
  if (!projectSupportsSharedCanvas(project)) throw new Error("工程包含尚未接入共享 Canvas 的模板");
  await validateExportProject(project, videoPath);
  Object.entries(fontPaths).forEach(([family, path]) => GlobalFonts.registerFromPath(path, family));
  const templates = new Map(library.templates.map((template) => [template.id, template]));
  const video = probeVideo(videoPath);
  const safeProject = { ...project, cues: project.cues.map((cue) => {
    if (!cue.combo || cue.combo.manualLayout || cue.composition) return cue;
    const template = templates.get(cue.combo.id);
    const fitted = fitCaptionToSafeArea(cue, template, video, cue.combo.position ?? template?.defaults?.position ?? { x: 50, y: 48 }, cue.combo.scale ?? 1);
    return { ...cue, combo: { ...cue.combo, position: fitted.position, scale: fitted.scale } };
  }) };
  const totalFrames = Math.round(video.duration * video.fps);
  const canvas = createCanvas(video.width, video.height);
  const ctx = canvas.getContext("2d");
  const ffmpeg = spawn(process.env.SC_FFMPEG_PATH || (process.env.SC_RUNTIME_VERIFIED ? (()=>{throw new Error("缺少已校验的 FFmpeg 组件路径")})() : "ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${video.width}x${video.height}`,
    "-r", video.fps.toFixed(8), "-i", "-", "-an", "-vf", "premultiply=inplace=1", "-c:v", "prores_ks",
    "-profile:v", "4", "-alpha_bits", "16", "-pix_fmt", "yuva444p10le",
    "-vendor", "apl0", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-colorspace", "bt709", outputPath,
  ], { stdio: ["pipe", "inherit", "pipe"] });
  let errors = "";
  ffmpeg.stderr.on("data", (chunk) => { errors = `${errors}${chunk}`.slice(-12000); });
  const ffmpegError = new Promise((_, reject) => ffmpeg.once("error", reject));

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    renderProjectFrame(ctx, safeProject, templates, frameIndex / video.fps, video.width, video.height);
    const imageData = ctx.getImageData(0, 0, video.width, video.height);
    await writeFrame(ffmpeg.stdin, Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength));
    if (frameIndex % Math.max(1, Math.round(video.fps)) === 0) process.stdout.write(`${JSON.stringify({ renderer: "shared-canvas", rendered: frameIndex, total: totalFrames })}\n`);
  }
  ffmpeg.stdin.end();
  const returnCode = await Promise.race([new Promise((resolvePromise) => ffmpeg.once("close", resolvePromise)), ffmpegError]);
  if (returnCode !== 0) throw new Error(errors || `FFmpeg exited with code ${returnCode}`);
  process.stdout.write(`${JSON.stringify({ renderer: "shared-canvas", output: outputPath, frames: totalFrames })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
