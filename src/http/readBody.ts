import type { IncomingMessage } from "node:http";

export class BodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
    this.name = "BodyTooLargeError";
  }
}

/** Full body as UTF-8 (for HMAC over exact bytes Aryeo sent). */
export async function readUtf8Body(
  req: IncomingMessage,
  limitBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limitBytes) {
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function parseJsonFromUtf8(raw: string): unknown {
  const t = raw.trim();
  if (!t) return null;
  return JSON.parse(t) as unknown;
}

export async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
): Promise<unknown> {
  const raw = await readUtf8Body(req, limitBytes);
  return parseJsonFromUtf8(raw);
}
