export const LIMITS = Object.freeze({
  tasks: 8,
  concurrency: 5,
  titleChars: 120,
  inputBytes: 256 * 1024,
  timeoutMs: 20 * 60 * 1000,
  maxTimeoutSeconds: Math.floor(2_147_483_647 / 1000), // Node timers use signed 32-bit milliseconds.
  graceMs: 1500,
  updateMs: 250,
  animationMs: 80,
  answerBytes: 8 * 1024,
  recordBytes: 16 * 1024 * 1024,
  diagnosticChars: 400,
  activityChars: 160,
});
