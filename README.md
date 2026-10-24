# My List for Netflix

A Tampermonkey userscript that presents Netflix My List as a scrollable grid, using Netflix's native hover experience.

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/), then open the [released userscript](https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js) and install it. Visit `https://www.netflix.com/browse/my-list`. The existing menu command toggles the original Netflix list. The standalone bottom-right CopyLogs button saves diagnostic summaries with event outcomes and timing aggregates. Its size target limits extra examples; essential summaries can exceed it. Ordinary click and Shift-click produce the same information-dense report.

For copies installed from the former root location, open the released-userscript link once and confirm the update in Tampermonkey. The script name/namespace is unchanged; this release specifies the new URLs for future updates.

Version **1.11.18** adds a bounded row-lifecycle timeline to CopyLogs for unexplained browse-feed replacement. It records population/page-identity changes and actual native-cache write/restoration stages on one clock, pinning before/after context around substantial loss or replacement. Old identities are fingerprinted; no new requests, polling or geometry surveys are added. All 802 offline tests pass. The cause of the supplied 1.11.17 disappearance remains unresolved; update, reload Netflix and save normal CopyLogs after it recurs.

Version **1.11.17** limits full recommendation-card validation to changed subtrees, retaining a cheap global connection check for cleanup. Moved scrollers, detached scopes and native classification changes retire their exact resources; routine hover-class changes are ignored. With 400 mounted cards, the one-card offline probe drops from 804 to 6 card `closest()` calls; the 20-card probe drops from 880 to 120 with the same 20 paints. CopyLogs distinguishes connection checks from full lease validation. All 793 offline tests pass; live frame timing remains unmeasured.

Version **1.11.16** handles recommendation mutations in one batch: retained-card validation and metadata admission run once, while discovery and repaint stay local. A 400-card offline probe with 20 changed roots falls from 20 scans and 16,080 card `closest()` calls to one scan and 880 calls, with the same 20 cards repainted. CopyLogs includes batch/root/lease/viewing-pass counters. All 787 offline tests pass; these operation counts do not establish live frame timing.

Version **1.11.15** unifies CopyLogs into one diagnostic summary: recurring events and title tables become counts, ranges and representative examples; navigation uses changes from its recorded starting state. Distinct failures, recovery decisions, timing extremes and useful geometry remain, including across page changes. Ordinary click and Shift-click behave identically. The realistic browsing regression report is 84% smaller (26 KB versus 165 KB); this is offline fixture evidence.

