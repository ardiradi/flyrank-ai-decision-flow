import { config } from "./config";
import { initializeStore } from "./store";
import { createApp } from "./app";

await initializeStore();
createApp().listen(config.port, config.host, () => {
  console.log(`Branch Studio API: http://${config.host}:${config.port}`);
  console.log(`OpenAI: ${config.openaiConfigured ? "configured" : "not configured — Demo mode is available"}`);
});
