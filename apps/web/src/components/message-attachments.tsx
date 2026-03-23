import { convexQuery } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import type { Id } from "@harness/convex-backend/convex/_generated/dataModel";
import { useQuery } from "@tanstack/react-query";
import { FileText, Music } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogTrigger,
} from "./ui/dialog";

interface Attachment {
	storageId: Id<"_storage">;
	mimeType: string;
	fileName: string;
	fileSize: number;
}

function AttachmentItem({ attachment }: { attachment: Attachment }) {
	const { data: url } = useQuery(
		convexQuery(api.files.getFileUrl, { storageId: attachment.storageId }),
	);

	if (!url) return null;

	const square = "h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border";

	if (attachment.mimeType.startsWith("image/")) {
		return (
			<Dialog>
				<DialogTrigger asChild>
					<button type="button" className={`${square} cursor-zoom-in bg-muted`}>
						<img
							src={url}
							alt={attachment.fileName}
							className="h-full w-full object-cover"
						/>
					</button>
				</DialogTrigger>
				<DialogContent
					className="max-w-[90vw] border-0 bg-transparent p-0 shadow-none"
					showCloseButton={false}
				>
					<img
						src={url}
						alt={attachment.fileName}
						className="max-h-[90vh] max-w-full rounded-lg object-contain"
					/>
				</DialogContent>
			</Dialog>
		);
	}

	if (attachment.mimeType === "application/pdf") {
		return (
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				className={`${square} flex flex-col items-center justify-center gap-1 bg-muted px-1 transition-colors hover:bg-muted/80`}
			>
				<FileText size={20} className="shrink-0 text-muted-foreground" />
				<span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
					{attachment.fileName}
				</span>
			</a>
		);
	}

	if (attachment.mimeType.startsWith("audio/")) {
		return (
			<div className="flex w-56 shrink-0 flex-col gap-1 rounded-lg border border-border bg-muted p-2">
				<div className="flex items-center gap-1.5">
					<Music size={14} className="shrink-0 text-muted-foreground" />
					<span className="truncate text-[11px] text-muted-foreground">
						{attachment.fileName}
					</span>
				</div>
				{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
				<audio controls src={url} className="h-8 w-full" preload="metadata" />
			</div>
		);
	}

	return null;
}

export function MessageAttachments({
	attachments,
}: {
	attachments: Attachment[];
}) {
	if (attachments.length === 0) return null;

	return (
		<div className="mb-1.5 flex flex-wrap items-end justify-end gap-1.5">
			{attachments.map((a) => (
				<AttachmentItem key={a.storageId} attachment={a} />
			))}
		</div>
	);
}
