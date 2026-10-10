import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/export-project.json', import.meta.url), 'utf8'));
const cue = fixture.cues.find(item => item.combo);
const python = process.env.SC_PYTHON_PATH || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python3');

function compileUnderGbk(asciiInput) {
  const source = `
import json, subprocess, sys
from scripts.composition_renderer import compile_composition
# Reproduce Python's Windows GBK fallback even on a UTF-8 development host.
# Real Node stdin/stdout are used; explicit subprocess encoding bypasses this fallback.
subprocess._text_encoding = lambda: 'gbk'
cue = json.load(sys.stdin)
plan = compile_composition(json.dumps(cue, ensure_ascii=${asciiInput ? 'True' : 'False'}))
assert plan['text'] == cue['text'], (plan['text'], cue['text'])
print(json.dumps({'text': plan['text'], 'templateId': plan['templateId']}, ensure_ascii=True))
`;
  const result = spawnSync(python, ['-B', '-c', source], {
    cwd: root,
    env: { ...process.env, SC_NODE_PATH: process.execPath, PYTHONDONTWRITEBYTECODE: '1' },
    input: JSON.stringify({ ...cue, text: cue.text + '，HR提醒👩‍💻注意。' }),
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('export reads real Node Chinese JSON as UTF-8 even when Python fallback is GBK', () => {
  const plan = compileUnderGbk(true);
  assert.equal(plan.templateId, cue.combo.id);
  assert.match(plan.text, /👩‍💻/);
});

test('export sends unescaped Chinese and non-GBK characters intact under a GBK fallback', () => {
  const plan = compileUnderGbk(false);
  assert.equal(plan.text, cue.text + '，HR提醒👩‍💻注意。');
});
