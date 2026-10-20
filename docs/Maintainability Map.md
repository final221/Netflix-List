# Maintainability Map

## Current implementation measurements

Release **1.11.5**, 2026-10-21: **70 runtime modules, 18,578 physical lines** (+5). The473-line native DOM adapter owns one content-span measurement shared by arrow sizing and layout diagnostics; reserved row space remains independent. No new module, state owner or loading policy. Generated output is separately **23,597 lines**.

Release **1.11.4**, 2026-10-21: **70 runtime modules, 18,573 physical lines** (+35 from 1.11.3). The 468-line native recommendation DOM adapter retains synchronous resource batching, fixed action-space presentation and bounded geometry diagnostics beside their existing leases; moving these would split the same resource lifecycle. Recommendations is275lines and limits scan repaint/arrow work; the125-line native-row owner reuses page-context discovery between interactions. No new module or persistence owner. Generated output is separately **23,590 lines**. This removes repeated work while adding geometry observability, not a source-reduction or measured frame-time claim.

Release **1.11.3**, 2026-10-21: **70 runtime modules, 18,538 physical lines** (+16 from 1.11.2). Native query verification/diagnostics remain in the 185-line query owner; automatic backoff and disabled retry handling remain in the 125-line row controller. The 155-line report preserves their four bounded records. No new module or persisted state is introduced. Generated output is separately **23,508 lines**. Added work is bounded diagnostic/validation policy, with fewer repeated unsupported lookups; live frame cost and loading compatibility remain unverified.

Release **1.11.2**, 2026-10-21: **70 runtime modules, 18,522 physical lines** (+61 from 1.11.1). The native query owner is 175 lines; the native-row controller is 120 lines. Semantic option admission/retained edge data remain native-owned; visibility admission, bounded loading and budget resumption remain feature-owned. No new module or persistence owner is added. Generated output is separately **23,475 lines**. This expands lifecycle and loading policy rather than reducing code; offline protocol/lifecycle tests do not establish live page fill.

Release **1.11.1**, 2026-10-20: **70 runtime modules, 18,461 physical lines** (+59 from 1.11.0). Query discovery remains in `netflix/recommendation-query.js` (142 lines), row lifecycle/diagnostic presentation in `recommendations/native-rows.js` (92 lines). Manual-only coverage is a bounded option of the existing viewing-data validator; browsing excludes it from automatic inference. Localized unavailable explanations remain in the UI catalog. No new module or persistence owner is introduced. Generated output is separately **23,357 lines**. These changes add admission observability and manual-readiness behavior; live compaction is not established.

Release **1.11.0**, 2026-10-20: **70 runtime modules, 18,402 physical lines** (+221 from 1.10.3). Private `netflix/recommendation-query.js` (127 lines) owns native query matching, original edge retention and cache/read operations; private `recommendations/native-rows.js` (87 lines) owns interacted-row scheduling, admission, bounds and retirement. Keeping protocol interpretation behind the DOM adapter avoids feature ownership of native client internals; keeping lifecycle policy in recommendations avoids native ownership of shared exclusions or route/profile policy. This adds functional integration rather than reducing code. Generated output is separately **23,297 lines**; tests/tooling are excluded. Offline API fixtures do not establish live renderer compatibility.

Release **1.10.3**, 2026-10-20: **68 runtime modules, 18,181 physical lines**. Stabilization removes automatic survey/body-capture work and idle refill geometry, avoids unchanged control writes and coalesces overlapping scan roots; native/admission owners remain unchanged. Generated output is separately 22,921 lines. These are work-reduction checks, not live frame-time evidence.

Release **1.10.2**, 2026-10-20: **68 authored runtime modules, 18,169 readable physical lines** (+143 from 1.10.1). Private `recommendations/row-buffer.js` (36 lines) owns visit-local ordered retention/filter projections; private `netflix/recommendation-loader.js` (69 lines) owns descriptor-only query-result interpretation. Keeping the inventory in the native adapter would couple page policy to private query shapes; embedding the query interpreter in recommendations would reverse that dependency. Recommendations owns row lifetime/admission; the DOM adapter owns native discovery. Generated output is separately 22,890 lines. This adds a bounded diagnostic checkpoint; visible paging integration remains pending.

Release **1.10.1**, 2026-10-20: **66 authored runtime modules, 18,026 readable physical lines**. Browsing readiness/transport batching and focused pagination discovery add 66 lines relative to 1.10.0; no module boundaries change. `viewing/browsing.js` is 165 lines; the native recommendation DOM adapter is 426 lines and retains DOM interpretation, leases and passive native-shape discovery together. Generated output is separately 22,682 lines. The following 1.10.0 table remains the shared-knowledge implementation checkpoint.

Release **1.10.0**, 2026-10-20: **66 authored runtime modules, 17,960 readable physical lines**, compared with 64 modules / 17,720 lines in 1.9.28. Counts include comments and blanks. This adds shared, durable viewing knowledge and active-tab synchronization; it is not a code-reduction claim. The old choices owner is removed, while the legacy cache reader remains read-only.

