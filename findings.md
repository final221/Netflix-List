# Findings and follow-up plan

Updated: 2026-09-30

This file records the code-review findings and the agreed follow-up plan for My List for Netflix. It is a working record; the plan does not authorize extra code changes beyond the step the user has chosen to pursue.

## G — Netflix-specific dependencies

### Current result

The agreed G scope is complete in the first adapter pass (`91b2c09`). Netflix GraphQL access and response handling are grouped in `netflixGraphql`; browse-row and carousel DOM discovery are grouped in `netflixDom`; private React carousel metadata and cloned-card hover behavior are grouped in `netflixReactCarousel` and `netflixReactHover`.

This puts the Netflix-specific assumptions behind clearer boundaries, making the code easier to inspect and giving future fixes a more obvious place to go. It does not remove the dependencies: the script still relies on Netflix's undocumented GraphQL response shapes, DOM attributes and layout, and private React metadata. Netflix can change those contracts and break a feature.

### What further work could provide

- **More centralization:** Moving remaining Netflix selectors or structural assumptions into the adapters would make them easier to locate and update together. It would mainly improve maintenance; by itself it should not change Netflix behavior or improve runtime performance.
- **More hardening:** Validate expected response and DOM shapes at integration boundaries, then report a specific failure when an assumption is missing. This can prevent confusing downstream errors and make diagnosis easier. It cannot ensure a feature keeps working after Netflix changes its internals.
- **New fallback behavior:** Try a second data or UI path if the preferred one fails. Existing code already has some fallbacks, including a page-bootstrap route when a fresh GraphQL collection fails, and alternate structural/identity clues for finding the My List row. A new fallback could improve availability only if its alternate source is trustworthy.

The highest-risk areas are the private React metadata used to determine logical carousel indices/counts and the React data grafted onto cloned cards so hover behavior works. Guessing indices or silently dropping React-dependent hover behavior could yield wrong ordering or changed interactions. No additional fallback has been selected or implemented: first observe a concrete Netflix break, then choose a fallback that preserves correctness and expected behavior. The original G goal is complete; optional extra hardening is not an open implementation task by itself.

## Logging note for E

The diagnostic entries are kept in a page-memory array capped at 5,000 entries and are also sent to the browser console. They are not persisted as log history in local or session storage. “Copy Logs” explicitly copies a diagnostic snapshot and the retained entries to the clipboard. The snapshot includes page and browser details, and individual entries can include item identifiers or URLs when those are logged.

Changing this would affect diagnostics, not Netflix's list or server behavior. Keeping detailed logs is useful for troubleshooting; any runtime cost comes from formatting, retaining, and writing log messages, and reducing copied details is not a meaningful grid-performance improvement. The user chose to defer E while keeping the option on the plan.

## Plan

| Point | Status | Planned work or result |
| --- | --- | --- |
| A. Align names | Done (`610d0bc`) | Tampermonkey and internal diagnostic names use “My List for Netflix.” |
| B. Preserve list changes during busy operations | Done (`f5d9c47`) | Queue and retry add/remove changes after initialization or responsive refresh completes. |
| C. Reduce observer work | Done (`eddea01`) | Narrow mutation-observer work to the My List area while still detecting replacement of that area. |
| D. Improve large-list performance | Done (`0219686`) | Defer thumbnail loading and delegate grid hover handling. |
| E. Limit copied log details | Deferred by user | Keep useful counts and errors; make titles, URLs, and video IDs opt-in or omit them from the standard copied report. Keep the current detailed logging for now. |
| F. Remove unused diagnostic code | Done (`5fdef5d`) | Remove `runVirtualIndexPagingDiagnostic`, which had no caller. |
| G. Isolate Netflix-specific dependencies | Done (`91b2c09`) | Group GraphQL, DOM, and React-dependent behavior behind adapters. Additional centralization, hardening, or fallbacks should be driven by a concrete maintenance or breakage need. |

## Performance review — userscript 1.0.7

Review date: 2026-09-30. The user reports stutters while scrolling the grid and observes the native My List carousel moving when scrolling back upwards. This review covers scrolling, hover, rendering, initialization, memory, and network work. No performance implementation step has been selected or applied.

### Evidence and limits

- Reviewed the initialization and collection paths, grid construction, image handling, React hover bridge, carousel navigation and waits, native binding checks, mutation/resize observers, logging, and route cleanup.
- Ran isolated Node checks against functions extracted from the unchanged userscript, with mock DOM objects. These confirm control flow and operation counts; they do not measure browser frame times, layout, image decoding, or Netflix's own React work.
- There is no live browser performance recording for the reported session. List size, browser, source-card dimensions, and whether thumbnails were already cached are unknown. Findings below distinguish definite work in the code from possible explanations of the observed stutters.
- Existing C and D improvements remain useful: the document observer is scoped to My List after discovery, images in displayed clones use lazy loading and async decoding, and hover listeners are delegated. Those changes do not eliminate the work described below.

