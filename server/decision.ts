import OpenAI from "openai";
import { config, describeProvider } from "./config";
import { parseDecision } from "./execute";
import { assertDecisionContextBudget, ContextBudgetError } from "./context-budget";
import { buildDecisionRequest, selectPromptVariant } from "./decision-prompt";
import type { Decision, DecisionNode, EvaluatedDecision, ExecutionMode, ExecutionStep } from "../shared/types";

export { buildDecisionInput } from "./decision-prompt";

let client: OpenAI | undefined;
export async function decide(mode: ExecutionMode, node: DecisionNode, input: string, previous: ExecutionStep[]): Promise<Decision | EvaluatedDecision> {
  if (mode === "demo") {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return node.data.demoDecision;
  }
  if (!config.openaiConfigured) throw new Error("LLM provider mode requires a server-side OPENAI_API_KEY.");
  const promptVariant = selectPromptVariant(config.providerKind, config.localPromptVariant);
  await assertDecisionContextBudget(node, input, previous, { promptVariant });
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 20000 });
  const response = await client.responses.create(buildDecisionRequest(node, input, previous, { model: config.model, providerKind: config.providerKind, promptVariant }));
  const decision = parseDecision(response.output_text);
  return { decision, provider: {
    kind: describeProvider(client.baseURL),
    ...(config.providerKind === "local-openai-compatible" ? { promptVariant } : {}),
    model: response.model,
    responseId: response.id,
    outputIds: response.output.map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0),
    rawOutput: response.output_text,
    ...(response.usage ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens } } : {}),
  } };
}

export function safeError(error: unknown): string {
  if (error instanceof ContextBudgetError) return error.message;
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return "The LLM provider rejected the API key. Check the server configuration.";
    if (error.status === 429) return "LLM provider rate or quota limit reached. Wait or check your account, then retry.";
    if (error.status === 404) return "The configured model is unavailable. Check OPENAI_MODEL.";
    return `LLM provider request failed${error.status ? ` (HTTP ${error.status})` : ""}. Please retry.`;
  }
  if (error instanceof Error && (error.message.startsWith("The model must") || error.message.startsWith("LLM provider mode requires"))) return error.message;
  return "The workflow could not finish. Check the Inngest run trace and retry.";
}
