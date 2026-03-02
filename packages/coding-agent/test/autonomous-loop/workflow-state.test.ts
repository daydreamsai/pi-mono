import { describe, expect, it } from "vitest";
import {
	canTransition,
	createInitialWorkflowState,
	loadPrdTasks,
	markTaskCompletedIfReady,
	recordTaskEvidence,
	transitionPhase,
} from "../../../../.pi/extensions/autonomous-loop/workflow-state.js";

describe("autonomous workflow state", () => {
	it("validates the phase transition matrix", () => {
		expect(canTransition("idle", "prd_loaded")).toBe(true);
		expect(canTransition("prd_loaded", "tdd_red")).toBe(true);
		expect(canTransition("tdd_red", "tdd_green")).toBe(true);
		expect(canTransition("tdd_green", "tdd_refactor")).toBe(true);
		expect(canTransition("tdd_refactor", "review_1")).toBe(true);
		expect(canTransition("review_1", "fix_findings")).toBe(true);
		expect(canTransition("review_1", "review_2")).toBe(true);
		expect(canTransition("review_2", "ready_to_push")).toBe(true);
		expect(canTransition("ready_to_push", "done")).toBe(true);

		expect(canTransition("idle", "tdd_red")).toBe(false);
		expect(canTransition("tdd_red", "review_1")).toBe(false);
		expect(canTransition("done", "idle")).toBe(false);
	});

	it("does not mark task complete without red and green evidence", () => {
		const state = loadPrdTasks(
			createInitialWorkflowState(),
			[
				{
					id: "task-1",
					title: "Implement transition reducer",
					acceptanceCriteria: [],
					expectedEvidence: [],
					section: "Backlog",
				},
			],
			"/tmp/prd.md",
		);
		const red = recordTaskEvidence(transitionPhase(state, "tdd_red"), "task-1", {
			kind: "red",
			command: "vitest reducer.test.ts",
			summary: "failing test",
			passed: false,
			timestamp: Date.now(),
		});
		const completed = markTaskCompletedIfReady(red, "task-1");
		expect(completed.tasks[0]?.completed).toBe(false);
	});

	it("marks task complete when red, green, refactor and check evidence exist", () => {
		const state = loadPrdTasks(
			createInitialWorkflowState(),
			[
				{
					id: "task-1",
					title: "Implement transition reducer",
					acceptanceCriteria: [],
					expectedEvidence: [],
					section: "Backlog",
				},
			],
			"/tmp/prd.md",
		);

		let next = transitionPhase(state, "tdd_red");
		next = recordTaskEvidence(next, "task-1", {
			kind: "red",
			command: "vitest reducer.test.ts",
			summary: "failing test",
			passed: false,
			timestamp: Date.now(),
		});
		next = transitionPhase(next, "tdd_green");
		next = recordTaskEvidence(next, "task-1", {
			kind: "green",
			command: "vitest reducer.test.ts",
			summary: "passing test",
			passed: true,
			timestamp: Date.now(),
		});
		next = transitionPhase(next, "tdd_refactor");
		next = recordTaskEvidence(next, "task-1", {
			kind: "refactor",
			summary: "cleanup complete",
			passed: true,
			timestamp: Date.now(),
		});
		next = recordTaskEvidence(next, "task-1", {
			kind: "check",
			command: "npm run check",
			summary: "all checks pass",
			passed: true,
			timestamp: Date.now(),
		});

		next = markTaskCompletedIfReady(next, "task-1");
		expect(next.tasks[0]?.completed).toBe(true);
	});
});