### P1. Scrolling can start native-carousel hover preparation

Locations: `HOVER_ACTIVATION_DELAY_MS` (line 52), `handleGridClonePointerOver` (8240), `activateClone` (8109), `resolveExpectedPageSourceItem` (7245), `goToPage` (4862), `prepareMountedPage` (7800).

Every qualifying pointer entry checks the selected native page. A ready clone can immediately reuse and replay a native hover; otherwise the activation timer has a zero delay. Preparation navigates the real Netflix carousel to the item's page, resolves the source card, invalidates old grafts, and clones/grafts/replaces the current page's grid cards. A distant target can require multiple native page moves and Netflix renders.

There is no scroll-activity guard or hover-intent delay. A stationary pointer can receive boundary events when content moves underneath it, as described in the [W3C Pointer Events specification](https://www.w3.org/TR/pointerevents3/#boundary-events-caused-by-layout-changes). Consequently, scrolling over cards is a plausible trigger for native-carousel movement even without deliberate hovering. This is the strongest code-based explanation for the user's observation, but the actual event sequence still needs a browser trace.

The populated grid is built after collection and count validation (`runScript`, 9495–9550). Ordinary scrolling has no explicit scroll or wheel handler that restarts collection; completed populated sections are also skipped. Responsive refresh remaps existing items without a full collection scan. Native movement after the grid is ready therefore does not by itself mean initialization is still scanning or looping. Hover navigation and bounded recovery searches can look similar; genuine section replacement or reinitialization is another possible cause.

Proposed improvement: gate both the ready-source reuse and preparation paths before expensive page/geometry reads. Use a short hover-intent dwell, suspend activation during scrolling, and resume only for a still-valid target after scrolling settles. Preserve native hover controls, clicks, keyboard navigation, and ordering checks. Avoid silently preparing whichever card ends up under the pointer after an unrelated scroll.

### P1. Cancelled hovers can keep doing work and delay newer hovers

Locations: `handleGridClonePointerLeave` (8285), `moveOnePage` (4710), `waitLogicalPageChange` (4539), `waitForScriptMoveSettle` (4669), `waitStableCurrentPage` (5275), `waitForMountedSourceItem` (7199).

Leaving a pending card changes `hoverToken`, and the higher-level paths check it at several checkpoints. However, the inner logical-page/stability/source waits check the route session rather than hover cancellation. A move already started can continue polling and reading geometry after its hover is obsolete. Its serialized `carouselMoveQueue` entry is released only when that move finishes, so the latest hover may wait behind old work.

Configured upper bounds include 3,000 ms for a logical page change, 650 ms for the expected-page hydration wait, and 500 ms for mounted-source polling at 10 ms intervals. These are timeout ceilings, not measured normal delays; awaiting them does not continuously block JavaScript. Their recurring callbacks can nevertheless consume main-thread time.

Proposed improvement: make hover-specific waits cancellation-aware, stop obsolete polling promptly, and coalesce preparation around the latest target. An already-clicked native move must still settle safely before another move begins; cancellation must not leave styles, source geometry proxies, or carousel state inconsistent. Initialization/restoration waits need their separate correctness guarantees.

### P2. The observer treats script UI changes as native-list changes

Locations: `bindTargetDocumentObserver` (8951), `handleTargetDocumentMutation` (9025), `handleRelevantTargetDocumentMutation` (8999), `ensureLiveNativeBinding` (3924), `readNativeMyListDomState` (3207), `updateStatus` (4129).

The selected section is observed with `childList: true, subtree: true`. That section contains both the native carousel and the script's grid/status. Any child mutation inside it is classified as relevant, including `oldClone.replaceWith(fresh)` and status text replacement. For an initialized grid, the callback synchronously checks the native binding.

That check reads considerably more than element identity: section discovery, carousel profile/page selection, GraphQL count, visible-card geometry and identities, and slot/card counts. It runs even when the native binding has not changed. The observer batches records per callback; this is extra work per delivered batch, not necessarily one complete check per replaced card or an infinite observer loop.

Isolated check: a mutation targeted at the grid, status, or native subtree each caused one binding check; an unrelated target caused none.

Proposed improvement: ignore mutations wholly inside script-owned grid/status subtrees while retaining section/scroller/track replacement detection and real Netflix card changes. Separate a cheap binding-identity check from a detailed state read; coalesce native-state work when several relevant batches arrive together. Only update status text and geometry when values change.

### P2. Full DOM retention and synchronous cloning scale with list size

Locations: `buildGrid` (8329), grid CSS (1818–1867), `buildGraphqlMyListItems` (2793), `itemFromSlot` (5382), `invalidateGridReact` (7629), React grafting (7088), `prepareMountedPage` (8000–8058).

All items are rendered into one CSS grid; there is no row virtualization or offscreen rendering containment. Each item also retains a detached full-card `snapshot`, so the steady state includes roughly two script-owned card trees per item, plus the native carousel. The displayed trees remain live as the user scrolls. Lazy image loading does not reduce DOM retention.

Both GraphQL snapshot construction and grid cloning process the entire list synchronously. Grid assembly already happens while detached, so merely adding a DocumentFragment does not address its main cost. Hover preparation also scans every grid clone to invalidate grafts and replaces all current-page clones, allocating fresh DOM and React fiber chains even for unhovered cards.

Isolated check: with only six ready cards, invalidation inspected 30, 150, and 600 clones for grids of those sizes, clearing six each time. This confirms linear inspection cost, not a measured stutter threshold.

Proposed improvement: track only the currently grafted clones; refresh only stale cards or the needed target where Netflix compatibility allows; replace retained snapshots with compact item data and reusable templates. Yield during large initial builds. If a trace still shows substantial layout/paint cost, evaluate overscanned row virtualization or offscreen containment with stable row sizes. These larger changes must preserve focus, browser find/accessibility, scroll position, and hover geometry. `content-visibility: auto` introduces paint containment and can affect overflowing hover UI; geometry reads can also defeat skipped rendering, so applying it directly to Netflix cards is not a safe blanket fix. See [Chrome's content-visibility guidance](https://web.dev/articles/content-visibility).

### P2. Hot paths repeatedly rediscover state and read layout

Locations: `getCarouselDomRuntime` (4363), `selectedPage` (4466), `currentPageSlots` (4965), `logicalPageFromSlotPositions` (6328), `findActiveSourceSlot` (7193), `alignSourceSlotToClone` (7681), `slotDescriptor` (1318).

Despite the WeakMap, every runtime lookup re-runs carousel profile discovery across the section. In logical mode, selected-page reads collect visible geometry, inspect React indices, compare logical page windows, and update signature mappings. Callers frequently repeat these reads for decisions and diagnostics within the same operation. Alignment also calls `findActiveSourceSlot`, repeating binding checks and source resolution performed by its caller.

`currentPageSlots` first measures all filled source slots, then can read the same slot rectangles repeatedly while sorting the active set. The logical page resolver generates expected indices for every page until a match. Isolated tail-page checks for 30, 150, and 600 titles at six columns generated 5, 25, and 100 candidate windows respectively.

Carousel movement explicitly forces layout with `offsetWidth` around style changes. Card replacement followed by geometry-rich logging can also require rendering work. [Chrome's layout guidance](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) explains why DOM size and interleaved writes/reads matter. Not every rectangle read necessarily triggers a fresh layout, so the frequency and cost need measurement.

Proposed improvement: reuse a validated per-operation/per-frame native-state snapshot, cache profiles until relevant Netflix structure changes, reuse measured rectangles for sorting, and derive likely logical-page candidates before exact validation (including the overlapping final page). Keep caches scoped to binding/content/layout generations and preserve handling of transient native windows and deltas.

### P2. Image loading and resize handling may amplify scroll cost

Locations: `buildGraphqlMyListItems` (2793–2828), `normalizeClone` (7028), image CSS (1860), grid ResizeObserver (8373), `scheduleResponsiveRefresh` (8813), `waitResponsiveLayoutSettled` (8428).

Displayed clones explicitly use `loading = 'lazy'` and `decoding = 'async'`, but retained GraphQL snapshots assign `image.src` before the displayed clone is normalized. If the source template is eager, detached snapshots can start image requests before the final lazy grid exists; setting `src` can initiate fetching before DOM insertion, as illustrated by [MDN's image-loading documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image). Actual template loading state and request timing need inspection; this is a conditional finding.

The script sets image width to 100% and height to auto without explicitly reserving a card aspect ratio. Netflix's inherited markup/styles may already reserve it, so missing space cannot be established from this file alone. If card height changes as lazy images arrive, observing the whole section causes responsive remeasurement even when its width and column count are unchanged. The no-shape-change branch still writes grid/status geometry and status text, which can trigger the document observer described above. [Chrome's image lazy-loading guidance](https://web.dev/articles/browser-level-image-lazy-loading) recommends reserving image dimensions to avoid shifts.

Proposed improvement: inspect and preserve source aspect ratios; store image URLs as data and configure lazy loading before assigning sources to rendered cards. Filter height-only resize notifications that do not affect carousel/grid geometry, retain required native-count convergence signals, and skip unchanged style/text writes. Compare cold and warm image-cache scrolling to establish whether download/decode/layout contributes.

### P2. Diagnostic work runs synchronously on normal interaction paths

Locations: `slotDescriptor` (1318), `formatLogValue` (1218), `appendInvestigationLog` (1263), `log` / `warn` (1273), hover and carousel logging throughout the paths above.

Every log immediately formats/serializes arguments, creates a timestamp, retains a string, and writes to the console. Some callers gather source geometry and React metadata exclusively for diagnostics. Once the 5,000-entry cap is full, trimming uses an array splice from the front. This is additional CPU/allocation work during page moves and hovering; the relative cost is unknown without a trace and may differ with DevTools open.

Proposed improvement: preserve useful errors and phase timings, make high-frequency trace construction conditional before collecting expensive arguments, and use a circular buffer if retained log volume warrants it. This is separate from deferred point E: E concerns which details are copied. No redaction, copied-log change, or reduction of logging has been authorized by this review.

### P2. Bootstrap pagination can do work that its caller cannot use

Locations: `fetchFreshMyListBootstrapViaCarousel` (2831), `fetchFreshMyListBootstrap` (3099), `runScript` (9174–9209 and 9403–9415), GraphQL constants (57–58), route suspension (1095).

The fresh bootstrap fetch collects all GraphQL pages sequentially, using up to eight pages of 75 entries under one 10-second timeout. Logical-mode collection reuses those edges, so it should not be described as always fetching twice. However, indicator-mode SPA initialization requests that same full pagination even though it later collects cards from the DOM and chiefly needs the fresh count/first ID. If later pagination fails, already-obtained bootstrap information is discarded and the page-HTML fallback runs. Larger lists or a slow connection can therefore pay unnecessary network/parse time before the native scan.

Fetch controllers are local to the bootstrap functions; route suspension invalidates the session but does not immediately abort an outstanding request. Work is rejected at the next session check or timeout. This is a lifecycle/network efficiency issue, not the primary scrolling hypothesis.

Proposed improvement: distinguish count/first-ID bootstrap from full-item pagination based on the native mode, retain valid bootstrap data if optional collection fails, and tie fetch cancellation to the route session. Preserve authoritative count reconciliation, complete-list validation, and fresh data after SPA navigation. Cursor pagination itself has dependencies and should not simply be parallelized blindly.

### Proposed order — discussion only

| Order | Work | Reason |
| --- | --- | --- |
| 1 | Capture a scrolling baseline, then address scroll-triggered hover and obsolete preparation | Most closely matches the reported native-carousel movement; prevents work before making it cheaper. |
| 2 | Filter script-owned mutations, make binding checks cheap, and skip unchanged status/layout writes | Removes duplicate work across scrolling, hover, initialization, and resize. |
| 3 | Reuse native state/rectangles and track grafted clones directly | Reduces repeated DOM/React scans and list-wide invalidation while retaining the existing grid. |
| 4 | Verify thumbnail request timing and reserved geometry; filter irrelevant resize notifications | Targets cold-scroll/network/decode/layout effects if present. |
| 5 | Reduce snapshot retention, chunk initial construction, and improve bootstrap/lifecycle work | Improves memory, startup responsiveness, and wasted network work. |
| 6 | Evaluate row virtualization/containment and diagnostic gating against the remaining trace | Larger compatibility/behavior tradeoffs; prioritize according to measured residual cost. |

### Browser validation needed

Use the same list, viewport, and browser for comparisons. Record fast downward/upward scrolling with the pointer over cards, then over an empty margin; compare the script enabled/disabled and cold/warm thumbnails. Record deliberate same-page/distant-page hover, resize, add/remove/undo, and SPA leave/re-entry separately.

Inspect native page moves, hover activation/cancellation, observer callbacks, resize callbacks, main-thread tasks, forced layout, paints, image requests/decodes, allocation/GC, and retained DOM. Existing logs can distinguish initialization/full collection from hover/page preparation, but they do not measure frame smoothness. Comparing performance with DevTools closed also checks diagnostic overhead. A successful fix needs smoother scrolling and less unnecessary work while preserving exact membership/order, native hover actions, focus/click behavior, and restoration/route cleanup.
