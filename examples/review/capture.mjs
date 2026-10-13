import sharp from "sharp";

// Playwright captures PNG. Retain its pixels in smaller lossless WebP evidence;
// the pinned encoder versions distinguish this project's capture environment.
export const webpProfile = `sharp-${sharp.versions.sharp}-libwebp-${sharp.versions.webp}-lossless-effort6`;

export async function captureWebp(locator) {
  const png = await locator.screenshot({ type: "png" });
  return sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
}
