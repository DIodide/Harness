import hljs from "highlight.js";
import { useMemo } from "react";

/** Map file extensions to highlight.js language names. */
export function detectLanguage(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		py: "python",
		rb: "ruby",
		rs: "rust",
		go: "go",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		h: "c",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		yml: "yaml",
		yaml: "yaml",
		json: "json",
		toml: "ini",
		xml: "xml",
		html: "html",
		css: "css",
		scss: "scss",
		sql: "sql",
		md: "markdown",
		dockerfile: "dockerfile",
		tf: "hcl",
		lua: "lua",
		r: "r",
		ex: "elixir",
		exs: "elixir",
	};
	return ext ? map[ext] : undefined;
}

/** Syntax-highlight code, returning an HTML string. */
export function useHighlighted(code: string, language?: string) {
	return useMemo(() => {
		if (!code) return "";
		try {
			if (language && hljs.getLanguage(language)) {
				return hljs.highlight(code, { language }).value;
			}
			return hljs.highlightAuto(code).value;
		} catch {
			return "";
		}
	}, [code, language]);
}
