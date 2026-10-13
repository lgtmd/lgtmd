/** Pixel analysis is a review aid. It never determines evidence equality. */
export const MAX_PIXELS = 8_000_000;
export const MAX_ENCODED_BYTES = 32 * 1024 * 1024;
export const TILE_SIZE = 16;
export interface ImageHeader {
  width: number;
  height: number;
  format: "png" | "webp";
}
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RegionResult {
  width: number;
  height: number;
  changedPixels: number;
  boxes: Region[];
}

function fail(message: string): never {
  throw new Error(message);
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function dimensions(
  width: number,
  height: number,
  format: ImageHeader["format"],
): ImageHeader {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height)
  )
    fail("Invalid image dimensions.");
  if (width * height > MAX_PIXELS)
    fail("Image alignment supports at most 8 million pixels per image.");
  return { width, height, format };
}

/** Inspect complete bounded encoded input before allocating decoded pixel buffers. */
export function inspectImage(bytes: Uint8Array): ImageHeader {
  if (bytes.byteLength > MAX_ENCODED_BYTES)
    fail("Image alignment supports at most 32 MiB of encoded data per image.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 8 &&
    bytes
      .slice(0, 8)
      .every((n, i) => n === [137, 80, 78, 71, 13, 10, 26, 10][i])
  ) {
    let offset = 8;
    let header: ImageHeader | undefined;
    let ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) fail("Truncated PNG data.");
      const length = view.getUint32(offset);
      const kind = ascii(bytes, offset + 4, 4);
      if (length > bytes.length - offset - 12) fail("Truncated PNG chunk.");
      if (offset === 8 && kind !== "IHDR") fail("PNG dimensions are missing.");
      if (kind === "IHDR") {
        if (header || length !== 13) fail("Invalid PNG header.");
        header = dimensions(
          view.getUint32(offset + 8),
          view.getUint32(offset + 12),
          "png",
        );
      }
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
        fail("Animated PNG images display side by side without annotations.");
      offset += length + 12;
      if (kind === "IEND") {
        if (length !== 0 || offset !== bytes.length)
          fail("Invalid PNG end marker.");
        ended = true;
        break;
      }
    }
    if (!header || !ended) fail("Incomplete PNG data.");
    return header;
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    if (view.getUint32(4, true) + 8 !== bytes.length)
      fail("Invalid WebP container length.");
    let offset = 12;
    let header: ImageHeader | undefined;
    let image = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) fail("Truncated WebP data.");
      const kind = ascii(bytes, offset, 4);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (length > bytes.length - start) fail("Truncated WebP chunk.");
      if (kind === "ANIM" || kind === "ANMF")
        fail("Animated WebP images display side by side without annotations.");
      if (kind === "VP8X") {
        if (length !== 10) fail("Invalid extended WebP header.");
        if (bytes[start] & 2)
          fail(
            "Animated WebP images display side by side without annotations.",
          );
        const u24 = (p: number) =>
          bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536;
        header = dimensions(1 + u24(start + 4), 1 + u24(start + 7), "webp");
      } else if (kind === "VP8 ") {
        if (length < 10 || ascii(bytes, start + 3, 3) !== "\x9d\x01\x2a")
          fail("Invalid WebP frame.");
        const frame = dimensions(
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
          "webp",
        );
        header ??= frame;
        image = true;
      } else if (kind === "VP8L") {
        if (length < 5 || bytes[start] !== 0x2f)
          fail("Invalid lossless WebP frame.");
        const bits = view.getUint32(start + 1, true);
        const frame = dimensions(
          (bits & 0x3fff) + 1,
          ((bits >>> 14) & 0x3fff) + 1,
          "webp",
        );
        header ??= frame;
        image = true;
      }
      offset = start + length + (length % 2);
      if (offset > bytes.length) fail("Truncated WebP padding.");
    }
    if (!header || !image) fail("WebP dimensions or frame data are missing.");
    return header;
  }
  fail("Image alignment supports static PNG and WebP images only.");
}

/** All differing RGBA pixels mark a tile. Four-connected tile groups form boxes. */
export function comparePixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
): RegionResult {
  dimensions(width, height, "png");
  if (before.length !== width * height * 4 || after.length !== before.length)
    fail("Decoded image dimensions do not match.");
  const columns = Math.ceil(width / TILE_SIZE),
    rows = Math.ceil(height / TILE_SIZE);
  const dirty = new Uint8Array(columns * rows);
  let changedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (
        before[p] !== after[p] ||
        before[p + 1] !== after[p + 1] ||
        before[p + 2] !== after[p + 2] ||
        before[p + 3] !== after[p + 3]
      ) {
        changedPixels++;
        dirty[Math.floor(y / TILE_SIZE) * columns + Math.floor(x / TILE_SIZE)] =
          1;
      }
    }
  }
  const boxes: Region[] = [];
  const queue = new Int32Array(dirty.length);
  for (let tile = 0; tile < dirty.length; tile++) {
    if (!dirty[tile]) continue;
    let head = 0,
      tail = 1;
    queue[0] = tile;
    dirty[tile] = 0;
    let minX = columns,
      minY = rows,
      maxX = 0,
      maxY = 0;
    while (head < tail) {
      const at = queue[head++],
        x = at % columns,
        y = Math.floor(at / columns);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [
        x > 0 ? at - 1 : -1,
        x + 1 < columns ? at + 1 : -1,
        y > 0 ? at - columns : -1,
        y + 1 < rows ? at + columns : -1,
      ];
      for (const next of neighbors)
        if (next >= 0 && dirty[next]) {
          dirty[next] = 0;
          queue[tail++] = next;
        }
    }
    const x = minX * TILE_SIZE,
      y = minY * TILE_SIZE;
    boxes.push({
      x,
      y,
      width: Math.min(width, (maxX + 1) * TILE_SIZE) - x,
      height: Math.min(height, (maxY + 1) * TILE_SIZE) - y,
    });
  }
  return { width, height, changedPixels, boxes };
}
