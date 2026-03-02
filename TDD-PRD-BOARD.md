# Autonomous Agent Build Loop Board

## Objective
Build a hook-enforced autonomous workflow that always executes:

`PRD -> TDD (Red/Green/Refactor in loop) -> Review -> Fix -> Review -> Push`

## Scope (MVP)
- In scope: PRD task decomposition, phase state machine, hook gates, review/fix loops, push gate.
- Out of scope: multi-repo orchestration, parallel subagents, external CI integration.

## Non-Negotiable Gates
- `git push` is blocked until phase is `ready_to_push`.
- A task cannot be marked done without failing-test then passing-test evidence.
- Review findings must be converted into fix tasks before second review.
- Second review must have zero blocking findings.

## State Machine
`idle -> prd_loaded -> tdd_red -> tdd_green -> tdd_refactor -> review_1 -> fix_findings -> review_2 -> ready_to_push -> done`

## Board

### Backlog
- [ ] Define workflow state model and transition reducer
  - Output: `workflow-state.ts`
  - Evidence: transition matrix tests passing
- [ ] Define PRD task schema (task, AC, evidence)
  - Output: `prd-parser.ts` + types
  - Evidence: parser tests with valid/invalid PRD fixtures
- [ ] Define review finding schema (severity, blocker, file refs, fix task link)
  - Output: `review-engine.ts` types
  - Evidence: mapping tests from finding -> fix task

### In Progress
- [ ] Scaffold extension package
  - Output: `.pi/extensions/autonomous-loop/index.ts`
  - Evidence: extension loads with `/reload` and emits startup status
- [ ] Hook wiring
  - Output: `hooks.ts`
  - Events: `session_start`, `before_agent_start`, `tool_call`, `turn_end`, `agent_end`, `session_shutdown`
  - Evidence: integration tests for hook order and state persistence

### TDD Loop (Per Task)
Use this checklist for each decomposed PRD task:
- [ ] **Red**: add or update test to fail first
- [ ] **Green**: minimal implementation to pass
- [ ] **Refactor**: cleanup without behavior change
- [ ] Run check gate (`npm run check`)
- [ ] Capture evidence in task record (test name, command, result)

### Review 1
- [ ] Run review pass and collect findings
- [ ] Classify findings: blocker / non-blocker
- [ ] Auto-generate fix tasks from findings
- [ ] Move workflow phase:
  - if blockers exist -> `fix_findings`
  - else -> `review_2`

### Fix Findings
- [ ] Execute TDD loop for each fix task
- [ ] Close finding with evidence link
- [ ] Re-run `npm run check`
- [ ] Move to `review_2`

### Review 2
- [ ] Run second review pass
- [ ] Verify zero blocking findings
- [ ] Verify all PRD tasks complete with evidence
- [ ] Move to `ready_to_push`

### Ready to Push
- [ ] Confirm clean working tree (except intended files)
- [ ] Confirm checks passed in latest run
- [ ] Confirm gate conditions satisfied
- [ ] Human approval step (optional policy)
- [ ] Allow push

### Done
- [ ] Push completed
- [ ] Final workflow summary emitted
- [ ] Session archived with state snapshot

## Hook Policy Matrix
| Hook | Responsibility | Hard Fail Condition |
|---|---|---|
| `session_start` | Load/init workflow state | Corrupt state and no recovery |
| `before_agent_start` | Inject phase instructions + allowed actions | Missing phase or task context |
| `tool_call` | Enforce command/tool gates | Disallowed action for current phase |
| `turn_end` | Update evidence, mark step completion | Evidence missing for claimed completion |
| `agent_end` | Advance phase or enqueue next action | Invalid transition |
| `session_shutdown` | Persist snapshot + summary | Snapshot write fails |

## Acceptance Criteria
- [ ] Agent cannot bypass ordered phases.
- [ ] Every completed task includes red/green evidence.
- [ ] Push blocked before `ready_to_push`.
- [ ] Restart resumes exact phase/task with no state loss.
- [ ] Review->Fix->Review loop executes deterministically.

## Test Plan
- [ ] Transition reducer tests (valid + invalid transitions)
- [ ] Tool gate tests (`git push`, destructive commands, phase restrictions)
- [ ] PRD parser tests (happy path, malformed markdown, missing AC)
- [ ] Evidence tracker tests (fail/pass/refactor capture)
- [ ] Review loop tests (finding lifecycle)
- [ ] Persistence tests (save/load/restart continuity)
- [ ] End-to-end workflow test (PRD to ready_to_push)

## Risks / Mitigations
- Risk: false-positive evidence detection
  - Mitigation: require explicit test command + result artifact in state
- Risk: model attempts to skip phase
  - Mitigation: hook-level hard blocks + transition reducer checks
- Risk: flaky tests stall loop
  - Mitigation: retry policy + explicit flaky marker + operator intervention command

## Operator Commands (Planned)
- `/workflow status` -> current phase, active task, blockers
- `/workflow advance` -> manual transition (restricted)
- `/workflow reset` -> reset workflow state
- `/workflow findings` -> open findings and linked fix tasks

## Definition of Done
- [ ] All acceptance criteria checked
- [ ] Test plan green
- [ ] Docs updated for setup + operation
- [ ] Workflow can run start-to-finish on a sample PRD
