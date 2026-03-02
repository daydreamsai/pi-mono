export interface ParsedPrdTask {
	id: string;
	title: string;
	acceptanceCriteria: string[];
	expectedEvidence: string[];
	section: string;
}

export interface ParsedPrdDocument {
	tasks: ParsedPrdTask[];
	globalAcceptanceCriteria: string[];
}

export class PrdParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PrdParseError";
	}
}

function normalizeLine(line: string): string {
	return line.replace(/\t/g, "    ");
}

function lineIndent(line: string): number {
	const normalized = normalizeLine(line);
	return normalized.length - normalized.trimStart().length;
}

function isChecklistLine(line: string): boolean {
	return /^\s*-\s+\[(?: |x|X)\]\s+/.test(line);
}

function parseChecklistText(line: string): string {
	return line.replace(/^\s*-\s+\[(?: |x|X)\]\s+/, "").trim();
}

function parseBulletText(line: string): string | undefined {
	const match = /^\s*-\s+(.+)$/.exec(line);
	if (!match) return undefined;
	return match[1].trim();
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function isAcceptanceCriteriaHeading(heading: string): boolean {
	return /^acceptance criteria$/i.test(heading.trim());
}

export function parsePrdMarkdown(markdown: string): ParsedPrdDocument {
	const lines = markdown.split(/\r?\n/);
	const tasks: ParsedPrdTask[] = [];
	const globalAcceptanceCriteria: string[] = [];

	let currentSection = "General";
	let inAcceptanceCriteria = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const headingMatch = /^#{1,6}\s+(.+)$/.exec(line);
		if (headingMatch) {
			currentSection = headingMatch[1].trim();
			inAcceptanceCriteria = isAcceptanceCriteriaHeading(currentSection);
			continue;
		}

		if (!isChecklistLine(line)) continue;

		const text = parseChecklistText(line);
		if (!text) continue;

		if (inAcceptanceCriteria) {
			globalAcceptanceCriteria.push(text);
			continue;
		}

		const parentIndent = lineIndent(line);
		const expectedEvidence: string[] = [];
		const taskAcceptanceCriteria: string[] = [];

		let j = i + 1;
		for (; j < lines.length; j++) {
			const childLine = lines[j];
			if (!childLine.trim()) continue;
			const childIndent = lineIndent(childLine);
			if (childIndent <= parentIndent && isChecklistLine(childLine)) break;
			if (childIndent <= parentIndent && /^#{1,6}\s+/.test(childLine)) break;
			if (childIndent <= parentIndent && parseBulletText(childLine)) break;
			if (childIndent <= parentIndent) break;

			const bullet = parseBulletText(childLine);
			if (!bullet) continue;

			if (/^evidence:/i.test(bullet)) {
				expectedEvidence.push(bullet.replace(/^evidence:\s*/i, "").trim());
				continue;
			}
			if (/^ac:/i.test(bullet)) {
				taskAcceptanceCriteria.push(bullet.replace(/^ac:\s*/i, "").trim());
			}
		}

		const taskId = `${tasks.length + 1}-${slugify(text) || `task-${tasks.length + 1}`}`;
		tasks.push({
			id: taskId,
			title: text,
			acceptanceCriteria: taskAcceptanceCriteria,
			expectedEvidence,
			section: currentSection,
		});
		i = j - 1;
	}

	if (tasks.length === 0) {
		throw new PrdParseError("No checklist tasks found in PRD markdown.");
	}

	const docTasks = tasks.map((task) => ({
		...task,
		acceptanceCriteria: task.acceptanceCriteria.length > 0 ? task.acceptanceCriteria : globalAcceptanceCriteria,
	}));

	return { tasks: docTasks, globalAcceptanceCriteria };
}
