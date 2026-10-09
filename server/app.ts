import express from "express";
import { serve } from "inngest/express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import { config, isInngestReady } from "./config";
import { inngest, executeWorkflow } from "./inngest";
import { runStore } from "./store";
import { validateGraph } from "../shared/graph";
import type { WorkflowGraph, WorkflowRun, ExecutionMode } from "../shared/types";

const runRequest = z.object({ graph: z.unknown(), input: z.string().trim().min(1).max(12000), mode: z.enum(["demo", "openai"]) });

async function queueRun(graph: WorkflowGraph, input: string, mode: ExecutionMode, retriedFrom?: string) {
  const now = new Date().toISOString();
  const run: WorkflowRun = { id: randomUUID(), graph, input, mode, status: "queued", createdAt: now, updatedAt: now, steps: [], activeNodeId: null, attempts: {}, error: null, ...(retriedFrom ? { retriedFrom } : {}) };
  await runStore.create(run);
  try {
    const result = await inngest.send({ id: run.id, name: "workflow/run.requested", data: { runId: run.id } });
    await runStore.update(run.id, { eventId: result.ids[0] });
    return runStore.get(run.id)!;
  } catch {
    await runStore.update(run.id, { status: "failed", error: "Inngest did not accept the run. Start or check the Inngest server, then retry." });
    throw new Error("Inngest did not accept the run. Start or check the Inngest server, then retry.");
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/status", async (_req, res) => {
    res.json({ ok: true, openaiConfigured: config.openaiConfigured, model: config.model, providerKind: config.providerKind, inngestReady: await isInngestReady(), demoNotice: "Demo decisions use each node's configured YES/NO answer; no LLM is called." });
  });
  app.get("/api/runs", (_req, res) => res.json(runStore.list()));
  app.get("/api/runs/:id", (req, res) => {
    const run = runStore.get(req.params.id);
    if (!run) { res.status(404).json({ error: "Run not found." }); return; }
    res.json(run);
  });
  app.post("/api/runs", async (req, res) => {
    const result = runRequest.safeParse(req.body);
    if (!result.success) { res.status(400).json({ error: "Provide a graph, 1–12,000 characters of input, and a valid execution mode." }); return; }
    const validation = validateGraph(result.data.graph);
    if (!validation.graph) { res.status(400).json({ error: validation.errors.join(" ") }); return; }
    if (result.data.mode === "openai" && !config.openaiConfigured) { res.status(400).json({ error: "Configure a server-side LLM provider first, or use Demo to test the workflow." }); return; }
    if (!await isInngestReady()) { res.status(503).json({ error: "Start the Inngest Dev Server with npm run dev:inngest, then try again." }); return; }
    try { res.status(202).json(await queueRun(validation.graph, result.data.input, result.data.mode)); }
    catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  app.post("/api/runs/:id/retry", async (req, res) => {
    const previous = runStore.get(req.params.id);
    if (!previous) { res.status(404).json({ error: "Run not found." }); return; }
    if (previous.status !== "failed") { res.status(409).json({ error: "Only a failed run can be retried. Start a new run to repeat a completed workflow." }); return; }
    if (!await isInngestReady()) { res.status(503).json({ error: "The Inngest server is unavailable." }); return; }
    try { res.status(202).json(await queueRun(previous.graph, previous.input, previous.mode, previous.id)); }
    catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  app.use("/api/inngest", serve({ client: inngest, functions: [executeWorkflow] }));
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof SyntaxError ? 400 : 500).json({ error: error instanceof SyntaxError ? "Request body must be valid JSON." : "The server could not process this request." });
  });
  return app;
}
