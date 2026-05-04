import { dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig(({ mode }) => {
	const envDir = dirname(fileURLToPath(import.meta.url));
	const env = { ...process.env, ...loadEnv(mode, envDir, "") };
	return {
		// Inline server-only env vars at build time for Cloudflare Workers.
		// process.env is empty on Workers, so these must be baked into the bundle.
		define: {
			"process.env.ARCJET_KEY": JSON.stringify(env.ARCJET_KEY ?? ""),
			"process.env.DAYTONA_API_KEY": JSON.stringify(env.DAYTONA_API_KEY ?? ""),
			"process.env.DAYTONA_API_URL": JSON.stringify(
				env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
			),
			"process.env.DAYTONA_TARGET": JSON.stringify(env.DAYTONA_TARGET ?? "us"),
			"process.env.CONVEX_DEPLOY_KEY": JSON.stringify(
				env.CONVEX_DEPLOY_KEY ?? "",
			),
		},
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		optimizeDeps: {
			include: ["use-sync-external-store/shim/index.js"],
			// Daytona SDK pulls in @opentelemetry which dynamic-imports Node's
			// `https`. Vite's pre-bundler can't resolve Node built-ins, but the
			// runtime is fine because `nodejs_compat` is enabled in wrangler.
			// Excluding here lets it pass through to the runtime untouched.
			exclude: ["@daytonaio/sdk"],
		},
		// Order matters: TanStack Start must run immediately after Cloudflare so the
		// router generator initializes before other plugins transform the graph (avoids
		// "Crawling result not available" when loading routeTree.gen.ts). Matches:
		// https://developers.cloudflare.com/workers/frameworks/framework-guides/tanstack/
		plugins: [
			cloudflare({ viteEnvironment: { name: "ssr" } }),
			tanstackStart(),
			viteReact(),
			// Event bus defaults to port 42069 and throws EADDRINUSE if another dev
			// server (or stale process) already bound it — common with turbo dev.
			devtools({ eventBusConfig: { enabled: false } }),
			viteTsConfigPaths({
				projects: ["./tsconfig.json"],
			}),
			tailwindcss(),
		],
		server: {
			allowedHosts: true,
		},
	};
});

export default config;
