export const CARD_ASPECT_MESSAGE = '当前仅支持 9:16 视频导入，请选择符合比例的视频文件。';
export const isCardAspect = (width: number, height: number) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs(width / height - 9 / 16) <= .01;
export function assertCardAspect(width: number, height: number) { if(!isCardAspect(width,height)) throw new Error(CARD_ASPECT_MESSAGE); }
export function displayVideoSize(width:number,height:number,rotation=0) { return Math.abs(rotation % 180)===90 ? {width:height,height:width} : {width,height}; }
export function hasCards(project:{linkedGroups?:unknown[];chapterGroups?:unknown[];paragraphGroups?:unknown[];effectDrafts?:unknown[]}) { return !!(project.linkedGroups?.length||project.chapterGroups?.length||project.paragraphGroups?.length||project.effectDrafts?.length); }
