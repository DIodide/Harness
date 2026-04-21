import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// convex-test requires the Edge Runtime environment to simulate the
		// Convex function runtime (V8 isolate with web APIs).
		environment: "edge-runtime",
		server: { deps: { inline: ["convex-test"] } },
		include: ["convex/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: "./coverage",
			// Coverage scoped to handler modules we can exercise in-process via
			// convex-test. Modules that wrap external services (file storage,
			// Daytona sandboxes, skills.sh registry) live in integration-only
			// coverage — they're out of scope here because mocking their HTTP
			// surfaces would test our mocks instead of production behaviour.
			include: [
				"convex/harnesses.ts",
				"convex/workspaces.ts",
				"convex/conversations.ts",
				"convex/messages.ts",
				"convex/usage.ts",
				"convex/userSettings.ts",
				"convex/commands.ts",
				"convex/mcpOAuthTokens.ts",
			],
			exclude: [
				"convex/_generated/**",
				"convex/**/*.test.ts",
				"convex/schema.ts",
				"convex/auth.config.ts",
				"convex/seed.ts",
				"convex/migrations.ts",
			],
			thresholds: {
				lines: 70,
				branches: 65,
				functions: 70,
				statements: 70,
			},
		},
	},
});