| Module under src/ | Lines | Responsibility |
| --- | ---: | --- |
| `viewing/knowledge.js` | 185 | Shared semantic authority, subscriptions and admitted session handles. |
| `viewing/knowledge-storage.js` | 79 | Per-title/fact persistence, retained episode evidence and exact listener lifecycle. |
| `viewing/knowledge-migration.js` | 60 | Validated, repeatable legacy import without source deletion. |
| `viewing/viewing.js` | 159 | My List scan/session facade and knowledge composition. |
| `viewing/browsing.js` | 136 | Bounded browsing title/season/finale checks and knowledge commands. |
| `viewing/scan.js` | 482 | Admitted automatic observations, existing request budgets and cancellation. |
| `viewing/cache.js` | 30 | Read-only legacy freshness adapter. |
| `app/application.js` | 132 | Application lifetime, shared knowledge construction and focus recovery. |
| `app/my-list-session.js` | 454 | Route composition, borrowing knowledge from application. |
| `app/my-list-display/viewing.js` | 89 | My List actions capture names while retaining grid/route admission. |
| `recommendations/recommendations.js` | 228 | Browsing controls and saved-choice commands, without a second persistence owner. |
| `recommendations/saved-choices-panel.js` | 75 | Saved rows, pending-history presentation and focus/Escape lifetime. |

New source estimates were 250–350 lines for knowledge, 180–280 for storage and 150–230 for migration. The implemented modules are smaller because they reuse the existing completion/data adapters and retain the compact read-only legacy-cache reader. Generated output is measured separately: **22127 → 22575 lines**. Tests and build tooling are excluded from authored runtime totals. Architecture owns continuing boundaries; findings records preservation evidence and remaining Firefox validation.

## Previous discovery refactor measurements (1.9.28)

Release **1.9.28**, 2026-10-12: **64 authored runtime modules, 17,720 readable physical lines**, compared with 63 modules / 17,702 lines in 1.9.27. Counts include comments and blanks, excluding a final empty line. Discovery owns a complete independent observer/frame lifecycle; the public carousel operations and session policies remain unchanged.

| Affected module under src/ | Before | After | Responsibility |
| --- | ---: | ---: | --- |
| `netflix/carousel/carousel.js` | 1,844 | 1,678 | Native source authority, interpretation, receipts, resolution, mapping/preparation and composition. |
| `netflix/carousel/discovery.js` | — | 184 | Filtered mutation targeting, discovery/coalescing policy and exact observer/frame retirement. |

The assessment estimated 1,680–1,710 lines for carousel and 190–220 for discovery. Actual counts are slightly smaller because the private constructor needs only the existing policy callbacks, lookup and scalar DOM names. Authored runtime grows by **18 lines**; this is an ownership/locality improvement rather than a code-reduction claim. The four added characterization cases add **125 test lines**, counted separately. Generated output changes separately from **22,081 → 22,127 lines**. Architecture owns the retained parent's responsibility and interface rationale.

## Previous display refactor measurements (1.9.27)

Release **1.9.27**, 2026-10-12: **63 authored runtime modules, 17,702 readable physical lines**, compared with 61 modules / 17,584 lines in 1.9.26. Source/presentation are consolidated behind display; the two previous entry points are removed. Counts include comments and blanks, excluding a final empty line. Net source change is **+118 lines**; ownership and reduced caller coordination are the improvement criteria.

| Affected module under src/ | Before | After | Responsibility |
| --- | ---: | ---: | --- |
| `app/my-list-session.js` | 481 | 454 | Route/request/pause lifetime, explicit display lifecycle outcomes and ordered teardown. |
| `app/my-list-display.js` | — | 780 | Complete accepted publication, adoption, layout and membership presentation; hides private resources. |
| `app/my-list-display/source.js` | — | 281 | Accepted source facts, membership/binding/hints, native leases, admission and geometry. |
| `app/my-list-display/viewing.js` | — | 89 | Exact viewing attachment/transfer, group delivery, manual choice and refresh. |
| `app/my-list-display/page-mapping.js` | — | 17 | One guarded hint/card update sequence with mode-specific eligibility. |
| `app/my-list-initialization.js` | 712 | 663 | Phase admissions, publication requests, scheduling, exact tickets and bounded recovery. |
| `app/my-list-interaction.js` | 545 | 537 | Hover/search/mismatch policy; accepted mapping repair belongs to display. |
| `app/my-list-diagnostics.js` | 182 | 157 | Passive display/work projections and diagnostic report delivery. |
| `app/responsive.js` | 602 | 566 | Measurement, settling, deferral and convergence; requests display layout/mapping operations. |

The display owner exceeds its 500–650 estimate because it retains complete source-adoption transactions, the existing list-feature adapter and explicit receipt/projection operations. Keeping these together makes their admission and write order local; private facts, viewing and shared mapping mechanics remain separate. Estimates were not size limits. Generated output changes separately from **21,863 → 22,081 lines**. Runtime source, tests and tooling are counted independently.

