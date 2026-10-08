# Verification evidence

`npm run verify:integration` writes `integration-verification.json` with actual local Inngest event IDs, completed runs, ordered decisions, timings, and the checks performed.

The initial verification uses **Demo**; no OpenAI call was made. Screenshots or a live recording can be added after reviewing the frontend and Inngest dashboard.

`publish-check.json` records the tracked-source credential/path scan before publishing the GitHub repository. Re-run it with `npx tsx scripts/verify-publish.ts` after staging any changes.
