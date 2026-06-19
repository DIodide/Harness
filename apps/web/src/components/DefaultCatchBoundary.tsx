import type { ErrorComponentProps } from "@tanstack/react-router";
import {
	ErrorComponent,
	Link,
	rootRouteId,
	useMatch,
	useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import {
	isChunkLoadError,
	reloadOnceForStaleChunk,
} from "../lib/handle-stale-chunk";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
	const router = useRouter();
	const isRoot = useMatch({
		strict: false,
		select: (state) => state.id === rootRouteId,
	});

	// Safety net for the case where the stale-chunk rejection reaches the
	// boundary (e.g. `vite:preloadError` didn't fire): one guarded hard reload
	// picks up the current build, since router.invalidate() can't refetch a 404.
	const chunkError = isChunkLoadError(error);
	useEffect(() => {
		if (chunkError) reloadOnceForStaleChunk();
	}, [chunkError]);

	console.error(error);

	if (chunkError) {
		return (
			<div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
				<p className="text-sm text-muted-foreground">
					Updating to the latest version…
				</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
				>
					Reload
				</button>
			</div>
		);
	}

	return (
		<div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
			<ErrorComponent error={error} />
			<div className="flex gap-2 items-center flex-wrap">
				<button
					type="button"
					onClick={() => {
						router.invalidate();
					}}
					className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
				>
					Try Again
				</button>
				{isRoot ? (
					<Link
						to="/"
						className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
					>
						Home
					</Link>
				) : (
					<Link
						to="/"
						className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
						onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
							e.preventDefault();
							window.history.back();
						}}
					>
						Go Back
					</Link>
				)}
			</div>
		</div>
	);
}
