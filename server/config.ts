import "dotenv/config";

process.env.INNGEST_DEV ??= "1";
if (process.env.INNGEST_DEV === "1") process.env.INNGEST_BASE_URL ??= "http://127.0.0.1:8289";

export const config = {
  port: Number(process.env.PORT || 3002),
  host: process.env.HOST || "127.0.0.1",
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
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
