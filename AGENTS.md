# Repository instructions

This repository maintains a Tampermonkey userscript for Netflix My List. The script presents the list as a scrollable grid.

## Read before working

- Read `context.md` for durable repository knowledge and user preferences.
- Read `findings.md` when continuing the code-review findings or their follow-up plan.
- Inspect the userscript and its current version before making code changes.

## Document ownership

- `AGENTS.md` defines repository workflow and document boundaries.
- `context.md` contains compact durable knowledge and user preferences. Follow its protected maintenance instructions; keep current findings and project status out of it.
- `findings.md` is the working record for current review findings, decisions, and the ordered follow-up plan, including completed and deferred points. Update it as a selected step is completed or its status changes; do not duplicate its current status in `context.md`.

## Userscript versioning

- A change to the distributable `.user.js` file that will be pushed is a userscript release: increase its version so Tampermonkey can detect the update. The new version must be greater than the newest published version; never lower or reuse a published version.
- Keep the userscript metadata `@version` and the internal `SCRIPT_VERSION` value identical.
- Use a patch increment for fixes, maintenance, and performance work; use a minor increment for a backward-compatible user-facing feature and a major increment for an incompatible change. If the impact is unclear, use a patch increment.
- Make the version update in the same change as the userscript edit; handle this automatically as part of the work without asking the user to choose a version.
- Documentation-only or workflow-only changes do not change the userscript version.

## Change workflow

- Review `context.md` during each repository task; edit its durable sections only when a lasting preference or cross-cutting fact changes, while preserving its protected instructions.
- Keep optional implementation within the step the user selected. A request to explain or assess possible follow-up work is discussion, not approval to implement it.
- Review the diff before finishing and run `git diff --check` for whitespace problems.
- After a repository-changing run, commit and push the changes to `origin`. The user has standing authorization for this in `context.md`; do not ask for per-commit confirmation. Follow any separate sandbox or automated-review gate presented by the app.
