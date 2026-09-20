import { stripVTControlCharacters } from "node:util";

/** Child text is data, never terminal control sequences. */
export function safeText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}
export function oneLine(text: string, max: number): string {
  return safeText(text).replace(/\s+/g, " ").slice(0, max);
}
export function utf8Head(text: string, bytes: number): string {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  let end = Math.max(0, bytes);
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}
