# WHOOP account sync and live heart rate

Implemented for the existing Home Gym web app and Capacitor iOS shell. Owner's target: **iPhone + WHOOP 5.0**. No new package dependencies, copied WHOOP logos, or changes to exercise/workout IDs.

## What is implemented

| Capability | Web app | Native iPhone app | Verification boundary |
| --- | --- | --- | --- |
| Account connection | OAuth through the signed-in browser | Connect in Safari, then use the same profile through existing server pairing | Fixture-tested; real credentials and member authorization pending |
| Recovery, sleep, strain | Home summary and Settings → Integrations → WHOOP | Same UI through paired API | Last complete 30-day snapshot, no fabricated scores |
| Activities | Read-only provider list, duration, strain, average HR and distance in preferred units | Same | Original UUIDs retained; does not create duplicate gym workouts |
| Live Bluetooth HR | Available only where Web Bluetooth exists; **not Safari on iPhone** | Foreground CoreBluetooth plugin; explicit scan and device selection | Transport/parser tests pass; physical WHOOP 5.0 pairing pending |
| Offline | Existing workout logging remains independent | Existing local logging remains independent | WHOOP summaries are server-cached, not persisted in browser storage; no offline reload guarantee |
| Export | Separate WHOOP JSON download | Existing native share/export route | Tokens never included |

The current member API provides recovery, cycle, sleep and completed workout data. It does not provide a continuous HR stream, GPS routes, sets/reps/weights, or a documented member workout-upload endpoint. Account sync and live BLE readings are distinct. No workout is uploaded to WHOOP. Apple Health and Watch integrations remain separately unverified.

## Activate account sync

1. Create a client in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/) using the owner's account. Personal development fits the documented 10-member pre-approval limit. Review the provider terms when registering.
2. Register this **exact redirect URI**:
   `https://home-gym-production-8981.up.railway.app/api/whoop/callback`
3. Set these variables on Railway's **api service only**:
   - `WHOOP_CLIENT_ID`: the developer client ID.
   - `WHOOP_CLIENT_SECRET`: the client secret, entered directly in Railway; do not put it in chat, GitHub, browser storage or Vite variables.
   - `WHOOP_REDIRECT_URI`: the exact URI above.
4. Deploy the API with those variables. No changes to ports, the `/data` volume, or the web service's environment are needed.
5. Create/sign in to the owner's Home Gym profile in Safari (previously postponed). In **Settings → Integrations → WHOOP**, choose **Connect WHOOP account**, grant permission, and return to the app. Review the first sync and original activities against WHOOP.
6. For the native app, pair it with the same Home Gym server/profile. It reads the same account connection; do not enter WHOOP secrets on the phone.

Scopes: `read:profile read:recovery read:cycles read:sleep read:workout offline`. Only the profile's `user_id` is retained; names and email from the provider are not cached. A missing/invalid configuration leaves account connection disabled and explains that setup is required. There are no placeholder credentials.

## Live HR on the owner's iPhone

Build/install this repository's updated iOS app with Xcode and the owner's signing setup. The native plugin is registered in `MainViewController.swift`; Bluetooth permission text is in `Info.plist`. No App Store release, signing changes, or background Bluetooth mode are included.

Turn on **Heart Rate Broadcast** in WHOOP, keep the band worn and nearby, then open **Settings → Integrations → WHOOP → Find heart rate sensor** (also available through **Workout options → Heart rate sensor**). Select the device explicitly. A fresh notification appears in the workout header. The implementation uses standard BLE service `180D` and measurement characteristic `2A37`, not a proprietary WHOOP protocol.

A reading becomes stale after 15 seconds; stale/disconnected/no-contact readings disappear. Scans last at most 15 seconds. The iOS app disconnects when backgrounded and needs a new scan/selection on return. This increment displays live HR only: it does not persist a sampled HR timeline or claim background/locked-screen recording. Existing phone-workout HR can remain a separate fallback, with a separate source label.

**Unverified on hardware:** permission prompt, WHOOP 5.0 discoverability, actual notifications, reconnection, coexistence with the WHOOP app and battery behavior. The development Mac lacks Xcode.app; Swift syntax and plist/project syntax validation are not an iOS compile or device test.

## Identity, synchronization and backup

- Authenticated endpoints always use the current Home Gym profile; callers cannot pass another user's ID. OAuth state is one-time, expires after ten minutes and is bound to the same signed-in profile plus a strong HttpOnly callback cookie.
- The nginx callback location suppresses access and upstream-error logging so authorization query parameters are not recorded there. Any additional reverse proxy or HTTP analytics must also omit callback query strings.
- Account summaries refresh on screen open and every 15 minutes while visible, or with **Sync now**. No webhooks, background server scheduler or daily notification feed is included.
- Full 30-day reconciliation deduplicates within each resource type by original ID and newest provider `updated_at`. Recovery uses its original `sleep_id` because WHOOP exposes no separate recovery ID. A failed page preserves the previous complete cache; successful replacement removes provider-deleted records from that window.
- Refresh token rotation and full syncs are serialized per profile. HTTP requests, page/record counts, response bytes and total sync duration are bounded. A reconnect may be needed if provider token rotation succeeds immediately before a process/storage failure; no implementation can atomically commit a remote rotation with a local file write.
- Encrypted tokens and private cached summaries live in `/data/integrations/whoop/`. Tokens use the existing per-installation secret and user-bound encryption. Summaries are filesystem-private JSON, not encrypted independently. Keep `/data/secret` with an encrypted full-volume backup if restoring connections; losing it requires reauthorization.
- The normal workout JSON export does not contain WHOOP server data. **Export WHOOP data** provides the cached observation snapshot separately, never credentials. It is an archival export, not a WHOOP restore/upload format.
- **Disconnect WHOOP** deletes local connection/cache and attempts remote revocation. If the provider cannot be reached (including an expired token), the UI instructs the user to revoke access in WHOOP settings. Home Gym account deletion removes local WHOOP data; remote revocation should be done in WHOOP settings too.

## Provider references

Verified against official documentation on 2026-11-08: [API fields/endpoints](https://developer.whoop.com/api/), [OAuth](https://developer.whoop.com/docs/developing/oauth/), [refresh-token request contract](https://developer.whoop.com/docs/tutorials/refresh-token-javascript/), [app setup](https://developer.whoop.com/docs/developing/getting-started/), [pre-approval member limit](https://developer.whoop.com/docs/developing/app-approval/), [HR broadcast support](https://developer.whoop.com/docs/developing/support/). Browser implementation references: [Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth), [WebKit policy](https://webkit.org/tracking-prevention/). Native implementation reference: [CoreBluetooth](https://developer.apple.com/documentation/corebluetooth).
