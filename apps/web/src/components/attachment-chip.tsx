import { FileText, Loader2, Music, X } from "lucide-react";
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
	const isAudio = attachment.mimeType.startsWith("audio/");

	const Icon = isAudio ? Music : FileText;

	return (
		<div className="group relative flex h-8 shrink-0 items-center overflow-hidden border border-border bg-muted">
			{isImage && attachment.previewUrl ? (
				<img
					src={attachment.previewUrl}
					alt={attachment.fileName}
					className="h-full w-auto object-cover"
				/>
			) : (isPdf || isAudio) ? (
				<div className="flex items-center gap-1.5 px-2">
					<Icon size={12} className="shrink-0 text-muted-foreground" />
					<span className="max-w-[120px] truncate text-[11px] text-muted-foreground">
						{attachment.fileName}
					</span>
				</div>
			) : null}

			{attachment.status === "uploading" && (
				<div className="absolute inset-0 flex items-center justify-center bg-background/70">
					<Loader2 size={10} className="animate-spin text-foreground" />
				</div>
			)}

			{attachment.status === "error" && (
				<div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
					<span className="text-[9px] font-medium text-destructive">Error</span>
				</div>
			)}

			<button
				type="button"
				onClick={onRemove}
				className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center bg-background/80 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
			>
				<X size={8} />
			</button>
		</div>
	);
}
