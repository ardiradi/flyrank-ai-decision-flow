import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleGraph } from "../shared/graph";
import { assertDecisionContextBudget, ContextBudgetError, DECISION_INSTRUCTIONS, preflightContextBudget, type ContextBudgetOptions } from "../server/context-budget";

function mockLocal(count: number | ((prompt: string) => number), capacity = 2048) {
  const calls: { endpoint: string; body?: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ endpoint, body });
    if (endpoint === "/props") return Response.json({ default_generation_settings: { n_ctx: capacity } });
    if (endpoint === "/apply-template") {
      const messages = body!.messages as { role: string; content: string }[];
      return Response.json({ prompt: messages.map((item) => `<|im_start|>${item.role}\n${item.content}<|im_end|>\n`).join("") + "<|im_start|>assistant\n" });
    }
    if (endpoint === "/tokenize") return Response.json({ tokens: Array.from({ length: typeof count === "number" ? count : count(String(body!.content)) }, () => 42) });
    throw new Error("Unexpected endpoint");
  };
  const options: ContextBudgetOptions = { providerKind: "local-openai-compatible", baseURL: "http://127.0.0.1:8088/v1", contextTokens: 2048, promptVariant: "baseline", fetch: fetcher };
  return { calls, options };
}
const node = exampleGraph.nodes[0];
const isBudgetError = (status: 400 | 503) => (error: unknown) => error instanceof ContextBudgetError && error.status === status;

test("context boundary includes the complete template, 16 output tokens, and 32 safety tokens", async () => {
  const atBoundary = mockLocal(2000);
  await assertDecisionContextBudget(node, "A routine request", [], atBoundary.options);
  assert.deepEqual(atBoundary.calls.map((item) => item.endpoint), ["/props", "/apply-template", "/tokenize"]);
  const messages = atBoundary.calls[1].body!.messages as { role: string; content: string }[];
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, DECISION_INSTRUCTIONS);
  assert.match(messages[1].content, /WORKFLOW_INPUT: A routine request/);
  assert.match(String(atBoundary.calls[2].body!.content), /<\|im_start\|>assistant/);
  assert.equal(atBoundary.calls[2].body!.add_special, true);
  assert.equal(atBoundary.calls[2].body!.parse_special, true);
  const overBoundary = mockLocal(2001);
  await assert.rejects(assertDecisionContextBudget(node, "A routine request", [], overBoundary.options), (error: unknown) => isBudgetError(400)(error) && /2049 tokens.*2048-token/.test((error as Error).message));
});

test("multilingual input is preserved and accepted/rejected using tokenizer results, not characters", async () => {
  const local = mockLocal((prompt) => prompt.includes("🚨 中文 العربية") ? 53 : 50);
  local.options.contextTokens = 100;
  await assertDecisionContextBudget(node, "plain", [], local.options);
  await assert.rejects(assertDecisionContextBudget(node, "🚨 中文 العربية", [], local.options), isBudgetError(400));
  const tokenizedPrompt = String(local.calls.at(-1)!.body!.content);
  assert.match(tokenizedPrompt, /WORKFLOW_INPUT: 🚨 中文 العربية/);
});

test("preflight checks the reachable NO branch despite opposing configured Demo answers", async () => {
  const local = mockLocal((prompt) => prompt.includes("QUESTION: Can the request be resolved with a documentation link") ? 2001 : 100);
  await assert.rejects(preflightContextBudget(structuredClone(exampleGraph), "Small input", "openai", local.options), (error: unknown) => isBudgetError(400)(error) && /Can docs help/.test((error as Error).message));
});

test("preflight budgets both answer variants of all ancestors, including mutually exclusive paths", async () => {
  const local = mockLocal((prompt) => {
    const match = /PRIOR_DECISIONS: (.*)\nANSWER:/.exec(prompt)!;
    return 30 + 10 * (JSON.parse(match[1]) as unknown[]).length;
  });
  local.options.contextTokens = 120;
  await assert.rejects(preflightContextBudget(structuredClone(exampleGraph), "Small input", "openai", local.options), (error: unknown) => isBudgetError(400)(error) && /Support can resolve/.test((error as Error).message));
  const support = exampleGraph.nodes.find((item) => item.id === "support")!;
  // This actual path fits; conservative preflight deliberately over-budgets alternatives.
  await assertDecisionContextBudget(support, "Small input", [{ title: node.data.title, decision: "NO" }, { title: "Can docs help?", decision: "NO" }], local.options);
});

test("exact decision check includes growing previous context", async () => {
  const local = mockLocal((prompt) => prompt.includes('"title":"Very long previous context"') ? 201 : 100);
  local.options.contextTokens = 248;
  await assertDecisionContextBudget(node, "Small input", [], local.options);
  await assert.rejects(assertDecisionContextBudget(node, "Small input", [{ title: "Very long previous context", decision: "YES" }], local.options), isBudgetError(400));
});

test("actual server capacity caps a larger configured context", async () => {
  const local = mockLocal(81, 128);
  await assert.rejects(assertDecisionContextBudget(node, "Small input", [], local.options), (error: unknown) => isBudgetError(400)(error) && /128-token/.test((error as Error).message));
  local.options.contextTokens = 100;
  await assert.rejects(assertDecisionContextBudget(node, "Small input", [], local.options), (error: unknown) => isBudgetError(400)(error) && /100-token/.test((error as Error).message));
});

test("tokenizer failure fails closed with a useful error and without exposing its response", async () => {
  const local = mockLocal(100);
  const working = local.options.fetch!;
  local.options.fetch = async (url, init) => new URL(String(url)).pathname === "/tokenize" ? new Response("private stack trace", { status: 500 }) : working(url, init);
  await assert.rejects(assertDecisionContextBudget(node, "Private input", [], local.options), (error: unknown) => isBudgetError(503)(error) && /could not be checked/.test((error as Error).message) && !/private stack trace|Private input/.test((error as Error).message));
});

test("malformed tokenizer, template, and capacity data fail closed", async () => {
  for (const [endpoint, payload] of [["/tokenize", { tokens: [1, "2"] }], ["/tokenize", { tokens: [-1] }], ["/apply-template", { prompt: "" }], ["/props", { default_generation_settings: { n_ctx: "2048" } }]] as const) {
    const local = mockLocal(100);
    const working = local.options.fetch!;
    local.options.fetch = async (url, init) => new URL(String(url)).pathname === endpoint ? Response.json(payload) : working(url, init);
    await assert.rejects(assertDecisionContextBudget(node, "Small input", [], local.options), isBudgetError(503));
  }
});

test("invalid local configuration is rejected before any tokenizer request", async () => {
  for (const contextTokens of [NaN, 48, -1, 2048.5]) {
    const local = mockLocal(100);
    await assert.rejects(assertDecisionContextBudget(node, "Small input", [], { ...local.options, contextTokens }), isBudgetError(400));
    assert.equal(local.calls.length, 0);
  }
  const local = mockLocal(100);
  await assert.rejects(assertDecisionContextBudget(node, "Small input", [], { ...local.options, baseURL: "https://api.openai.com/v1" }), isBudgetError(400));
  assert.equal(local.calls.length, 0);
});

test("Demo and hosted provider skip local tokenization entirely", async () => {
  const local = mockLocal(100);
  await preflightContextBudget(structuredClone(exampleGraph), "Small input", "demo", local.options);
  await preflightContextBudget(structuredClone(exampleGraph), "Small input", "openai", { ...local.options, providerKind: "openai" });
  await assertDecisionContextBudget(node, "Small input", [], { ...local.options, providerKind: "openai" });
  assert.equal(local.calls.length, 0);
});
