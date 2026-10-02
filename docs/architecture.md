# Implemented architecture

This document describes what exists now. [Migration.md](../Migration.md) defines the architectural destination; [MigrationPlan.md](../MigrationPlan.md) defines its ordered implementation steps. Feature boundaries described there are not all implemented yet.

## Build boundary

`package.json` supplies the canonical release version and exact Node runtime, npm version and esbuild dependency. `package-lock.json` locks dependency resolution. `userscript.meta.json` supplies the existing userscript identity, match, grants, execution environment and flags.

`scripts/build.mjs` owns metadata rendering, version injection and generation. Its `generateUserscript` function builds in memory and returns code plus dependency metadata, without changing repository files. The build command writes that result to the existing `Legacy My List for Netflix.user.js` path. The output is a readable IIFE with the userscript header first, no external imports and no source-map/runtime dependency. It preserves escaped strings and the raw page execution environment.

`scripts/check.mjs` uses the same generation function. It validates the preserved installation contract, syntax, metadata/internal/package version agreement, lack of external runtime imports and normalized output equality. It never overwrites the file it is checking. CRLF checkout differences are normalized for equality; source changes, metadata changes and extra output remain detectable.

The checker enforces Migration.md's production import directions and public entries using esbuild's dependency metadata. Private files are accessible within their owning capability; carousel internals are a separate capability inside Netflix. Back-dependencies on application coordination, direct access to another feature's internals, cycles, external inputs and dormant production files fail verification. Completion policy cannot import Netflix integration. These graph checks do not prove state ownership, import-time purity or runtime behavior; the migration still audits those contracts through actual caller transitions and capability scenarios.

Legacy imports have no blanket exemption. Exact exceptions currently allow main to start legacy (removed in P20), legacy to consume DOM names/localization (removed in P20), and legacy to install/remove grid styles (removed in P11). The checker and findings.md record each caller/reason/removal step; obsolete exceptions fail verification rather than silently remaining after cutover.

`.github/workflows/check.yml` runs the normal verification commands on Windows and Linux with the exact Node version from package.json and locked dependencies. Checkout includes HEAD's parent so commit whitespace checks inspect the actual change. It verifies the committed bundle before any write-producing build, then runs regression tests, rebuilds, repeats the read-only check, checks syntax/commit whitespace and rejects tracked build changes. Runtime output/version is unchanged by adding this enforcement.

## Transitional runtime

```text
src/main.js
  -> src/legacy.js: startLegacy()
     -> src/dom-names.js: script-owned DOM contracts
     -> src/i18n/i18n.js: createI18n({ readLanguage })
        -> ui-messages.js / log-messages.js: literal resources
     -> src/grid/styles.js: installStyles(document) / removeStyles(document)
     -> existing settings, SPA hooks and route-session runtime
```

Main invokes the legacy entry once. Importing legacy alone does not activate listeners, requests or settings. It retains the remaining runtime orchestration, mutable feature state and lifecycle, with its internal SCRIPT_VERSION injected by the build. Localization, DOM names and stylesheet content now have separate owners and live callers. No parallel implementation or public legacy state bag is introduced.

The temporary runtime entry is replaced by application composition in P20, then removed in P21. The exact source responsibility transfers follow MigrationPlan.md; this document is updated as those capabilities become real.

## Resources and localization

`src/dom-names.js` declares shared script-owned IDs/classes/attributes and prior-version cleanup IDs. Feature-private markers remain with their existing callers; Netflix-owned selectors remain in legacy until P05. DOM detection does not use translated display text.

`src/i18n/i18n.js` creates a localization capability with a narrow `readLanguage` callback. It reads language lazily, normalizes regional forms, chooses supported UI locales and limits diagnostic text to English/Japanese. Its public operations translate UI/log messages and format numbers, counts and initialization time. Message interpolation and base-language parsing remain private. The two neighboring message files own all existing literal translations; neither tables nor implementations remain duplicated in legacy.

The locale reader still uses the existing document/navigator interpretation in legacy until P05 transfers it to netflix/context.js. Header/error assembly stays with its current presentation callers because it reads list/viewing state; localization owns only the display formatting it consumes. Final dependency injection replaces the residual consumers in P20.

`src/grid/styles.js` owns the existing stylesheet and imports shared selectors from dom-names.js. `installStyles(document)` creates one style element or returns the existing one; `removeStyles(document)` removes it idempotently. Importing the module only assembles literal CSS. Legacy invokes installation/cleanup at the same route points until grid frame ownership transfers in P11. This step adds no listener, observer or request.

## Verification boundary

`tests/performance.test.cjs` retains residual baseline regression scenarios. Its temporary `tests/helpers/legacy-source.cjs` loader reads remaining declarations from authored `src/legacy.js`; bundler indentation/function spelling is not its input. Viewing fixtures now consume the real localization capability instead of extracted tables/helpers. The baseline locale coverage case moved to `tests/i18n.test.js`, alongside normalization, fallback, plural and number/time scenarios. `tests/grid.test.js` checks stylesheet installation/removal/reuse and inert resource imports. Further capability migrations move cases to public-interface suites, removing the loader and residual suite by P21.

`tests/bundle.test.js` executes the actual distribution in an offline VM browser fixture. It checks one startup, page-global navigation hooks, route entry/exit/reentry ownership, optional grants/storage/viewport behavior, cancellation both before response delivery and during body reading, live localized menu updates and stylesheet cleanup/reinstallation. These checks complement the residual declaration-based suite rather than substituting for it.

The bundle suite also checks reproducible generation, metadata and version agreement, absence of external imports, read-only rejection of stale source/output and altered installation settings, and side-effect-free legacy import. `tests/helpers/dom.js` and `scheduler.js` provide mock DOM/timer behavior; they contain no duplicated production policy. Temporary build fixtures are created under a unique ignored workspace path, validated and removed after use.

These tests prove offline control flow and build consistency. They do not establish Netflix DOM/private React compatibility, real browser frame times or a faster runtime.
