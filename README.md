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

## Architecture and migration

[docs/architecture.md](docs/architecture.md) describes the implemented structure. [Migration.md](Migration.md) defines the destination and ownership contracts; [MigrationPlan.md](MigrationPlan.md) defines the ordered steps and verification. [findings.md](findings.md) records selections, evidence and remaining work.

The runtime is explicitly started by `src/main.js`. Localization lives in `src/i18n/`, shared script DOM names in `src/dom-names.js`, stylesheet ownership in `src/grid/styles.js`, and retained logging/export in `src/diagnostics/`. Netflix popup inspection, page context/DOM interpretation, card markup, My List data access and viewing protocol interpretation live in `src/netflix/`. The data adapters keep raw responses/cursors/credentials private and return normalized list and viewing records through bounded operations. `src/app/session-scope.js` owns route epochs and request/timer cancellation. `src/netflix/carousel/` owns native discovery, binding generations, shared reads, source preparation/readiness admission, validated complete-collection count acceptance, private page mapping, serialized movement, acknowledgement/settlement, hydration, page restoration, logical/indicator traversal collection, mounted bootstrap proof/capture, fresh page-zero anchoring, expected-card resolution and synchronous/bounded mounted-card resolution, preferred-page recovery and nearby-page search with validated source handles, plus delta/responsive mapping reconstruction, validated mapping observations and bounded source/page-card observations. It owns their motion-style leases, waits, unpublished captured material and bounded collection counters. Transitional `src/legacy.js` retains transitional membership/card page publication, the remaining feature state, collection strategy and orchestration, using the migrated owners through explicit bridges. Further steps transfer those workflows to their planned capabilities. The residual regression suite reads authored legacy declarations and uses migrated owners; capability and generated-bundle tests exercise their boundaries, startup, SPA navigation, cancellation and build consistency offline. Live Netflix compatibility remains a user-owned release check.
