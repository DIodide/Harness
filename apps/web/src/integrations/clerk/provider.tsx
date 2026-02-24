import { ClerkProvider } from "@clerk/tanstack-react-start";
import { env } from "../../env";

export default function AppClerkProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<ClerkProvider
			publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}
			afterSignOutUrl="/"
		>
			{children}
		</ClerkProvider>
	);
}
