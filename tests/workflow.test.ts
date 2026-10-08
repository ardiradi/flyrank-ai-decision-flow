import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleGraph, parseGraph, validateGraph } from "../shared/graph";
import { executeGraph, parseDecision } from "../server/execute";
import type { Decision, WorkflowGraph } from "../shared/types";

const directStep = async <T>(_id: string, work: () => Promise<T>) => work();
const copy = () => structuredClone(exampleGraph);

test("YES follows only the selected path in execution order", async () => {
  const visited: string[] = [];
  const steps = await executeGraph(copy(), "outage", async (node) => { visited.push(node.id); return "YES"; }, directStep);
  assert.deepEqual(visited, ["urgency", "specialist", "escalate"]);
  assert.deepEqual(steps.map((step) => step.nextNodeId), ["specialist", "escalate", null]);
});
test("NO follows the alternate branch and preserves prior decisions", async () => {
  const choices: Record<string, Decision> = { urgency: "NO", "self-service": "NO", support: "YES" };
  const contexts: string[][] = [];
  const steps = await executeGraph(copy(), "how to", async (node, input, previous) => { assert.equal(input, "how to"); contexts.push(previous.map((item) => item.nodeId)); return choices[node.id]; }, directStep);
  assert.deepEqual(steps.map((step) => step.nodeId), ["urgency", "self-service", "support"]);
  assert.deepEqual(contexts, [[], ["urgency"], ["urgency", "self-service"]]);
});
test("a decision without an outgoing edge finishes normally", async () => {
  const steps = await executeGraph(copy(), "question", async (node) => node.id === "urgency" ? "NO" : "YES", directStep);
  assert.deepEqual(steps.map((step) => step.nodeId), ["urgency", "self-service"]);
  assert.equal(steps.at(-1)?.nextNodeId, null);
});
test("memoized durable steps are not called again on replay", async () => {
  const cache = new Map<string, unknown>();
  let calls = 0;
  const cachedStep = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
    if (!cache.has(id)) cache.set(id, await work());
    return cache.get(id) as T;
  };
  const decide = async () => { calls++; return "YES" as const; };
  const first = await executeGraph(copy(), "outage", decide, cachedStep);
  const replay = await executeGraph(copy(), "outage", decide, cachedStep);
  assert.equal(calls, 3);
  assert.deepEqual(replay, first);
});
test("provider failure stops the path before a downstream node", async () => {
  const called: string[] = [];
  await assert.rejects(executeGraph(copy(), "outage", async (node) => { called.push(node.id); if (node.id === "specialist") throw new Error("provider unavailable"); return "YES"; }, directStep), /provider unavailable/);
  assert.deepEqual(called, ["urgency", "specialist"]);
});
test("invalid model output never selects a branch", async () => {
  const visited: string[] = [];
  await assert.rejects(executeGraph(copy(), "outage", async (node) => { visited.push(node.id); return "YES, because urgent" as Decision; }, directStep), /exactly YES or NO/);
  assert.deepEqual(visited, ["urgency"]);
  assert.equal(parseDecision(" YES\n"), "YES");
  for (const output of ["yes", "NO.", "", "YES\nNO"]) assert.throws(() => parseDecision(output));
});
test("cycles, including disconnected cycles, are rejected", () => {
  const graph = copy(); graph.edges.push({ id: "cycle", source: "escalate", target: "urgency", sourceHandle: "YES" });
  assert.match(validateGraph(graph).errors.join(" "), /Cycles/);
});
test("ambiguous YES branches are rejected", () => {
  const graph = copy(); graph.edges.push({ id: "duplicate", source: "urgency", target: "support", sourceHandle: "YES" });
  assert.match(validateGraph(graph).errors.join(" "), /more than one YES/);
});
test("dangling references and missing entry nodes are rejected", () => {
  const graph = copy(); graph.edges[0].target = "missing"; graph.entryNodeId = "unknown";
  const errors = validateGraph(graph).errors.join(" ");
  assert.match(errors, /missing node/); assert.match(errors, /entry point/);
});
test("unreachable nodes require a connection before execution", () => {
  const graph = copy(); graph.edges = graph.edges.filter((edge) => edge.target !== "escalate");
  assert.match(validateGraph(graph).errors.join(" "), /Unreachable: Escalation ready/);
});
test("JSON round trip keeps graph semantics and strips presentation fields", () => {
  const graph = copy() as WorkflowGraph;
  (graph.nodes[0] as unknown as Record<string, unknown>).selected = true;
  const result = parseGraph(JSON.parse(JSON.stringify(graph)));
  assert.equal("selected" in result.nodes[0], false);
  assert.deepEqual(result.edges, graph.edges);
});
test("empty prompts, duplicate IDs and oversized graphs are rejected", () => {
  const graph = copy(); graph.nodes[0].data.prompt = " ";
  assert.match(validateGraph(graph).errors.join(" "), /prompt/);
  const duplicate = copy(); duplicate.nodes[1].id = duplicate.nodes[0].id;
  assert.match(validateGraph(duplicate).errors.join(" "), /unique ID/);
  const oversized = copy(); oversized.nodes = Array.from({ length: 51 }, (_, index) => ({ ...oversized.nodes[0], id: `n${index}` }));
  assert.equal(validateGraph(oversized).graph, undefined);
});
