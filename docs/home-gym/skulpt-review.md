# Skulpt reference review

Reviewed 2026-11-08 at commit `538363e70d8cf5a9832eddf4e9d06a6e931446cb` in `/private/tmp/home-gym-references/skulpt`. This is a static source review, not an installed-device verification. Reference: https://github.com/skulptapp/skulpt/tree/538363e70d8cf5a9832eddf4e9d06a6e931446cb.

## Implemented features and fit

| Area | Source evidence | What to use in home-gym |
| --- | --- | --- |
| Phone interface | Expo Router screens, native bottom sheets, gesture handling, safe areas, numeric weight/reps/distance inputs; `src/screens/workouts/exercise/components/set-item/index.tsx` | Adopt compact numeric entry and active-set emphasis as interaction patterns; keep openGym React DOM components. |
| Durable local workouts | `src/db/index.ts` opens Expo SQLite with WAL; Drizzle tables in `src/db/schema/` hold workouts, groups, exercise slots, sets, measurements and user settings | Keep openGym's existing browser persistence and server protocol. Native SQLite cannot replace browser persistence directly. |
| Workout planning and reuse | `src/screens/workouts/editor/index.tsx` edits scheduled `startAt`/reminders; `src/crud/workout/index.ts` implements duplicate, start and complete | Scheduled workouts and duplication are implemented. This is not evidence of openGym-style recurring weekly templates; openGym already has richer routine/week planning. |
| Sets and previous values | `src/crud/exercise/index.ts:getLastExerciseSetsByExerciseId` and `src/screens/select/index.tsx` seed new exercises from completed history; set UI edits weight, reps, duration, distance and RPE | Existing openGym history seeding and previous-set display already cover this. |
| Circuits and rest | `src/screens/workouts/workout/hooks/use-manage-circuit-groups.ts`, `src/helpers/execution-order.ts`, `src/services/set-transitions.ts` implement groups, round-by-round order, start/completion timestamps and rest advancement | Useful product entry point: build a timed circuit using openGym routines, contiguous `sg` groups, `sgRest`, `mode: 'time'`, and `autoHold`. No second timer or session model. |
| Progress | `src/screens/exercises/exercise/components/statistics/` implements one-rep max, volume, intensity, average weight and relative-strength cards; `src/crud/workout/index.ts` implements workout statistics | Keep openGym charts; reuse the idea of focused per-exercise summaries rather than porting native chart dependencies. |
| Walking/running | Exercise schema has time/distance tracking and outdoor/indoor walking/running activity types (`src/db/schema/exercise.ts`); health summary code reads distance | Source supports logging time and distance. No phone GPS route recorder was identified. Do not infer a GPS map from these fields. |
| Export/backup | No general JSON/CSV/database export or restore workflow was located in `src`. Health export is implemented separately | Use and test openGym's existing export and restore features. Sync is not backup. |

## Offline and synchronization boundaries

`src/sync/config.ts` and `docs/LOCAL_ONLY.md` make sync optional through `EXPO_PUBLIC_SYNC_HOST`. Local-only mode does not mount the active provider or enqueue new sync operations; custom exercises and workouts remain in SQLite. `src/sync/backfill.ts` can enqueue records when a provider is enabled later.

`src/crud/sync/index.ts` persists queue entries. `src/sync/index.ts` batches pending creates/updates/deletes, marks acknowledged operations done, applies server data in database transactions, and tracks cursors. It handles a missing-record conflict and retryable transport failures. The backend is **not in this repository**; `docs/SYNC_PROTOCOL.md` explicitly assigns authentication, ownership validation, idempotent retries and backups to the provider.

This is not proof of exactly-once delivery. For example, `src/crud/workout/index.ts:createWorkout` writes a workout, reads it, then queues its create in separate awaited operations; these steps are not one database transaction. A crash between the write and queue is a case to test before adopting that pattern. Do not transplant Skulpt's sync protocol over openGym's established revision/conflict model.

## Native integrations

- **Apple Health:** real iOS HealthKit authorization, sample reads, workout writes and measurement import code exists in `src/services/health.ts` and `src/services/health-importer.ts`. Android Health Connect uses a different native dependency. These are not web APIs and have not been verified on a physical device for this project.
- **Apple Watch:** real SwiftUI target and workout/session managers exist in `targets/watch/`; `modules/watch-connectivity/ios/WatchConnectivityModule.swift` persists pending command IDs and acknowledges commands. This is useful architecture evidence for a future native companion, not a working integration in the Railway web app.
- **GPS:** the reviewed package has no Expo Location dependency; no `CLLocation`/`HKWorkoutRoute` recorder was found in the Watch implementation. Watch distance display, activity-type fields and Health distance summaries do not establish GPS route tracking.
- **Lock-screen controls:** custom iOS live-activity and workout-command modules exist. They require native entitlements/builds and cannot be copied into a hosted PWA as working capabilities.

## Dependencies and licensing

Skulpt uses Expo 57, React Native 0.86, React 19.2, Drizzle/Expo SQLite, MMKV, TanStack Query, Zustand, native gesture/animation libraries, HealthKit/Health Connect and custom Swift modules. openGym uses Vite/React DOM/Zustand with a Node API and its existing optional Capacitor shell. Direct component/schema copying would import a different runtime, database, navigation and authentication architecture. No Skulpt dependency is needed for the circuit addition.

The repository `LICENSE` is **GPL version 3**, and its README states GPL-3.0. Preserve the exact license and attribution for any copied code; review the GPLv3/AGPLv3 combination provisions before a future direct port. The current circuit work is an implementation in openGym's own architecture inspired by the observed interaction pattern; it does not copy Skulpt source.

**Media and catalogue are separate.** `docs/LOCAL_ONLY.md` says the maintained catalogue is delivered by the provider's `skulpt` scope and is not bundled. `src/constants/skulpt.ts` builds GIF URLs under `https://storage.yandexcloud.net/skulpt-storage/images/exercises` (overridable by an environment variable). There is no verified grant here for importing that remote catalogue or those GIFs. Bundled assets also contain fonts, sounds and brand images; their presence is not a separate provenance audit. Do not import Skulpt exercises, remote GIFs, fonts, audio, icons or branding under an assumption that the code license covers them.
