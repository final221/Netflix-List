# Implemented architecture

This document describes what exists now. [Migration.md](../Migration.md) defines the architectural destination; [MigrationPlan.md](../MigrationPlan.md) defines its ordered implementation steps. Feature boundaries described there are not all implemented yet.

## Build boundary

`package.json` supplies the canonical release version and exact Node runtime, npm version and esbuild dependency. `package-lock.json` locks dependency resolution. `userscript.meta.json` supplies the existing userscript identity, match, grants, execution environment and flags.

`scripts/build.mjs` owns metadata rendering, version injection and generation. Its `generateUserscript` function builds in memory and returns code plus dependency metadata, without changing repository files. The build command writes that result to the existing `Legacy My List for Netflix.user.js` path. The output is a readable IIFE with the userscript header first, no external imports and no source-map/runtime dependency. It preserves escaped strings and the raw page execution environment.

`scripts/check.mjs` uses the same generation function. It validates the preserved installation contract, syntax, metadata/internal/package version agreement, lack of external runtime imports and normalized output equality. It never overwrites the file it is checking. CRLF checkout differences are normalized for equality; source changes, metadata changes and extra output remain detectable.

The checker enforces Migration.md's production import directions and public entries using esbuild's dependency metadata. Private files are accessible within their owning capability; carousel internals are a separate capability inside Netflix. Back-dependencies on application coordination, direct access to another feature's internals, cycles, external inputs and dormant production files fail verification. Completion policy cannot import Netflix integration. These graph checks do not prove state ownership, import-time purity or runtime behavior; the migration still audits those contracts through actual caller transitions and capability scenarios.

Legacy imports have no blanket exemption. Exact exceptions currently allow main to start legacy (removed in P20), legacy to compose DOM names/localization/logger/report/popup inspection/context/page-DOM/list-data/viewing-data/session scope (removed in P20), and legacy to install/remove grid styles and use card markup (removed in P11). The checker and findings.md record each caller/reason/removal step; obsolete exceptions fail verification rather than silently remaining after cutover.

`.github/workflows/check.yml` runs the normal verification commands on Windows and Linux with the exact Node version from package.json and locked dependencies. Checkout includes HEAD's parent so commit whitespace checks inspect the actual change. It verifies the committed bundle before any write-producing build, then runs regression tests, rebuilds, repeats the read-only check, checks syntax/commit whitespace and rejects tracked build changes. Runtime output/version is unchanged by adding this enforcement.

## Transitional runtime

```text
src/main.js
  -> src/legacy.js: startLegacy()
     -> src/dom-names.js: script-owned DOM contracts
     -> src/i18n/i18n.js: createI18n({ readLanguage })
        -> ui-messages.js / log-messages.js: literal resources
     -> src/grid/styles.js: installStyles(document) / removeStyles(document)
     -> src/diagnostics/logger.js: application-lifetime retained logging
     -> src/diagnostics/report.js: explicit summary providers and clipboard export
     -> src/netflix/popup-inspection.js: bounded response/component investigation
     -> src/netflix/context.js: lazy page/profile/locale/request context
     -> src/netflix/page-dom.js: native discovery and membership identity facts
     -> src/netflix/card-markup.js: capture, clone and sanitize card material
     -> src/netflix/list-data.js: page bootstrap, requests, pagination and normalized records
     -> src/netflix/viewing-data.js: typed viewing requests and interpreted progress/coverage
     -> src/app/session-scope.js: route epochs and registered request/timer ownership
     -> src/netflix/carousel/carousel.js: discovery, binding generations, reads and readiness
        -> page-model.js: private signature/page mapping and logical-window policies
     -> existing settings, SPA hooks and route-session runtime
```

Main invokes the legacy entry once. Importing legacy alone does not activate listeners, requests or settings. It retains the remaining runtime orchestration, mutable feature state and lifecycle, with its internal SCRIPT_VERSION injected by the build. Resources, diagnostics, page context/DOM interpretation, card markup, My List data access, viewing protocol interpretation, session/request cancellation and native binding/page-model state now have separate owners and live callers. No parallel implementation or public legacy state bag is introduced.

The temporary runtime entry is replaced by application composition in P20, then removed in P21. The exact source responsibility transfers follow MigrationPlan.md; this document is updated as those capabilities become real.

## Resources and localization

