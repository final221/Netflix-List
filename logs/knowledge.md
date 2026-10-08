# Distilled live-log evidence

This file owns compact observations and provenance from user-supplied Netflix sessions. It contains evidence, not bug diagnoses, fix status, implementation plans, architecture, preferences or automated acceptance. Those belong in [docs/findings.md](../docs/findings.md), [docs/architecture.md](../docs/architecture.md), docs/context.md and repository workflow. Review procedure and size limits belong in AGENTS.md.

## Historical sessions — 1.4.52–1.4.58

Original exports were named `logs/<version>.txt`. All seven are recoverable at Git revision **8ca0de7ea22f3f5b7a0bdeadb6b091bfb9161d46**. Their raw files were removed after distillation on 2026-10-08. Times below are copiedAt in 2026, UTC+02:00; these are separate sessions, not a controlled benchmark. All used Windows/Firefox 157 with device pixel ratio 1. Viewports: 1.4.52/.53/.55 at 2560×1279, the others at 1920×919.

| Tested version / copiedAt | Distinct observed evidence |
| --- | --- |
| 1.4.52 / Oct 7 15:01:31.853 | SPA count reconciles 9→498; nine GraphQL edges are incomplete, native fallback collects/builds all 498 titles and restores page zero. Eight columns. Warnings describe reconciliation/fallback rather than a successful partial list. |
| 1.4.53 / Oct 7 15:27:14.420 | Same 9→498/native fallback; full grid loads. Repeated native hover replay/preparation fails with ReferenceError: routeSessionToken is not defined, originating in findMountedSourceSlot. |
| 1.4.54 / Oct 7 18:49:20.923 | Count reconciles 75→500; incomplete GraphQL falls back to full native collection and page-zero restoration. Seven columns. One hover preparation fails with “Observed native page mapping changed”; this capture shows no successful replay. |
| 1.4.55 / Oct 7 19:54:45.064 | 500-title grid; one unchanged/parked-height check; 123 examined resources/82 images; no WARN/ERROR. Zero hover intents and real responsive refreshes: startup evidence only. |
| 1.4.56 / Oct 7 20:15:12.939 | 500 titles; 163 hover intents, 22 dwell completions, 17 sampled replays and 16 preview transfers, with pointer-leave cancellation. Four unchanged responsive checks/one parked-height exception; zero real refreshes. No WARN/ERROR. |
| 1.4.57 / Oct 7 20:47:27.991 | 500 titles; 436 intents, 74 dwell completions, 51 prepared clones, two accepted replacement-pointer checks, 48 completed preview observations/33 transfers. Three unchanged responsive checks, zero real refreshes. No WARN/ERROR or diagnostic failures; finite 48-replay sampling budget reached. |
| 1.4.58 / Oct 8 00:00:24.153 | Fresh logical GraphQL collection initializes 500 titles in 3,357 ms; seven columns/72 finalized pages, mapping not stale. All 14 replay attempts dispatch; nine matching preview transfers are retained/released. No WARN/ERROR or reported cleanup/diagnostic failures. Detailed distinguishing measurements below. |

### 1.4.58 measurements worth retaining

- Viewing: 23 successful requests, peak concurrency two, zero failures/rate limits/aborts; 199 completed/270 unknown and 20 incremental publications. Of 247 series rows, 75 use latest-episode-complete hints, 170 have unavailable progress and two incomplete/inconsistent metadata. Transport success does not establish completion for unknown titles.
- Interaction: 106 intents/81 cancelled/25 completed dwells; 14 target clones rebuilt/83 neighboring slots skipped; four replacement-pointer checks accepted. Eleven preparations interrupted: three scroll, six pointer leave, two controls. Fourteen preview observations complete by nine transfers/five early releases, with no delayed root search.
- Delay: main preparation max 1,593 ms; native queue wait max 1,051 ms. Slowest move 1,920 ms includes 1,913-ms acknowledgement/6-ms settlement; another takes 1,270 ms with 1,256-ms acknowledgement. Graft/alignment/replay maxima: 3/7/1 ms. These are session measurements, not proof of a controlled cross-version regression or smoothness.
- Scope: six responsive checks are unchanged, one ignored parked-height collapse; no real viewport event/refresh. Subsequent navigation stays on My List; no route exit/reentry is recorded. No pending membership intents/Undo entries or active popup/preview at export. The displayed 167 titles are a filtered view of 500 accepted/grid records, not incomplete collection.

## Evidence limits

Absence of a warning in later sessions does not prove the 1.4.54 mapping failure is resolved in all relevant cases. These exports do not establish real resize/zoom/remapping, route retirement/reentry, membership/Undo, manual viewing or exact construction/readiness retirement acceptance. Native replay counters show activity, not every popup control or physical-pointer outcome. Sample limits restrict later detail. No supplied capture tests 1.4.59–1.4.61; older results must not be applied to those releases. Current issue interpretation and follow-up belong only in docs/findings.md.
