import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommendTemplate, prioritizeOpeningSingleCharacter, OPENING_SINGLE_CHARACTER_TEMPLATES } from '../lib/template-recommender.ts';
import { filterCompatibleTemplates } from '../lib/template-compatibility.ts';
import { analyzeSemanticFocus, semanticFocusRange } from '../lib/semantic-focus.ts';
import { normalizeHighlights } from '../lib/caption-layout.ts';
import { toggleDemoHighlight } from '../lib/demo-panel.ts';
const templates = JSON.parse(readFileSync(new URL('../effects/templates.json', import.meta.url))).templates;
const preferred = new Set(OPENING_SINGLE_CHARACTER_TEMPLATES);
const choicesFor = cue => filterCompatibleTemplates(templates, cue.highlights.length, '', [], cue);

test('any manually selected opening character prioritizes and rotates the three approved effects', () => {
  for (const text of ['智能字幕解决效率问题', '大字体更醒目', '小字号更精致', '多理性对比', '少冗余装饰']) {
    const cue = { text, highlights: toggleDemoHighlight(text, [], { start: 0, end: 1 }) };
    const choices = choicesFor(cue), chosen = [];
    assert.deepEqual(prioritizeOpeningSingleCharacter(choices, cue).map(t => t.id).sort(), [...preferred].sort());
    assert.ok(!prioritizeOpeningSingleCharacter(choices, cue).some(t => t.id === 'study-roll-overlay'), 'a compatible previous effect outside the preferred group cannot bypass the new rule');
    for (let i = 0; i < 30; i++) {
      const selection = recommendTemplate(choices, `${text}-${i}`, chosen.slice(-3), { ...cue, speechPace: i % 2 ? 'fast' : 'slow' });
      assert.ok(preferred.has(selection.id), selection.id);
      if (chosen.length) assert.notEqual(selection.id, chosen.at(-1), 'avoid repeating the preceding effect');
      chosen.push(selection.id);
    }
    assert.equal(new Set(chosen).size, 3);
    assert.deepEqual(cue.highlights, [{ start: 0, end: 1 }]);
  }
});

test('recognized standalone modifiers flow through automatic range handling into the same preferred effects', () => {
  for (const text of ['大字体更醒目', '小字号更精致', '多理性对比', '少冗余装饰', '高质量内容更重要', '低成本完成交付']) {
    const analysis = analyzeSemanticFocus(text);
    assert.equal(analysis.reason, '句首单字修饰词', text);
    assert.ok(analysis.confidence >= .72);
    const highlights = normalizeHighlights(text, analysis.highlights.map(r => semanticFocusRange(text, r)));
    assert.deepEqual(highlights, [{ start: 0, end: 1 }], text);
    const cue = { text, highlights };
    assert.ok(preferred.has(recommendTemplate(choicesFor(cue), text, [], cue).id));
  }
});

test('compound words and questions do not turn their first character into an automatic modifier', () => {
  for (const text of ['多少才合适', '大小不是重点', '少数用户需要调整', '大量用户都喜欢', '大家都在讨论效率', '小心不要覆盖文件', '大字体还是小字体？']) {
    const analysis = analyzeSemanticFocus(text);
    assert.notEqual(analysis.reason, '句首单字修饰词', text);
    assert.ok(!analysis.highlights.some(r => r.start === 0 && r.end === 1), text);
  }
});

test('middle, tail, multi-character and multiple selections retain the existing recommendation pool', () => {
  for (const cue of [
    { text: '智能字幕更清晰', highlights: [{ start: 0, end: 2 }] },
    { text: '让智能字幕更清晰', highlights: [{ start: 1, end: 2 }] },
    { text: '字幕要更大', highlights: [{ start: 4, end: 5 }] },
    { text: '先提升效率再保证质量', highlights: [{ start: 3, end: 5 }, { start: 8, end: 10 }] },
  ]) {
    const choices = choicesFor(cue);
    assert.equal(prioritizeOpeningSingleCharacter(choices, cue), choices);
  }
});

test('priority never adds incompatible or unavailable effects and retains a valid fallback', () => {
  const cue = { text: '智能字幕解决效率问题', highlights: [{ start: 0, end: 1 }] };
  const one = templates.filter(t => t.id === 'reference-lead-fold');
  assert.equal(recommendTemplate(one, 'only-fold', [], cue).id, 'reference-lead-fold');
  const fallback = templates.filter(t => t.id === 'center-cut');
  assert.equal(prioritizeOpeningSingleCharacter(fallback, cue), fallback);
  assert.equal(recommendTemplate(fallback, 'fallback', [], cue).id, 'center-cut');
  assert.equal(recommendTemplate([], 'empty', [], cue), undefined);
});
