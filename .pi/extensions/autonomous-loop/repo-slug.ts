export interface RepoSlug {
	owner: string;
	repo: string;
	provider: "github" | "gitlab" | "bitbucket" | "github-enterprise" | "unknown";
}

function detectProvider(hostname: string): RepoSlug["provider"] {
	const lower = hostname.toLowerCase();
	if (lower === "github.com") return "github";
	if (lower === "gitlab.com") return "gitlab";
	if (lower === "bitbucket.org") return "bitbucket";
	if (lower.startsWith("github.") || lower.includes("github-enterprise")) return "github-enterprise";
	return "unknown";
}

function isValidSlugPart(part: string): boolean {
	if (!part || part.length === 0) return false;
	// Allow alphanumeric, hyphens, underscores, and dots (for repo names)
	// but not at start/end and no consecutive special chars
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(part) || /^[a-zA-Z0-9]$/.test(part);
}

function normalizeRepoName(name: string): string {
	// Remove .git suffix if present
	return name.replace(/\.git$/i, "");
}

function parsePathSegments(pathname: string): { owner: string; repo: string } | null {
	// Remove leading/trailing slashes and split
	const trimmed = pathname.replace(/^\/+|\/+$/g, "");
	const segments = trimmed.split("/").filter((s) => s.length > 0);

	if (segments.length < 2) return null;

	const owner = segments[0];
	const repo = normalizeRepoName(segments[1]);

	if (!isValidSlugPart(owner) || !isValidSlugPart(repo)) return null;

	return { owner, repo };
}

function parseSshUrl(url: string): RepoSlug | null {
	// SSH format: git@hostname:owner/repo or git@hostname:owner/repo.git
	const sshMatch = /^git@([^:]+):(.+)$/.exec(url);
	if (!sshMatch) return null;

	const hostname = sshMatch[1];
	const path = sshMatch[2];

	const segments = parsePathSegments(path);
	if (!segments) return null;

	return {
		owner: segments.owner,
		repo: segments.repo,
		provider: detectProvider(hostname),
	};
}

function parseHttpsUrl(url: string): RepoSlug | null {
	try {
		const parsed = new URL(url);
		const segments = parsePathSegments(parsed.pathname);
		if (!segments) return null;

		return {
			owner: segments.owner,
			repo: segments.repo,
			provider: detectProvider(parsed.hostname),
		};
	} catch {
		return null;
	}
}

function parseShorthand(input: string): RepoSlug | null {
	// Shorthand format: owner/repo
	if (input.includes(":")) return null;
	if (input.includes("/")) {
		const segments = input.split("/").filter((s) => s.length > 0);
		if (segments.length !== 2) return null;

		const owner = segments[0];
		const repo = normalizeRepoName(segments[1]);

		if (!isValidSlugPart(owner) || !isValidSlugPart(repo)) return null;

		return {
			owner,
			repo,
			provider: "github", // Default to GitHub for shorthand
		};
	}
	return null;
}

/**
 * Parses a repository slug from various input formats.
 * Supports:
 * - HTTPS URLs: https://github.com/owner/repo
 * - SSH URLs: git@github.com:owner/repo
 * - Shorthand: owner/repo (defaults to GitHub)
 *
 * @param input The repository URL or shorthand
 * @returns RepoSlug object or null if invalid
 */
export function parseRepoSlug(input: string): RepoSlug | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// Try SSH format first
	if (trimmed.startsWith("git@")) {
		return parseSshUrl(trimmed);
	}

	// Try HTTPS format
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return parseHttpsUrl(trimmed);
	}

	// Try shorthand format
	return parseShorthand(trimmed);
}
