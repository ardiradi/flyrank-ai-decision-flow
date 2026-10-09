import { config, describeProvider } from "./config";
import { buildDecisionRequest, DECISION_OUTPUT_TOKENS, selectPromptVariant, type PriorDecision } from "./decision-prompt";
import { parseGraph } from "../shared/graph";
import type { DecisionNode, ExecutionMode, LocalPromptVariant, ProviderKind, WorkflowGraph } from "../shared/types";

export { buildDecisionInput, DECISION_INSTRUCTIONS, DECISION_OUTPUT_TOKENS } from "./decision-prompt";
// Leave room for endpoint/template differences rather than silently shifting context.
export const CONTEXT_SAFETY_TOKENS = 32;

export class ContextBudgetError extends Error {
  constructor(message: string, public readonly status: 400 | 503) {
    super(message);
    this.name = "ContextBudgetError";
  }
}

export interface ContextBudgetOptions {
  providerKind?: ProviderKind;
  baseURL?: string;
  contextTokens?: number;
  promptVariant?: LocalPromptVariant;
  fetch?: typeof fetch;
}

interface LocalBudget {
  contextTokens: number;
  promptVariant: LocalPromptVariant;
  request: (endpoint: string, body?: unknown) => Promise<Record<string, unknown>>;
}

async function localBudget(options: ContextBudgetOptions): Promise<LocalBudget> {
  const configured = options.contextTokens ?? config.localContextTokens;
  if (!Number.isSafeInteger(configured) || configured <= DECISION_OUTPUT_TOKENS + CONTEXT_SAFETY_TOKENS) {
    throw new ContextBudgetError("LOCAL_LLM_CONTEXT_TOKENS must be an integer greater than 48 matching the local model server's context capacity.", 400);
  }
  let serverURL: URL;
  try {
    serverURL = new URL(options.baseURL ?? process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:8088/v1");
    if (describeProvider(serverURL.href) !== "local-openai-compatible" || !["http:", "https:"].includes(serverURL.protocol)) throw new Error();
    // llama.cpp's native endpoints sit beside its /v1 SDK routes.
    serverURL.pathname = `${serverURL.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/`;
    serverURL.search = "";
    serverURL.hash = "";
  } catch {
    throw new ContextBudgetError("The local provider needs a valid loopback OPENAI_BASE_URL ending in /v1.", 400);
  }
  const fetcher = options.fetch ?? fetch;
  const request = async (endpoint: string, body?: unknown): Promise<Record<string, unknown>> => {
    try {
      const response = await fetcher(new URL(endpoint, serverURL), {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new ContextBudgetError("The local model context could not be checked. Start the documented llama.cpp server and check its /props, /apply-template, and /tokenize endpoints, then retry. No inference request was sent and no input was trimmed.", 503);
    }
  };
  const props = await request("props");
  const actual = (props.default_generation_settings as { n_ctx?: unknown } | undefined)?.n_ctx;
  if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual <= DECISION_OUTPUT_TOKENS + CONTEXT_SAFETY_TOKENS) {
    throw new ContextBudgetError("The local model did not report a usable context capacity at /props. Check the documented llama.cpp setup, then retry.", 503);
  }
  // A larger configured value must never bypass the server's actual slot capacity.
  return { contextTokens: Math.min(configured, actual), promptVariant: selectPromptVariant(options.providerKind ?? config.providerKind, options.promptVariant ?? config.localPromptVariant), request };
}

async function checkDecision(budget: LocalBudget, node: DecisionNode, input: string, previous: PriorDecision[]) {
  const payload = buildDecisionRequest(node, input, previous, { model: config.model, providerKind: "local-openai-compatible", promptVariant: budget.promptVariant });
  const formatted = await budget.request("apply-template", {
    messages: [{ role: "system", content: payload.instructions }, { role: "user", content: payload.input }],
    add_generation_prompt: true,
  });
  if (typeof formatted.prompt !== "string" || !formatted.prompt.length) {
    throw new ContextBudgetError("The local model returned no chat template for context checking. Check /apply-template, then retry.", 503);
  }
  const tokenized = await budget.request("tokenize", { content: formatted.prompt, add_special: true, parse_special: true, with_pieces: false });
  const tokens = tokenized.tokens;
  if (!Array.isArray(tokens) || !tokens.length || !tokens.every((token) => typeof token === "number" && Number.isSafeInteger(token) && token >= 0)) {
    throw new ContextBudgetError("The local model returned invalid tokenizer data. Check /tokenize, then retry.", 503);
  }
  const required = tokens.length + DECISION_OUTPUT_TOKENS + CONTEXT_SAFETY_TOKENS;
  if (required > budget.contextTokens) {
    throw new ContextBudgetError(`Decision "${node.data.title}" needs ${required} tokens including its answer reserve, exceeding the ${budget.contextTokens}-token local context. Shorten the workflow input or decision questions, or deliberately increase both the server context and LOCAL_LLM_CONTEXT_TOKENS. No input was trimmed.`, 400);
  }
}

/** Check the exact question + current prior decisions before sending an inference request. */
export async function assertDecisionContextBudget(node: DecisionNode, input: string, previous: PriorDecision[], options: ContextBudgetOptions = {}): Promise<void> {
  if ((options.providerKind ?? config.providerKind) !== "local-openai-compatible") return;
  await checkDecision(await localBudget(options), node, input, previous);
}

/** Conservative graph preflight, called before creating or queuing a real local-model run. */
export async function preflightContextBudget(graphValue: WorkflowGraph, input: string, mode: ExecutionMode, options: ContextBudgetOptions = {}): Promise<void> {
  if (mode === "demo" || (options.providerKind ?? config.providerKind) !== "local-openai-compatible") return;
  const graph = parseGraph(graphValue);
  const budget = await localBudget(options);
  for (const node of graph.nodes) {
    const ancestorIds = new Set<string>();
    const collect = (id: string) => {
      for (const edge of graph.edges.filter((item) => item.target === id)) {
        if (ancestorIds.has(edge.source)) continue;
        ancestorIds.add(edge.source);
        collect(edge.source);
      }
    };
    collect(node.id);
    // Include both answer variants of every possible ancestor. This deliberately
    // over-budgets mutually exclusive branches without enumerating exponential paths.
    const envelope: PriorDecision[] = graph.nodes.filter((item) => ancestorIds.has(item.id)).flatMap((item) => [
      { title: item.data.title, decision: "YES" as const },
      { title: item.data.title, decision: "NO" as const },
    ]);
    await checkDecision(budget, node, input, envelope);
  }
}