`src/dom-names.js` declares shared script-owned IDs/classes/attributes and prior-version cleanup IDs. Feature-private markers remain with their existing callers; the shared Netflix-owned selector catalog lives in netflix/page-dom.js. DOM detection does not use translated display text.

`src/i18n/i18n.js` creates a localization capability with a narrow `readLanguage` callback. It reads language lazily, normalizes regional forms, chooses supported UI locales and limits diagnostic text to English/Japanese. Its public operations translate UI/log messages and format numbers, counts and initialization time. Message interpolation and base-language parsing remain private. The two neighboring message files own all existing literal translations; neither tables nor implementations remain duplicated in legacy.

The locale reader uses netflix/context.js's lazy document/navigator interpretation. Header/error assembly stays with its current presentation callers because it reads list/viewing state; localization owns only the display formatting it consumes. Final dependency injection replaces the residual consumers in P20.

`src/grid/styles.js` owns the existing stylesheet and imports shared selectors from dom-names.js. `installStyles(document)` creates one style element or returns the existing one; `removeStyles(document)` removes it idempotently. Importing the module only assembles literal CSS. Legacy invokes installation/cleanup at the same route points until grid frame ownership transfers in P11. This step adds no listener, observer or request.

## Logging, report export and popup inspection

`src/diagnostics/logger.js` owns the application-lifetime circular log buffer, capped at the existing 5,000 entries. It retains chronological export order, console prefix/detail, Error/DOM/circular formatting and local timestamps. Trace calls evaluate their payload callback only when enabled. Callers receive log/warn/trace operations, copied entries, size and report formatting; they cannot write the private buffer or its cursor. Route entry leaves retained history intact.

`src/diagnostics/report.js` exposes one `copy()` operation. Composition supplies scalar environment metadata and separate runtime, series-viewing, thumbnail and native-popup summary providers. They run on an explicit copy request; the report retains no feature state or native DOM/fiber objects. It preserves copied fields/detail and clipboard preference: navigator.clipboard, then the existing execCommand fallback with the same warning/failure messages. The fallback removes its own textarea in a finally block, including failed selection/copy. The CopyLogs button handler and feedback timer remain with legacy presentation until frame transfer in P11.

`src/netflix/popup-inspection.js` owns bounded response survey counters, private component/response interpretation and one serialized preview shape. Existing limits remain eight response pages/four sampled cards per page, bounded depth/nodes/keys/paths/fibers/holders/function prefixes, and one preview capture per route entry. It exposes recordResponse, capturePreview, collect, diagnostics and reset. Summaries are copies; functions/values/live objects are not exported. Probes use descriptors, skip sensitive keys/getters, never invoke private callbacks, and isolate failures.

Inspection receives current-session checks, a current-token reader, a mounted-grid predicate and one current-source-card reader. Legacy resets its private counters on list entry and supplies the current request/hover session token. The existing validated CarouselPage response feeds the survey without another request; an admitted native preview transfer feeds shape capture. Report collection alone probes the current source card. Stale response/capture operations cannot change the current counters, and a failed probe cannot reject a native transfer or initiate recovery.

All other counters, hover preview presence timers, frame samples and image-resource measurements remain in legacy until their planned feature transfers. Performance snapshots merge the inspection's copied counters at the original report field. Legacy composes these capabilities through exact temporary imports until P20 moves composition into app; upcoming data/native owners receive their declared operations through injected collaborators.

## Netflix page and markup boundaries

`src/netflix/context.js` reads HTML/browser language, page direction, the current active userGuid, wrapped/app/react model fallbacks, raw page GraphQL bootstrap and request context on demand. Viewing context retains same-origin HTTPS endpoint validation, descriptor/string/build variants and transient authorization; list context returns only build/locale header facts. Raw page bootstrap is consumed only by the Netflix list-data adapter; transient viewing request context is consumed only by netflix/viewing-data.js. The context capability has no stored profile, feature state, request or observer. Existing publication/storage guards use its current profile reader.

`src/netflix/page-dom.js` owns the shared Netflix selector catalog, section/empty-placeholder placement, native identity/URL/tracking parsing and membership-click decoding. Discovery uses structural anchors before GraphQL section ID/card overlap, skipping synthetic rows. Click decoding returns UI/identity facts; the current list logic still decides add/remove from membership because Netflix's Undo UI can advertise remove during an add. The overlap fallback now iterates the current native sections, correcting its previous undefined-variable error. Source/mutation observers retain their current lifetime owners until P08/P14; explicit DOM operations create no listeners or polling.

