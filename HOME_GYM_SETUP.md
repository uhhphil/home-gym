# Personal Home Gym

This repository is a fork of DuarteSantos8/openGym for personal home-gym use. Preserve upstream licenses and attribution.

## Railway

Project: https://railway.com/project/ab70aa94-49e5-4d2c-b036-d6e9035ac54b
App: https://home-gym-production-8981.up.railway.app

Two services deploy from main:
- home-gym: repository root, web/Dockerfile, NGINX_PORT=8080. Proxies API requests through private networking to api.railway.internal:3000. The nginx resolver must support IPv6.
- api: root /api, Dockerfile, PORT=3000, DATA_DIR=/data. Persistent Railway volume mounted at /data. No public API domain.

Passkey RP_ID and ORIGIN must match the app domain. Guest access is disabled. Automatic first-user admin is disabled so a stranger cannot claim administration before the owner signs up. After Phil registers, promote his exact user ID through ADMIN_UIDS and then enable INVITE_ONLY=1 for personal-only registration. Do not publish user IDs, passwords or credentials in this repository.

Back up /data before destructive changes. A volume survives deployments but is not a backup.

## Development scope

Personal use only: free weights, kettlebells, body-weight exercises, walking and running. Start from existing openGym functionality. Prioritize equipment filters, routines, sets/reps/load, timed kettlebell circuits, manual cardio duration/distance/pace, history and progress. Do not claim GPS or Apple Health integration unless implemented and verified.

Exercise media in catalogue/media has separate Gym visual licensing for use within openGym. Do not extract it into an independent app; replace it with appropriately licensed material if the project becomes independent. Free Exercise DB (https://github.com/yuhonas/free-exercise-db) is an optional data source, not a second application to merge.

Local setup: follow upstream README and docker-compose.yml. The original source remote is https://github.com/DuarteSantos8/openGym. Push personal changes only to uhhphil/home-gym.
