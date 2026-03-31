/**
 * Scrape skills from skills.sh search API and populate the Convex skillsIndex table.
 *
 * Usage:
 *   CONVEX_URL=https://xxx.convex.cloud CONVEX_DEPLOY_KEY=prod:xxx npx tsx scripts/scrape-skills.ts
 *
 * The script:
 * 1. Queries skills.sh/api/search with many search terms to discover skill IDs
 * 2. Deduplicates results
 * 3. Fetches SKILL.md from GitHub raw to extract descriptions
 * 4. Upserts into Convex skillsIndex table via the HTTP API
 */

const SKILLS_SH_SEARCH = "https://skills.sh/api/search";
const CONVEX_URL = process.env.CONVEX_URL;
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

if (!CONVEX_URL || !CONVEX_DEPLOY_KEY) {
	console.error("Set CONVEX_URL and CONVEX_DEPLOY_KEY environment variables");
	process.exit(1);
}

interface SkillsShResult {
	id: string;
	skillId: string;
	name: string;
	installs: number;
	source: string;
}

interface SkillsShResponse {
	query: string;
	skills: SkillsShResult[];
	count: number;
}

// Search terms to maximize coverage — alphabet, common programming terms, etc.
const SEARCH_TERMS = [
	// Single letters
	..."abcdefghijklmnopqrstuvwxyz".split(""),
	// Common programming terms
	"react", "next", "vue", "angular", "svelte", "typescript", "javascript",
	"python", "rust", "go", "java", "ruby", "php", "swift", "kotlin",
	"docker", "kubernetes", "aws", "azure", "gcp", "terraform", "ansible",
	"git", "github", "gitlab", "ci", "cd", "devops", "deploy",
	"test", "testing", "jest", "vitest", "playwright", "cypress",
	"api", "rest", "graphql", "grpc", "websocket",
	"database", "sql", "postgres", "mysql", "mongodb", "redis", "sqlite",
	"auth", "oauth", "jwt", "security", "encryption",
	"css", "tailwind", "sass", "styled", "animation",
	"node", "deno", "bun", "express", "fastapi", "django", "flask",
	"machine", "learning", "ai", "llm", "claude", "openai", "agent",
	"browser", "scrape", "crawl", "automation", "puppeteer",
	"pdf", "excel", "csv", "json", "yaml", "xml", "markdown",
	"debug", "log", "monitor", "observability", "performance",
	"code", "review", "refactor", "lint", "format", "prettier", "eslint",
	"architecture", "design", "pattern", "clean", "solid",
	"mobile", "ios", "android", "flutter", "native",
	"webpack", "vite", "rollup", "esbuild", "turbopack",
	"prisma", "drizzle", "sequelize", "orm",
	"vercel", "netlify", "cloudflare", "supabase", "firebase",
	"stripe", "payment", "email", "notification", "sms",
	"image", "video", "audio", "media", "upload",
	"cache", "queue", "worker", "cron", "scheduler",
	"documentation", "readme", "changelog", "version",
	"error", "handling", "validation", "schema", "zod",
	"state", "redux", "zustand", "jotai", "context",
	"hook", "component", "layout", "routing", "middleware",
	"brainstorm", "plan", "think", "analyze", "best-practices",
	"skill", "prompt", "template", "scaffold", "boilerplate",
	"data", "fetch", "transform", "pipeline", "etl",
	"chart", "graph", "visualization", "dashboard",
	"form", "table", "modal", "toast", "dropdown",
	"i18n", "a11y", "seo", "pwa", "ssr", "ssg",
	"monorepo", "turborepo", "workspace", "package",
	"linux", "bash", "shell", "cli", "terminal",
	"figma", "design-system", "ui", "ux",
	"startup", "saas", "landing", "marketing",
	"blockchain", "web3", "crypto", "solidity",
	"game", "unity", "godot", "three",
	"map", "geo", "location", "gis",
];

async function searchSkillsSh(query: string): Promise<SkillsShResult[]> {
	try {
		const url = `${SKILLS_SH_SEARCH}?q=${encodeURIComponent(query)}&limit=100`;
		const resp = await fetch(url);
		if (!resp.ok) return [];
		const data = (await resp.json()) as SkillsShResponse;
		return data.skills ?? [];
	} catch {
		return [];
	}
}

