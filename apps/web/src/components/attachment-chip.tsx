import { FileText, Loader2, X } from "lucide-react";
import type { PendingAttachment } from "../hooks/use-file-attachments";

export function AttachmentChip({
	attachment,
	onRemove,
}: {
	attachment: PendingAttachment;
	onRemove: () => void;
}) {
	const isImage = attachment.mimeType.startsWith("image/");
	const isPdf = attachment.mimeType === "application/pdf";

	return (
		<div className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-border bg-muted">
			{isImage && attachment.previewUrl ? (
				<img
					src={attachment.previewUrl}
					alt={attachment.fileName}
					className="h-full w-full object-cover"
				/>
			) : isPdf ? (
				<div className="flex flex-col items-center gap-1 px-1">
					<FileText size={20} className="text-muted-foreground" />
					<span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
						{attachment.fileName}
					</span>
				</div>
			) : null}

			{/* Uploading spinner overlay */}
			{attachment.status === "uploading" && (
				<div className="absolute inset-0 flex items-center justify-center bg-background/60">
					<Loader2 size={14} className="animate-spin text-foreground" />
				</div>
			)}

			{/* Error overlay */}
			{attachment.status === "error" && (
				<div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
					<span className="text-[9px] font-medium text-destructive">Error</span>
				</div>
			)}

			{/* Remove button — appears on hover */}
			<button
				type="button"
				onClick={onRemove}
				className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-background/80 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
			>
				<X size={10} />
			</button>
		</div>
	);
}
