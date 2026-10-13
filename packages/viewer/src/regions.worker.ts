import {
  comparePixels,
  inspectImage,
  MAX_ENCODED_BYTES,
  type ImageHeader,
} from "./regions.ts";

async function boundedImage(
  url: string,
): Promise<{ bytes: Uint8Array; header: ImageHeader }> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok || !response.body)
    throw new Error("Image data is unavailable.");
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ENCODED_BYTES)
    throw new Error(
      "Image alignment supports at most 32 MiB of encoded data per image.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ENCODED_BYTES)
        throw new Error(
          "Image alignment supports at most 32 MiB of encoded data per image.",
        );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, header: inspectImage(bytes) };
}

async function decode(
  bytes: Uint8Array,
  header: ImageHeader,
): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>]),
    { premultiplyAlpha: "none", colorSpaceConversion: "none" },
  );
  try {
    if (bitmap.width !== header.width || bitmap.height !== header.height)
      throw new Error("Decoded dimensions differ from the image header.");
    const canvas = new OffscreenCanvas(header.width, header.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("This browser cannot read image pixels for annotations.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, header.width, header.height).data;
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (
  event: MessageEvent<{ before: string; after: string; analyze?: boolean }>,
) => {
  try {
    if (
      event.data.analyze !== false &&
      (typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap === "undefined")
    )
      throw new Error("This browser does not support worker image analysis.");
    const [before, after] = await Promise.all([
      boundedImage(event.data.before),
      boundedImage(event.data.after),
    ]);
    if (
      before.header.width !== after.header.width ||
      before.header.height !== after.header.height
    )
      throw new Error(
        "Different image dimensions cannot be aligned. Showing side by side without annotations.",
      );
    const size = { width: before.header.width, height: before.header.height };
    if (event.data.analyze === false) {
      self.postMessage({ ok: true, size });
      return;
    }
    const first = await decode(before.bytes, before.header);
    const second = await decode(after.bytes, after.header);
    self.postMessage({
      ok: true,
      size,
      result: comparePixels(
        first,
        second,
        before.header.width,
        before.header.height,
      ),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Image decoding failed. Showing side by side.",
    });
  }
};