async function fetchDescription(
	source: string,
	skillId: string,
): Promise<string> {
	const urlsToTry = [
		`https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`,
		`https://raw.githubusercontent.com/${source}/main/.agents/skills/${skillId}/SKILL.md`,
		`https://raw.githubusercontent.com/${source}/main/.claude/skills/${skillId}/SKILL.md`,
	];

	for (const url of urlsToTry) {
		try {
			const resp = await fetch(url);
			if (resp.ok) {
				const text = await resp.text();
				const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
				if (fmMatch) {
					const descMatch = fmMatch[1].match(/description:\s*(.+)/);
					if (descMatch) {
						return descMatch[1].trim().replace(/^["']|["']$/g, "");
					}
				}
				// If no frontmatter description, use first non-heading line
				const lines = text.split("\n").filter(
					(l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"),
				);
				if (lines[0]) return lines[0].trim().slice(0, 200);
			}
		} catch {
			// Try next
		}
	}
	return "";
}

async function upsertToConvex(
	skills: Array<{
		skillId: string;
		fullId: string;
		source: string;
		description: string;
		installs: number;
	}>,
): Promise<number> {
	// Convex mutations have a limit, so batch in chunks of 50
	let totalAdded = 0;
	const chunkSize = 50;

	for (let i = 0; i < skills.length; i += chunkSize) {
		const chunk = skills.slice(i, i + chunkSize);
		try {
			const resp = await fetch(`${CONVEX_URL}/api/mutation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Convex ${CONVEX_DEPLOY_KEY}`,
				},
				body: JSON.stringify({
					path: "skills:upsertSkillsIndexBatch",
					args: { skills: chunk },
					format: "json",
				}),
			});
			if (resp.ok) {
				const data = await resp.json();
				if (i === 0) console.log("  First batch response:", JSON.stringify(data));
				totalAdded += data.value ?? 0;
			} else {
				const text = await resp.text();
				console.error(`Convex upsert failed (${resp.status}): ${text}`);
			}
		} catch (e) {
			console.error("Convex upsert error:", e);
		}
	}
	return totalAdded;
}

async function main() {
	console.log(`Scraping skills.sh with ${SEARCH_TERMS.length} search terms...`);

	const allSkills = new Map<string, SkillsShResult>();

	// Phase 1: Discover skills via search
	for (let i = 0; i < SEARCH_TERMS.length; i++) {
		const term = SEARCH_TERMS[i];
		const results = await searchSkillsSh(term);
		let newCount = 0;
		for (const skill of results) {
			if (!allSkills.has(skill.id)) {
				allSkills.set(skill.id, skill);
				newCount++;
			}
		}
		if (newCount > 0) {
			console.log(
				`[${i + 1}/${SEARCH_TERMS.length}] "${term}" → ${results.length} results, ${newCount} new (total: ${allSkills.size})`,
			);
		}
		// Small delay to avoid rate limiting
		await new Promise((r) => setTimeout(r, 100));
	}

	console.log(`\nDiscovered ${allSkills.size} unique skills. Fetching descriptions...`);

	// Phase 2: Fetch descriptions from GitHub
	const skills = [...allSkills.values()];
	const enriched: Array<{
		skillId: string;
		fullId: string;
		source: string;
		description: string;
		installs: number;
	}> = [];

	const CONCURRENT = 10;
	for (let i = 0; i < skills.length; i += CONCURRENT) {
		const batch = skills.slice(i, i + CONCURRENT);
		const results = await Promise.all(
			batch.map(async (skill) => {
				const desc = await fetchDescription(skill.source, skill.skillId);
				return {
					skillId: skill.skillId,
					fullId: skill.id,
					source: skill.source,
					description: desc,
					installs: skill.installs,
				};
			}),
		);
		enriched.push(...results);

		if ((i + CONCURRENT) % 100 === 0 || i + CONCURRENT >= skills.length) {
			console.log(
				`Fetched descriptions: ${Math.min(i + CONCURRENT, skills.length)}/${skills.length}`,
			);
		}
	}

	console.log(`\nUpserting ${enriched.length} skills to Convex...`);

	// Phase 3: Upsert to Convex
	const added = await upsertToConvex(enriched);
	console.log(`Done! Added ${added} new skills to skillsIndex.`);
}

main().catch(console.error);
