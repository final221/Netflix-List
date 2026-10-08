# Implemented architecture

This document owns the implemented architecture and continuing ownership, dependency and lifecycle contracts. [docs/findings.md](findings.md) records decisions, completed work, release evidence and user-supplied live logs. The modular-source migration is complete; its retired implementation plan is no longer a working authority.

## Build and dependency boundary

`package.json` owns the release version and exact Node/npm/esbuild versions. `package-lock.json` locks dependencies; `userscript.meta.json` preserves the installation identity, update/download URLs, Netflix match, grants, raw sandbox and document-idle behavior. `scripts/build.mjs` generates the readable self-contained userscript at `dist/My List for Netflix.user.js`, injecting identical metadata/internal versions with no external runtime imports or source map. The installation name/namespace, match, grants, run-at, raw sandbox and noframes semantics remain stable; output preserves the escaped non-ASCII runtime-string convention and includes styles/translations without @require or runtime module fetches. Authored runtime changes belong under `src/`. The committed dist/ artifact is the installable release; build creates its directory when absent. Filename/location changed in 1.4.62 with explicit updateURL/downloadURL pointing to the new raw GitHub path. Existing installations use the new README link once to adopt that location; name/namespace and saved-setting keys remain unchanged.

`scripts/check.mjs` generates in memory and checks the existing artifact without overwriting it. It verifies metadata, syntax, normalized output equality, reachable production files, declared capability entry points and absence of cycles/external dependencies. Application composes public features/adapters; private feature files are accessible only within their owner. Netflix/native code cannot import app. There is no legacy import exception or production legacy file. Dependency metadata contains no `src/legacy.js`; deliberately reintroducing that edge fails verification. Graph checks supplement actual state/resource/caller reviews rather than proving ownership by themselves.

`.github/workflows/check.yml` runs one Windows job with locked dependencies and the package's Node version. It checks committed output before tests or rebuilding, runs the offline suites, verifies reproducible output/dependencies/syntax/commit whitespace and rejects tracked build changes. README owns the runnable commands. Live Netflix compatibility remains user-owned.

## Continuing architectural contracts

### Dependency and boundary rules

Each feature's main file is its public capability; neighboring files are private implementation. Boundaries follow state, resource lifetime and complete behavior, rather than file length. Application connects explicit operations and callbacks, without a shared mutable context bag. Instance activation is explicit; imports start no listeners, requests or timers.

| Importing area | Permitted dependencies outside its private implementation |
| --- | --- |
| main and app | App internals, public list/viewing/grid/hover capabilities, declared Netflix entries, DOM names, localization and logger/report |
| Netflix and private carousel | Declared Netflix entries and DOM names; logging, scope and grid replacement arrive as injected collaborators |
| List | Public list-data, page-DOM and carousel entries |
| Viewing | Public context and viewing-data entries; pure completion has no adapter dependency |
| Grid | Card-markup, DOM names and localization |
| Hover | Native-popup and carousel; current card/replacement operations are injected |
| Localization and diagnostics | Their own internals and injected locale/snapshot/probe providers |
| DOM names | Literal names with no runtime feature imports |

These are the directions enforced by scripts/check.mjs. A declared Netflix entry does not grant access to another capability's private files. No production area imports app coordination. List/viewing changes reach grid through session wiring. Only grid changes displayed structure; native popup attaches or restores only its owned interaction properties on borrowed cards. Netflix DOM, React, protocol, endpoint and geometry interpretation stays in adapters. Passive diagnostics cannot authorize publication or trigger recovery, reject an otherwise admitted interaction, or change classification.

### Values and publication

