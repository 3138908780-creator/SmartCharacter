import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { CAPTION_FONT_FACES, resolveCaptionFont } from '../lib/caption-fonts.ts';
import { createTimelineCards, createTimelineComposition, validateTimelineCards, timelineLayout, timelineColors, mergeTimelineItem, resetTimelineItem, selectTimelineSpan, clearTimelineSpan } from '../lib/timeline-cards.ts';
import { compositionLayers, compositionControlSize, compositionPaintBounds } from '../lib/caption-composition.ts';
import { LINK_RENDER_TEMPLATE } from '../lib/linked-packaging.ts';

const cues = ['2021年，发布蓝皮书，八成租客愿意租房五年以上，租房成为主动选择而非无奈之举。', '2030年，继续升级，城市居住方式不断变化，更多人选择灵活生活。', '2035年，形成体系，持续改进服务，让更多人获得稳定的生活。', '2040年，完善流程，长期验证方案。', '2045年，拓展服务，认真复盘。', '2050年，持续行动，共同见证。'].map((text, i) => ({ id: `t${i}`, text, start: i * 3, end: i * 3 + 2.8 }));
function make(n = 3, source = cues) {
  const selected = source.slice(0, n), start = selected[0].start;
  const group = { id: 'timeline', templateId: 'link-timeline', cueIds: selected.map(c => c.id), items: selected.map(c => ({ cueId: c.id, text: c.text.slice(0, 80), sourceText: c.text, offset: c.start - start })), position: { x: 50, y: 62 }, scale: 1, previous: 'keep', exit: 'cut' };
  group.timeline = createTimelineCards(group, source); return group;
}
const plan = (g, source = cues, aspect = 9 / 16, measure) => createTimelineComposition(g, source, aspect, measure);
const frame = (p, t) => compositionLayers(p, LINK_RENDER_TEMPLATE, t, '#f6bf0a');
const visible = (p, t) => frame(p, t).filter(l => l.opacity > .001);
const clocks = item => [item.offset, item.complete, item.exitStart, item.end, item.manual];

test('two-to-six adjacent cues form ordered source-complete events; plain short copy also works', () => {
  for (let n = 2; n <= 6; n++) {
    const g = make(n); validateTimelineCards(g, cues);
    assert.equal(g.timeline.items.length, n); assert.deepEqual(g.timeline.items.flatMap(i => i.cueIds), g.cueIds);
    assert.equal(g.timeline.items[0].node, '2021年'); assert.equal(g.timeline.items[0].title, '发布蓝皮书');
    assert.equal(g.timeline.items[0].sourceText, cues[0].text);
  }
  const simple = ['重要主题', '说明内容', '行动建议'].map((text, i) => ({ id: String(i), text, start: i * 2, end: i * 2 + 1.8 }));
  const g = make(3, simple);
  assert.deepEqual(g.timeline.items.map(i => i.body), simple.map(c => c.text)); assert.equal(g.timeline.items[0].node, '阶段1');
  assert.throws(() => make(1), /2–6/);
  const nonAdjacent = make(); nonAdjacent.cueIds = ['t0', 't2']; assert.throws(() => validateTimelineCards(nonAdjacent, cues), /相邻/);
});

test('legacy ordinary 80-character truncation never silently loses source copy', () => {
  const source = [0, 1].map(i => ({ id: String(i), text: 'a'.repeat(90), start: i * 3, end: i * 3 + 2.8 }));
  const g = make(2, source); assert.equal(g.timeline.items[0].body, source[0].text); assert.equal(g.timeline.items[0].paragraph.text, source[0].text);
  g.items[0].text = '独立手改后的说明'; g.timeline = createTimelineCards(g, source);
  assert.equal(g.timeline.items[0].body, '独立手改后的说明'); assert.equal(g.timeline.items[0].sourceText, source[0].text);
  const huge = source.map(c => ({ ...c, text: '中文'.repeat(80) }));
  assert.throws(() => make(2, huge), /容量|精简|丢字/);
});

