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

The diagnostic entries are kept in a page-memory circular buffer capped at 5,000 entries and are also sent to the browser console. They are not persisted as log history in local or session storage. “Copy Logs” explicitly copies a diagnostic snapshot and the retained entries in chronological order to the clipboard. The snapshot includes page and browser details, and individual entries can include item identifiers or URLs when those are logged. Round 2 gates expensive interaction traces, while preserving warnings, phase timings, and the existing copied-detail policy.

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

Review date: 2026-09-30. The user reports stutters while scrolling the grid and observes the native My List carousel moving when scrolling back upwards. This review covers scrolling, hover, rendering, initialization, memory, and network work. The user subsequently selected scroll-triggered hover, obsolete hover work, and observer duplication; those changes are implemented in userscript 1.0.8. The remaining proposals are not selected. Locations and descriptions below refer to the reviewed 1.0.7 source unless a result is explicitly stated.

### Evidence and limits

- Reviewed the initialization and collection paths, grid construction, image handling, React hover bridge, carousel navigation and waits, native binding checks, mutation/resize observers, logging, and route cleanup.
- Ran isolated Node checks against functions extracted from the unchanged userscript, with mock DOM objects. These confirm control flow and operation counts; they do not measure browser frame times, layout, image decoding, or Netflix's own React work.
- There is no live browser performance recording for the reported session. List size, browser, source-card dimensions, and whether thumbnails were already cached are unknown. Findings below distinguish definite work in the code from possible explanations of the observed stutters.
- Existing C and D improvements remain useful: the document observer is scoped to My List after discovery, images in displayed clones use lazy loading and async decoding, and hover listeners are delegated. Those changes do not eliminate the work described below.

### First performance pass — implemented in 1.0.8

- **Scroll-triggered hover:** Both new preparation and mounted-source reuse now require a 120 ms hover dwell before native state is read. Passive wheel/scroll listeners cancel pending hover and release source alignment; React grafts are invalidated once per scroll burst so Netflix's delegated events cannot bypass the script guard. Hover resumes only after physical pointer movement following a 180 ms quiet period; synthetic replay and a stationary pointer do not automatically restart preparation. Only the latest pending card is retained.
- **Obsolete preparation:** Hover hydration and mounted-source waits stop at their next frame/timer checkpoint. Expected-page and recovery retries check cancellation before native state reads. A target waiting for responsive refresh is revalidated afterwards, and old async cleanup cannot erase a newer preparation's markers. A native move already clicked retains its serialized acknowledgement and settlement; cancelled move acknowledgement polls at 80 ms instead of every frame (or the 12 ms indicator fallback). The existing move timeout remains a correctness bound, so cancellation does not undo an in-flight click or instantly release its queue slot.
- **Observer duplication:** Mutations wholly inside script-owned grid/status/empty/dialog UI are ignored. Relevant native mutations coalesce to one check per animation frame, and an unchanged populated binding skips geometry, React index, and count reads. Native track/section/host replacement, empty-list transitions, and external grid removal retain their recovery paths. Repeated status text and grid custom-property values are not rewritten.
- **Verification:** `node --check "Legacy My List for Netflix.user.js"`; `node --test tests/performance.test.cjs` (23 deterministic tests of shipped functions); `git diff --check`. Tests cover hover intent and mounted-source reuse, scroll suppression/resumption, stale cleanup and retries, cancellation in logical/indicator modes, initialization waits, serialized movement/style restoration, observer filtering/coalescing, replacement/empty/grid recovery, and route cleanup. They use DOM/timer mocks and do not establish measured browser performance or Netflix hover compatibility.
- **User feedback:** The user reports that 1.0.8 increased stability substantially. They also report that a film/series hover popup sometimes appears only after two or three hover attempts. This does not establish which hover path failed; the analysis below records the remaining reliability gaps. The user tests the browser themselves and explicitly asked the assistant not to inspect it. Resize, add/remove/undo, and SPA leave/re-entry remain user-owned checks; one native move already clicked may still finish safely.

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

## Hover popup reliability — userscript 1.0.8

