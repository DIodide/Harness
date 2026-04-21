import { useEffect } from "react";
import { useCommandPalette } from "../lib/command-palette/context";

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Binds the global ⌘K / Ctrl+K (and ⌘⇧P / Ctrl+Shift+P) palette toggles.
 * Unlike per-command shortcuts, these MUST fire from editable targets too —
 * users expect to open the palette mid-typing.
 */
export function useCommandPaletteHotkey(): void {
	const { toggle, open, setOpen } = useCommandPalette();

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.repeat) return;

			const mod = e.metaKey || e.ctrlKey;
			if (!mod) return;

			const isK = e.key === "k" || e.key === "K";
			const isShiftP = e.shiftKey && (e.key === "p" || e.key === "P");

			if (!isK && !isShiftP) return;

			// Let ⌘K inside a contenteditable fall through only when it would clash
			// with a native hotkey. Today nothing in this app binds it, so we
			// intercept unconditionally — but guard Shift+P inside editable targets
			// since browsers don't reserve it and users may type "P" into inputs.
			if (isShiftP && isEditableTarget(e.target)) return;

			e.preventDefault();
			toggle();
		};

		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [toggle]);

	useEffect(() => {
		if (!open) return;
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onEsc);
		return () => document.removeEventListener("keydown", onEsc);
	}, [open, setOpen]);
}
