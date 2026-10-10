/** Conservative, local first drafts. No model calls or remote source uploads.
 * Only complete clauses and explicit, meaning-preserving rewrites are selected.
 * Used at template creation, never when reopening an editor or changing styles.
 */
export const sourceClauses = (text: string) => text.split(/(?:[\n。！？；!?;]|(?<!\d)[，,]|[，,](?!\d))+/u).map(s => s.trim()).filter(Boolean);
function cleanClause(text: string) {
    return text.trim().replace(/^(?:那么|也就是说|换句话说|说明|所以说)[，,\s]*/u, '').replace(/这个(?=会议)/gu, '');
}
function compactFact(text: string) {
    const value = cleanClause(text);
    // A participant count is not evidence of an employment trend. Each clause stays separate.
    const meeting = value.match(/^(?:今年|本次|这次)?(?:我们)?(?:有|共有)?\s*(\d+(?:\.\d+)?)(?:个)?人(?:参加了?|参与了?)(?:这次|本次|这个)?会议$/u);
    if (meeting)
        return `${meeting[1]}人参会`;
    return value;
}
export function draftTitle(text: string, max = 18): string {
    const candidates = sourceClauses(text).map(compactFact).filter(s => s.length <= max);
    return candidates.map((text, order) => ({ text, order, score: (/\d/u.test(text) ? 3 : 0) + (/(?:不|未|没有|不能|下降|增长|提升|完成|准备|检查|市场)/u.test(text) ? 1 : 0) }))
        .sort((a, b) => b.score - a.score || a.order - b.order)[0]?.text ?? '';
}
export function draftWindowCopy(text: string): {
    title: string;
    subtitle: string;
    labels: string[];
} {
    const clauses = sourceClauses(text), title = draftTitle(text, 18);
    const titleSource = clauses.find(s => compactFact(s) === title);
    const remaining = clauses.filter(s => s !== titleSource).map(cleanClause);
    const lead = remaining.find(s => s.length <= 16) ?? '';
    const phrases = remaining.flatMap(s => [s, ...(/不|未|没|并非|难以|预计|可能|如果/u.test(s) ? [] : s.matchAll(/稳中求进|稳中向好/gu))].map(v => typeof v === 'string' ? v : v[0]));
    const shorts = [...new Set(phrases.filter(s => s.length <= 8 && s !== lead))];
    const subtitle = title.endsWith('人参会') && titleSource?.startsWith('今年') ? '今年会议' : '';
    return { title, subtitle, labels: [lead, shorts[0] ?? '', shorts[1] ?? ''] };
}
