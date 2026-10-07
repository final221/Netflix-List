# My List for Netflix

A Tampermonkey userscript that presents Netflix My List as a scrollable grid, using Netflix's native hover experience.

## Installation

Install [Tampermonkey](https://www.tampermonkey.net/), then open the [released userscript](https://github.com/final221/Netflix-List/raw/refs/heads/main/Legacy%20My%20List%20for%20Netflix.user.js) and install it. Visit `https://www.netflix.com/browse/my-list`. The existing menu command toggles the original Netflix list, and CopyLogs exports the script's diagnostics.

## Development

Development and verification target Windows. Use Node **24.13.0** and npm **11.6.2**, as declared in package.json. Install the locked build dependency with `npm ci`.

```powershell
npm run check
npm test
npm run build
npm run check
node --check "Legacy My List for Netflix.user.js"
git diff --check
```

Check verifies the current committed artifact without writing it. Run it before rebuilding when verifying a checkout; otherwise rebuilding could hide stale output. After editing authored source or release metadata, build creates the reviewed release artifact and check verifies it.

The same command order runs in one GitHub Actions job on Windows. CI takes its exact Node version from package.json, installs locked dependencies, checks committed output before testing/building, then checks syntax, commit whitespace and absence of tracked build changes. Check also verifies reachable production modules, the declared public import boundaries and absence of cycles. Temporary legacy import exceptions are exact edges with removal steps recorded in findings.md.

Edit `src/` rather than the generated root userscript. `package.json` is the single release-version source; `userscript.meta.json` supplies the other metadata. Build generates a readable, self-contained userscript at the original filename. No runtime npm installation or external module fetch is needed in Tampermonkey.

Any pushed change to the distributable requires a version greater than the newest published release, using AGENTS.md's increment rules. Update package.json and its lockfile together, then rebuild; metadata and internal SCRIPT_VERSION receive that same version automatically. Documentation/tooling changes that leave output unchanged do not need a userscript version increase.

## User testing and version logs

The user tests released versions in Netflix with Tampermonkey on Windows. `logs/` stores diagnostic captures from that live use, named for the tested userscript version, such as `logs/1.4.52.txt`. CopyLogs provides the export; saving it in the repository is a manual user action.

These files provide evidence of behavior in the user's browser alongside the offline tests and Windows CI. When reviewing a capture, match its version to the tested release and record the observed result, limitations and follow-up in [findings.md](findings.md), citing the log. A saved log documents that session; successful live checks require supporting observations or user confirmation. Preserve the original captures.

## Architecture and migration

[docs/architecture.md](docs/architecture.md) describes the implemented ownership and lifetimes. [Migration.md](Migration.md) defines the destination; [MigrationPlan.md](MigrationPlan.md) defines ordered steps; [findings.md](findings.md) records progress, verification and version-specific live evidence.

`src/main.js` starts `app/application.js`. Application owns navigation, retained logging, semantic settings/menus and the current My List session. Each `app/my-list-session.js` instance assembles and retires the public list/viewing/grid/hover/native capabilities and owns its own request scope. `app/responsive.js` owns viewport/source checks and the refresh transaction. List owns membership/collection/queues/Undo; viewing owns profile-specific scans/placement/persistence; grid owns cards/frame/groups/styles and bounded image diagnostics; hover owns intent/timing. Netflix adapters own page/protocol interpretation, native binding/mapping/navigation/collection, source presentation and native popup mechanics. Diagnostic reporting consumes copied feature summaries. No production legacy entry or import exception remains.

The residual characterization suite still reads actual authored page-session declarations and instruments private owners through test-only loaders. Public capability and generated-bundle tests exercise startup, SPA lifecycle, cancellation and build/dependency consistency offline. P21 removes residual test support after its final coverage/ownership audit. Live Netflix compatibility remains a user-owned release check.
