# Migration

## Purpose and basis

This document defines the proposed destination for an incremental migration from the single Netflix My List userscript to modular JavaScript source and a reproducible build. It is a design proposal for review, not a description of an already implemented structure or authorization to implement every increment.

The migration targets the user's personal Windows environment. Implementation, tooling and verification are scoped to Windows; Linux compatibility work and Linux CI are outside this destination. Expanding platform support requires a new user request.

The baseline is `Legacy My List for Netflix.user.js` version **1.4.5**, revision `76b7d11`. The source has 13,328 lines and 377 top-level function declarations. The existing regression suite is `tests/performance.test.cjs`. Later source changes require revisiting the relevant mappings and contracts below.

The architectural goal is to make a behavior understandable and changeable through its owning capability, with explicit dependencies and lifetimes. File length alone does not establish a boundary. The number of past discussions, reported issues, or entries in `context.md` and `findings.md` does not give a feature architectural priority. Existing preferences and findings constrain behavior that the migration must preserve; boundaries are justified by current responsibilities, shared state, resource lifetimes, and call paths.

Migration.md owns the target design, its rationale, contracts, and the acceptance conditions for increments. [MigrationPlan.md](MigrationPlan.md) turns those increments into bounded implementation steps with dependencies and completion evidence for separate prompts. `findings.md` owns selected work and migration progress. `AGENTS.md` owns repository workflow. `context.md` retains durable knowledge and preferences. The planned `docs/architecture.md` will describe implemented architecture as the migration progresses; it must distinguish implemented portions from this target design and reference this document for the destination.

## Architectural pressure in the current source

The current closure is more than a long file. Its shared `sourceState` holds native section/scroller/track references, list records and order, rendered grid/status elements, card maps, layout, and viewing state. Many functions read or modify several of these responsibilities.

Representative call paths include:

- `runScript`: discovery, initial-versus-later-entry freshness, source readiness, collection strategy, publication, source parking, status, optional viewing collection, and recovery.
- `reindexLegacyItemsAfterDelta`: membership/order bookkeeping, native mapping, DOM attributes, empty state, React invalidation, viewing groups, and header updates.
- `syncWatchGroups`: profile/manual-choice reconciliation, classification, group/filter indices, card controls, DOM placement, counters, and preservation of pointer/focus behavior.
- `prepareMountedPage` and `activateClone`: target validity, source lookup/navigation, binding, clone replacement, geometry, replay, and cancellation.
- `refreshResponsiveLayout`: layout validation, native remapping, hover validity, publication, deferred mutation retries, and recovery scheduling.

Separating these functions into files while passing the same mutable state object everywhere would retain the main coupling. The destination instead separates owners and lets a small page-session coordinator connect their public operations.

## Target repository layout

This is the concrete proposed end-state layout. Comments specify the contents of each file. Changes to a name, responsibility, public boundary, or dependency direction should update this proposal explicitly before the affected migration step.

```text
Netflix List/
|-- AGENTS.md                         Repository workflow and document boundaries
|-- context.md                        Durable knowledge and user preferences
|-- findings.md                       Selected work, findings and migration progress
|-- Migration.md                      Target architecture, contracts and increments
|-- MigrationPlan.md                  Ordered implementation steps and completion evidence
|-- README.md                         Installation, development and release commands
|-- docs/
|   `-- architecture.md               Implemented architecture and links to the target
|
|-- package.json                      Commands, dependencies and canonical release version
|-- package-lock.json                 Reproducible dependency versions
|-- userscript.meta.json              Name, grants, match rules and other metadata
|-- .gitignore                        Dependencies and temporary build output
|-- .github/
|   `-- workflows/
|       `-- check.yml                 Build, regression and consistency checks
|-- scripts/
|   |-- build.mjs                     Generate the distributable userscript
|   `-- check.mjs                     Verify output, metadata and dependency boundaries
|
|-- Legacy My List for Netflix.user.js Generated and committed Tampermonkey release
|
|-- src/
|   |-- main.js                       Construct and start the application
|   |-- dom-names.js                  Script-owned IDs, classes and attributes
|   |
|   |-- app/
|   |   |-- application.js           SPA navigation and application lifetime
|   |   |-- my-list-session.js       Assemble and coordinate one My List page session
|   |   |-- session-scope.js         Session validity, cancellation and request ownership
|   |   |-- responsive.js            Coordinate responsive checks and refreshes
|   |   `-- settings.js              Original-list preference and Tampermonkey menu
|   |
|   |-- netflix/
|   |   |-- context.js               Profile, locale, bootstrap and endpoint context
|   |   |-- page-dom.js              Section discovery and membership-action decoding
|   |   |-- list-data.js             GraphQL/page requests and response interpretation
|   |   |-- viewing-data.js          Viewing requests and Falcor response interpretation
|   |   |-- card-markup.js           Read, create and sanitize Netflix card markup
|   |   |-- native-popup.js          React binding, alignment, replay and preview ownership
|   |   |-- popup-inspection.js      Existing bounded response/component investigation
|   |   `-- carousel/
|   |       |-- carousel.js          Public native-source capability and binding ownership
|   |       |-- page-model.js        Logical indices, page mapping and wrapped-tail rules
|   |       |-- navigation.js        Serialized movement, acknowledgement and restoration
|   |       `-- collection.js        Native traversal collection and validation
|   |
|   |-- list/
|   |   |-- list.js                  Membership, authoritative order and item lookup
|   |   |-- collection.js            Choose and validate existing collection strategies
|   |   `-- mutations.js             Pending membership changes, reconciliation and Undo
|   |
|   |-- viewing/
|   |   |-- viewing.js               Public viewing-status and placement capability
|   |   |-- scan.js                  Batches, budgets, publication and repair passes
|   |   |-- completion.js            Movie completion and series caught-up rules
|   |   |-- choices.js               Manual placement, persistence and coverage expiry
|   |   `-- cache.js                 Automatic-status cache and its validation
|   |
|   |-- grid/
|   |   |-- grid.js                  Public rendering capability and grid lifetime
|   |   |-- cards.js                 Card registry, replacement and Undo markup retention
|   |   |-- groups.js                Sections, filters, counts and placement controls
|   |   |-- frame.js                 Heading, status, empty states and mismatch dialog
|   |   |-- styles.js                Existing stylesheet and selector interpolation
|   |   `-- image-diagnostics.js     Existing bounded thumbnail/resource measurements
|   |
|   |-- hover/
|   |   |-- hover.js                 Intent, scroll policy, target validity and cancellation
|   |   `-- timing.js                Existing bounded timings and frame-gap samples
|   |
|   |-- i18n/
|   |   |-- i18n.js                  Locale selection, translation and display formatting
|   |   |-- ui-messages.js           All supported UI translations
|   |   `-- log-messages.js          English/Japanese diagnostic translations
|   |
|   `-- diagnostics/
|       |-- logger.js                Bounded log buffer, formatting and trace gating
|       `-- report.js                Assemble and copy diagnostic reports
|
`-- tests/
    |-- helpers/
    |   |-- dom.js                   Shared mock DOM behavior
    |   |-- scheduler.js             Controlled timers and animation frames
    |   `-- fixtures.js              Representative responses and page structures
    |-- app.test.js                  Startup, navigation, cancellation and recovery
    |-- responsive.test.js           Resize ownership, coalescing and remapping
    |-- netflix-data.test.js         Request safety, parsing and stale-response rejection
    |-- carousel.test.js             Readiness, page model, movement and native collection
    |-- list.test.js                 Membership, ordering, queues and Undo
    |-- viewing.test.js              Scanning, completion, cache and incremental publication
    |-- viewing-choices.test.js      Profile isolation, placement and choice expiry
    |-- grid.test.js                 Rendering, groups, filters, replacement and focus
    |-- hover.test.js                Intent, native preparation, replay and dismissal
    |-- i18n.test.js                 Locale coverage and formatting
    |-- diagnostics.test.js          Logging, measurements and bounded private probes
    `-- bundle.test.js               Generated metadata, startup and release consistency
