# Deployment and device integrations

Inspected 2026-11-08. Source baseline: `58ae4691775b03e19d043babebfc3ac26c70aea6` in `uhhphil/home-gym`. Production findings below are from the connected Railway API, not the setup document's intended configuration. No production settings, accounts, data, or deployments were changed during this audit.

## Railway: actual state

[Project](https://railway.com/project/ab70aa94-49e5-4d2c-b036-d6e9035ac54b), environment `production` (`5bc05dd4-2812-4b63-b11e-09f15898dc37`). Both services are **offline**, with no active deployments and no staged changes. The health overview reports nine recent failed deployments.

| Service | Verified configuration | Latest deployment |
| --- | --- | --- |
| `home-gym` | `uhhphil/home-gym@main`; repository-root build; `web/Dockerfile`; one `sfo` replica; healthcheck `/`; public domain target port `8080` | `2a9d22f8-68fe-4f87-b848-c48e978ef8fb`, **FAILED**, baseline commit, created 2026-11-08 19:30 UTC |
| `api` | Same GitHub repo and branch; root directory `/api`; configured Dockerfile path `api/Dockerfile`; one `sfo` replica; healthcheck `/api/health`; no public domain or TCP proxy | `546b63b7-7a3a-4e52-a8a5-b52d39fdcea2`, **FAILED**, baseline commit, created 2026-11-08 19:31 UTC |

The `workout-data` Railway volume exists, has a configured capacity of 50,000 MB, and is mounted on `api` at `/data`. This confirms a persistent mount, **not** stored-content integrity, free capacity, a backup, or a successful restore. No volume contents were read or altered.

### Confirmed API failure and prepared fix

The API build log explicitly reports `dockerfile invalid: docker VOLUME at Line 92 is not supported, use Railway Volumes`. This is the `VOLUME ["/coach-auth"]` instruction in the optional coach stage of `api/Dockerfile`. Railway rejects it before building the default stage too.

The local fix removes that Dockerfile instruction and documents explicit mounting for the optional coach target. It does not remove the existing `/data` Railway volume. Anyone enabling the optional coach target still needs an explicit persistent `/coach-auth` mount; ordinary home-gym logging does not require that target.

### Web failure and prepared port separation

The web image builds successfully, including Vite. Nginx starts, but Railway's `/` healthcheck returns service-unavailable on all eleven attempts during its five-minute window; Railway then stops the container. The deployment diagnosis marks the failure stage as `HEALTHCHECK` and has no additional diagnosis.

There is a configuration conflict to resolve: the original nginx template uses `PORT` for the **private API upstream**, while Railway uses `PORT` for the **service being checked**. The original web Dockerfile defaults `PORT=3000`; this service's public target is `8080`. A mismatch is consistent with the failure, but the current variable values cannot be verified: Railway's OAuth connector returns names only. [Railway documents this exact healthcheck use of PORT](https://docs.railway.com/deployments/healthchecks).

The local fix introduces `BACKEND_PORT` in both nginx proxy blocks. `web/15-backend-port.envsh` defaults it to the existing `PORT`, then `3000`, preserving Docker Compose and custom API-port behavior. It is sourced before nginx renders its template. A Railway deployment should explicitly separate the ports:

| Web variable | Intended value |
| --- | --- |
| `PORT` | `8080` |
| `NGINX_PORT` | `8080` |
| `BACKEND_PORT` | `3000` |
| `BACKEND` | `api.railway.internal` |
| `RESOLVER` | Railway's private DNS resolver, verified for this runtime; keep IPv6 resolution enabled in nginx |

Keep API `PORT=3000`, `DATA_DIR=/data`, and the existing `/data` mount. The local source fix has not yet been deployed, so neither service is claimed healthy.

### Account configuration and remaining checks

The API defines `ALLOW_GUEST`, `FIRST_USER_ADMIN`, `ORIGIN`, `RP_ID`, `RP_NAME`, `TRUST_PROXY`, and `DATA_DIR`. Values are redacted by the connector, so the intended `ALLOW_GUEST=0`, `FIRST_USER_ADMIN=0`, matching passkey origin/RP ID, and proxy behavior remain unverified. `ADMIN_UIDS` and `INVITE_ONLY` were absent from the variable-name inventory; do not assume owner promotion or invitation-only registration has been completed. Promote only the owner's exact registered ID as described in `HOME_GYM_SETUP.md`, without recording that ID in source.

Before calling production ready:

1. Apply the source fixes and explicit port settings through the user's fork, then deploy both services.
2. Confirm both settled deployments are successful, their source commits match the intended GitHub commit, and no pending deployment remains.
3. Verify the public HTTPS app, static assets, and proxied `/api/health` return successful responses. A root HTML response alone does not verify the API or durable storage.
4. Verify owner registration/login, then owner-only access settings, using the real domain. Do not create a substitute owner account.
5. Save and reload a workout; exercise offline/reconnect and duplicate-retry cases; verify an exported backup can be restored in a separate test account/environment.
6. Establish an actual off-volume backup and test restore. A persistent volume alone is not a backup.

The public HTTPS URL was independently opened in the browser after the API audit. It displays Railway's **404 Not Found** page rather than the application, consistent with the offline deployment records. Authenticated production logging, persistence, and passkeys have not been tested.

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

## Validation of local deployment fixes

`node --test api/test/railway-container.test.js api/test/dockerfile-copy.test.js`: **5 tests passed**. These exercise default/custom backend ports, explicit Railway listener/upstream separation, both nginx API proxy blocks, entrypoint inclusion, the absence of unsupported VOLUME directives, and completeness of API module copying. Container builds and deployed healthchecks still require verification after deployment; these tests do not substitute for them.
