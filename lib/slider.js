/**
 * Slider-captcha gap locator — a direct port of `match_slider_offset` from
 * HG-ha/ICP_Query (`src/python/ymicp.py`), the same heuristic the upstream API
 * uses for its captcha-free path.
 *
 * The background image contains a notch: a solid-colour square of roughly the
 * slider's size. The algorithm
 *
 *   1. drops every second row/column (halving both dimensions),
 *   2. quantizes each channel to a multiple of 4 so JPEG-ish noise collapses,
 *   3. takes the three most frequent quantized colours,
 *   4. for each colour builds a per-column vertical run length map and scans
 *      rows for a square-ish horizontal run (`0.7 < width / height < 1.4`),
 *   5. returns the left edge of the largest candidate, scaled back to full
 *      image coordinates.
 *
 * It is heuristic: a busy background may hide the notch, in which case the
 * caller fetches a fresh captcha and tries again.
 *
 * @module dsh-icp/lib/slider
 */

/** Upper bound for a plausible notch edge in the quantized image. */
const TOP_COLORS = 3;
/** Aspect-ratio window for a square notch. */
const MIN_RATIO = 0.7;
const MAX_RATIO = 1.4;

/**
 * Find the horizontal offset of the slider notch in the background image.
 * @param {{width: number, height: number, rgb: Uint8Array}} small - decoded slider piece (only its size is used).
 * @param {{width: number, height: number, rgb: Uint8Array}} big - decoded background.
 * @returns {{ok: true, offsetX: number, area: number} | {ok: false, reason: string}} the notch left edge in full-resolution pixels, or why detection failed.
 */
export function findSliderOffset(small, big) {
  if (!small || !big || small.width <= 0 || small.height <= 0 || big.width <= 0 || big.height <= 0) {
    return { ok: false, reason: '图片尺寸非法' };
  }
  const width = Math.floor(big.width / 2);
  const height = Math.floor(big.height / 2);
  if (width < 4 || height < 4) return { ok: false, reason: `背景图过小：${big.width}x${big.height}` };
  if (big.rgb.length < big.width * big.height * 3) return { ok: false, reason: '背景图像素数据不完整' };

  // Downsample by 2 and quantize each channel to a multiple of 4.
  const colorId = new Int32Array(width * height);
  const counts = new Map();
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * 2 * big.width;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow + x * 2) * 3;
      const index = y * width + x;
      const id =
        (big.rgb[source] & ~3) +
        (big.rgb[source + 1] & ~3) * 256 +
        (big.rgb[source + 2] & ~3) * 65536;
      colorId[index] = id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return { ok: false, reason: '背景图没有可用像素' };
  const topColors = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_COLORS)
    .map(([id]) => id);

  // The notch is at least a quarter of the slider's shorter side.
  const minSide = Math.max(1, Math.floor(Math.min(small.width, small.height) * 0.25));
  // Never look at the leftmost quarter: that is where the slider handle starts.
  const skipLeft = Math.floor(small.width / 4);
  // A candidate this large is good enough to stop scanning.
  const goodEnough = Math.floor((minSide * minSide * 3) / 2);
  const columnRun = new Int32Array(width * height);

  let bestArea = 0;
  let bestX = 0;
  for (const color of topColors) {
    for (let index = 0; index < colorId.length; index += 1) {
      columnRun[index] = colorId[index] === color ? 1 : 0;
    }
    // columnRun[y][x] = length of the vertical run of `color` ending at (x, y).
    for (let y = 1; y < height; y += 1) {
      const rowBase = y * width;
      const previousBase = rowBase - width;
      for (let x = 0; x < width; x += 1) {
        const index = rowBase + x;
        columnRun[index] = columnRun[index] === 0 ? 0 : columnRun[previousBase + x] + 1;
      }
    }
    for (let y = minSide; y < height; y += 1) {
      const rowBase = y * width;
      let x = skipLeft;
      while (x < width) {
        if (columnRun[rowBase + x] < minSide) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < width && columnRun[rowBase + x] >= minSide) x += 1;
        const runWidth = x - start;
        const runHeight = columnRun[rowBase + start];
        if (runHeight <= 0) continue;
        const ratio = runWidth / runHeight;
        const area = runWidth * runHeight;
        if (ratio > MIN_RATIO && ratio < MAX_RATIO && area > bestArea) {
          bestArea = area;
          bestX = start;
          if (bestArea >= goodEnough) return { ok: true, offsetX: bestX * 2, area: bestArea };
        }
      }
    }
  }
  if (bestArea === 0) return { ok: false, reason: '背景图中未找到滑块缺口' };
  return { ok: true, offsetX: bestX * 2, area: bestArea };
}
