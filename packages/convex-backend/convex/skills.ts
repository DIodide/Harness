import { v } from "convex/values";
import {
	action,
	internalMutation,
	internalQuery,
	query,
} from "./_generated/server";
import { internal } from "./_generated/api";

// ── skillDetails (full SKILL.md content, cached) ────────────────────

export const getByName = query({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
	},
});

export const getByNames = query({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const results = await Promise.all(
			args.names.map((name) =>
				ctx.db
					.query("skillDetails")
					.withIndex("by_name", (q) => q.eq("name", name))
					.first(),
			),
		);
		return results.filter(Boolean);
	},
});

export const upsertSkillDetail = internalMutation({
	args: {
		name: v.string(),
		skillName: v.string(),
		description: v.string(),
		detail: v.string(),
		code: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				skillName: args.skillName,
				description: args.description,
				detail: args.detail,
				code: args.code,
			});
			return existing._id;
		}
		return await ctx.db.insert("skillDetails", args);
	},
});

// ── skillsIndex (browseable catalog) ────────────────────────────────

export const browseSkills = query({
	args: {
		cursor: v.union(v.string(), v.null()),
		numItems: v.number(),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("skillsIndex")
			.withIndex("by_installs")
			.order("desc")
			.paginate({ cursor: args.cursor, numItems: args.numItems });
	},
});

export const searchSkillsIndex = query({
	args: { query: v.string(), limit: v.number() },
	handler: async (ctx, args) => {
		// Search both skillId and description indexes in parallel
		const [byName, byDescription] = await Promise.all([
			ctx.db
				.query("skillsIndex")
				.withSearchIndex("search_skills", (q) =>
					q.search("skillId", args.query),
				)
				.take(args.limit),
			ctx.db
				.query("skillsIndex")
				.withSearchIndex("search_skills_description", (q) =>
					q.search("description", args.query),
				)
				.take(args.limit),
		]);

		// Merge and deduplicate, preferring name matches (listed first)
		const seen = new Set<string>();
		const merged = [];
		for (const doc of [...byName, ...byDescription]) {
			if (!seen.has(doc.fullId)) {
				seen.add(doc.fullId);
				merged.push(doc);
			}
		}
		return merged.slice(0, args.limit);
	},
});


/** Upsert a batch of skills discovered from skills.sh search API */
export const upsertSkillsIndexBatch = internalMutation({
	args: {
		skills: v.array(
			v.object({
				skillId: v.string(),
				fullId: v.string(),
				source: v.string(),
				description: v.string(),
				installs: v.number(),
			}),
		),
	},
	handler: async (ctx, args) => {
		let added = 0;
		for (const skill of args.skills) {
			const existing = await ctx.db
				.query("skillsIndex")
				.withIndex("by_fullId", (q) => q.eq("fullId", skill.fullId))
				.first();
			if (existing) {
				// Update installs count if changed
				if (existing.installs !== skill.installs) {
					await ctx.db.patch(existing._id, { installs: skill.installs });
				}
			} else {
				await ctx.db.insert("skillsIndex", skill);
				added++;
			}
		}
		return added;
	},
});

/** Check which fullIds already exist in the index */
export const checkExistingSkills = internalQuery({
	args: { fullIds: v.array(v.string()) },
	handler: async (ctx, args) => {
		const results = await Promise.all(
			args.fullIds.map(async (fullId) => {
				const doc = await ctx.db
					.query("skillsIndex")
					.withIndex("by_fullId", (q) => q.eq("fullId", fullId))
					.first();
				return doc ? fullId : null;
			}),
		);
		return results.filter((id): id is string => id !== null);
	},
});

/**
 * Try to fetch SKILL.md from GitHub for a given source/skillId.
 *
 * Resolution strategy (each step tried with both main & master branches):
 * 1. Direct raw paths: skills/, .agents/skills/, .claude/skills/, repo-root
 * 2. GitHub repo tree API to find SKILL.md anywhere (handles non-standard dirs)
 *
 * When the original source fails entirely, we attempt:
 * 3. GitHub API repo resolution (handles org renames like inferen-sh → inference-sh)
 * 4. skills.sh search API to discover the correct/current source
 */

/** Normalize a skillId for fuzzy directory matching (colons → hyphens, lowercase). */
function normalizeSkillId(id: string): string {
	return id.replace(/:/g, "-").toLowerCase();
}

/** Build GitHub API headers, including auth token if available. */
function ghApiHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github.v3+json",
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) {
		headers.Authorization = `token ${token}`;
	}
	return headers;
}

/** Build headers for raw.githubusercontent.com requests (auth only). */
function ghRawHeaders(): Record<string, string> | undefined {
	const token = process.env.GITHUB_TOKEN;
	if (token) {
		return { Authorization: `token ${token}` };
	}
	return undefined;
}

