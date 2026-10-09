# Live Inngest restart recovery verification

`scripts/verify-live-recovery.ts` runs the production API and Inngest function in a separate Windows integration environment. The fixture is a synthetic 40-node Demo chain with configured YES answers. Its approximately 26-second execution window allows the verifier to observe persisted evidence and an active lease before abruptly stopping its own API worker and engine.

The retained 9 October 2026 probe **passed**. After restart it waited 295,589 real milliseconds to the persisted production lease expiry, recovered the original with HTTP 202 while preserving its first completed step, and completed a separate linked 40-node run. The new engine run has both `Completed` status and an end timestamp. All owned process stops were identity-verified and cleanup recorded no error.

The verifier uses API port 3032, engine port 8329, gateway port 8330, and gateway/executor gRPC ports 53352/53353. It refuses occupied ports, creates a fresh temporary history directory, launches hidden child processes, and checks each child's PID, executable, command line, and creation timestamp before termination. It leaves existing API, UI, engine, provider, and user history untouched.

After restarting those isolated processes, it checks that the API loaded the original history unchanged, that early recovery returns HTTP 409, and that the unpersisted development engine has lost its original event run. It waits for the stored five-minute lease using real wall-clock time while checking that the original remains unchanged. It then calls the production HTTP Recover endpoint and checks the interrupted original, the separate linked retry, all 40 resulting decisions, and the new engine run's completion.

Run from the repository root on Windows, using a new output filename to retain prior observations:

```powershell
npx tsx scripts/verify-live-recovery.ts evidence/live-inngest-restart-recovery-UNIQUE.json
```

The run takes about six minutes. The evidence file records checkpoints, process lifecycle, the actual expiry wait, both run snapshots, engine IDs, and the final pass/failure result. Existing output filenames are refused. Temporary synthetic history is retained for inspection; owned services are stopped during cleanup.

This verification covers the default **unpersisted** local Inngest Dev Server restart and explicit recovery behavior. It does not test cloud Inngest, persisted engine state, hosted deployment, browser controls, model inference, or model accuracy. There are no LLM calls. The existing late-worker fencing tests remain separate coverage because killed processes cannot produce late callbacks.

The local event-runs API can report status `Completed` while the API is still evaluating and `ended_at` remains null. Successful engine verification therefore requires completed API history, status `Completed`, **and a non-null engine end timestamp**. The first aborted probe is preserved in `live-inngest-restart-recovery-attempt1.json`; it exposed this status-only ambiguity and did not claim successful recovery. The canonical completed probe is `live-inngest-restart-recovery-verification.json` when its `passed` field is true.