Review date: 2026-09-30. The initial review was analysis only, with no userscript or committed test changes; its baseline is 1.0.8. The subsequently selected implementation is recorded below. Findings describe confirmed control flow and possible causes of the reported repeated-hover symptom, without claiming a live Netflix reproduction.

### P1. An unsuccessful hover can lack recovery until another user attempt

Locations in 1.0.8: `prepareMountedPage` (8124–8144), `activateClone` (8196–8259), `scheduleNativeHoverReplay` (7797–7827), `handleGridClonePointerOver` (8308–8327), `handleGridClonePointerLeave` (8330–8355).

- **Preparation success is broader than hover success.** After replacing the target clone, failed source-to-grid geometry alignment returns the fresh clone without scheduling native replay. `activateClone` treats any returned clone as success, so its existing bounded retry is skipped. That retry also relies on the original clone still being connected and hovered, rather than resolving the current replacement for the same item. A transient source replacement or alignment failure can therefore finish preparation without making the popup appear or recovering within that attempt.
- **A skipped replay can leave the card marked active.** Both reuse and preparation set `activeClone` before the animation-frame replay. If the native source disconnects before that frame, replay returns without clearing that state or retrying. Subsequent pointer movement on the same card is ignored because `activeClone === clone`. Leaving clears the state, and re-entering permits another attempt. The source-ID-mismatch branch already clears active state; the disconnected-source branch does not.
- **Native popup success is not acknowledged.** The replay path sends pointer/mouse events and records that replay was attempted. It does not establish that Netflix displayed the expected title's popup. If Netflix ignores those events or the source is not yet ready, the card can remain active with no bounded recovery. “Hover native page preparation result” and “Native hover replayed from live source” are therefore not evidence that a popup appeared.

Proposed scope: distinguish a refreshed clone, successful alignment, replay dispatch, and confirmed/failed native hover; recover on the current clone for the same item. Release failed active state and allow a bounded retry only while the deliberate hover remains valid. Validate title identity, source binding, route/session, cancellation, and order before replay, and cancel on leave/scroll/resize. Any native popup acknowledgement must use a verified Netflix signal; avoid unlimited retry loops or broad carousel searches for popup readiness.

### P2. The scroll guard can discard a deliberate hover just after scrolling

Locations in 1.0.8: `gridHoverSuppressed` (8289–8296), `handleGridClonePointerOver` (8308–8312), `handleTargetPointerMove` (8954–8965), `handleTargetScroll` (8968–8982).

Scrolling requires another trusted physical pointer movement before hovering can resume, and movements inside the 180 ms quiet period are ignored. If the user deliberately moves onto a card during that period and then holds still, there is no pending activation to reconsider when it expires. Waiting longer does not resume the hover; a further physical movement or leave/re-entry is needed. This is an edge case of the new performance guard. It can explain misses immediately after scrolling, but cannot explain every repeated-hover report away from scrolling. The separate 120 ms dwell intentionally rejects brief visits.

Proposed scope: retain deliberate physical hover intent received during the quiet period and revalidate it once scrolling settles. Keep the protection against automatically preparing a card that merely passed under a stationary pointer; require a real movement/entry, a still-hovered current target, and cancellation if another scroll or target change occurs.

### Conditional compatibility factors to check within the hover step

`resolveExpectedPageSourceItem` (7333–7345) accepts a matching visible source immediately; DOM/title presence does not prove that Netflix's hover handlers are ready. `netflixReactHover.graftTreeToClone` (7136–7204) records assignment counts but marks the graft complete even with no assignments, and `makeLiveClone` (7830–7842) marks the card hover-ready unconditionally. The replay also uses the original event coordinates (7771–7786), which can be old after asynchronous page preparation. Transient React readiness or stale coordinates could contribute, but their effect on Netflix's popup is unverified. Keep these checks in the hover reliability work rather than assuming Netflix's private React contract is broken or adding a speculative fallback.

### Evidence and validation limits

