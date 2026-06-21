import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { Checkbox } from "./ui/checkbox";

/**
 * Multi-select of the user's skill packs for a harness. Attaching a pack adds
 * its skills (and, for agentic harnesses, its AGENTS.md / CLAUDE.md and
 * materialized skills) to the harness. Creating/editing packs lives on the
 * dedicated /skill-packs manage screen, linked from here.
 */
export function SkillPackPicker({
	selectedIds,
	onChange,
}: {
	selectedIds: Id<"skillPacks">[];
	onChange: (ids: Id<"skillPacks">[]) => void;
}) {
	const { data: packs } = useQuery(convexQuery(api.skillPacks.list, {}));

	const toggle = (id: Id<"skillPacks">) => {
		onChange(
			selectedIds.includes(id)
				? selectedIds.filter((x) => x !== id)
				: [...selectedIds, id],
		);
	};

	const manageLink = (
		<Link
			to="/skill-packs"
			className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
		>
			<Plus size={12} />
			{packs && packs.length > 0 ? "Manage skill packs" : "Create a skill pack"}
		</Link>
	);

	if (!packs) {
		return (
			<p className="text-[11px] text-muted-foreground">Loading skill packs…</p>
		);
	}

	if (packs.length === 0) {
		return (
			<div className="rounded-md border border-dashed border-border p-3 text-center">
				<p className="text-xs text-muted-foreground">
					No skill packs yet — bundle skills with AGENTS.md / CLAUDE.md context.
				</p>
				<div className="mt-1.5">{manageLink}</div>
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{packs.map((pack) => {
				const checked = selectedIds.includes(pack._id);
				const tags: string[] = [];
				if (pack.agentsMd) tags.push("AGENTS.md");
				if (pack.claudeMd) tags.push("CLAUDE.md");
				return (
					<label
						key={pack._id}
						htmlFor={`pack-${pack._id}`}
						className="flex w-full cursor-pointer items-start gap-3 border border-border bg-foreground/3 p-2.5 transition-colors hover:border-foreground/20"
					>
						<Checkbox
							id={`pack-${pack._id}`}
							checked={checked}
							className="mt-0.5 shrink-0"
							onCheckedChange={() => toggle(pack._id)}
						/>
						<Package
							size={14}
							className="mt-0.5 shrink-0 text-muted-foreground"
						/>
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs font-medium text-foreground">
								{pack.name}
							</p>
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
								{pack.skills.length} skill{pack.skills.length === 1 ? "" : "s"}
								{tags.length ? ` · ${tags.join(" · ")}` : ""}
							</p>
						</div>
					</label>
				);
			})}
			<div className="pt-0.5">{manageLink}</div>
		</div>
	);
}
