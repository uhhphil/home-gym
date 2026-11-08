# Personal Home Gym

This repository is a fork of DuarteSantos8/openGym for personal home-gym use. Preserve upstream licenses and attribution.

## Railway

Project: https://railway.com/project/ab70aa94-49e5-4d2c-b036-d6e9035ac54b
App: https://home-gym-production-8981.up.railway.app

Two services deploy from main:
- home-gym: repository root, web/Dockerfile. Set PORT=8080, NGINX_PORT=8080, BACKEND_PORT=3000, BACKEND=api.railway.internal. PORT is Railway's public listener/healthcheck port; BACKEND_PORT is the private API port. The nginx resolver must support IPv6.
- api: root /api, Dockerfile, PORT=3000, DATA_DIR=/data. Persistent Railway volume mounted at /data. No public API domain.

Passkey RP_ID and ORIGIN must match the app domain; API startup logs confirm they do. Required access settings are ALLOW_GUEST=0 and FIRST_USER_ADMIN=0 so a stranger cannot claim administration before the owner signs up. Live `/api/config` confirms guest access is disabled. FIRST_USER_ADMIN=0 was explicitly saved through Railway for the documentation follow-up deployment, since the connector redacts existing values. Phil chose to set up his profile later, so no account was created and registration remains open. When ready, he must create the passkey on his phone and complete the Face ID/passkey prompt. After registration and login succeed, promote his exact user ID through ADMIN_UIDS and then enable INVITE_ONLY=1 for personal-only registration. These owner-onboarding steps are pending. Do not publish user IDs, passwords or credentials in this repository.

Back up /data before destructive changes. A volume survives deployments but is not a backup.

### Verification on 2026-11-08

The initial read-only audit found both Railway services offline with failed deployments. The API build rejected the optional coach stage's Docker VOLUME instruction; the web image built and started nginx but failed its healthcheck.

The fixes and first home-gym additions merged through [PR #1](https://github.com/uhhphil/home-gym/pull/1) as `a503d0b7da4817864ffbdc7b4f59eaaee5c756b1`, after the [full Tests workflow](https://github.com/uhhphil/home-gym/actions/runs/42518210121) passed, including actual container image smoke checks. The approved web port settings above were applied, and **both services reached SUCCESS on the merged commit**, verified around 3:21 p.m. Eastern (20:20:51 UTC).

The live browser shows openGym's passkey login screen. Proxied `/api/health` reports `ok: true`, `users: 0`, `writable: true`; `/api/config` confirms guest access disabled and invitation-only registration still disabled. Root, health, configuration, and static JavaScript/CSS responses succeed. Railway reports both services ONLINE, one running and zero crashed replicas each, no pending work, and zero current warning/critical counts. This verifies deployment, transport, and storage writability, not authenticated workout persistence or backup restoration. No production account or workout was manually added. Owner registration, promotion, and invitation-only lockdown remain postponed at the owner's request.

The [iOS workflow gate](https://github.com/uhhphil/home-gym/actions/runs/42518210131) passed with native jobs skipped; no native-device integration is claimed. See [the deployment audit](docs/home-gym/deployment-and-integrations.md) for deployment identifiers, live evidence, remaining authentication/backup checks, and native integration boundaries.

## Development scope

Personal use only: free weights, kettlebells, body-weight exercises, walking and running. Start from existing openGym functionality. Prioritize equipment filters, routines, sets/reps/load, timed kettlebell circuits, manual cardio duration/distance/pace, history and progress. Do not claim GPS or Apple Health integration unless implemented and verified.

Exercise media in catalogue/media has separate Gym visual licensing for use within openGym. Do not extract it into an independent app; replace it with appropriately licensed material if the project becomes independent. Free Exercise DB (https://github.com/yuhonas/free-exercise-db) is an optional data source, not a second application to merge.

Local setup: follow upstream README and docker-compose.yml. The original source remote is https://github.com/DuarteSantos8/openGym. Push personal changes only to uhhphil/home-gym.

## Personal setup and reference review

The owner's selected setup is barbell and plates, dumbbells, adjustable bench, squat rack, and pull-up bar, with pounds and miles. Home → My equipment offers this selectable preset. Kettlebells and exact weight inventories are not assumed. Applying the preset creates a normal equipment profile and converts existing weight values with the app's existing unit-conversion flow.

The [feature comparison](docs/home-gym/COMPARISON.md) documents all three inspected repositories and separate code/media licenses. Reference clones live outside production in `/private/tmp/home-gym-references/`. They are not bundled or needed to run the app. [Validation and local launch notes](docs/home-gym/VALIDATION.md) describe the first tested additions.

## WHOOP

The owner uses an iPhone and WHOOP 5.0. Account-sync and foreground Bluetooth implementations are documented in [WHOOP setup and verification](docs/home-gym/WHOOP.md). Account sync remains disabled until the WHOOP client ID, client secret and exact callback URI are configured on Railway's API service. Those variable names were absent when checked on 2026-11-08. Do not put the client secret in the web service or repository.

The web app can show account summaries after authorization. Safari on iPhone cannot use Web Bluetooth; live HR needs this repository's updated native iOS build. Xcode compilation, signing, installation and real-band verification remain pending. No WHOOP data has been read from the owner's account yet.
