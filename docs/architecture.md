# Implemented architecture

This document describes what exists now. [Migration.md](../Migration.md) defines the architectural destination; [MigrationPlan.md](../MigrationPlan.md) defines its ordered implementation steps. Feature boundaries described there are not all implemented yet.

## Build boundary

`package.json` supplies the canonical release version and exact Node runtime, npm version and esbuild dependency. `package-lock.json` locks dependency resolution. `userscript.meta.json` supplies the existing userscript identity, match, grants, execution environment and flags.

`scripts/build.mjs` owns metadata rendering, version injection and generation. Its `generateUserscript` function builds in memory and returns code plus dependency metadata, without changing repository files. The build command writes that result to the existing `Legacy My List for Netflix.user.js` path. The output is a readable IIFE with the userscript header first, no external imports and no source-map/runtime dependency. It preserves escaped strings and the raw page execution environment.

`scripts/check.mjs` uses the same generation function. It validates the preserved installation contract, syntax, metadata/internal/package version agreement, lack of external runtime imports and normalized output equality. It never overwrites the file it is checking. CRLF checkout differences are normalized for equality; source changes, metadata changes and extra output remain detectable.

The checker enforces Migration.md's production import directions and public entries using esbuild's dependency metadata. Private files are accessible within their owning capability; carousel internals are a separate capability inside Netflix. Back-dependencies on application coordination, direct access to another feature's internals, cycles, external inputs and dormant production files fail verification. Completion policy cannot import Netflix integration. These graph checks do not prove state ownership, import-time purity or runtime behavior; the migration still audits those contracts through actual caller transitions and capability scenarios.

Legacy imports have no blanket exemption. Exact exceptions currently allow main to start legacy (removed in P20), legacy to compose DOM names/localization/logger/report/popup inspection (removed in P20), and legacy to install/remove grid styles (removed in P11). The checker and findings.md record each caller/reason/removal step; obsolete exceptions fail verification rather than silently remaining after cutover.

`.github/workflows/check.yml` runs the normal verification commands on Windows and Linux with the exact Node version from package.json and locked dependencies. Checkout includes HEAD's parent so commit whitespace checks inspect the actual change. It verifies the committed bundle before any write-producing build, then runs regression tests, rebuilds, repeats the read-only check, checks syntax/commit whitespace and rejects tracked build changes. Runtime output/version is unchanged by adding this enforcement.

## Transitional runtime

```text
src/main.js
  -> src/legacy.js: startLegacy()
     -> src/dom-names.js: script-owned DOM contracts
     -> src/i18n/i18n.js: createI18n({ readLanguage })
        -> ui-messages.js / log-messages.js: literal resources
     -> src/grid/styles.js: installStyles(document) / removeStyles(document)
     -> src/diagnostics/logger.js: application-lifetime retained logging
     -> src/diagnostics/report.js: explicit summary providers and clipboard export
     -> src/netflix/popup-inspection.js: bounded response/component investigation
     -> existing settings, SPA hooks and route-session runtime
```

Main invokes the legacy entry once. Importing legacy alone does not activate listeners, requests or settings. It retains the remaining runtime orchestration, mutable feature state and lifecycle, with its internal SCRIPT_VERSION injected by the build. Localization, DOM names, stylesheet content, retained logging, report export and popup inspection now have separate owners and live callers. No parallel implementation or public legacy state bag is introduced.

The temporary runtime entry is replaced by application composition in P20, then removed in P21. The exact source responsibility transfers follow MigrationPlan.md; this document is updated as those capabilities become real.

## Resources and localization

`src/dom-names.js` declares shared script-owned IDs/classes/attributes and prior-version cleanup IDs. Feature-private markers remain with their existing callers; Netflix-owned selectors remain in legacy until P05. DOM detection does not use translated display text.

`src/i18n/i18n.js` creates a localization capability with a narrow `readLanguage` callback. It reads language lazily, normalizes regional forms, chooses supported UI locales and limits diagnostic text to English/Japanese. Its public operations translate UI/log messages and format numbers, counts and initialization time. Message interpolation and base-language parsing remain private. The two neighboring message files own all existing literal translations; neither tables nor implementations remain duplicated in legacy.

The locale reader still uses the existing document/navigator interpretation in legacy until P05 transfers it to netflix/context.js. Header/error assembly stays with its current presentation callers because it reads list/viewing state; localization owns only the display formatting it consumes. Final dependency injection replaces the residual consumers in P20.

