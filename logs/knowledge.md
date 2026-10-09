# Distilled live-log evidence

User-side evidence/provenance. Interpretation: [docs/findings.md](../docs/findings.md); other ownership/retention: AGENTS.md.

## Historical sessions — 1.4.52–1.4.58

Original exports were named `logs/<version>.txt`. All seven are recoverable at Git revision **8ca0de7ea22f3f5b7a0bdeadb6b091bfb9161d46**. Retired 2026-10-08. Times below are copiedAt in 2026, UTC+02:00; separate sessions, not controlled benchmarks. Windows/Firefox 157, DPR 1. Viewports: 1.4.52/.53/.55 at 2560×1279, the others at 1920×919.

| Tested version / copiedAt | Distinct observed evidence |
| --- | --- |
| 1.4.52 / Oct 7 15:01:31.853 | SPA count 9→498; nine edges trigger native fallback, complete grid/page-zero restoration. Eight columns. Warnings are reconciliation/fallback, not partial-list success. |
| 1.4.53 / Oct 7 15:27:14.420 | Same 9→498/native fallback; full grid loads. Repeated native hover replay/preparation fails with ReferenceError: routeSessionToken is not defined, originating in findMountedSourceSlot. |
| 1.4.54 / Oct 7 18:49:20.923 | Count reconciles 75→500; incomplete GraphQL falls back to full native collection and page-zero restoration. Seven columns. One hover preparation fails with “Observed native page mapping changed”; this capture shows no successful replay. |
| 1.4.55–1.4.57 / Oct 7 19:54:45.064; 20:15:12.939; 20:47:27.991 | All 500 titles/no WARN/ERROR/no real refresh. .55: zero hover; one unchanged/parked check, 123 resources/82 images. .56: 163 intents/22 dwells/17 replays/16 transfers, pointer-leave cancellation; four unchanged/one parked exception. .57: 436 intents/74 dwells/51 clones/two pointer accepts; 48 preview observations/33 transfers; three unchanged checks/no diagnostic failure, 48-replay sample limit reached. |
| 1.4.58 / Oct 8 00:00:24.153 | Fresh logical GraphQL collection initializes 500 titles in 3,357 ms; seven columns/72 finalized pages, mapping not stale. All 14 replay attempts dispatch; nine matching preview transfers are retained/released. No WARN/ERROR or reported cleanup/diagnostic failures. Detailed distinguishing measurements below. |

### 1.4.58 measurements worth retaining

- Viewing: 23 successful requests, peak concurrency two, zero failures/rate limits/aborts; 199 completed/270 unknown and 20 incremental publications. 247 series: 75 finale hints/170 unavailable progress/two inconsistent metadata.
- Interaction: 106 intents/81 cancellations/25 dwells; 14 clones/83 skips/four pointer accepts. Interruptions: 3 scroll/6 leave/2 controls; preview 9 transfers/5 releases/no delayed root search.
- Delay: main preparation max 1,593 ms; native queue wait max 1,051 ms. Slowest move 1,920 ms includes 1,913-ms acknowledgement/6-ms settlement; another takes 1,270 ms with 1,256-ms acknowledgement. Graft/alignment/replay maxima: 3/7/1 ms. Separate-session measurements, not smoothness proof.
- Scope: six unchanged responsive checks/one parked-height exception; no viewport refresh or target-route exit/reentry. No pending membership/Undo/popup/preview at export; displayed 167 is filtered from 500.

## Session — 1.4.64

Uncommitted input `Textdokument (neu).txt`: 419,064 bytes / 441 events, SHA256 **49d6878b560064696d58960aaabc19a8d33be992d2e4fd419a24105980b9812c**. Header version 1.4.64, copiedAt **2026-10-08T16:54:09.828+02:00**, Windows/Firefox 157, English, 2560×1279, DPR 1. Exact tested Git revision unavailable.

