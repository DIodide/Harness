import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { UsageDisplay } from "./usage-display";

export function UsageDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Usage</DialogTitle>
				</DialogHeader>
				<UsageDisplay />
			</DialogContent>
		</Dialog>
	);
}
