# Capability coverage audit before simplification

Audit date: 2026-10-08. Baseline: `220e175`, userscript **1.4.58**. Working branch: `codex/essential-code` in a separate managed worktree.

## Decision

The existing tests protect substantial behavior, but are **not yet a sufficient acceptance contract for broad code reduction**. All 494 offline tests pass. That establishes a working baseline, not complete capability coverage. Complete the missing application-composition scenarios below before simplifying their runtime paths. Unexecuted lines are investigation targets, not permission to delete behavior.

The essential goal is to present the complete current Netflix My List in a scrollable grid, retaining Netflix's native interactions, correct membership/order, viewing groups and reversible profile-specific choices. Essential guards include complete collection before publication, truthful unknown/failure states, exact session/profile/source/card ownership, bounded requests/retries/construction/diagnostics, restoration of native resources, and stale-work rejection. Passing tests must remain subordinate to these observable contracts and the durable preferences in context.md.

Scope of this checkpoint: branch creation, baseline verification, test/fixture/assertion review and an ordered coverage plan. No runtime reduction or test removal is selected by completing this audit. This audit does not certify every assertion or branch; the missing composed scenarios remain explicit prerequisites.

## Evidence and method

- Read implemented architecture, durable preferences, migration contracts/progress, current source/version, named tests and relevant fixture implementations.
- `npm run check` passes against the existing artifact before any rebuild.
- Node 24.13.0 / npm 11.6.2; locked dependencies installed with `npm ci`.
- `node --test --experimental-test-coverage --test-reporter=spec tests/*.test.js`: **494 passed, 0 failed/cancelled/skipped/todo**, approximately 6.1 seconds with instrumentation.
- There are 22 named test files. Static test-title counts differ from executed cases because some scenarios are generated in loops.
- The 372-entry migration transfer ledger checks that referenced test names exist. It neither evaluates assertion equivalence nor enumerates all current product capabilities.
- V8 source-file line/branch coverage: my-list-session 49.03% / 60.21%; responsive 64.27% / 72.22%; hover 80.25% / 72.83%; native-popup 87.03% / 72.56%; list mutations 97.90% / 79.63%; viewing scan 99.42% / 94.34%. These are executed-code indicators, not semantic adequacy scores. Generated VM bundle execution is separate from authored-file reporting; do not infer that every reported uncovered authored line is globally unexecuted. The overall report includes helpers/tooling and is deliberately not a product coverage score.
- Fixtures execute unmodified owners, but the offline DOM models structure and ownership, not browser layout, event propagation, React rendering, image decoding or accessibility. Test clocks model scheduling rather than real latency.

## Capability-to-evidence map

"Owner" means focused public-capability/policy tests. "Composed" means actual owners are connected for the stated workflow; it does not imply the entire real application is used.

| Capability / required observable result | Existing evidence | Remaining limitation before reducing affected code |
| --- | --- | --- |
| Installation, version agreement, self-contained reproducible artifact, dependency boundaries | bundle.test.js; scripts/check.mjs; Windows workflow | Build guards constrain packaging/architecture; they do not prove features. Bundle startup tests lack a completed populated-list interaction journey. |
| Startup, SPA entry/exit/reentry, optional grants, menu/storage failure, exact request/timer retirement | app.test.js; bundle.test.js; session-scope tests within app.test.js | Real populated app entry is exercised; generated-bundle route tests largely use an incomplete native shell. Add completed populated bundle reentry and visible output assertions. |
| Complete collection, correct count/order, bootstrap/fresh/mounted/native fallback, pagination failure | netflix-data.test.js; list.test.js; carousel.test.js; populated app tests | Strong owner evidence. Add representative real-session fallback success and exhausted failure; do not duplicate every adapter permutation end to end. |
| Native logical/indicator movement, wrapped tails, count convergence, serialized issued-move settlement | carousel.test.js | Strong owner evidence with modeled native inputs. Real-session hover preparation and resize consumers need composed output checks. |
| Scrollable cards, sanitization, images, chunked publication and cancellation | grid-cards.test.js; grid.test.js; netflix-data.test.js; app construction cases | Structure/quantum/retirement assertions are meaningful. Browser scroll/layout/image smoothness remains live verification. |
| Empty startup, last removal, delayed native empty adoption, repopulation | grid-empty.test.js; list-mutations.test.js; carousel empty cases | Owners are tested separately. Actual session empty/adoption/restart coordination is a priority gap. |
| Add/remove, native convergence, busy deferral, exact Undo, expiry, order/count/group preservation | list-mutations.test.js; grid-cards.test.js; page-DOM decoding cases | List publication collaborators are fixture callbacks. Actual session click -> native change -> membership/grid -> Undo wiring is insufficiently exercised. |
| Automatic watched/caught-up, truthful unknown, budgets/partial failures, profile isolation | viewing-integration.test.js; viewing-scan.test.js; viewing.test.js; netflix-data.test.js | Extensive real viewing/data/grid/scope composition, including large lists. Actual application session callbacks are not used by that composed fixture. |
| Independent Films/Series/All filters, groups/counts, manual placement/automatic restoration, storage merge/expiry, focus/viewport preservation | viewing-integration.test.js; viewing-choices.test.js; grid-groups.test.js; grid-controls.test.js | Strong feature composition. Add one real-session placement/refresh journey to establish wiring; actual browser focus/scroll still needs live evidence. |
| Original-source visibility, menus and restoration | app.test.js populated visibility case; settings tests; carousel presentation cases; bundle menu/localization cases | Populated app tests cover hide/dispose; changing settings during recovery/replacement is primarily separated owner coverage. |
| Hover dwell, controls/hidden exclusion, scroll rearming, cancellation and bounded retry | hover-intent.test.js; hover.test.js; responsive hover-wait case | Actual hover/grid/native-popup composition exists, but it injects preparation rather than executing the page session's complete preparation/navigation/mismatch workflow. |
| Native React binding/replay, exact target replacement, geometry leases, preview transfer/dismissal | hover.test.js; carousel.test.js | Strong ownership/replay assertions with fake React/event inputs. Netflix's actual native popup, playback/details controls and physical departure require live checks. |
| Responsive coalescing, unchanged/parked exceptions, real shape changes, remapping, waiting hover, deferred mutations | responsive.test.js; carousel mapping tests | Responsive transaction fixtures substitute native/grid observations and operations, often with empty items. Actual session remapping and rendered-card updates need composed verification. |
| Mismatch warning and user reinitialization | grid-frame.test.js dialog actions; list native-position policy; carousel resolution cases | Dialog/policy owners are tested; session reinitialization across stability/navigation waits is a priority gap. |
| Replaced native source, blocked initialization recovery, maximum one replacement recovery | carousel retirement/discovery tests; app late-arrival/retirement cases | Late source arrival is covered. Blocked-then-replaced real-session recovery and exhaustion are distinct and not established by those tests. |
| Localization, Copy Logs, bounded counters/probes, safe export and failure isolation | i18n.test.js; diagnostics.test.js; image-diagnostics.test.js; bundle CopyLogs; hover timing/probe cases | Broad bounded owner evidence. Preserve diagnostics as a capability; absence of visible UI does not make code expendable. Browser image decode/paint is not measured. |