`src/netflix/card-markup.js` captures native items or one shared template, builds from an explicitly supplied source/record, clears inherited preparation attributes and normalizes cloned card/image markup. It shares page-DOM's URL interpretation and owns no registry or retained material. Legacy selects source markup, releases startup snapshots and adds group controls through narrow wrappers until P11/P12. Cloning preserves complete native trees without copying JavaScript React graft properties. Collection/build chunking, snapshot release and Undo retention remain with their existing owners.

## My List data boundary

`src/netflix/list-data.js` owns page-cache section interpretation and its private selected-key cache, CarouselPage request/response encoding, artwork parameters, count/cursor validation, bounded continuation, normalized identity/title/artwork records and the existing fresh-page HTML fallback. It has no feature imports or DOM registry. Page-DOM supplies a language-neutral row anchor with lazily read card IDs, so section-ID matching does not add a card scan; context supplies current direction/header/model facts.

Public bootstrap snapshots contain count, first title and provenance/page/edge-count flags. Raw edges, GraphQL request objects and pagination cursors stay in a private WeakMap keyed by that snapshot and tied to its route owner. A later session cannot borrow an earlier continuation. `collectRecords` returns only normalized href/videoId/ariaLabel/imageUrl records, or an incomplete/error result retaining the valid bootstrap. It never chooses native versus mounted collection or supplies markup/native page mapping.

Bootstrap fetch still tries GraphQL before same-origin fresh HTML. Optional logical pagination uses the original row/request, preserves the first count/anchor on failure, and never starts HTML fallback. Page size remains 75, the cap eight pages, and request scopes use the existing 10-second timeout; guards run after headers/body and at normalization yields. The response survey observes the actual validated response without another request. Request begin/finish/current-session checks delegate to session-scope through injected operations. The existing 24-item/6-ms cooperative scheduler remains with the residual construction callers; application composition transfers in P20.

The residual `collectLogicalListItems` bridge owns mounted-single-page reuse/strategy counters until P13. It captures one detached shared template before asynchronous pagination/normalization, then passes normalized records and that material separately to compact card assembly. This prevents live-slot recycling during a data yield from changing the accepted template. Unpublished material is released by the failed/cancelled operation; successful publication retains the existing snapshot release. Card/material ownership moves in P11, native collection in P10 and membership/order/strategy in P13. No raw protocol parsing or writable cache key remains in legacy.

## Viewing data boundary

`src/netflix/viewing-data.js` owns transient endpoint/authorization context, form/path encoding, HTTP/body parsing, bounded Falcor atom/reference resolution and normalized title/season/episode interpretation. It has no feature imports, scan state, completion rules, persistence, listeners or DOM. `beginRead` returns a frozen profile/endpoint diagnostic ticket; credentials and the full request URL stay in a private WeakMap. Forged tickets and changed profiles cannot start a request.

`readTitles`, `readSeasons`, `readEpisodes` and `readDirectEpisodes` each perform one bounded HTTP request. Their inputs are title IDs, normalized title facts or season/range descriptors. They return scalar progress records, validated season counts/IDs or indexed episode records with bounded field-kind diagnostics. Raw paths/graphs/atoms/references never become scan or completion inputs. Progress is nullable; absent counts remain null and malformed counts remain NaN, preserving the distinction that prevents contradictory metadata from being recovered as completion. Episode interpretation accepts missing/episode types and rejects other title types; completion still belongs to viewing policy.

The adapter exposes the existing frozen protocol limits: 50 titles, 200 episode/season units per batch, 40 seasons and 500 episodes per series. The residual scan uses those same limits for eligibility and batching. Valid production queries retain their prior paths and bounds; the adapter rejects an oversized public batch instead of splitting it into hidden requests. Fully covered season metadata transfers no mutable episode maps; the scan owns its progress maps.

