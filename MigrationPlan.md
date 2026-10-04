# Migration plan

## Current understanding

This is the execution plan for the destination defined in [Migration.md](Migration.md). It divides that design's eight increments into **21 bounded steps**, normally selected through separate prompts and completed at working release checkpoints. A step may span several prompts when its ownership transfer or verification is unfinished. Migration.md remains the authority for the target layout and architectural contracts; this file owns implementation order, bounded step scope and completion evidence. Selection and progress belong only in [findings.md](findings.md).

The planning baseline is revision `087e121`, userscript **1.4.5**, and the existing `tests/performance.test.cjs` suite. The readiness check on 2026-10-02 passed JavaScript syntax validation and all **326 tests**, with no failures, cancellations or skipped cases. The development host has Node **24.13.0**. This is historical baseline evidence; use findings.md and the current checkout for subsequent readiness and progress. These results establish the baseline control flow and regression coverage, not live Netflix compatibility of future releases.

The final architecture has explicit owners for native source state, membership/order, viewing placement, rendered cards, interaction and application coordination. Existing behavior and resource bounds are preserved. The plan selects no additional feature, performance investigation, native popup bypass or storage migration.

## Boundaries

- Target Windows only for implementation, tooling and verification, as defined in Migration.md. Linux compatibility work and Linux CI runs are outside this plan.
- Implement only the step selected by the user's prompt, after its dependencies are complete. Saving this plan does not select P01 or authorize executing all steps in one run.
- Preserve the target paths and ownership contracts in Migration.md. Explain evidence-based deviations and update the affected documents before applying them. A change to the target responsibility/layout must be explicit rather than hidden in an implementation detail.
- Each extraction switches the running userscript's callers to the new owner in the same step. Do not declare completion for an unused module, copied implementation, second mutable state owner, or public export of every helper.
- Keep narrow temporary bridges inside `src/legacy.js`. They translate the remaining callers to explicit operations or read-only observations; they do not expose an entire legacy context/state bag. Document the bridge, its caller, and its removal step in findings.md.
- Imported production modules have no listener/request/startup side effects. Activation and disposal happen through their capability instances.
- Preserve request/time limits, observer filtering/coalescing, delegated listeners, chunked construction, bounded diagnostics, cache/manual-choice semantics and local card updates. Module extraction does not justify adding eager/background work.
- Keep the existing distributable filename, grants, execution environment, escaped runtime strings and installation/update behavior. Follow AGENTS.md versioning automatically whenever a distributable change will be pushed.
- Retain useful existing regression cases. Introduce new tests only for meaningful gaps in the new interface, ownership/lifetime or generated-bundle behavior; do not write one test per moved declaration.
- Live Netflix checks remain user-owned. No assistant browser inspection or authenticated Netflix request is part of these steps.

## How to use this plan across prompts

Start a step with:

> Implement step P01 from MigrationPlan.md only. Follow Migration.md, complete the step's evidence, update findings.md, and commit and push the completed change.

Replace `P01` with the desired step ID. After a completed step, this shorter prompt is sufficient:

> Continue with the next ready step from MigrationPlan.md only.

"Next ready" means the lowest-numbered unfinished step whose dependencies are complete. It selects one step, not the remainder of the plan. A status question or architectural discussion does not select another implementation step.

Where a step defines numbered checkpoints, a prompt can select one checkpoint explicitly:

> Implement checkpoint P10.4 from MigrationPlan.md only. Verify its dependencies against findings.md, complete its applicable evidence and release gate, update findings.md, and commit and push the change. Keep P10 in progress until all its checkpoints and parent acceptance conditions pass.

Checkpoint IDs refine the scope of their parent step; they do not create another architectural increment or permit dependent steps to start early. Complete them in order, and use findings.md to avoid repeating an already verified transfer. Selecting the parent step resumes its first unfinished checkpoint. A checkpoint is a stopping point for review, not a guarantee that the work fits into one prompt.

For any new prompt, read AGENTS.md, context.md, Migration.md, this plan and the migration progress section in findings.md. Inspect the current version and working tree rather than assuming the planning baseline is still HEAD. If earlier work is incomplete, finish or reconcile that selected step before proceeding to dependent work.

When resuming an existing migration, select its first unfinished step from findings.md rather than restarting P01. A released checkpoint within a step does not satisfy that step's remaining acceptance conditions. Carry those conditions into the next prompt explicitly.

### Before editing in each prompt

1. Reconcile the selected step or checkpoint with findings.md, the current revision and the working tree. Confirm its prerequisite releases and CI evidence; preserve completed work and inspect unfinished edits before choosing the remaining scope.
2. Identify the responsibility being transferred, its current and intended state/resource owner, and the live callers that will switch in this checkpoint. Use the corresponding implementation and evidence fields below. A checkpoint must leave that responsibility with one owner; splitting declarations without switching callers is not a checkpoint.
3. Trace the actual workflow through success, failure, replacement and disposal. Select existing characterization scenarios and add only the missing boundary scenarios needed to prove the transfer. Check the involved source against Migration.md rather than choosing scope from the frequency of earlier findings.
4. After P01, run `npm run check` against the starting checkout before editing or rebuilding. This read-only check establishes that the existing artifact matches its authored source. If resuming unfinished runtime edits, explain and reconcile any expected mismatch with the recorded checkpoint rather than treating a rebuilt file as evidence that the starting release was consistent.

The selected step's outcome, dependencies and completion gate determine readiness. A design discussion can refine the plan without selecting runtime work; an existing authorization recorded in findings.md continues to apply to execution prompts.

### Handoff between prompts

End each implementation prompt with a compact record in findings.md containing:

- The selected step and checkpoint revision, with complete or in-progress status.
- The state/resources transferred, their sole owner and the live callers switched to it.
- Exact remaining bridges, their callers and the step that removes each bridge.
- Verification results and hosted CI evidence, or the checks still outstanding.
- The next concrete action: resume this step's unfinished acceptance conditions, or start the next ready step after its gate passes.