```

`styles.js` preserves the existing selector interpolation through imports from `dom-names.js`, producing one injected stylesheet. It is not a CSS framework or another generated distribution file.

Each feature's main file is its public capability, not a barrel exporting every helper. Neighboring files are private implementation. For example, other features use `netflix/carousel/carousel.js`; they do not manipulate `page-model.js` or `navigation.js` directly.

Internal files are justified by substantial coherent jobs: interpreting a wire protocol, serializing native movement, validating collection, deciding completion, or maintaining card ownership. A file does not need to be split merely to achieve a line-count target.

### Reasons for the principal boundaries

| Boundary | Code-derived reason | Consequence |
| --- | --- | --- |
| List versus viewing | Membership/order can change without completion changing; progress or a manual choice can change placement without membership changing | Separate records, commands and publications |
| List versus grid | Current membership reindexing also modifies DOM, controls and empty presentation | List owns data/Undo validity; grid owns presentation and card resources |
| Collection strategy versus native collection | GraphQL/mounted/native selection and whole-list validation differ from traversing and restoring a live carousel | `list/collection.js` selects sources; `netflix/carousel/collection.js` implements native traversal only |
| Carousel versus native popup | Readiness, traversal and remapping share the same native source; popup binding borrows that source and a displayed card | One carousel owns source generations; popup releases its borrowed interaction when they change |
| Hover policy versus native popup | Pointer intent and scroll cancellation are script policy; private React properties and native preview structure are Netflix contracts | Policy asks for a complete interaction; private component details remain in the adapter |
| Responsive coordination versus grid/carousel | A refresh has to settle native mapping and displayed geometry before deferred changes resume | A bounded application transaction coordinates the two owners |
| Completion versus scan | Classification is a rule over validated records; scan owns asynchronous scheduling and budgets | Policy can be reviewed without request/DOM mechanics, while workflow tests still exercise its real use |
| Choices versus automatic cache | Saved intent uses coverage/expiry and concurrent-tab updates; automatic reuse uses age/schema validation and fresh-result replacement | Separate private persistence mechanisms behind one viewing capability |
| Instrumentation versus reporting | Counters/samples share their feature's lifetime; retained log history and clipboard formatting have a different lifetime | Features own bounded observations; reporting consumes declared summaries |

The isolated diagnostic files hold the samplers/probes already present in the baseline, not modules reserved for future investigations. Small scalar counters stay in the feature that increments them. Their placement follows observation lifetime and integration access, not how often diagnostics were discussed.

The design uses feature capabilities with internal files rather than a blanket split into global `services`, `models`, `utils` and `controllers` directories. A complete behavior should remain local to its owner. Plain concatenation can help reproduce the legacy source during transition, but is not the destination because it does not establish state ownership.

## State and resource ownership

| Owner | Private state/resources | Public information or operations |
| --- | --- | --- |
| Application | Navigation hooks, settings, current page-session instance | Start/dispose the current session |
| Page session | Cross-feature initialization, recovery and refresh coordination | Complete feature commands, current session scope |
| Carousel | Native DOM binding, binding generation, readiness, logical model and movement state | Validated observations, collected native data, current source-card handles |
| List | Membership records, authoritative order, expected/collected counts and mutation/Undo bookkeeping | Records, membership/order changes and Undo expiry |
| Viewing | Scan ownership, automatic/cached status, manual choices and effective placement | Per-title placement/type changes and loading/failure state |
| Grid | Displayed DOM, card registry, selected filters/expansion, counts, retained card markup and focus behavior | Current card handles and user actions |
| Hover | Pending/active intent attempts, scroll policy and target validity | Native preparation/release requests |
| Native popup | Grafted React references, geometry overrides, replay owner and native-preview transfer | An owned native interaction that can be released |
| Feature instrumentation | Its bounded samples, observers and scalar counters | Diagnostic summaries |
| Logger/report | Retained log buffer, export formatting and clipboard operation | Copied diagnostic output |

There is no public mutable replacement for `sourceState`. A capability may keep an internal state object, but another capability cannot mutate it. Public views are read-only by contract. Ordinary interactions use direct item/handle lookup and small change sets rather than repeatedly copying all maps.

List records carry identity, href, title/artwork data and authoritative order. Native page mapping belongs to the carousel; viewing classification belongs to viewing; rendered DOM belongs to the grid. Collection may transfer card material alongside records, but that transfer does not make DOM part of the lasting membership model.

`netflix/card-markup.js` performs capture/construction/sanitization. It does not maintain a second global card registry. Grid card ownership begins when collected card material is accepted and ends on replacement, removal without retained Undo, expiry, or disposal. Preserve the current release of startup snapshots after publication and the shared-template strategy; the design does not require a full detached tree per published title.

Netflix membership and viewing placement remain separate concepts. A placement action changes how an existing member is displayed; it does not invoke a Netflix add/remove request.

### Data crossing a boundary

These are conceptual shapes and ownership contracts, not a new serialization layer or a requirement to clone/freeze every object on a hot path.

| Value | Contents and owner | Validity/use |
| --- | --- | --- |
| List record | Stable existing item key, nullable video ID, href, label/artwork data and list order; list owns it | No DOM, fibers, credentials, placement or mutable native-page field; membership changes carry a list revision |
| Collection result | Records, expected/collected counts, collection provenance and transferable card material | Collector owns card material until grid accepts it; failure/cancellation releases it without publishing a partial successful list |
| Native observation | Binding generation, validated page/index/count/signature and interpreted layout/identity facts | List decides whether an observed order span can update authoritative order; carousel does not rewrite list records |
| Source-card handle | Validated title/position and binding/page ownership plus a validity check; carousel owns the source | Opaque outside native integration; a matching title ID alone does not establish current ownership |
| Grid-card handle | Item key, grid/card generation and current rendered card; grid owns the card | Borrowing code cannot change its structural position or registry entry; replacement invalidates the old handle |
| Viewing change | Current session/profile ownership, changed IDs and resulting type/placement/manual state | Grid obtains current presentation for those IDs; no full-map copy is required per publication |
| Undo entry | Correlation ID, removed record, previous position and deadline; list owns validity | Grid retains markup under the correlation ID, not merely a reusable title ID; list expiry/disposal releases it |
| Diagnostic summary | Explicit scalar/serialized fields from the owning feature | Raw DOM/fiber/credential state is not a general report-provider interface; existing log-detail policy is preserved |

Keep authoritative expected count separate from collected count and pending native convergence. A transient DOM count does not overwrite validated membership. Preserve existing keys/storage schemas and interpretation of unknown title types; the architecture does not create a storage migration.

Source-card handles can carry native references within the native integration. Grid-card handles deliberately carry a rendered element for interaction. These limited borrows do not expose the entire native binding, membership store or grid registry.

Carousel source handles are unforgeable and read-only. They retain binding/session, native page-model ownership and the card's identity/index observation; accessing the borrowed slot revalidates those facts. Meaningful native mapping changes invalidate them, while repeating an unchanged observation does not. Expected-page resolution accepts identity/count/columns/page-size hints and returns found, inconclusive or mismatch plus native visible-card facts. Comparing those facts with authoritative list positions, deciding the mismatch threshold and presenting recovery UI remain outside carousel.

Mounted-card borrowing also has a synchronous operation, mountedCard, for current-source validation during hover/frame replay. The mounted mode of resolveCard owns the existing bounded 10-ms polling wait. Both accept copied identity hints and explicit source/session ownership and return the same validated handles; they add no request or navigation. Composition admits a current binding before calling them. An admitted wait keeps that binding, mapping interpretation and page rather than silently rebinding after replacement. Binding cleanup closes only the owner's pending polling tickets, and late callbacks cannot wake or clear a newer wait. Active-page filtering and shared synchronous read costs remain part of this contract.

The preferred-refresh and search modes of resolveCard own the existing preferred-page pulse and ordered nearby-page recovery. They retain one binding/mapping/session admission across navigation, mounting and hydration, including queued moves and diagnostic callbacks. Search accepts a preferred page, radius and repair hint, preserving preferred/right/left attempt order and existing deadlines. Native signature registration precedes handle publication; results contain validated source handles and copied visible identity/index facts. Carousel never updates membership page hints or clone attributes. The transitional caller may publish those hints after validating the returned handles and its parent state; P13/P17 remove that temporary publication. Existing diagnostic item fields are copied scalar hints, not a borrowed membership record.

refreshMapping owns synchronous delta anchoring and asynchronous responsive reconstruction. It accepts captured count/column hints, explicit binding/session ownership and a narrow caller-validity check; delta anchoring may read a scalar page hint for one visible title. It preserves finalized counts while native membership converges and validates canonical or compatible wrapped-tail windows before committing. New remapping admission supersedes older remapping work, including when the model is already stale. Binding/model/session and caller ownership are checked after navigation waits and diagnostic callbacks and before writes. Results distinguish anchored, committed, deferred and not-applicable outcomes; interpreted observations contain no membership records or raw card trees. Mapping results are read-only and privately registered, with isMappingCurrent/assertMapping validating their native ownership before external publication. The caller retains authoritative order, convergence policy, transitional record/card page updates and responsive scheduling; those remaining responsibilities transfer in P13/P19.

prepareSource owns native initialization admission, model reset, profile logging and the existing readiness wait as one operation. It preserves parallel readiness versus fresh-data loading and the mounted single-page hint. A successful readiness observation is read-only and privately registered against its binding, preparation and model interpretation; copied, superseded, remapped or obsolete observations cannot authorize collection acceptance. acceptCollection consumes that observation plus scalar validated count/column/collected-count facts, derives the native page count privately and returns a validated mapping observation. It does not select a collection strategy or accept membership records. The caller retains list-count reconciliation and publication, validating native ownership after callbacks before publishing. These operations replace caller-directed reset/finalize commands without adding waits, requests or a second model owner.

observeSource returns a validated, read-only source summary (mode, remapping need and retry count) without exposing page-model maps or commands. pageCards returns a validated current/viewport page observation whose entries contain source-card handles and an inPage flag; carousel alone interprets logical indices and wrapped-tail buffers. Both capture binding/model and narrow caller ownership. Page observations also retain their observed page and card identities, and reject copied or obsolete observations through assertObservation/isObservationCurrent. A resolved source handle can constrain admission so a subsequent observation cannot adopt a replacement interpretation. These bounded synchronous observations add no movement or polling, reuse the shared read scope and contain no membership records or rendered cards. The caller owns membership comparisons, page-hint publication and native-popup/grid work.

observeSource can explicitly request an optional or required native count observation. It returns copied, frozen count/readings/slot-count facts through the same admission and validation boundary; count changes invalidate that result even when binding and mapping stay unchanged. Required observations retain the existing unavailable-count error and provisional-count diagnostic, while optional observations preserve absent or contradictory readings. Ordinary mode/remap observations perform no count read. Membership convergence, count reconciliation and mismatch thresholds remain caller decisions, checked against current native/caller ownership before publication. Native index comparisons consume existing validated source-handle facts rather than accepting raw React reads. Carousel diagnostics owns bounded card descriptions (identity, index normalization, native markers and rectangle summaries); these passive snapshots are not publication authority, invoke no feature work and cannot reject an admitted interaction when description fails. This deepens the existing source/diagnostic interfaces without adding a capability or folder.

Carousel diagnostics also owns a passive native-source description: selected page, interpreted page count, source/current card counts, profile/capability/mapping summary and scan/parking markers. A caller supplies only the native section/scroller/track references it is describing, including incomplete discovery. The copied, frozen description contains no DOM/model commands and uses one shared synchronous sample; it cannot authorize initialization, empty-list admission, membership convergence or responsive publication. Description failure returns an unavailable summary without aborting admitted runtime work. Ordinary counter-only diagnostics perform no source reads. Initialization logging and report composition consume this description rather than separately interpreting native structure/profile state. Operational callers continue to use validated source/page observations. This extends the existing diagnostic boundary and creates no background work, observer, timer or folder.

An explicit position request on observeSource adds a frozen selected-page/page-count pair through the existing registered observation boundary. Carousel owns logical/indicator page interpretation and validates the pair again before operational publication; changed page/count, binding/model/mapping, route or caller admission invalidates it. Default mode/remap/count observations do not request these additional page facts. Reinitialization retains one parent and binding across return-to-start navigation and observes the confirmed position after movement; old work cannot tear down a replacement session. Hover reuse/preparation and responsive page-shape decisions consume admitted position facts and revalidate around callbacks/publication. Intent/recovery policy, authoritative list order and responsive scheduling stay with their current coordinators. This extends the existing source observation without adding a capability, movement, polling or background resource.

pageCards owns the complete observed window, including its ordered membership when empty or when existing cards remain connected outside that window. It supplies a scalar href signature; an explicit template request supplies a validated source handle for the first observed card, falling back to the first filled native card under the existing GraphQL template policy. Template selection and capture are checked before asynchronous data work; detached material then follows the existing collection/grid ownership. observeSource may explicitly request a copied, frozen readiness summary through the same registered admission. Readiness changes invalidate that receipt; default observations add no readiness work. Post-collection decisions retain their original parent and binding across the await, validate before empty admission and publication, and discard obsolete work without modifying a replacement session. These are synchronous extensions of existing observations, with no new waiting, collection strategy, scheduler, capability or folder.

Carousel.measureLayout owns visible, empty and bounds-only native geometry observations. It can measure an explicit incoming section before adoption without changing the accepted binding or page model; a receipt does not authorize source adoption. It retains the existing binding generation, route and narrow caller admission, optional already-admitted binding, connected measurement references and sampled scalar geometry. Copied frozen layout/bounds facts are privately registered and revalidated through assertObservation/isObservationCurrent. Existing visible/empty formulas, viewport clipping inputs and one synchronous sample are preserved. Bounds-only observations perform no card/layout scan. Callers copy layout facts before adding application-owned row spacing, and validate after formatting/callbacks before presentation or responsive publication. Intentional binding adoption or layout publication ends the prior admission; composition uses the new owner's facts afterward. Discovery/adoption policy and native restoration remain their separately planned responsibilities. This geometry operation deepens the existing carousel capability and adds no file, capability, movement, wait or background work.

## Dependency rules

1. `main.js` and `app/` construct instances and connect their public operations directly. Use explicit callbacks and collaborators; no event bus, service locator, or framework is required.
2. Netflix endpoint, response, DOM, React and native-layout assumptions are interpreted in `netflix/`. Other features consume the resulting records/observations and public operations.
3. Completion and manual-placement rules operate on interpreted data. They do not inspect raw Falcor graphs, React fibers or native DOM.
4. Grid owns structural/presentation changes to displayed card trees. Native interaction code requests replacements through the grid interface and may attach/clear only its owned React/hover metadata on a current borrowed card.
5. List/viewing changes reach the grid through the page-session wiring. Neither list nor viewing edits card DOM.
6. Hover uses the grid's current card interface and the native source/popup interfaces. It does not write membership, profile storage or grouping state.
7. Instrumentation/reporting observes feature state through bounded operations. A diagnostic failure does not cause recovery, reject an admitted interaction or change classification.
8. Internal files within a capability are not public cross-feature dependencies. A build-graph check enforces the declared import directions and public entry points.

The page session coordinates workflows but does not implement carousel algorithms, completion rules, DOM construction, or manual-choice persistence. This is an explicit limit on `my-list-session.js` so it cannot inherit the monolith's ownership.

The production dependency directions are concrete:

| Importing area | Allowed collaborators | Prohibited back-dependencies |
| --- | --- | --- |
| `main.js`, `app/` | Public feature constructors, `netflix/` entry points and support modules; `app/` internals | Other areas importing application coordination |
| `netflix/` | Other declared Netflix entry points, its own internals and `dom-names.js`; injected logging/scope callbacks | Importing list/viewing/grid/hover/application state or implementations |
| `list/` | Its internals and public list-data/page-DOM/carousel operations | Viewing/grid/hover internals or DOM rendering |
| `viewing/` | Its internals and public context/viewing-data operations | List/grid/hover internals or native DOM |
| `grid/` | Its internals, card-markup operations, DOM names and localization | Membership/viewing decision code, carousel internals or private React machinery |
| `hover/` | Its internals, native-popup/carousel operations and injected current-card/replacement operations | Grid internals, membership/persistence code or application scheduling implementations |
| `i18n/`, `diagnostics/` | Their own internals and explicit injected locale/snapshot/probe providers | Importing mutable feature state or initiating runtime feature work |
| `dom-names.js` | Literal script-owned DOM names only | Runtime feature imports |

Production modules expose constructors/functions without starting listeners, requests or work at import time. Instance creation and activation are explicit. Pure completion logic has no integration dependency. Tests may import internal pure policies for supplementary unit checks, but also exercise the capability workflows that use them.

The native adapter's card-replacement collaborator is supplied by the composition, not imported from grid. Its one operation validates an expected card handle and asks grid to replace markup. Likewise, localization receives a locale reader, and reporting receives explicit feature summary/probe providers. These callbacks express narrow capabilities, not access to an application context bag.

## Public capability contracts

The names below define the intended responsibilities; implementation may refine parameter shapes while retaining these ownership boundaries.

| Capability | Intended operations | Work hidden behind the boundary |
| --- | --- | --- |
| Page session | `start`, `reinitialize`, `dispose` | Composition, initialization phases, recovery, feature replacement and disposal order |
| Carousel | `prepareSource`, `acceptCollection`, `collect`, `resolveCard`, `refreshMapping`, `observeSource`, `pageCards`, `measureLayout`, `diagnostics`, `dispose` | Readiness admission, binding checks, private React indices, navigation serialization, acknowledgement, validated source/page/layout observations and mapping |
| List | `initialize`, `observeMembership`, `reconcileOrder`, `deferReconciliation`, `getItem`, `diagnostics`, `dispose` | Strategy selection, validated order, pending actions, deferral tickets and Undo bookkeeping |
| Viewing | `start`, `refresh`, `place`, `getPlacement`, `diagnostics`, `dispose` | Profile checks, scan budgets, automatic/cache/manual precedence, persistence and choice expiry |
| Grid | `mount`, `applyListChange`, `applyViewingChange`, `replaceCard`, `getCard`, `diagnostics`, `dispose` | Registry, rendering, controls, grouping/filter presentation and card retirement |
| Hover | `attach`, `cancel`, `diagnostics`, `dispose` | Intent, scroll rearming, superseded targets, native activation and dismissal policy |
| Responsive coordination | `requestCheck`, `whenStable`, `diagnostics`, `dispose` | Coalescing, geometry comparison, native remapping and safe refresh publication |
| Native popup | `open`, `release`, `diagnostics`, `dispose` | React binding, alignment, replay validation and native-preview ownership |

`ready`/`resolveCard` results must distinguish empty, not ready, cancelled, identity/order mismatch and failed integration. A positive expected count cannot silently become an empty list because the DOM source is missing.

Carousel's `mountedBootstrap` operation qualifies only native membership; the list owner decides whether an entry may use it. Its frozen public snapshot contains count, first title and provenance/timing facts. Native source/session/signature proof remains private and cannot be recreated by copying that snapshot. `collect` accepts an explicit mounted-single-page mode and revalidates that proof before capturing material; rejection lets list select its existing fresh-data fallback. `anchorPageZero` validates the fresh first-title hint against the mounted indicator source, including the existing normal adjacent-page round trip. List supplies the hint and entry policy; carousel owns the native checks, waits and failure result.

Network adapters own same-origin endpoint validation, credential construction, wire encoding and body parsing. Viewing batch operations correspond to bounded actual requests so scan request budgets remain meaningful. Adapter results must distinguish absent, malformed and contradictory metadata; completion logic cannot treat absent data as completion.

Viewing data methods represent one bounded HTTP batch each: title reads, season/coverage reads, episode reads and direct episode repair. They expose normalized progress/coverage data rather than Falcor paths. Scan counts actual dispatched requests, drains the existing allocated wave before finalizing partial results, and stops new requests after a terminal failure. Profile/auth material is held only by the adapter's transient request context.

Native layout observations include the validated slot dimensions, columns, relevant bounds and source-state hints. Grid receives the interpreted layout and a valid mount anchor for its owned UI; it does not discover Netflix sections or infer private page indices. Native parking and original-source visibility/style changes remain native integration operations.

All work that awaits a timer, frame, request or response body validates its relevant owner before publishing. A stale operation cannot update a replacement grid, a new profile, or a newer hover attempt.

## Complete collaboration paths

### Initialization and source recovery

The page session assembles the owners and begins list initialization. List collection selects among the existing mounted-single-page, GraphQL and native traversal strategies while preserving the initial-versus-later-entry freshness rules and existing overlap of independent readiness/data work. Carousel owns readiness and native collection; list owns completeness/order validation.

The session mounts validated records and their card material through grid, then starts viewing work against the current profile and membership. The ordinary grid is published before optional viewing work finishes. Feature publications from this session are rejected after its invalidation.

On native source replacement, carousel invalidates old source handles. Hover releases the affected native interaction. The session coordinates adoption/remapping or bounded reinitialization and republishes through the same grid interface. Membership changes queued during recovery remain with list until safe to reconcile; route exit clears obsolete session work.

The native adapter provides a current mount anchor for frame attachment; grid attaches/removes only its owned UI. Grid owns synthetic empty presentation, while native source discovery and populated-to-empty adoption remain native integration. Preserve the baseline waiting/fallback distinctions, including not injecting a synthetic section into Netflix's managed stack during the last-item transition. Old script UI cleanup belongs to grid; restoration of old source hooks/styles belongs to native integration.

### Membership changes and Undo

`page-dom.js` interprets an observed Netflix action into a membership intent. List owns admission, convergence, retries and order updates; it never assumes that an observed click alone proves the final server/native state. Grid applies the resulting membership change through its card registry.

List owns the removed record, original position and existing Undo validity/expiry. Grid owns the detached card tree retained for that Undo entry. When list announces expiry, grid releases the tree; an Undo restores through the normal insertion/card preparation path. There is one expiry decision rather than separate feature timers that can disagree.

### Viewing and manual placement

Grid reports a placement action. Viewing decides whether it restores agreement with automatic classification or creates/changes a profile-scoped manual choice. It owns persistence and truthful storage-failure results, series coverage baselines and expiry, and cache/automatic/manual precedence.

Viewing publishes changed placements/types through the session to grid. Grid updates the relevant controls, sections, counts and filters while preserving existing scroll/focus behavior. Response arrival does not alter authoritative Netflix order or Netflix membership.

### Hover and card replacement

Hover admits a valid current grid target after the existing dwell/scroll guards. It asks carousel for the validated native source and native popup for the complete native interaction. Netflix React details remain within the native integration.

If preparation needs fresh markup, native popup requests replacement through grid. Grid retires the old card handle, updates its registry, restores the item's controls/group/filter presentation and returns the current card handle. Bind/replay proceeds only with current source, card and hover ownership.

Replacement is one synchronous structural operation: validate the expected handle, release borrowed native state for that handle, prepare presentation/controls, commit the DOM/registry/group-index change, then publish the replacement handle. There is no await between retirement and registration. Failure leaves a consistent retained card or an explicit unprepared state, not a registry entry pointing to an obsolete tree. Native attachment/cleanup is restricted to its own properties and markers.

An intentional replacement requested by the current admitted preparation transfers that attempt to the returned card handle through its owning hover policy. It invalidates the old handle without cancelling the very attempt performing the replacement. Other retirement/replacement cancels affected obsolete attempts. The handoff validates the expected item/card and current attempt; a matching title ID is not permission for a stale attempt to adopt an arbitrary replacement. Test this through the composed grid/native/hover path, not just isolated helpers.

Filter/group operations retire or invalidate affected card interactions through the same path. When a preceding card moves, only the current protected hover targets need a before/after geometry comparison; preserve the existing bound instead of inspecting all cards. A purely cosmetic no-op publication does not reset an unrelated stationary hover.

Ready grafted-card tracking and the active native interaction belong to the native integration. Grid notifies it before affected card retirement. Merely changing registry ownership does not add a full-grid React invalidation pass or prepare sibling cards.

### Responsive refresh and deferred membership work

`app/responsive.js` owns coalesced viewport/source-size checks and the refresh transaction. Native geometry interpretation and logical remapping remain with carousel; displayed geometry changes remain with grid. The existing parked-source exceptions, clipping/viewport guards and obsolete-owner checks move with their behavior.

The page session coordinates when membership reconciliation must be deferred during initialization, recovery or a real responsive refresh. `list.deferReconciliation(reason)` returns an owner-specific, idempotently releasable ticket. List retains intents and their existing admission/timeout behavior while tickets are active; final release resumes them only against a valid current source. Disposing the session drops obsolete tickets/intents. Completion of an old refresh cannot release another ticket or drain changes against a stale binding.

Hover-facing card resolution is wrapped by the page session: it waits for an admitted responsive refresh, then revalidates target/session ownership before asking carousel for the source. The refresh's own ready/collect/remapping calls use carousel directly and do not wait on that same refresh transaction. This prevents a self-wait while keeping application refresh code out of Netflix adapters. Preserve current ordering/concurrency; a deferral ticket does not introduce a universal queue serializing unrelated network, rendering and native operations.

### Original-source preference

Settings owns reading/saving the existing original-list preference and its menu action. It reports the preference to the page session, which asks native integration to update its source visibility and grid to apply the corresponding frame spacing. Settings does not edit native/grid DOM, and grid does not own persistence of this application preference.

### Diagnostics

Feature counters and sample lifetimes remain with their owner. `logger.js` owns the existing bounded page-memory log buffer and trace gating. `report.js` assembles feature-provided snapshots and performs the existing explicit clipboard export.

Existing bounded popup inspection stays in `netflix/popup-inspection.js` because it inspects Netflix response/component assumptions. Its structural summaries remain read-only and do not invoke private callbacks. The migration does not add a metadata preload, direct opener, diagnostic polling loop or new copied-detail policy.

## Lifecycle and performance contracts

- Application lifetime: navigation hooks, settings/menu and the retained logger.
- Page-session lifetime: current target route, feature instances, request ownership and scheduled page work.
- Profile validity: every profile-dependent publication/storage operation checks the current active profile; a stable route URL does not establish profile identity.
- Native-binding lifetime: handles are invalidated by section/scroller/track replacement and relevant recycling/mapping changes.
- Grid-card lifetime: handles are invalidated on retirement/replacement even if the title ID is unchanged.
- Hover-attempt lifetime: superseding, scroll, pointer departure, controls, visibility, resize and owner changes invalidate the relevant work independently of route validity.

Disposal is repeatable. Old cleanup can release only resources belonging to its old owner. It cannot delete a newer owner's card registration, timer, geometry proxy, native preview or style restoration.

Resource ownership is explicit:

| Resource | Owner and scope |
| --- | --- |
| History/navigation hooks and global menu registration | Application/settings, application lifetime |
| Native section discovery/replacement mutation observer | Carousel instance, page-session lifetime; page-DOM supplies discovery/decoding helpers |
| Logical move acknowledgement observer and temporary animation/style overrides | Navigation operation under the carousel; always restored by that operation |
| Observed Netflix membership click listener and pending-action convergence observers/timeouts | List mutation capability, session/intent lifetime |
| Grid delegated placement/filter/group controls | Grid instance; handlers report semantic commands |
| Grid delegated hover and document pointer/wheel/scroll policy listeners | Hover instance, page-session lifetime |
| Native-preview departure handling, delayed presence check and React/geometry leases | Native popup instance/current interaction |
| ResizeObserver, window/visual-viewport resize listeners and coalesced refresh timer | Responsive coordinator, page-session/refresh lifetime |
| HTTP abort-controller registration | Session scope provides parent invalidation; adapter/scan owns its narrower timeout/job cancellation |
| Undo expiry timer | List mutations; grid responds to expiry and owns only retained markup |
| Hover frame sampler and image-resource observer | Their declared feature instrumentation, existing route/window budgets |
| Clipboard operation and report building | Report capability for one explicit Copy Logs command |

Ownership transfer does not duplicate listeners/observers from the baseline. Narrow discovery after binding, ignore script-owned mutation noise while preserving external grid-removal recovery, and coalesce native work as before. Guards use separate session, profile, native-binding, card and operation validity; one cancellation token cannot substitute for all of them.

Cancel queued native work before issuing its click. For an already-issued native click, preserve the current acknowledgement/settlement and restoration semantics; pointer cancellation is not a rollback. Route cancellation retains its existing termination behavior and prevents stale publication.

Keep delegated listeners, bounded observers/samplers, chunked construction, cached reads, local card/group updates and current request/time budgets. Ordinary browsing must not gain repeated full-list copies, whole-grid scans, per-card listeners, periodic metadata work or eager hover preparation as a consequence of modularization.

## Source change map

Mappings refer to named baseline functions rather than permanent line numbers. They are examples of coherent transfers, not a claim that every current function moves unchanged.

| Current source region/functions | Destination |
| --- | --- |
| Locale tables, `tUi`, `tLog`, message/number formatting | `i18n/` |
| Script-owned IDs/classes/attributes and `addStyle` | `dom-names.js`, `grid/styles.js`, grid stylesheet ownership |
| `cleanupOldArtifacts`, original-header/source-visibility changes and empty-source adoption | Owned UI in grid; native hook/source restoration and discovery in Netflix adapters; coordinated by the session |
| `installSpaNavigationHooks`, `handleRouteChange`, target-session start/suspend | `app/application.js`, `my-list-session.js`, `session-scope.js` |
| `loadSettings`, `saveSettings`, `refreshMenuCommands` | `app/settings.js` |
| GraphQL/page bootstrap, carousel queries, response field interpretation | `netflix/context.js`, `list-data.js` |
| `netflixDom`, section discovery and native membership-action decoding | `netflix/page-dom.js` |
| Falcor atoms/references, endpoint construction and `fetchViewingGraph` | `netflix/viewing-data.js`, `context.js` |
| `netflixReactCarousel`, readiness/binding reads and source resolution | `netflix/carousel/carousel.js` |
| Logical index normalization, expected page indices and wrapped tails | `netflix/carousel/page-model.js` |
| `moveOnePage`, page waits, fast restoration/repair | `netflix/carousel/navigation.js` |
| `collectAllItemsLogical`, `collectAllItems` and traversal validation | `netflix/carousel/collection.js` |
| Strategy/count decisions from `runScript` | `list/collection.js`, coordinated by the page session |
| Membership/order bookkeeping and item lookup | `list/list.js` |
| Queued mutations, convergence/retries and Undo expiry | `list/mutations.js` |
| `classifyViewingVideo`, validated series/latest-episode rules | `viewing/completion.js` |
| Viewing batching, incremental publication, budgets and direct repair | `viewing/scan.js`, `viewing/viewing.js` |
| Manual-choice reconciliation, persistence and effective placement | `viewing/choices.js` |
| `readViewingCache`, `writeViewingCache` and cache validation | `viewing/cache.js` |
| DOM/filter/control work in `syncWatchGroups` | `grid/groups.js` |
| Card creation, replacement/registry and retained Undo markup | `grid/cards.js`, using `netflix/card-markup.js` |
| Native markup identity/sanitization and snapshot construction | `netflix/card-markup.js` |
| Heading/status, empty states, mismatch dialog and grid publication | `grid/frame.js`, `grid/grid.js` |
| Hover dwell, target validity, scroll rearming and cancellation | `hover/hover.js` |
| `netflixReactHover`, geometry proxy, replay and preview ownership | `netflix/native-popup.js` |
| Responsive scheduling/refresh | `app/responsive.js`, using carousel and grid operations |
| Bounded hover/image samples | `hover/timing.js`, `grid/image-diagnostics.js` |
| Response surveys and private native shape probes | `netflix/popup-inspection.js` |
| Log buffer/formatting, report assembly and clipboard export | `diagnostics/logger.js`, `report.js` |

For mixed functions such as `syncWatchGroups`, `reindexLegacyItemsAfterDelta`, `prepareMountedPage` and `runScript`, transfer responsibilities incrementally. Preserve the workflow through explicit owners instead of assigning the entire mixed function to whichever folder sounds closest.

## Build and release design

Use plain JavaScript modules, an esbuild build script and native Node regression tests. Pin build dependencies through `package-lock.json` and use the same declared Node runtime in CI and development.

- `npm run build`: generate the existing root `.user.js` as one self-contained browser script with its userscript header first.
- `npm test`: run regression cases and generated-bundle checks.
- `npm run check`: verify that freshly generated output matches the committed distributable, metadata/internal/package versions agree, grants and execution settings are preserved, and module dependencies satisfy this design.
- CI also runs JavaScript syntax checks and `git diff --check`.

`package.json` supplies the canonical release version. `userscript.meta.json` supplies the other metadata, including repeated grants and flag entries. The build inserts the same release version into metadata and internal `SCRIPT_VERSION`; maintain existing name, namespace, match, grants, run-at, sandbox mode and noframes semantics. `build.mjs` exposes one generation function used by `check.mjs` and bundle checks, avoiding separate implementations of header/version assembly.

Keep the output readable and committed at the existing filename. The runtime has no external module requests, Node imports or new `@require` dependency. Bundle styles/translations into that same distributable. Build consistency uses deterministic generation, not timestamps. Preserve the existing escaped non-ASCII runtime-string convention.

Follow `AGENTS.md` release rules on every pushed distributable change. Architectural work that edits the output is a patch release unless its behavior actually qualifies for another increment. Documentation-only changes retain the current userscript version.

## Incremental route to the destination

Current selection and completion status are recorded only in `findings.md`. Every increment must leave a working, reviewable repository and a usable generated userscript.

The eight rows below are architectural milestones. Execute their prompt-sized steps from MigrationPlan.md; do not treat an entire row as the default scope of one prompt. The step plan preserves this destination and explicitly describes temporary callers and their removal.

| Increment | Concrete result | Acceptance condition |
| --- | --- | --- |
| 1. Establish the build | Build/version/header definition, commands, CI, consistency and bundle checks; runtime remains in temporary legacy source | Existing behavior/cases retained; valid self-contained output; repeat builds produce identical output; header/internal version agreement |
| 2. Extract resources and logging | Localization, DOM names, styles and logger in final locations | Translation and CSS behavior retained; trace gating/log bounds preserved; resources do not import feature state |
| 3. Establish Netflix boundaries | Context, page DOM, card markup and data adapters in final locations | Existing response variants/fallbacks/safety rules retained; normalized results and request cost contracts tested |
| 4. Own the native carousel | Binding, page model, navigation and native collection behind `carousel.js` | One binding/model/queue owner; existing readiness, serialization, cancellation, restoration and collection cases retained |
| 5. Separate membership and presentation | List records/queues/Undo separated from grid card ownership | Membership model has no lasting DOM references; add/remove/order/Undo and empty/source transitions use complete public paths |
| 6. Separate viewing and presentation | Scan, completion, choices and cache publish through viewing; grid renders groups/controls | Existing profile, cache, incremental grouping, manual-choice, filter and failure cases retained; viewing performs no DOM writes |
| 7. Own interaction and responsive workflows | Hover policy/native interaction/card replacement and responsive coordination use public interfaces | All relevant handles/lifetimes checked; retirement is complete; existing local-work and stale-cleanup cases retained |
| 8. Finish composition | Final page-session assembly; remove legacy source/harness and enforce final dependency rules | No shared mutable monolith state or public private helpers remain; all existing behavior cases covered; final tree matches this document |

Temporary migration files are limited to `src/legacy.js` for the residual monolith and `tests/helpers/legacy-source.cjs` for any remaining declaration-extraction support. The current `tests/performance.test.cjs` can remain during migration. These three files are removed before the final increment is complete; they are not part of the end-state tree.

The first build increment adapts the declaration-extraction tests before bundler formatting changes can invalidate them. It can test remaining declarations in authored legacy source while separate bundle checks execute generated startup/lifecycle paths. As a capability is migrated, its cases move to public-interface tests and its legacy dependencies are supplied through explicit fixtures. Do not preserve extraction from generated indentation/function spelling as the permanent test architecture.

The existing 326 cases are baseline coverage to preserve, not a mandatory permanent test count. Cases may be reorganized or strengthened without replacing useful workflow coverage with assertions that only mirror a helper's implementation. Shared mock helpers contain mock behavior and fixture construction, not duplicates of the production rules being tested.

## Validation of the migration

Each selected increment validates both behavior and architecture:

1. Run the existing cases affected by the move and the required regression suite; validate syntax, matching versions, generated output and whitespace.
2. Check source changes and generated changes together. Confirm each state/resource has its declared owner and no new direct writes to another owner's internals.
3. Trace entry, success, partial failure, source replacement, profile/route cancellation and disposal through the actual public operations.
4. Verify observer/listener/timer ownership and the retained bounds on network, sampling, card work and memory.
5. Check the dependency graph and whether a representative behavior can be understood through its capability and a small number of collaborators.
6. Record result/remaining limitations in `findings.md`; update this target only for an explained design change. Update implemented architecture documentation as real boundaries land.

Mocked deterministic checks establish ownership and control flow; they do not establish real Netflix frame times, DOM compatibility or private-component contracts. Preserve the existing user-owned live Netflix checks after releases. An architectural migration does not itself establish faster scrolling or a new native popup entry point.
