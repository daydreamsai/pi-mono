import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { PrdParseError, parsePrdMarkdown } from "./prd-parser.js";
import {
	applyFixes,
	createFixTasksFromFindings,
	linkFindingsToFixTasks,
	parseFindingsFromText,
	parseFixedMarkers,
	unresolvedBlockingFindings,
} from "./review-engine.js";
import {
	addGateViolation,
	allTasksCompleted,
	canFinalizeReview2,
	canPush,
	cloneWorkflowState,
	createInitialWorkflowState,
	firstIncompleteTask,
	getActiveTask,
	getTaskById,
	loadPrdTasks,
	markCheckResult,
	markTaskCompletedIfReady,
	nextPhase,
	recordTaskEvidence,
	sanitizePersistedState,
	setActiveTask,
	setFindingsAndFixTasks,
	transitionPhase,
	type TaskEvidence,
	type WorkflowPhase,
	type WorkflowState,
} from "./workflow-state.js";

const STATE_ENTRY_TYPE = "autonomous-loop-state";
const SUMMARY_ENTRY_TYPE = "autonomous-loop-summary";
const CONTEXT_MESSAGE_TYPE = "autonomous-loop-context";
const STATUS_KEY = "autonomous-loop";

const READ_ONLY_PHASES = new Set<WorkflowPhase>(["idle", "prd_loaded", "review_1", "review_2", "ready_to_push", "done"]);

const GIT_PUSH_PATTERN = /(^|\s)git\s+push(\s|$)/i;
const TEST_COMMAND_PATTERN = /(^|\s)(npm\s+test|npx\s+vitest|vitest\b|jest\b|tsx\s+.*vitest)(\s|$)/i;
const CHECK_COMMAND_PATTERN = /(^|\s)npm\s+run\s+check(\s|$)/i;
const MUTATING_COMMAND_PATTERN =
	/(^|\s)(rm\s+-rf|rm\s+|mv\s+|cp\s+|mkdir\s+|touch\s+|git\s+(add|commit|merge|rebase|reset|checkout|clean|push)|npm\s+(install|update|ci)|pnpm\s+(install|add)|yarn\s+(add|install)|chmod\s+|chown\s+)(\s|$)/i;
const HARD_BLOCK_PATTERN = /(^|\s)(git\s+reset\s+--hard|git\s+checkout\s+\.\s*|git\s+clean\s+-fd|rm\s+-rf\s+\/)(\s|$)/i;
const REVIEW2_PASS_PATTERN = /REVIEW2\|PASS/i;
const TASK_DONE_PATTERN = /TASK_DONE\|([a-zA-Z0-9._-]+)/g;
const REFACTOR_DONE_PATTERN = /REFACTOR_DONE(?:\|(.+))?/i;
const MARKDOWN_PATH_PATTERN = /(?:^|\s)(\.{1,2}\/[^\s"'`]+\.md|\/[^\s"'`]+\.md)/g;
const MAX_GENERATED_REQUIREMENTS = 6;

interface PersistedStateEntry {
	type: "custom";
	customType: string;
	data?: unknown;
}

export interface WorkflowController {
	getState(): WorkflowState;
	reset(ctx: ExtensionContext): string;
	status(): string;
	findings(): string;
	advance(targetPhase: string | undefined, ctx: ExtensionContext): string;
	loadPrdFromPath(path: string, ctx: ExtensionContext): Promise<string>;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray((message as AssistantMessage).content);
}

function textFromAssistantMessage(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function extractLatestAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!isAssistantMessage(message)) continue;
		return textFromAssistantMessage(message);
	}
	return "";
}

