import { readdirSync, readFileSync } from "node:fs";

interface ProcessIdentity { pid: number; parent: number; group: number; start: string }
function identity(pid: number): ProcessIdentity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, parent: Number(fields[1]), group: Number(fields[2]), start: fields[19]! };
  } catch { return undefined; }
}

/** Linux descendants can create their own process groups (pi's bash tool does). */
export class ProcessTree {
  private root: number;
  private known = new Map<number, ProcessIdentity>();
  constructor(pid: number) {
    this.root = pid;
    const item = identity(pid);
    if (item) this.known.set(pid, item);
  }
  refresh(): void {
    const all: ProcessIdentity[] = [];
    try {
      for (const name of readdirSync("/proc")) {
        if (!/^\d+$/.test(name)) continue;
        const item = identity(Number(name));
        if (item) all.push(item);
      }
    } catch { return; }
    const current = new Map(all.map(item => [item.pid, item.start]));
    for (const [pid, item] of this.known) if (current.get(pid) !== item.start) this.known.delete(pid);
    const parents = new Set<number>();
    for (const item of all) if (this.known.get(item.pid)?.start === item.start) parents.add(item.pid);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of all) if (parents.has(item.parent) && !parents.has(item.pid)) {
        parents.add(item.pid);
        this.known.set(item.pid, item);
        changed = true;
      }
    }
  }
  signal(signal: NodeJS.Signals): void {
    this.refresh();
    // Only signal a group still owned by a known identity, not a recycled PGID.
    const ownGroup = [...this.known.values()].some(item => {
      const current = identity(item.pid);
      return current?.start === item.start && current.group === this.root;
    });
    if (ownGroup) {
      try { process.kill(-this.root, signal); } catch { /* Process group already gone. */ }
    }
    // Signal known detached descendants too; validate start time against PID reuse.
    for (const item of [...this.known.values()].reverse()) {
      if (identity(item.pid)?.start !== item.start) continue;
      try { process.kill(item.pid, signal); } catch { /* Already exited. */ }
    }
  }
}
