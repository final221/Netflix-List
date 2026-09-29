# Findings and follow-up plan

Updated: 2026-09-30

This file records the code-review findings and the agreed follow-up plan for My List for Netflix. It is a working record; the plan does not authorize extra code changes beyond the step the user has chosen to pursue.

## G — Netflix-specific dependencies

### Current result

The agreed G scope is complete in the first adapter pass (`91b2c09`). Netflix GraphQL access and response handling are grouped in `netflixGraphql`; browse-row and carousel DOM discovery are grouped in `netflixDom`; private React carousel metadata and cloned-card hover behavior are grouped in `netflixReactCarousel` and `netflixReactHover`.

This puts the Netflix-specific assumptions behind clearer boundaries, making the code easier to inspect and giving future fixes a more obvious place to go. It does not remove the dependencies: the script still relies on Netflix's undocumented GraphQL response shapes, DOM attributes and layout, and private React metadata. Netflix can change those contracts and break a feature.

### What further work could provide

- **More centralization:** Moving remaining Netflix selectors or structural assumptions into the adapters would make them easier to locate and update together. It would mainly improve maintenance; by itself it should not change Netflix behavior or improve runtime performance.
- **More hardening:** Validate expected response and DOM shapes at integration boundaries, then report a specific failure when an assumption is missing. This can prevent confusing downstream errors and make diagnosis easier. It cannot ensure a feature keeps working after Netflix changes its internals.
- **New fallback behavior:** Try a second data or UI path if the preferred one fails. Existing code already has some fallbacks, including a page-bootstrap route when a fresh GraphQL collection fails, and alternate structural/identity clues for finding the My List row. A new fallback could improve availability only if its alternate source is trustworthy.

The highest-risk areas are the private React metadata used to determine logical carousel indices/counts and the React data grafted onto cloned cards so hover behavior works. Guessing indices or silently dropping React-dependent hover behavior could yield wrong ordering or changed interactions. No additional fallback has been selected or implemented: first observe a concrete Netflix break, then choose a fallback that preserves correctness and expected behavior. The original G goal is complete; optional extra hardening is not an open implementation task by itself.

## Logging note for E

The diagnostic entries are kept in a page-memory array capped at 5,000 entries and are also sent to the browser console. They are not persisted as log history in local or session storage. “Copy Logs” explicitly copies a diagnostic snapshot and the retained entries to the clipboard. The snapshot includes page and browser details, and individual entries can include item identifiers or URLs when those are logged.

Changing this would affect diagnostics, not Netflix's list or server behavior. Keeping detailed logs is useful for troubleshooting; any runtime cost comes from formatting, retaining, and writing log messages, and reducing copied details is not a meaningful grid-performance improvement. The user chose to defer E while keeping the option on the plan.

## Plan

| Point | Status | Planned work or result |
| --- | --- | --- |
| A. Align names | Done (`610d0bc`) | Tampermonkey and internal diagnostic names use “My List for Netflix.” |
| B. Preserve list changes during busy operations | Done (`f5d9c47`) | Queue and retry add/remove changes after initialization or responsive refresh completes. |
| C. Reduce observer work | Done (`eddea01`) | Narrow mutation-observer work to the My List area while still detecting replacement of that area. |
| D. Improve large-list performance | Done (`0219686`) | Defer thumbnail loading and delegate grid hover handling. |
| E. Limit copied log details | Deferred by user | Keep useful counts and errors; make titles, URLs, and video IDs opt-in or omit them from the standard copied report. Keep the current detailed logging for now. |
| F. Remove unused diagnostic code | Done (`5fdef5d`) | Remove `runVirtualIndexPagingDiagnostic`, which had no caller. |
| G. Isolate Netflix-specific dependencies | Done (`91b2c09`) | Group GraphQL, DOM, and React-dependent behavior behind adapters. Additional centralization, hardening, or fallbacks should be driven by a concrete maintenance or breakage need. |
