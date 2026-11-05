'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bindings = require('../src/bindings');

test('only changed controls are kept, with keys the game knows', () => {
  assert.deepEqual(bindings.normalize({ A: ['SPACE', 'X'] }), {});
  assert.deepEqual(bindings.normalize({ A: ['Y', 'Y', 'NOT_A_KEY'], NOT_A_CONTROL: ['Y'] }), { A: ['Y'] });
  assert.deepEqual(bindings.normalize('nothing'), {});
  assert.deepEqual(bindings.normalizePads({ A: ['PAD_A'] }), {});
  assert.deepEqual(bindings.normalizePads({ A: ['PAD_LB+PAD_RB', 'PAD_NOPE'], B: [] }), { A: ['PAD_LB+PAD_RB'] });
});

test('browser key codes and controller indexes become the game\'s names', () => {
  assert.equal(bindings.keyFromCode('KeyQ'), 'Q');
  assert.equal(bindings.keyFromCode('Digit3'), '3');
  assert.equal(bindings.keyFromCode('Numpad8'), 'KP_8');
  assert.equal(bindings.keyFromCode('ShiftLeft'), 'LSHIFT');
  assert.equal(bindings.keyFromCode('Pause'), null);
  assert.equal(bindings.padFromIndex(0), 'PAD_A');
  assert.equal(bindings.padFromIndex(99), null);
  assert.equal(bindings.padLabel('PAD_LB+PAD_RB'), 'LB + RB');
  assert.equal(bindings.padCombo('PAD_LB', 'PAD_LB'), 'PAD_LB');
  assert.equal(bindings.keyLabel('KP_8'), 'KP 8');
});

test('the file lists every control, its keys, and only the changed controller buttons', () => {
  const text = bindings.fileText({ A: ['Y'] }, { B: ['PAD_X'] });
  assert.match(text, /^A = Y$/m);
  assert.match(text, /^B = LSHIFT C PAD_X$/m);
  assert.match(text, /^FAST_FORWARD = TAB$/m);
  assert.equal(text.split('\n').filter(line => line && !line.startsWith('#')).length, bindings.CONTROLS.length);
});

test('every control has defaults and no mouse buttons: the port reads keys and controller buttons', () => {
  for (const { id } of bindings.CONTROLS) assert.ok(Array.isArray(bindings.DEFAULTS[id]), id);
  assert.equal(Object.values(bindings.DEFAULTS).flat().some(key => key.startsWith('MOUSE')), false);
});

// The port's file of record, when its checkout is beside this one.
test('the defaults match the port\'s bindings.txt', { skip: !fs.existsSync(process.env.COLO_PORT_BINDINGS || '') }, () => {
  const text = fs.readFileSync(process.env.COLO_PORT_BINDINGS, 'utf8');
  for (const match of text.matchAll(/^# ([A-Z_]+) = ([^\n]+)$/gm)) {
    const [, id, value] = match, items = value.trim().split(/\s+/);
    if (!bindings.CONTROLS.some(control => control.id === id)) continue;
    if (items[0].startsWith('PAD_')) assert.deepEqual(bindings.PAD_DEFAULTS[id], items, id);
    else assert.deepEqual(bindings.DEFAULTS[id], items, id);
  }
  assert.ok(path.isAbsolute(process.env.COLO_PORT_BINDINGS));
});
