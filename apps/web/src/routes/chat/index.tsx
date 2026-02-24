import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { isSignedIn, user, isLoaded } = useUser();

	if (!isLoaded) {
		return <div>Loading...</div>;
	}

	if (!isSignedIn) {
		return <div>Sign in to view this page</div>;
	}

	return <div>Hello {user.firstName}!</div>;
}