Three inline Node scenarios exercised functions extracted from the unchanged 1.0.8 source, reusing the existing DOM/timer mocks: a physical entry during scroll suppression stayed inactive until another movement; a disconnected-source replay retained active state and blocked movement retries until leave/re-entry; and an alignment failure after replacement logged preparation success with no replay and no retry. These confirm the gaps under the stated conditions. They do not establish their frequency, actual source disconnections/alignment failures, or Netflix popup behavior. No browser was inspected and no new tests were committed.

User-owned checks for the hover step: distinguish hovering immediately after scrolling from hovering after a pause; compare a first hover on a distant native page with repeating the same title and an already-mounted title. Hold the pointer on a card long enough for native preparation; verify one deliberate entry opens the correct popup, leaving cancels it, popup controls work, and rapid target changes or scrolling do not restart carousel churn. Local tests cover intent/cancellation and observer work, not actual Netflix popup compatibility.

### Round 1 — implemented in 1.0.9

The user subsequently selected round 1 for implementation. The confirmed preparation/replay recovery gaps and missed post-scroll intent are addressed in 1.0.9:

- Native replay returns an awaited dispatch result. Failed alignment no longer returns a successful preparation result; disconnected, mismatched, inactive, or failed replay releases active state only if that attempt still owns it.
- Both ready-source reuse and fresh preparation share a limit of one recovery attempt after 180 ms. Recovery resolves the current clone for the same item. Replacement clones inherit the activation generation and current preparation markers, so leaving a replacement cancels pending replay/recovery and old cleanup cannot erase a newer attempt.
- Physical movement onto a card during the scroll quiet period retains one pending intent. It runs only after both the dwell and quiet period have elapsed and the same connected grid card remains hovered. Another scroll, leaving, moving outside the grid, resize, or route cleanup cancels it. Stationary boundary events and synthetic replay cannot queue this intent.
- Synthetic movement no longer overwrites the last physical pointer position. Replay uses current coordinates within the source's proxied card rectangle, with the original position or card center as fallback. Native source validation restores original geometry before rechecking the active source, then reapplies grid geometry for popup placement.
- A clone without React fiber/props assignments is not marked ready for subsequent reuse. It can still use the validated real-source replay path; no guessed React handler or alternate popup fallback was introduced.

Validation: userscript syntax check, 39 passing Node tests exercising shipped functions with DOM/timer mocks, diff review, and `git diff --check`. Added coverage includes recovery after replacement, permanent-failure limits, skipped/failed replay cleanup, source identity/visibility, stale callbacks, physical coordinates, geometry restoration, post-scroll intent and cancellation, metadata readiness, and order-mismatch handling. All previous performance/cancellation/observer tests remain included.

Native popup appearance is still a browser verification point: no trustworthy popup acknowledgement contract was established from the repository, so the patch does not guess selectors, poll for an assumed popup, or repeatedly replay an otherwise valid dispatch. Diagnostic `success`/`replayDispatched` means events were dispatched to the validated native source, not that Netflix visibly opened a popup. The known code gaps are implemented; the user must confirm the reported first-hover symptom and popup actions in Netflix. No assistant browser inspection was performed.

## Round 2 — implemented in 1.0.10

The user selected the combined recurring-interaction patch (original priorities 2 and 4).

