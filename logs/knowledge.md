# Distilled live-log evidence

## Historical sessions — 1.4.52–1.4.58

Originals `logs/<version>.txt` at **8ca0de7ea22f3f5b7a0bdeadb6b091bfb9161d46**. Retired 2026-10-08; copiedAt 2026, UTC+02:00; uncontrolled benchmarks. Windows/Firefox 157, DPR 1. Viewports: 1.4.52/.53/.55 2560×1279; others 1920×919.

CopiedAt Oct7 (UTC+02): .52 15:01:31.853/.53 15:27:14.420/.54 18:49:20.923/.55 19:54:45.064/.56 20:15:12.939/.57 20:47:27.991; .58 Oct8 00:00:24.153.
- .52/.53 nine→498/native fallback/page0/eight columns; warnings. .53 hover ReferenceError: routeSessionToken undefined in findMountedSourceSlot.
- .54 75→500/native fallback/page0/seven columns; hover “Observed native page mapping changed”; no successful replay.
- .55–.57 500/no WARN/ERROR/refresh; .55 no hover/123 resources/82 images; .56/.57 hover; .57 two pointer accepts/48 previews/33 transfers/no failure, 48-replay sample limit. Unchanged checks1/4/3; parked exception.55/.56.
- .58 init500/3,357ms/seven columns/72pages/not stale;14replays/9transfers/no WARN/ERROR/cleanup failure. Viewing23successes/peak2/199complete/270unknown/no failure/rate-limit/abort. Max preparation/queue1593/1051ms; slowest move1920(ack1913/settle6); graft/alignment/replay max3/7/1ms. Six unchanged checks/parked exception/no refresh/exit/pending membership/Undo/popup/preview;167displayed(filtered).

## Session — 1.4.64

Uncommitted `Textdokument (neu).txt`, 419,064bytes/441events; SHA256 **49d6878b560064696d58960aaabc19a8d33be992d2e4fd419a24105980b9812c**. CopiedAt **2026-10-08T16:54:09.828+02:00**, Windows/Firefox157/English/2560×1279/DPR1; runtime revision unavailable.
500cards/init2265ms/eight columns/63pages/not stale/165filtered;10replays/exits/6transfers/no WARN/ERROR;4unchanged checks/parked exception. Export volume:series154668bytes/collection57725/116move pairs≈78KiB. No refresh/exit/pending owners; persistence/popup controls untested.

## Sessions — 1.4.67 and 1.4.69

Windows/Firefox157, English, 1920×919/DPR1; runtime revisions unavailable. Uncommitted inputs:
- 1.4.67 `logs/1.4.67.txt`, copiedAt **2026-10-09T21:03:29.768+02:00**, 19,913bytes; SHA256 **c8ee99038d4dff562649055aa2c342987861a19ce573ad419cb8723ab7d7189b**. Compact659events/48types;40groups/two sections omitted.
- 1.4.69 `logs/1.4.69.txt`, **2026-10-09T22:28:47.012+02:00**, 68,631bytes; SHA256 **ad3bf51f611d47927db061468f0dc83e4f4e311f7f2d418189e28b90fe749da3**. Compact650occurrences/67groups/49names; no groups/sections omitted,28examples omitted.
- 1.4.69 `logs/Textdokument (neu).txt`, **2026-10-09T22:34:04.461+02:00**, 576,804bytes/694events; SHA256 **eeafdbe078b7b497463dc28df25f1deb11d1a1f99ac4f1dc433575ae690699ec**. Same startup/first650events; totals match; page65 slowest340ms.

Both Browse→My List captures reconcile bootstrap10(.67)/nine(.69) against mounted500 with two fallback warnings; seven columns/page-zero restoration/not stale,136displayed(filtered). .67 bootstrap344ms/native6961ms/72pages/init7.45s; sampled hover/no errors/resize/route exit; identity/pagination/page timings omitted.
.69 bootstrap365ms/page size75/hasNextPage=false; init8016ms/native7509ms;72settle samples total4326/max340ms;72moves3129ms incl16ms restoration (individual pages unpaired). Requested key idx=-999; no live row ID/selection reason in either export. Recovered .52/.54/.58 (revision above): idx=-999; count/edges/hasNextPage=9/9/false,75/75/false,500/75/true.
.69 seven hover replays/exits/six transfers/releases/no replay/cleanup failure;23viewing successes/197complete/272unknown/no failure/rate-limit/abort;two unchanged responsive checks/no refresh/route exit/error.

## Session — 1.4.70

Uncommitted `logs/Textdokument (neu).txt`: 63,370 bytes, SHA256 **0fb1b1282449390cbf73f7f20342dc6c9449a6a09c83b63b40bdc67063ded4f9**. Header 1.4.70, copiedAt **2026-10-09T23:04:59.936+02:00**, Windows/Firefox 157, English, 1920×919, DPR 1; exact runtime revision unavailable. Compact: 278 occurrences/39 event names, no groups/sections omitted; 25 extra examples omitted.

