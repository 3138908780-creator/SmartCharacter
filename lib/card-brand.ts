export type BrandPalette = [string,string,string];
export function validateBrand(p:unknown) { if(!Array.isArray(p)||p.length!==3||p.some(c=>typeof c!=='string'||!/^#[\da-f]{6}$/iu.test(c)))throw new Error('卡片主题色无效'); }