test('conversion preserves manually confirmed onset, while font, copy, color and aspect never recalculate clocks', () => {
  const g = make(); Object.assign(g.items[0], { offset: .12, manual: true }); g.timeline = createTimelineCards(g, cues);
  assert.equal(g.timeline.items[0].offset, .12); assert.equal(g.timeline.items[0].manual, true);
  Object.assign(g.timeline.items[1], { offset: 3.1, complete: 3.7, exitStart: 5.4, end: 5.7, manual: true });
  const before = g.timeline.items.map(clocks);
  g.timeline.items[1].body = '改完正文后继续校准'; g.timeline.appearance.bodySize = 42;
  g.style = { font: 'SC Source Han Serif Bold', subFont: 'SC LXGW WenKai', fillMode: 'theme', palette: ['#3988bb', '#eeeeee', '#222222'] };
  for (const aspect of [9 / 16]) plan(g, cues, aspect);
  assert.deepEqual(g.timeline.items.map(clocks), before);
  const reset = resetTimelineItem(g, cues, 1); assert.equal(reset.offset, 3); assert.equal(reset.body, g.timeline.items[1].body); assert.equal(reset.manual, false);
  assert.deepEqual(g.timeline.items.map(clocks), before, 'reset is immutable until caller applies it');
});

test('source assignment uses exact UTF-16 occurrence, supports three independent roles and preserves timing', () => {
  const source = ['😀重点，再重点，然后解释现象。', '第二个事件保持原样。'].map((text, i) => ({ id: String(i), text, start: i * 3, end: i * 3 + 2.8 })), g = make(2, source);
  const before = structuredClone(g), at = source[0].text.lastIndexOf('重点');
  g.timeline = selectTimelineSpan(g.timeline, 0, 'node', at, at + 2);
  assert.deepEqual(g.timeline.items[0].paragraph.node, { start: at, end: at + 2 }); assert.equal(g.timeline.items[0].node, '重点');
  assert.ok(g.timeline.items[0].body.startsWith('😀重点'));
  const titleStart = source[0].text.indexOf('然后'); g.timeline = selectTimelineSpan(g.timeline, 0, 'title', titleStart, titleStart + 2);
  const bodyStart = source[0].text.indexOf('解释'); g.timeline = selectTimelineSpan(g.timeline, 0, 'body', bodyStart, bodyStart + 4);
  assert.equal(g.timeline.items[0].body, '解释现象');
  g.timeline.items[0].node = '节点手改'; g.timeline.items[0].title = '短标题手改'; g.timeline.items[0].body = '正文手改'; validateTimelineCards(g, source);
  const cleared = clearTimelineSpan(g.timeline, 0, 'node'); assert.equal(cleared.items[0].node, ''); assert.ok(cleared.items[0].body.includes('正文手改')); assert.ok(cleared.items[0].body.includes('重点'));
  assert.deepEqual(clocks(cleared.items[0]), clocks(before.timeline.items[0])); assert.deepEqual(cleared.items[1], before.timeline.items[1]);
  assert.throws(() => selectTimelineSpan(g.timeline, 0, 'title', at, at + 2), /重叠/);
  assert.throws(() => selectTimelineSpan(g.timeline, 0, 'node', -1, 4), /选择/);
});

test('clearing unedited role selections restores exact source copy rather than deleting selected words', () => {
  const g = make(2), original = g.timeline.items[0];
  let d = clearTimelineSpan(g.timeline, 0, 'node'); d = clearTimelineSpan(d, 0, 'title');
  assert.equal(d.items[0].body, original.paragraph.text); assert.equal(d.items[0].node, ''); assert.equal(d.items[0].title, '');
  assert.deepEqual(clocks(d.items[0]), clocks(original));
});

test('merge keeps edited role text, full ordered source, first entrance and final departure and can reach one event', () => {
  const g = make(3); g.timeline.items.forEach((item, i) => Object.assign(item, { node: `节点${i}`, title: `标题${i}`, body: `正文${i}`, manual: true }));
  const before = structuredClone(g), d = mergeTimelineItem(g, cues, 0), merged = d.items[0];
  assert.deepEqual(g, before); assert.equal(merged.node, '节点0\n节点1'); assert.equal(merged.title, '标题0\n标题1'); assert.equal(merged.body, '正文0\n正文1');
  assert.deepEqual(merged.cueIds, ['t0', 't1']); assert.equal(merged.sourceText, cues[0].text + '\n' + cues[1].text);
  assert.equal(merged.offset, before.timeline.items[0].offset); assert.equal(merged.complete, before.timeline.items[0].complete);
  assert.equal(merged.exitStart, before.timeline.items[1].exitStart); assert.equal(merged.end, before.timeline.items[1].end); assert.equal(merged.manual, true);
  assert.deepEqual(d.items[1], before.timeline.items[2]);
  g.timeline = d; g.timeline = mergeTimelineItem(g, cues, 0); assert.equal(g.timeline.items.length, 1); validateTimelineCards(g, cues);
  assert.throws(() => mergeTimelineItem(g, cues, 0), /没有/);
});

