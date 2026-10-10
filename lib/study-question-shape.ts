// Angular question mark modeled on the supplied IMG_3064 reference: broad
// horizontal cap, diagonal fold, short upright stem, and a separate square dot.
// Points are normalized to its visible bounding box, shared by SVG and Pillow.
export const squareQuestionPolygons: Array<Array<[number, number]>> = [
  [[.047, 0], [1, 0], [.93, .377], [.898, .42], [.54, .58], [.51, .726], [.132, .726], [.183, .489], [.553, .317], [.574, .226], [0, .226]],
  [[.111, .798], [.498, .798], [.46, 1], [.073, 1]],
];

export function punctuationFreeEnglish(text: string): string {
  return text.replace(/[’']/gu, "").replace(/\p{P}+/gu, " ").replace(/\s+/gu, " ").trim().toUpperCase();
}
