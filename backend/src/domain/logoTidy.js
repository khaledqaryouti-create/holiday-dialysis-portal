// Logo tidy-up (shared, pure): make the white background around a logo transparent and trim empty edges.
// Works on raw RGBA pixels so the browser (canvas) can use it and unit tests can check it.
// Only the white area CONNECTED TO THE EDGES is removed, so white parts inside the logo (e.g. white lettering on a
// coloured shape) stay solid. Edge pixels that blend into white get partial transparency with the white removed
// ("de-matting"), so curves stay smooth instead of keeping a white halo.

/**
 * @param {Uint8ClampedArray} px RGBA pixels (modified in place)
 * @param {number} w width
 * @param {number} h height
 * @param {{ solid?: number, soft?: number }} o  whiteness above `solid` = background; between `soft` and `solid` = blended edge
 * @returns {{ removed: number }} number of pixels made fully transparent
 */
export function removeWhiteBackground(px, w, h, { solid = 238, soft = 150 } = {}) {
  const minOf = (i) => Math.min(px[i], px[i + 1], px[i + 2]);
  const isBg = (p) => { const i = p * 4; return px[i + 3] < 16 || minOf(i) >= solid; };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { const p = y * w + x; if (!seen[p] && isBg(p)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  let removed = 0;
  while (stack.length) {
    const p = stack.pop(); const x = p % w; const y = (p - x) / w;
    px[p * 4 + 3] = 0; removed++;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  // Soften pixels next to the removed background that are partly white.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x; if (seen[p]) continue;
      const touches = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (y > 0 && seen[p - w]) || (y < h - 1 && seen[p + w]);
      if (!touches) continue;
      const i = p * 4; const m = minOf(i);
      if (m <= soft) continue;
      const a = Math.max(0, Math.min(1, (solid - m) / (solid - soft))); // 1 = keep, 0 = background
      if (a <= 0.02) { px[i + 3] = 0; continue; }
      for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, Math.round((px[i + k] - 255 * (1 - a)) / a)));
      px[i + 3] = Math.round(px[i + 3] * a);
    }
  }
  return { removed };
}

/** Smallest box containing visible pixels, with a small margin. Returns null if the image is empty. */
export function contentBox(px, w, h, { alphaMin = 12, marginRatio = 0.03 } = {}) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] >= alphaMin) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * marginRatio);
  return { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m), w: Math.min(w, x1 + m + 1) - Math.max(0, x0 - m), h: Math.min(h, y1 + m + 1) - Math.max(0, y0 - m) };
}
