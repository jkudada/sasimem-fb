/** A PNG's size from its header (IHDR follows the 8-byte signature). */
export const pngSize = (png: Buffer): { width: number; height: number } => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** The size that fits inside box × box, keeping the shape. */
export function fitInside(png: Buffer, boxW: number, boxH: number): { w: number; h: number } {
  const { width, height } = pngSize(png);
  const scale = Math.min(boxW / width, boxH / height);
  return { w: width * scale, h: height * scale };
}
