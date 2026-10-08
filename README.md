# My List for Netflix

A Tampermonkey userscript that presents Netflix My List as a scrollable grid, using Netflix's native hover experience.

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/), then open the [released userscript](https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js) and install it. Visit `https://www.netflix.com/browse/my-list`. The existing menu command toggles the original Netflix list, and CopyLogs exports a compact diagnostic report. Shift-click CopyLogs when a specific investigation needs the full retained details.

For copies installed from the former root location, open the released-userscript link once and confirm the update in Tampermonkey. The script name/namespace is unchanged; this release specifies the new URLs for future updates.

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
logs/
  knowledge.md                      Bounded, version-specific live observations/provenance
  <version>.txt                     Temporary new capture; removed after completed review
src/                                Authored runtime modules
scripts/                            Build and consistency verification
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
