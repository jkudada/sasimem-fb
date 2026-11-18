/**
 * A picked logo over 200 KB, made smaller in the browser before it is uploaded: at most
 * 400 px on its longer side, which is the most the PDF or the email ever shows, so the
 * Storage rules' 200 KB cap and the server's own resizing stay as they are.
 */
import { MAX_LOGO_BYTES } from "@sasimem/core";
import { LOGO_PX } from "./layout.js";

const UNREADABLE = "That picture could not be opened. Try saving it as a PNG or JPEG first.";
const STILL_TOO_BIG = "That picture is still over 200 KB when made smaller. Try a simpler picture.";

/** What to try, smallest last: a JPEG stays a JPEG; anything else keeps its transparency. */
const ATTEMPTS: Record<string, readonly (readonly [type: string, quality?: number])[]> = {
  "image/jpeg": [["image/jpeg", 0.9], ["image/jpeg", 0.75], ["image/jpeg", 0.6]],
  other: [["image/png"], ["image/webp", 0.9], ["image/webp", 0.75]],
};
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The size a picture is drawn at: its own if it is small enough, else scaled to fit LOGO_PX. */
export function fitLogo(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LOGO_PX / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Throws an Error whose message is for the landlord. */
export async function shrinkLogo(file: File): Promise<File> {
  const picture = await createImageBitmap(file).catch(() => null);
  if (picture === null) throw new Error(UNREADABLE);
  const size = fitLogo(picture.width, picture.height);
  const canvas = Object.assign(document.createElement("canvas"), size);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error(UNREADABLE);
  ctx.drawImage(picture, 0, 0, size.width, size.height);
  picture.close();

  for (const [type, quality] of ATTEMPTS[file.type === "image/jpeg" ? "image/jpeg" : "other"] ?? []) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // A browser that cannot write WebP writes a PNG instead: skip it rather than mislabel it.
    if (blob === null || blob.type !== type || blob.size > MAX_LOGO_BYTES) continue;
    const name = `${file.name.replace(/\.[^.]*$/, "") || "logo"}.${EXTENSION[type]}`;
    return new File([blob], name, { type });
  }
  throw new Error(STILL_TOO_BIG);
}
