# BE09 submission notes

Repository: [ardiradi/flyrank-ai-decision-flow](https://github.com/ardiradi/flyrank-ai-decision-flow)

## Summary

Branch Studio is a visual AI decision workflow app. React Flow lets users create, connect, drag, and edit prompt nodes with labeled YES/NO branches. An Express API validates an immutable graph snapshot, stores a run, and sends an Inngest event. Each visited node executes in its own durable Inngest step. The OpenAI Responses integration enforces exactly YES or NO, follows the matching edge, and records execution order. A missing matching edge ends the path.

## Additional features

- Active/completed/unvisited node states and animated taken edges.
- Ordered execution trace with answers, durations, attempt counts, and run IDs.
- Local graph save/load and validated JSON import/export.
- Server-persisted history and immutable run snapshots.
- Graph validation: unique IDs, entry point, reachable nodes, no cycles, no ambiguous branch edges.
- Automatic durable retries and a new-run retry action for failed runs.
- Explicit Demo mode for testing without an API key; real OpenAI mode becomes available only when configured on the server.

## Verification performed

- `npm test`: 13 passing tests for branch order, prior context, termination, replay memoization, provider failure, strict output parsing, graph validation, import/export, and API errors.
- `npm run build`: TypeScript checks and Vite production build passed.
- `npm run verify:integration`: two actual Inngest events completed locally. YES path: `urgency → specialist → escalate`. NO path: `urgency → self-service`. Unused branches were skipped.
- `npm audit`: zero reported vulnerabilities after dependency updates.
- Tracked source scanned before publication: no credential patterns or private environment/run-store files found. See `evidence/publish-check.json`.

Evidence is in `evidence/integration-verification.json` and includes the actual event IDs and run snapshots. This verification used **Demo mode**, which chooses the answer configured on each node. **No live OpenAI call was made**, because no API key was available during verification. The OpenAI integration is implemented, but live provider behavior remains to be verified with a valid key.

## Short demo outline

1. Show the graph, entry node, prompt inspector, and YES/NO labels.
2. Add a node and connect one branch; edit its question; delete the extra node to return to the sample.
3. Save and export/import the sample JSON.
4. Run the sample in Demo; show active state, animated path, and ordered results.
5. Set the entry Demo answer to NO; run again and show the alternate path.
6. Show both runs in History and their named steps in the local Inngest dashboard.
7. State that Demo makes no LLM calls; show where server-only OpenAI configuration enables real AI.

## Current limitations

The app is intended for a single local assignment instance. History uses a JSON file store. Public deployment requires authentication, ownership, quotas, and a shared database. Restarting the default in-memory Inngest Dev Server loses engine state, though API run history remains on disk.

The implementation was built with AI assistance. Reviewer-facing claims are limited to the tests and local runs actually completed.
