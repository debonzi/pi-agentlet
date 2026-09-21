export const VERSION = "0.86.1";
export const getAgentDir = () => "/test/config";
export const parseArgs = () => ({ messages: [], fileArgs: [], diagnostics: [], unknownFlags: new Map() });
export const Type = {
  Object: (properties, options) => ({ type: "object", properties, ...options }),
  String: options => ({ type: "string", ...options }),
  Integer: options => ({ type: "integer", ...options }),
  Optional: schema => ({ ...schema, optional: true }),
  Array: (items, options) => ({ type: "array", items, ...options }),
};
const widthOf = char => /[\u3000-\u9fff]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1;
export const visibleWidth = text => [...text].reduce((n, char) => n + widthOf(char), 0);
export function truncateToWidth(text, width) {
  let result = "", used = 0;
  for (const char of text) { used += widthOf(char); if (used > width) break; result += char; }
  return result;
}
export function wrapTextWithAnsi(text, width) {
  return text.split("\n").flatMap(line => {
    const lines = []; let current = "";
    for (const char of line) {
      if (visibleWidth(current + char) > width) { lines.push(current); current = ""; }
      current += char;
    }
    lines.push(current); return lines;
  });
}
export async function runChild(_invocation, _task, signal, activity) {
  activity("read fixture.ts");
  return await new Promise(resolve => {
    const done = result => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(result); };
    const abort = () => done({ state: "cancelled", diagnostic: "Cancelled." });
    const timer = setTimeout(() => done({ state: "completed", answer: "No findings." }), 300);
    signal.addEventListener("abort", abort, { once: true });
  });
}
