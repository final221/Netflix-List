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

Native React grafts, geometry alignment/restoration, replay and preview handoff/dismissal belong to `src/netflix/native-popup.js`. `src/hover/hover.js` owns delegated intent, dwell, pointer/scroll policy, exact attempts and cancellation; its private `timing.js` owns bounded measurements. Hover consumes validated source/card handles and requests native interaction through the adapter. The existing native popup behavior and bounds are preserved.

Viewing completion, manual placement/coverage expiry, profile-scoped automatic cache and the complete bounded scan now live behind `src/viewing/viewing.js`. Opaque sessions own jobs, requests, results and persistence; composition supplies admitted membership and renders copied semantic changes. Grid actions call the admitted placement capability and render its semantic results. Storage keys/schema and scan/request limits remain unchanged.

Membership and toast clicks are interpreted by the Netflix page-DOM adapter; list owns add/remove publication, insertion positions, visible-order reconciliation, counts and exact Undo record/correlation selection. Grid and membership accept removals before DOM cleanup and additions before material release. Global click wiring keeps its existing route lifetime in transitional application composition.

[docs/architecture.md](docs/architecture.md) describes the implemented structure. [Migration.md](Migration.md) defines the destination and ownership contracts; [MigrationPlan.md](MigrationPlan.md) defines the ordered steps and verification. [findings.md](findings.md) records selections, evidence and remaining work.

Membership collections/order/counts and logical mounted/fresh collection strategy live in `src/list/`. Grid publication and additions now use sealed scalar records with separately transferred startup material. List owns removal-entry correlation validity, its single expiry timer, pending intents, observer/retry lifetimes, exact reconciliation deferral tickets and native-versus-captured reconciliation selection; expected native position follows exact membership order. Entry bootstrap selection, readiness overlap and mounted-count confirmation now belong to list collection; preferred/native fallback selection, empty proof and final count validation also belong to collection. Native preferred-page hints now belong to the carousel capability and never reside on lasting records. The runtime is explicitly started by `src/main.js`. Localization lives in `src/i18n/`, shared script DOM names in `src/dom-names.js`, stylesheet resources in `src/grid/styles.js` and card registry/handles, chunked publication, retained removal material, group/filter/expansion/count presentation, placement controls and admitted actions, status/dialog/native and provisional empty presentation, synthetic sections, geometry and exact resource lifetimes in `src/grid/`, and retained logging/export in `src/diagnostics/`. Netflix popup inspection, page context/DOM interpretation, card markup, My List data access and viewing protocol interpretation live in `src/netflix/`. The data adapters keep raw responses/cursors/credentials private and return normalized list and viewing records through bounded operations. `src/app/session-scope.js` owns route epochs and request/timer cancellation. `src/netflix/carousel/` owns native discovery, binding generations, shared reads, source preparation/readiness admission, validated complete-collection count acceptance, private page mapping and exact-record preferred hints, serialized movement, acknowledgement/settlement, hydration, page restoration, logical/indicator traversal collection, mounted bootstrap proof/capture, fresh page-zero anchoring, expected-card resolution and synchronous/bounded mounted-card resolution, preferred-page recovery and nearby-page search with validated source handles, plus delta/responsive mapping reconstruction, validated mapping observations, bounded source/count/position/page-card observations and passive native-card and source descriptions, plus native header/scan/parking/track markers and original-source visibility/restoration. It owns their motion and presentation leases, waits, unpublished captured material and bounded collection/restoration counters. Private React-reading and source-presentation implementations remain inside that capability. Transitional `src/legacy.js` retains composition of list publications into grid/native/hover callbacks, count convergence/mismatch coordination, the remaining feature state and orchestration, using the migrated owners through explicit bridges. Further steps transfer those workflows to their planned capabilities. The residual regression suite reads authored legacy declarations and uses migrated owners; capability and generated-bundle tests exercise their boundaries, startup, SPA navigation, cancellation and build consistency offline. Live Netflix compatibility remains a user-owned release check.