The next prompt reads that record and inspects the checkout before editing. Keep progress records in findings.md; Migration.md defines the target and docs/architecture.md describes actual ownership.

### Common completion gate

Every implementation step must:

1. Identify its existing characterization cases and run the relevant behavior against the intended new boundary before extraction. Where coverage is missing, introduce a meaningful failing scenario first, then implement the smallest transfer that makes it pass. For purely documented/wiring changes, use appropriate verification rather than artificial unit tests.
2. Complete its stated live caller cutover and prove there is one owner for the transferred state/resources. Temporary callers cannot write that owner's internal state.
3. After P01, once runtime edits and any required version update are ready, run `npm run build`, `npm run check`, `npm test`, `node --check "Legacy My List for Netflix.user.js"`, and `git diff --check`. Build before the full regression run because bundle scenarios execute the generated userscript. This local sequence follows the read-only starting-checkout check above; hosted CI still checks the committed artifact before rebuilding. For documentation-only checkpoints, review document consistency and whitespace without rebuilding unchanged runtime output. Repeated broad runs need a new change/failure to justify them.
4. Review the authored-source and generated-output diffs together. Check metadata/internal/package version agreement and verify the release version exceeds the newest published version if output changed.
5. Update docs/architecture.md to describe the architecture actually present. Update findings.md with outcome, evidence, remaining bridges, retained/moved baseline scenarios and any needed user-owned live check. Do not describe later steps as implemented.
6. Commit and push according to the standing repository workflow. For runtime/build changes, confirm that the pushed revision passes the Windows CI job before starting a dependent step; record the revision and run link in findings.md. A pending or failed run does not satisfy this gate. Report the step ID, resulting behavior/ownership, version/commit, verification and any real limitation. Then stop at the checkpoint.

P01 establishes these commands. Until they exist, use the current `node --check` and `node --test tests/performance.test.cjs` checks alongside the new build verification.

### Build consistency and transitional tests

CI checks committed output before any command can overwrite it; a build must not hide a stale checked-in bundle. Build generation is a shared function used by build/check/bundle verification, with deterministic output and a userscript header first. Bundle tests execute offline startup/lifecycle paths as well as checking metadata; they do not merely test text generation.

During transition, `npm test` runs migrated suites and the residual `tests/performance.test.cjs` cases. `tests/helpers/legacy-source.cjs` may read remaining declarations from authored `src/legacy.js`; formatting in the generated bundle is not a test API. Move cases with the owner and supply migrated dependencies through explicit fixtures. Every step states which legacy responsibilities it removes; the final audit verifies equivalent coverage for the baseline scenarios, rather than relying only on the total test count.

Dependency checks apply to migrated production code from the first extraction. Any remaining legacy exception is named, scoped and tied to a removal step; an exception cannot exempt an entire feature from checks. Final strict enforcement and removal of all exceptions happen in P21.

### Verification suite handoffs

The target test files are created or deepened with the owner they exercise. This table makes the coverage destination explicit; it does not require duplicate tests or a case for every moved helper. Record each retained, transferred or deliberately replaced baseline scenario in findings.md as its step completes. Tests of a private rule supplement the workflow that calls it; they do not replace that workflow.

| Target suite | Transfer steps | Behavior exercised through the real owner |
| --- | --- | --- |
| tests/bundle.test.js | P01–P02; deepen in P20–P21 | Generated startup, route lifecycle, installation contract, deterministic output and dependency enforcement |
| tests/i18n.test.js | P03 | Locale selection, message coverage and display formatting |
| tests/diagnostics.test.js | P04 | Bounded logging, explicit export and failure-isolated native inspection |
| tests/netflix-data.test.js | P05–P07 | Page/context/markup interpretation and actual list/viewing protocol operations |
| tests/app.test.js | P08; deepen in P20 | Session/request invalidation first, then composed initialization, recovery and disposal |
| tests/carousel.test.js | P08–P10 | Binding replacement, shared reads, readiness, page mapping, serialized movement and native collection |
| tests/grid.test.js | P03 resource checks; deepen in P11–P12 | Frame/card lifetime, complete replacement, groups, controls, filters and focus |
| tests/list.test.js | P13–P14 | Collection strategy, validated membership/order, pending changes, deferral and Undo |
| tests/viewing.test.js | P15–P16 | Completion/cache use, bounded scan, partial results, repairs and incremental publication |
| tests/viewing-choices.test.js | P15 | Profile-scoped manual placement, persistence, precedence and coverage expiry |
| tests/hover.test.js | P17–P18 | Native interaction/card handoff first, then composed intent, cancellation, replay and dismissal |
| tests/responsive.test.js | P19 | Coalesced refresh, native/grid publication, deferred membership and stale-owner rejection |

Timing/image instrumentation checks move with P18/P19 into the suite for the workflow that owns their lifetime. Diagnostic export checks remain in diagnostics.test.js and consume those owners' summaries. Shared helpers model DOM, scheduling and response fixtures; they must not reimplement the production decisions under test.

## Changes

### Overview

