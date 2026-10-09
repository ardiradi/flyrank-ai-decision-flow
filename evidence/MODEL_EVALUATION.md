# Exploratory local-model evaluation

24 synthetic tickets were frozen before predictions:16 development and 8 held-out, balanced YES/NO within each split. Fixture SHA256 is d7e2e2d65f3582451019d47fb78981e488462106bf0cb3d5542f287551e06a6e. Labels were drafted by AI with written rationales; human review is pending. These are agreement measurements against draft labels, not validated production accuracy. The same author knew both splits, so this is not an independent blind benchmark.

| Local 0.5B prompt | Development agreement | Held-out agreement | Decision |
| --- | --- | --- | --- |
| Frozen production baseline | 10/16 | 4/8 | Current prompt retained. Overall 14/24;10 false positives. |
| Generic negation/quotation wrapper (V1) | 8/16 | Not run | Rejected after development results. |
| Domain examples wrapper (V2) | 7/16 | 3/8 | Rejected. Overall 10/24;12 false positives and 2 false negatives. |

V1's exact source is in model-evaluation-candidate-v1-prompt.json. V2 source, fixture hash, and hashes of all development reports were frozen in model-evaluation-candidate-freeze.json before either original held-out report was produced. Both worse0.5B wrappers were rejected for that model; the baseline remains the default.

| Local 1.5B configuration | Development agreement | Held-out agreement | Result |
| --- | --- | --- | --- |
| Same frozen production baseline | 9/16 | 4/8 | Overall 13/24,11 false negatives; larger weights alone did not improve this payload. |
| Same previously frozen V2 domain examples | 13/16 | 7/8 | Overall 20/24,4 false positives,0 false negatives on these draft labels; prepared as an opt-in experiment. |

The official1.5B Q4_K_M weights are pinned and whole-file SHA256 verified; see [provenance](model-1.5b-provenance.json). Both1.5B development reports were frozen in [model-evaluation-1.5b-development-freeze.json](model-evaluation-1.5b-development-freeze.json) before either1.5B held-out run. The V2 prompt itself was unchanged from the earlier freeze. The author had already seen0.5B held-out results and authored both splits, so the larger-model comparison is exploratory rather than an independently blinded model-selection study.

The four1.5B V2 false positives are dev-10 (negated incident), dev-11 (quoted keywords), dev-15 (resolved incident), and hold-05 (routine profile-picture instructions). None is removed from the denominator.20/24 is agreement with human-unreviewed draft labels, not83% validated production accuracy.

The later actual production SDK/Inngest V2 probe failed: direct smoke answers were YES and NO, but the outage followed `urgency → specialist → support` instead of `urgency → specialist → escalate`. The completed run and its terminal engine timestamp are in [real-provider-1.5b-v2-verification.json](real-provider-1.5b-v2-verification.json), whose `passed` is false. The verifier stopped before the routine workflow, so no routine multi-node pass is claimed for V2. The urgency-only comparison did not cover later-node classification. This profile remains opt-in experimental and was not promoted as the submission configuration; the active app was restored to the 0.5B baseline. No further prompt tuning used this failure or the held-out labels.

The evaluator preserves every raw answer, response/output ID, request hash, model, tokens, latency, parser error, and mismatch. It makes only local SDK calls, concurrency1, temperature0, max_output_tokens16, no automatic retries. Runtime failures remain in the denominator. Existing result files cannot be overwritten.

| Report | Scope |
| --- | --- |
| [Baseline development](model-evaluation-baseline-development.json) |16 production-payload calls |
| [Baseline held-out](model-evaluation-baseline-held-out.json) |8 production-payload calls |
| [V1 development](model-evaluation-candidate-development.json) |16 generic-wrapper calls |
| [V2 development](model-evaluation-candidate-v2-development.json) |16 domain-wrapper calls |
| [V2 held-out](model-evaluation-candidate-v2-held-out.json) |8 domain-wrapper calls |
| [1.5B baseline development](model-evaluation-1.5b-baseline-development.json) |16 unchanged baseline calls |
| [1.5B baseline held-out](model-evaluation-1.5b-baseline-held-out.json) |8 unchanged baseline calls |
| [1.5B V2 development](model-evaluation-1.5b-candidate-v2-development.json) |16 previously frozen domain-wrapper calls |
| [1.5B V2 held-out](model-evaluation-1.5b-candidate-v2-held-out.json) |8 previously frozen domain-wrapper calls |

The [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices) informs separation of labels, measurements, human review, and retained failures; no OpenAI-hosted evaluation or paid inference was used. Human corrections require a new fixture version/hash while preserving these original runs.
