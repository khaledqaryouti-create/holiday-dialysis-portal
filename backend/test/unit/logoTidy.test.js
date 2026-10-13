import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeWhiteBackground, contentBox } from '../../src/domain/logoTidy.js';

// 10x6 image: white background, orange block at x 2..5, y 1..4, with a white "letter" pixel inside the block at (3,2).
function sample() {
  const w = 10, h = 6, px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) { const i = (y * w + x) * 4; px[i] = 232; px[i + 1] = 104; px[i + 2] = 36; }
  const i = (2 * w + 3) * 4; px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; // white inside the logo
  return { w, h, px };
}

test('white background connected to the edges becomes transparent; white inside the logo stays', () => {
  const { w, h, px } = sample();
  const { removed } = removeWhiteBackground(px, w, h);
  assert.equal(removed, w * h - 16);
  assert.equal(px[(0 * w + 0) * 4 + 3], 0);              // corner removed
  assert.equal(px[(2 * w + 3) * 4 + 3], 255);            // enclosed white kept
  assert.deepEqual([...px.slice((1 * w + 2) * 4, (1 * w + 2) * 4 + 4)], [232, 104, 36, 255]); // logo colour untouched
});

test('blended edge pixels lose their white tint instead of keeping a halo', () => {
  const w = 3, h = 1, px = new Uint8ClampedArray([255, 255, 255, 255, 244, 180, 146, 255, 232, 104, 36, 255]);
  removeWhiteBackground(px, w, h, { solid: 250, soft: 120 });
  assert.equal(px[3], 0);
  assert.ok(px[7] < 255 && px[7] > 0, 'edge pixel is partly transparent');
  assert.ok(px[5] < 180, 'white removed from the edge colour');
});

test('trim box hugs the visible logo with a small margin', () => {
  const { w, h, px } = sample();
  removeWhiteBackground(px, w, h);
  assert.deepEqual(contentBox(px, w, h, { marginRatio: 0 }), { x: 2, y: 1, w: 4, h: 4 });
  assert.equal(contentBox(new Uint8ClampedArray(16), 2, 2), null);
});