| Step | Completion checkpoint | Architectural increment |
| --- | --- | --- |
| P01 | Reproducible userscript build and transitional test entry | 1. Establish the build |
| P02 | CI and generated-output/dependency checks | 1. Establish the build |
| P03 | Localization, DOM names and styling extracted | 2. Extract resources and logging |
| P04 | Logging, reporting and bounded popup inspection extracted | 2. Extract resources and logging |
| P05 | Page context, DOM interpretation and card markup adapters | 3. Establish Netflix boundaries |
| P06 | My List data adapter | 3. Establish Netflix boundaries |
| P07 | Viewing data adapter | 3. Establish Netflix boundaries |
| P08 | Session scopes and native binding/page-model ownership | 4. Own the native carousel |
| P09 | Native navigation, queue and restoration ownership | 4. Own the native carousel |
| P10 | Native collection and complete carousel facade | 4. Own the native carousel |
| P11 | Grid frame, card registry and card-resource ownership | 5. Separate membership and presentation |
| P12 | Group/filter/control presentation ownership | 5. Separate membership and presentation |
| P13 | Membership records, order and collection strategy ownership | 5. Separate membership and presentation |
| P14 | Mutation queues, deferral tickets and Undo ownership | 5. Separate membership and presentation |
| P15 | Viewing rules, manual choices and cache | 6. Separate viewing and presentation |
| P16 | Viewing scan and complete viewing facade | 6. Separate viewing and presentation |
| P17 | Complete native-popup integration | 7. Own interaction and responsive workflows |
| P18 | Hover intent, cancellation and timing ownership | 7. Own interaction and responsive workflows |
| P19 | Responsive transactions and image instrumentation | 7. Own interaction and responsive workflows |
| P20 | Application/session composition and settings | 8. Finish composition |
| P21 | Remove legacy support and audit the final architecture | 8. Finish composition |

Execution is sequential by default. Each step depends on its immediate predecessor, plus the specific interfaces listed below. This order keeps one owner transfer reviewable at a time; it is not a recommendation to parallelize overlapping state changes.

### Architectural handoff checks

These checks are part of the named step's evidence, not additional implementation steps. Review the composed paths before starting the next architectural increment; individual helper tests and the import graph cannot establish these contracts alone.

| Checkpoint | Required handoff evidence |
| --- | --- |
| P07 → P08 | Data callers use normalized results; request validity and timeout/job cancellation have declared owners before scope mechanics move |
| P10 → P11 | The carousel owns discovery, binding, mapping, movement and traversal; remaining callers cannot write them, and source replacement invalidates borrowed handles |
| P14 → P15 | List records contain no lasting DOM or placement state; grid owns active/retained card material, while list alone decides Undo validity and releases its deferral tickets |
| P16 → P17 | Viewing owns scan/policy/persistence and publishes small semantic changes; membership and rendered presentation remain with their respective owners |
| P19 → P20 | A real grid/native/hover replacement preserves only its admitted attempt; obsolete cleanup cannot affect new owners, and responsive work cannot wait on itself |
| P21 final audit | Every target file has a live responsibility, baseline scenarios have recorded coverage destinations, and no legacy state owner, bridge, loader or import exception remains |

If a handoff fails, keep the affected step incomplete and resolve the boundary in that step. If the evidence requires a different responsibility or target path, revise Migration.md and this plan before applying that design change. Do not carry an unrecorded workaround into the next owner transfer.

### P01 — Establish a reproducible build

- **Outcome:** The same distribution path is generated from authored source through one build entry. Release metadata/version are defined once, and the existing runtime still executes exactly once in its raw page environment.
- **Test First:** Preserve the baseline suite. Introduce bundle scenarios for valid header/grants/version, one startup, target-route entry/exit, missing browser/GM assumptions handled as currently expected, and stale response rejection. Verify a deliberately stale generated artifact is rejected rather than repaired silently.
- **Implementation:** Create package.json/package-lock.json, userscript.meta.json, scripts/build.mjs, a minimal scripts/check.mjs, src/main.js, temporary src/legacy.js and tests/helpers/legacy-source.cjs, and tests/bundle.test.js with its offline DOM/timer helpers. Add the node_modules ignore rule alongside dependency installation. Move the existing executable body into an explicitly started legacy entry; adapt extraction tests before bundler formatting changes. Pin the tested Node runtime/build dependency, preserve execution settings, and make generation reusable. Add README.md and docs/architecture.md describing this actual transitional state.
- **Evidence:** Existing baseline scenarios and bundle scenarios pass; generated startup runs once; two builds match byte-for-byte; altered metadata/output causes check to fail; the patch release has matching versions and the same distribution path. Complete the common gate.
- **Dependencies:** Current baseline and Migration.md; no earlier implementation step.
- **Depth:** New build boundary hides metadata, wrapping, version injection and deterministic generation. Main is an entry point; legacy is temporary, with no second runtime implementation.

### P02 — Establish CI and boundary verification

- **Outcome:** A clean Windows checkout can verify the committed release and migrated dependencies automatically, and cannot pass by rebuilding over stale output.
- **Test First:** Exercise check.mjs with stale source/output, mismatched version/grants, a forbidden production import and a cyclic feature dependency. Reuse P01 generation tests; avoid duplicating its implementation.
- **Implementation:** Deepen scripts/check.mjs using the build's dependency metadata, create .github/workflows/check.yml, extend .gitignore for any temporary tooling output, and document npm commands. CI runs one windows-latest job with the declared Node runtime and npm ci, checks committed output before write-producing builds, runs tests/syntax/whitespace checks, and verifies no tracked generated change is left behind. Start a narrowly scoped legacy-exception ledger in findings.md.
- **Evidence:** The normal clean-checkout command sequence passes; the negative verification scenarios fail for the stated reasons; only explicitly scoped legacy edges are exempt. CI configuration matches the locally verified commands. Complete the common gate; change version only if the output actually changes.
- **Dependencies:** P01's generation, commands and bundle suite.
- **Depth:** Deepen the existing check boundary; CI orchestrates that boundary rather than reimplementing it.

### P03 — Extract localization, DOM names and styling

