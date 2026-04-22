import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_COLORS } from "../lib/workspace-colors";
import { WorkspaceColorPicker } from "./workspace-color-picker";

describe("WorkspaceColorPicker", () => {
	it("renders the 'No color' button plus one per color", () => {
		render(<WorkspaceColorPicker value={null} onChange={() => {}} />);
		// 1 None + N colors
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(1 + WORKSPACE_COLORS.length);
		expect(screen.getByLabelText("No color")).toBeInTheDocument();
		for (const c of WORKSPACE_COLORS) {
			expect(screen.getByLabelText(c.label)).toBeInTheDocument();
		}
	});

	it("marks 'No color' as pressed when value is null", () => {
		render(<WorkspaceColorPicker value={null} onChange={() => {}} />);
		expect(screen.getByLabelText("No color")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		for (const c of WORKSPACE_COLORS) {
			expect(screen.getByLabelText(c.label)).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		}
	});

	it("marks the selected color as pressed", () => {
		render(<WorkspaceColorPicker value="mint" onChange={() => {}} />);
		expect(screen.getByLabelText("Mint")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByLabelText("No color")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("calls onChange with the color key when a color button is clicked", () => {
		const onChange = vi.fn();
		render(<WorkspaceColorPicker value={null} onChange={onChange} />);
		fireEvent.click(screen.getByLabelText("Peach"));
		expect(onChange).toHaveBeenCalledWith("peach");
	});

	it("calls onChange with null when the 'No color' button is clicked", () => {
		const onChange = vi.fn();
		render(<WorkspaceColorPicker value="rose" onChange={onChange} />);
		fireEvent.click(screen.getByLabelText("No color"));
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("applies the color's background via inline style", () => {
		render(<WorkspaceColorPicker value={null} onChange={() => {}} />);
		const rose = screen.getByLabelText("Rose");
		// jsdom lowercases hex but normalizes to rgb in some browsers; compare via style prop
		expect(rose.getAttribute("style")).toContain("background-color");
	});
});
