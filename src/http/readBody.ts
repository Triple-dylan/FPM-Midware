import type { IncomingMessage } from "node:http";

export class BodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
    this.name = "BodyTooLargeError";
  }
}

export async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
): Promise<unknown> {
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

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}
