import { describe, expect, it } from "vitest";
import { PrdParseError, parsePrdMarkdown } from "../../../../.pi/extensions/autonomous-loop/prd-parser.js";

describe("autonomous prd parser", () => {
	it("parses tasks and acceptance criteria", () => {
		const markdown = `# PRD

### Backlog
- [ ] Define workflow state model
  - Evidence: transition tests
- [ ] Hook wiring
  - Evidence: hook integration tests

### Acceptance Criteria
- [ ] push blocked before ready_to_push
- [ ] every task has red/green evidence
`;

		const parsed = parsePrdMarkdown(markdown);
		expect(parsed.tasks).toHaveLength(2);
		expect(parsed.tasks[0]?.title).toContain("Define workflow state model");
		expect(parsed.tasks[0]?.expectedEvidence).toContain("transition tests");
		expect(parsed.tasks[0]?.acceptanceCriteria).toContain("push blocked before ready_to_push");
	});

	it("throws when markdown has no checklist tasks", () => {
		const markdown = "# PRD\n\nNo checklist items.";
		expect(() => parsePrdMarkdown(markdown)).toThrow(PrdParseError);
	});
});