- Initial route is already My List. Init 2,526 ms; 500 titles/seven GraphQL pages; continuation 1,472 ms/bootstrap 532 ms. No native scan/capture metadata reads; seven columns/72 finalized logical pages, mapping not stale. No WARN/ERROR.
- Selector cached-key; selected/native section IDs match before/after response, both cached counts 500, first three selected/native/response card IDs agree; no native section change. Response 75 edges/500 total/hasNextPage=true.
- Viewing: 23 successes/no failures/rate limits/aborts, 197 complete/272 unknown; four native hover replays/three transfers/no replay or cleanup failure. Two unchanged responsive checks/no refresh/route exit.

- Later detailed `logs/Textdokument (neu).txt`, **2026-10-09T23:58:29.467+02:00**, 517,617 bytes/509 events/46 names, SHA256 **aa4260fed0fe075e7d0e6262b10839377b79055dcc11a2913163e1f3232dd727**; same version/environment, different session. Starts already on My List (no recorded Browse transition). Init 8,282 ms/native scan 7,521 ms; 500 cards/72 pages, mapping not stale. Two count-reconciliation/fallback warnings, no error.
- Cached-key selects count nine; selected/live section IDs mismatch before/after request, their decoded page identities differ and card samples disagree. Live ID is stable; nativeRowCachedCount=null. Response nine edges/count nine/hasNextPage=false; native count 500. Six replays/transfers/no replay failure; viewing 23 successes/197 complete/272 unknown, no request failure.

## Session — 1.9.1

Uncommitted captures, copiedAt **2026-10-10** UTC+02, Windows/Firefox157, English, 2560×1279/DPR1/homepage; runtime revision unavailable:
- **20:19:33.852**, `1.9.1-2026-10-10T18-19-33-853Z-01657356.txt`, 1711bytes/3events, SHA256 **59e5f4f52f2a28de68e67ac7038f2595648fada60ce5d493d209f44bc949a23f**.
- **20:20:20.484**, `1.9.1-2026-10-10T18-20-20-485Z-3f42d96b.txt`, 2730bytes/7occurrences, SHA256 **b97d3d8488e08763f6f23832f17696f5bd1e6af9179917c19c2d9b24e4396c02**.
Same startup; second retains first completion/user-cancellation warning. Both reached logs/. User confirms folder remembering; CopyLogs overlays playback. No navigation/prior snapshots/refill checks. Decorated156/hidden140; checked160→186/pending26→0/no storage failure. Compact: no groups/sections/examples omitted.

## Session — 1.9.3

Uncommitted `1.9.3-2026-10-10T18-33-21-508Z-8b0f7ecb.txt`, 1463bytes; SHA256 **c3c2752bad24f0140bf250af1812275d03d5fe36d04cce8a1e79b96867af5345**. CopiedAt **2026-10-10T20:33:21.508+02:00**, same Firefox/environment as1.9.1. Detailed homepage baseline:3events/no refill/prior pages; completion unobserved. User:manual arrow reveals more cards, then CopyLogs unclickable(Shift/normal). No post-arrow capture; cause unproven.

## Session — 1.9.4

Uncommitted detailed homepage captures, **2026-10-10** UTC+02, same environment as1.9.1; runtime revision unavailable:
- **20:40:15.662**, `1.9.4-2026-10-10T18-40-15-662Z-7329ed01.txt`,2248bytes/5events; SHA256 **6d218ffbd0a7f62a08cd9bfdcf6e2c133307e9fcd99b3ddd5d734f3bcdfc1707**.
- **20:40:26.160**, `1.9.4-2026-10-10T18-40-26-160Z-a62b34b7.txt`,2436bytes/7events; SHA256 **ce1970bb9efce8824ef5c870017b05f26da67ccd39fab52257ee13d2d20f69d0**.
Same startup; second retains first save completion after a cancelled dialog. Both logSave.pending=0; decorated263→275/checked262→275/hidden140. No dismissal/refill checks/prior pages; card increase has no recorded cause. Repeat downloads reached logs/.

## Evidence limits

Chat **2026-10-10** (versions/environment unconfirmed): 1.5.0 previews cover buttons; 1.6.0/.1 panel/collapse work; 1.8.0 needs manual arrows; 1.8.1 auto-advances the row, disrupting browsing. No capture/timings.

No warning alone certifies the 1.4.54 mapping issue resolved. Unverified: resize/zoom/remapping, route lifecycle, membership/Undo/viewing, timers and popup/pointer controls. Requests can succeed with unknown metadata. No captures:1.4.59–.63/.65–.66/.68 or1.4.71–1.9.0.
