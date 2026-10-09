# Free local LLM on Windows

Run the decision flow with an actual local Qwen model through the existing official OpenAI SDK. This path needs no paid API, account, or hosted API key. The internal execution mode is still `openai` because it selects the SDK provider; the model runs locally and is not hosted OpenAI. **Demo remains a simulation and makes no LLM call.**

Requires Windows x64, Node.js 22.12+, npm, internet for the initial downloads, and enough free RAM for the model, runtime, and development servers. This CPU setup uses one request slot and a 2,048-token context to limit memory. On a machine with about 8 GiB RAM, close unneeded apps yourself if memory is tight; do not disable antivirus or security controls. A 0.5B model can make wrong decisions. Successful inference and branch quality must be checked with the real-provider verifier below.

## 1. Download and verify outside the repository

Use PowerShell. The runtime and model stay in a dedicated temporary folder; no binaries or model weights belong in Git. These downloads are pinned to an official release/model revision. Download about 511 MB total.

```powershell
$ProgressPreference = 'SilentlyContinue'
$localLlmRoot = Join-Path $env:TEMP 'flyrank-local-llm-b11491'
$runtimeDir = Join-Path $localLlmRoot 'runtime'
$modelsDir = Join-Path $localLlmRoot 'models'
New-Item -ItemType Directory -Force -Path $localLlmRoot, $runtimeDir, $modelsDir | Out-Null
$runtimeZip = Join-Path $localLlmRoot 'llama-b11491-bin-win-cpu-x64.zip'
$modelFile = Join-Path $modelsDir 'qwen2.5-0.5b-instruct-q4_k_m.gguf'

Invoke-WebRequest -Uri 'https://github.com/ggml-org/llama.cpp/releases/download/b11491/llama-b11491-bin-win-cpu-x64.zip' -OutFile $runtimeZip
Invoke-WebRequest -Uri 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf' -OutFile $modelFile

if ((Get-Item -LiteralPath $runtimeZip).Length -ne 19482775 -or
    (Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash -ne 'dd73bb6652216f354a8786970cc50f6d90768cde2a6c47321976f7bd5b02447b') {
    throw 'Runtime verification failed. Do not extract or run it.'
}
if ((Get-Item -LiteralPath $modelFile).Length -ne 491400032 -or
    (Get-FileHash -LiteralPath $modelFile -Algorithm SHA256).Hash -ne '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db') {
    throw 'Model verification failed. Do not load it.'
}
Expand-Archive -LiteralPath $runtimeZip -DestinationPath $runtimeDir -Force
```

