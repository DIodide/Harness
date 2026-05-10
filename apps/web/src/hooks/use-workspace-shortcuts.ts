import { useEffect, useRef, useState } from "react";

type WithId<T> = { _id: T };

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isModalOpen(): boolean {
	return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export function useWorkspaceShortcuts<T>(
	workspaces: ReadonlyArray<WithId<T>> | undefined,
	onSelect: (id: T) => void,
	isMac: boolean,
): void {
	const workspacesRef = useRef(workspaces);
	const onSelectRef = useRef(onSelect);
	useEffect(() => {
		workspacesRef.current = workspaces;
		onSelectRef.current = onSelect;
	});

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.repeat) return;
			if (isEditableTarget(e.target)) return;
			if (isModalOpen()) return;

			const comboHeld = isMac
				? e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey
				: e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
			if (!comboHeld) return;

			const match = /^Digit([1-9])$/.exec(e.code);
			if (!match) return;
			const digit = Number(match[1]);
			const list = workspacesRef.current;
			if (!list || digit > list.length) return;

			e.preventDefault();
			onSelectRef.current(list[digit - 1]._id);
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [isMac]);
}

export function useModifierHeld(isMac: boolean): boolean {
	const [held, setHeld] = useState(false);
	const heldRef = useRef(false);

	useEffect(() => {
		const update = (next: boolean) => {
			if (heldRef.current === next) return;
			heldRef.current = next;
			setHeld(next);
		};
		const fromKey = (e: KeyboardEvent) => {
			update(isMac ? e.metaKey && e.altKey : e.ctrlKey && e.altKey);
		};
		const reset = () => update(false);
		const onVisibility = () => {
			if (document.hidden) reset();
		};

		window.addEventListener("keydown", fromKey);
		window.addEventListener("keyup", fromKey);
		window.addEventListener("blur", reset);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("keydown", fromKey);
			window.removeEventListener("keyup", fromKey);
			window.removeEventListener("blur", reset);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [isMac]);

	return held;
}