- **Native reads:** Share profile/indicator discovery, filled-slot queries, slot rectangles, and React item indices inside synchronous read scopes. Native-state/readiness samples, selected-page reads, and ready-hover source validation reuse these results. The scope ends before any await or animation frame; the replay frame samples fresh original native geometry before reinstalling popup-placement proxies. Geometry restoration, runtime reset, and source adoption invalidate a current scope. This deliberately avoids caching native content or layout between operations. Slot sorting uses already-measured rectangles, and clone creation uses the resolved page instead of re-reading it per card.
- **Logical pages:** Test at most two exact candidate windows, rather than generating every page. Exact membership checks still reject missing, duplicate, invalid, or partial indices and preserve overlapping last-page behavior; wrapped-tail handling remains unchanged.
- **Graft tracking:** Track inserted grafted clones directly. Invalidation visits that set instead of querying every grid card. Replacement, removal, source adoption, grid rebuilding, detached-state reset, and route/empty-transition cleanup release old metadata and tracked references. Non-ready grafts with other React metadata are also released; an explicitly retained connected clone remains tracked.
- **Diagnostics:** Construct detailed source-card/geometry traces only when the source-level `VERBOSE_INTERACTION_LOGS` switch is enabled (default false). Warnings, failures, preparation/reuse results, assignment counts, and phase timings remain enabled. Remove logging-only page/rectangle reads from the normal hover path. A 5,000-entry circular buffer replaces front splicing at capacity, and copied entries remain chronological. This changes runtime overhead, not the deferred E copied-detail/privacy policy.
- **Evidence:** 54 deterministic tests of shipped functions pass, including the previous 39 hover/cancellation/observer checks. A six-card native-state/ready-hover sample discovers the profile once, queries filled slots once, reads six React indices once, and measures six slots plus the scroller once; replay takes a fresh sample in its own frame. With six grafts, invalidation clears six cards for grids of 30, 150, and 600 items without a grid lookup. Exact last-page detection for those sizes checks one candidate instead of the previous 5, 25, and 100. Exhaustive complete-page checks cover counts 1–120 and column widths 1–12, including overlapping tails; malformed windows are rejected. Tests also cover indicator/native-render changes, replaced tracks, resized columns/membership, binding adoption, geometry restoration, lazy trace payloads, and repeated log-buffer wrapping.
- **Limits and validation:** Syntax and whitespace checks pass. These are operation-count/control-flow checks with DOM/timer mocks, not measured browser frame times or proof of Netflix popup behavior. User-owned comparison should cover scrolling, deliberate same/distant-page hover and popup actions, resize, add/remove/undo, and SPA leave/re-entry. No assistant browser inspection was performed. Construction and fetch-lifecycle proposals were left for separate patches.

## Round 3a — implemented in 1.0.11

The user selected the construction-scheduling patch; snapshot representation and retention changes are addressed separately in round 3b below.

- **Chunked construction:** GraphQL snapshot creation and grid cloning share a task-yielding runner. It checks elapsed time after each entry and yields when a chunk reaches 24 entries or 6 ms, then revalidates the route before continuing. Small, inexpensive lists finish without a timer yield. Native-carousel snapshot collection remains unchanged: it already yields between its small visible pages, and yielding while reading a live page could let Netflix recycle slots mid-sample.
- **Stable snapshots and atomic publication:** Freeze one detached native template before GraphQL construction so recycled live slots cannot change later snapshots. Preserve exact deduplication, complete-count validation, order, labels, artwork, and page assignments. Build the grid and its item/clone maps privately; publish the complete tree and maps together after final route/state/source checks. The current frame stays in place while construction runs. A cancelled or failed build exposes no partial grid or maps.
- **Lifecycle and deltas:** Route cancellation stops at the next chunk boundary, including the awaited completion of short builds. Snapshot cancellation exits initialization normally and cannot clear a newer session's running state. A replaced native source discards the unfinished grid and restarts initialization; queued add/remove changes stay deferred through that retry. Initialization remains busy until grid publication, then the existing delta retry applies queued changes to the completed list.
- **Evidence:** 67 deterministic tests pass, retaining all 54 earlier tests. At the count cap, the runner splits 30, 150, and 600 entries into 2, 7, and 25 chunks; simulated expensive cards yield before reaching the cap. Complete 150-card snapshot/grid checks preserve membership/order and card metadata, focusability, lazy images, and delegated hover wiring. Tests cover invalid/incomplete snapshot fallback, template recycling, task yields, cancellation, clone failure, replaced state/source, adapter/caller awaits, full initialization, queued add/remove application, and source-retry queue preservation.
- **Limits and validation:** Syntax and whitespace checks pass. The time budget is checked after an entry; an individual clone can exceed it. Final DOM attachment/layout and other initialization work remain synchronous, and yielding may increase total startup time. This targets uninterrupted construction work, not retained card memory or measured browser frame times. The user owns browser comparisons for large-list startup, route leave/re-entry during loading, list changes during loading, resize, and normal hover/focus/click behavior. No assistant browser inspection was performed.

