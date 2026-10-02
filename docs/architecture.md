# Implemented architecture

This document describes what exists now. [Migration.md](../Migration.md) defines the architectural destination; [MigrationPlan.md](../MigrationPlan.md) defines its ordered implementation steps. Feature boundaries described there are not all implemented yet.

## Build boundary

`package.json` supplies the canonical release version and exact Node runtime, npm version and esbuild dependency. `package-lock.json` locks dependency resolution. `userscript.meta.json` supplies the existing userscript identity, match, grants, execution environment and flags.

`scripts/build.mjs` owns metadata rendering, version injection and generation. Its `generateUserscript` function builds in memory and returns code plus dependency metadata, without changing repository files. The build command writes that result to the existing `Legacy My List for Netflix.user.js` path. The output is a readable IIFE with the userscript header first, no external imports and no source-map/runtime dependency. It preserves escaped strings and the raw page execution environment.

`scripts/check.mjs` uses the same generation function. It validates the preserved installation contract, syntax, metadata/internal/package version agreement, lack of external runtime imports and normalized output equality. It never overwrites the file it is checking. CRLF checkout differences are normalized for equality; source changes, metadata changes and extra output remain detectable.

The checker enforces Migration.md's production import directions and public entries using esbuild's dependency metadata. Private files are accessible within their owning capability; carousel internals are a separate capability inside Netflix. Back-dependencies on application coordination, direct access to another feature's internals, cycles, external inputs and dormant production files fail verification. Completion policy cannot import Netflix integration. These graph checks do not prove state ownership, import-time purity or runtime behavior; the migration still audits those contracts through actual caller transitions and capability scenarios.

Legacy imports have no blanket exemption. Currently only `src/main.js -> src/legacy.js` is allowed, with removal in P20. Any needed future bridge must be recorded as an exact edge with its caller/reason/removal step in the checker and findings.md; obsolete exceptions fail verification rather than silently remaining after cutover.

`.github/workflows/check.yml` runs the normal verification commands on Windows and Linux with the exact Node version from package.json and locked dependencies. Checkout includes HEAD's parent so commit whitespace checks inspect the actual change. It verifies the committed bundle before any write-producing build, then runs regression tests, rebuilds, repeats the read-only check, checks syntax/commit whitespace and rejects tracked build changes. Runtime output/version is unchanged by adding this enforcement.

## Transitional runtime

```text
src/main.js
  -> src/legacy.js: startLegacy()
     -> existing settings, SPA hooks and route-session runtime
```

Main invokes the legacy entry once. Importing legacy alone does not activate listeners, requests or settings. The complete original executable body remains inside that explicitly started function, with its internal SCRIPT_VERSION injected by the build. Runtime feature state and lifetime ownership have not yet been transferred out of the closure. No parallel implementation or public legacy state bag is introduced.

The temporary runtime entry is replaced by application composition in P20, then removed in P21. The exact source responsibility transfers follow MigrationPlan.md; this document is updated as those capabilities become real.

## Verification boundary

`tests/performance.test.cjs` retains the baseline regression scenarios. Its temporary `tests/helpers/legacy-source.cjs` loader reads remaining declarations from authored `src/legacy.js`; bundler indentation/function spelling is not its input. Capability migrations move those cases to public-interface suites, removing this loader and the residual suite by P21.

`tests/bundle.test.js` executes the actual distribution in an offline VM browser fixture. It checks one startup, page-global navigation hooks, route entry/exit/reentry ownership, optional grants/storage/viewport behavior, and cancellation both before response delivery and during body reading. These checks complement the declaration-based suite rather than substituting for it.

The bundle suite also checks reproducible generation, metadata and version agreement, absence of external imports, read-only rejection of stale source/output and altered installation settings, and side-effect-free legacy import. `tests/helpers/dom.js` and `scheduler.js` provide mock DOM/timer behavior; they contain no duplicated production policy. Temporary build fixtures are created under a unique ignored workspace path, validated and removed after use.

These tests prove offline control flow and build consistency. They do not establish Netflix DOM/private React compatibility, real browser frame times or a faster runtime.
