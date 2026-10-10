import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, SRT_ERROR_MESSAGE, validCueTime } from '../lib/import-validation.ts';
import { parseSavedProject } from '../lib/pro-project.ts';
import { previewSize, trimHistory, visibleWindow } from '../lib/editor-performance.ts';
import { TaskQueue, runTask } from '../scripts/task-runtime.mjs';
import { baseStyle } from '../scripts/six-card-fixtures.mjs';

const valid = '1\n00:00:00,000 --> 00:00:01,500\n字幕一\n\n2\n00:00:01,400 --> 00:00:03,000\n字幕二';
test('valid SRT including BOM, CRLF, multiline and overlapping cues round-trips through project validation', () => {
  const cues = parseSrt('\uFEFF' + valid.replaceAll('\n', '\r\n'));
  assert.equal(cues.length, 2);
  assert.equal(cues[0].end, 1.5);
  const saved = parseSavedProject(JSON.stringify({ version: 7, product: 'SC Basic', cues, baseStyle, basePosition: { x: 50, y: 78 } }));
  assert.equal(saved.cues[1].text, '字幕二');
  assert.equal(parseSrt('1\n00:00:00.000 --> 00:00:01.000\n第一行\n第二行')[0].text, '第一行 第二行');
});
test('one malformed SRT block rejects the entire file with only the agreed generic message', () => {
  for (const input of ['', '垃圾内容', valid + '\n\nbroken block', valid.replace('00:00:01,500', '00:00:00,000'), valid.replace('00:00:00,000', '00:xx:00,000'), valid.replace('00:00:01,500', '00:60:01,500'), valid.replace('字幕二', '')]) {
    assert.throws(() => parseSrt(input), error => error.message === SRT_ERROR_MESSAGE);
  }
  for (const start of [NaN, Infinity, -1]) assert.equal(validCueTime({ start, end: 4 }), false);
});
test('preview dimensions are bounded independently of final export dimensions', () => {
  assert.deepEqual(previewSize(2160, 3840), { width: 540, height: 960 });
  assert.deepEqual(previewSize(540, 960), { width: 540, height: 960 });
});
test('600 cue windows cover the visible region without mounting the full list, including late seeks', () => {
  const offsets = Array.from({ length: 601 }, (_, i) => i * 86);
  const middle = visibleWindow(offsets, 26000, 650);
  assert.ok(middle.end - middle.start < 20);
  assert.ok(offsets[middle.start] <= 26000);
  assert.ok(offsets[middle.end] >= 26650);
  const end = visibleWindow(offsets, offsets.at(-1) - 600, 600);
  assert.equal(end.end, 600);
});
test('undo history is bounded and shared immutable images are not charged again for every edit', () => {
  const image = { dataUrl: 'a'.repeat(100000) };
  const history = Array.from({ length: 100 }, (_, size) => ({ size, image }));
  trimHistory(history, 300000, 60);
  assert.equal(history.length, 60); assert.equal(history[0].size, 40);
  const huge = Array.from({ length: 10 }, (_, size) => ({ size, data: String(size).repeat(100000) }));
  trimHistory(huge, 500000, 60); assert.equal(huge.length, 2);
  const oversized = [{ data: "x".repeat(1000) }]; trimHistory(oversized, 10, 60); assert.equal(oversized.length, 1);
});
test('heavy work is serial and aborting a queued analysis prevents it from starting', async () => {
  const queue = new TaskQueue(), controller = new AbortController();
  let release, running = 0, maximum = 0, started = false;
  const first = queue.run(undefined, async () => { maximum = Math.max(maximum, ++running); await new Promise(resolve => release = resolve); running--; });
  await new Promise(resolve => setImmediate(resolve));
  const second = queue.run(controller.signal, async () => { started = true; });
  controller.abort(new Error('cancelled'));
  await assert.rejects(second, /cancelled/); release(); await first;
  await queue.run(undefined, () => { maximum = Math.max(maximum, ++running); running--; });
  assert.equal(maximum, 1); assert.equal(started, false);
});
test('cancelling a live renderer terminates its process group', async () => {
  const controller = new AbortController();
  const task = runTask(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { signal: controller.signal, idleMs: 5000 });
  setTimeout(() => controller.abort(new Error('cancelled')), 100);
  await assert.rejects(task, /cancelled/);
});
