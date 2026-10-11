import sharp from "sharp";

/** Normalize packed RGB/BGR(A) SDK frames, including row padding. No media storage. */
export async function encodePreview(
  buf: Buffer,
  width: number,
  height: number,
  stride: number,
  format: number,
): Promise<Buffer | null> {
  if (![0, 1, 2, 3].includes(format)) return null;
  const channels = format < 2 ? 3 : 4;
  if (
    ![width, height, stride].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width * height > 8_294_400 ||
    stride < width * channels ||
    stride * height > buf.length
  )
    return null;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = y * stride + x * channels,
        to = (y * width + x) * 3;
      rgb[to] = buf[from + (format === 1 || format === 3 ? 2 : 0)];
      rgb[to + 1] = buf[from + 1];
      rgb[to + 2] = buf[from + (format === 1 || format === 3 ? 0 : 2)];
    }
  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize({ width: 640, withoutEnlargement: true })
    .jpeg({ quality: 65 })
    .toBuffer();
}
