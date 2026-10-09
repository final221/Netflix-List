# Distilled live-log evidence

Interpretation: [findings](../docs/findings.md).

## Historical sessions — 1.4.52–1.4.58

Originals `logs/<version>.txt` at **8ca0de7ea22f3f5b7a0bdeadb6b091bfb9161d46**. Retired 2026-10-08; copiedAt 2026, UTC+02:00; uncontrolled benchmarks. Windows/Firefox 157, DPR 1. Viewports: 1.4.52/.53/.55 2560×1279; others 1920×919.

| Tested version / copiedAt | Distinct observed evidence |
| --- | --- |
| 1.4.52 / Oct 7 15:01:31.853 | SPA count 9→498; native fallback completes grid/page-zero restoration, eight columns. Warnings describe fallback. |
| 1.4.53 / Oct 7 15:27:14.420 | Same complete 9→498 fallback. Hover replay/preparation: ReferenceError: routeSessionToken is not defined in findMountedSourceSlot. |
| 1.4.54 / Oct 7 18:49:20.923 | 75→500/native fallback/page-zero restoration, seven columns. Hover: “Observed native page mapping changed”; no successful replay captured. |
| 1.4.55–1.4.57 / Oct 7 19:54:45.064; 20:15:12.939; 20:47:27.991 | 500 titles/no WARN/ERROR/no real refresh. .55: zero hover, 123 resources/82 images. .56/.57: native hover activity. .57: two pointer accepts/48 preview observations/33 transfers/no diagnostic failure; 48-replay sample limit. Unchanged checks: 1/4/3; parked exception in .55/.56. |
| 1.4.58 / Oct 8 00:00:24.153 | Fresh GraphQL collection initializes 500 titles in 3,357 ms; seven columns/72 finalized pages, mapping not stale. All 14 replay attempts dispatch; nine matching preview transfers are retained/released. No WARN/ERROR or reported cleanup/diagnostic failures. |

### 1.4.58 measurements

- Viewing: 23 successes/peak two, 199 complete/270 unknown; no failures/rate limits/aborts. Unknown progress remains despite successful transport.
- Delay: main preparation max 1,593 ms; native queue wait max 1,051 ms. Slowest move 1,920 ms: ack 1,913 ms/settle 6 ms. Graft/alignment/replay maxima: 3/7/1 ms. Not a controlled benchmark.
- Scope: six unchanged responsive checks/one parked-height exception; no viewport refresh or target-route exit/reentry. No pending membership/Undo/popup/preview at export; displayed 167 is filtered from 500.

## Session — 1.4.64

Uncommitted input `Textdokument (neu).txt`: 419,064 bytes / 441 events, SHA256 **49d6878b560064696d58960aaabc19a8d33be992d2e4fd419a24105980b9812c**. Header version 1.4.64, copiedAt **2026-10-08T16:54:09.828+02:00**, Windows/Firefox 157, English, 2560×1279, DPR 1. Runtime revision unavailable.

- 500-card grid; init 2,265 ms/eight columns/63 logical pages, mapping not stale; displayed 165 filtered. No WARN/ERROR (441 events).
- Ten native replays/exits/six transfers, no reported failure; manual-choice persistence and popup control coverage untested.
- Four unchanged responsive checks/one parked-height exception; no viewport refresh/route exit. No pending membership/Undo/native owners at export.
- Volume: per-series table 154,668 bytes; full 500-item collection event 57,725 bytes; 116 started/completed move pairs about 78 KiB. Export composition only.

## Session — 1.4.67

Uncommitted `logs/1.4.67.txt`: 19,913 bytes, SHA256 **c8ee99038d4dff562649055aa2c342987861a19ce573ad419cb8723ab7d7189b**. Header 1.4.67, copiedAt **2026-10-09T21:03:29.768+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; runtime revision unavailable. Compact export: 659 retained events, 48 counted event types; 40 event sample groups/two sections omitted.

- Browse→My List: bootstrap 344 ms/count/edges 10; mounted count 500. Two reconciliation/fallback warnings. Native scan 6,961 ms/72 pages; initialization 7.45 s. Page-zero restoration; 500-card grid/seven columns, mapping not stale. Displayed 136 is filtered.
- Sampled native hover/no error; no real resize/route exit. Old compact export omits bootstrap identity/pagination and individual page timings.

## Session — 1.4.69

