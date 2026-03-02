# Autonomous Loop Extension

Hook-enforced workflow for:

`PRD -> TDD (red/green/refactor) -> review_1 -> fix_findings -> review_2 -> ready_to_push -> done`

## Commands

- `/workflow status`
- `/workflow advance [phase]`
- `/workflow reset`
- `/workflow findings`
- `/workflow load <path-to-prd.md>`

## Single-Turn Autonomy

- If a prompt includes a `.md` path, the extension loads that PRD automatically.
- If no PRD path is provided, the extension auto-generates a PRD/TDD board from the prompt into `.context/autonomous-loop/*.md` and loads it.
- After loading, the workflow auto-advances from `prd_loaded` to `tdd_red` in the same turn, so coding can start immediately.

## Review/Fix Protocol

In `review_1`, output findings as:

`FINDING|severity|file1,file2|summary`

In `fix_findings`, close findings as:

`FIXED|finding-id|evidence`

In `review_2`, output:

`REVIEW2|PASS`

## Key Gates

- `git push` blocked unless phase is `ready_to_push` (or `done`).
- Read-only phases block `write/edit` and mutating bash commands.
- Task completion requires red + green + refactor + check evidence.
