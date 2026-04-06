import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	ArrowRight,
	Download,
	Eye,
	Loader2,
	Search,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillEntry, SkillRow } from "../lib/skills";
import { searchSkillsSh } from "../lib/skills-api";
import { SkillViewerDialog } from "./skill-viewer-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

const PAGE_SIZE = 20;

/**
 * Score a skill for search ranking.
 * Combines text relevance (how well query matches skillId/description)
 * with popularity (log-scaled installs). This is the standard approach
 * used by package registries like npm, PyPI, etc.
 */
function scoreSkill(skill: SkillRow, query: string): number {
	const q = query.toLowerCase();
	const id = skill.skillId.toLowerCase();
	const desc = skill.description.toLowerCase();

	// Text relevance score (0-100)
	let textScore = 0;
	if (id === q) {
		textScore = 100; // Exact match on skillId
	} else if (id.startsWith(q)) {
		textScore = 80; // Prefix match
	} else if (id.includes(q)) {
		textScore = 60; // Substring match on skillId
	} else if (desc.includes(q)) {
		textScore = 40; // Match in description
	} else {
		// Partial/fuzzy: check if all query words appear somewhere
		const words = q.split(/\s+/);
		const combined = `${id} ${desc}`;
		const matchCount = words.filter((w) => combined.includes(w)).length;
		textScore = 20 * (matchCount / Math.max(words.length, 1));
	}

	// Popularity score: log-scaled installs (0 ~50 range for typical values)
	// log10(1) = 0, log10(1000) = 3, log10(1M) = 6
	const popularityScore = Math.log10(skill.installs + 1) * 8;

	// Weighted combination: relevance is primary, popularity is tiebreaker
	return textScore * 0.7 + popularityScore * 0.3;
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
	const [searchPage, setSearchPage] = useState(0);
	// Cursor stack: index 0 is null (first page), subsequent entries are continueCursor values
	const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
	const [browsePageIndex, setBrowsePageIndex] = useState(0);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const [viewingSkill, setViewingSkill] = useState<SkillRow | null>(null);

	const discoverSkillsFn = useConvexAction(api.skills.discoverSkillsFromSearch);

	useEffect(() => {
		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setDebouncedSearch(search);
			setSearchPage(0);
			setCursorStack([null]);
			setBrowsePageIndex(0);
		}, 300);
		return () => clearTimeout(debounceRef.current);
	}, [search]);

	const currentCursor = cursorStack[browsePageIndex] ?? null;

	// Browse mode: cursor-based paginated query from Convex skillsIndex
	const browseQuery = useQuery({
		...convexQuery(api.skills.browseSkills, {
			cursor: currentCursor,
			numItems: PAGE_SIZE,
		}),
		placeholderData: keepPreviousData,
		enabled: !debouncedSearch,
	});

	// Search mode: Convex full-text search
	const convexSearchQuery = useQuery({
		...convexQuery(api.skills.searchSkillsIndex, {
			query: debouncedSearch,
			limit: 100,
		}),
		enabled: !!debouncedSearch,
	});

	// Search mode: skills.sh live search
	const skillsShQuery = useQuery({
		queryKey: ["skills-sh-search", debouncedSearch],
		queryFn: () => searchSkillsSh({ data: { q: debouncedSearch, limit: 100 } }),
		enabled: !!debouncedSearch,
	});

	// Track which fullIds we've already sent to discover in this session
	const seenFullIdsRef = useRef(new Set<string>());

	// When skills.sh returns results, fire-and-forget discover new ones into our index
	useEffect(() => {
		if (!skillsShQuery.data?.raw?.length) return;
		const unseen = skillsShQuery.data.raw.filter(
			(s) => !seenFullIdsRef.current.has(s.id),
		);
		if (unseen.length === 0) return;
		for (const s of unseen) seenFullIdsRef.current.add(s.id);
		discoverSkillsFn({
			skills: unseen.map((s) => ({
				skillId: s.skillId,
				fullId: s.id,
				source: s.source,
				installs: s.installs,
			})),
		}).catch(() => {});
	}, [skillsShQuery.data, discoverSkillsFn]);

	// Merge and rank search results by relevance + popularity
	const searchResults = (() => {
		if (!debouncedSearch) return null;
		const convexRows: SkillRow[] = (convexSearchQuery.data ?? []).map((d) => ({
			skillId: d.skillId,
			fullId: d.fullId,
			source: d.source,
			description: d.description,
			installs: d.installs,
		}));
		const shRows = skillsShQuery.data?.rows ?? [];

		// Merge and deduplicate, preferring Convex rows (have descriptions)
		const seen = new Set<string>();
		const merged: SkillRow[] = [];
		for (const row of [...convexRows, ...shRows]) {
			if (!seen.has(row.fullId)) {
				seen.add(row.fullId);
				merged.push(row);
			}
		}

		// Rank by combined text relevance + popularity score
		merged.sort(
			(a, b) => scoreSkill(b, debouncedSearch) - scoreSkill(a, debouncedSearch),
		);

		return merged;
	})();

	// Determine what to display
	const isSearchMode = !!debouncedSearch;
	const isLoading = isSearchMode
		? convexSearchQuery.isLoading && skillsShQuery.isLoading
		: browseQuery.isLoading;
	const isFetching = isSearchMode
		? convexSearchQuery.isFetching || skillsShQuery.isFetching
		: browseQuery.isFetching;

	let rows: SkillRow[];
	let hasMore: boolean;
	let page: number;
	if (isSearchMode) {
		const all = searchResults ?? [];
		const offset = searchPage * PAGE_SIZE;
		rows = all.slice(offset, offset + PAGE_SIZE);
		hasMore = offset + PAGE_SIZE < all.length;
		page = searchPage;
	} else {
		const browseData = browseQuery.data as
			| { page: SkillRow[]; isDone: boolean; continueCursor: string }
			| undefined;
		rows = (browseData?.page ?? []).map((r) => ({
			skillId: r.skillId,
			fullId: r.fullId,
			source: r.source,
			description: r.description,
			installs: r.installs,
		}));
		hasMore = browseData ? !browseData.isDone : false;
		page = browsePageIndex;
	}

	// Cache the continueCursor for the next page when browse data arrives
	const browseContinueCursor =
		!isSearchMode && browseQuery.data
			? (browseQuery.data as { continueCursor: string; isDone: boolean })
					.continueCursor
			: null;
	const browseIsDone =
		!isSearchMode && browseQuery.data
			? (browseQuery.data as { isDone: boolean }).isDone
			: true;

	useEffect(() => {
		if (browseContinueCursor && !browseIsDone) {
			setCursorStack((prev) => {
				if (prev[browsePageIndex + 1] === browseContinueCursor) return prev;
				const next = prev.slice(0, browsePageIndex + 1);
				next.push(browseContinueCursor);
				return next;
			});
		}
	}, [browseContinueCursor, browseIsDone, browsePageIndex]);

	const isAdded = useCallback(
		(fullId: string) => currentSkills.some((s) => s.name === fullId),
		[currentSkills],
	);

	const formatInstalls = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toString();
	};

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

			{isSearchMode && (
				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">
						{(searchResults ?? []).length.toLocaleString()} results
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
						{isSearchMode
							? "No skills match your search."
							: "No skills available."}
					</p>
				</div>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{rows.map((skill) => {
						const added = isAdded(skill.fullId);
						return (
							<button
								key={skill.fullId}
								type="button"
								onClick={() =>
									onToggle({
										name: skill.fullId,
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
									<div className="flex items-center gap-2">
										<p className="text-xs font-medium text-foreground">
											{skill.skillId}
										</p>
										{skill.installs > 0 && (
											<span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
												<Download size={10} />
												{formatInstalls(skill.installs)}
											</span>
										)}
									</div>
									<p className="text-[10px] leading-tight text-muted-foreground/50">
										{skill.source}
									</p>
								</div>
								<button
									type="button"
									aria-label={`View skill ${skill.skillId}`}
									onClick={(e) => {
										e.stopPropagation();
										setViewingSkill(skill);
									}}
									className="mt-0.5 shrink-0 border-0 bg-transparent p-0 text-muted-foreground/40 transition-colors hover:text-foreground"
								>
									<Eye size={14} />
								</button>
							</button>
						);
					})}
				</div>
			)}

			{(page > 0 || hasMore) && (
				<div className="flex items-center justify-between border-t border-border pt-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							if (isSearchMode) setSearchPage((p) => Math.max(0, p - 1));
							else setBrowsePageIndex((p) => Math.max(0, p - 1));
						}}
						disabled={page === 0}
					>
						<ArrowLeft size={12} />
						Prev
					</Button>
					<span className="text-[11px] text-muted-foreground">
						Page {page + 1}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							if (isSearchMode) setSearchPage((p) => p + 1);
							else setBrowsePageIndex((p) => p + 1);
						}}
						disabled={!hasMore}
					>
						Next
						<ArrowRight size={12} />
					</Button>
				</div>
			)}
			<SkillViewerDialog
				fullId={viewingSkill?.fullId ?? null}
				skillId={viewingSkill?.skillId}
				source={viewingSkill?.source}
				installs={viewingSkill?.installs}
				onClose={() => setViewingSkill(null)}
			/>
		</div>
	);
}
