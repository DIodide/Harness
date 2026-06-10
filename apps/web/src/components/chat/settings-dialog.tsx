import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@harness/convex-backend/convex/_generated/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, User } from "lucide-react";
import { AgentConnections } from "../agent-connections";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";

export function SettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { signOut, openUserProfile } = useClerk();
	const { user } = useUser();
	const navigate = useNavigate();
	const { data: userSettings } = useQuery(
		convexQuery(api.userSettings.get, {}),
	);
	const updateSettings = useMutation({
		mutationFn: useConvexMutation(api.userSettings.update),
	});

	const handleSignOut = async () => {
		await signOut();
		navigate({ to: "/sign-in" });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-sm [&>*]:min-w-0">
				<DialogHeader>
					<DialogTitle className="text-sm">Settings</DialogTitle>
					<DialogDescription>Manage your preferences.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Profile
						</p>
						<div className="flex items-center gap-3 py-1.5">
							<Avatar className="h-8 w-8">
								<AvatarImage src={user?.imageUrl} />
								<AvatarFallback className="text-xs">
									{user?.firstName?.[0]}
									{user?.lastName?.[0]}
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium text-foreground">
									{user?.fullName}
								</p>
								<p className="truncate text-[11px] text-muted-foreground">
									{user?.primaryEmailAddress?.emailAddress}
								</p>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start text-muted-foreground hover:text-foreground"
							onClick={() => openUserProfile()}
						>
							<User size={12} />
							Manage account
						</Button>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Behavior
						</p>
						<label
							htmlFor="auto-switch"
							className="flex items-center justify-between gap-3 py-1.5"
						>
							<div>
								<p className="text-xs font-medium text-foreground">
									Auto-switch harness
								</p>
								<p className="text-[11px] text-muted-foreground">
									Switch to a conversation's harness when selected.
								</p>
							</div>
							<Checkbox
								id="auto-switch"
								checked={userSettings?.autoSwitchHarness ?? true}
								onCheckedChange={(checked) => {
									updateSettings.mutate({
										autoSwitchHarness: checked === true,
									});
								}}
							/>
						</label>
						<div className="flex items-center justify-between gap-3 py-1.5">
							<div>
								<p className="text-xs font-medium text-foreground">
									Model selector
								</p>
								<p className="text-[11px] text-muted-foreground">
									Whether switching models in chat updates the session or the
									harness.
								</p>
							</div>
							<Select
								value={(userSettings?.modelSelectorMode as string) ?? "session"}
								onValueChange={(value) => {
									updateSettings.mutate({
										modelSelectorMode: value as "session" | "harness",
									});
								}}
							>
								<SelectTrigger className="w-[110px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="session">Session</SelectItem>
									<SelectItem value="harness">Harness</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Display
						</p>
						<div className="flex items-center justify-between gap-3 py-1.5">
							<div>
								<p className="text-xs font-medium text-foreground">
									Message actions
								</p>
								<p className="text-[11px] text-muted-foreground">
									Controls which buttons appear on messages.
								</p>
							</div>
							<Select
								value={(userSettings?.displayMode as string) ?? "standard"}
								onValueChange={(value) => {
									updateSettings.mutate({
										displayMode: value as "zen" | "standard" | "developer",
									});
								}}
							>
								<SelectTrigger className="w-[120px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="zen">Zen</SelectItem>
									<SelectItem value="standard">Standard</SelectItem>
									<SelectItem value="developer">Developer</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Agent Connections
						</p>
						<AgentConnections />
					</div>

					<Separator />

					{/* workspaces selector option */}
					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Advanced Layout: Workspaces
						</p>
						<div className="flex items-center justify-between gap-3 py-1.5">
							<div>
								<p className="text-xs font-medium text-foreground">
									Advanced Layout: Workspaces
								</p>
								<p className="text-[11px] text-muted-foreground">
									Controls whether the basic layout or the workspaces advanced
									layout is in use
								</p>
							</div>
							<Select
								value={(userSettings?.workspacesMode as string) ?? "basic"}
								onValueChange={async (value) => {
									await updateSettings.mutateAsync({
										workspacesMode: value as "basic" | "workspaces",
									});
									onOpenChange(false);
									navigate({
										to: value === "workspaces" ? "/workspaces" : "/chat",
										replace: true,
									});
								}}
							>
								<SelectTrigger className="w-[120px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="basic">Basic</SelectItem>
									<SelectItem value="workspaces">Workspaces</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<Separator />

					<div>
						<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Account
						</p>
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start text-muted-foreground hover:text-foreground"
							onClick={handleSignOut}
						>
							<LogOut size={12} />
							Sign out
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
