import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { backgroundMode, paintParagraphBackground, validateParagraphBackground } from "../lib/paragraph-background.ts";
const { background, width, height } = JSON.parse(readFileSync(0, "utf8"));
validateParagraphBackground(background);
if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error("背景尺寸无效");
const canvas = createCanvas(width, height);
let image;
if (backgroundMode(background) === "image") {
  const source = await loadImage(Buffer.from(background.image.dataUrl.split(",")[1], "base64"));
  if (source.width > 1920 || source.height > 1920) throw new Error("背景图片尺寸过大，请重新上传");
  image = { source, width: source.width, height: source.height };
}
paintParagraphBackground(canvas.getContext("2d"), background, createCanvas, image);
process.stdout.write(canvas.toBuffer("image/png"));
