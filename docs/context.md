**AGENTS DO NOT TOUCH THIS PART** 

How to use:
review it after every run, but edit it only when durable knowledge changed. keep info retained compact but lossless. Extract general knowledge from your context and give it to the file
what it should contain:
- distilled general knowledge gathered about the repo
- distilled user preferences on how to work
- principles that apply across multiple repository areas
- durable cross-cutting context
- Enter and edit sections as needed

what it should not contain
- recent crash reports
- recent crash fixes
- anything specific about earlier runs, any summaries
- current status about loggings, telemetry
- recent fixes
- reproduce what is already encoded in other documentation
- current project status
- everything that is not durable cross-cutting context
- claim summaries
- audit defects
- repository mechanics: placement, ownership, verification, archival, lifecycle, or partition rules
- named constructions, claims, current candidates, counterexamples, audit findings, or rejected mechanisms
- representation surveys or map-specific technical details


****


## User working preferences

- The user uses this personal script on Windows and wants work limited to Windows. Linux and other operating-system support are out of scope unless explicitly requested.
- For this repository, the user authorizes commits and pushes of changes to `origin` without per-commit confirmation. Use the configured GitHub SSH remote, which is authenticated without requiring the user to supply credentials. This is user authorization; it does not bypass the app's sandbox or automated-review gates. Follow those system gates without asking the user to repeat the standing authorization.
- During code reviews, the user authorizes implementing worthwhile simplifications that preserve capabilities, then reviewing again and continuing while concrete reductions remain. Implement verified reductions directly rather than repeatedly producing a full assessment and discarding working prototypes. Discussion or suggestions outside that simplification scope do not authorize unrelated implementation.
- The user treats maintainability as a major priority and wants substantial net reductions in code and concepts while preserving the script's capabilities. Before broad simplification, assess whether tests cover those capabilities and strengthen missing coverage; passing existing tests alone is not a sufficient reason to remove behavior. Measure achievable reductions rather than promising savings from line count or file moves alone.
- Use a 2% net reduction per simplification run as a benchmark, not permission to remove capabilities, guards or useful diagnostics, or to compress formatting solely to hit a number.
- Judge maintainability reductions primarily in authored runtime modules, and report generated userscript size separately from source, build tooling and tests. Explain whether savings remove concepts or merely shorten formatting/argument wiring; bytes alone do not express line savings.
- Stay on main in the usual project folder for this simplification work; do not create a branch or separate worktree unless the user subsequently requests one.
- CopyLogs success feedback belongs above the stationary button and disappears after three seconds. CopyLogs should be one standalone bottom-right control on Netflix browsing pages, hidden during playback and restored afterward without losing diagnostics. Use a Save As download rather than the clipboard or a local receiver; choosing the repo logs folder once and confirming later saves is acceptable. Keep the normal Firefox download folder unchanged; do not continuously stream. Preserve diagnostic events and final page snapshots across Netflix SPA navigation.
- Prefer compact diagnostic exports and distilled evidence over large title-by-title tables and repetitive event narratives. Preserve diagnostic decisions, distinct outcomes and useful timing evidence; a size target must not discard essential facts. Retain full payload detail as an explicit investigation option.
- Keep retained supporting assessments concise and subordinate to actionable findings; avoid lengthy experiment narratives or repeated rationale.
- For multi-step code reviews, the user prefers a clear ordered plan with progress reported as each step is completed. Prioritize performance and reliability improvements; group related patches when useful and explain when separate steps make more sense.
- For architectural work, the user wants an explicit folder/file layout and understandable responsibility boundaries before implementation, followed by incremental changes. Derive those boundaries from code dependencies, state ownership and lifetimes; frequency of past discussion or prominence in context/findings must not give a feature architectural priority.
- During investigations, proactively propose structural alternatives that remove underlying work or delays, without waiting for the user to suggest them; do not limit ideas to tuning the current approach.
- Performance and reliability patches should include low-cost diagnostic logging or counters that help verify their effect and investigate failures in user-supplied logs, without making normal browsing noisy or expensive. The user explicitly authorizes adding or updating bounded, low-cost diagnostics during investigations when existing logs leave important questions unanswered; do not wait for separate approval to improve those logs.
- On list entry, the user prefers Films selected by default in both the main grid and Watched / Caught up, with independent Films/Series selections for those sections.
- Keep watched movies and caught-up series out of the main browsing grid and in one Watched / Caught up section, collapsed by default; unfinished titles remain in the main grid.
- Viewing completion should allow for skipped end credits. The user accepts 90% playback as a practical completion threshold rather than requiring playback to the end.
- For viewing groups, the user accepts a completed latest episode as a caught-up hint and wants reversible manual choices remembered separately for each Netflix profile. Manual choices take priority over automatic status; a series correction should cover the current episodes and expire when reliable metadata reveals added episodes.
- Marking or reversing a viewing choice should preserve the user's browsing position instead of scrolling to the destination section.
- Dismissing already-watched or unwanted browsing recommendations must preserve Netflix ratings and taste feedback. Load further recommendations in the affected carousel after each dismissal rather than waiting for an empty row or a manual arrow click; preserve the current carousel page and remaining cards while replacing dismissed titles; automatic arrow navigation is unacceptable; watched elsewhere is a valid manual choice.
- Keep browsing actions visible underneath cards, following My List's shared control presentation rather than requiring artwork hover or duplicating its UI implementation.
- Collapse dismissed browsing cards completely so the remaining cards fill their space; restore them through the saved-choices panel rather than leaving Undo placeholders.
- Keep saved browsing dismissals accessible from a right-side panel, grouped by watched and hidden, with small remove icons for quick individual restoration even when the native card is absent.
- Use the same manual viewing choices in browsing and My List: watched films persist, caught-up series cover available episodes and expire when new episodes are detected. Distinguish Films and Series in the saved panel; keep Hide suggestion separate.
- Keep card placement controls to one action between My List and Watched / Caught up. Fold returning to automatic classification into that action when it agrees with the destination; show a small passive marker for active manual placements rather than a separate reset button.
- Known watched/caught-up titles should start in their section on list entry, and newly established viewing results should appear promptly.
- After initial loading, viewing groups should remain stable while browsing; changes should follow explicit viewing actions/refresh, a new list entry, or actual list/profile changes.
- Use Netflix's own hover popups rather than script-rendered replacements. The user prefers the complete native experience even if some hover latency or stuttering remains; a visual approximation is insufficient.
- Hover popups should preserve normal page scrolling and dismiss when the pointer moves away; the user does not want a visible close button.
- If background title-detail loading is considered again, give every title equal priority rather than favoring visible or nearby cards, and retain Netflix's native popup experience. Cached data freshness is less important than preserving that experience.
- The user authorizes the assistant to maintain the editable durable-context sections of this file when lasting repository knowledge or preferences change, following the protected instructions above. Routine maintenance of those sections does not require another permission request.

## Cross-cutting repository knowledge


