import { describe, expect, it } from "vitest";
import { parseRepoSlug, type RepoSlug } from "./repo-slug.js";

describe("parseRepoSlug", () => {
	describe("valid GitHub HTTPS URLs", () => {
		it("should parse https://github.com/owner/repo", () => {
			const result = parseRepoSlug("https://github.com/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should parse https://github.com/owner/repo.git", () => {
			const result = parseRepoSlug("https://github.com/owner/repo.git");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should parse https://github.com/owner/repo/", () => {
			const result = parseRepoSlug("https://github.com/owner/repo/");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should parse https://github.com/owner/repo.git/", () => {
			const result = parseRepoSlug("https://github.com/owner/repo.git/");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});
	});

	describe("valid GitHub SSH URLs", () => {
		it("should parse git@github.com:owner/repo", () => {
			const result = parseRepoSlug("git@github.com:owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should parse git@github.com:owner/repo.git", () => {
			const result = parseRepoSlug("git@github.com:owner/repo.git");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});
	});

	describe("valid GitLab URLs", () => {
		it("should parse https://gitlab.com/owner/repo", () => {
			const result = parseRepoSlug("https://gitlab.com/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "gitlab" });
		});

		it("should parse git@gitlab.com:owner/repo.git", () => {
			const result = parseRepoSlug("git@gitlab.com:owner/repo.git");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "gitlab" });
		});
	});

	describe("valid Bitbucket URLs", () => {
		it("should parse https://bitbucket.org/owner/repo", () => {
			const result = parseRepoSlug("https://bitbucket.org/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "bitbucket" });
		});

		it("should parse git@bitbucket.org:owner/repo.git", () => {
			const result = parseRepoSlug("git@bitbucket.org:owner/repo.git");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "bitbucket" });
		});
	});

	describe("owner/repo shorthand", () => {
		it("should parse owner/repo", () => {
			const result = parseRepoSlug("owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should parse owner/repo with hyphens and underscores", () => {
			const result = parseRepoSlug("my-org/my_repo");
			expect(result).toEqual({ owner: "my-org", repo: "my_repo", provider: "github" });
		});
	});

	describe("self-hosted GitHub Enterprise URLs", () => {
		it("should parse https://github.company.com/owner/repo", () => {
			const result = parseRepoSlug("https://github.company.com/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github-enterprise" });
		});

		it("should parse https://git.example.org/owner/repo", () => {
			const result = parseRepoSlug("https://git.example.org/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "unknown" });
		});
	});

	describe("invalid inputs", () => {
		it("should return null for empty string", () => {
			const result = parseRepoSlug("");
			expect(result).toBeNull();
		});

		it("should return null for whitespace only", () => {
			const result = parseRepoSlug("   ");
			expect(result).toBeNull();
		});

		it("should return null for missing owner", () => {
			const result = parseRepoSlug("/repo");
			expect(result).toBeNull();
		});

		it("should return null for missing repo", () => {
			const result = parseRepoSlug("owner/");
			expect(result).toBeNull();
		});

		it("should return null for single word", () => {
			const result = parseRepoSlug("repo");
			expect(result).toBeNull();
		});

		it("should return null for URLs without owner/repo structure", () => {
			const result = parseRepoSlug("https://github.com/");
			expect(result).toBeNull();
		});

		it("should return null for too many path segments", () => {
			const result = parseRepoSlug("owner/repo/extra");
			expect(result).toBeNull();
		});

		it("should return null for invalid characters in owner", () => {
			const result = parseRepoSlug("owner@invalid/repo");
			expect(result).toBeNull();
		});

		it("should return null for invalid characters in repo", () => {
			const result = parseRepoSlug("owner/repo@invalid");
			expect(result).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should handle URLs with username in HTTPS", () => {
			const result = parseRepoSlug("https://user@github.com/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should handle URLs with port", () => {
			const result = parseRepoSlug("https://github.com:8443/owner/repo");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should handle URLs with query strings", () => {
			const result = parseRepoSlug("https://github.com/owner/repo?tab=readme");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});

		it("should handle URLs with fragments", () => {
			const result = parseRepoSlug("https://github.com/owner/repo#readme");
			expect(result).toEqual({ owner: "owner", repo: "repo", provider: "github" });
		});
	});
});
