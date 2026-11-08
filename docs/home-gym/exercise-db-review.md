# Free Exercise DB review

Inspected 2026-11-08 at commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`.
Reference checkout: `/private/tmp/home-gym-references/free-exercise-db`.
Source: [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5).
The reference checkout is outside the production repository and is not a build dependency.

## What it implements

| Capability | Evidence and result |
| --- | --- |
| Exercise dataset | `exercises/*.json` and `dist/exercises.json`: 876 entries with unique string IDs and unique case-insensitive names at the inspected commit. |
| Metadata | `schema.json`: name, force, level, mechanic, equipment, primary/secondary muscles, instructions, category, image paths. Force/mechanic/equipment can be null. |
| Home-gym coverage | 170 barbell, 123 dumbbell, 111 body-only, 56 kettlebell, and 9 EZ-bar rows: 469 with explicitly relevant equipment. Another 199 have `other` or null equipment and need review. |
| Browse/search | `site/src/components/SearchBar.vue`: Vue 3 catalogue, Fuse name search, progressive loading, and saved exercises persisted to localStorage. Search does not implement an equipment inventory. |
| Instructions and images | `ExerciseInstructions.vue`, `PhotoGallery.vue`: step display and a two-image gallery. Photos are served through the author's ImageKit account in the reference frontend. |
| Workout application | No implemented workout logging, routines, weekly planning, timers, progress records, server synchronization, cardio history, HealthKit, or watch app was found in this repository. Saved exercises are bookmarks, not routines. |

The dataset is valuable as a cross-reference, not as a replacement application. Its Vue 3/Vite 4/Tailwind/Fuse frontend would add a second interface and outdated parallel dependencies to the React 19/Vite 8 main app. Reuse data concepts where useful; do not merge that frontend or depend on its ImageKit endpoint.

## Data quality and identity

Measured from the inspected checkout:

- 77 entries have null equipment, 30 have null force, 87 have null mechanic, and 5 have empty instruction arrays.
- 1,746 referenced image files exist. SHA-256 comparison finds 22 duplicate-content groups with 25 redundant files. Duplicate photos do not establish duplicate exercise identity.
- IDs are readable strings such as `Kettlebell_Figure_8`. Treat them as opaque source IDs: do not regenerate them from names and do not substitute them for existing openGym IDs.
- The schema uses `kettlebells`, `body only`, and `e-z curl bar`; openGym uses `kettlebell`, `body weight`, and `ez barbell`. Muscle and category names also differ. `powerlifting`, `strongman`, and `olympic weightlifting` cannot simply be copied into openGym's constrained category field.
- Equipment alone does not establish a complete inventory requirement: a body-only pull-up still needs a bar; a dumbbell press may need a bench. Preserve openGym's accessory checks and verify rack/bench needs for any future addition.

The main catalogue has **6,554 permanent entries, including 5,632 canonical exercises and 922 figure variants**. It already includes 389 barbell, 757 dumbbell, 2,246 body-weight, and 187 kettlebell exercises. A bulk append would add considerable duplication.

`catalogue/README.md`, `scripts/catalogue/validate.mjs`, and `frontend/src/lib/catalogue-continuity.test.js` establish permanent 4–5 digit string IDs. History and routines reference those IDs. `variantOf` denotes an alternate illustration of a canonical exercise, not a new exercise to import. Existing explicit user merges use `frontend/src/lib/exercise-merge.js` and synchronized redirects; a data refresh must never perform those merges implicitly.

## Code, text, and media licenses

| Material | Inspected evidence | Decision |
| --- | --- | --- |
| Free Exercise DB code | Root `LICENSE.md` is the Unlicense, a public-domain dedication with a fallback permission and no-warranty text. | Compatible reuse is possible; retain source, revision, and notices for provenance. The added reconciliation script is original code in the main app's existing license. |
| Free Exercise DB exercise data | README describes an open public-domain dataset and credits `wrkout/exercises.json`; that upstream also has an Unlicense file. | Usable as a source reference, with exact source IDs and revision retained. Do not assume descriptions are complete or match a similarly named openGym movement. |
| Free Exercise DB photos | README explicitly advertises imagery and reuse, but neither the JSON records nor a separate media manifest supplies photographer, per-photo rights, releases, or an auditable chain back to original owners. The root license speaks about software. | The repository claims openness, but this inspection did not independently verify original rights for every image. **No photos are imported or hotlinked in this change.** Verify the particular images before adding them. |
| Site icons | README separately credits Dragon Icons / Flaticon for the favicon. | Do not copy the site's branding or favicon on the strength of the root code license. |
| Existing openGym media | `NOTICE.md` and `catalogue/media/NOTICE.md`: Gym visual media is separate from AGPL; the main notice permits noncommercial forks to keep unmodified 180 px media with its notice. | Keep existing assets in this personal openGym fork, unmodified and with notices. Do not export them to independent apps or use them as AI inputs. |

The original dataset's [README](https://github.com/wrkout/exercises.json/blob/master/README.md) and [license](https://github.com/wrkout/exercises.json/blob/master/LICENSE.md) were also checked. This documents the publishers' claims and the remaining media evidence gap; it is not a declaration that unverified photos are cleared. See the [Unlicense text](https://unlicense.org/) for the actual grant.

## Implemented reconciliation tool

`scripts/home-gym/reconcile-exercises.mjs` reads the separate checkout and current production catalogue and emits a deterministic JSON report to stdout:

```sh
node scripts/home-gym/reconcile-exercises.mjs /private/tmp/home-gym-references/free-exercise-db > /private/tmp/home-gym-free-db-reconciliation.json
node --test scripts/home-gym/reconcile-exercises.test.mjs
```

The report preserves source IDs, canonical target IDs, source revision, equipment, scope, and all candidate matches. Normalization handles typography only; it does not erase handedness, stance, or equipment. Matching names and equipment produce **review candidates**, never automatic imports. The first run found 109 candidate rows and 767 unmatched rows. “Unmatched” means the conservative matcher found no name match, not that openGym lacks the movement; for example, reordered words and synonyms need review.

An optional second argument accepts an explicitly reviewed crosswalk:

```json
{
  "source": "https://github.com/yuhonas/free-exercise-db",
  "revision": "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5",
  "mappings": {
    "SOURCE_ID": {
      "targetId": "EXISTING_CANONICAL_ID",
      "sourceName": "Exact source name",
      "targetName": "exact existing name",
      "note": "What was reviewed to establish the same movement and equipment"
    }
  }
}
```

Every nonempty reviewed crosswalk must provide its own exact `source` and `revision` pins; omitting either makes the CLI fail. Empty candidate reports require no crosswalk or pins. Mappings fail closed when the source revision, source ID, target ID, reviewed names, or known equipment no longer agree. Noncanonical targets, missing alias targets, alias cycles, and duplicate IDs are rejected. Inherited object properties never count as reviewed mappings. The script does not write catalogue files, instructions, images, user state, or history, and needs no additional package dependency. Eleven tests cover stable IDs, repeatability, ambiguity, stale mappings, required source/revision pins, prototype-name IDs, alias failures, apparatus/side differences, and unknown equipment.

Before a future import: review the movement and accessories; reuse an existing canonical ID when equivalent; otherwise reserve a new permanent main-app ID and record the source crosswalk. Add reviewed text only under documented terms. Extend the catalogue build's media handling first: it currently synthesizes `<id>.webp` and `<id>.mp4` for every row, so naive new rows would imply nonexistent licensed assets. Run catalogue validation, generated-output checks, continuity tests, and import idempotence/history tests before shipping.