- **Outcome:** Locale/message formatting, script-owned DOM hooks and the stylesheet have their final locations and remain independent of feature state.
- **Test First:** Retarget current locale coverage/fallback/plural/formatting scenarios. Verify the existing selector-driven style behavior, idempotent style installation and removal. Check that imported resource modules alone start no listeners/work.
- **Implementation:** Create src/dom-names.js, i18n/i18n.js, ui-messages.js, log-messages.js and grid/styles.js. Replace live legacy definitions/callers with these modules; pass a narrow locale reader until context is moved in P05. Keep stylesheet installation with its present lifecycle until frame ownership transfers in P11. Move relevant cases to tests/i18n.test.js and resource checks in the bundle/grid suites.
- **Evidence:** All supported locale keys and existing fallback/diagnostic-language rules are retained; functional detection remains independent of localized text; style hooks and escaped strings are unchanged. The residual file has no duplicate resource definitions. Complete the common gate.
- **Dependencies:** P02; P01's explicit startup and legacy test loader.
- **Depth:** New localization capability hides selection/formatting; DOM names and styles are shared resources with a precise contract, not general utility directories.

### P04 — Extract logging, report assembly and bounded popup inspection

- **Outcome:** Log retention/export has one owner, and existing read-only response/component inspection has a distinct bounded native-integration owner.
- **Test First:** Retarget ring-buffer ordering/cap, disabled-trace payload avoidance, clipboard behavior, response survey bounds and private-probe getter/source/value safeguards. Include the existing throwing-probe scenario that cannot reject an admitted interaction.
- **Implementation:** Create diagnostics/logger.js, report.js and netflix/popup-inspection.js. Wire the live runtime to them, giving report explicit serialized snapshot providers and inspection narrow current-owner checks. Remaining feature counters/samplers stay with legacy until their owners move; report does not import legacy state. Move applicable cases to tests/diagnostics.test.js.
- **Evidence:** Buffer/export ordering and current copied-detail policy are preserved; probe limits and failure isolation pass; neither report nor probes initiate runtime feature recovery or extra requests. The residual source supplies summaries/callbacks without exposing its state bag. Complete the common gate.
- **Dependencies:** P03 localization/resources and P02 dependency checks.
- **Depth:** Logger hides bounded retention/formatting, report hides one export operation, and popup inspection hides safe protocol/component introspection. Sampler state is not moved into a central catch-all diagnostics store.

### P05 — Extract context, page-DOM interpretation and card markup

- **Outcome:** Netflix page/profile/locale facts, source discovery/action interpretation and card markup assumptions are behind the named adapters.
- **Test First:** Retarget section/empty discovery, tracking/identity decoding, profile identity and markup construction/sanitization cases. Verify unknown fields and replaced/disconnected elements retain current failure/fallback behavior; a cloned tree does not inherit ready React interaction state.
- **Implementation:** Create netflix/context.js, page-dom.js and card-markup.js. Adapt remaining consumers to interpreted facts and markup operations; no adapter imports feature state. Context reads active profile correctly. Borrowed markup/material remains with its current owner until P11, and remaining observers remain with their current lifecycle owner until P08/P14. Move adapter cases into tests/netflix-data.test.js and reusable fixtures/helpers as needed.
- **Evidence:** Discovery/identity variants and profile guards pass; card capture/create/sanitize has no global registry or duplicate retained trees; migrated UI/collection code no longer defines its own Netflix selectors/identity parsing. Complete the common gate.
- **Dependencies:** P04 and P03 DOM names; final lifecycle ownership remains scheduled in later steps.
- **Depth:** New integration boundaries hide Netflix interpretation and card construction while retaining whole native assumptions together.

### P06 — Extract My List data access

- **Outcome:** The existing GraphQL/page-bootstrap data paths return validated list data through netflix/list-data.js.
- **Test First:** Retarget actual fetch/body parsing, pagination/count/cursor limits, initial/later-entry freshness, existing page fallback, cancellation and single-response survey integration cases. Verify missing/malformed data does not publish a successful incomplete list.
- **Implementation:** Move request construction, same-origin/response interpretation and existing bootstrap fallbacks to list-data.js. Use current owner/signal collaborators and popup inspection from P04. Adapt legacy collection to normalized records/count/provenance and transfer card material separately; leave strategy selection with legacy until P13 and native traversal until P10.
- **Evidence:** Existing request counts/fallback triggers/freshness rules and stale-response rejection are preserved; survey observes the actual response without another request; credentials/raw wire parsing do not leak to collection policy. Complete the common gate.
- **Dependencies:** P05 context/markup and P04 inspection.
- **Depth:** New data adapter owns the complete wire boundary; it does not own authoritative membership state or strategy policy.

### P07 — Extract viewing data access

- **Outcome:** Netflix viewing protocol interpretation becomes bounded batch operations returning normalized progress and series coverage.
- **Test First:** Retarget structured/string endpoint validation, Falcor atoms/references, malformed/cyclic metadata, request/body profile cancellation, actual request accounting and terminal-failure wave behavior. Check normalization preserves absent versus contradictory progress/count information.
- **Implementation:** Create netflix/viewing-data.js, owning transient credentials, request encoding, body parsing and typed title/season/episode/direct-repair batch operations. Adapt the still-legacy scan/policies to normalized outputs without changing wave width, quotas, repair ordering or completion logic. Use fixtures in netflix-data.test.js; keep policy cases in their current suite until P15/P16.
- **Evidence:** Each dispatched batch is charged once to the existing budget; unsafe endpoints are never fetched; stale profile/body results are discarded; valid peers in an allocated wave retain the baseline partial-result behavior. No raw paths/graphs or auth material remain policy inputs. Complete the common gate.
- **Dependencies:** P06 and P05 context/current-owner collaborators.
- **Depth:** New adapter hides the viewing wire protocol, not scan scheduling or completion policy.

### P08 — Transfer session scopes, native binding and page model

