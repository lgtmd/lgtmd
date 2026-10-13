import test from "node:test";
import assert from "node:assert/strict";
import {
  comparePixels,
  inspectImage,
  MAX_PIXELS,
  MAX_ENCODED_BYTES,
} from "../src/regions.ts";

function png(width: number, height: number, animated = false): Uint8Array {
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (name: string, value: Buffer) => {
    const out = Buffer.alloc(value.length + 12);
    out.writeUInt32BE(value.length);
    out.write(name, 4);
    value.copy(out, 8);
    chunks.push(out);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  chunk("IHDR", header);
  if (animated) chunk("acTL", Buffer.alloc(8));
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat(chunks);
}
function webp(animated = false): Uint8Array {
  const extended = Buffer.alloc(18);
  extended.write("VP8X");
  extended.writeUInt32LE(10, 4);
  extended[8] = animated ? 2 : 0;
  const frame = Buffer.alloc(14);
  frame.write("VP8L");
  frame.writeUInt32LE(5, 4);
  frame[8] = 0x2f;
  const head = Buffer.alloc(12);
  head.write("RIFF");
  head.writeUInt32LE(4 + extended.length + frame.length, 4);
  head.write("WEBP", 8);
  return Buffer.concat([head, extended, frame]);
}
test("identical pixels have no boxes but do not determine byte equality", () => {
  const bytes = new Uint8ClampedArray(4 * 17 * 19);
  assert.deepEqual(comparePixels(bytes, bytes, 17, 19), {
    width: 17,
    height: 19,
    changedPixels: 0,
    boxes: [],
  });
});
test("connected tiles merge, disjoint tiles stay separate and edge boxes clamp", () => {
  const width = 65,
    height = 33,
    before = new Uint8ClampedArray(width * height * 4),
    after = before.slice();
  const pixels = [
    [0, 0],
    [16, 0],
    [64, 32],
  ];
  for (const [x, y] of pixels) after[(y * width + x) * 4 + 3] = 255;
  const result = comparePixels(before, after, width, height);
  assert.equal(result.changedPixels, 3);
  assert.deepEqual(result.boxes, [
    { x: 0, y: 0, width: 32, height: 16 },
    { x: 64, y: 32, width: 1, height: 1 },
  ]);
});
test("every changed pixel is covered, including alpha-only and diagonal changes", () => {
  const width = 129,
    height = 97,
    before = new Uint8ClampedArray(width * height * 4),
    after = before.slice();
  let changed = 0;
  for (let p = 0; p < width * height; p++)
    if ((p * 37) % 101 === 0) {
      after[p * 4 + (p % 4)] = 1;
      changed++;
    }
  const result = comparePixels(before, after, width, height);
  assert.equal(result.changedPixels, changed);
  for (let p = 0; p < width * height; p++)
    if ((p * 37) % 101 === 0)
      assert.ok(
        result.boxes.some(
          (b) =>
            p % width >= b.x &&
            p % width < b.x + b.width &&
            Math.floor(p / width) >= b.y &&
            Math.floor(p / width) < b.y + b.height,
        ),
      );
});
test("static headers are read before decode and animated images are rejected", () => {
  assert.deepEqual(inspectImage(png(32, 16)), {
    width: 32,
    height: 16,
    format: "png",
  });
  assert.deepEqual(inspectImage(webp()), {
    width: 1,
    height: 1,
    format: "webp",
  });
  assert.throws(() => inspectImage(png(1, 1, true)), /Animated PNG/);
  assert.throws(() => inspectImage(webp(true)), /Animated WebP/);
});
test("budgets, invalid dimensions, unsupported formats and truncated containers fail", () => {
  assert.throws(() => inspectImage(png(MAX_PIXELS + 1, 1)), /8 million/);
  assert.throws(
    () => inspectImage(new Uint8Array(MAX_ENCODED_BYTES + 1)),
    /32 MiB/,
  );
  assert.throws(() => inspectImage(png(0, 1)), /dimensions/);
  assert.throws(() => inspectImage(Buffer.from("GIF89a")), /PNG and WebP/);
  assert.throws(() => inspectImage(png(2, 2).slice(0, -1)), /Truncated/);
  assert.throws(() => inspectImage(webp().slice(0, -1)), /container length/);
  assert.throws(
    () =>
      comparePixels(new Uint8ClampedArray(3), new Uint8ClampedArray(3), 1, 1),
    /dimensions/,
  );
});