## Previous refactor measurements (through 1.9.26)

Release **1.9.26**, 2026-10-12: **61 authored runtime modules, 17,584 readable physical lines**. Counts include comments and blank lines, excluding a final empty line. Restoration extraction in 1.9.16 added 20 lines (17,381 → 17,401); initialization-exit consolidation in 1.9.17 removed six (17,401 → 17,395); diagnostic-record consolidation in 1.9.18 added three (17,395 → 17,398); recommendation-row sampling in 1.9.19 left the total unchanged; saved-panel ownership in 1.9.20 added 27 (17,398 → 17,425); responsive page-hint publication in 1.9.21 removes one (17,425 → 17,424). Readiness ownership in 1.9.22 adds 18 (17,424 → 17,442). Diagnostic snapshot sampling in 1.9.23 adds six (17,442 → 17,448). Diagnostic export simplification in 1.9.24 removes 27 lines (17,448 → 17,421) and the unreachable clipboard transport. Mismatch-dialog ownership in 1.9.25 adds ten lines (17,421 → 17,431). Session ownership in 1.9.26 adds 153 lines (17,431 → 17,584), including the responsive capability interface. These changes improve ownership/locality rather than reducing total source. Before/after counts below refer to each module's selected refactor.

| Affected module under src/ | Before | After | Responsibility |
| --- | ---: | ---: | --- |
| `netflix/carousel/carousel.js` | 2,014 | 1,844 | Native interpretation, binding/model/receipt validation and composition; delegates complete readiness policy and waits. |
| `netflix/carousel/readiness.js` | — | 188 | Private source polling, completion/stability policies, confirmation frames, timeout reporting and cancellable wait registry. |
| `netflix/carousel/navigation.js` | 1,253 | 829 | Movement queue, acknowledgement, stable-content waits, cancellation and motion leases; composes restoration. |
| `netflix/carousel/restoration.js` | — | 444 | Private strict/fast restoration, content verification, adjacent phase repair and strict fallback; owns no timers or queue. |
| `app/my-list-session.js` | 2,681 | 481 | Route/request/pause lifetime, collaborator wiring and ordered teardown. |
| `app/my-list-source.js` | — | 645 | Accepted read-only parent, binding/membership/page-hint references, staged grid acceptance, geometry and source transitions. |
| `app/my-list-presentation.js` | — | 260 | Grid publication, membership presentation and viewing-session attachment/transfer. |
| `app/my-list-initialization.js` | — | 712 | Phase admissions, exact initialization deferral tickets, scheduling and bounded native replacement recovery. |
| `app/my-list-interaction.js` | — | 545 | Native hover preparation, mapping repair and mismatch recovery. |
| `app/my-list-diagnostics.js` | — | 182 | Passive runtime/work projections and diagnostic report export. |
| `diagnostics/report.js` | 179 | 154 | Compact/detailed report construction and copied snapshots; delegates export to the required application-owned Save As writer. |
| `i18n/log-messages.js` | 138 | 136 | Diagnostic translations; obsolete clipboard fallback messages removed. |
| `grid/frame.js` | 373 | 330 | Owns status/root/empty/synthetic publication, geometry and frame cleanup; composes private dialog retirement/release. |
| `grid/mismatch-dialog.js` | — | 53 | Private mismatch DOM, listener/action admission, replacement and exact retirement/release. |
| `recommendations/navigation.js` | 102 | 105 | Passive interaction evidence; shared record creation with independent arrow/action histories and their existing timer/retirement owner. |
| `netflix/recommendation-dom.js` | 389 | 389 | Native recommendation DOM/leases and passive evidence; one private row sample shares visibility and geometry facts between refill and diagnostics. |
| `recommendations/recommendations.js` | 288 | 241 | Browsing composition, storage, metadata, native card leases and delegated input admission; supplies semantic panel facts and consumes captured commands. |
| `recommendations/saved-choices-panel.js` | — | 74 | Private saved-choice DOM/styles, grouping, open/close/focus, button identity and explicit Escape listener lifetime. |
| `app/responsive.js` | 593 | 602 | Complete responsive transaction; consumes source/presentation capabilities directly while retaining mapping/observation admission and clone policy. |

These counts trigger whole-module assessment, not automatic splitting or blanket retention. The generated userscript changes separately from 21,261 (1.9.15) to 21,311 (1.9.16) to 21,305 (1.9.17) to 21,298 (1.9.18) to 21,304 (1.9.19) to 21,341 (1.9.20) to 21,352 (1.9.21) to 21,402 (1.9.22) to 21,411 (1.9.23) to 21,375 (1.9.24) to 21,384 (1.9.25) to 21,863 (1.9.26) lines. The full inventory below remains a historical snapshot and does not describe current module totals.

## Historical full inventory

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
