# Verification evidence

Start with the evidence for the claim you want to inspect:

| Claim | Evidence | Boundary |
| --- | --- | --- |
| Final baseline SDK + Inngest verification | [real-provider-final-baseline-verification.json](real-provider-final-baseline-verification.json) | Latest0.5B baseline, two SDK smoke calls, two events/five steps, matching API/profile, engine end timestamps. Hosted OpenAI untested. |
| Original real-provider trace | [real-provider-verification.json](real-provider-verification.json), [post-preflight0.5B trace](real-provider-preflight-engine-0.5b-verification.json) | Historical successful selected scenarios preserved separately. |
| Real browser-triggered run | [chrome-provider-verification.json](chrome-provider-verification.json), [routine screenshot](real-llm-browser.jpg), [outage screenshot](real-llm-yes.jpg) | Historical 0.5B Chrome evidence; no fresh UI/phone verification inferred. |
| Oversized local input rejected before queue | [context-preflight-verification.json](context-preflight-verification.json) | Actual HTTP400 at 8,059 required tokens against context2,048; history unchanged. |
| Recovery API refuses missing/terminal runs | [recovery-http-verification.json](recovery-http-verification.json) | HTTP404/409 contracts. Process kill/restart recovery separately tested in tests/recovery.test.ts. |
| Actual local Inngest/worker restart and recovery | [LIVE_RECOVERY_VERIFICATION.md](LIVE_RECOVERY_VERIFICATION.md), [retained run](live-inngest-restart-recovery-verification.json) | Five-minute production lease, real wall-clock wait, immutable original, linked40-node Demo retry, terminal engine timestamp. No LLM/browser/hosted test. First aborted probe retained. |
| Decision quality on a frozen synthetic set | [MODEL_EVALUATION.md](MODEL_EVALUATION.md), [fixtures](model-evaluation-fixtures.json), [manifest](model-evaluation-fixture-manifest.json) | 24 AI-drafted labels; human review pending. Wrong answers retained. |
| Experimental1.5B V2 multi-node failure | [real-provider-1.5b-v2-verification.json](real-provider-1.5b-v2-verification.json) | Smoke calls passed, outage path failed; passed:false.20/24 urgency-label agreement did not establish later-node routing. Default remains baseline. |
| Known original classifier failure | [local-model-limitations.json](local-model-limitations.json) | Cosmetic theme request incorrectly urgent; original five probes retained. |
| Demo routing without any LLM | [integration-verification.json](integration-verification.json) | Explicit simulation, actual local Inngest events, openaiCallsMade:false. |
| Tracked-source publication scan | [publish-check.json](publish-check.json) | Credential/private-file checks, not an exhaustive security audit. |

Use npm run verify:integration for Demo routing, npm run verify:provider for configured local-model paths, and npm run eval:model -- run baseline development evidence/model-evaluation-UNIQUE.json for the frozen decision set. Read [LOCAL_LLM.md](../LOCAL_LLM.md) first. The evaluator refuses existing output filenames so previous results are preserved.

Local inference and correct routing do not establish general model accuracy, physical-phone QA, a portal submission, or reviewer approval.