- **Outcome:** Session/request validity and the current native binding/logical page model have explicit owners instead of writable fields shared through sourceState.
- **Test First:** Retarget route cancellation, post-await/post-body guards, binding replacement, shared native read scopes, logical-index/wrapped-tail and source-readiness cases. Verify an old binding handle is rejected after replacement even when the title ID matches.
- **Implementation:** Create app/session-scope.js and netflix/carousel/carousel.js plus page-model.js. Residual route orchestration creates/disposes scopes through the new module; it does not maintain a competing cancellation owner. Transfer native discovery observer and binding/model state. Existing native navigation/collection still in legacy can borrow precisely declared observations/references through bridges removed by P09/P10; ordinary policy code cannot mutate binding/model internals.
- **Evidence:** Binding/model/scoped request ownership has one writer; old handles and obsolete polls cannot publish; readiness preserves empty versus missing positive-count source distinctions; shared-read invalidation cases pass. Record the exact remaining navigation/collection bridge calls. Complete the common gate.
- **Dependencies:** P07, P05 discovery/context and P06/P07 request collaborators.
- **Depth:** Deep native-source facade hides discovery/readiness, validated layout/indices and source lifetime. Session scope owns cancellation mechanics and is injected into native code without a Netflix-to-app import.

### P09 — Transfer serialized native navigation and restoration

- **Outcome:** One carousel navigation owner contains the movement queue, acknowledgement waits, temporary styles and page restoration.
- **Test First:** Retarget queued/superseded moves, logical/indicator acknowledgement, pointer-versus-route cancellation, settlement, style restoration and fast-restore repair cases. Inject failure after a native click and verify that old cleanup cannot overwrite a newer owner, including when operations share the same connected native elements. Exercise shared animation suppression during collection/refresh and replacement while a move is queued or an acknowledgement callback is pending.
- **Implementation:** Create netflix/carousel/navigation.js under the existing carousel facade. Move all native movement/restore algorithms and their owned temporary resources. Replace legacy click/transform/queue writes with declared facade operations, including calls from native collection and responsive/hover preparation. Collection and responsive callers borrow idempotently releasable motion-suppression leases; they no longer capture/restore navigation styles or register a competing cleanup owner. Capture binding ownership before queueing and revalidate it after waits and in observer callbacks. Navigation reports timings through narrow callbacks; hover timing state remains with its current owner until P18 rather than sharing writable counters. Keep current concurrency/ordering; do not add a universal queue for unrelated work.
- **Evidence:** No movement queue/style-cleanup owner or direct temporary navigation-style writes remain in legacy, including collection/refresh callers; baseline click/acknowledgement/settlement counts and cancellation paths pass; restore failure always releases its own resources. Obsolete callbacks and lease release cannot acknowledge into or restore over a replacement operation. Remove P08 navigation bridges/exceptions. Complete the common gate.
- **Dependencies:** P08 source/model/scope ownership.
- **Depth:** Deepen the carousel through private navigation; callers request native operations without coordinating animation properties or polling details.

### P10 — Transfer native traversal collection and complete the carousel facade

- **Outcome:** Existing native collection/readiness/source resolution/remapping paths use the single carousel capability.
- **Test First:** Retarget logical/indicator collection, exact count/order validation, mounted fast bootstrap, incomplete page recovery, page-zero anchoring, overlapping tails, source recycling and bounded reinitialization evidence. Verify cancellation returns no successful partial collection.
- **Implementation:** Create netflix/carousel/collection.js and complete carousel.js's collect/resolveCard/refreshMapping operations. Move native source resolution/recovery helpers that still inspect mounted state. Private react-readings.js contains bounded React index/count and signature interpretation so supplementary characterization uses the actual private policy without retaining raw public exports. Carousel retains their cache and admission; no capability or resource is added. Residual strategy/hover/resize callers use public operations and read-only validated handles; list order decisions stay outside carousel.
- **Evidence:** Both native modes and existing fast/fallback routes pass; source generations govern the results; no legacy traversal or native-binding/model writes remain. Remove all P08 collection/source-read exceptions. Complete the common gate.
- **Dependencies:** P09 navigation, P08 model/scopes and P05/P06 metadata/capture.
- **Depth:** Complete the source capability around readiness, navigation, traversal and source-card resolution; strategy selection remains a distinct list responsibility.

#### P10 prompt checkpoints

P10 combines several different native workflows. Split it at complete ownership transfers rather than at function or file boundaries. Every checkpoint inherits P10's scope, depth and common completion gate; P10.1 requires P09, and each later checkpoint requires the preceding checkpoint's verified release. All use the existing target files under src/netflix/carousel/ and their real callers. No additional public capability or folder is introduced.

| Checkpoint | Bounded implementation and observable outcome | Test first and completion evidence |
| --- | --- | --- |
| P10.1 — Native traversal | Create private collection.js and switch logical/indicator traversal to carousel.collect. Transfer stabilization, completeness checks, unpublished material and collection diagnostics; navigation retains movement/restoration. | Exercise both modes, overlap/tails, incomplete pages, cancellation and restoration through the real carousel. No legacy traversal algorithm, duplicate counter owner or successful cancelled partial collection remains. |
| P10.2 — Mounted qualification and anchoring | Transfer single-page qualification/proof/capture to collection.js and fresh page-zero anchoring to carousel. Entry freshness and strategy admission stay outside native integration. | Exercise repeated mounted samples, copied/stale proof rejection, source replacement and indicator anchoring/adjacent recovery. Qualification adds no request, navigation or eager capture; failure retains the existing fresh-data fallback. |
| P10.3 — Expected-card resolution | Move expected-page navigation, viewport matching and required-title hydration behind resolveCard. Return validated source handles or copied native mismatch facts; keep authoritative order comparisons outside carousel. | Exercise found, incomplete and wrong windows, href fallback, recycled cards, mapping/binding/route replacement and queued movement. Handles cannot be forged or adopted by obsolete work; matching a title alone cannot rescue a stale handle. |
| P10.4 — Mounted lookup and polling | Move synchronous mounted-card lookup and its bounded wait behind the same source owner. Keep pre-call binding admission with composition; an admitted lookup cannot silently adopt a replacement source. | Exercise immediate and late mounting, active-page selection, hover/route cancellation and replacement during the wait through carousel and the live bridge. Preserve shared-read costs and existing timer bounds; cleanup closes only the admitted operation's resources. |
| P10.5 — Preferred-page recovery and bounded search | Transfer the existing preferred-page pulse and nearby-page search to carousel. Carousel registers native mapping observations and returns validated handles/visible facts; the temporary caller publishes any remaining membership/card page hints until P13/P17. | Exercise preferred hit, pulse success/failure, ordered bounded-radius search, hydration fallback, cancellation during queued movement and source replacement. Preserve movement/wait bounds; native integration cannot mutate membership records, clone attributes or authoritative order. |
| P10.6 — Native remapping | Implement refreshMapping around delta anchoring and responsive native reconstruction, count convergence, wrapped-tail validation and private mapping commit. Return interpreted observations to existing coordinators; responsive scheduling remains for P19. | Exercise unchanged/changed layout, incomplete convergence, wrapped tails, membership deltas and obsolete remapping during waits. A mapping commit validates its captured owners; old work cannot commit into a replacement, and membership order remains an external decision. |
| P10.7 — Facade and caller audit | Replace remaining technical native read/model-command bridges with semantic operations or validated observations used by the actual strategy, preparation and responsive callers. Remove the obsolete P08/P09 source exceptions and audit all remaining native write sites. | Exercise the composed collection, preparation and remapping paths after bridge removal. Verify one binding/model/navigation/collection owner, handle invalidation and equivalent retained scenario coverage; run the full common gate. P10 is complete only when its parent evidence and the P10-to-P11 handoff also pass. |