Uncommitted input `logs/1.4.69.txt`: 68,631 bytes, SHA256 **ad3bf51f611d47927db061468f0dc83e4f4e311f7f2d418189e28b90fe749da3**. Header 1.4.69, copiedAt **2026-10-09T22:28:47.012+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; runtime revision unavailable. Compact: 650 occurrences/67 groups/49 names, no groups/sections omitted; 28 examples omitted.

- Browse→My List: bootstrap 365 ms, count/edges nine, requested page size 75, hasNextPage=false; mounted count 500. Two reconciliation/fallback warnings. Initialization 8,016 ms; native collection 7,509 ms; 72 stabilization samples total 4,326 ms/max 340 ms. Moves 3,129 ms/72 including restoration; aggregates cannot pair individual pages. Restoration 16 ms/page zero; complete 500-card grid/seven columns/72 pages, mapping not stale. Displayed 136 is filtered.
- Requested GraphQL key decodes to pageId/sectionId/idx=-999; no live ID/selector reason. Recovered .52/.54/.58 originals (revision above): idx=-999 in all; count/edges/hasNextPage 9/9/false, 75/75/false, 500/75/true.
- Seven hover replays/exits, six preview transfers/releases, no replay/cleanup failure. Viewing: 23 successful requests, 197 complete/272 unknown, no failures/rate limits/aborts. Two unchanged responsive checks/no refresh; no target-route exit/reentry. No error event.

- Later detailed export from the **same startup**, uncommitted `logs/Textdokument (neu).txt`, copiedAt **2026-10-09T22:34:04.461+02:00**: 576,804 bytes/694 events, SHA256 **eeafdbe078b7b497463dc28df25f1deb11d1a1f99ac4f1dc433575ae690699ec**. Same startup/first 650 events through prior copy; row/pagination/phase totals match. Neither export has mounted row ID/selection reason. Slowest page 65/340 ms.

## Session — 1.4.70

Uncommitted `logs/Textdokument (neu).txt`: 63,370 bytes, SHA256 **0fb1b1282449390cbf73f7f20342dc6c9449a6a09c83b63b40bdc67063ded4f9**. Header 1.4.70, copiedAt **2026-10-09T23:04:59.936+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; exact runtime revision unavailable. Compact: 278 occurrences/39 event names, no groups/sections omitted; 25 extra examples omitted.

- Initial route is already My List. Init 2,526 ms; 500 titles/seven GraphQL pages; continuation 1,472 ms/bootstrap 532 ms. No native scan/capture metadata reads; seven columns/72 finalized logical pages, mapping not stale. No WARN/ERROR.
- Selector cached-key; selected/native section IDs match before/after response, both cached counts 500, first three selected/native/response card IDs agree; no native section change. Response 75 edges/500 total/hasNextPage=true.
- Viewing: 23 successes/no failures/rate limits/aborts, 197 complete/272 unknown; four native hover replays/three transfers/no replay or cleanup failure. Two unchanged responsive checks/no refresh/route exit. No Browse→My List transition captured.

- Later detailed `logs/Textdokument (neu).txt`, **2026-10-09T23:58:29.467+02:00**, 517,617 bytes/509 events/46 names, SHA256 **aa4260fed0fe075e7d0e6262b10839377b79055dcc11a2913163e1f3232dd727**; same version/environment, different session. Starts already on My List (no recorded Browse transition). Init 8,282 ms/native scan 7,521 ms; 500 cards/72 pages, mapping not stale. Two count-reconciliation/fallback warnings, no error.
- Cached-key selects count nine; selected/live section IDs mismatch before/after request, their decoded page identities differ and card samples disagree. Live ID is stable; nativeRowCachedCount=null. Response nine edges/count nine/hasNextPage=false; native count 500. Six replays/transfers/no replay failure; viewing 23 successes/197 complete/272 unknown, no request failure.

## Evidence limits

User report **2026-10-10**, after 1.5.0 release (installed version/environment unconfirmed): enlarged native previews cover artwork buttons. Source: this chat; no capture/timings.

Warning absence cannot certify the 1.4.54 mapping failure resolved. Unverified: real resize/zoom/remapping, route retirement/reentry, membership/Undo, manual viewing, exact timer retirement, every popup control/pointer outcome. Request success does not resolve unknown viewing metadata. Samples limit detail. No captures test 1.4.59–1.4.63, 1.4.65–1.4.66, 1.4.68 or 1.4.71 onward.
