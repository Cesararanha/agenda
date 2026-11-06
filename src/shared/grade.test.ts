import assert from 'node:assert/strict';
import test from 'node:test';
import { hourRange } from './grade.js';

const hora = (h: number, m = 0) => h * 60 + m;

test('sem compromisso fora do horário, vai das 7h às 22h', () => {
  assert.deepEqual(hourRange([]), { start: 7, end: 22 });
  assert.deepEqual(hourRange([{ startMin: hora(7), endMin: hora(22) }]), { start: 7, end: 22 });
});

test('compromisso mais cedo ou mais tarde amplia a grade até a hora cheia', () => {
  assert.deepEqual(hourRange([{ startMin: hora(5, 30), endMin: hora(6, 30) }]), { start: 5, end: 22 });
  assert.deepEqual(hourRange([{ startMin: hora(21), endMin: hora(22, 15) }]), { start: 7, end: 23 });
  assert.deepEqual(hourRange([{ startMin: hora(23), endMin: hora(24) }]), { start: 7, end: 24 });
});
