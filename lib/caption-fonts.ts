// Each alias names one shipped font file. Requested CSS weight never silently
// swaps a reviewed recipe to another file or asks the browser to embolden it.
export const CAPTION_FONT_FACES = {
  "SC Source Han Sans": { file: "NotoSansCJKsc-Regular.otf", weight: 400, label: "思源黑体" },
  "SC Source Han Sans Bold": { file: "NotoSansCJKsc-Bold.otf", weight: 700, label: "思源黑体 Bold" },
  "SC Source Han Serif": { file: "NotoSerifCJKsc-Regular.otf", weight: 400, label: "思源宋体" },
  "SC Source Han Serif Bold": { file: "NotoSerifCJKsc-Bold.otf", weight: 700, label: "思源宋体 Bold" },
  "SC Source Han Serif Heavy": { file: "NotoSerifCJKsc-Black.otf", weight: 900, label: "思源宋体 Heavy" },
  "SC LXGW WenKai": { file: "LXGWWenKai-Regular.ttf", weight: 400, label: "霞鹜文楷" },
  "SC Smiley Sans": { file: "SmileySans-Oblique.ttf", weight: 400, label: "得意黑" },
  // Douyin's name says Bold, but OS/2.usWeightClass and its sole native face are 400.
  "SC Douyin Sans": { file: "DouyinSansBold.ttf", weight: 400, label: "抖音美好体（原生粗体）" },
  "SC Ma Shan Zheng": { file: "MaShanZheng-Regular.ttf", weight: 400, label: "马善政楷书" },
  "SC Long Cang": { file: "LongCang-Regular.ttf", weight: 400, label: "龙藏体" },
  "SC Liu Jian Mao Cao": { file: "LiuJianMaoCao-Regular.ttf", weight: 400, label: "刘建毛草" },
  "SC Zhi Mang Xing": { file: "ZhiMangXing-Regular.ttf", weight: 400, label: "志莽行书" },
  "SC Tiejili": { file: "TiejiliSC-Regular.ttf", weight: 400, label: "铁蒺藜体" },
} as const;

export type CaptionFontFamily = keyof typeof CAPTION_FONT_FACES;
export type CaptionFontEffect = "regular" | "bold" | "italic" | "bold-italic";

export function resolveCaptionFont(family: string, requestedWeight = 400): { family: string; weight: number } {
  // Keep this argument for callers holding old recipe weights. Only the file
  // decides the actual weight; unregistered system faces also use regular.
  void requestedWeight;
  const face = Object.hasOwn(CAPTION_FONT_FACES, family) ? CAPTION_FONT_FACES[family as CaptionFontFamily] : undefined;
  return { family, weight: face?.weight ?? 400 };
}

export function captionStyleFont(family: string, effect: CaptionFontEffect): { family: string; weight: number } {
  const bold = effect === "bold" || effect === "bold-italic";
  if (bold) {
    if (family === "SC Source Han Sans") family = "SC Source Han Sans Bold";
    if (family === "SC Source Han Serif") family = "SC Source Han Serif Bold";
  } else {
    if (family === "SC Source Han Sans Bold") family = "SC Source Han Sans";
    if (family === "SC Source Han Serif Bold" || family === "SC Source Han Serif Heavy") family = "SC Source Han Serif";
  }
  return resolveCaptionFont(family);
}
