export function HarnessMark({
	size = 24,
	className,
}: {
	size?: number;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			<path d="M7 4v16" strokeWidth="2.5" />
			<path d="M17 4v16" strokeWidth="2.5" />
			<path d="M7 12 C9.5 8, 14.5 8, 17 12" strokeWidth="2" />
			<path d="M7 12 C9.5 16, 14.5 16, 17 12" strokeWidth="2" />
		</svg>
	);
}
