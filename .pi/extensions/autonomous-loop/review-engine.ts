export type ReviewSeverity = "info" | "minor" | "major" | "critical";

export interface ReviewFinding {
	id: string;
	severity: ReviewSeverity;
	blocker: boolean;
	summary: string;
	fileRefs: string[];
	status: "open" | "resolved";
	fixTaskId?: string;
	evidence?: string;
	createdAt: number;
	resolvedAt?: number;
}

export interface FixTask {
	id: string;
	findingId: string;
	title: string;
	blocker: boolean;
	status: "open" | "done";
	evidence?: string;
}

const BLOCKING_SEVERITIES = new Set<ReviewSeverity>(["major", "critical"]);

function normalizeSeverity(value: string): ReviewSeverity | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "info") return "info";
	if (normalized === "minor") return "minor";
	if (normalized === "major") return "major";
	if (normalized === "critical") return "critical";
	if (normalized === "blocker") return "critical";
	return undefined;
}

function normalizeFileRefs(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function escapeId(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

function findingId(index: number, summary: string): string {
	return `finding-${index + 1}-${escapeId(summary) || "item"}`;
}

function fixTaskId(index: number, finding: ReviewFinding): string {
	return `fix-${index + 1}-${escapeId(finding.id)}`;
}

export function parseFindingsFromText(text: string, now: number = Date.now()): ReviewFinding[] {
	const findings: ReviewFinding[] = [];
	const pattern = /^FINDING\|([^|]+)\|([^|]*)\|(.+)$/gim;

	for (const match of text.matchAll(pattern)) {
		const severity = normalizeSeverity(match[1] ?? "");
		const summary = (match[3] ?? "").trim();
		if (!severity || !summary) continue;
		const fileRefs = normalizeFileRefs(match[2] ?? "");
		const blocker = BLOCKING_SEVERITIES.has(severity);
		findings.push({
			id: findingId(findings.length, summary),
			severity,
			blocker,
			summary,
			fileRefs,
			status: "open",
			createdAt: now,
		});
	}

	return findings;
}

export function createFixTasksFromFindings(findings: ReviewFinding[]): FixTask[] {
	const fixTasks: FixTask[] = [];
	for (const finding of findings) {
		if (finding.status === "resolved") continue;
		fixTasks.push({
			id: fixTaskId(fixTasks.length, finding),
			findingId: finding.id,
			title: `Fix: ${finding.summary}`,
			blocker: finding.blocker,
			status: "open",
		});
	}
	return fixTasks;
}

export function linkFindingsToFixTasks(findings: ReviewFinding[], fixTasks: FixTask[]): ReviewFinding[] {
	const byFindingId = new Map<string, FixTask>();
	for (const task of fixTasks) {
		byFindingId.set(task.findingId, task);
	}

	return findings.map((finding) => {
		const task = byFindingId.get(finding.id);
		return {
			...finding,
			fixTaskId: task?.id,
		};
	});
}

export function parseFixedMarkers(text: string): Array<{ findingId: string; evidence: string }> {
	const fixed: Array<{ findingId: string; evidence: string }> = [];
	const pattern = /^FIXED\|([^|]+)\|(.+)$/gim;
	for (const match of text.matchAll(pattern)) {
		const findingId = (match[1] ?? "").trim();
		const evidence = (match[2] ?? "").trim();
		if (!findingId || !evidence) continue;
		fixed.push({ findingId, evidence });
	}
	return fixed;
}

export function applyFixes(
	findings: ReviewFinding[],
	fixTasks: FixTask[],
	fixes: Array<{ findingId: string; evidence: string }>,
	now: number = Date.now(),
): { findings: ReviewFinding[]; fixTasks: FixTask[] } {
	if (fixes.length === 0) {
		return { findings, fixTasks };
	}

	const evidenceByFinding = new Map<string, string>();
	for (const fix of fixes) {
		evidenceByFinding.set(fix.findingId, fix.evidence);
	}

	const nextFindings = findings.map((finding) => {
		const evidence = evidenceByFinding.get(finding.id);
		if (!evidence) return finding;
		return {
			...finding,
			status: "resolved" as const,
			evidence,
			resolvedAt: now,
		};
	});

	const nextFixTasks = fixTasks.map((task) => {
		const evidence = evidenceByFinding.get(task.findingId);
		if (!evidence) return task;
		return {
			...task,
			status: "done" as const,
			evidence,
		};
	});

	return { findings: nextFindings, fixTasks: nextFixTasks };
}

export function unresolvedBlockingFindings(findings: ReviewFinding[]): ReviewFinding[] {
	return findings.filter((finding) => finding.blocker && finding.status !== "resolved");
}
