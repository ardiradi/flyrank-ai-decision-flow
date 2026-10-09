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
- Automatic durable retries and a new-run retry action for failed runs.
- Explicit Demo mode and **LLM provider** mode. The verified free setup runs a pinned local Qwen model through the official OpenAI SDK Responses API; the UI identifies it as a local model.

## Verification performed

- `npm test`: **15 passing tests** for branch order, prior context, termination, replay memoization including provider evidence, provider failure, strict output parsing, graph validation, import/export, and API errors.
- `npm run build`: TypeScript checks and Vite production build passed.
- `npm run verify:integration`: two actual Inngest events completed locally. YES path: `urgency → specialist → escalate`. NO path: `urgency → self-service`. Unused branches were skipped.
- `npm run verify:provider`: on **9 October 2026**, two actual production SDK smoke calls and two actual Inngest events completed using local Qwen2.5-0.5B-Instruct Q4_K_M. Five distinct visited-node model responses followed the YES and NO paths. Demo answers deliberately opposed the model results. Every visited step retained genuine response/output IDs, model, raw strict YES/NO, and token usage.
- Initial dependency audit on 8 October: zero reported vulnerabilities after dependency updates; this update adds no dependency.
- Fresh Chrome-triggered local-model workflow: event `01M4FNA7TKSJ0Z3X3MC6885R3C` completed `urgency:NO → self-service:YES`, retaining two actual model-response IDs. The browser record was checked against the local API; [Chrome evidence](evidence/chrome-provider-verification.json) and unchanged JPEG screenshot bytes are included.
- Final source publication scan is in `evidence/publish-check.json`; credential patterns and private environment/model/runtime/run-store paths are checked before publication.

The original `evidence/integration-verification.json` covers **Demo**, which chooses configured node answers. The new [real-provider evidence](evidence/real-provider-verification.json) proves actual local LLM execution through the OpenAI SDK and Inngest:

| Scenario | Inngest event | Model-selected path |
| --- | --- | --- |
| Payment-service outage | `01M4FN4DYKCEC5X1KAX84989H2` | `urgency:YES → specialist:YES → escalate:YES` |
| Routine documentation request | `01M4FN4H18V6MFTF44XCH7X0K4` | `urgency:NO → self-service:YES` |

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

The app is intended for a single local assignment instance. History uses a JSON file store. Public deployment requires authentication, ownership, quotas, and a shared database. Restarting the default in-memory Inngest Dev Server loses engine state, though API run history remains on disk.

The 0.5B local model can misclassify inputs. A separate cosmetic theme-change request incorrectly returned YES for the urgency question; [all five probes](evidence/local-model-limitations.json) include that failure. The selected workflow verification establishes execution and routing, not general model accuracy. Initial JSON/system-only prompts failed before adopting balanced generic user-payload examples; the strict parser was retained.

The implementation was built with AI assistance. Reviewer-facing claims are limited to the tests and local runs actually completed.
