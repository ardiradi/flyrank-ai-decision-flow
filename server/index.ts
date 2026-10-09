import { config } from "./config";
import { initializeStore } from "./store";
import { createApp } from "./app";

await initializeStore();
createApp().listen(config.port, config.host, () => {
  console.log(`Branch Studio API: http://${config.host}:${config.port}`);
  console.log(`LLM provider: ${config.openaiConfigured ? `${config.providerKind} / ${config.model}` : "not configured — Demo mode is available"}`);
});
