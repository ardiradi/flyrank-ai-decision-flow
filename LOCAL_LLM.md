# Free local LLM on Windows

Run the decision flow with an actual local Qwen model through the existing official OpenAI SDK. This path needs no paid API, account, or hosted API key. The internal execution mode is still `openai` because it selects the SDK provider; the model runs locally and is not hosted OpenAI. **Demo remains a simulation and makes no LLM call.**

Requires Windows x64, Node.js 22.12+, npm, internet for the initial downloads, and enough free RAM for the model, runtime, and development servers. This CPU setup uses one request slot and a 2,048-token context to limit memory. On a machine with about 8 GiB RAM, close unneeded apps yourself if memory is tight; do not disable antivirus or security controls. A 0.5B model can make wrong decisions. Successful inference and branch quality must be checked with the real-provider verifier below.

### Context capacity protection

Real local-model runs check their token budget before the API creates or queues a run, and check it again before each actual decision. The server renders the production system/user messages through llama.cpp's `/apply-template`, then counts that rendered prompt through the loaded model's `/tokenize` endpoint, including special tokens and the assistant prefix. It reserves **16 output tokens plus 32 safety tokens**. Text, including Indonesian, other languages, and emoji, is counted by the model tokenizer rather than a character-to-token estimate. Input is never silently shortened.

`LOCAL_LLM_CONTEXT_TOKENS` defaults to **2048**. The effective limit is the smaller of that configured value and the actual slot capacity reported by `/props` (`default_generation_settings.n_ctx`). If you deliberately change the model server's `-c` setting, set this server-only environment variable to match and restart the API; setting it higher cannot bypass a smaller real server capacity. Unavailable or malformed tokenizer/template/capacity responses fail closed with a clear error; Demo and hosted-provider runs do not call these native local endpoints.

Preflight checks every reachable node with a conservative envelope containing both possible answer records for every ancestor. This avoids exponential path enumeration, but can reject a large graph whose mutually exclusive paths would individually fit. Shorten the input/questions or reduce the graph when that happens. Each actual decision is then checked with its exact prior decision records. This protection prevents sending an oversized checked request; it does not improve the model's classification accuracy.

These endpoints perform formatting/tokenization without generating model answers. See the pinned [llama.cpp native endpoint documentation](https://github.com/ggml-org/llama.cpp/blob/b11491/tools/server/README.md#post-tokenize-tokenize-a-given-text) and [Responses-to-chat conversion](https://github.com/ggml-org/llama.cpp/blob/b11491/tools/server/server-chat.cpp), which maps string `instructions` and `input` to system and user messages.

## Optional 1.5B domain-examples profile

The default `baseline` prompt is preserved, including for hosted providers. A server-only opt-in `LOCAL_LLM_PROMPT_VARIANT=domain-examples-v2` is available for local experiments. On the frozen24-ticket urgency set, the 1.5B V2 profile matched 20 draft labels, with 4 false positives and 0 false negatives; the 0.5B baseline matched 14. The1.5B baseline alone matched 13. Labels remain human-unreviewed. An actual later V2 workflow failed the expected specialist/escalation path, so V2 is not the verified submission profile; the active app was restored to 0.5B baseline. [Full evaluation, wrong answers, and failed workflow](evidence/MODEL_EVALUATION.md).

The following block uses `$modelsDir` and `$serverExe` initialized by sections1–2 below. Complete that verified runtime setup first, stop the prior model server, then replace its weights/alias with this profile. The additional official weights stay in the outside-repository model directory:

```powershell
$modelFile = Join-Path $modelsDir 'qwen2.5-1.5b-instruct-q4_k_m.gguf'
Invoke-WebRequest -Uri 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf' -OutFile $modelFile
if ((Get-Item -LiteralPath $modelFile).Length -ne 1117320736 -or
    (Get-FileHash -LiteralPath $modelFile -Algorithm SHA256).Hash -ne '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e') {
    throw 'Model verification failed. Do not load it.'
}
& $serverExe -m $modelFile --host 127.0.0.1 --port 8088 --alias qwen2.5-1.5b-instruct --chat-template chatml -c 2048 -np 1 -t 2 -b 128 -ub 128 -ngl 0 --cache-ram 0
```

Download size is about1.12GB plus the runtime; allow adequate RAM/disk. Stop the prior model server before starting another on 8088. In the separate API and verifier terminals, set the loopback values from section3, then also set:

```powershell
$env:OPENAI_MODEL = 'qwen2.5-1.5b-instruct'
$env:LOCAL_LLM_PROMPT_VARIANT = 'domain-examples-v2'
```

Restart the API after changing the model/profile. All preflight and per-decision token checks use the selected production payload. Empty-prior first decisions exactly match the frozen V2 evaluation input; later decisions retain the actual prior title/decision records. Provider evidence records the selected profile. To return to the original payload, use `LOCAL_LLM_PROMPT_VARIANT=baseline` and the matching model alias. Hosted providers keep baseline behavior.

Run `npm run verify:provider -- evidence/provider-local-UNIQUE.json` to check actual selected-profile SDK and Inngest paths. Use a new filename: the verifier refuses existing files, and its default creates a timestamped file rather than replacing the original published evidence. Successful model loading and draft-label agreement alone do not establish multi-node routing.

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

The command writes a new timestamped `evidence/real-provider-run-*.json`, including failures. An optional `evidence/*.json` argument chooses a new explicit filename; existing files are refused before any calls. The original [evidence/real-provider-verification.json](evidence/real-provider-verification.json) is preserved as historical evidence. Success requires exit code 0 and `passed:true`, two distinct Inngest event IDs, two production SDK smoke calls, five distinct workflow response IDs, and completed engine runs with non-null end timestamps. Review the model/profile, raw YES/NO output, output IDs, tokens, and visited order. Keep local-Qwen evidence distinct from hosted-OpenAI evidence.

**Selected-scenario end-to-end verification passed on 9 October 2026 at 06:20:42.630 UTC.** [Recorded evidence](evidence/real-provider-verification.json) reports `passed: true`: two production `decide()` SDK smoke calls returned YES and NO; two real Inngest events completed five distinct model-response steps. The outage followed `urgency:YES → specialist:YES → escalate:YES`; the routine request followed `urgency:NO → self-service:YES`, with opposing Demo answers. Each visited step retains its response ID, output IDs, model, raw output, and token usage. This verifies local-Qwen SDK compatibility and routing for those two scenarios. Hosted OpenAI was not tested.

Separate SDK probes produced the expected outage YES, negated routine NO, specialist YES, and documentation YES. A cosmetic preference ticket incorrectly returned YES to the urgency question. [evidence/local-model-limitations.json](evidence/local-model-limitations.json) retains all five probes, including that failure. These selected examples are a small demonstration of classification behavior, not an accuracy benchmark, and do not establish reliable classification on arbitrary tickets.

The [final0.5B baseline verification](evidence/real-provider-final-baseline-verification.json) passed at 19:23 WIB on 9 October after the full36-test update. API and verifier matched model/profile; two SDK smoke calls and five workflow decisions completed, with actual terminal Inngest timestamps. The earlier06:20 trace remains unchanged in its original file. The1.5B V2 experiment's failed later-node path remains in its own evidence file and is not substituted for this passing setup.
