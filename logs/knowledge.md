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

## Session — 1.4.64

Uncommitted input `Textdokument (neu).txt`: 419,064 bytes / 441 events, SHA256 **49d6878b560064696d58960aaabc19a8d33be992d2e4fd419a24105980b9812c**. Header version 1.4.64, copiedAt **2026-10-08T16:54:09.828+02:00**, Windows/Firefox 157, English, 2560×1279, DPR 1. Header version does not establish an exact tested Git revision.

- Complete 500-title collection/grid; initialization 2,265 ms, eight columns/63 finalized logical pages, mapping not stale. The 165-title status is a filtered presentation. No WARN/ERROR among the 441 retained events.
- Viewing: 23 successful requests, peak concurrency two, no failures/rate limits/aborts, 21 publications; 200 completed/269 unknown. Of 245 series: 75 latest-episode-complete hints, 163 unavailable progress, two incomplete/inconsistent metadata and five manual complete choices despite unavailable progress. Export alone does not test editing/persisting those choices.
- Hover: 131 queued/112 cancelled/19 completed dwells, ten target replacements/replays/native exits and six preview transfers; no replay/exit/cleanup/diagnostic failures reported. Nine preparations interrupted (one scroll/eight pointer leave). Preparation maxima main/watched: 832/543 ms; queue 16 ms; move/acknowledgement/settlement maxima 300/291/18 ms; graft/alignment/replay 5/4/1 ms. Different session and column count from 1.4.58, not a controlled performance comparison.
- Four unchanged responsive checks/one parked-height exception; no real viewport refresh or route exit/reentry. No pending membership intents/Undo, graft, geometry, replay or preview owner at export. Popup/physical-pointer control coverage and exact timer retirement are not established.
- Volume: per-series table 154,668 bytes; full 500-item collection event 57,725 bytes; 116 started/completed move pairs about 78 KiB. These are export composition measurements, not behavior acceptance.

## Session — 1.4.67

Uncommitted input `logs/1.4.67.txt`: 19,913 bytes, SHA256 **c8ee99038d4dff562649055aa2c342987861a19ce573ad419cb8723ab7d7189b**. Header version 1.4.67, copiedAt **2026-10-09T21:03:29.768+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; exact tested Git revision unavailable. Compact export: 659 retained events, 48 counted event types; 40 event sample groups/two sections omitted.

- SPA entry from Browse: fresh bootstrap 344 ms, count/edges 10; mounted count 500. Two warnings report reconciliation and incomplete GraphQL/native fallback. Native collection completes in 6,961 ms across 72 stabilized pages; header initialization 7.45 s. Standby restores page zero; export has 500 collected/grid cards, seven columns, mapping not stale. Displayed 136 is a filtered view.
- Seven native hover replays/transfers; preparation max 496 ms, queue max 1 ms. Viewing: 23 successful requests, no failures/rate limits/aborts, 197 completed/272 unknown. Two unchanged responsive checks, no refresh or target-route exit/reentry. No error event type. Compact omission prevents per-page timing attribution and inspection of the bootstrap row/key, pagination flag or response contents.

## Evidence limits

Absence of a warning in later sessions does not prove the 1.4.54 mapping failure is resolved in all relevant cases. These exports do not establish real resize/zoom/remapping, route retirement/reentry, membership/Undo, manual viewing or exact construction/readiness retirement acceptance. Native replay counters show activity, not every popup control or physical-pointer outcome. Sample limits restrict later detail. No supplied capture tests 1.4.59–1.4.63, 1.4.65–1.4.66 or 1.4.68 onward; older results must not be applied to those releases. Current issue interpretation and follow-up belong only in docs/findings.md.