The explicit residual `runViewingRequest` bridge still owns the 32-request pass quota, three-pass combined deadline, job-specific cancellation and network counters. Session scope owns request registration and timers; the scan selects its eight-second-or-remaining timeout through that owner's operation. It supplies a signal/current-owner check to one adapter operation and charges it once. `runViewingBatches` retains wave width two, allocated-peer drainage and the rule that a known terminal failure stops new requests. Ordinary title/season/finale order and later direct repair remain unchanged. Route/profile/grid guards run before requests and after headers/body/publication. Transport AbortError reaches the scan counter before its stale-owner check, preserving abort diagnostics without permitting stale results.

Scope mechanics have transferred to app/session-scope.js during P08. Scan/accounting transfers in P16 and composition in P20. Completion, cache/manual-choice state and DOM presentation stay with their current owners until P12/P15/P16; no new policy or storage schema is introduced.

## Session and request scope

`src/app/session-scope.js` owns the route epoch, current-session predicate, registered requests and their private deadline tickets. `begin`/`dispose` invalidate previous epochs and immediately abort/release their requests and timers. Its token is a read-only getter; the legacy runtime no longer has a writable token or controller registry. Frozen request handles expose only their own controller and session token. Finished/forged handles cannot change registration, and a queued callback from a replaced deadline cannot abort its newer deadline owner.

The existing route start/suspend points call the scope. Remaining legacy validity/error/request bridges delegate to it; their caller composition moves in P20. Data adapters receive begin/finish/guard collaborators without importing application code. The viewing scan borrows each admitted controller for job-specific cancellation and requests its eight-second-or-remaining deadline through the scope. It still decides quotas, deadlines and network accounting; cancelling a viewing job leaves unrelated route requests registered. HTTP failure cleanup closes unread bodies through the same request owner.

The remaining P08 transfer now gives native binding, discovery, shared-read caches and page-model state their carousel owner. Native movement/queue/style restoration and traversal/source resolution remain scheduled for P09/P10.

## Native discovery, binding and page model

`src/netflix/carousel/carousel.js` owns the accepted native section/scroller/track, a private binding generation and unforgeable frozen borrowed handles. Binding replacement clears shared reads and creates a new model for the accepted section. An old handle cannot become current merely because its DOM stays connected, its title still matches, or a caller borrows its old references after replacement. Route invalidation also rejects it. Residual sourceState publication borrows references through read-only getters; adoption calls the carousel instead of assigning native fields.

The capability owns the discovery MutationObserver, observed host/section/ancestor path and coalesced animation-frame owner. It retains broad discovery only before the browse host exists, then narrows observation to the host, My List and ancestor replacements. Script-owned UI mutations remain filtered, while external grid removal still schedules application recovery. Explicit callbacks report route changes, detached preview observations, blocked initialization and relevant mutations to the residual coordinator. Stop disconnects/cancels only its own resources; queued callbacks from a stopped observer cannot act on a restarted owner or clear its frame. Route listeners remain with legacy until P20.

Profile/indicator/slot/rectangle/index caches belong to synchronous samples. Every sample ends in finally, before any awaited continuation; source replacement, model reset and geometry restoration invalidate them. Profile capabilities and page-model observations are read-only. `page-model.js` privately owns the signature maps, current/known page, finalization, cycles, staleness and retry count. Commands update those fields; policy/feature callers cannot assign them or mutate the maps. The logical-index, expected-window and wrapped-tail rules transfer unchanged. State commands reuse an existing model rather than rediscovering the DOM for a former direct field write.

Native source/readiness polls reject obsolete handles before returning success. Residual asynchronous navigation acknowledgement, collection and responsive remapping revalidate borrowed owners after awaits before mapping/publication. A late fast collection cannot finalize a replacement model or bind its old source again; it discards the result and requests recovery while retaining deferred membership work. Missing positive-count sources remain timeouts, distinct from a connected empty carousel that has stabilized.

Until P09/P10, exact legacy forwarding functions and mapping commands serve remaining navigation/collection/source-resolution algorithms. They expose bounded observations or controlled owner operations, never writable binding/model/cache state. P10 completes the semantic collect/resolveCard/refreshMapping facade; this transitional query surface is not its final API. Membership shape and GraphQL count arrive through narrow readers, and scope/logging/diagnostic callbacks are injected without Netflix-to-app imports. Application composition moves in P20; findings.md records the bridge callers and retirement steps.

## Verification boundary

