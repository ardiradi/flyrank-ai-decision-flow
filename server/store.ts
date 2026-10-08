import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { WorkflowRun } from "../shared/types";

const dataDirectory = fileURLToPath(new URL("../.data/", import.meta.url));
const dataFile = path.join(dataDirectory, "runs.json");
const runs = new Map<string, WorkflowRun>();
let writes = Promise.resolve();

export async function initializeStore() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    const data: WorkflowRun[] = JSON.parse(await readFile(dataFile, "utf8"));
    for (const run of data) runs.set(run.id, run);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Run history could not be loaded. Inspect .data/runs.json before restarting.");
  }
}

function persist() {
  const snapshot = JSON.stringify([...runs.values()], null, 2);
  writes = writes.catch(() => {}).then(async () => {
    const temporary = `${dataFile}.tmp`;
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, dataFile);
  });
  return writes;
}

export const runStore = {
  get(id: string) { return runs.get(id); },
  list() { return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100); },
  async create(run: WorkflowRun) {
    const completed = [...runs.values()].filter((item) => item.status === "completed" || item.status === "failed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (runs.size >= 100 && completed.length) runs.delete(completed.shift()!.id);
    runs.set(run.id, structuredClone(run));
    await persist();
    return runStore.get(run.id)!;
  },
  async update(id: string, patch: Partial<WorkflowRun>) {
    const run = runs.get(id);
    if (!run) throw new Error("Run not found.");
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    await persist();
    return run;
  },
};