## Ordered coverage-strengthening work

These are follow-up prerequisites, not claims of completed tests. Add observable assertions using real owners and narrow native inputs; do not expose private session fields or alter production source to make tests possible.

1. **Completed generated-bundle journey.** Start the shipped artifact against a populated native source; assert exact IDs/order/count, UI and independent filter defaults, source toggle, route exit cleanup and fresh reentry without duplicate listeners/menus/cards. Check that optional viewing failure leaves a usable list. Reuse only browser-input setup if a shared helper is needed.
2. **Membership and empty transitions through the real app.** Drive document click handling and modeled native updates. Assert removal, exact Undo reinsertion/order, expiry rejection, deferred action during initialization/refresh, last-item removal, delayed native empty adoption and first addition/repopulation. Observe current DOM, counts and resource release rather than helper invocation order.
3. **Real-session hover preparation and mismatch recovery.** Connect actual session/carousel/grid/hover/native-popup owners. Cover mounted-source replay and a target requiring movement, hidden/control exclusion, departure/scroll cancellation, admitted replacement, wrong native order warning and user reinitialization. Assert correct title replay and restored resources, never simply that a preparation callback ran.
4. **Responsive/source recovery through the real app.** Change native geometry/columns and wrapped-tail position, deliver resize/source replacement, and assert current cards/order/mapping, one bounded remapping retry, waiting-hover revalidation, queued membership completion and cleanup. Include blocked initialization followed by one genuine replacement and exhausted recovery.
5. **Viewing/settings application wiring.** Add representative real-session incremental completion, manual placement, refresh with added episode, profile replacement and settings changes while a source is being replaced. Existing composed viewing cases retain detailed protocol/policy permutations.
6. **Validate assertion sensitivity for each prospective reduction.** In disposable fixtures/checkouts, deliberately break the relevant contract (for example, omit hover preparation, reverse membership order, ignore a stale owner, skip empty adoption) and confirm the selected test fails for the expected observable reason. Restore the perturbation. Do not weaken guards or tests to obtain a smaller passing implementation. Build/source-text rejection is not behavior sensitivity evidence.

After each group, run its focused suite and the existing full check/test gates. Any discovered runtime defect needs a separately reviewed fix with normal versioning. Retain useful tests; merge duplicates only when contract, input class and failure mode are demonstrably equivalent, and update scenario-transfer references when names change.

## Simplification acceptance

Once the affected capabilities have composed tests and sensitivity evidence, work from architecture toward dead code in bounded changes. Preserve owner boundaries and small intent-level interfaces. Prefer removal of duplicate policy, unnecessary coordination and redundant representations over line-count tricks or moving complexity elsewhere. For every candidate, record the contract, unique guards, before/after authored runtime size and conceptual change; passing tests alone cannot justify removal of an untested capability. Runtime changes require a fresh release version, generated-output review, the normal Windows verification and user-owned live checks relevant to the change.

## Live evidence boundary

The preserved [1.4.58 capture](../logs/1.4.58.txt), interpreted in [findings.md](../findings.md), supports a 500-title grid, incremental viewing and native hover/preview/scroll activity. It does not establish real resize/zoom/remapping, route exit/reentry, membership/Undo or manual viewing actions. Offline mocks cannot certify current Netflix DOM/private React compatibility. Keep those live checks separate from the automated prerequisite work; no assistant browser inspection or authenticated requests were performed.