test('overflow during merge is rejected immutably instead of clipping or truncating copy', () => {
  const g = make(2); g.timeline.items.forEach(item => item.body = '文本内容'.repeat(15));
  validateTimelineCards(g, cues); const before = structuredClone(g);
  assert.throws(() => mergeTimelineItem(g, cues, 0), /容量|精简/); assert.deepEqual(g, before);
});

test('invalid structures, non-finite or overlapping clocks, source omissions and malformed selections are rejected', () => {
  const mutations = [g => g.timeline = null, g => g.timeline.items = [], g => g.timeline.items[0] = null, g => g.timeline.items[0].node = 4, g => g.timeline.items[0].manual = 'yes', g => g.timeline.items[0].offset = NaN, g => g.timeline.items[0].complete = 0, g => g.timeline.items[0].exitStart = .1, g => g.timeline.items[0].end = 90, g => g.timeline.items[1].offset = .5, g => g.timeline.items[0].cueIds.push('t1'), g => g.timeline.items[0].paragraph.node.end = 999, g => g.timeline.items[0].paragraph.title = { start: 0, end: 3 }, g => g.timeline.appearance.bodySize = 10, g => g.timeline.appearance.lineWidth = Infinity, g => g.timeline.appearance.nodeRadius = 0];
  for (const change of mutations) { const g = make(); change(g); assert.throws(() => validateTimelineCards(g, cues)); }
});

test('axis opens from right before event, stationary point grows to target while every complete text role slides in', () => {
  const g = make(2), p = plan(g), item = g.timeline.items[0], axis = t => frame(p, t).find(l => l.excludeFromControlBounds);
  const initial = axis(.10), filled = axis(item.offset + .01);
  assert.ok(initial.sx > 0 && initial.sx < 1); assert.ok(initial.x > filled.x);
  assert.ok(Math.abs(initial.x + initial.width * initial.sx / 2 - filled.width / 2) < .01, 'right edge stays fixed during entry');
  assert.equal(visible(p, .10).filter(l => l.kind === 'text').length, 0);
  const a = frame(p, item.offset + .04), b = frame(p, item.offset + .20), stable = frame(p, item.complete + .04);
  const rings = layers => layers.filter(l => l.radius === 999).slice(0, 3), words = layers => layers.filter(l => l.kind === 'text' && l.opacity > .01);
  assert.ok(rings(a)[0].sx < rings(b)[0].sx); assert.equal(rings(a)[0].x, rings(b)[0].x); assert.equal(rings(a)[0].x, rings(stable)[0].x);
  assert.equal(rings(stable)[0].sx, 1); assert.equal(rings(stable).length, 3);
  assert.ok(words(a).every(l => l.reveal === 1)); assert.equal(words(a).length, words(stable).length, 'whole roles animate, no character typing');
  const move = words(a).map((l, i) => l.x - words(stable)[i].x); assert.ok(move.every(x => Math.abs(x - move[0]) < .01)); assert.ok(move[0] > 100);
  assert.equal(stable.filter(l => l.kind === 'rect' && !l.excludeFromControlBounds && l.opacity > .01).length, 3, 'only the concentric node, no phone frame, image or placeholder');
});

test('event node and text depart together left, a blank axis separates events, final axis retracts left', () => {
  const g = make(2), p = plan(g), [a, b] = g.timeline.items;
  const stable = frame(p, a.complete + .1), exiting = frame(p, a.exitStart + (a.end - a.exitStart) / 2);
  const ringIndex = stable.findIndex(l => l.radius === 999), wordIndex = stable.findIndex(l => l.kind === 'text');
  const ringMove = exiting[ringIndex].x - stable[ringIndex].x, wordMove = exiting[wordIndex].x - stable[wordIndex].x;
  assert.ok(ringMove < -30); assert.ok(Math.abs(ringMove - wordMove) < .01);
  const blank = visible(p, (a.end + b.offset) / 2); assert.equal(blank.length, 1); assert.equal(blank[0].excludeFromControlBounds, true);
  const finalStable = frame(p, b.complete + .1).find(l => l.excludeFromControlBounds), retracting = frame(p, (b.end + 5.8) / 2).find(l => l.excludeFromControlBounds);
  assert.ok(retracting.sx > 0 && retracting.sx < 1); assert.ok(retracting.x < finalStable.x);
  assert.ok(Math.abs(retracting.x - retracting.width * retracting.sx / 2 + finalStable.width / 2) < .01, 'left edge fixed while right edge retreats left');
  assert.equal(visible(p, 5.8).length, 0);
});