Version **1.11.14** completes all seven ownership-refactoring stages. All behavioral runtime modules are below 600 lines, including Carousel at 591; public behavior and resource/admission policies are preserved. All 780 offline tests pass. Firefox captures support recommendation forward paging, populated My List entry and native hover/preview cleanup. The user confirmed all remaining live checks verified; see [findings](docs/findings.md#previous-release---11115-unified-diagnostic-export) for evidence limits and the logging follow-up.

Version **1.11.6** requires native confirmation before removing a My List card, repairs discovery when Netflix mounts late, coalesces cross-tab storage reloads and reduces browsing work for large viewing histories. Encountered title names no longer block new saved choices at the incidental-history limit. CopyLogs includes confirmation/reload counters.

Version **1.11.5** restores the arrow field to the actual card-and-button bounds, excluding unused row spacing. The fixed row reservation, layout stabilization and loading/performance improvements remain. Reload to check the sizing; normal CopyLogs includes the measured content extent.

Version **1.11.4** stabilizes browsing control space and arrow height during card replacement. Local scans avoid unrelated arrow measurements/repaints, and metadata updates reuse native page-context discovery. Loading/filtering behavior is preserved. Normal CopyLogs now records arrow alignment, row gaps and layout-work counters. The 1.11.3 capture confirms15native loads/20verified publications/0loading failures; live layout and smoothness still need validation. Reload and try loading/paging between rows, saving normal CopyLogs if alignment moves again.

Version **1.11.3** fixes false cache-verification failures caused by pagination field order, retains genuine rejection details and stops redundant retries of disabled bindings. Unsupported automatic row lookups back off instead of repeatedly scanning as rows reenter view. Normal CopyLogs retains all four active row outcomes with exact comparison flags and received/added counts. The previous capture shows reads occurring but subsequent publication failing; initial rows without a usable native query variable and wider recommendation loading remain under investigation. Reload, page through a row and save normal CopyLogs after five seconds when loading appears to stop.

Version **1.11.2** keeps compaction active across equivalent native query-option refreshes, admits visible rows before their first arrow click and counts loaded eligible titles when publishing pages. Filtered lookahead can continue for up to six requests per activation/interaction; the shared request budget resumes automatically. Normal CopyLogs distinguishes buffered readiness, server exhaustion, cursor stalls and request limits, alongside ownership and page-fill facts. Live Netflix behavior still needs validation: reload, wait on the original row before paging, then use Next/Previous and save normal CopyLogs after five seconds on a sparse page. Deep surveys remain opt-in.

Version **1.11.1** repairs limitations in the compaction trial's query discovery and records the precise admission stage plus visible-page fill in normal CopyLogs. The 1.11.0 live capture showed zero activated bindings, so coherent compaction is still awaiting live verification. Mark watched/Mark caught up remain action labels; validated per-season coverage can enable a manual caught-up choice despite conflicting aggregate counts, without claiming automatic completion. Genuinely unavailable metadata disables the action with an explanation; reload retries it. Update/reload, use a row's Next/Previous arrows with five-second pauses, and save normal CopyLogs on a sparse page.

Version **1.11.0** trials filtered native recommendation paging: matched rows retain discovered titles, feed Netflix a filtered collection and load up to two pages ahead through the existing native client. It activates on native-arrow or card-choice interactions for up to four rows; unsupported query/cache shapes safely retain existing behavior and record a reason in CopyLogs. Native cards and hover stay in use. The lighter scrolling path from 1.10.3 remains. Live Netflix compatibility and coherent wrapping need validation: reload all Netflix tabs, try three Next clicks and one Previous click in a row, hide and restore a title, then save normal CopyLogs after five seconds. No Shift modifier is required; Shift-clicking a native arrow opts into heavy React/query/response diagnostics, while CopyLogs uses the same summary with either click.

Version **1.10.0** shares manual decisions and acknowledged completion across My List, browsing/search pages and open tabs, separately for each Netflix profile. Completion remains remembered when a later lookup is unavailable; reliably added episodes make an older caught-up result ineffective. Available title names are saved and repaired from encountered cards. Migration preserves the previous storage values, hides, corrections and coverage snapshots. Historical series without episode coverage remain accessible in the saved panel with an unavailable-status note until verified. Update the userscript and reload all Netflix tabs; the release adds Tampermonkey storage enumeration and change-listener grants. Offline verification passes; live Firefox/Netflix compatibility remains unverified.

The script includes **Mark watched** for films, **Mark caught up** for series, and **Hide suggestion** buttons on native cards on Netflix browsing/search pages. Use the always-visible buttons underneath a card, sharing the My List control layout, or focus them with the keyboard. Dismissals collapse the whole card slot so remaining cards flow into its space, and persist per Netflix profile in this browser through Tampermonkey. The right-side **Watched / Caught up / Suggestion hidden** button opens separate Films, Series and hidden-suggestion groups; click a title's **×** to remove its dismissal, even when its card is no longer present. New choices remember title names; choices show their title ID with a Netflix title link only while no reliable saved or mounted-card name is available. Close the panel with its top **×**, the toggle, or Escape. Watched and caught-up actions now share My List's per-profile manual viewing store and expiry policy. Caught-up series remember available seasons/episode counts; a later metadata check returns the title to the main group when Netflix reports added episodes or a new season, retaining the earlier decision and evidence. The panel's × returns shared viewing choices to the main My List group. Hide suggestion stays a separate lasting dismissal; all actions preserve Netflix ratings/watch history. The viewing button waits for reliable type/season metadata; Hide remains usable if metadata is unavailable. Old browsing film choices migrate; old series choices without episode snapshots are retained for verification. Marking them caught up captures current episodes explicitly. Continue Watching uses Netflix's existing controls. Visible native cards retain their sizes. Carousel arrows end at measured artwork/action bounds and extend to the screen edge, with lightly highlighted translucent backgrounds and centered icons above card hover. Dismissals preserve the current carousel page: the script never automatically clicks paging arrows, even on empty rows. Native flow can pull already-mounted later cards into the space. Matched rows now trial bounded loading and filtered cache publication; other rows retain the existing mounted-buffer behavior. Server-side reranking remains unresolved. CopyLogs captures up to forty row summaries and twenty user-arrow interactions, pairing each clicked row before navigation with timed snapshots and its state at export. It distinguishes first-observed from returning IDs and includes a bounded scroll/hover/click/action trace. It includes bounded title-ID samples, visible/hidden counts and page/transform facts without operating the arrow. CopyLogs also records a bounded stationary-row check with loading-capability names; diagnostic surveys invoke no callbacks, and cursor/credential values are not exported. No live Netflix testing was performed for this release.

The earlier 1.9.28 release moved mutation discovery into a private owner for observer targeting, filtering, coalescing and cleanup. Public carousel operations, native source validation and session recovery policies are preserved. Offline verification passes; live Netflix compatibility remains unverified.

## Development

Development and verification target Windows. Use Node **24.13.0** and npm **11.6.2**, as declared in package.json. Install the locked build dependency with `npm ci`.

```powershell
npm run check
npm test
npm run build
npm run check
node --check "dist/My List for Netflix.user.js"
git diff --check
```

Run check before rebuilding a checkout so stale committed output cannot be hidden. After changing source, rebuild before validating the resulting release. The same verification runs in [Windows CI](.github/workflows/check.yml).

Edit `src/` and use `npm run build` to generate the distributable in dist/. See [AGENTS.md](AGENTS.md) for release rules and repository change instructions.

## Offline recommendation experiment

For the separate offline recommendation-refill experiment, open [the demo](docs/recommendation-demo.html) in a browser. It uses fictional titles and simulated finite pages, preserves ratings, remembers dismissals per demo profile, and supports Undo. Regenerate it with `node scripts/build-recommendation-demo.mjs`; its controller and tests are outside the released userscript. See [findings](docs/findings.md#historical-offline-recommendation-refill-experiment) for integration limits.

## Saving logs

Update the userscript and refresh Netflix. CopyLogs remains available even if a prior download completion callback is missing; another click replaces the unresolved export. The CopyLogs button stays fixed while its saved message appears above it and disappears after three seconds. CopyLogs hides during playback and returns when you leave the player, retaining diagnostics. Click the universal bottom-right **CopyLogs** button to open a Save As download with a unique .txt filename. Ordinary click and Shift-click save the same summary. Reports retain ordered navigation, visible-window IDs, arrow geometry/hit facts and saved-action changes, while summarizing repeated movement and title data. Choose `E:\Fynn\Projects\Netflix List\logs` on the first save. Firefox may remember that folder for subsequent saves; verify it in your browser. Your normal download folder can stay unchanged. The userscript cannot preselect an absolute folder.

Tampermonkey downloads must use **Browser API** mode for Save As. If downloading is disabled, permission is missing, .txt is blocked, or the dialog is cancelled, the button reports failure. The script uses GM_download for a locally generated UTF-8 Blob, with no @connect, local receiver, clipboard or streaming. A Tampermonkey update prompt may appear because GM_download replaces the previous request grant.

Logs remain available across Netflix SPA page/profile navigation. The export includes up to four final prior-page snapshots, projected with the same summary policy instead of discarded when large; a full browser reload starts a new logging session.

## Live testing

For recommendation-loader investigation in 1.9.15: update and reload Netflix, click the affected carousel’s arrow once, wait about five seconds and click CopyLogs (Shift remains optional for full detail). The report retains the row before the click, so a baseline export is optional. It includes focused React handler/hook-data shapes, future request timings and bounded native GraphQL operation/variable/response collection facts. Response.json/text probes can observe clients retaining an earlier fetch reference; exported responseHooks/responseReads distinguish this from fetch interception. Failed series include exact coverage-validation reasons; coverageAdjustments reports episode-total normalization backed by an independently complete season list. Connection responses distinguish server exhaustion from absent requests. Metadata checking continues beyond 500 titles, retries incomplete batches and offers Refresh viewing status after exhausted retries. Two-page recommendation preloading still awaits the native pagination/render contract. Timing correlation alone cannot attribute a request to the row or prove cached recommendations.

Test released versions in Netflix on Windows. Save CopyLogs downloads under logs/ for review; [logs/knowledge.md](logs/knowledge.md) retains distilled observations. Follow [the log-review procedure](AGENTS.md#live-log-review-and-retention) for retention and issue extraction.

## Repository layout

Paths are relative to the repository root.

```text
README.md                           Installation, verification and repository map
AGENTS.md                           Workflow, document ownership and read order
docs/
  architecture.md                   Implemented source/ownership contracts and source map
  context.md                        Durable repository knowledge and user preferences
  findings.md                       Findings, decisions, progress and verification
  Maintainability Map.md            Versioned module sizes and responsibility inventory
  Repo Hygiene.md                   Best practices for size review and refactoring
  recommendation-demo.html          Generated standalone offline refill experiment
logs/
  knowledge.md                      Bounded, version-specific live observations/provenance
  <version>-<timestamp>-<id>.txt     Temporary captures; removed after completed review
src/                                Authored runtime modules
scripts/                            Build/verification and offline recommendation experiment
tests/                              Offline behavior, bundle and dependency checks
.github/workflows/check.yml         Windows CI
package.json / package-lock.json    Release version and locked tooling
userscript.meta.json                Userscript installation metadata
dist/
  My List for Netflix.user.js        Generated, committed installable release
```

Read [docs/architecture.md](docs/architecture.md) for implemented ownership, source composition and verification boundaries, [docs/findings.md](docs/findings.md) for findings and progress, and [AGENTS.md](AGENTS.md) for working instructions.

See the [Maintainability Map](docs/Maintainability%20Map.md) for module line counts and responsibility descriptions.

Use [Repo Hygiene](docs/Repo%20Hygiene.md) for file-size review signals and refactoring best practices.
