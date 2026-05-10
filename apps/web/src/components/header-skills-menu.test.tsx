import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// HeaderSkillsMenu pulls in SkillsBrowser / SkillViewerDialog, which in turn
// import from @convex-dev/react-query + @tanstack/react-query. We don't need
// those child surfaces for these tests — stub them.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: () => ({}),
	useConvexAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
	keepPreviousData: {},
}));
vi.mock("@harness/convex-backend/convex/_generated/api", () => ({
	api: { skills: { ensureSkillDetails: "skills:ensureSkillDetails" } },
}));
vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children: unknown }) => children,
	motion: new Proxy(
		{},
		{
			get:
				() =>
				({
					children,
					...rest
				}: { children?: unknown } & Record<string, unknown>) => (
					<div {...(rest as Record<string, unknown>)}>{children as never}</div>
				),
		},
	),
}));

import type { SkillEntry } from "../lib/skills";
import { HeaderSkillsMenu } from "./header-skills-menu";
import { TooltipProvider } from "./ui/tooltip";

const skillA: SkillEntry = { name: "group/a" } as SkillEntry;
const skillB: SkillEntry = { name: "group/b" } as SkillEntry;

const renderWithProviders = (ui: ReactNode) =>
	render(<TooltipProvider>{ui}</TooltipProvider>);

describe("HeaderSkillsMenu", () => {
	it("shows 'Add skills' when no skills are attached", () => {
		renderWithProviders(
			<HeaderSkillsMenu skills={[]} onAdd={() => {}} onRemove={() => {}} />,
		);
		expect(screen.getByText("Add skills")).toBeInTheDocument();
	});

	it("shows a pluralized count with multiple skills", () => {
		renderWithProviders(
			<HeaderSkillsMenu
				skills={[skillA, skillB]}
				onAdd={() => {}}
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("2 Skills")).toBeInTheDocument();
	});

	it("shows singular '1 Skill' with exactly one", () => {
		renderWithProviders(
			<HeaderSkillsMenu
				skills={[skillA]}
				onAdd={() => {}}
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("1 Skill")).toBeInTheDocument();
	});

	it("opens the menu and displays attached skills on trigger click", () => {
		renderWithProviders(
			<HeaderSkillsMenu
				skills={[skillA]}
				onAdd={() => {}}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByText("1 Skill"));
		// The short name (after the last '/') is rendered in the menu.
		expect(screen.getByText("a")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Remove group\/a/ }),
		).toBeInTheDocument();
	});

	it("invokes onRemove when the X button is clicked in the menu", () => {
		const onRemove = vi.fn();
		renderWithProviders(
			<HeaderSkillsMenu
				skills={[skillA]}
				onAdd={() => {}}
				onRemove={onRemove}
			/>,
		);
		fireEvent.click(screen.getByText("1 Skill"));
		fireEvent.click(screen.getByRole("button", { name: /Remove group\/a/ }));
		expect(onRemove).toHaveBeenCalledWith(skillA);
	});

	it("renders an empty-state message when opened with no skills", () => {
		renderWithProviders(
			<HeaderSkillsMenu skills={[]} onAdd={() => {}} onRemove={() => {}} />,
		);
		fireEvent.click(screen.getByText("Add skills"));
		expect(screen.getByText("No skills attached yet.")).toBeInTheDocument();
	});
});
