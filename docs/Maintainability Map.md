# Maintainability Map

Snapshot: **1.4.67**, 2026-10-08, runtime revision `25c43b12a00b0a4ba83fd3219bb5de9e1e21fd42`.

The **42 authored runtime modules total 15,714 lines**. Counts include comments and blank lines, excluding a final empty line; CRLF and LF produce identical counts. Build tooling, tests and the generated userscript are excluded from this total.

This document provides a measured size inventory and short responsibility descriptions. [architecture.md](architecture.md) owns the implemented source map and architectural contracts; [findings.md](findings.md) owns simplification decisions and progress. These counts describe the snapshot above and should be remeasured when updating this map.

All module paths below are relative to [src/](../src/).

| Module | Lines | Responsibility |
| --- | ---: | --- |
| **Entry and shared names** | **45** | |
| `main.js` | 9 | Starts the application and supplies Tampermonkey capabilities. |
| `dom-names.js` | 36 | Shared DOM IDs, classes, attributes, and names from older releases. |
| **Application** | **3,482** | |
| `app/application.js` | 80 | Starts/stops the application, observes navigation, and manages the current page session. |
| `app/my-list-session.js` | 2,681 | Coordinates one My List visit: initialization, collection, grid, hover, viewing, mutations, and recovery. |
| `app/responsive.js` | 594 | Handles viewport changes, layout refresh, and native page remapping. |
| `app/session-scope.js` | 91 | Owns session cancellation, requests, and request deadlines. |
| `app/settings.js` | 36 | Saves preferences and registers/releases userscript menu commands. |
| **Diagnostics** | **209** | |
| `diagnostics/logger.js` | 85 | Formats logs and retains bounded history, with optional detailed tracing. |
| `diagnostics/report.js` | 124 | Assembles compact/full diagnostic exports and handles clipboard copying. |
| **Grid presentation** | **1,792** | |
| `grid/cards.js` | 187 | Owns displayed card identities, insertion, removal, replacement, and retained Undo markup. |
| `grid/frame.js` | 409 | Owns the grid container, heading/status, CopyLogs control, empty presentation, and mismatch dialog. |
| `grid/grid.js` | 124 | Combines the grid components into their public interface. |
| `grid/groups.js` | 352 | Presents My List and Watched/Caught up groups, filters, counts, and placement controls. |
| `grid/image-diagnostics.js` | 276 | Measures bounded thumbnail geometry and image-resource activity. |
| `grid/styles.js` | 444 | Styles the grid, cards, controls, dialogs, and native carousel presentation. |
| **Hover interaction** | **789** | |
| `hover/hover.js` | 628 | Handles pointer intent, dwell, cancellation, scrolling, retries, and popup preparation. |
| `hover/timing.js` | 161 | Collects hover timing, counters, and bounded animation-frame gap samples. |
| **Localization** | **887** | |
| `i18n/i18n.js` | 103 | Selects locales, resolves translations, and formats plurals and numbers. |
| `i18n/log-messages.js` | 138 | English/Japanese diagnostic-message translations. |
| `i18n/ui-messages.js` | 646 | User-interface translations for supported locales. |
| **List membership** | **773** | |
| `list/collection.js` | 202 | Chooses collection strategies and requires a complete list before publication. |
| `list/list.js` | 24 | Combines list capabilities and normalizes scalar membership records. |
| `list/membership.js` | 111 | Owns authoritative membership, ordering, counts, and position-deviation checks. |
| `list/mutations.js` | 436 | Reconciles native add/remove actions, queued changes, Undo, and expiry. |
| **Netflix integration** | **2,236** | |
| `netflix/card-markup.js` | 75 | Captures, sanitizes, and creates detached card markup. |
| `netflix/context.js` | 101 | Reads Netflix profile, language, and request context. |
| `netflix/list-data.js` | 550 | Reads bootstrap/GraphQL list data, pagination, counts, titles, and artwork. |
| `netflix/native-popup.js` | 728 | Connects cloned cards to Netflix's native hover behavior through React references, geometry, events, and preview handling. |
| `netflix/page-dom.js` | 308 | Interprets Netflix page elements, card identities, membership controls, and empty states. |
| `netflix/popup-inspection.js` | 219 | Performs bounded, passive inspection of popup-related responses and component shapes. |
| `netflix/viewing-data.js` | 255 | Requests and interprets Netflix viewing, season, and episode metadata. |
| **Native carousel** | **4,659** | |
| `netflix/carousel/carousel.js` | 2,166 | Owns native source bindings, discovery, readiness, observations, geometry, mapping, and card resolution. |
| `netflix/carousel/collection.js` | 746 | Collects native cards across pages, validates consistency, and restores the starting page. |
| `netflix/carousel/navigation.js` | 1,253 | Serializes native movement, waits for acknowledgement/stability, and performs restoration and repair. |
| `netflix/carousel/page-model.js` | 234 | Tracks logical pages, signatures, page hints, and wrapped-tail index interpretation. |
| `netflix/carousel/react-readings.js` | 83 | Reads bounded React properties for card indices and carousel counts. |
| `netflix/carousel/source-presentation.js` | 177 | Applies and restores native source decoration, visibility, scanning, and parking. |
| **Viewing status** | **842** | |
| `viewing/cache.js` | 47 | Reads/writes profile-specific automatic viewing-status caches. |
| `viewing/choices.js` | 114 | Persists manual choices and expires series corrections when reliable coverage changes. |
| `viewing/completion.js` | 74 | Classifies playback completion, credits thresholds, and series/latest-episode results. |
| `viewing/scan.js` | 483 | Runs bounded viewing requests, finale checks, repairs, incremental publication, and network accounting. |
| `viewing/viewing.js` | 124 | Combines viewing policies and exposes profile-specific sessions and placement operations. |
| **Total** | **15,714** | **42 modules** |

The three largest modules—page session, carousel, and navigation—contain **6,100 lines (38.8%)** of the authored runtime. The two translation catalogs and stylesheet account for another **1,228 lines**, mostly declarative content. Line count describes size; it does not by itself establish complexity or safe reduction potential.

For comparison, `scripts/build.mjs` contains **65 lines**, `scripts/check.mjs` contains **157 lines**, and the full generated `dist/My List for Netflix.user.js` contains **18,776 lines**. Authored modules remain the primary maintainability measure; generated output is measured separately.