These checkpoints specify the destination of each remaining workflow, not its current status. Private source-presentation.js deepens carousel's native marker/visibility/restoration ownership during P10.7, including guarded mount leases and historical native artifact cleanup; grid/UI and popup alignment remain with their planned owners. Record selections, completed releases and exact remaining callers only in findings.md. A remaining composition import can stay until P20 when it only constructs/injects the carousel; it cannot justify keeping native algorithms or writable model access in legacy.

### P11 — Transfer grid frame, card registry and resources

- **Outcome:** Frame/card DOM and retained markup are owned by grid, with validated card handles and one structural replacement operation.
- **Test First:** Retarget chunked construction, stale build discard, clone registry/replacement, startup snapshot release, shared-template reuse, owned UI cleanup and empty-source transitions. Verify retired/replaced handles reject stale preparation/controls while an explicitly admitted same-attempt replacement can hand off to its new handle.
- **Implementation:** Create grid/grid.js, cards.js and frame.js. Transfer grid/card maps and structural operations from legacy. Use native mount/layout observations and card-markup construction. Expose narrow retirement/replacement callbacks to the still-legacy native hover owner until P17. Remaining group presentation uses grid-owned structural methods until P12; remaining Undo supplies validity/expiry until P14.
- **Evidence:** Grid is the only structural/registry writer; no full detached copy remains per published title; retained removed markup is distinct from active cards; stale builds/handles and native/synthetic empty transitions pass. Complete the common gate.
- **Dependencies:** P10 native facade and P03/P05 resources/markup.
- **Depth:** New rendering capability hides DOM/resource lifetime. Its internal cards/frame files own substantial registry and presentation work, rather than returning DOM mutation instructions to list code.

### P12 — Transfer group, filter and placement-control presentation

- **Outcome:** Grid owns section/filter/expansion state, counts, controls and local regrouping; it consumes interpreted placement/type facts.
- **Test First:** Retarget independent filters/defaults, unknown types, count/order updates, collapsed groups, manual marker/action controls, no-op synchronization, local update work and scroll/focus preservation. Include replacement presentation before a new hover can start.
- **Implementation:** Create grid/groups.js, routing current grouping/control DOM through grid. Replace legacy rendering portions of syncWatchGroups/manual controls with presentation operations and semantic action callbacks. The still-legacy viewing logic provides per-title facts and executes placement commands until P15/P16; it receives no writable grid/filter object.
- **Evidence:** Grid owns all group/filter/control DOM and selections; legacy completion/choice code has no direct card presentation writes; one-title updates and stationary-hover preservation keep their current bounds. Remove P11 grouping bridges. Complete the common gate.
- **Dependencies:** P11 cards/frame and P07 normalized type/status data.
- **Depth:** Deepen grid with complete grouped presentation, while keeping placement decisions out of it.

### P13 — Transfer membership records, order and collection strategy

- **Outcome:** List becomes the sole membership/order owner, chooses existing sources and publishes validated data/material to grid.
- **Test First:** Retarget authoritative count/order, GraphQL/native/mounted strategy selection, partial-source rejection, initial-versus-SPA freshness, visible native-order reconciliation and removal/readdition identity cases. Ensure readiness/data overlap and chunked publication remain unchanged.
- **Implementation:** Create list/list.js and collection.js. Move record/item-map/order/count state and strategy decisions out of legacy initialization. Use public data/carousel results and transfer card material once to grid. Adapt remaining viewing/hover/mutation callers to read-only records/lookups and list changes; native mapping is not stored as a writable item.page field. Mutation algorithms remain in the residual file until P14 but update membership only through list's controlled operations.
- **Evidence:** Lasting membership records contain no DOM/fiber/placement state; strategy choice/count validation and native-order reconciliation pass; grid owns accepted material and cancelled collectors release unaccepted material. Record the remaining mutation bridge. Complete the common gate.
- **Dependencies:** P12 publication/presentation, P06 list data and P10 native collection.
- **Depth:** New list capability hides strategy, completeness and order. It exposes meaningful membership views/changes instead of its mutable arrays/maps.

### P14 — Transfer mutation queues, reconciliation deferral and Undo