/** Resolve the canonical owner/repo via GitHub API (follows renames/redirects). */
async function resolveGitHubRepo(source: string): Promise<string | null> {
	try {
		const resp = await fetch(`https://api.github.com/repos/${source}`, {
			headers: ghApiHeaders(),
		});
		if (resp.ok) {
			const data = (await resp.json()) as { full_name?: string };
			return data.full_name ?? null;
		}
	} catch {
		// resolve failed
	}
	return null;
}

/** Query skills.sh search API to find the correct source for a skill ID. */
async function searchSkillsSh(skillId: string): Promise<string | null> {
	try {
		const resp = await fetch(
			`https://skills.sh/api/search?q=${encodeURIComponent(skillId)}&limit=20`,
		);
		if (!resp.ok) return null;
		const data = (await resp.json()) as {
			skills: Array<{ skillId: string; source: string }>;
		};
		const normalized = normalizeSkillId(skillId);
		// Exact match first
		for (const s of data.skills ?? []) {
			if (s.skillId === skillId) return s.source;
		}
		// Fuzzy normalized match
		for (const s of data.skills ?? []) {
			if (normalizeSkillId(s.skillId) === normalized) return s.source;
		}
	} catch {
		// search failed
	}
	return null;
}

/**
 * Try to fetch SKILL.md from a specific repo, trying both main and master
 * branches, direct paths, and full tree search.
 */
async function fetchSkillMdFromRepo(
	source: string,
	skillId: string,
): Promise<string | null> {
	const bases = ["skills", ".agents/skills", ".claude/skills"];
	const ghApi = "https://api.github.com";
	const ghRaw = "https://raw.githubusercontent.com";
	const rawHeaders = ghRawHeaders();
	const normalizedId = normalizeSkillId(skillId);
	const branches = ["main", "master"];

	const idsToTry = [skillId, ...(normalizedId !== skillId ? [normalizedId] : [])];

	// 1. Try direct paths (both branches)
	for (const branch of branches) {
		for (const id of idsToTry) {
			for (const base of bases) {
				try {
					const resp = await fetch(
						`${ghRaw}/${source}/${branch}/${base}/${id}/SKILL.md`,
						rawHeaders ? { headers: rawHeaders } : undefined,
					);
					if (resp.ok) return await resp.text();
				} catch {
					// Try next
				}
			}
		}

		// 2. Try repo-root SKILL.md
		try {
			const resp = await fetch(
				`${ghRaw}/${source}/${branch}/SKILL.md`,
				rawHeaders ? { headers: rawHeaders } : undefined,
			);
			if (resp.ok) return await resp.text();
		} catch {
			// Continue
		}
	}

	// 3. Use the repo tree API to find SKILL.md anywhere
	for (const branch of branches) {
		try {
			const resp = await fetch(
				`${ghApi}/repos/${source}/git/trees/${branch}?recursive=1`,
				{ headers: ghApiHeaders() },
			);
			if (!resp.ok) continue;

			const data = (await resp.json()) as {
				tree: Array<{ path: string; type: string }>;
			};
			const skillFiles = data.tree
				.filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
				.map((e) => e.path);

			if (skillFiles.length === 0) continue;

			// Exact dir name match first, then fuzzy
			const match =
				skillFiles.find((p) => {
					const dir = p.split("/").slice(-2, -1)[0];
					return dir === skillId || dir === normalizedId;
				}) ??
				skillFiles.find((p) => {
					const dir = p.split("/").slice(-2, -1)[0] ?? "";
					const normDir = dir.toLowerCase();
					return (
						normalizedId.includes(normDir) ||
						normDir.includes(normalizedId)
					);
				});

			if (match) {
				const mdResp = await fetch(
					`${ghRaw}/${source}/${branch}/${match}`,
					rawHeaders ? { headers: rawHeaders } : undefined,
				);
				if (mdResp.ok) return await mdResp.text();
			}

			// Check for a shallow SKILL.md (e.g. skill/SKILL.md at repo root)
			const rootSkillMd = skillFiles.find(
				(p) => p.split("/").length <= 2,
			);
			if (rootSkillMd) {
				const mdResp = await fetch(
					`${ghRaw}/${source}/${branch}/${rootSkillMd}`,
					rawHeaders ? { headers: rawHeaders } : undefined,
				);
				if (mdResp.ok) return await mdResp.text();
			}
		} catch {
			// Tree fetch failed, try next branch
		}
	}

	return null;
}

/**
 * Robust SKILL.md fetcher: tries the original source, then resolves via
 * GitHub API (org renames) and skills.sh (wrong/stale source paths).
 */