function extractToolResultText(event: ToolResultEvent): string {
	return event.content
		.filter((item): item is TextContent => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

function toEvidence(kind: TaskEvidence["kind"], command: string | undefined, summary: string, passed: boolean): TaskEvidence {
	return {
		kind,
		command,
		summary: summary.trim().slice(0, 240),
		passed,
		timestamp: Date.now(),
	};
}

function summarizeState(state: WorkflowState): string {
	const activeTask = getActiveTask(state);
	const blockers = unresolvedBlockingFindings(state.findings).length;
	return `phase=${state.phase} task=${activeTask?.id ?? "-"} blockers=${blockers} checks=${state.latestCheckPassed ? "pass" : "fail"}`;
}

function summarizeFinalState(state: WorkflowState): string {
	const completedTasks = state.tasks.filter((task) => task.completed).length;
	const blockers = unresolvedBlockingFindings(state.findings).length;
	return `phase=${state.phase}, completed_tasks=${completedTasks}/${state.tasks.length}, blockers=${blockers}, check_passed=${state.latestCheckPassed}`;
}

function parsePhase(value: string | undefined): WorkflowPhase | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	switch (normalized) {
		case "idle":
		case "prd_loaded":
		case "tdd_red":
		case "tdd_green":
		case "tdd_refactor":
		case "review_1":
		case "fix_findings":
		case "review_2":
		case "ready_to_push":
		case "done":
			return normalized;
		default:
			return undefined;
	}
}

function parsePromptMarkdownPath(prompt: string, cwd: string): string | undefined {
	const candidates: string[] = [];
	for (const match of prompt.matchAll(MARKDOWN_PATH_PATTERN)) {
		const candidate = match[1]?.trim();
		if (!candidate) continue;
		const absolute = candidate.startsWith("/") ? candidate : resolve(cwd, candidate);
		candidates.push(absolute);
	}
	return candidates[0];
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

function normalizeRequirement(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[.;:,!?]+$/g, "");
}

function extractPromptRequirements(prompt: string): string[] {
	const lines = prompt.split(/\r?\n/);
	const requirements: string[] = [];
	const seen = new Set<string>();

	for (const line of lines) {
		const match = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
		if (!match) continue;
		const requirement = normalizeRequirement(match[1] ?? "");
		if (!requirement) continue;
		const key = requirement.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		requirements.push(requirement);
		if (requirements.length >= MAX_GENERATED_REQUIREMENTS) return requirements;
	}

	const sentenceCandidates = prompt
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(" ")
		.split(/[.!?]\s+/)
		.map(normalizeRequirement)
		.filter((line) => line.length >= 12);

	for (const sentence of sentenceCandidates) {
		const key = sentence.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		requirements.push(sentence);
		if (requirements.length >= MAX_GENERATED_REQUIREMENTS) break;
	}

	return requirements;
}

function buildGeneratedPrdMarkdown(prompt: string, requirements: string[]): string {
	const cleanedPrompt = prompt.replace(/\s+/g, " ").trim();
	const objective = cleanedPrompt.length > 0 ? cleanedPrompt.slice(0, 400) : "Solve the requested coding task end-to-end.";
	const scopedRequirements =
		requirements.length > 0
			? requirements
			: ["Implement the requested behavior for this coding task with tests and verification."];

	const backlogLines: string[] = [];
	for (const requirement of scopedRequirements) {
		backlogLines.push(`- [ ] ${requirement}`);
		backlogLines.push(`  - AC: behavior implemented and validated for "${requirement}"`);
		backlogLines.push("  - Evidence: red test command then green test command");
	}

	backlogLines.push("- [ ] Run full project checks");
	backlogLines.push("  - AC: npm run check returns success");
	backlogLines.push("  - Evidence: npm run check output captured");

	const acceptanceLines: string[] = [
		"- [ ] Every completed task has red and green evidence.",
		"- [ ] No blocking findings remain after review_2.",
		"- [ ] git push is attempted only in ready_to_push.",
	];

	return [
		"# Auto-Generated PRD/TDD Board",
		"",
		"## Objective",
		objective,
		"",
		"### Backlog",
		...backlogLines,
		"",
		"### Acceptance Criteria",
		...acceptanceLines,
		"",
	].join("\n");
}

function getGeneratedPrdPath(cwd: string, prompt: string): string {
	const firstLine = prompt
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	const slug = slugify(firstLine ?? "autonomous-task");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return join(cwd, ".context", "autonomous-loop", `${timestamp}-${slug || "task"}.md`);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

function isPersistedStateEntry(entry: unknown): entry is PersistedStateEntry {
	if (!entry || typeof entry !== "object") return false;
	const record = entry as { type?: unknown; customType?: unknown };
	return record.type === "custom" && typeof record.customType === "string";
}

function tddInstruction(state: WorkflowState): string {
	const activeTask = getActiveTask(state);
	if (!activeTask) {
		return "No active task. Move workflow to review_1.";
	}

	if (state.phase === "tdd_red") {
		return `Phase tdd_red for task "${activeTask.title}".
Write or update tests first and run them so they fail.
Do not proceed to implementation until you have a failing test command.`;
	}
	if (state.phase === "tdd_green") {
		return `Phase tdd_green for task "${activeTask.title}".
Implement the minimal fix so the previously failing test now passes.`;
	}
	return `Phase tdd_refactor for task "${activeTask.title}".
Refactor without behavior changes, then run "npm run check".
When done, include "REFACTOR_DONE|short note" in your response.`;
}

function phaseInstruction(state: WorkflowState): string {
	switch (state.phase) {
		case "idle":
			return "Workflow is idle. Load a PRD file to begin.";
		case "prd_loaded":
			return "PRD loaded. Begin the TDD loop with the first task (red phase).";
		case "tdd_red":
		case "tdd_green":
		case "tdd_refactor":
			return tddInstruction(state);
		case "review_1":
			return `Phase review_1.
Run a review and emit findings as lines:
FINDING|severity|file1,file2|summary
Use severity one of: info, minor, major, critical.`;
		case "fix_findings":
			return `Phase fix_findings.
Resolve findings and emit closure lines:
FIXED|finding-id|evidence
After fixes, run npm run check.`;
		case "review_2":
			return `Phase review_2.
Verify zero blocking findings and task evidence completeness.
If everything is clear, emit: REVIEW2|PASS`;
		case "ready_to_push":
			return "Phase ready_to_push. Confirm gates, then run git push.";
		case "done":
			return "Workflow done.";
	}
}

function isMutatingCommand(command: string): boolean {
	return MUTATING_COMMAND_PATTERN.test(command);
}

function persistState(pi: ExtensionAPI, state: WorkflowState): void {
	pi.appendEntry(STATE_ENTRY_TYPE, state);
}

function persistSummary(pi: ExtensionAPI, state: WorkflowState): void {
	pi.appendEntry(SUMMARY_ENTRY_TYPE, {
		summary: summarizeFinalState(state),
		timestamp: Date.now(),
	});
}

function applyTaskCompletion(state: WorkflowState): WorkflowState {
	let next = cloneWorkflowState(state);
	const activeTask = getActiveTask(next);
	if (!activeTask) return next;

	next = markTaskCompletedIfReady(next, activeTask.id);
	const refreshedTask = getTaskById(next, activeTask.id);
	if (!refreshedTask?.completed) return next;

	const nextTask = firstIncompleteTask(next);
	if (nextTask) {
		next = setActiveTask(next, nextTask.id);
		if (next.phase !== "tdd_red") {
			next = transitionPhase(next, "tdd_red");
		}
		return next;
	}

	next = setActiveTask(next, undefined);
	if (next.phase === "tdd_refactor") {
		next = transitionPhase(next, "review_1");
	}
	return next;
}

function checkTaskEvidenceRequirement(state: WorkflowState, taskId: string): boolean {
	const task = getTaskById(state, taskId);
	if (!task) return false;
	return Boolean(task.evidence.red && task.evidence.green);
}

export function registerWorkflowHooks(pi: ExtensionAPI): WorkflowController {
	let state = createInitialWorkflowState();
	const bashCommandsByCallId = new Map<string, string>();

	function setState(next: WorkflowState, ctx?: ExtensionContext, persist: boolean = true): void {
		state = next;
		if (persist) {
			persistState(pi, state);
		}
		if (ctx?.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, summarizeState(state));
		}
	}

	function buildStatusText(): string {
		const activeTask = getActiveTask(state);
		const blockers = unresolvedBlockingFindings(state.findings);
		return [
			`Phase: ${state.phase}`,
			`Active task: ${activeTask ? `${activeTask.id} - ${activeTask.title}` : "(none)"}`,
			`Tasks complete: ${state.tasks.filter((task) => task.completed).length}/${state.tasks.length}`,
			`Blocking findings: ${blockers.length}`,
			`Latest check: ${state.latestCheckPassed ? "pass" : "fail"}`,
		].join("\n");
	}

	function buildFindingsText(): string {
		if (state.findings.length === 0) {
			return "No findings recorded.";
		}
		return state.findings
			.map((finding) => {
				const files = finding.fileRefs.length > 0 ? ` [${finding.fileRefs.join(", ")}]` : "";
				const fix = finding.fixTaskId ? ` -> ${finding.fixTaskId}` : "";
				return `${finding.id} (${finding.severity}${finding.blocker ? ", blocker" : ""}, ${finding.status})${files}: ${finding.summary}${fix}`;
			})
			.join("\n");
	}

	async function loadPrdFromPath(path: string, ctx: ExtensionContext): Promise<string> {
		if (!(await pathExists(path))) {
			return `PRD file not readable: ${path}`;
		}

		let markdown: string;
		try {
			markdown = await readFile(path, "utf8");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `Failed to read PRD: ${message}`;
		}

		try {
			const parsed = parsePrdMarkdown(markdown);
			const loaded = loadPrdTasks(state, parsed.tasks, path);
			setState(loaded, ctx);
			return `Loaded PRD with ${parsed.tasks.length} tasks.`;
		} catch (error) {
			if (error instanceof PrdParseError) {
				return `PRD parse failed: ${error.message}`;
			}
			const message = error instanceof Error ? error.message : String(error);
			return `Failed to load PRD: ${message}`;
		}
	}

	async function generatePrdFromPrompt(prompt: string, ctx: ExtensionContext): Promise<string> {
		const requirements = extractPromptRequirements(prompt);
		const markdown = buildGeneratedPrdMarkdown(prompt, requirements);
		const path = getGeneratedPrdPath(ctx.cwd, prompt);

		try {
			await mkdir(join(ctx.cwd, ".context", "autonomous-loop"), { recursive: true });
			await writeFile(path, markdown, "utf8");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `Failed to generate PRD: ${message}`;
		}

		const loadMessage = await loadPrdFromPath(path, ctx);
		return `${loadMessage} Auto-generated from prompt at ${path}`;
	}

	function reset(ctx: ExtensionContext): string {
		setState(createInitialWorkflowState(), ctx);
		return "Workflow state reset.";
	}

	function advance(targetPhaseValue: string | undefined, ctx: ExtensionContext): string {
		const parsed = parsePhase(targetPhaseValue);
		const destination = parsed ?? nextPhase(state.phase);
		if (!destination) {
			return "No next phase available.";
		}

		if (destination === "ready_to_push") {
			if (!canFinalizeReview2(state)) {
				return "Cannot advance to ready_to_push: unresolved blockers or incomplete tasks.";
			}
			if (!state.latestCheckPassed) {
				return "Cannot advance to ready_to_push: latest npm run check did not pass.";
			}
		}

		if (destination === "review_2") {
			const blockers = unresolvedBlockingFindings(state.findings);
			if (blockers.length > 0) {
				return "Cannot advance to review_2: blocking findings remain unresolved.";
			}
		}

		try {
			setState(transitionPhase(state, destination), ctx);
			return `Workflow advanced to ${destination}.`;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `Advance failed: ${message}`;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (!isPersistedStateEntry(entry)) continue;
			if (entry.customType !== STATE_ENTRY_TYPE) continue;
			const restored = sanitizePersistedState(entry.data);
			if (!restored) continue;
			setState(restored, ctx, false);
			break;
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Autonomous loop loaded (${state.phase})`, "info");
			ctx.ui.setStatus(STATUS_KEY, summarizeState(state));
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (state.phase === "idle") {
			const prdPath = parsePromptMarkdownPath(event.prompt, ctx.cwd);
			if (prdPath) {
				const message = await loadPrdFromPath(prdPath, ctx);
				if (ctx.hasUI) {
					ctx.ui.notify(message, /failed|not readable/i.test(message) ? "warning" : "info");
				}
			} else {
				const message = await generatePrdFromPrompt(event.prompt, ctx);
				if (ctx.hasUI) {
					ctx.ui.notify(message, /failed|parse failed/i.test(message) ? "warning" : "info");
				}
			}
		}

		if (state.phase === "prd_loaded" && state.tasks.length > 0) {
			try {
				const next = transitionPhase(state, "tdd_red");
				setState(next, ctx);
				if (ctx.hasUI) {
					ctx.ui.notify("Autonomous loop advanced to tdd_red.", "info");
				}
			} catch {
				// Keep current phase if transition is invalid.
			}
		}

		const instruction = phaseInstruction(state);
		const activeTask = getActiveTask(state);
		const taskText = activeTask ? `\nActive task: ${activeTask.id} - ${activeTask.title}` : "";

		return {
			message: {
				customType: CONTEXT_MESSAGE_TYPE,
				content: `[AUTONOMOUS WORKFLOW]\nPhase: ${state.phase}${taskText}\n${instruction}`,
				display: false,
			},
		};
	});

	pi.on("tool_call", async (event: ToolCallEvent) => {
		if (event.toolName === "write" || event.toolName === "edit") {
			if (READ_ONLY_PHASES.has(state.phase)) {
				return {
					block: true,
					reason: `Phase ${state.phase} is read-only. Editing is only allowed in tdd_* and fix_findings phases.`,
				};
			}
		}

		if (event.toolName !== "bash") return;
		const command = typeof event.input.command === "string" ? event.input.command : "";
		bashCommandsByCallId.set(event.toolCallId, command);

		if (GIT_PUSH_PATTERN.test(command) && !canPush(state)) {
			return {
				block: true,
				reason: `git push blocked: phase is ${state.phase}, required phase is ready_to_push.`,
			};
		}

		if (HARD_BLOCK_PATTERN.test(command)) {
			return {
				block: true,
				reason: "Destructive command blocked by autonomous workflow safety gate.",
			};
		}

		if (READ_ONLY_PHASES.has(state.phase) && isMutatingCommand(command)) {
			return {
				block: true,
				reason: `Mutating command blocked in phase ${state.phase}.`,
			};
		}
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
		if (event.toolName === "edit" || event.toolName === "write") {
			if (state.phase === "tdd_refactor") {
				const activeTask = getActiveTask(state);
				if (activeTask) {
					const next = recordTaskEvidence(
						state,
						activeTask.id,
						toEvidence("refactor", undefined, "Refactor edits applied.", true),
					);
					setState(next, ctx);
				}
			}
			return;
		}

		if (event.toolName !== "bash") return;

		const command = bashCommandsByCallId.get(event.toolCallId);
		bashCommandsByCallId.delete(event.toolCallId);
		const output = extractToolResultText(event);

		if (!command) return;

		if (CHECK_COMMAND_PATTERN.test(command)) {
			let next = markCheckResult(state, !event.isError);
			if (state.phase === "tdd_refactor") {
				const activeTask = getActiveTask(next);
				if (activeTask) {
					next = recordTaskEvidence(
						next,
						activeTask.id,
						toEvidence("check", command, output || "npm run check", !event.isError),
					);
					next = applyTaskCompletion(next);
				}
			}
			setState(next, ctx);
		}

		if (TEST_COMMAND_PATTERN.test(command)) {
			const activeTask = getActiveTask(state);
			if (!activeTask) return;

			if (state.phase === "tdd_red" && event.isError) {
				let next = recordTaskEvidence(
					state,
					activeTask.id,
					toEvidence("red", command, output || "Failing test observed.", false),
				);
				next = transitionPhase(next, "tdd_green");
				setState(next, ctx);
				return;
			}

			if (state.phase === "tdd_green" && !event.isError) {
				let next = recordTaskEvidence(
					state,
					activeTask.id,
					toEvidence("green", command, output || "Passing test observed.", true),
				);
				next = transitionPhase(next, "tdd_refactor");
				setState(next, ctx);
			}
		}

		if (GIT_PUSH_PATTERN.test(command) && !event.isError && canPush(state)) {
			if (state.phase === "ready_to_push") {
				const next = transitionPhase(state, "done");
				setState(next, ctx);
			}
		}
	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
		if (!isAssistantMessage(event.message)) return;
		const assistantText = textFromAssistantMessage(event.message);

		let next = state;
		for (const match of assistantText.matchAll(TASK_DONE_PATTERN)) {
			const taskId = match[1];
			if (!taskId) continue;
			if (!checkTaskEvidenceRequirement(next, taskId)) {
				next = addGateViolation(next, `TASK_DONE claim without red/green evidence for task ${taskId}.`);
			}
		}

		const refactorMarker = assistantText.match(REFACTOR_DONE_PATTERN);
		if (refactorMarker && next.phase === "tdd_refactor") {
			const activeTask = getActiveTask(next);
			if (activeTask) {
				const note = refactorMarker[1]?.trim() || "Refactor acknowledged.";
				next = recordTaskEvidence(next, activeTask.id, toEvidence("refactor", undefined, note, true));
			}
		}

		if (next !== state) {
			setState(next, ctx);
		}
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
		const assistantText = extractLatestAssistantText(event.messages);
		let next = state;

		if (next.phase === "prd_loaded" && next.tasks.length > 0) {
			next = transitionPhase(next, "tdd_red");
		}

		if (next.phase === "review_1") {
			const parsedFindings = parseFindingsFromText(assistantText, Date.now());
			const fixTasks = createFixTasksFromFindings(parsedFindings);
			const linkedFindings = linkFindingsToFixTasks(parsedFindings, fixTasks);
			next = setFindingsAndFixTasks(next, linkedFindings, fixTasks);
			if (unresolvedBlockingFindings(next.findings).length > 0) {
				next = transitionPhase(next, "fix_findings");
			} else {
				next = transitionPhase(next, "review_2");
			}
		}

		if (next.phase === "fix_findings") {
			const fixes = parseFixedMarkers(assistantText);
			if (fixes.length > 0) {
				const applied = applyFixes(next.findings, next.fixTasks, fixes, Date.now());
				next = setFindingsAndFixTasks(next, applied.findings, applied.fixTasks);
			}

			const openBlockers = unresolvedBlockingFindings(next.findings);
			if (openBlockers.length === 0 && next.latestCheckPassed) {
				next = transitionPhase(next, "review_2");
			}
		}

		if (next.phase === "review_2" && REVIEW2_PASS_PATTERN.test(assistantText)) {
			if (canFinalizeReview2(next) && next.latestCheckPassed) {
				next = transitionPhase(next, "ready_to_push");
			} else {
				next = addGateViolation(
					next,
					"REVIEW2|PASS received but blockers/tasks/check gate not satisfied.",
				);
			}
		}

		if (next !== state) {
			setState(next, ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		persistState(pi, state);
		persistSummary(pi, state);
		if (ctx.hasUI) {
			ctx.ui.notify(`Autonomous loop snapshot saved (${state.phase})`, "info");
		}
	});

	return {
		getState: () => state,
		reset,
		status: buildStatusText,
		findings: buildFindingsText,
		advance,
		loadPrdFromPath,
	};
}
