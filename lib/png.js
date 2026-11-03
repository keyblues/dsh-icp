/**
 * Minimal PNG decoder for the MIIT slider-captcha images.
 *
 * The captcha (`getCheckImagePoint`) returns the slider piece and the
 * background as base64-encoded PNGs. The plugin must locate a solid-colour
 * notch in the background, so it needs real pixels — this module is the whole
 * image stack: `node:zlib` inflate plus PNG unfiltering. No third-party
 * image library is involved, which keeps the bundle dependency-free.
 *
 * Supported: non-interlaced PNG, colour types 0 (grey), 2 (RGB), 3 (palette),
 * 4 (grey+alpha), 6 (RGBA), bit depth 8 or 16 (16-bit channels are reduced to
 * their high byte). Everything else fails loudly, and the caller retries with
 * a fresh captcha.
 *
 * @module dsh-icp/lib/png
 */

import { inflateSync } from 'node:zlib';

/** The 8-byte PNG file signature. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Refuse absurd images before allocating buffers (captchas are ~500x190). */
const MAX_PIXELS = 4 * 1024 * 1024;
/** Inflate ceiling: the largest possible raw scanline payload plus slack. */
const MAX_INFLATE_BYTES = MAX_PIXELS * 4 + 1024 * 1024;
/** Channel count per PNG colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Paeth predictor (PNG spec §9.4).
 * @param {number} a - left neighbour.
 * @param {number} b - upper neighbour.
 * @param {number} c - upper-left neighbour.
 * @returns {number} the predicted byte.
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Walk the chunk stream of one PNG, collecting IHDR/PLTE/IDAT.
 * @param {Buffer} buffer - the PNG bytes.
 * @returns {{header: {width: number, height: number, bitDepth: number, colorType: number, interlace: number}, palette: Buffer | null, idat: Buffer[]}} parsed container.
 */
function readChunks(buffer) {
  let offset = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`PNG 分块 ${type} 越界`);
    if (type === 'IHDR') {
      if (length < 13) throw new Error('PNG IHDR 长度异常');
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      header = {
        width,
        height,
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        compression: buffer[dataStart + 10],
        filter: buffer[dataStart + 11],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'PLTE') {
      palette = buffer.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (header === null) throw new Error('PNG 缺少 IHDR');
  if (idat.length === 0) throw new Error('PNG 缺少 IDAT');
  return { header, palette, idat };
}

/**
 * Undo per-scanline PNG filters into a contiguous channel buffer.
 * @param {Buffer} raw - inflated IDAT payload.
 * @param {number} width - image width in pixels.
 * @param {number} height - image height in pixels.
 * @param {number} channels - bytes per pixel.
 * @param {number} bytesPerSample - 1 for bit depth 8, 2 for bit depth 16.
 * @returns {Buffer} unfiltered pixel data, `height * stride` bytes.
 */
function unfilter(raw, width, height, channels, bytesPerSample) {
  const bytesPerPixel = channels * bytesPerSample;
  const stride = width * bytesPerPixel;
  if (raw.length < (stride + 1) * height) {
    throw new Error(`PNG 像素数据不完整（需要 ${(stride + 1) * height} 字节，实际 ${raw.length}）`);
  }
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)];
    const lineIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const lineOut = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? lineOut[x - bytesPerPixel] : 0;
      const up = prev === null ? 0 : prev[x];
      const upLeft = prev !== null && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      const value = lineIn[x];
      let restored;
      switch (filterType) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG 行过滤类型非法：${filterType}`);
      }
      lineOut[x] = restored & 0xff;
    }
  }
  return out;
}

/**
 * Decode a PNG buffer into packed 8-bit RGB pixels.
 * @param {Buffer | Uint8Array} input - PNG file bytes.
 * @returns {{width: number, height: number, colorType: number, rgb: Uint8Array}} decoded image; `rgb` holds `width * height * 3` bytes.
 */
export function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 8 || SIGNATURE.some((byte, index) => buffer[index] !== byte)) {
    throw new Error('不是合法的 PNG 数据');
  }
  const { header, palette, idat } = readChunks(buffer);
  const { width, height, bitDepth, colorType, compression, interlace } = header;
  if (width <= 0 || height <= 0) throw new Error(`PNG 尺寸非法：${width}x${height}`);
  if (width * height > MAX_PIXELS) throw new Error(`PNG 过大：${width}x${height}`);
  if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`不支持的 PNG 位深：${bitDepth}`);
  if (compression !== 0) throw new Error(`不支持的 PNG 压缩方式：${compression}`);
  if (interlace !== 0) throw new Error('不支持的 PNG 隔行模式');
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new Error(`不支持的 PNG 颜色类型：${colorType}`);
  if (colorType === 3 && palette === null) throw new Error('PNG 调色板缺失');
  const bytesPerSample = bitDepth / 8;
  const pixels = unfilter(
    inflateSync(Buffer.concat(idat), { maxOutputLength: MAX_INFLATE_BYTES }),
    width,
    height,
    channels,
    bytesPerSample,
  );
  const sampleStep = channels * bytesPerSample;
  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    const base = index * sampleStep;
    let red;
    let green;
    let blue;
    if (colorType === 2 || colorType === 6) {
      red = pixels[base];
      green = pixels[base + bytesPerSample];
      blue = pixels[base + 2 * bytesPerSample];
    } else if (colorType === 0 || colorType === 4) {
      red = green = blue = pixels[base];
    } else {
      const paletteIndex = pixels[base];
      const paletteBase = paletteIndex * 3;
      if (paletteBase + 2 >= palette.length) throw new Error(`PNG 调色板索引越界：${paletteIndex}`);
      red = palette[paletteBase];
      green = palette[paletteBase + 1];
      blue = palette[paletteBase + 2];
    }
    rgb[index * 3] = red;
    rgb[index * 3 + 1] = green;
    rgb[index * 3 + 2] = blue;
  }
  return { width, height, colorType, rgb };
}
