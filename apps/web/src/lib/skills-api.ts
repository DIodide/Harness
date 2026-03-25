import { createServerFn } from "@tanstack/react-start";
import type { SkillsResponse } from "./skills";

const HF_DATASET = "tickleliu/all-skills-from-skills-sh";
const HF_BASE = "https://datasets-server.huggingface.co";
const HF_COMMON_PARAMS = `dataset=${HF_DATASET}&config=default&split=train`;

function stripDetail(entry: Record<string, unknown>): {
	name: string;
	skill_name: string;
	description: string;
	code: string;
} {
	const row = (entry.row ?? entry) as Record<string, unknown>;
	return {
		name: (row.name as string) ?? "",
		skill_name: (row.skill_name as string) ?? "",
		description: (row.description as string) ?? "",
		code: (row.code as string) ?? "",
	};
}

export const fetchSkills = createServerFn({ method: "GET" })
	.inputValidator((data: { offset: number; limit: number }) => data)
	.handler(async ({ data }): Promise<SkillsResponse> => {
		const url = `${HF_BASE}/rows?${HF_COMMON_PARAMS}&offset=${data.offset}&length=${data.limit}`;
		const resp = await fetch(url);
		if (!resp.ok) {
			throw new Error(`HuggingFace /rows returned ${resp.status}`);
		}
		const json = await resp.json();
		return {
			rows: (json.rows ?? []).map(stripDetail),
			total: json.num_rows_total ?? 0,
			offset: data.offset,
			limit: data.limit,
		};
	});

export const searchSkills = createServerFn({ method: "GET" })
	.inputValidator((data: { q: string; offset: number; limit: number }) => data)
	.handler(async ({ data }): Promise<SkillsResponse> => {
		const url = `${HF_BASE}/search?${HF_COMMON_PARAMS}&query=${encodeURIComponent(data.q)}&offset=${data.offset}&length=${data.limit}`;
		const resp = await fetch(url);
		if (!resp.ok) {
			throw new Error(`HuggingFace /search returned ${resp.status}`);
		}
		const json = await resp.json();
		return {
			rows: (json.rows ?? []).map(stripDetail),
			total: json.num_rows_total ?? 0,
			offset: data.offset,
			limit: data.limit,
		};
	});
