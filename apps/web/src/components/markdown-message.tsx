import { Check, Copy } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setCopied(false), 2000);
	}, [text]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
		>
			{copied ? (
				<>
					<Check size={12} />
					Copied
				</>
			) : (
				<>
					<Copy size={12} />
					Copy
				</>
			)}
		</button>
	);
}

const components: Components = {
	pre({ children, ...props }) {
		return (
			<pre className="not-prose group relative" {...props}>
				{children}
			</pre>
		);
	},

	code({ className, children, ...props }) {
		const match = /language-(\w+)/.exec(className || "");
		const isBlock = Boolean(match);
		const codeText = String(children).replace(/\n$/, "");

		if (isBlock) {
			return (
				<div className="my-3 overflow-hidden border border-border">
					<div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
						<span className="font-mono text-[10px] text-muted-foreground">
							{match?.[1]}
						</span>
						<CopyButton text={codeText} />
					</div>
					<div className="overflow-x-auto bg-muted/30 p-3">
						<code className={cn("text-xs", className)} {...props}>
							{children}
						</code>
					</div>
				</div>
			);
		}

		return (
			<code
				className="border border-border bg-muted/50 px-1 py-0.5 font-mono text-xs"
				{...props}
			>
				{children}
			</code>
		);
	},

	a({ href, children, ...props }) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground"
				{...props}
			>
				{children}
			</a>
		);
	},

	table({ children, ...props }) {
		return (
			<div className="my-3 overflow-x-auto border border-border">
				<table className="w-full text-xs" {...props}>
					{children}
				</table>
			</div>
		);
	},

	th({ children, ...props }) {
		return (
			<th
				className="border-b border-border bg-muted/50 px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
				{...props}
			>
				{children}
			</th>
		);
	},

	td({ children, ...props }) {
		return (
			<td className="border-b border-border px-3 py-1.5" {...props}>
				{children}
			</td>
		);
	},
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export function MarkdownMessage({ content }: { content: string }) {
	return (
		<div className="markdown-message prose-sm">
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={rehypePlugins}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
