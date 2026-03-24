import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Search, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../env";
import type { SkillEntry } from "../lib/skills";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

const API_URL = env.VITE_FASTAPI_URL ?? "http://localhost:8000";
const PAGE_SIZE = 20;

export interface SkillRow {
	name: string;
	skill_name: string;
	description: string;
	code: string;
}

interface SkillsResponse {
	rows: SkillRow[];
	total: number;
	offset: number;
	limit: number;
}

export function SkillsBrowser({
	currentSkills,
	onToggle,
}: {
	currentSkills: SkillEntry[];
	onToggle: (skill: SkillEntry) => void;
}) {
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [page, setPage] = useState(0);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(0);
		}, 300);
		return () => clearTimeout(debounceRef.current);
	}, [search]);

	const offset = page * PAGE_SIZE;

	const { data, isLoading, isFetching } = useQuery<SkillsResponse>({
		queryKey: [
			"skills",
			"browse",
			{ offset, limit: PAGE_SIZE, search: debouncedSearch },
		],
		queryFn: async () => {
			const endpoint = debouncedSearch
				? `${API_URL}/api/skills/search?q=${encodeURIComponent(debouncedSearch)}&offset=${offset}&limit=${PAGE_SIZE}`
				: `${API_URL}/api/skills?offset=${offset}&limit=${PAGE_SIZE}`;
			const res = await fetch(endpoint);
			if (!res.ok) throw new Error("Failed to fetch skills");
			return res.json();
		},
		placeholderData: keepPreviousData,
	});

	const rows = data?.rows ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);

	const isAdded = useCallback(
		(name: string) => currentSkills.some((s) => s.name === name),
		[currentSkills],
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="relative">
				<Search
					size={14}
					className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search skills..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9 pr-9 text-xs"
				/>
				{search && (
					<button
						type="button"
						onClick={() => setSearch("")}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					>
						<X size={14} />
					</button>
				)}
			</div>

			{debouncedSearch && (
				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">
						{total.toLocaleString()} results
					</Badge>
					{isFetching && (
						<Loader2 size={12} className="animate-spin text-muted-foreground" />
					)}
				</div>
			)}

			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 size={20} className="animate-spin text-muted-foreground" />
				</div>
			) : rows.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Zap size={24} className="mb-2 text-muted-foreground/40" />
					<p className="text-sm text-muted-foreground">
						{debouncedSearch
							? "No skills match your search."
							: "No skills available."}
					</p>
				</div>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{rows.map((skill) => {
						const added = isAdded(skill.name);
						return (
							<button
								key={skill.name}
								type="button"
								onClick={() =>
									onToggle({
										name: skill.name,
										description: skill.description,
									})
								}
								className={`flex items-start gap-3 border p-3 text-left transition-colors ${
									added
										? "border-foreground bg-foreground/3"
										: "border-border hover:border-foreground/20"
								}`}
							>
								<Checkbox
									checked={added}
									className="mt-0.5 shrink-0"
									tabIndex={-1}
								/>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-foreground">
										{skill.skill_name}
									</p>
									{skill.name.includes("/") && (
										<p className="text-[10px] leading-tight text-muted-foreground/50">
											{skill.name.split("/").slice(0, -1).join("/")}
										</p>
									)}
									<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">
										{skill.description || skill.name}
									</p>
								</div>
							</button>
						);
					})}
				</div>
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-between border-t border-border pt-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						disabled={page === 0}
					>
						<ArrowLeft size={12} />
						Prev
					</Button>
					<span className="text-[11px] text-muted-foreground">
						Page {page + 1} of {totalPages.toLocaleString()}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						disabled={page >= totalPages - 1}
					>
						Next
						<ArrowRight size={12} />
					</Button>
				</div>
			)}
		</div>
	);
}
