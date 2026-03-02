import type { ParsedPrdTask } from "./prd-parser.js";
import type { FixTask, ReviewFinding } from "./review-engine.js";

export type WorkflowPhase =
	| "idle"
	| "prd_loaded"
	| "tdd_red"
	| "tdd_green"
	| "tdd_refactor"
	| "review_1"
	| "fix_findings"
	| "review_2"
	| "ready_to_push"
	| "done";

export type TaskEvidenceKind = "red" | "green" | "refactor" | "check";

export interface TaskEvidence {
	kind: TaskEvidenceKind;
	command?: string;
	summary: string;
	passed: boolean;
	timestamp: number;
}

export interface WorkflowTask {
	id: string;
	title: string;
	acceptanceCriteria: string[];
	expectedEvidence: string[];
	completed: boolean;
	evidence: Partial<Record<TaskEvidenceKind, TaskEvidence>>;
}

export interface WorkflowGateViolation {
	id: string;
	phase: WorkflowPhase;
	reason: string;
	timestamp: number;
}

export interface WorkflowState {
	version: 1;
	phase: WorkflowPhase;
	prdPath?: string;
	tasks: WorkflowTask[];
	activeTaskId?: string;
	findings: ReviewFinding[];
	fixTasks: FixTask[];
	latestCheckPassed: boolean;
	gateViolations: WorkflowGateViolation[];
	lastUpdatedAt: number;
}

const TRANSITION_MAP: Record<WorkflowPhase, WorkflowPhase[]> = {
	idle: ["prd_loaded"],
	prd_loaded: ["tdd_red", "idle"],
	tdd_red: ["tdd_green", "prd_loaded"],
	tdd_green: ["tdd_refactor", "tdd_red"],
	tdd_refactor: ["tdd_red", "review_1"],
	review_1: ["fix_findings", "review_2"],
	fix_findings: ["review_2"],
	review_2: ["fix_findings", "ready_to_push"],
	ready_to_push: ["done", "fix_findings"],
	done: [],
};

const PHASE_SEQUENCE: WorkflowPhase[] = [
	"idle",
	"prd_loaded",
	"tdd_red",
	"tdd_green",
	"tdd_refactor",
	"review_1",
	"fix_findings",
	"review_2",
	"ready_to_push",
	"done",
];

function now(): number {
	return Date.now();
}

function toWorkflowTask(task: ParsedPrdTask): WorkflowTask {
	return {
		id: task.id,
		title: task.title,
		acceptanceCriteria: task.acceptanceCriteria,
		expectedEvidence: task.expectedEvidence,
		completed: false,
		evidence: {},
	};
}

function hasCoreEvidence(task: WorkflowTask): boolean {
	return Boolean(task.evidence.red && task.evidence.green && task.evidence.refactor);
}

function isTaskDone(task: WorkflowTask): boolean {
	return hasCoreEvidence(task) && task.evidence.check?.passed === true;
}

export function createInitialWorkflowState(): WorkflowState {
	return {
		version: 1,
		phase: "idle",
		tasks: [],
		findings: [],
		fixTasks: [],
		latestCheckPassed: false,
		gateViolations: [],
		lastUpdatedAt: now(),
	};
}

export function cloneWorkflowState(state: WorkflowState): WorkflowState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({ ...task, evidence: { ...task.evidence } })),
		findings: state.findings.map((finding) => ({ ...finding, fileRefs: [...finding.fileRefs] })),
		fixTasks: state.fixTasks.map((task) => ({ ...task })),
		gateViolations: state.gateViolations.map((violation) => ({ ...violation })),
	};
}

export function canTransition(from: WorkflowPhase, to: WorkflowPhase): boolean {
	return TRANSITION_MAP[from].includes(to);
}

export function transitionPhase(state: WorkflowState, to: WorkflowPhase): WorkflowState {
	if (state.phase === to) return state;
	if (!canTransition(state.phase, to)) {
		throw new Error(`Invalid transition: ${state.phase} -> ${to}`);
	}
	return {
		...state,
		phase: to,
		lastUpdatedAt: now(),
	};
}

export function nextPhase(from: WorkflowPhase): WorkflowPhase | undefined {
	const index = PHASE_SEQUENCE.indexOf(from);
	if (index < 0) return undefined;
	return PHASE_SEQUENCE[index + 1];
}

