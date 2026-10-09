# My List for Netflix

A Tampermonkey userscript that presents Netflix My List as a scrollable grid, using Netflix's native hover experience.

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/), then open the [released userscript](https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js) and install it. Visit `https://www.netflix.com/browse/my-list`. The existing menu command toggles the original Netflix list, and CopyLogs exports diagnostic summaries with event outcomes and timing aggregates. Its size target limits extra examples; essential summaries can exceed it. Shift-click CopyLogs when a specific investigation needs full payloads and every retained occurrence.

For copies installed from the former root location, open the released-userscript link once and confirm the update in Tampermonkey. The script name/namespace is unchanged; this release specifies the new URLs for future updates.

Version **1.6.1** includes **Mark watched** and **Hide suggestion** buttons on native cards on Netflix browsing/search pages. Use the always-visible buttons underneath a card, sharing the My List control layout, or focus them with the keyboard. Dismissals collapse the whole card slot so remaining cards flow into its space, and persist per Netflix profile in this browser through Tampermonkey. The right-side **Already watched / Suggestion hidden** button opens both saved groups; click a title's **×** to remove its dismissal, even when its card is no longer present. New choices remember title names; older choices show their title ID with a Netflix title link when no name is available. Close the panel with its top **×**, the toggle, or Escape. These manual choices leave Netflix ratings/watch history and My List placement unchanged. Continue Watching uses Netflix's existing controls. Visible native cards retain their sizes; replacement titles and fresh recommendations are still pending. The new controls have automated coverage but have not been verified against a live Netflix session.

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

## Live testing

Test released versions in Netflix on Windows. Save CopyLogs exports under logs/ for review; [logs/knowledge.md](logs/knowledge.md) retains distilled observations. Follow [the log-review procedure](AGENTS.md#live-log-review-and-retention) for retention and issue extraction.

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
  <version>.txt                     Temporary new capture; removed after completed review
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