## Round 3b — implemented in 1.0.12

The user selected the snapshot-retention patch. The grid remains complete and scrollable; this changes card storage and allocation while preserving the existing native hover bridge.

- **Shared GraphQL template:** Collect compact item metadata and artwork URLs against one frozen native template. Materialize each title's card only when building the grid, preserving the previous href, title, artwork, missing-artwork/image behavior, membership, deduplication, order, and page assignments. The existing chunk runner and route checks still apply.
- **Published card ownership:** After successful grid publication, clear each item's detached native snapshot or shared template/artwork references. The current clone map supplies markup for a later rebuild, guarded by item-object identity so a stale object cannot borrow another item's card with the same video id. Native captures keep their distinct markup and controls; they are not generalized into a common template. Cancelled/failed construction retains its original sources and leaves the current frame/maps intact.
- **Undo and hover replacement:** Release grafted React metadata and detach a removed card, retaining that tree only for the existing Undo entry. Restoration creates a fresh clone, preserves content/controls and insertion order, then releases the fallback snapshot. Rebuilds and Undo strip copied readiness/preparation markers because DOM cloning does not copy the React properties or activation state they described. Hover replacement remains the current card source without retaining its predecessor. Existing Undo pruning and route cleanup remain in place. Addition constructs its card before changing membership, allowing a failed clone to be retried safely.
- **Avoid temporary captures:** Native order/index reads use item metadata without cloning full cards. Native lookup for an addition captures only the matched title, rather than every preceding slot or an unsuccessful search.
- **Evidence:** All 78 deterministic tests pass, including the prior 67 checks. For 30, 150, and 600 GraphQL titles, collection creates one template tree; collection plus grid construction allocates N + 1 card trees instead of 2N + 1. After publication, retained card roots in the grid/maps/items are N instead of 2N, excluding necessary recent-removal Undo cards and the native carousel. Native captures also release their duplicate roots after publication. New tests cover distinct native markup/controls, shared-template hydration, cancellation/retry, rebuilding from current cards, remove/Undo, hover replacement and metadata release, stale item identity, missing artwork/images, native-read allocation counts, Undo pruning, and failed-addition retry.
- **Limits and validation:** Userscript syntax, diff review, and whitespace checks pass. Counts come from production functions exercised with DOM/timer mocks; they are not browser heap measurements, measured GC/frame-time improvements, or proof of Netflix popup compatibility. Native capture/build still temporarily holds both source and displayed trees to preserve complete publication and cancellation. All displayed cards remain in the DOM. User-owned checks should cover startup/scrolling, distant/same-page hover and popup actions, focus/click, add/remove/Undo, resize, and SPA leave/re-entry. No assistant browser inspection was performed.

## Prioritized open performance and reliability work

The user requested a filtered priority list focused on performance and reliability. Completed work, deferred work, and maintenance-only proposals are excluded from this active view; their history remains above. Rounds 1, 2, 3a, and 3b are implemented in 1.0.9 through 1.0.12. Round 4 is the only remaining active proposal and is unselected. Original priority numbers are retained for the round references below. The order weighs confirmed recurring work, likely performance benefit, and compatibility risk; it is a code-based ranking, not a measured comparison of speedups.

| Original priority | Work | Benefit and next scope |
| --- | --- | --- |
| 5 | Bootstrap pagination and fetch lifecycle | Improve startup/SPA efficiency rather than normal scrolling: avoid unused pagination, retain valid bootstrap information if optional collection fails, and abort obsolete route fetches. Preserve complete-list/count validation and fresh data. |

Thumbnail request timing, reserved image geometry, height-only resize filtering, and row virtualization/containment remain unselected conditional proposals in the performance review, outside this filtered priority list. The image/resize changes depend on establishing unnecessary requests, missing inherited dimensions, or irrelevant refreshes in Netflix; those conditions have not been confirmed. Virtualization/containment needs evidence of significant remaining layout/paint cost and can affect hover geometry, focus, browser find/accessibility, and scroll position. Additional adapter centralization or speculative fallbacks are also outside this list; the concrete hover reliability work is retained because reliability is an explicit priority.

