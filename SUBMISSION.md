# BE09 submission notes

Repository: [ardiradi/flyrank-ai-decision-flow](https://github.com/ardiradi/flyrank-ai-decision-flow)

## Summary

Branch Studio is a visual AI decision workflow app. React Flow lets users create, connect, drag, and edit prompt nodes with labeled YES/NO branches. An Express API validates an immutable graph snapshot, stores a run, and sends an Inngest event. Each visited node executes in its own durable Inngest step. The OpenAI Responses integration enforces exactly YES or NO, follows the matching edge, and records execution order. A missing matching edge ends the path.

## Additional features

- Active/completed/unvisited node states and animated taken edges.
- Ordered execution trace with answers, durations, attempt counts, and run IDs; expandable model-response IDs and raw-answer evidence.
- Local graph save/load and validated JSON import/export.
- Server-persisted history and immutable run snapshots.
- Graph validation: unique IDs, entry point, reachable nodes, no cycles, no ambiguous branch edges.
- Automatic durable retries and a new-run retry action for failed/interrupted runs; explicit stale-run recovery fences old workers while preserving their evidence.
- Explicit Demo mode and **LLM provider** mode. The verified free setup runs a pinned local Qwen model through the official OpenAI SDK Responses API; the UI identifies it as a local model.

## Verification performed

- `npm test`: **36 passing tests**, adding native token budgets, multilingual preservation, fenced recovery, process interruption, and exact production/evaluation prompt contracts to the original coverage. Both sets of 24 request hashes match retained frozen V2/baseline reports.
- `npm run build`: TypeScript checks and Vite production build passed.
- `npm run verify:integration`: two actual Inngest events completed locally. YES path: `urgency → specialist → escalate`. NO path: `urgency → self-service`. Unused branches were skipped.
- `npm run verify:provider`: on **9 October 2026**, two actual production SDK smoke calls and two actual Inngest events completed using local Qwen2.5-0.5B-Instruct Q4_K_M. Five distinct visited-node model responses followed the YES and NO paths. Demo answers deliberately opposed the model results. Every visited step retained genuine response/output IDs, model, raw strict YES/NO, and token usage.
- Initial dependency audit on 8 October: zero reported vulnerabilities after dependency updates; this update adds no dependency.
- Historical Chrome-triggered local-model workflow on 9 October at 13:23:54 WIB: event `01M4FNA7TKSJ0Z3X3MC6885R3C` completed `urgency:NO → self-service:YES`, retaining two actual model-response IDs. The browser record was checked against the local API; [Chrome evidence](evidence/chrome-provider-verification.json) and unchanged JPEG screenshot bytes are included. Fresh browser checks of subsequent recovery and model changes are blocked by Chrome policy loading.
- Final source publication scan is in `evidence/publish-check.json`; credential patterns and private environment/model/runtime/run-store paths are checked before publication.

The original `evidence/integration-verification.json` covers **Demo**, which chooses configured node answers. The original published [real-provider evidence](evidence/real-provider-verification.json) is preserved unchanged and proves actual local LLM execution through the OpenAI SDK and Inngest:

| Scenario | Inngest event | Model-selected path |
| --- | --- | --- |
| Payment-service outage | `01M4FN4DYKCEC5X1KAX84989H2` | `urgency:YES → specialist:YES → escalate:YES` |
| Routine documentation request | `01M4FN4H18V6MFTF44XCH7X0K4` | `urgency:NO → self-service:YES` |

After integrating context preflight and restarting the API, [a separate 0.5B run](evidence/real-provider-preflight-engine-0.5b-verification.json) completed SDK YES/NO smoke calls and five actual model decisions. Inngest's `/v1/events/{eventId}/runs` independently reported both engine runs `Completed`. Event IDs are `01M4G7NXC9ZBJ4PMZ24S6AC6DB` and `01M4G7P06NR88Y0XZMF40N0EJB`; the earlier table remains historical evidence.

The [final baseline verifier](evidence/real-provider-final-baseline-verification.json) passed on 9 October at 19:23 WIB after all prompt-profile/runtime changes. It used0.5B baseline, two direct SDK calls and five distinct model decisions across events `01M4G9WBFEK9R09FBWBBTYGBBK` and `01M4G9WEG8WT8D248MS63P87J9`. Both engine runs had real terminal timestamps. The active app was restored to this configuration after the experimental1.5B V2 path failure.

The runtime and model were downloaded from official pinned sources, verified against published SHA256 values, and stored outside the repository. [LOCAL_LLM.md](LOCAL_LLM.md) documents the reproducible free setup. No paid provider/account was used; hosted OpenAI remains untested.

## Short demo outline

1. Show the graph, entry node, prompt inspector, and YES/NO labels.
2. Add a node and connect one branch; edit its question; delete the extra node to return to the sample.
3. Save and export/import the sample JSON.
4. Run the sample in Demo; show active state, animated path, and ordered results.
5. Set the entry Demo answer to NO; run again and show the alternate path.
6. Show both runs in History and their named steps in the local Inngest dashboard.
7. Switch to **LLM provider**, confirm the local-model caption, inspect both real-provider History entries, and expand **Model response evidence**. Show their actual Inngest events.

## Current limitations

The app is intended for a single local assignment instance. History uses a JSON file store. Public deployment requires authentication, ownership, quotas, and a shared database. Restarting the default in-memory Inngest Dev Server loses engine state, though API run history remains on disk. Expired active runs now offer explicit recovery to a separate linked retry, with preserved original evidence. Healthy worker leases are not interrupted automatically.

Actual API preflight rejected an 11,050-character synthetic input needing8,059 tokens before queueing against local2,048-token context; history was unchanged. Prompt formatting/tokenization uses the loaded server's native endpoints, and no text is silently trimmed. See [context evidence](evidence/context-preflight-verification.json) and [recovery HTTP contracts](evidence/recovery-http-verification.json).

A [live isolated Inngest restart verification](evidence/LIVE_RECOVERY_VERIFICATION.md) passed: the API and engine were abruptly stopped after a completed Demo step and an active lease, restarted with unchanged stored history, and waited 295,589 real milliseconds to the persisted lease expiry. Early recovery returned 409; eligible recovery returned 202 and completed a separate linked40-node retry while preserving the interrupted original. The new engine had both Completed status and a real end timestamp. This is an actual local Demo restart test, not a browser, hosted-engine, or LLM test; the first aborted probe is retained too.

A [24-case exploratory evaluation](evidence/MODEL_EVALUATION.md) preserves all baseline and candidate predictions. The0.5B baseline matched 14 draft labels. A1.5B V2 profile matched 20 urgency labels but failed an actual later-node outage path; that profile is opt-in experimental and was not promoted. The original baseline remains default and hosted prompts are unchanged. Human label review is pending; these results are not general accuracy claims.

The 0.5B local model can misclassify inputs. A separate cosmetic theme-change request incorrectly returned YES for the urgency question; [all five probes](evidence/local-model-limitations.json) include that failure. The selected workflow verification establishes execution and routing, not general model accuracy. Initial JSON/system-only prompts failed before adopting balanced generic user-payload examples; the strict parser was retained.

The implementation was built with AI assistance. Reviewer-facing claims are limited to the tests and local runs actually completed.
