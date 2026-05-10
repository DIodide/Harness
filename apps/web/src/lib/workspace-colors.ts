export const WORKSPACE_COLORS = [
	{ key: "rose", label: "Rose", hex: "#FFD9DE" },
	{ key: "peach", label: "Peach", hex: "#FFE4C9" },
	{ key: "butter", label: "Butter", hex: "#FFF3C2" },
	{ key: "mint", label: "Mint", hex: "#D4EEDB" },
	{ key: "sky", label: "Sky", hex: "#D1E7F7" },
	{ key: "lilac", label: "Lilac", hex: "#E3D5F2" },
	{ key: "blush", label: "Blush", hex: "#F5DCE6" },
	{ key: "sand", label: "Sand", hex: "#EDE1CB" },
] as const;

export type WorkspaceColorKey = (typeof WORKSPACE_COLORS)[number]["key"];

export function getWorkspaceColorHex(
	key: string | null | undefined,
): string | null {
	if (!key) return null;
	return WORKSPACE_COLORS.find((c) => c.key === key)?.hex ?? null;
}
