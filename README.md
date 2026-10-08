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

The same command order runs in one GitHub Actions job on Windows. CI takes its exact Node version from package.json, installs locked dependencies, checks committed output before testing/building, then checks syntax, commit whitespace and absence of tracked build changes. Check also verifies reachable production modules, the declared public import boundaries and absence of cycles. No temporary import exception remains. Check also rejects residual test support/source-evaluating loaders and verifies the named scenario-transfer references.

Edit `src/` rather than the generated root userscript. `package.json` is the single release-version source; `userscript.meta.json` supplies the other metadata. Build generates a readable, self-contained userscript at the original filename. No runtime npm installation or external module fetch is needed in Tampermonkey.

Any pushed change to the distributable requires a version greater than the newest published release, using AGENTS.md's increment rules. Update package.json and its lockfile together, then rebuild; metadata and internal SCRIPT_VERSION receive that same version automatically. Documentation/tooling changes that leave output unchanged do not need a userscript version increase.

## User testing and version logs

The user tests released versions in Netflix with Tampermonkey on Windows and manually saves CopyLogs exports in logs/. Raw captures are temporary review inputs. After review, distinguishing version-specific evidence and its limits are folded into [logs/knowledge.md](logs/knowledge.md), actionable interpretation goes into [docs/findings.md](docs/findings.md), and the reviewed raw export is removed. AGENTS.md owns this retention workflow.

The knowledge file stays compact and contains no implementation plans, architecture or automated-test results. Previously committed originals remain recoverable through the Git provenance it records. Live observations remain separate from local/CI acceptance and do not certify newer releases.

## Repository layout

Paths below are relative to the repository root. README and AGENTS stay at the root for discovery; project documentation lives under docs/. Live-log evidence stays under logs/ with its temporary review inputs.

```text
README.md                           Installation, verification and repository map
AGENTS.md                           Workflow, document ownership and read order
docs/
  architecture.md                   Implemented source/ownership contracts and source map
  context.md                        Durable repository knowledge and user preferences
  findings.md                       Findings, decisions, progress and verification
logs/
  knowledge.md                      Bounded, version-specific live observations/provenance
  <version>.txt                     Temporary new capture; removed after completed review
src/                                Authored runtime modules
scripts/                            Build and consistency verification
tests/                              Offline behavior, bundle and dependency checks
.github/workflows/check.yml         Windows CI
package.json / package-lock.json    Release version and locked tooling
userscript.meta.json                Userscript installation metadata
Legacy My List for Netflix.user.js  Generated, committed release
```

An optional ready-to-delete/ folder holds retired documents awaiting user deletion. Active documentation never depends on it. The source composition map is in [docs/architecture.md](docs/architecture.md); document ownership and retention rules are in AGENTS.md.

## Architecture

[docs/architecture.md](docs/architecture.md) owns the implemented architecture and continuing contracts. [docs/findings.md](docs/findings.md) records decisions, completed work, verification and version-specific live evidence. The 21-step modular-source migration is complete.

`src/main.js` starts `app/application.js`. Application owns navigation, retained logging, semantic settings/menus and the current My List session. Each `app/my-list-session.js` instance assembles and retires the public list/viewing/grid/hover/native capabilities and owns its own request scope. `app/responsive.js` owns viewport/source checks and the refresh transaction. List owns membership/collection/queues/Undo; viewing owns profile-specific scans/placement/persistence; grid owns cards/frame/groups/styles and bounded image diagnostics; hover owns intent/timing. Netflix adapters own page/protocol interpretation, native binding/mapping/navigation/collection, source presentation and native popup mechanics. Diagnostic reporting consumes copied feature summaries. No production legacy entry or import exception remains.

Named capability, policy, composed viewing/application and generated-bundle tests exercise startup, SPA lifecycle, cancellation, resource retirement and build/dependency consistency offline. Tests use unmodified owners; no source-instrumenting loader or residual suite remains. `tests/scenario-transfers.json` records the old scenarios and exact named coverage references. Live Netflix compatibility remains a user-owned release check.