- 500-card grid; init 2,265 ms/eight columns/63 logical pages, mapping not stale; displayed 165 filtered. No WARN/ERROR (441 events).
- Viewing: 23 successful requests, peak concurrency two, no failures/rate limits/aborts, 21 publications; 200 completed/269 unknown. 245 series: 75 finale hints/163 unavailable progress/two inconsistent metadata/five manual complete choices with unknown progress. Editing/persistence untested.
- Hover: 131 intents/112 cancellations/19 dwells; ten replacements/replays/exits, six preview transfers, no reported failures. Interruptions: one scroll/eight leave. Max main/watched preparation 832/543 ms; queue 16 ms; move/ack/settle 300/291/18 ms; graft/align/replay 5/4/1 ms. Different session/columns from 1.4.58.
- Four unchanged responsive checks/one parked-height exception; no viewport refresh/route exit. No pending membership/Undo/native owners at export.
- Volume: per-series table 154,668 bytes; full 500-item collection event 57,725 bytes; 116 started/completed move pairs about 78 KiB. Export composition only.

## Session — 1.4.67

Uncommitted input `logs/1.4.67.txt`: 19,913 bytes, SHA256 **c8ee99038d4dff562649055aa2c342987861a19ce573ad419cb8723ab7d7189b**. Header version 1.4.67, copiedAt **2026-10-09T21:03:29.768+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; exact tested Git revision unavailable. Compact export: 659 retained events, 48 counted event types; 40 event sample groups/two sections omitted.

- Browse→My List: bootstrap 344 ms/count/edges 10; mounted count 500. Two reconciliation/fallback warnings. Native scan 6,961 ms/72 pages; initialization 7.45 s. Page-zero restoration; 500-card grid/seven columns, mapping not stale. Displayed 136 is filtered.
- Seven hover replays/transfers; max prep 496 ms/queue 1 ms. Viewing: 23 successes/no failures/rate limits/aborts, 197 complete/272 unknown. Two unchanged checks/no refresh/route exit/error event. Export omits bootstrap identity/pagination and individual page timings.

## Session — 1.4.69

Uncommitted input `logs/1.4.69.txt`: 68,631 bytes, SHA256 **ad3bf51f611d47927db061468f0dc83e4f4e311f7f2d418189e28b90fe749da3**. Header 1.4.69, copiedAt **2026-10-09T22:28:47.012+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; exact runtime revision unavailable. Compact export retains all 650 occurrences in 67 event/outcome groups (49 names), no omitted groups/sections, 28 extra examples omitted.

- Browse→My List: bootstrap 365 ms, count/edges nine, requested page size 75, hasNextPage=false; mounted count 500. Two reconciliation/fallback warnings. Initialization 8,016 ms; native collection 7,509 ms; 72 stabilization samples total 4,326 ms/max 340 ms. Shared-fast-mode move groups total 3,129 ms/72 moves (including restoration); group aggregates do not pair individual pages/timings. Restoration 16 ms/page zero; complete 500-card grid/seven columns/72 pages, mapping not stale. Displayed 136 is filtered.
- Export retains requested GraphQL row key, decoding to pageId/sectionId/idx=-999, but no mounted section ID or row-selection reason. Targeted recovery of 1.4.52/.54/.58 originals at the historical revision above finds idx=-999 in all three: count/edges/hasNextPage are 9/9/false, 75/75/false and 500/75/true respectively.
- Seven hover replays/exits, six preview transfers/releases, no replay/cleanup failure. Viewing: 23 successful requests, 197 complete/272 unknown, no failures/rate limits/aborts. Two unchanged responsive checks/no refresh; no target-route exit/reentry. No error event.

- Later detailed export from the **same startup**, uncommitted `logs/Textdokument (neu).txt`, copiedAt **2026-10-09T22:34:04.461+02:00**: 576,804 bytes/694 events, SHA256 **eeafdbe078b7b497463dc28df25f1deb11d1a1f99ac4f1dc433575ae690699ec**. First 650 events end at the prior CopyLogs request; startup/row/pagination/phase totals match. No mounted row ID or selection reason appears in either export. Slowest stabilized pages: 65/340 ms, 19/287 ms, 45/195 ms. Offline compact replay: 71,871 bytes; bootstrap fields unchanged, stabilization total/max and init/scan durations retained. Replay is export verification, not another live session.

## Evidence limits

Warning absence cannot certify the 1.4.54 mapping failure resolved. Unverified: real resize/zoom/remapping, route retirement/reentry, membership/Undo, manual viewing, exact timer retirement, every popup control/pointer outcome. Request success does not resolve unknown viewing metadata. Samples limit detail. No captures test 1.4.59–1.4.63, 1.4.65–1.4.66, 1.4.68 or 1.4.70 onward.
