# Baseline and validation

Run date: 2026-11-08. Main baseline commit: `58ae4691775b03e19d043babebfc3ac26c70aea6`. Local runtime: Node 24.21.0, npm 11.19.0. Existing CI/container runtime remains Node 22; this work does not upgrade dependencies or lockfiles.

The initial implementation was merged through [PR #1](https://github.com/uhhphil/home-gym/pull/1) as `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1` after green CI. Both approved Railway deployments of that commit succeeded. This document separates completed local/CI and live transport validation from the authentication, physical-device, and restoration checks that remain pending.

## Local app

The API and Vite frontend were started successfully with isolated development data at `/private/tmp/home-gym-dev-data`. The local preview is http://127.0.0.1:5173. Local guest access is enabled only for this development process; production guest access remains disabled. During deployment follow-up, the intended `FIRST_USER_ADMIN=0` Railway setting was explicitly saved for the next deployment because existing variable values are redacted by the connector.

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

The [full Tests workflow](https://github.com/uhhphil/home-gym/actions/runs/42518210121) succeeded, including the full frontend suite and actual container image build/smoke checks. The [iOS workflow](https://github.com/uhhphil/home-gym/actions/runs/42518210131) passed its gate, but native jobs were skipped; the green workflow is not evidence of an iOS/watchOS build or a physical-device test.

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

At the initial read-only audit, the live Railway URL showed **404 Not Found** and the connected Railway API reported both services offline after failed deployments. Since then, source repairs were merged and the approved web settings `PORT=8080`, `NGINX_PORT=8080`, and `BACKEND_PORT=3000` were applied. Both services reached **SUCCESS** at merged commit `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1`, verified around 3:21 p.m. Eastern on 2026-11-08 (20:20:51 UTC): API deployment `b8b89560-16ae-4f4a-a025-936b0604f507`, web deployment `06e45eaa-77d6-438a-842f-1f58b0468b1d`.

The [live app](https://home-gym-production-8981.up.railway.app) displays the openGym passkey login screen. Proxied `/api/health` returns `ok: true`, `users: 0`, `writable: true`; `/api/config` returns `allow_guest: false`, `invite_only: false`. Railway HTTP logs confirm root, health, and configuration responses (`200`) and static JavaScript/CSS responses (`200`/`304`), without upstream errors in the inspected requests. Both services are ONLINE with one running and zero crashed replicas each, no pending work, and zero current warning/critical counts. API startup logs confirm port 3000 and the production domain's correct passkey RP ID and HTTPS origin. No production accounts or workouts were manually added. See [deployment-and-integrations.md](deployment-and-integrations.md) for the historical failures and live evidence.

Actual container images, deployment health, public transport, application shell, and storage writability are verified. The owner chose to set up the profile later: no account was created, guest access remains disabled, and registration stays open until the owner registers, is promoted, and invitation-only access is enabled. Owner phone passkey registration and login, exact-ID admin promotion, invitation-only lockdown, authenticated workout persistence, real-phone airplane-mode/background/force-quit scenarios, Apple Health/Watch pairing, GPS, and off-volume backup/restore are **not verified or not yet completed**. When ready, the owner must complete the phone's Face ID/passkey prompt. Logical retry/merge tests, a writable health probe, and browser reload checks do not substitute for these acceptance checks.

## WHOOP increment (2026-11-08)

- Same React/Node/Capacitor architecture, no new dependencies. No changes to existing exercise, workout, routine IDs or the workout synchronization protocol.
- Full API suite: **822 tests pass**, including the WHOOP routes and OpenAPI coverage. Provider fixtures test OAuth browser/profile binding, state expiry/replay, encrypted token storage, refresh serialization, stable-ID deduplication, bounded pagination, failed-page retention and disconnect/account removal races.
- Frontend fixtures test profile-switch isolation, cached data after failed refresh, unknown scores, revoked access, disconnect/export boundaries, and explicit sensor selection. BLE fixtures cover 8/16-bit measurements, optional fields, contact loss, staleness and connection lifecycle races.
- Full frontend suite: **7,921 tests across 661 files pass**. Production web build passes. A 390×844 browser check showed the WHOOP account/sensor sheet without layout overflow or console errors. This is a Chromium rendering check, not iPhone Bluetooth validation.
- Swift syntax and plist/project syntax checks pass; Xcode.app is not installed locally. GitHub iOS checks track simulator compilation separately; local syntax checks are not an iOS build or physical-device result.
- WHOOP credentials and the owner's app profile are not configured. Provider OAuth, real account sync, real HR notifications and reconnect/foreground tests are pending; see [WHOOP.md](WHOOP.md).