async function fetchSkillMd(
	source: string,
	skillId: string,
): Promise<string | null> {
	const sourcesTried = new Set<string>();

	// Attempt 1: original source
	sourcesTried.add(source);
	const direct = await fetchSkillMdFromRepo(source, skillId);
	if (direct) return direct;

	// Attempt 2: resolve via GitHub API (handles org renames)
	const resolved = await resolveGitHubRepo(source);
	if (resolved && !sourcesTried.has(resolved)) {
		sourcesTried.add(resolved);
		const fromResolved = await fetchSkillMdFromRepo(resolved, skillId);
		if (fromResolved) return fromResolved;
	}

	// Attempt 3: ask skills.sh for the correct source
	const shSource = await searchSkillsSh(skillId);
	if (shSource && !sourcesTried.has(shSource)) {
		sourcesTried.add(shSource);
		const fromSh = await fetchSkillMdFromRepo(shSource, skillId);
		if (fromSh) return fromSh;

		// The skills.sh source might also need GitHub resolution
		const shResolved = await resolveGitHubRepo(shSource);
		if (shResolved && !sourcesTried.has(shResolved)) {
			sourcesTried.add(shResolved);
			const fromShResolved = await fetchSkillMdFromRepo(shResolved, skillId);
			if (fromShResolved) return fromShResolved;
		}
	}

	return null;
}

/**
 * Background action called after saving a harness.
 * Fetches SKILL.md content from GitHub and caches in skillDetails.
 */
export const ensureSkillDetails = action({
	args: { names: v.array(v.string()) },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");

		const CONCURRENCY = 3;

		async function processSkill(name: string) {
			const existing = await ctx.runQuery(internal.skills.getDetailByName, {
				name,
			});
			if (existing?.detail) return;

			// Look up the authoritative source from skillsIndex first,
			// falling back to splitting the fullId (which can be wrong for
			// skills whose fullId has more than 3 segments).
			const indexSource = await ctx.runQuery(
				internal.skills.getSkillSource,
				{ fullId: name },
			);

			let source: string;
			let skillId: string;
			if (indexSource) {
				source = indexSource;
				// skillId is the portion of fullId after the source prefix
				skillId = name.startsWith(source + "/")
					? name.slice(source.length + 1)
					: name.split("/").pop() ?? name;
			} else {
				const parts = name.split("/");
				skillId = parts.pop() ?? name;
				source = parts.join("/");
			}

			if (!source) return;

			const detail = await fetchSkillMd(source, skillId);
			if (!detail) return;

			let description = "";
			const fmMatch = detail.match(/^---\s*\n([\s\S]*?)\n---/);
			if (fmMatch) {
				const descMatch = fmMatch[1].match(/description:\s*(.+)/);
				if (descMatch) {
					description = descMatch[1].trim().replace(/^["']|["']$/g, "");
				}
			}

			await ctx.runMutation(internal.skills.upsertSkillDetail, {
				name,
				skillName: skillId,
				description,
				detail,
				code: `npx skills add https://github.com/${source} --skill ${skillId}`,
			});
		}

		// Process in bounded-concurrency batches
		for (let i = 0; i < args.names.length; i += CONCURRENCY) {
			const batch = args.names.slice(i, i + CONCURRENCY);
			await Promise.all(batch.map(processSkill));
		}
	},
});

/** Internal query used by ensureSkillDetails to check cache */
export const getDetailByName = internalQuery({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("skillDetails")
			.withIndex("by_name", (q) => q.eq("name", args.name))
			.first();
	},
});

/** Look up a skill's source from the skillsIndex by its fullId. */
export const getSkillSource = internalQuery({
	args: { fullId: v.string() },
	handler: async (ctx, args) => {
		const doc = await ctx.db
			.query("skillsIndex")
			.withIndex("by_fullId", (q) => q.eq("fullId", args.fullId))
			.first();
		return doc?.source ?? null;
	},
});

/**
 * Action to discover and upsert new skills from skills.sh search API.
 * Called from the frontend when search returns results not in our index.
 */
export const discoverSkillsFromSearch = action({
	args: {
		skills: v.array(
			v.object({
				skillId: v.string(),
				fullId: v.string(),
				source: v.string(),
				installs: v.number(),
			}),
		),
	},
	handler: async (ctx, args): Promise<number> => {

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthenticated");
		// Check which ones we already have
		const fullIds = args.skills.map((s) => s.fullId);
		const existingIds = await ctx.runQuery(
			internal.skills.checkExistingSkills,
			{ fullIds },
		);
		const existingSet = new Set(existingIds);

		const newSkills = args.skills.filter(
			(s) => !existingSet.has(s.fullId),
		);
		if (newSkills.length === 0) return 0;

		// Just insert index entries with empty descriptions — SKILL.md fetching
		// is deferred to ensureSkillDetails (fires after harness save) to avoid
		// hammering GitHub with potentially hundreds of unauthenticated requests.
		const toUpsert = newSkills.map((skill) => ({
			skillId: skill.skillId,
			fullId: skill.fullId,
			source: skill.source,
			description: "",
			installs: skill.installs,
		}));

		return await ctx.runMutation(internal.skills.upsertSkillsIndexBatch, {
			skills: toUpsert,
		});
	},
});
