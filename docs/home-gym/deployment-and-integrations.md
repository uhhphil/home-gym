# Deployment and device integrations

Inspected 2026-11-08. Initial source baseline: `58ae4691775b03e19d043babebfc3ac26c70aea6` in `uhhphil/home-gym`. Production findings below are from the connected Railway API and live browser checks, not the setup document's intended configuration. The initial audit was read-only. Following approval, the fixes were merged and deployed successfully; the current status is recorded separately below. No production accounts or workout data were manually added.

## Current approved deployment

[PR #1](https://github.com/uhhphil/home-gym/pull/1) merged as `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1` after green CI. The web service's explicit `PORT=8080`, `NGINX_PORT=8080`, and `BACKEND_PORT=3000` settings were applied. Both Railway services reached **SUCCESS** on that merged commit, verified around 3:21 p.m. Eastern on 2026-11-08 (20:20:51 UTC).

| Service | Successful deployment | Source commit |
| --- | --- | --- |
| `api` | `b8b89560-16ae-4f4a-a025-936b0604f507` | `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1` |
| `home-gym` | `06e45eaa-77d6-438a-842f-1f58b0468b1d` | `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1` |

The subsequent Railway health overview reports both services **ONLINE**, each with one running and zero crashed replicas, no pending work, and zero current warning/critical counts. API startup logs confirm listener `:3000`, RP ID `home-gym-production-8981.up.railway.app`, and origin `https://home-gym-production-8981.up.railway.app`.

Live verification of [the app](https://home-gym-production-8981.up.railway.app):

- The browser displays the working openGym passkey login screen.
- Proxied `/api/health` returns `ok: true`, `users: 0`, and `writable: true`.
- Proxied `/api/config` returns `allow_guest: false` and `invite_only: false`.
- Railway HTTP logs show successful static JavaScript/CSS responses (`200`/`304`) and a successful configuration response (`200`).
- Web HTTP logs record `GET /` → `200` at 20:20:59 UTC and `/api/health` → `200` at 20:21:02 UTC, with `/api/config` also `200` and no upstream errors in the inspected requests.

This verifies the deployed web/API transport, application shell, and the health endpoint's storage-writability check. Owner registration, authenticated workout persistence, backup restoration, and physical-device behavior remain unverified. No substitute owner or test workout was created in production.

The [full Tests run](https://github.com/uhhphil/home-gym/actions/runs/42518210121) succeeded, including 7,862 frontend tests and actual container image build/smoke checks. The [iOS workflow run](https://github.com/uhhphil/home-gym/actions/runs/42518210131) passed its gate, but its native jobs were skipped; it provides no new native-build or device verification.

## Initial Railway audit, before repair

[Project](https://railway.com/project/ab70aa94-49e5-4d2c-b036-d6e9035ac54b), environment `production` (`5bc05dd4-2812-4b63-b11e-09f15898dc37`). At the initial audit, both services were **offline**, with no active deployments and no staged changes. The health overview reported nine recent failed deployments. These records describe the starting failure, not the later approved deployment.

| Service | Initial verified configuration | Latest deployment at initial audit |
| --- | --- | --- |
| `home-gym` | `uhhphil/home-gym@main`; repository-root build; `web/Dockerfile`; one `sfo` replica; healthcheck `/`; public domain target port `8080` | `2a9d22f8-68fe-4f87-b848-c48e978ef8fb`, **FAILED**, baseline commit, created 2026-11-08 19:30 UTC |
| `api` | Same GitHub repo and branch; root directory `/api`; configured Dockerfile path `api/Dockerfile`; one `sfo` replica; healthcheck `/api/health`; no public domain or TCP proxy | `546b63b7-7a3a-4e52-a8a5-b52d39fdcea2`, **FAILED**, baseline commit, created 2026-11-08 19:31 UTC |

The `workout-data` Railway volume exists, has a configured capacity of 50,000 MB, and is mounted on `api` at `/data`. The initial audit did not inspect its contents. The later live health probe confirms storage writability. Neither the mount nor that probe verifies stored-content integrity, free capacity, a backup, or a successful restore.

### Confirmed API failure and merged fix

The API build log explicitly reports `dockerfile invalid: docker VOLUME at Line 92 is not supported, use Railway Volumes`. This is the `VOLUME ["/coach-auth"]` instruction in the optional coach stage of `api/Dockerfile`. Railway rejects it before building the default stage too.

The merged fix removes that Dockerfile instruction and documents explicit mounting for the optional coach target. It does not remove the existing `/data` Railway volume. Anyone enabling the optional coach target still needs an explicit persistent `/coach-auth` mount; ordinary home-gym logging does not require that target.

### Web failure and merged port separation

In the initial failed deployment, the web image built successfully, including Vite. Nginx started, but Railway's `/` healthcheck returned service-unavailable on all eleven attempts during its five-minute window; Railway then stopped the container. The deployment diagnosis marked the failure stage as `HEALTHCHECK` and had no additional diagnosis.

The original nginx template used `PORT` for the **private API upstream**, while Railway uses `PORT` for the **service being checked**. The original web Dockerfile defaulted `PORT=3000`; this service's public target was `8080`. A mismatch was consistent with the failure, but the old variable values could not be verified: Railway's OAuth connector returns names only. The approved deployment now sets the three port values explicitly. [Railway documents this healthcheck use of PORT](https://docs.railway.com/deployments/healthchecks).

The merged fix introduces `BACKEND_PORT` in both nginx proxy blocks. `web/15-backend-port.envsh` defaults it to the existing `PORT`, then `3000`, preserving Docker Compose and custom API-port behavior. It is sourced before nginx renders its template. The Railway configuration separates the ports:

| Web variable | Value and verification |
| --- | --- |
| `PORT` | `8080`, explicitly applied for the approved deployment |
| `NGINX_PORT` | `8080`, explicitly applied for the approved deployment |
| `BACKEND_PORT` | `3000`, explicitly applied for the approved deployment |
| `BACKEND` | Expected: `api.railway.internal`; routing is functionally verified by successful proxied API responses, while the connector redacts the variable value |
| `RESOLVER` | Keep Railway's private DNS resolver and IPv6 support; private resolution is functionally verified by successful proxied API responses, while the connector redacts the variable value |

Keep API `PORT=3000`, `DATA_DIR=/data`, and the existing `/data` mount. Both approved deployments succeeded, and the public health endpoint reports a healthy, writable API.

### Account configuration and remaining checks

The live config confirms **guest access is disabled** and **invitation-only registration is not yet enabled**. The live health response reports zero users. API startup logs confirm the correct passkey origin and RP ID. Since the connector redacts existing variable values, `FIRST_USER_ADMIN=0` was explicitly saved through Railway for the documentation follow-up deployment. This preserves the intended setup: no automatic admin claim by the first visitor. `ADMIN_UIDS` and `INVITE_ONLY` were absent from the initial variable-name inventory. Owner registration, exact-ID admin promotion, and invitation-only lockdown are still pending.

The owner chose to set up the profile later. No account was created. Registration remains open until the owner registers and is promoted, after which `INVITE_ONLY=1` should be enabled. When ready, the owner must create the passkey on their phone and complete the Face ID/passkey prompt themselves. A displayed login screen does not establish that registration or login works; verify that completed flow before claiming it does. Promote only the owner's exact registered ID as described in `HOME_GYM_SETUP.md`, without recording that ID in source.

Remaining acceptance checks:

1. Complete and verify owner registration/login on the real domain, exact-ID admin promotion, and `INVITE_ONLY=1`. Do not create a substitute owner account.
2. Save and reload an authenticated workout; exercise offline/reconnect and duplicate-retry cases on the real phone.
3. Verify an exported backup can be restored in a separate test account/environment; establish an actual off-volume backup and test restore. A persistent volume alone is not a backup.

At the initial audit, the public HTTPS URL displayed Railway's **404 Not Found** page. The later live check now displays openGym successfully. The earlier 404 remains historical failure evidence, not the current status.

## GPS, Apple Health, and Apple Watch

These are separate from the browser's manual workout features. Native source existing in the repository does not prove the user's app is signed, installed, paired, or working on their devices.

| Capability | Web app | Native code found | Verification and decision |
| --- | --- | --- | --- |
| Manual walk/run logging | Existing cardio rows store minutes and km/h; this change adds direct distance entry and calculated pace; no GPS needed | Shared frontend uses the same workout data | Tested in logic/store tests and a 390 px browser preview; physical-phone acceptance remains outstanding |
| GPS route recording | No `watchPosition` or `getCurrentPosition` workout recorder found in `frontend/src` | `GymReminderPlugin.swift` uses Core Location for gym proximity reminders, **not** recorded walking/running routes | **Not implemented as a route tracker**. Browser foreground GPS could be added, but screen-lock/background tracking needs a separate native implementation and real outdoor tests |
| Apple Health export/readback | Unavailable in the Railway web build | `frontend/ios/App/App/AppleHealthPlugin.swift` implements permission requests, workout/body-mass writes, deletions, heart-rate reads, and weight reads. `frontend/src/lib/health-sync.js` selects the native AppleHealth plugin; `mobile.js` gates it behind `VITE_MOBILE=1` and an iOS platform | **Implemented in native source, not device-verified in this fork**. Requires signed iOS build, entitlements, user permission, and read/write/deletion/duplicate testing |
| Apple Watch workout control | No browser WatchConnectivity bridge | `frontend/ios/App/App/WatchBridgePlugin.swift`, `frontend/ios/App/Watch/`, and shared `frontend/src/lib/watch-sync.js` implement companion snapshots, workout events, durable queue acknowledgement, and watch HealthKit workouts | **Implemented in native source, not installed/paired/device-verified**. Requires iPhone + companion watchOS builds and testing with disconnect/reconnect, app termination, and screen lock |

`AppleHealthPlugin.swift` uses stable sync identifiers such as `opengym-w-<workout id>` and avoids a second write when the watch or native phone workout session already saved it. That is a useful existing design to preserve, not a reason to promise perfect deduplication without device testing. The Watch bridge drains events only after store readiness and acknowledges them after the main store saves; preserve these ordering guarantees when extending logging.

Apple describes HealthKit as the iOS/watchOS health repository and requires app capabilities/entitlements: [HealthKit configuration](https://developer.apple.com/documentation/Xcode/configuring-healthkit-access). WatchConnectivity connects an iOS app and its paired watchOS app, rather than a website: [Watch Connectivity](https://developer.apple.com/documentation/WatchConnectivity).

Browser geolocation requires HTTPS, explicit permission, and can be restricted by Permissions Policy: [MDN watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition). The current W3C Geolocation draft specifies location updates for visible, fully active documents and drops updates when hidden: [request-position behavior](https://www.w3.org/TR/geolocation/#request-a-position). Therefore a PWA cannot be presented as a verified background running tracker. A foreground prototype must label this limitation and preserve incomplete routes instead of inventing missing distance.

## Validation of deployment fixes

`node --test api/test/railway-container.test.js api/test/dockerfile-copy.test.js`: **5 tests passed**. These exercise default/custom backend ports, explicit Railway listener/upstream separation, both nginx API proxy blocks, entrypoint inclusion, the absence of unsupported VOLUME directives, and completeness of API module copying. The successful [Tests workflow](https://github.com/uhhphil/home-gym/actions/runs/42518210121) also built and smoke-tested actual container images. Railway deployment success and public responses were independently verified as recorded above; authentication, real-phone logging, and restoration remain separate acceptance checks.