`tests/performance.test.cjs` retains residual baseline regression scenarios. Its temporary `tests/helpers/legacy-source.cjs` loader reads remaining declarations from authored `src/legacy.js`; bundler indentation/function spelling is not its input. Viewing fixtures now consume the real localization capability instead of extracted tables/helpers. The baseline locale coverage case moved to `tests/i18n.test.js`, alongside normalization, fallback, plural and number/time scenarios. `tests/grid.test.js` checks stylesheet installation/removal/reuse and inert resource imports. Further capability migrations move cases to public-interface suites, removing the loader and residual suite by P21.

`tests/bundle.test.js` executes the actual distribution in an offline VM browser fixture. It checks one startup, page-global navigation hooks, route entry/exit/reentry ownership, optional grants/storage/viewport behavior, cancellation both before response delivery and during body reading, live localized menu updates and stylesheet cleanup/reinstallation. These checks complement the residual declaration-based suite rather than substituting for it.

The bundle suite also checks reproducible generation, metadata and version agreement, absence of external imports, read-only rejection of stale source/output and altered installation settings, and side-effect-free legacy import. `tests/helpers/dom.js` and `scheduler.js` provide mock DOM/timer behavior; they contain no duplicated production policy. Temporary build fixtures are created under a unique ignored workspace path, validated and removed after use.

`tests/diagnostics.test.js` exercises the new public logger/report/inspection boundaries, including the eight baseline logging and pure probe scenarios transferred from the residual suite. It adds formatter fidelity, private snapshot ownership/current-session rejection and clipboard success/failure cleanup checks. Residual collection, viewing-report and native-preview cases invoke the actual capabilities with their existing feature fixtures; their feature mechanics move in later steps. A bundle case clicks the generated CopyLogs control, checks export without requests and verifies retained history across route reentry.

`tests/netflix-data.test.js` exercises the real context/page-DOM/markup interfaces: lazy profile/model fallbacks, endpoint safety, structural/GraphQL discovery including disconnected sections, tracking/modal identity and cloned preparation cleanup. Residual profile, request, chunked construction, registry/Undo and preview integration cases use the same adapters with fixture collaborators; those complete workflows move with their feature owners in later steps. DOM helper additions model compound attribute selectors and cloneNode without copying arbitrary JavaScript properties.

Eight baseline protocol cases now exercise list-data's public operations in the same suite: continuation/order, optional failures/timeouts, first-page fallback, zero/single-page results, the eight-page cap and actual/stale response survey behavior. Added cases cover private continuation ownership, normalized incomplete/duplicate records and current anchor/direction/header facts. Shared response fixtures describe wire data without duplicating parsing. Residual startup/readiness, scope cancellation, native fallback and material/publication scenarios use the real data adapter; new regressions verify one stable captured template and cancellation at the existing normalization quantum.

One baseline season-list/count validation case now exercises typed viewing reads in `tests/netflix-data.test.js`. Additional boundary cases cover credential privacy, one request per typed operation, cyclic/malformed normalization, absent versus contradictory counts, stale headers/bodies, truthful failures, forged access, batch bounds and episode diagnostic shapes. Mixed completion/reference cases in the residual suite consume real normalized records; wave, budget, repair, endpoint, cache, choice and publication integrations retain their existing assertions. A failing cancellation case caught and fixed lost transport-abort counters.

These tests prove offline control flow and build consistency. They do not establish Netflix DOM/private React compatibility, real browser frame times or a faster runtime.

`tests/app.test.js` now exercises the real scope's request replacement, deadline ownership, current-route guards and private/idempotent cleanup. Residual route, body, viewing-wave and responsive cases use that same scope with their explicit fixtures. List-data tests likewise use the real registration/timer owner instead of a copied request implementation. Composed application initialization/disposal coverage transfers to this suite in P20.

`tests/carousel.test.js` exercises the real owner for stale/forged bindings, immutable views, source/readiness polling, disposal/restart, native read sharing and logical windows. Six baseline scenarios transfer or are covered there: shared native-state reads, indicator/profile refresh, readiness sorting/read counts, track/count/column changes, exact overlapping windows and exception/async sample cleanup. The obsolete helper-call counter is replaced by exhaustive window results and bounded input reads; a source audit confirms the two-candidate policy is unchanged. Residual acknowledgement/fast-initialization regressions reject still-connected replacement owners before model or grid publication. Geometry/graft/hover and collection/responsive integrations retain their full assertions with real model/discovery collaborators until their workflow owners move.