| Boundary value | Continuing contract |
| --- | --- |
| Membership record | Canonical frozen scalar identity/display data; no DOM, fiber, credentials, viewing placement, native page or Undo fields. Order comes from current membership, never a stale copied native position. |
| Collection transfer | Complete records/count/provenance plus separate material/page readers and exact release. Grid and membership accept at one synchronous point before obsolete cleanup. A declined acceptance cannot report a successful change. Failure/cancellation cannot publish a partial successful list. |
| Native receipt or handle | Read-only and privately registered against its exact binding, model, operation and observed facts. Copying scalar facts or matching a title ID cannot recreate authority. |
| Grid-card handle | Exact registry/card identity; retirement invalidates it even when the title is unchanged. Borrowers cannot move it or edit its registration. |
| Viewing publication | Changed IDs and semantic type/placement/manual/loading/failure facts, admitted against current session, profile and membership. No raw job/result/controller/coverage maps cross the boundary. Grid rebuild transfers accepted classification/choice/cache facts to the new viewing session before retiring old work, without resuming requests or letting old refresh completion clear a newer owner. |
| Undo | List owns record, saved position, correlation and deadline; grid owns retained markup under that exact correlation. A reusable title ID cannot borrow another removal's tree. |
| Diagnostic summary | Copied bounded facts, without general access to raw DOM/fibers/credentials or operational authority. |

Authoritative expected count, accepted collected count and pending native convergence remain distinct. Missing native content with a positive expected count is not proof of an empty list. Empty, unavailable, cancelled, identity/order mismatch and failed integration remain different outcomes. Synthetic empty presentation stays grid-owned and must not insert a synthetic section into Netflix's managed stack during last-item adoption.

List-data uses one count parser for cached/bootstrap discovery and fresh GraphQL responses: only numeric values or nonblank numeric strings representing nonnegative safe integers are admitted. An unavailable count stays unavailable until validated data arrives; a successful empty collection requires both an expected count of zero and the observed empty native shape. Settings isolates optional menu-registration failures, reports them through the application logger and still delivers saved preference changes; menu availability cannot prevent page-session startup.

Network adapters validate same-origin endpoints, construct transient credentials, encode requests and parse bodies. Viewing methods represent bounded actual HTTP batches; scan budgets count dispatched requests, drain an allocated wave and stop new dispatch after terminal failure. Absent, malformed and contradictory metadata stay distinguishable; absent progress cannot imply completion. Storage keys/schema, six-hour automatic-cache validation, fresh-only cache saving, manual precedence and conditional series-coverage expiry remain preserved.

### Native observations and lifetimes

| Native receipt | Distinct validity proof |
| --- | --- |
| Binding | Issued identity, route/generation, accepted references and connectedness |
| Source card | Binding/model revision, live slot/href/React index, filled membership and indicator-page ownership |
| Mapping result | Exact mapping operation/result revision, including the committed replacement model |
| Preparation | Exclusive owner, model/generation, readiness and one-time complete-count acceptance |
| Observation | Exact operation plus requested live-fact validation within a synchronous read scope |

These receipts retain separate validity proofs. Native count, position, readiness, presentation, geometry and page-window changes can invalidate their respective receipts without a route change. A universal generation token cannot replace these checks.

Discovery observes without adopting; identity-only discovery avoids profile/card/count/geometry work. Geometry can describe an incoming source without authorizing adoption. Explicit page-window/template observations include ordered/empty windows and wrapped-tail inPage interpretation. Native handles validate connectedness, identity, index and relevant page/model ownership when borrowed. Shared synchronous read scopes end before await. Descriptions and layout scalars copied for formatting remain passive unless their original receipt is still admitted.

Mounted bootstrap proof stays private to carousel; list chooses whether entry may reuse it and falls back to fresh data if revalidation fails. Initial versus SPA freshness, logical versus indicator count policy, fresh indicator page-zero anchoring, preferred/right/left search order and wrapped-tail rules remain distinct. Readiness overlaps independent fresh-data work with a handled result; count-request failure must not leave an unhandled readiness rejection. Native signature admission precedes source-handle publication, while exact-record page hints remain carousel-owned for the current membership parent.

Session, active profile, native binding/model, grid card and hover attempt are independent validity dimensions. Revalidate after asynchronous waits and around reentrant adapter, storage, diagnostic and cleanup callbacks before publication. Dispose repeatedly without releasing a newer owner's requests, timers, styles, grafts, geometry or preview. Source presentation, navigation motion and popup geometry retain separate restoration owners; cleanup attempts independent resources after a host failure.

