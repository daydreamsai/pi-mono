import { describe, expect, it } from "vitest";
import {
	applyFixes,
	createFixTasksFromFindings,
	linkFindingsToFixTasks,
	parseFindingsFromText,
	unresolvedBlockingFindings,
} from "../../../../.pi/extensions/autonomous-loop/review-engine.js";

describe("autonomous review engine", () => {
	it("maps findings to fix tasks", () => {
		const findings = parseFindingsFromText(
			[
				"FINDING|critical|src/workflow-state.ts|Transition allows invalid phase",
				"FINDING|minor|src/hooks.ts|Status message could be clearer",
			].join("\n"),
		);

		const fixTasks = createFixTasksFromFindings(findings);
		const linked = linkFindingsToFixTasks(findings, fixTasks);

		expect(linked).toHaveLength(2);
		expect(fixTasks).toHaveLength(2);
		expect(unresolvedBlockingFindings(linked)).toHaveLength(1);
		expect(linked[0]?.fixTaskId).toBeDefined();
	});

	it("marks findings and fix tasks resolved from FIXED markers", () => {
		const findings = parseFindingsFromText("FINDING|major|src/a.ts|Needs fix");
		const fixTasks = createFixTasksFromFindings(findings);
		const linked = linkFindingsToFixTasks(findings, fixTasks);

		const result = applyFixes(linked, fixTasks, [
			{
				findingId: linked[0]!.id,
				evidence: "Added reducer validation tests and updated reducer.",
			},
		]);

		expect(result.findings[0]?.status).toBe("resolved");
		expect(result.fixTasks[0]?.status).toBe("done");
		expect(unresolvedBlockingFindings(result.findings)).toHaveLength(0);
	});
});
