# Baseline and validation

Run date: 2026-11-08. Main baseline commit: `58ae4691775b03e19d043babebfc3ac26c70aea6`. Local runtime: Node 24.21.0, npm 11.19.0. Existing CI/container runtime remains Node 22; this work does not upgrade dependencies or lockfiles.

## Local app

The API and Vite frontend were started successfully with isolated development data at `/private/tmp/home-gym-dev-data`. The local preview is http://127.0.0.1:5173. Local guest access is enabled only for this development process; production access settings were not changed.

To reproduce from the repository root, install locked dependencies:

```sh
npm ci --no-audit --no-fund
npm --prefix api ci --omit=optional --no-audit --no-fund
npm --prefix frontend ci --no-audit --no-fund
```

Start these in separate terminals:

```sh
cd api
PORT=3000 DATA_DIR=/private/tmp/home-gym-dev-data RP_ID=localhost ORIGIN=http://localhost:5173 ALLOW_GUEST=1 node server.js
```

```sh
cd frontend
API_ORIGIN=http://localhost:5173 npm run dev -- --host 127.0.0.1
```

The shell environment may require permission to download packages and bind local ports. Initial sandbox-only install/server attempts failed for those reasons; their output was not treated as application test failures. The subsequent installed/running baseline was used for validation.

## Automated checks

- API baseline: **800 tests passed**, no failures, running real temporary local HTTP servers.
- Frontend: **7,862 tests passed across 656 files**, no failures. The full suite caught and verified fixes for the existing empty-placeholder convention and the source-link assertion updated for this fork. Ten focused UI/settings tests also passed after the final backup-hook and field-styling changes.
- Reconciliation plus container compatibility: **16 tests passed** (11 reconciliation and 5 Dockerfile/port/module-copy checks).
- New feature review covered canonical unit conversion, unit switching before duration is entered, duplicate-save prevention, preserving a running lifting session, browser persistence, JSON round-trip, repeated two-device merge, warmup classification, and circuit round/rest execution.
- Circuit regressions cover global “start from last workout,” planned seconds/load, bodyweight, exercise-specific units, automatic warmups and automatic holds. Routine sharing preserves validated `startFrom` and `autoHold` values.
- Production web build passed. Existing bundle-size/dynamic-import warnings remain; they are not a claim that all upstream performance issues are resolved.
- Catalogue validation passed: **6,554 entries**. No catalogue rows or media changed.
- Generated Coach catalogue/prompts and API documentation match their sources; Coach shared core loads in plain Node.
- Workflow YAML parses; the existing API CI job now also runs reconciliation tests and triggers on web deployment changes.
- `git diff --check` passed.

Representative commands:

```sh
npm --prefix api test
npm --prefix frontend test -- --maxWorkers=4
npm --prefix frontend run build
node --test scripts/home-gym/reconcile-exercises.test.mjs api/test/railway-container.test.js api/test/dockerfile-copy.test.js
node scripts/catalogue/validate.mjs
node scripts/build-coach-assets.mjs --check
node scripts/build-api-docs.mjs --check
node api/scripts/check-core-loadable.mjs
```

## Browser checks

At **390 × 844**, verified:

1. Local login shell loads and guest mode opens Home.
2. Home → My equipment shows standard options with the selected barbell/dumbbell/bench/rack/pull-up setup. Applying it selects pounds/miles and removes the commercial gym-entry card.
3. A clearly marked local QA walk of 30 minutes and 2 miles shows **15:00 min/mi**, saves to the existing history, and survives a full reload as one workout.
4. Circuit builder selects existing Air Squat and Front Plank exercises through the filtered picker, saves 3 rounds × 30 seconds with 60-second round rest, opens the existing routine editor, and survives a full reload with both prescriptions intact. The test routine is named “Local QA circuit.”
5. Phone screenshots were inspected; numeric fields use the existing field styling and fit the viewport.

Only the isolated browser guest profile contains QA samples. No production workout, user, credentials, or account settings were edited.

## Production and device limits

The live Railway URL shows **404 Not Found**. The connected Railway API reports both services offline after failed deployments. Source repairs are prepared; production has not been changed. See [deployment-and-integrations.md](deployment-and-integrations.md) for exact failures and required port settings.

Container image rebuilds/deployed health checks, real-domain sign-in, real-phone airplane-mode/background/force-quit scenarios, Apple Health/Watch pairing, GPS, and off-volume backup/restore are **not verified**. Logical retry/merge tests and browser reload checks do not substitute for these acceptance checks.