Cancel queued native work before its click. Once a click is issued, navigation retains bounded acknowledgement, settlement and restoration: pointer departure cannot roll it back. Readiness retirement is separate from issued-move settlement. Session pauses and carousel readiness timers/confirmation frames are cancelled and settled by their exact owners.

### Composed behavior and bounded work

Grid publication precedes optional viewing completion. Membership clicks require observed convergence rather than assuming the click changed server/native state. Add/remove accept membership and registry together; captured input release is identity-checked so it cannot consume a newer capture. Native mapping and displayed page attributes can change without rewriting membership order.

Card replacement is synchronous across retirement, presentation/control preparation and registry acceptance, with no await inside that handoff. Only the exact admitted preparation can transfer its hover attempt to the replacement; unrelated retirement cancels it. Failure leaves a consistent card or explicit unprepared state. Cosmetic no-op grouping preserves unrelated stationary hover; geometry checks are limited to protected targets, without sibling hydration or a whole-grid invalidation pass.

Initialization/recovery/responsive work holds exact, idempotently releasable list deferral tickets. Final admitted release retries current intents; old release cannot drain a new transaction and session disposal drops obsolete intents. Hover-facing resolution waits for responsive stability and then revalidates. Refresh-internal native calls use carousel directly and cannot wait on their own transaction. Deferral does not serialize unrelated requests, rendering and native work into a universal queue.

Keep delegated listeners, filtered/coalesced observers, cooperative 24-item/6-ms construction, bounded requests/retries/sampling and local card/group updates. Ordinary browsing adds no periodic metadata work, eager hover preparation, repeated full-list copies, per-card listeners or whole-grid scans. Settings owns semantic preference persistence; source visibility and frame spacing remain native/grid operations. Feature counters and probes retain their feature lifetimes; explicit reporting owns clipboard export.

Architecture review traces success, failure, source/profile replacement, route cancellation and disposal through actual callers and cross-owner write sites. A passing import graph or total test count alone cannot prove ownership or preserved behavior. Tests use real owners and input fixtures, retain useful observable scenarios and use targeted assertion-sensitivity checks for reductions. Offline evidence does not certify current Netflix private React/DOM compatibility or frame times; those remain version-specific user testing.

## Application and page sessions

