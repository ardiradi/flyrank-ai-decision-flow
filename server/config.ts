import "dotenv/config";
import { parseLocalPromptVariant } from "./decision-prompt";
import type { ProviderKind } from "../shared/types";

export function describeProvider(baseURL: string): ProviderKind {
  try {
    const host = new URL(baseURL).hostname;
    if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return "local-openai-compatible";
    return host === "api.openai.com" ? "openai" : "openai-compatible";
  } catch { return "openai-compatible"; }
}

process.env.INNGEST_DEV ??= "1";
if (process.env.INNGEST_DEV === "1") process.env.INNGEST_BASE_URL ??= "http://127.0.0.1:8289";
const providerKind = describeProvider(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");

export const config = {
  port: Number(process.env.PORT || 3002),
  host: process.env.HOST || "127.0.0.1",
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  localContextTokens: Number(process.env.LOCAL_LLM_CONTEXT_TOKENS || 2048),
  localPromptVariant: providerKind === "local-openai-compatible" ? parseLocalPromptVariant(process.env.LOCAL_LLM_PROMPT_VARIANT) : "baseline" as const,
  providerKind,
  inngestDev: process.env.INNGEST_DEV === "1",
  inngestUrl: process.env.INNGEST_BASE_URL || "https://api.inngest.com",
};

export async function isInngestReady(): Promise<boolean> {
  if (!config.inngestDev) return Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
  try {
    const response = await fetch(`${config.inngestUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}
