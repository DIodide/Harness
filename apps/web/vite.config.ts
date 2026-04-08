import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
	// Inline server-only env vars at build time for Cloudflare Workers.
	// process.env is empty on Workers, so these must be baked into the bundle.
	define: {
		"process.env.ARCJET_KEY": JSON.stringify(process.env.ARCJET_KEY ?? ""),
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	optimizeDeps: {
		include: ["use-sync-external-store/shim/index.js"],
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
});

export default config;
