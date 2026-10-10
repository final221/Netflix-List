# My List for Netflix

A Tampermonkey userscript that presents Netflix My List as a scrollable grid, using Netflix's native hover experience.

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/), then open the [released userscript](https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js) and install it. Visit `https://www.netflix.com/browse/my-list`. The existing menu command toggles the original Netflix list. The standalone bottom-right CopyLogs button saves diagnostic summaries with event outcomes and timing aggregates. Its size target limits extra examples; essential summaries can exceed it. Shift-click CopyLogs when a specific investigation needs full payloads and every retained occurrence.

For copies installed from the former root location, open the released-userscript link once and confirm the update in Tampermonkey. The script name/namespace is unchanged; this release specifies the new URLs for future updates.

Version **1.9.7** includes **Mark watched** for films, **Mark caught up** for series, and **Hide suggestion** buttons on native cards on Netflix browsing/search pages. Use the always-visible buttons underneath a card, sharing the My List control layout, or focus them with the keyboard. Dismissals collapse the whole card slot so remaining cards flow into its space, and persist per Netflix profile in this browser through Tampermonkey. The right-side **Watched / Caught up / Suggestion hidden** button opens separate Films, Series and hidden-suggestion groups; click a title's **×** to remove its dismissal, even when its card is no longer present. New choices remember title names; older choices show their title ID with a Netflix title link when no name is available. Close the panel with its top **×**, the toggle, or Escape. Watched and caught-up actions now share My List's per-profile manual viewing store and expiry policy. Caught-up series remember available seasons/episode counts; a later metadata check clears that choice when Netflix reports added episodes or a new season. The panel's × returns shared viewing choices to the main My List group. Hide suggestion stays a separate lasting dismissal; all actions preserve Netflix ratings/watch history. The viewing button waits for reliable type/season metadata; Hide remains usable if metadata is unavailable. Old browsing film choices migrate; old series choices without episode snapshots are restored once identified, so mark them caught up again to capture current episodes. Continue Watching uses Netflix's existing controls. Visible native cards retain their sizes. Dismissals preserve the current carousel page: the script never automatically clicks paging arrows, even on empty rows. Native flow can pull already-mounted later cards into the space. Loading fresh recommendations beyond that mounted buffer remains unresolved. CopyLogs captures up to forty row summaries and twenty user-arrow interactions, pairing each clicked row before navigation with its state at export. It includes bounded title-ID samples, visible/hidden counts and page/transform facts without operating the arrow. CopyLogs also records a bounded stationary-row check with loading-capability names; callbacks are not invoked and cursor/credential values are not exported. No live Netflix testing was performed for this release.

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

Update the userscript and refresh Netflix. CopyLogs remains available even if a prior download completion callback is missing; another click replaces the unresolved export. The CopyLogs button stays fixed while its saved message appears above it and disappears after three seconds. CopyLogs hides during playback and returns when you leave the player, retaining diagnostics. Click the universal bottom-right **CopyLogs** button to open a Save As download with a unique .txt filename; Shift-click saves the detailed report. Choose `E:\Fynn\Projects\Netflix List\logs` on the first save. Firefox may remember that folder for subsequent saves; verify it in your browser. Your normal download folder can stay unchanged. The userscript cannot preselect an absolute folder.

Tampermonkey downloads must use **Browser API** mode for Save As. If downloading is disabled, permission is missing, .txt is blocked, or the dialog is cancelled, the button reports failure. The script uses GM_download for a locally generated UTF-8 Blob, with no @connect, local receiver, clipboard or streaming. A Tampermonkey update prompt may appear because GM_download replaces the previous request grant.

Logs remain available across Netflix SPA page/profile navigation. The export includes up to four final prior-page snapshots, each limited to 128K characters with declared compact fallback; a full browser reload starts a new logging session.

## Live testing

For recommendation-loader investigation in 1.9.7: update and reload Netflix, click the affected carousel’s arrow once, wait about five seconds and Shift-click CopyLogs. The report retains the row before the click, so a baseline export is optional. It includes focused React handler/hook-data shapes and future request timings, with a labeled buffered fallback when observation is unavailable. Timing correlation alone cannot attribute a request to the row or prove cached recommendations.

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
