# Home-gym interface design credits

Adaptation date: 2026-11-08.

## Design source and license

The home-gym interface adapts the visual design of **Fitness App UI Kit for Gym Workout App Fitness Tracker Mobile App Gym Fitness Mobile App UI Kit** (the FitBody design) by **Vectorfair**:

- [Original Figma Community resource](https://www.figma.com/community/file/1356281690251535631)
- [Selected design copy](https://www.figma.com/design/leCG8yQhCXk3uj8ivd9pr9/Fitness-App-UI-Kit-for-Gym-Workout-App-Fitness-Tracker-Mobile-App-Gym-Fitness-Mobile-App-UI-Kit--Community-?node-id=1-422)
- [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)

The original Community listing was inspected in the browser and explicitly identifies Vectorfair and CC BY 4.0. Figma's [Community copyright and licensing policy](https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing) also states that free design files use that license.

Changes adapt the kit's typography, colors, and visual hierarchy to the existing openGym home-gym application and its navigation, equipment, routines, logging, and history. The implementation retains the main app's architecture and data model. This is a modified design, not the original kit, and no endorsement by Vectorfair is implied. The main application's code remains under its existing AGPL license; this credit does not relicense third-party design material or fonts.

When sharing this adaptation, retain the creator credit, original-resource link, license link, and indication of modifications. CC BY 4.0 licenses only the rights its licensor has authority to grant; it does not establish a separate stock-photo license or blanket rights to depicted people and brands.

## Adapted screens

The implementation uses the selected file's Home (`3180:754`), Login (`3137:3374`), Workout Log (`3115:4055`), Workouts (`3027:2839`), Settings (`3186:6587`), Progress (`3178:4145`), colors (`3250:2227`) and typography (`3250:2312`) as design references. It is a responsive adaptation to the existing app, not a reproduction of every kit screen.

- Shared charcoal surfaces, lime actions, lavender navigation, typography and rounded controls apply throughout the app. Light themes, custom accents, safe areas and reduced motion remain supported.
- Home shows real saved routines, the existing training week, equipment access, manual walking/running logs and timed circuits.
- Routine lists and workout history use the kit's card styling. Existing editing, ordering, charts, logging and synchronization remain connected to the same data model and IDs.
- Sign-in retains the actual passkey, optional password, recovery, device-link and guest-availability logic. No mock social sign-in is introduced.
- Settings → About & updates displays the design credit and links to these font and design notices.

Local verification covered 320px and 393px phone layouts, routine creation and navigation, manual walking entry surviving reload, history, the calendar, progress and settings. The frontend suite passed 7,875 tests before the final SVG-cache extension; that extension has focused service-worker tests. No database migration, exercise import or production deployment is part of the design source itself. Physical-device offline synchronization and native integrations are separate validations.

## Fonts bundled locally

| Family | Use | Included weights and subsets | License |
| --- | --- | --- | --- |
| Poppins | Headings | Normal 400, 500, 600, 700; Latin and Latin Extended | SIL Open Font License 1.1 |
| League Spartan | Body text | Variable normal 300–700; Latin and Latin Extended | SIL Open Font License 1.1 |

Poppins is copyright 2020 The Poppins Project Authors, with upstream at [itfoundry/Poppins](https://github.com/itfoundry/Poppins). League Spartan is copyright 2020 The League Spartan Project Authors, with upstream at [theleagueof/league-spartan](https://github.com/theleagueof/league-spartan).

The unmodified WOFF2 subsets were downloaded from Google's versioned `fonts.gstatic.com` URLs returned by the Google Fonts CSS API. Ten files total **97,436 bytes**. [SOURCES.json](../../frontend/src/assets/fonts/SOURCES.json) records the exact download URLs, weights, subsets, byte sizes, SHA-256 hashes, license sources, and retrieval date. No dependency or package was added. The checked-in files are the build input; building and running do not contact Google Fonts.

The full notices ship with the application as [Poppins-OFL.txt](../../frontend/public/fonts/Poppins-OFL.txt) and [League-Spartan-OFL.txt](../../frontend/public/fonts/League-Spartan-OFL.txt). They were retrieved from the [Google Fonts Poppins license](https://github.com/google/fonts/blob/main/ofl/poppins/OFL.txt) and [Google Fonts League Spartan license](https://github.com/google/fonts/blob/main/ofl/leaguespartan/OFL.txt). Keep those copyright and license texts with redistributed font files. The font files remain OFL-licensed, separate from the app code's license.

`frontend/src/fonts.css` provides local `@font-face` rules with `font-display: swap`. Vite fingerprints the files and rewrites the relative URLs, including for subpath hosting. Latin Extended covers accented Latin text; scripts outside the supplied subsets use the interface's system-font fallbacks.

The service-worker build lists WOFF2 files and bundled SVG icons alongside prefetched application assets. Once fetched at installation, their hashed URLs are served from cache first, including under a subpath. A font that cannot be fetched does not prevent a working app from installing; fallback fonts keep text readable. Native builds bundle the same local assets. Tests cover font prefetch, rejection of redirected font responses, and cached fonts/icons with an unresponsive network at both the root and a subpath.

## Images and other assets

Four original vector exports from Home (`3180:754`) are included unchanged in `frontend/src/assets/fitbody/`: `workout.svg` (32×32), `progress.svg` (28.0816×32), `search.svg` (19×18.1364), and `profile.svg` (14.4878×18). They are attributed to Vectorfair under the design's CC BY 4.0 license. Intrinsic SVG geometry is preserved; larger button targets surround them. Figma's temporary asset URLs are not used at runtime. All other interface glyphs remain the existing app's icons.

**No stock photos from the Figma kit are imported.** The kit's design license is not treated as proof of rights to its embedded photographs. The existing openGym exercise stills and animations remain governed by the separate Gym visual terms in [NOTICE.md](../../NOTICE.md) and [catalogue/media/NOTICE.md](../../catalogue/media/NOTICE.md); they are not relicensed under CC BY or OFL. Preserve upstream attribution and the existing media restrictions.
