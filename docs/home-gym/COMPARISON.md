# Personal home gym: source comparison and first implementation

Reviewed 2026-11-08. The production application remains the `uhhphil/home-gym` fork of openGym. Reference repositories are separate checkouts under `/private/tmp/home-gym-references/`; they are not runtime or build dependencies. Temporary reference directories may need cloning again after system cleanup.

## Inspected sources

| Project | Inspected commit | Role |
| --- | --- | --- |
| [home-gym / openGym](https://github.com/uhhphil/home-gym/tree/58ae4691775b03e19d043babebfc3ac26c70aea6) | `58ae4691775b03e19d043babebfc3ac26c70aea6` | Main React/Vite/Zustand app, Node API, nginx, optional Capacitor native targets |
| [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5) | `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` | Exercise metadata/instruction reference and dataset reconciliation |
| [Skulpt](https://github.com/skulptapp/skulpt/tree/538363e70d8cf5a9832eddf4e9d06a6e931446cb) | `538363e70d8cf5a9832eddf4e9d06a6e931446cb` | Mobile interaction and circuit-flow reference; not a second app to merge |

The following describes implemented source paths, not just README promises. Native integrations were inspected, not device-tested. Full evidence, limitations and license provenance are in [the dataset review](exercise-db-review.md), [the Skulpt review](skulpt-review.md), and [the deployment/integration audit](deployment-and-integrations.md).

## Feature comparison before these additions

| Desired capability | Main app already implements | Free Exercise DB actually implements | Skulpt actually implements | Decision |
| --- | --- | --- | --- | --- |
| Phone-first interface | Responsive shared controls, bottom tabs/sheets, PWA shell; `frontend/src/components/ui.jsx`, `App.jsx`, `index.css`, `public/sw.js` | Vue catalogue browsing/search and bookmarks | Native Expo Router, sheets, gestures, safe-area and compact entry controls | Keep one openGym interface and use its existing controls |
| Equipment inventory/filtering | Saved equipment profiles, accessories, per-gym plates/dumbbells/bars; `lib/equipment.js`, `gym-inventory.js`, Settings and Library | Equipment tags, with null/other values; no personal inventory | Exercise equipment metadata; no equivalent verified per-gym plate inventory | Add a short home-setup entry point, retaining existing inventory model |
| Instructions and images | 5,632 canonical exercises plus figure aliases; instruction modules and licensed 180 px Gym visual media | 876 exercise records, instruction arrays, photo references; separate photo provenance gap | Catalogue supplied by external provider, not in repository; remote GIF URL builder | Keep current licensed media; reconcile text/data conservatively before importing |
| Routines/weekly planning | Saved routines, weekly and date-specific plans, rotation, supersets, starter plans; `views/Plan.jsx`, `lib/routines.js`, `rotation.js` | Saved exercise bookmarks only | Scheduled workouts, reminders and duplication; not equivalent recurring week templates | Preserve existing richer plan system |
| Fast sets/reps/weight | Large numeric controls, set completion/copy, warmups, RPE/RIR; `views/Workout.jsx`, `lib/workout-model.js` | None | Editable weight/reps/duration/distance/RPE sets | Reuse main flow; no database migration |
| Previous workout values | Last-entry seeding, previous values and exercise history; `lib/session-start.js`, `history.js`, `sheets.jsx` | None | Last completed sets seed an exercise | Already covered |
| Rest/timed circuits | Rest timers, timed sets, automatic holds and superset round order; `store/useUI.js`, `lib/auto-holds.js`, `supersetFlow.js` | None | Circuit groups and execution order with rest transitions | Add a circuit builder that creates ordinary timed routines |
| Records/charts | Weight/estimated-1RM records and exercise/body/progress charts; `views/Stats.jsx`, `components/LineChart.jsx`, `lib/history.js` | None | Per-exercise strength/volume/intensity/1RM statistics | Keep current charts and exercise IDs |
| Walking/running | Cardio rows with minutes and canonical km/h, editing and history; no dedicated distance/pace entry | A few relevant exercise descriptions; no activity log | Duration/distance fields and activity types; no verified GPS recorder | Add direct manual distance input, calculated pace, and recent walk/run summaries |
| Offline/sync | Browser local persistence, PWA caching, revision conflicts, merge by identity, deletions/tombstones, recovery and account isolation; `store/useStore.js`, `lib/sync-merge.js`, `api/server.js`, `api/sync-stamps.js` | Bookmarks in localStorage only | SQLite/WAL and durable queue; optional sync provider backend absent; write/enqueue crash gap | Preserve and test main protocol; do not import an incomplete replacement |
| Export/backup | JSON, media-inclusive archive, restore conflict handling, native auto-backup; Settings and `lib/backup-media.js` | Dataset download | No general user-data export/restore workflow located; Health export is separate | Existing exports include the new ordinary workouts/routines |
| GPS | Gym proximity/location settings are not route recording | None | No route recorder found | Not implemented; treat future foreground web and native background tracking separately |
| Apple Health/Watch | Native iOS/watchOS source exists; web build lacks these bridges | None | Native HealthKit and watchOS source exists | No integration claim until signed device builds and end-to-end checks pass |

## Compatibility and licenses

| Source/material | Terms/evidence | Requirement and implementation choice |
| --- | --- | --- |
| openGym code/community text | Root `LICENSE` AGPLv3; package declarations say AGPL-3.0-or-later; upstream notices retained | Keep copyright, license, corresponding source and change notices. Settings links this fork's source and upstream separately |
| Original ExerciseDB text in openGym | MIT grant and attribution in `NOTICE.md` | Preserve notice; do not confuse ExerciseDB with Free Exercise DB |
| openGym photos/animations | `NOTICE.md` and `catalogue/media/NOTICE.md`; separate Gym visual license | Main notice permits an unmodified 180 px media set in this noncommercial fork with attribution. No extraction into another app, hotlinking, or AI media use |
| Free Exercise DB code/data | Unlicense in `LICENSE.md`, public-domain claims and upstream attribution | Retain source revision and original IDs in reconciliation; no new dependency or bulk import |
| Free Exercise DB photos | Repository reuse claims but no per-photo rights chain verified | Do not copy/hotlink photos until the specific media's rights are verified |
| Skulpt code | GPLv3 | A direct port would need its license and attribution, and review under both licenses' section 13. The first changes adapt interaction ideas without copying source |
| Skulpt remote catalogue/GIFs/assets | Provider dependency, no verified remote asset grant | Import none |

GPLv3 and AGPLv3 permit combined works through section 13; that does not relicense a copied GPL component as AGPL or remove its notices. The network-source requirement applies to the combination. See the [GNU license compatibility explanation](https://www.gnu.org/licenses/license-compatibility.en.html) and [AGPL section 13](https://www.gnu.org/licenses/agpl-3.0.html#section13). Personal/noncommercial use does not by itself waive media restrictions.

Skulpt's Expo 57/React Native 0.86/SQLite/Drizzle/native modules do not directly run in React DOM. Free Exercise DB's Vue/Vite 4/Tailwind/Fuse website would introduce a parallel frontend. Neither runtime is added. The first implementation adds **zero package dependencies** and retains the existing state schema and server protocol.

## Implemented first steps

1. **Home equipment setup:** standard selectable equipment with the owner's barbell, dumbbells, bench, squat rack and pull-up bar preselected; pounds/miles; existing weights use the established conversion path. Exact plate/dumbbell weights remain editable in Settings. Kettlebells are not assumed owned. The profile enables existing filtering and hides the irrelevant gym-entry card.
2. **Manual walking/running:** duration, distance, finish time and optional note; immediate calculated pace; miles/km conversion; existing workout IDs and canonical minutes/km/h. Saves do not overwrite a strength session in progress. Repeated saves with the same activity ID are no-ops. Recent walk/run history shows distance and pace derived from current set values, so editing the original workout updates the summary.
3. **Timed circuits:** choose 2–8 eligible stations, rounds, work time and between-round rest. Saves an ordinary routine with existing exercise IDs, timed auto-holds and a superset group. Existing Plan/Workout handles scheduling, sets, timing, history, backup and sync. Keep the web app open for reliable cues; no claim of background audio on a locked phone.
4. **Safe dataset reconciliation:** deterministic tool with explicit source revisions and reviewed mapping validation. It proposes 109 conservative matches; 767 unmatched source rows need human movement review, not blind addition. It never rewrites IDs, history or production catalogue/media.
5. **Deployment repairs:** remove Railway-rejected `VOLUME`; separate `BACKEND_PORT` from Railway's listener `PORT` while preserving Compose fallback. These are prepared source changes; see audit for live status and remaining deployment checks.

## Stable data and reliability boundaries

All pre-existing exercise, workout and routine IDs remain unchanged. The new walk/run entries use existing exercise IDs `2258` and `0685`; circuit stations use canonical existing IDs. No imported dataset ID can overwrite a main-app ID. A future import must use a reviewed source-ID-to-canonical-ID crosswalk or reserve a genuinely new permanent ID. Figure aliases and duplicate photos must never be treated as proof of a new/different movement.

The web store persists locally and merges server conflicts by identity; this is tested behavior, not a guarantee against browser storage eviction or an OS failure before a write becomes durable. Existing quota warnings and recovery/backup flows remain in place. Physical-phone airplane-mode, browser eviction, background/kill and multi-device production tests remain necessary before calling the deployment fully verified. An off-volume server backup with a tested restore remains outstanding.

## Next increments

- Verify the repaired Railway deployment, real-domain passkeys and owner-only registration/access.
- Confirm exact plate and dumbbell inventory; set up preferred routines and weekly schedule using the existing planner.
- Run a real-phone offline/reconnect/reload acceptance pass and independently restore a backup.
- Review only dataset entries that fill a demonstrated movement/instruction gap; do not add 876 near-duplicates.
- Evaluate foreground GPS separately from signed iOS/Watch work. Native code presence is not a tested integration.

Validation results and local launch instructions are maintained in [VALIDATION.md](VALIDATION.md).
