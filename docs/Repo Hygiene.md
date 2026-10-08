# Repo Hygiene

Best practices for keeping a repository understandable and easy to change. Use size as a review signal; judge refactoring by responsibility, ownership, dependencies and behavior. These thresholds are working heuristics, not universal limits or automatic instructions to split files.

## File-size scale

Measure authored source using readable physical lines. Include comments and blank lines in the inventory, but distinguish them from logic when assessing complexity. Review generated output separately.

Size amplifies the cost of the same structural problems: a small file is easier to traverse, while a large file demands more context to understand and change. As size grows, the severity needed to justify refactoring decreases. The examples below illustrate severity, not problems exclusive to a particular range.

| Lines | Assessment | Concern when |
| ---: | --- | --- |
| Up to 200 | Usually easy to traverse. | **A severe structural problem makes safe changes unreliable:** conflicting state owners repeatedly cause defects, or valid states and cleanup cannot be reliably traced even within this small file. Mild untidiness is insufficient. |
| 201–400 | Manageable with a clear responsibility. | **A substantial structural problem regularly obstructs changes:** independent responsibilities require coordinated edits, shared mutations have unclear consequences, or testing one behavior requires setting up unrelated workflows. |
| 401–600 | Traversal and context costs are becoming significant. | **A moderate structural problem adds noticeable effort to routine changes:** one rule requires edits in distant sections, following a workflow needs repeated backtracking, or callers must reconstruct internal sequencing. Defects need not already have occurred. |
| 601–800 | Small structural problems become costly at this size. | **Even mild, recurring structural friction is enough:** scattered helpers force repeated searching, a few duplicated decisions must be kept in sync, or loosely related sections add avoidable context to otherwise simple changes. |
| Over 800 | Retention requires explicit justification. | **There is no convincing reason to retain the structure, even without a reported defect.** Review must demonstrate cohesive ownership, understandable workflows and focused tests, plus why a smaller structure would worsen coupling or scatter tightly coupled state. Otherwise, plan refactoring. |

Translation catalogs, schemas, stylesheets and declarative tables may reasonably exceed these ranges. Generated files should be changed through their source. Test files should be assessed by scenario cohesion and fixture complexity, not divided merely to pass a size check. Functions need their own review: one deeply nested workflow can be difficult even inside a small file.

## When refactoring is worthwhile

- **Mixed responsibilities:** unrelated policies, presentation, persistence or lifecycle work change for different reasons inside one module.
- **Scattered ownership:** multiple files mutate the same state, duplicate invariants or disagree about who starts, cancels and releases resources. Passing values between files is normal; exchanging mutable internals or coordinating every technical step is a warning sign.
- **Change spreads:** a single rule requires edits across several unrelated call sites, or understanding one operation requires repeatedly jumping between files.
- **Growing control flow:** long functions, deep nesting, many flags and duplicated branches obscure valid states and failure behavior.
- **Weak interfaces:** callers supply many internal callbacks or must know a subsystem's sequence, data representation or cleanup details. Tiny forwarding modules can also create unnecessary indirection.
- **Poor feedback:** recurring defects, difficult behavioral tests or tests tied to private implementation make safe changes harder.

Prioritize observed change difficulty, defects and ownership confusion over the largest line count alone.

## How to refactor

1. **Define the problem and preserve the contract.** State what becomes easier to change. Trace success, failure, cancellation and cleanup; check that tests protect the relevant behavior.
2. **Simplify before extracting.** Remove confirmed dead paths and duplicate decisions. Prefer one authoritative representation; avoid abstractions created for hypothetical future needs.
3. **Choose the boundary by ownership.** Move a complete responsibility with its state, invariants and resource lifetime. Keep tightly coupled operations together and expose a small interface expressing the capability.
4. **Show the proposed structure.** Name the files, their responsibilities, dependency direction and state owners before editing. Avoid cycles, shared mutable context bags and long callback lists that reproduce the original coordinator across files.
5. **Make a focused, reviewable change.** Preserve behavior through callers as well as helpers. Keep unrelated feature changes and broad formatting churn out of the refactor.
6. **Verify the improvement.** Exercise affected behavior and failure paths, inspect the diff and check dependencies. Compare how many files, decisions and internal details a representative change now requires. Smaller files alone are insufficient evidence.

A good outcome can be deletion, simplification, splitting, merging or retaining the current structure. Splitting can slightly increase total lines while improving maintainability. Record a concise rationale for retaining an unusually large behavioral module and revisit it when its responsibilities grow.

## Everyday maintenance

- **Readable source:** use consistent formatting, meaningful names and spacing between logical sections. Comments should explain intent, constraints or surprising behavior. Update stale comments; do not remove useful comments or blank lines to improve a size score.
- **Bounded interfaces:** expose only what callers need. Keep implementation details private and keep dependency direction explicit. Avoid helpers that force callers to reconstruct the capability.
- **Useful tests:** assert observable contracts, include relevant failure and retirement cases, and keep fixtures focused. Remove redundant coverage only after checking which guarantee it protects.
- **Dependency discipline:** remove unused dependencies and exports after checking callers. Prefer existing capabilities to new packages; keep tooling reproducible and separate from runtime code.
- **Repository clarity:** keep authoritative documentation current, avoid duplicate status records, and update maps and references when files move. Keep temporary experiments and bulky raw evidence out of retained documentation after their required review.
- **Truthful measurement:** distinguish source, generated output, tooling, tests and data. Report structural improvement separately from line or byte savings; compact formatting and deleted whitespace are not architectural progress.

The [Maintainability Map](Maintainability%20Map.md) provides the measured inventory. [architecture.md](architecture.md) owns implemented boundaries, [findings.md](findings.md) owns selected work and progress, and [AGENTS.md](../AGENTS.md) owns repository workflow and release requirements. This guide supplies review criteria; it does not select or authorize unrelated implementation work.