- **Outcome:** List owns all pending membership actions and Undo validity, with safe owner-specific deferral tickets during initialization/recovery/refresh.
- **Test First:** Retarget add/remove busy deferral, convergence/retry/timeout, external controls, Undo expiry, last-item transitions and source recovery. Verify old release/cleanup cannot drain a newer transaction and that an expired correlation ID cannot borrow another removal's tree.
- **Implementation:** Create list/mutations.js; move click/convergence observers, queue timers and Undo bookkeeping. List consumes page-DOM intents and native observations and publishes semantic changes. Grid retains/removes markup by Undo correlation ID. Residual initialization/resize orchestration uses list.deferReconciliation tickets until P19/P20; no duplicate expiry timer or busy boolean authority is introduced.
- **Evidence:** One queue/expiry owner; successful remove/add/Undo changes retain order/group/filter presentation and failure truthfulness; deferral releases only its own ticket and obsolete sessions drop old intents. Remove P13 mutation and P11 Undo bridges. Complete the common gate.
- **Dependencies:** P13 records/order, P11 card-resource ownership and P08 scopes.
- **Depth:** Complete list's asynchronous membership capability, hiding convergence, retries, deferral and Undo beneath small commands/publications.

### P15 — Transfer viewing rules, saved choices and automatic cache

- **Outcome:** Completion/placement decisions and profile-scoped persistence have their final owners without DOM or raw protocol dependencies.
- **Test First:** Retarget progress/credits/latest-episode inference, contradictory coverage, manual precedence/expiry, concurrent-tab writes, storage failures, cache age/schema/membership validation and profile switches. Verify unknown completion never becomes a false caught-up result.
- **Implementation:** Create viewing/completion.js, choices.js and cache.js behind the initial viewing/viewing.js facade. Legacy scan supplies normalized data from P07 and calls the facade for policy/persistence instead of maintaining competing maps/choice storage. Grid's semantic placement action calls viewing.place; legacy scan delivery bridges remain until P16. Keep existing storage keys/schema and current cache/choice failure semantics.
- **Evidence:** Existing completion, cache and manual-choice cases pass through real policy/persistence use; profile/auth separation is retained; grid does no saving/classification. No duplicate choice/cache state or raw Falcor-dependent rule remains. Complete the common gate.
- **Dependencies:** P14 membership validity, P12 actions/presentation and P07 data interpretation.
- **Depth:** Viewing's private policy/choice/cache modules each hide meaningful rules and lifecycle distinctions under one public placement capability.

### P16 — Transfer viewing scan and complete its facade

- **Outcome:** Viewing owns the full bounded scan, incremental publications, refresh ownership, partial failures and repairs.
- **Test First:** Retarget request/time/episode limits, title-order priority, overlapping batch waves, continuation passes, direct repair, refresh sharing, stale route/profile/grid rejection and cached/fresh partial-result behavior. Confirm ordinary grid publication does not wait for optional viewing collection.
- **Implementation:** Create viewing/scan.js and complete viewing.js. Move scan jobs/controllers/results and diagnostic summaries from legacy. Publish changed IDs/current placement/type through session callbacks to grid; accept read-only current membership and scope collaborators. Remove residual scan/policy state access, duplicate job guards and raw job fields supplied to grid.
- **Evidence:** Existing bounded request totals/order, cancellation and incremental classification scenarios pass; scan/cache/manual precedence has one owner; viewing starts no periodic browsing work and performs no DOM writes. Remove P15 scan bridges. Complete the common gate.
- **Dependencies:** P15 policy/persistence, P07 one-request batch operations, P13 membership and P12 presentation.
- **Depth:** Complete viewing as a coherent asynchronous capability; scheduling, publication and persistence remain hidden from callers.

### P17 — Transfer native popup binding and interaction ownership

- **Outcome:** The complete Netflix-owned interaction, React graft tracking, geometry restoration, replay and preview transfer live in netflix/native-popup.js.
- **Test First:** Retarget actual native replay, source/card identity, recycled source rejection, target-only replacement, gutter/clipping alignment, native preview handoff/dismissal and failure-isolated diagnostics. Exercise grid/native/hover composition so intentional replacement preserves its admitted attempt and still replays, while obsolete attempts cannot adopt a new card. Verify old cleanup cannot restore/delete newer geometry or graft state.
- **Implementation:** Create native-popup.js, consuming carousel source handles and an injected grid replacement/retirement operation. Move binding/proxy/replay/preview algorithms and delayed probe resources as one interaction owner. Residual hover intent supplies attempt validity and calls open/release until P18. Grid structural changes never occur directly inside the adapter.
- **Evidence:** Native popup behavior and all lease/retirement cases pass; one graft/geometry/preview owner; source and card handles are revalidated before replay; no sibling hydration or whole-grid pass is added. Remove P11 native-retirement bridges. Complete the common gate.
- **Dependencies:** P16, P10 source handles, P11/P12 replacement presentation and P04 inspection.
- **Depth:** New native interaction adapter hides substantial private React/lifecycle complexity behind complete open/release operations.

### P18 — Transfer hover intent, cancellation and timing

- **Outcome:** Hover owns delegated intent/scroll/pointer policy, active/pending attempts and bounded timing instrumentation.
- **Test First:** Retarget dwell/reuse, scroll rearming, stationary versus physical movement, superseding, controls/hidden-group exclusion, stale-frame/cleanup, cancellation destinations and bounded diagnostic window cases. Verify matching title IDs cannot rescue retired card/source handles.
- **Implementation:** Create hover/hover.js and timing.js. Move policy state/listeners and timing owner. Use narrow current-grid/card and native interaction collaborators; a responsive-stability collaborator remains supplied by residual orchestration until P19/P20. Remove hoverToken/pointer/attempt state from legacy rather than keeping a mirror.
- **Evidence:** One intent/listener owner; obsolete attempts stop at existing checkpoints; bounded sampling/log costs remain unchanged; scroll/leave never starts new preparation implicitly. Remove P17 intent bridges. Complete the common gate.
- **Dependencies:** P17 native interaction, P11/P12 card validity/presentation and P08 scopes.
- **Depth:** New hover capability separates script interaction policy from native implementation without exposing individual polling/replay stages to callers.

