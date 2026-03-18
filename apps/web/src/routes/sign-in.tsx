import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { HarnessMark } from "../components/harness-mark";

export const Route = createFileRoute("/sign-in")({
	component: SignInPage,
});

function SignInPage() {
	return (
		<div className="flex min-h-screen">
			<div className="hidden flex-col justify-between bg-foreground p-12 text-background lg:flex lg:w-1/2">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
				>
					<div className="flex items-center gap-3">
						<HarnessMark size={28} className="text-background" />
						<span className="text-lg font-semibold tracking-tight">
							Harness
						</span>
					</div>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.6, delay: 0.15 }}
					className="max-w-md"
				>
					<h1 className="mb-4 text-[clamp(2rem,3.5vw,3rem)] font-medium leading-[1.1] tracking-tight">
						Equip your AI agents for anything.
					</h1>
					<p className="text-base leading-relaxed text-background/50">
						Create, manage, and deploy custom tool configurations for AI agents
						— switching contexts in seconds, not hours.
					</p>
				</motion.div>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.5, delay: 0.3 }}
					className="text-xs text-background/30"
				>
					&copy; 2026 Harness. All rights reserved.
				</motion.p>
			</div>

			<div className="flex flex-1 items-center justify-center bg-background p-6">
				<motion.div
					initial={{ opacity: 0, scale: 0.97 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.4, delay: 0.1 }}
				>
					<div className="mb-8 flex items-center gap-2 lg:hidden">
						<HarnessMark size={24} className="text-foreground" />
						<span className="text-lg font-semibold tracking-tight text-foreground">
							Harness
						</span>
					</div>
					<SignIn
						routing="hash"
						forceRedirectUrl="/chat"
						appearance={{
							elements: {
								rootBox: "w-full max-w-sm",
								cardBox: "shadow-none border-0",
								card: "shadow-none border-0 p-0",
								headerTitle: "text-foreground text-xl font-medium",
								headerSubtitle: "text-muted-foreground",
								formButtonPrimary:
									"bg-foreground text-background hover:bg-foreground/90 rounded-none text-xs font-medium h-9",
								formFieldInput:
									"rounded-none border-border focus:ring-ring text-sm",
								formFieldLabel: "text-foreground text-xs font-medium",
								footerActionLink: "text-foreground hover:text-foreground/80",
								identityPreviewEditButton:
									"text-foreground hover:text-foreground/80",
								socialButtonsBlockButton:
									"rounded-none border-border text-foreground text-xs font-medium",
								dividerLine: "bg-border",
								dividerText: "text-muted-foreground text-xs",
							},
						}}
					/>
				</motion.div>
			</div>
		</div>
	);
}