### Recommended patch rounds

The user requested useful grouping and an explicit judgement where separate patches make more sense. Recommend four rounds comprising five separate patches. Reject one combined patch for all five priorities: hover recovery, interaction work, card construction, and fetch lifecycle change different behavior, and a combined release would make regressions difficult to attribute. Rounds 1, 2, 3a, and 3b are implemented; round 4 remains a proposal, unselected for implementation.

| Round | Included priorities and patch scope | Grouping judgement and validation |
| --- | --- | --- |
| 1. Restore dependable hover — implemented | Priority 1; shipped in 1.0.9 with bounded failed alignment/replay recovery, active-state cleanup, and retained deliberate intent during the scroll quiet period. | 39 local mock tests pass; native popup appearance/actions and preservation of the reported 1.0.8 scrolling gains remain user-owned browser checks. No speculative popup acknowledgement signal was added. |
| 2. Reduce recurring interaction work — implemented | Priorities 2 and 4; shipped in 1.0.10 with synchronous native-read reuse, at most two exact logical-page candidates, direct graft tracking, lazy interaction traces, and circular log retention. | 54 local mock tests pass, with reduced scan/read counts and lifecycle checks described above. Useful warnings/timings and the copied-detail policy remain. Browser performance and hover compatibility remain user-owned checks. |
| 3a. Reduce construction stalls — implemented | Priority 3, scheduling only; shipped in 1.0.11 with chunked GraphQL snapshot/grid construction, private maps and complete-grid publication, route cancellation, and source-replacement recovery. | 67 local mock tests pass, including ordering, yielded-build cancellation, publication, and queued deltas. User-owned startup and interaction checks remain; retained snapshot representation is unchanged. |
| 3b. Reduce retained card memory — implemented | Remaining priority 3; shipped in 1.0.12 with compact GraphQL items/shared template, released published snapshots, current-clone rebuild sources, and removed-card Undo retention. Native order reads avoid unnecessary captures. | 78 local mock tests pass, with N retained grid/item card roots instead of 2N and N + 1 GraphQL construction allocations instead of 2N + 1. Distinct native markup, membership/order, cancellation, rebuilds, hover replacement, and add/remove/Undo are checked. Browser memory/performance and hover/focus/click checks remain user-owned. |
| 4. Improve bootstrap and route fetch lifecycle | Priority 5; one standalone patch for mode-appropriate pagination, retaining usable bootstrap data after optional collection failure, and cancelling obsolete route fetches. | Keep separate from grid construction because collection/count correctness and asynchronous fetch cancellation have distinct failure modes. Check logical and indicator modes, pagination failure/fallback, count reconciliation, route leave/re-entry, and cancellation. This primarily improves startup/navigation efficiency. |

The useful combined round is recurring interaction work (priorities 2 and 4). Hover reliability, the two grid changes, and bootstrap/fetch work should ship as separate patches with local checks and user-owned browser comparison between them. The round order preserves the reported reliability fix first and then targets frequent runtime work before larger construction changes and startup-only work.

### Browser validation needed

User-owned validation, not a prerequisite for the authorized first implementation pass: use the same list, viewport, and browser for comparisons. Record fast downward/upward scrolling with the pointer over cards, then over an empty margin; compare the script enabled/disabled and cold/warm thumbnails. Record deliberate same-page/distant-page hover, resize, add/remove/undo, and SPA leave/re-entry separately.

Inspect native page moves, hover activation/cancellation, observer callbacks, resize callbacks, main-thread tasks, forced layout, paints, image requests/decodes, allocation/GC, and retained DOM. Existing logs can distinguish initialization/full collection from hover/page preparation, but they do not measure frame smoothness. Comparing performance with DevTools closed also checks diagnostic overhead. A successful fix needs smoother scrolling and less unnecessary work while preserving exact membership/order, native hover actions, focus/click behavior, and restoration/route cleanup.
