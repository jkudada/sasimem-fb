/**
 * The export's download (PLAN-SUBSCRIBERS §11, S6), behind Hosting's /x/** rewrite. The
 * link is the credential, as an approval link is: only the org's owner is given it (the
 * exportEverything callable checks), and it works for an hour. A plain download, so the
 * app needs no Storage CORS and the functions no URL-signing role.
 */
import { pipeline } from "node:stream/promises";
import { onRequest } from "firebase-functions/v2/https";
import { bucket } from "../admin.js";
import { lookupExport } from "../store/exports.js";

export interface DownloadRequest {
  readonly method: string;
  readonly path: string;
}

export interface DownloadResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** For a live link: the zip in the default bucket, streamed as the body. */
  readonly file?: string;
}

const HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
} as const;

function page(status: number, heading: string, text: string): DownloadResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#1b1f23}main{max-width:36rem;margin:auto}</style></head>
<body><main><h1>${heading}</h1><p>${text}</p></main></body></html>`;
  return { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }, body };
}

const AGAIN = "Make a new export from Sasimem: Settings, Plan &amp; billing, Export everything.";

export async function handleExportDownload(req: DownloadRequest, deps: { now: () => Date }): Promise<DownloadResponse> {
  const match = /^\/x\/([^/]+)\/?$/.exec(req.path);
  if (req.method !== "GET" && req.method !== "HEAD") return page(405, "This link does not work", AGAIN);
  const found = match === null ? { state: "unknown" as const } : await lookupExport(match[1] ?? "", deps.now());
  switch (found.state) {
    case "unknown": return page(404, "This link does not work", `It may have been replaced by a newer export. ${AGAIN}`);
    case "expired": return page(410, "This link has expired", `Download links last an hour. ${AGAIN}`);
    case "live":
      return {
        status: 200, body: "", file: found.path,
        headers: { ...HEADERS, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${found.filename}"` },
      };
  }
}

export function makeExportDownload(deps: { now: () => Date }) {
  // invoker "public": opened by the browser as a plain download; the link is the credential.
  // Streamed from Storage, so an export of any size fits under Cloud Run's response limit.
  return onRequest({ invoker: "public", maxInstances: 3, timeoutSeconds: 300 }, async (req, res) => {
    const out = await handleExportDownload({ method: req.method, path: req.path }, deps);
    res.status(out.status).set(out.headers);
    if (out.file === undefined || req.method === "HEAD") {
      res.send(out.body);
      return;
    }
    await pipeline(bucket().file(out.file).createReadStream(), res);
  });
}