export function loadPrdTasks(state: WorkflowState, tasks: ParsedPrdTask[], prdPath: string): WorkflowState {
	if (tasks.length === 0) {
		throw new Error("Cannot load empty PRD task list.");
	}
	const workflowTasks = tasks.map(toWorkflowTask);
	const nextState = transitionPhase(
		{
			...state,
			prdPath,
			tasks: workflowTasks,
			activeTaskId: workflowTasks[0]?.id,
			findings: [],
			fixTasks: [],
			latestCheckPassed: false,
			gateViolations: [],
		},
		"prd_loaded",
	);
	return nextState;
}

export function getTaskById(state: WorkflowState, taskId: string): WorkflowTask | undefined {
	return state.tasks.find((task) => task.id === taskId);
}

export function getActiveTask(state: WorkflowState): WorkflowTask | undefined {
	if (!state.activeTaskId) return undefined;
	return getTaskById(state, state.activeTaskId);
}

export function setActiveTask(state: WorkflowState, taskId: string | undefined): WorkflowState {
	return {
		...state,
		activeTaskId: taskId,
		lastUpdatedAt: now(),
	};
}

export function recordTaskEvidence(
	state: WorkflowState,
	taskId: string,
	evidence: TaskEvidence,
): WorkflowState {
	const nextTasks = state.tasks.map((task) => {
		if (task.id !== taskId) return task;
		return {
			...task,
			evidence: {
				...task.evidence,
				[evidence.kind]: evidence,
			},
		};
	});

	return {
		...state,
		tasks: nextTasks,
		lastUpdatedAt: now(),
	};
}

export function markCheckResult(state: WorkflowState, passed: boolean): WorkflowState {
	return {
		...state,
		latestCheckPassed: passed,
		lastUpdatedAt: now(),
	};
}

export function markTaskCompletedIfReady(state: WorkflowState, taskId: string): WorkflowState {
	const nextTasks = state.tasks.map((task) => {
		if (task.id !== taskId) return task;
		return {
			...task,
			completed: isTaskDone(task),
		};
	});
	return {
		...state,
		tasks: nextTasks,
		lastUpdatedAt: now(),
	};
}

export function firstIncompleteTask(state: WorkflowState): WorkflowTask | undefined {
	return state.tasks.find((task) => !task.completed);
}

export function allTasksCompleted(state: WorkflowState): boolean {
	return state.tasks.length > 0 && state.tasks.every((task) => task.completed);
}

export function setFindingsAndFixTasks(
	state: WorkflowState,
	findings: ReviewFinding[],
	fixTasks: FixTask[],
): WorkflowState {
	return {
		...state,
		findings,
		fixTasks,
		lastUpdatedAt: now(),
	};
}

export function updateFindingsAndFixTasks(
	state: WorkflowState,
	findings: ReviewFinding[],
	fixTasks: FixTask[],
): WorkflowState {
	return {
		...state,
		findings,
		fixTasks,
		lastUpdatedAt: now(),
	};
}

export function addGateViolation(state: WorkflowState, reason: string): WorkflowState {
	const violation: WorkflowGateViolation = {
		id: `gate-${state.gateViolations.length + 1}-${now()}`,
		phase: state.phase,
		reason,
		timestamp: now(),
	};
	return {
		...state,
		gateViolations: [...state.gateViolations, violation],
		lastUpdatedAt: now(),
	};
}

export function canPush(state: WorkflowState): boolean {
	return state.phase === "ready_to_push" || state.phase === "done";
}

export function canFinalizeReview2(state: WorkflowState): boolean {
	const hasBlockingFindings = state.findings.some((finding) => finding.blocker && finding.status !== "resolved");
	return allTasksCompleted(state) && !hasBlockingFindings;
}

export function sanitizePersistedState(raw: unknown): WorkflowState | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const candidate = raw as Partial<WorkflowState>;
	if (candidate.version !== 1) return undefined;
	if (!candidate.phase || !PHASE_SEQUENCE.includes(candidate.phase)) return undefined;
	if (!Array.isArray(candidate.tasks)) return undefined;
	if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.fixTasks)) return undefined;
	if (!Array.isArray(candidate.gateViolations)) return undefined;

	return {
		version: 1,
		phase: candidate.phase,
		prdPath: candidate.prdPath,
		tasks: candidate.tasks,
		activeTaskId: candidate.activeTaskId,
		findings: candidate.findings,
		fixTasks: candidate.fixTasks,
		latestCheckPassed: Boolean(candidate.latestCheckPassed),
		gateViolations: candidate.gateViolations,
		lastUpdatedAt: typeof candidate.lastUpdatedAt === "number" ? candidate.lastUpdatedAt : now(),
	};
}
