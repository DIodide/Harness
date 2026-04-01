import { useUser } from "@clerk/tanstack-react-start";
import { GraduationCap, Loader2, Mail } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import type { McpServerEntry } from "../lib/mcp";
import { getPrincetonNetid } from "../lib/mcp";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function PrincetonConnectRow({ server }: { server: McpServerEntry }) {
	const { user } = useUser();
	const netid = getPrincetonNetid(user);

	// Email verification flow state (for users without a Princeton email)
	const [showForm, setShowForm] = useState(false);
	const [netidInput, setNetidInput] = useState("");
	const [verificationCode, setVerificationCode] = useState("");
	const [emailId, setEmailId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [step, setStep] = useState<"email" | "code">("email");

	const handleAddEmail = useCallback(async () => {
		if (!user || !netidInput.trim()) return;
		setLoading(true);
		try {
			const email = `${netidInput.trim()}@princeton.edu`;
			const res = await user.createEmailAddress({ email });
			await user.reload();

			const emailAddress = user.emailAddresses.find((a) => a.id === res?.id);
			if (!emailAddress) throw new Error("Email not found after creation");

			await emailAddress.prepareVerification({ strategy: "email_code" });
			setEmailId(emailAddress.id);
			setStep("code");
			toast.success(`Verification code sent to ${email}`);
		} catch (err) {
			console.error("[Princeton] Add email error:", err);
			const message =
				err instanceof Error ? err.message : "Failed to add email";
			toast.error(message);
		} finally {
			setLoading(false);
		}
	}, [user, netidInput]);

	const handleVerifyCode = useCallback(async () => {
		if (!user || !emailId || !verificationCode.trim()) return;
		setLoading(true);
		try {
			const emailAddress = user.emailAddresses.find((a) => a.id === emailId);
			if (!emailAddress) throw new Error("Email not found");

			const result = await emailAddress.attemptVerification({
				code: verificationCode.trim(),
			});

			if (result.verification?.status === "verified") {
				await user.reload();
				toast.success("Princeton account verified!");
				setShowForm(false);
			} else {
				toast.error("Verification failed. Check the code and try again.");
			}
		} catch (err) {
			console.error("[Princeton] Verify error:", err);
			const message =
				err instanceof Error ? err.message : "Verification failed";
			toast.error(message);
		} finally {
			setLoading(false);
		}
	}, [user, emailId, verificationCode]);

	// Already connected — show badge
	if (netid) {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				className="flex items-center gap-3 border border-border px-3 py-2.5"
			>
				<GraduationCap size={14} className="shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium text-foreground">{server.name}</p>
					<p className="truncate text-[11px] text-muted-foreground">
						Princeton University
					</p>
				</div>
				<Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
					<div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
					{netid}
				</Badge>
			</motion.div>
		);
	}

	// Show inline email verification form
	if (showForm) {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				className="space-y-2 border border-border p-3"
			>
				<div className="flex items-center gap-2">
					<GraduationCap size={14} className="shrink-0 text-muted-foreground" />
					<p className="text-xs font-medium text-foreground">
						Verify Princeton Account
					</p>
				</div>

				{step === "email" ? (
					<div className="flex items-center gap-2">
						<div className="flex flex-1 items-center gap-0">
							<Input
								value={netidInput}
								onChange={(e) => setNetidInput(e.target.value)}
								placeholder="netid"
								className="rounded-r-none text-xs"
								onKeyDown={(e) => e.key === "Enter" && handleAddEmail()}
							/>
							<span className="flex h-8 items-center border border-l-0 border-border bg-muted px-2 text-[11px] text-muted-foreground">
								@princeton.edu
							</span>
						</div>
						<Button
							size="sm"
							className="shrink-0 text-xs"
							onClick={handleAddEmail}
							disabled={loading || !netidInput.trim()}
						>
							{loading ? (
								<Loader2 size={10} className="animate-spin" />
							) : (
								<Mail size={10} />
							)}
							Send Code
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-2">
						<Input
							value={verificationCode}
							onChange={(e) => setVerificationCode(e.target.value)}
							placeholder="Enter verification code"
							className="flex-1 text-xs"
							onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
						/>
						<Button
							size="sm"
							className="shrink-0 text-xs"
							onClick={handleVerifyCode}
							disabled={loading || !verificationCode.trim()}
						>
							{loading ? <Loader2 size={10} className="animate-spin" /> : null}
							Verify
						</Button>
					</div>
				)}

				<button
					type="button"
					onClick={() => {
						setShowForm(false);
						setStep("email");
						setVerificationCode("");
					}}
					className="text-[11px] text-muted-foreground hover:text-foreground"
				>
					Cancel
				</button>
			</motion.div>
		);
	}

	// Default: show connect button
	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			className="flex items-center gap-3 border border-border px-3 py-2.5"
		>
			<GraduationCap size={14} className="shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-foreground">{server.name}</p>
				<p className="truncate text-[11px] text-muted-foreground">
					Requires Princeton University account
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0 text-xs"
				onClick={() => setShowForm(true)}
			>
				<GraduationCap size={10} />
				Verify Princeton
			</Button>
		</motion.div>
	);
}