The [repository map](../README.md#repository-layout) locates documentation, evidence, tooling and the release artifact. The composition map below uses paths under src/, with src/main.js shown as the root entry.

```text
src/main.js
  -> app/application.js: startup, navigation, logger, settings and current session
     -> app/settings.js: persisted semantic preferences and exact menu callbacks
     -> app/my-list-session.js: one My List visit's composition and transactions
        -> app/session-scope.js: page-owned request registry, deadlines and cancellation
        -> app/responsive.js: viewport/source checks, refresh and list deferral
        -> list/list.js: membership, collection and mutations
        -> viewing/viewing.js: profile-specific scan, placement and persistence
        -> grid/grid.js: cards, frame, grouping and private image diagnostics
        -> hover/hover.js: intent, delegated listeners and private timing
        -> netflix/carousel/carousel.js: native binding, observations, mapping and movement
        -> netflix/native-popup.js: private React graft, geometry, replay and preview
        -> netflix/page-dom.js / list-data.js / viewing-data.js / popup-inspection.js
     -> netflix/context.js / i18n/i18n.js / diagnostics/logger.js
```

Main passes optional Tampermonkey grants explicitly, retaining lexical bindings even when they are absent from `globalThis`. Importing application/session/feature modules creates no listener, request, menu or timer. `createApplication` exposes start/dispose/copied diagnostics. Start is idempotent; history wrappers and popstate/hashchange callbacks belong to its activation revision. Disposal retires admission, releases the current session/settings, removes its listeners and restores only history methods it still owns. Old queued navigation/native delivery cannot manage a replacement session. Retained logs and lazy page/language context have application lifetime.

Application creates a new `createMyListSession` for each target-route visit and drops its reference before retirement. A session exposes start/dispose/check/preferencesChanged/copied diagnostics, with no public source-state object or feature internals. It assembles complete public operations for initialization, fresh/mounted/native strategy selection, empty/populated source adoption, bounded blocked-source recovery, membership publication, viewing delivery, hover preparation, mismatch prompting/reinitialization and status/report composition. Initialization failure reporting shares one operation while callers retain their phase-specific stage/timeout/detail fields, recovery eligibility and deferral release. Its private parent holds only coordination facts and borrowed list/native/grid/viewing capabilities. Membership, native mapping, placement, rendering and hover algorithms stay with their feature owners; composition performs no structural card/native presentation writes or React interpretation.

Each page owns its own session scope, request registry and exact handles. Application allocates unique epoch numbers but holds no controller/timer registry. Old retirement cannot abort a newer page's requests, even under reentrant cleanup. Scope rejects stale dispatch/headers/body/publication, owns per-request timeouts, releases unread bodies and ignores obsolete deadline callbacks. Initialization running and blocked facts each have one owned record; generic blocking remains distinct from native replacement recovery. Its exact reconciliation ticket can retire separately from running work. A nullable scheduled-run record owns token, due time and timer identity, retaining earliest due-time coalescing and rejecting obsolete delivery. Session-owned pause timers are cancelled and their promises settled on retirement. Carousel owns readiness timers and confirmation frames and settles them on binding retirement; issued navigation acknowledgement/settlement retains its separate bounded lifetime. Cleanup retires list intents/tickets before native release, attempts independent DOM resources after a host failure and records bounded cleanup failures. Request/construction/recovery limits remain unchanged, including 24 items/6 ms per cooperative construction quantum and one blocked-native replacement recovery.

`settings.js` owns the unchanged storage key/default original-source visibility and userscript menu. It loads/rewrites only semantic preferences, replaces its exact menu and rejects retired callbacks. Optional grants or denied storage do not require feature DOM. A preference change reaches the current session; session requests carousel source visibility and grid status spacing through admitted public operations. During a detached-source handoff, the saved preference waits for normal source admission rather than writing through a retired presentation lease. No settings module imports a feature or edits DOM.

## Native integration

`netflix/context.js` lazily reads page/profile/language/request context. `page-dom.js` interprets native section/card/membership-click/toast identity, heading typography, row gaps and empty shell/content. Native title normalization belongs there. `card-markup.js` captures, creates and sanitizes detached card material without owning membership or displayed structure. Adapters keep DOM/endpoint/protocol assumptions local rather than exposing raw page objects as application state.

`list-data.js` owns GraphQL/page requests, cursors, headers, normalization and whole-list completeness; incomplete optional pagination never publishes a partial successful collection. `viewing-data.js` owns Falcor addresses, credential/profile request admission, interpreted movie/episode/coverage records and bounded title/season/episode responses. Raw responses/cursors/credentials stay private; no module extraction adds requests, retries or background detail work.

`netflix/carousel/carousel.js` owns native discovery and the existing filtered/coalesced mutation observer, binding generations, read-scope caches, readiness/preparation, validated count acceptance, exact-record preferred hints, expected/mounted/preferred/search resolution, page observations, native collection and mapping refresh. Private `page-model.js`, `react-readings.js`, `navigation.js`, `collection.js` and `source-presentation.js` own those algorithms. Logical/indicator modes, wrapped-tail repair, bounded React index/count reads, serialized movement/acknowledgement/hydration/restoration and motion/presentation leases retain their existing limits and behavior.

Observers, source handles, collection/mapping/preparation receipts and captured material reject obsolete route/binding/caller ownership before publication and after yields. Identity-only discovery avoids geometry/profile/card work for unchanged sources; detailed reads share one synchronous sample which ends before any await. Preferred page fallback and native fallback capture belong to carousel. Card identity is returned as copied scalar facts. Native decoration/visibility/header/parking/track markers and original inline values are leased and restored by their exact owner, including source replacement/reused elements. App holds only the releasable presentation capability.

`native-popup.js` owns grafted React references and card correlation, popup geometry methods/proxies, replay frames/promises, native enter/exit, dismissal and preview identity/transfer/return. It requests structural replacement from grid, attaches only its own interaction metadata and revalidates source/card/intent in replay. Cancellation/retirement settles old work without clearing newer methods/grafts/replays. Alignment restoration counters are native-owned copied observations rather than a mutable app counter bag. The existing presence probe remains one timer per sampled replay, 900 ms delay, 48 route replays and six candidate roots; cleanup and diagnostic failures are isolated. Netflix's native popup and scrolling experience remain the rendering path.

## Membership and viewing

`list/list.js` exposes collection/membership/mutation factories. Private collection chooses existing bootstrap/mounted/fresh/native strategies, confirms count/readiness and constructs scalar records with separate short-lived captured material. Private membership owns the authoritative frozen record array/lookup/order, expected/collected counts and revision. Accepted scalar records are frozen, including identity/display fields; borrowers cannot edit them through an otherwise read-only collection. It stages/validates acceptance, rejects retired/obsolete publication and owns native-position deviation/mismatch rules against current order. Lasting records contain no DOM or native-page hints. Caller material is transferred/released only after admitted grid acceptance; discard does not publish partial records.

Native additions stage the public list transfer before checking material availability; staged captures and exact grid-retained Undo are distinct material sources. Only an accepted insertion releases captured input fields, and rejected/stale transfers are discarded without consuming them. Private mutations owns queued click intents, retry/observer/deadline resources, exact reconciliation deferral tickets, Undo validity/correlation and its one 30-second expiry timer. Membership publication/reindex/order is guarded across native/grid callbacks. Grid retains removed markup by exact correlation; list owns when it is valid. Copied Undo work counters live with mutations. Busy initialization/recovery/responsive work defers reconciliation; final admitted release retries only current intents, while disposal drops intents and tickets. Before grid acceptance, membership is unknown for click interpretation, so explicit native removal remains meaningful; accepted absent membership still identifies native Undo. Captured correlated Undo retains its saved insertion order until native material for the restored title is mounted. No new queue, observer or scheduler is introduced.

`viewing/viewing.js` composes private scan/completion/choices/cache. Scan owns finite batching, concurrency, request budgets, exact refresh generations, repair passes, incremental publication and copied network diagnostics. Completion owns movie/episode progress and latest-episode inference. Choices/cache own profile isolation, manual precedence/coverage expiry, persistence merge and fresh-only automatic reuse. Retired/profile-changed work cannot publish or persist into a newer scan. Viewing returns semantic placement/type/loading/failure changes; it never changes membership or card DOM. Optional failures keep accepted valid results truthful and do not stop the list experience.

## Grid and hover

`grid/grid.js` owns private cards/frame/groups/styles and image diagnostics. Cards owns the current registry/handles, staged chunked publication, admitted replacement and separately retained Undo material. Grid receives captured material explicitly; it never reads or clears embedded snapshot/cardTemplate fields. The public list transfer is the sole interpreter/releaser of captured inputs, while grid can reuse only its current or exactly correlated retained rendered material. Preferred wire collection creates canonical frozen scalar records with one collection-level template/column description; it does not enrich each record with material/page fields. Complete collection returns a guarded transfer for grid publication. Native/mounted captures adapt through the same transfer builder, with exact input-ledger release only for captured material. Frame owns stylesheet/status/heading/mismatch/empty/synthetic resources, placement/geometry/spacing and exact release. Groups owns classification presentation, independent Films/Series filters, expansion, counts, controls and incremental placement/focus/scroll preservation. Grid applies membership order and insertion positions through its own registry; composition supplies records/change sets/admission, not structural DOM instructions. Reentrant retirement cannot publish a replaced registry or borrow a retiring frame. Host release failures do not split accepted frame/registry ownership.

`hover/hover.js` owns intent/attempt token, current/pending exact card, physical pointer coordinates, scroll rearming, delegated grid/route listeners, dwell and one bounded retry. It excludes controls/hidden/collapsed cards through grid operations and accepts replacement only for the exact admitted handoff. Native popup mechanics stay native-owned. Hover also owns the insertion hover observation; replay performs its existing final pointer/source/card recheck without a new preparation pass. The 120 ms dwell, 180 ms quiet/retry periods and native source-read counts remain unchanged.

Private hover timing owns counters, phase sinks and finite animation-gap windows: 12,000 route callbacks/1,800 per window, existing phase deadlines and 48 interruption logs. Exports copy summaries; captured sinks cannot write a replacement route's counters. Disposal settles retry waits and retires dwell/listener/frame owners before old delivery can restart preparation. Complete source/mismatch/material coordination is supplied by the page session, holding no hover state. Expected-page lookup, preferred refresh and bounded search share one session-local resolution attempt capturing source, native binding, membership, grid/card and hover admission. Native validity receipts stay distinct; search order/radius, page-hint repair and mismatch/prompt policies remain explicit.

## Responsive coordination and diagnostics

Responsive owns window/visual-viewport listeners, one current source ResizeObserver across populated/native-empty/provisional-empty modes, 140 ms checks, active refresh promise, signatures/counters, count-convergence suppression and the complete settled refresh/remapping transaction. Session supplies a frozen read-only parent view and guarded layout/initial-page/viewport publication callbacks. Native/grid/hover/list operations remain public collaborators. Route/source/timer/observer/transaction identities reject obsolete completion; old work cannot clear a newer promise, frame marker or ticket. Disposal releases its exact reconciliation ticket without resuming a retired source.

Duplicate/no-shape events, the narrow hidden/parked one-pixel height exception and page-count-only convergence preserve hover. Actual bounds/zoom/pixel-ratio/offset/clipping changes and stale mapping retain cancellation and refresh behavior, 80 ms settling polls/1,200 ms bound and the existing single 400 ms remapping retry. Hover waits on responsive stability then revalidates its attempt. Refresh-internal carousel operations never wait on their own transaction or start popup preparation. Mismatch reinitialization waits for stability/navigation idle before returning the native carousel to page zero.

Private grid image diagnostics owns one future-resource observer with a 4,000-entry route budget and copied scalar counters. On explicit Copy Logs it samples the current grid registry: at most 600 cards, 24 spread geometry samples and 2,000 buffered resource entries. Sampled DOM/URLs are not retained; no scroll work/request/timing-buffer mutation is added. Old failing delivery cannot stop a replacement observer. Fetch duration/zero bytes/dimension hints remain limited diagnostic evidence, not decode/paint/cache/layout-shift proof.

`diagnostics/logger.js` retains bounded application logs with safe formatting/trace gating. `report.js` assembles declared copied feature providers and clipboard/fallback export, isolating unavailable providers. Netflix popup inspection privately owns the existing finite response/component survey and serialized preview shape; it starts no extra requests/probes. Source inspection can explicitly request passive discovery. Normal interaction/report counters do not add geometry or DOM discovery.

## Verification

Generated-bundle tests execute actual offline startup, menus/localization/storage/grants, target-route entry/exit/reentry, retained Copy Logs and stale response/body rejection. Public app/settings/scope tests cover exact session/hook/menu retirement, denied storage and independent request registries. Migrated feature/native tests exercise their unchanged public capabilities and selected private policies; import/build tests reject stale artifacts, forbidden edges, dormant files and cycles.

Named suites import unmodified capabilities and selected private policies. Browser, DOM, scheduler, protocol and storage fixtures supply inputs and observe outputs; no loader reads declarations, rewrites owner source or injects mutable private inspectors. Only generated-bundle tests execute code in a VM, using the complete shipped artifact. Shared browser fixtures support both the real application and bundle; composed viewing tests connect actual viewing/data/grid/scope owners.

`tests/scenario-transfers.json` records all 372 scenarios from the final residual suite at revision 60f0df8. Of these, 105 retain their original scenario names; 267 have named owner-boundary replacements, including split coverage where a former composition fixture combined contracts. Retired private fields and helper shims are not test interfaces. Verification checks every named reference and rejects residual non-JavaScript test support or source-evaluating loaders. State/write/resource review supplements these checks: list owns frozen membership; transient captured trees remain separate; grid owns structural presentation/Undo material; viewing owns scan/persistence; native popup owns React/geometry/replay; hover owns intent; carousel owns discovery/readiness/mapping/navigation; page scope and responsive own exact requests/transactions. Borrowed facades, handles and copied summaries grant no competing mutation authority.
