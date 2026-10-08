import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { exampleGraph } from "../shared/graph";

test("API rejects malformed and invalid requests before creating a run", async (context) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string) => fetch(`${base}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const malformed = await post("{invalid}");
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /valid JSON/);
  const emptyInput = await post(JSON.stringify({ graph: exampleGraph, input: " ", mode: "demo" }));
  assert.equal(emptyInput.status, 400);
  const invalidGraph = await post(JSON.stringify({ graph: { ...exampleGraph, entryNodeId: "missing" }, input: "test", mode: "demo" }));
  assert.equal(invalidGraph.status, 400);
  const invalidMode = await post(JSON.stringify({ graph: exampleGraph, input: "test", mode: "pretend-ai" }));
  assert.equal(invalidMode.status, 400);
  const history = await fetch(`${base}/api/runs`);
  assert.deepEqual(await history.json(), []);
  const missing = await fetch(`${base}/api/runs/nonexistent`);
  assert.equal(missing.status, 404);
});
