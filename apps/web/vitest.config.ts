import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [viteReact(), viteTsConfigPaths({ projects: ["./tsconfig.json"] })],
	test: {
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
		globals: true,
		css: false,
		env: {
			ARCJET_KEY: "ajkey_test",
			VITE_CONVEX_URL: "https://test.convex.cloud",
			VITE_CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
			VITE_FASTAPI_URL: "http://localhost:8000",
		},
		include: [
			"src/**/*.test.{ts,tsx}",
			"src/**/__tests__/**/*.{ts,tsx}",
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: "./coverage",
			// Coverage is scoped to "unit-testable" modules: pure logic in lib/,
			// hooks/, command-palette state, and the leaf components we test
			// directly. Large feature surfaces (sandbox UI, chat-stream, markdown
			// rendering, syntax highlighting, complex multi-connect flows) are
			// covered by Playwright E2E tests and deliberately excluded here —
			// mocking their Convex/Clerk/Motion stacks under jsdom produces
			// test code that verifies mocks, not behaviour.
			include: [
				// Pure logic modules under lib/
				"src/lib/utils.ts",
				"src/lib/models.ts",
				"src/lib/mcp.ts",
				"src/lib/multimodal.ts",
				"src/lib/platform.ts",
				"src/lib/skills.ts",
				"src/lib/skills-api.ts",
				"src/lib/workspace-colors.ts",
				"src/lib/floating-dots.ts",
				"src/lib/command-palette/context.tsx",
				"src/lib/command-palette/recent.ts",
				"src/lib/command-palette/types.ts",
				// Hook modules
				"src/hooks/use-command-palette-hotkey.ts",
				"src/hooks/use-register-commands.ts",
				"src/hooks/use-workspace-shortcuts.ts",
				"src/hooks/use-file-attachments.ts",
				// Leaf components we test directly
				"src/components/attachment-chip.tsx",
				"src/components/workspace-color-picker.tsx",
				"src/components/header-skills-menu.tsx",
			],
			exclude: [
				"**/*.d.ts",
				"**/*.test.{ts,tsx}",
				"**/__tests__/**",
			],
			thresholds: {
				lines: 75,
				branches: 70,
				functions: 75,
				statements: 75,
			},
		},
	},
});