`src/grid/styles.js` owns the existing stylesheet and imports shared selectors from dom-names.js. `installStyles(document)` creates one style element or returns the existing one; `removeStyles(document)` removes it idempotently. Importing the module only assembles literal CSS. Legacy invokes installation/cleanup at the same route points until grid frame ownership transfers in P11. This step adds no listener, observer or request.

## Logging, report export and popup inspection

`src/diagnostics/logger.js` owns the application-lifetime circular log buffer, capped at the existing 5,000 entries. It retains chronological export order, console prefix/detail, Error/DOM/circular formatting and local timestamps. Trace calls evaluate their payload callback only when enabled. Callers receive log/warn/trace operations, copied entries, size and report formatting; they cannot write the private buffer or its cursor. Route entry leaves retained history intact.

`src/diagnostics/report.js` exposes one `copy()` operation. Composition supplies scalar environment metadata and separate runtime, series-viewing, thumbnail and native-popup summary providers. They run on an explicit copy request; the report retains no feature state or native DOM/fiber objects. It preserves copied fields/detail and clipboard preference: navigator.clipboard, then the existing execCommand fallback with the same warning/failure messages. The fallback removes its own textarea in a finally block, including failed selection/copy. The CopyLogs button handler and feedback timer remain with legacy presentation until frame transfer in P11.

`src/netflix/popup-inspection.js` owns bounded response survey counters, private component/response interpretation and one serialized preview shape. Existing limits remain eight response pages/four sampled cards per page, bounded depth/nodes/keys/paths/fibers/holders/function prefixes, and one preview capture per route entry. It exposes recordResponse, capturePreview, collect, diagnostics and reset. Summaries are copies; functions/values/live objects are not exported. Probes use descriptors, skip sensitive keys/getters, never invoke private callbacks, and isolate failures.

Inspection receives current-session checks, a current-token reader, a mounted-grid predicate and one current-source-card reader. Legacy resets its private counters on list entry and supplies the current request/hover session token. The existing validated CarouselPage response feeds the survey without another request; an admitted native preview transfer feeds shape capture. Report collection alone probes the current source card. Stale response/capture operations cannot change the current counters, and a failed probe cannot reject a native transfer or initiate recovery.

All other counters, hover preview presence timers, frame samples and image-resource measurements remain in legacy until their planned feature transfers. Performance snapshots merge the inspection's copied counters at the original report field. Legacy composes these capabilities through exact temporary imports until P20 moves composition into app; upcoming data/native owners receive their declared operations through injected collaborators.

## Verification boundary

`tests/performance.test.cjs` retains residual baseline regression scenarios. Its temporary `tests/helpers/legacy-source.cjs` loader reads remaining declarations from authored `src/legacy.js`; bundler indentation/function spelling is not its input. Viewing fixtures now consume the real localization capability instead of extracted tables/helpers. The baseline locale coverage case moved to `tests/i18n.test.js`, alongside normalization, fallback, plural and number/time scenarios. `tests/grid.test.js` checks stylesheet installation/removal/reuse and inert resource imports. Further capability migrations move cases to public-interface suites, removing the loader and residual suite by P21.

`tests/bundle.test.js` executes the actual distribution in an offline VM browser fixture. It checks one startup, page-global navigation hooks, route entry/exit/reentry ownership, optional grants/storage/viewport behavior, cancellation both before response delivery and during body reading, live localized menu updates and stylesheet cleanup/reinstallation. These checks complement the residual declaration-based suite rather than substituting for it.

The bundle suite also checks reproducible generation, metadata and version agreement, absence of external imports, read-only rejection of stale source/output and altered installation settings, and side-effect-free legacy import. `tests/helpers/dom.js` and `scheduler.js` provide mock DOM/timer behavior; they contain no duplicated production policy. Temporary build fixtures are created under a unique ignored workspace path, validated and removed after use.

`tests/diagnostics.test.js` exercises the new public logger/report/inspection boundaries, including the eight baseline logging and pure probe scenarios transferred from the residual suite. It adds formatter fidelity, private snapshot ownership/current-session rejection and clipboard success/failure cleanup checks. Residual collection, viewing-report and native-preview cases invoke the actual capabilities with their existing feature fixtures; their feature mechanics move in later steps. A bundle case clicks the generated CopyLogs control, checks export without requests and verifies retained history across route reentry.

These tests prove offline control flow and build consistency. They do not establish Netflix DOM/private React compatibility, real browser frame times or a faster runtime.
