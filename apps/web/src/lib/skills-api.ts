import { createServerFn } from "@tanstack/react-start";
import type { SkillRow } from "./skills";

const SKILLS_SH_SEARCH = "https://skills.sh/api/search";

interface SkillsShResult {
	id: string;
	skillId: string;
	name: string;
	installs: number;
	source: string;
}

interface SkillsShResponse {
	skills: SkillsShResult[];
	count: number;
}

/** Search skills.sh API and return results in our SkillRow shape. */
export const searchSkillsSh = createServerFn({ method: "GET" })
	.inputValidator((data: { q: string; limit: number }) => data)
	.handler(
		async ({ data }): Promise<{ rows: SkillRow[]; raw: SkillsShResult[] }> => {
			const url = `${SKILLS_SH_SEARCH}?q=${encodeURIComponent(data.q)}&limit=${data.limit}`;
			const resp = await fetch(url);
			if (!resp.ok) {
				return { rows: [], raw: [] };
			}
			const json = (await resp.json()) as SkillsShResponse;
			const raw = json.skills ?? [];
			const rows: SkillRow[] = raw.map((s) => ({
				skillId: s.skillId,
				fullId: s.id,
				source: s.source,
				description: "", // skills.sh doesn't return descriptions
				installs: s.installs,
			}));
			return { rows, raw };
		},
	);
