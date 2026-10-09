# Maintainability Map

Snapshot: **1.4.68**, 2026-10-09, private carousel geometry extraction.

The **43 authored runtime modules total 15,725 lines**. Counts include comments and blank lines, excluding a final empty line; CRLF and LF produce identical counts. Build tooling, tests and the generated userscript are excluded from this total.

This document provides a measured size inventory and short responsibility descriptions. [architecture.md](architecture.md) owns the implemented source map and architectural contracts; [findings.md](findings.md) owns simplification decisions and progress. These counts describe the snapshot above and should be remeasured when updating this map.

**Comment-only** counts lines occupied solely by comments, including block-comment delimiters and blank lines inside block comments. **Inline comments** counts lines containing both code and a comment; those lines are already included in Lines and must not be subtracted as comment-only. Multiple comments on one line count once. JavaScript comments are identified by a parser, so URLs, regular expressions and comment-like text in strings are excluded; the two actual CSS comment lines in `grid/styles.js` are included.

Overall: **354 comment-only lines**, **4 lines with inline comments**, and **809 blank lines outside comments**. The remaining **14,562 lines contain code or data**, including lines with inline comments. These categories describe physical lines, not executable statement counts.

All module paths below are relative to [src/](../src/).

| Module | Lines | Comment-only | Inline comments | Responsibility |
| --- | ---: | ---: | ---: | --- |
| **Entry and shared names** | **45** | **1** | **0** | |
| `main.js` | 9 | 0 | 0 | Starts the application and supplies Tampermonkey capabilities. |
| `dom-names.js` | 36 | 1 | 0 | Shared DOM IDs, classes, attributes, and names from older releases. |
| **Application** | **3,482** | **77** | **0** | |
| `app/application.js` | 80 | 0 | 0 | Starts/stops the application, observes navigation, and manages the current page session. |
| `app/my-list-session.js` | 2,681 | 56 | 0 | Coordinates one My List visit: initialization, collection, grid, hover, viewing, mutations, and recovery. |
| `app/responsive.js` | 594 | 15 | 0 | Handles viewport changes, layout refresh, and native page remapping. |
| `app/session-scope.js` | 91 | 5 | 0 | Owns session cancellation, requests, and request deadlines. |
| `app/settings.js` | 36 | 1 | 0 | Saves preferences and registers/releases userscript menu commands. |
| **Diagnostics** | **209** | **5** | **0** | |
| `diagnostics/logger.js` | 85 | 1 | 0 | Formats logs and retains bounded history, with optional detailed tracing. |
| `diagnostics/report.js` | 124 | 4 | 0 | Assembles compact/full diagnostic exports and handles clipboard copying. |
| **Grid presentation** | **1,792** | **21** | **1** | |
| `grid/cards.js` | 187 | 5 | 1 | Owns displayed card identities, insertion, removal, replacement, and retained Undo markup. |
| `grid/frame.js` | 409 | 2 | 0 | Owns the grid container, heading/status, CopyLogs control, empty presentation, and mismatch dialog. |
| `grid/grid.js` | 124 | 0 | 0 | Combines the grid components into their public interface. |
| `grid/groups.js` | 352 | 2 | 0 | Presents My List and Watched/Caught up groups, filters, counts, and placement controls. |
| `grid/image-diagnostics.js` | 276 | 10 | 0 | Measures bounded thumbnail geometry and image-resource activity. |
| `grid/styles.js` | 444 | 2 | 0 | Styles the grid, cards, controls, dialogs, and native carousel presentation. |
| **Hover interaction** | **789** | **27** | **0** | |
| `hover/hover.js` | 628 | 21 | 0 | Handles pointer intent, dwell, cancellation, scrolling, retries, and popup preparation. |
| `hover/timing.js` | 161 | 6 | 0 | Collects hover timing, counters, and bounded animation-frame gap samples. |
| **Localization** | **887** | **18** | **0** | |
| `i18n/i18n.js` | 103 | 18 | 0 | Selects locales, resolves translations, and formats plurals and numbers. |
| `i18n/log-messages.js` | 138 | 0 | 0 | English/Japanese diagnostic-message translations. |
| `i18n/ui-messages.js` | 646 | 0 | 0 | User-interface translations for supported locales. |
| **List membership** | **773** | **12** | **0** | |
| `list/collection.js` | 202 | 1 | 0 | Chooses collection strategies and requires a complete list before publication. |
| `list/list.js` | 24 | 1 | 0 | Combines list capabilities and normalizes scalar membership records. |
| `list/membership.js` | 111 | 1 | 0 | Owns authoritative membership, ordering, counts, and position-deviation checks. |
| `list/mutations.js` | 436 | 9 | 0 | Reconciles native add/remove actions, queued changes, Undo, and expiry. |
| **Netflix integration** | **2,236** | **59** | **0** | |
| `netflix/card-markup.js` | 75 | 3 | 0 | Captures, sanitizes, and creates detached card markup. |
| `netflix/context.js` | 101 | 5 | 0 | Reads Netflix profile, language, and request context. |
| `netflix/list-data.js` | 550 | 8 | 0 | Reads bootstrap/GraphQL list data, pagination, counts, titles, and artwork. |
| `netflix/native-popup.js` | 728 | 21 | 0 | Connects cloned cards to Netflix's native hover behavior through React references, geometry, events, and preview handling. |
| `netflix/page-dom.js` | 308 | 12 | 0 | Interprets Netflix page elements, card identities, membership controls, and empty states. |
| `netflix/popup-inspection.js` | 219 | 6 | 0 | Performs bounded, passive inspection of popup-related responses and component shapes. |
| `netflix/viewing-data.js` | 255 | 4 | 0 | Requests and interprets Netflix viewing, season, and episode metadata. |
| **Native carousel** | **4,670** | **104** | **1** | |
| `netflix/carousel/carousel.js` | 2,014 | 29 | 0 | Owns native source bindings, discovery, readiness, observations, geometry admission/read caches, mapping, and card resolution. |
| `netflix/carousel/layout.js` | 163 | 17 | 0 | Interprets slot formulas and measures populated/empty geometry using carousel-owned DOM readers. |
| `netflix/carousel/collection.js` | 746 | 15 | 1 | Collects native cards across pages, validates consistency, and restores the starting page. |
| `netflix/carousel/navigation.js` | 1,253 | 35 | 0 | Serializes native movement, waits for acknowledgement/stability, and performs restoration and repair. |
| `netflix/carousel/page-model.js` | 234 | 4 | 0 | Tracks logical pages, signatures, page hints, and wrapped-tail index interpretation. |
| `netflix/carousel/react-readings.js` | 83 | 1 | 0 | Reads bounded React properties for card indices and carousel counts. |
| `netflix/carousel/source-presentation.js` | 177 | 3 | 0 | Applies and restores native source decoration, visibility, scanning, and parking. |
| **Viewing status** | **842** | **30** | **2** | |
| `viewing/cache.js` | 47 | 0 | 1 | Reads/writes profile-specific automatic viewing-status caches. |
| `viewing/choices.js` | 114 | 1 | 0 | Persists manual choices and expires series corrections when reliable coverage changes. |
| `viewing/completion.js` | 74 | 4 | 0 | Classifies playback completion, credits thresholds, and series/latest-episode results. |
| `viewing/scan.js` | 483 | 24 | 1 | Runs bounded viewing requests, finale checks, repairs, incremental publication, and network accounting. |
| `viewing/viewing.js` | 124 | 1 | 0 | Combines viewing policies and exposes profile-specific sessions and placement operations. |
| **Total** | **15,725** | **354** | **4** | **43 modules** |

The three largest modules—page session, carousel, and navigation—contain **5,948 lines (37.8%)** of the authored runtime. The two translation catalogs and stylesheet account for another **1,228 lines**, mostly declarative content. Line count describes size; it does not by itself establish complexity or safe reduction potential.

For comparison, `scripts/build.mjs` contains **65 lines**, `scripts/check.mjs` contains **157 lines**, and the full generated `dist/My List for Netflix.user.js` contains **18,796 lines**. Authored modules remain the primary maintainability measure; generated output is measured separately.