The runtime is llama.cpp `b11491` (MIT); the model is Qwen2.5-0.5B-Instruct, `Q4_K_M`, revision `9217f5db79a29953eb74d5343926648285ec7e67` (Apache 2.0). Retain their included license files when redistributing. See the [official llama.cpp release](https://github.com/ggml-org/llama.cpp/releases/tag/b11491), [pinned server documentation](https://github.com/ggml-org/llama.cpp/blob/b11491/tools/server/README.md), and [official model repository](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67).

## 2. Start the local model

In the same download terminal, after both verification checks pass:

```powershell
$serverExe = (Get-ChildItem -LiteralPath $runtimeDir -Filter 'llama-server.exe' -Recurse | Select-Object -First 1).FullName
if (-not $serverExe) { throw 'llama-server.exe was not found in the verified archive.' }
& $serverExe -m $modelFile --host 127.0.0.1 --port 8088 --alias qwen2.5-0.5b-instruct --chat-template chatml -c 2048 -np 1 -t 2 -b 128 -ub 128 -ngl 0 --cache-ram 0
```

Leave this terminal running. Wait for the server to report readiness. It listens only on localhost. The pinned server supports `/v1/responses`, which the project's SDK uses. A model endpoint exposing only `/v1/chat/completions` is insufficient for this implementation.

If the server runs out of memory, free RAM manually and retry. If a decision takes longer than the provider's 20-second timeout, inspect CPU load and the server logs. Do not count a failed or timed-out run as verified. Stop this server with Ctrl+C when finished.

## 3. Start Branch Studio and Inngest

In a second PowerShell terminal, set only these current-process environment variables. They override dotenv defaults and apply to the processes launched from this terminal. The commands do not inspect or overwrite your existing `.env`; the app still loads other dotenv settings normally. The placeholder satisfies the SDK/provider's nonempty-key check; it is not a credential.

```powershell
Set-Location -LiteralPath 'C:\Magang FlyRank AI\flyrank-ai-decision-flow'
$env:OPENAI_API_KEY = 'local-no-key-required'
$env:OPENAI_BASE_URL = 'http://127.0.0.1:8088/v1'
$env:OPENAI_MODEL = 'qwen2.5-0.5b-instruct'
npm ci
npm run dev
```

In a third terminal:

```powershell
Set-Location -LiteralPath 'C:\Magang FlyRank AI\flyrank-ai-decision-flow'
npm run dev:inngest
```

Open [Branch Studio](http://127.0.0.1:5174), choose **LLM provider**, confirm the local-model caption, and run a scenario. Each visited node sends its question, scenario, and previous decisions to the local model. The provider accepts only `YES` or `NO`; invalid output fails the run rather than choosing a branch. The run details can show retained model-response evidence. Restart the API after changing these variables. Keep `OPENAI_BASE_URL` and the placeholder together; never send a real hosted key to this local endpoint.

The production prompt includes two balanced generic examples: a blue item answers YES to "Is the item blue?"; a red item answers NO. It then sends the actual question, scenario, and prior decisions, retaining the original system instructions and strict parser. Only the local provider uses `temperature: 0`. The explicit `chatml` template alone did not resolve early JSON-input/system-instruction failures.

For a persistent local configuration, use the three local values documented in `.env.example` in your own server-only `.env`. Preserve any existing values deliberately; do not copy the template over an existing `.env`. Closing the second terminal removes its temporary overrides for future terminals. Local model inference uses no paid service; Inngest here is its local Dev Server.

## 4. Verify actual inference

`npm run verify:integration` tests **Demo only**. It proves workflow execution through Inngest, not model inference. `npm run verify:provider` uses the production SDK provider for two direct smoke calls, then sends two actual Inngest events and checks five visited nodes across the YES and NO paths. It sets opposing Demo answers to confirm they do not determine real-provider results. The verifier requires this local model, a loopback `OPENAI_BASE_URL`, and local Inngest; it refuses hosted providers.

Keep the three servers running and launch it from another terminal configured with the same three local environment values:

```powershell
Set-Location -LiteralPath 'C:\Magang FlyRank AI\flyrank-ai-decision-flow'
$env:OPENAI_API_KEY = 'local-no-key-required'
$env:OPENAI_BASE_URL = 'http://127.0.0.1:8088/v1'
$env:OPENAI_MODEL = 'qwen2.5-0.5b-instruct'
npm run verify:provider
```

The command writes [evidence/real-provider-verification.json](evidence/real-provider-verification.json), including failures. Success requires exit code 0 and `passed: true`, two distinct Inngest event IDs, two production SDK smoke calls, and five distinct workflow response IDs. Review the model, raw YES/NO output, output IDs, token usage, and visited order: `urgency → specialist → escalate` for the outage; `urgency → self-service` for the routine request. Keep local-Qwen evidence distinct from hosted-OpenAI evidence.

**Selected-scenario end-to-end verification passed on 9 October 2026 at 06:20:42.630 UTC.** [Recorded evidence](evidence/real-provider-verification.json) reports `passed: true`: two production `decide()` SDK smoke calls returned YES and NO; two real Inngest events completed five distinct model-response steps. The outage followed `urgency:YES → specialist:YES → escalate:YES`; the routine request followed `urgency:NO → self-service:YES`, with opposing Demo answers. Each visited step retains its response ID, output IDs, model, raw output, and token usage. This verifies local-Qwen SDK compatibility and routing for those two scenarios. Hosted OpenAI was not tested.

Separate SDK probes produced the expected outage YES, negated routine NO, specialist YES, and documentation YES. A cosmetic preference ticket incorrectly returned YES to the urgency question. [evidence/local-model-limitations.json](evidence/local-model-limitations.json) retains all five probes, including that failure. These selected examples are a small demonstration of classification behavior, not an accuracy benchmark, and do not establish reliable classification on arbitrary tickets.
