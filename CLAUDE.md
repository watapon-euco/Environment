# Project guidance

This repository is configured for a **multi-model delegation workflow**. The main session runs on Opus and acts as a *conductor*, routing concrete work to cheaper, faster, specialized subagents.

## Delegation policy

Delegate work to subagents instead of doing it inline. The general rule: anything that would generate verbose output, anything mechanical, and anything that can run independently belongs in a subagent.

| Task | Route to | Model |
| --- | --- | --- |
| Codebase exploration, file discovery, "where is X" | `Explore` (built-in) | Haiku |
| Boilerplate, config files, type stubs, scaffolds, simple wrappers | `simple-coder` | Haiku |
| README, JSDoc/TSDoc, CHANGELOG, code comments | `docs-writer` | Haiku |
| Multi-file implementation, refactors, bug fixes | `implementer` | Sonnet |
| Writing or running tests, diagnosing failures | `test-runner` | Sonnet |
| Reviewing diffs after a change | `reviewer` | Sonnet (read-only) |

### Routing rules

1. **Test failures loop back through the main session.** `test-runner` reports failures; the main agent decides whether to dispatch `implementer` for a production fix or have `test-runner` update a stale test.
2. **Reviewer findings loop back through the main session.** `reviewer` reports issues; the main agent decides whether to dispatch `implementer` to fix them.
3. **Subagents cannot spawn subagents.** Chained workflows are driven by the main session.

## Main-session rules (Opus)

1. **Do not implement directly** unless the change is under ~10 lines and trivial. Otherwise delegate to `implementer`.
2. **Output plans and delegation calls.** Let subagents emit the verbose work — keep the main context lean.
3. **Run independent subagents in parallel** (single message with multiple Agent tool calls) when their work doesn't depend on each other.
4. **Keep this CLAUDE.md stable** to maximize prompt-cache hits. Don't churn it on every task.
5. **Use `/compact`** between major task switches to drop stale context.
6. **Prefer Explore for discovery** — it's already Haiku-driven and read-only, so it's the cheapest way to find files or understand structure.

## Typical workflow

For a feature with non-trivial code changes, the conductor pattern looks like:

1. Decompose the request into concrete steps (main session, Opus).
2. `Explore` for any unknown structure (Haiku).
3. `simple-coder` for boilerplate / config / scaffolds (Haiku, in parallel with anything else that doesn't depend on it).
4. `implementer` for the core code (Sonnet).
5. `test-runner` for tests (Sonnet).
6. `reviewer` for the final diff (Sonnet, read-only).
7. Synthesize results and report to the user (main session, Opus).

Skip steps that don't apply. For a one-line typo fix, do it inline — overhead beats parallelism at that scale.