### P19 — Transfer responsive coordination and image instrumentation

- **Outcome:** Responsive transaction scheduling and the existing bounded grid/image measurements have their final lifetimes and collaborators.
- **Test First:** Retarget duplicate viewport coalescing, parked-height exceptions, real resize/zoom/clipping, wrapped-tail remapping, count convergence, obsolete refresh/source ownership, busy membership retries and thumbnail/resource sampling bounds/failure isolation. Verify hover-facing resolution waits/revalidates while refresh-internal native operations cannot wait on their own transaction.
- **Implementation:** Create app/responsive.js and grid/image-diagnostics.js. Move resize listeners/observer, scheduled refresh owner and cross-feature transaction; call public carousel/grid/hover operations and P14 deferral tickets. Transfer image samplers to grid-owned providers and report snapshots. Wrap only hover-facing resolution with whenStable through composition; refresh-internal calls use carousel directly, without native-to-app imports.
- **Evidence:** One resize/refresh and image-observer owner; current no-op/real-change distinctions and counts pass; old refreshes cannot clear new state/tickets; image work remains bounded/on-demand as before. Remove P18 stability and all remaining sampler bridges. Complete the common gate.
- **Dependencies:** P18 hover ownership, P14 tickets, P10 remapping and P11 grid.
- **Depth:** New responsive capability owns the complete cross-feature refresh transaction; feature instrumentation owns measurements rather than a central runtime scheduler.

### P20 — Transfer application/session composition and settings

- **Outcome:** main.js starts app/application.js; page sessions assemble and dispose the completed capabilities, and settings reports semantic preferences.
- **Test First:** Retarget full startup, target-route entry/exit/reentry, missing/late/replaced native sources, blocked initialization recovery, pending actions, profile changes, optional viewing failure and repeated disposal. Include original-source visibility/spacing/menu behavior and zero import-time side effects.
- **Implementation:** Create app/application.js, my-list-session.js and settings.js, deepening the existing session-scope/responsive modules. Move residual navigation, initialization/recovery orchestration and preference/menu storage. Wire feature callbacks directly; source preference changes call native/grid operations. Switch main from the legacy entry to application.start. Remove any remaining feature state or algorithms from application orchestration.
- **Evidence:** Generated-bundle integration and full lifecycle cases pass; application/session owns only composition/lifetime/transactions; settings edits no feature DOM; runtime dependency metadata no longer includes src/legacy.js. Record any test-only residual support for P21. Complete the common gate.
- **Dependencies:** P19 and all preceding feature/adapter cutovers.
- **Depth:** Complete application composition and lifecycle through a small facade; coordination does not inherit native algorithms, classification or rendering internals.

### P21 — Remove transition support and verify the destination

- **Outcome:** The repository matches Migration.md's final tree and contracts, with no legacy runtime/test dependency, bridge or broad import exception.
- **Test First:** Make final checks fail on any production legacy import, leftover temporary file/import exception, forbidden dependency or missing bundle lifecycle coverage. Exercise owner-boundary scenarios for writable-state leakage and audit cross-owner write sites explicitly; the import graph alone cannot prove state ownership. Review the recorded baseline scenario transfers before deleting the old suite.
- **Implementation:** Remove src/legacy.js, tests/helpers/legacy-source.cjs and residual tests/performance.test.cjs after their useful scenarios have equivalent coverage in the named suites. Enable the full dependency rules; finish actual architecture/README documentation. Audit all target source/test/tooling files, state/resource owners and complete success/failure/disposal paths. Do not add speculative abstraction to make the file count match.
- **Evidence:** Clean-checkout CI commands and all migrated/bundle suites pass; generated output is current and self-contained; no temporary bridge/import exception remains; all planned files have live coherent use and preserved baseline scenario coverage. Update findings.md with the final acceptance audit and remaining real Netflix verification limits. Complete the common gate.
- **Dependencies:** P20 and the evidence recorded for P01–P20.
- **Depth:** Final audit deepens existing verification/documentation only. Any newly discovered missing owner is an explicit design deviation to resolve, not an excuse to mark cleanup complete.

## Checkpoint and recovery rules

One completed step normally produces one reviewed commit and, if the distributable changes, one patch release. Do not hard-code future release numbers; inspect the latest published version each time. A later prompt can revise ordering or scope, but it does not erase earlier evidence or silently select unrelated work.

A step may require more than one prompt. If an interruption leaves work incomplete, record the transferred ownership, remaining caller cutovers, unresolved checks and exact next action in findings.md. Keep the step in progress. A separately releasable partial checkpoint must pass the same applicable verification/release gates and must not leave two owners for the responsibility it transfers; the next prompt resumes the same step until its full acceptance conditions pass.

Before resuming an unfinished step, inspect both tracked edits and new files and reconcile them with its recorded checkpoint. Before committing, review the staged paths and diff so a documentation-only change or another selected step cannot accidentally publish unfinished runtime work.

If a step uncovers a missing contract, first determine whether it can be resolved within the selected outcome and existing architectural boundary. Document the routine detail and continue when it can. A material ownership/layout/behavior change must be explained and reflected in Migration.md and this plan; ask the user only when a real unresolved choice affects that boundary.

If meaningful checks fail, the selected step remains incomplete in findings.md. Fix it before starting another step. Do not push a known-broken intermediate release. If a published step needs restoration, revert through the normal reviewed workflow and publish a version greater than the latest release rather than reusing/decreasing its version.

User-owned live checks are recommended at capability cutovers, especially collection/navigation, membership/Undo, viewing/grouping, hover and responsive/session behavior. Record any supplied result and unresolved failure precisely. Deterministic evidence permits the next prompt, but it is not a claim that the entire migration's live compatibility has already been proved.