test('full viewport axis compensates horizontal drag and scale but follows vertical group position; excludes selection bounds', () => {
  for (const aspect of [9 / 16]) for (const scale of [.5, 1, 2]) {
    const g = make(2); g.scale = scale; g.position = { x: 67, y: 42 };
    const p = plan(g, cues, aspect), axis = frame(p, 1).find(l => l.excludeFromControlBounds), width = 1920 * aspect;
    const left = g.position.x / 100 * width + (axis.x - axis.width / 2) * scale;
    assert.ok(Math.abs(left) < .001); assert.ok(Math.abs(axis.width * scale - width) < .001);
    assert.equal(axis.y, timelineLayout(g, aspect).axisY); assert.equal(axis.frameClip.width, width / scale);
    const control = compositionControlSize(p, LINK_RENDER_TEMPLATE); assert.ok(control.height < 720);
  }
});

test('theme/custom colors have deliberate shared axis-target mode without recoloring video or adding background', () => {
  const g = make(2); g.style = { fillMode: 'theme', palette: ['#2277aa', '#eeddcc', '#000000'] };
  assert.deepEqual(timelineColors(g), { node: '#2277aa', body: '#eeddcc', axis: '#2277aa' });
  g.style.palette = ['#dd4400', '#ffeecc', '#000000']; assert.equal(timelineColors(g).axis, '#dd4400');
  Object.assign(g.style, { fillMode: 'custom', textColor: '#112233', subColor: '#445566', accent: '#778899' });
  assert.deepEqual(timelineColors(g), { node: '#112233', body: '#445566', axis: '#778899' });
  const before = structuredClone(timelineColors(g)); g.style.palette = ['#000000', '#ffffff', '#eeeeee']; assert.deepEqual(timelineColors(g), before);
});

test('real shipped font measurement keeps complete Chinese text readable at the approved 9:16 aspect', () => {
  for (const [family, face] of Object.entries(CAPTION_FONT_FACES)) GlobalFonts.registerFromPath(fileURLToPath(new URL(`../public/fonts/${face.file}`, import.meta.url)), family);
  const ctx = createCanvas(1, 1).getContext('2d');
  const measure = (text, size, family, weight) => { const face = resolveCaptionFont(family, weight); ctx.font = `${face.weight} ${size}px "${face.family}"`; return ctx.measureText(text).width; };
  const g = make(3), before = structuredClone(g.timeline);
  for (const aspect of [9 / 16]) {
    const l = timelineLayout(g, aspect, measure), p = plan(g, cues, aspect, measure);
    assert.ok(l.height < 720); assert.ok(l.width <= 1920 * aspect * .95);
    const viewportWidth = 1920 * aspect, control = compositionControlSize(p, LINK_RENDER_TEMPLATE);
    assert.ok(l.bodyLeft + l.bodyWidth <= viewportWidth * .41 + .001, 'right-biased text reserves safe-area margin without moving the central node');
    assert.ok(control.width / 2 <= viewportWidth * .42, 'symmetric selection bounds remain within the default 8–92% safe area');
    for (const item of g.timeline.items) {
      const layers = frame(p, item.complete + .03).filter(layer => !layer.excludeFromControlBounds), bounds = compositionPaintBounds(layers);
      assert.ok(bounds.left >= -viewportWidth * .42 && bounds.right <= viewportWidth * .42, 'all complete event text, including serif skew, stays inside the safe area');
      assert.ok(layers.filter(layer => layer.radius === 999 && layer.opacity > .01).every(layer => Math.abs(layer.x) < .001), 'node stays centered');
    }
    for (const [i, row] of l.rows.entries()) for (const role of ['node', 'title', 'body']) {
      const width = role === 'body' ? l.bodyWidth - 8 : l.leftWidth, font = role === 'body' ? l.bodyFont : l.font;
      assert.equal(row[role].lines.join(''), g.timeline.items[i][role].replaceAll('\n', ''));
      assert.ok(row[role].lines.every(text => measure(text, row[role].size, font, 400) <= width + .01));
      assert.ok(row[role].size >= (role === 'node' ? 48 : role === 'title' ? 24 : 26));
    }
    assert.ok(p.layerTracks.every(({ layer }) => layer.text === '' || layer.kind === 'text'));
  }
  assert.deepEqual(g.timeline, before);
});
