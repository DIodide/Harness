import { useEffect, useState } from "react";

export function getIsMac(): boolean {
	if (typeof navigator === "undefined") return false;
	const uaData = (
		navigator as Navigator & {
			userAgentData?: { platform?: string };
		}
	).userAgentData;
	if (uaData?.platform) return /mac/i.test(uaData.platform);
	if (navigator.platform) return /mac/i.test(navigator.platform);
	return /mac/i.test(navigator.userAgent);
}

export function useIsMac(): boolean {
	const [isMac, setIsMac] = useState(false);
	useEffect(() => {
		setIsMac(getIsMac());
	}, []);
	return isMac;
}

export function formatShortcut(digit: number, isMac: boolean): string {
	return isMac ? `⌘⌥${digit}` : `Ctrl+Alt+${digit}`;
}

export function ariaKeyShortcut(digit: number, isMac: boolean): string {
	return isMac ? `Meta+Alt+${digit}` : `Control+Alt+${digit}`;
}
