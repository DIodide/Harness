"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
	className,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn(
				"relative flex w-full touch-none select-none items-center data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className="relative h-1 grow overflow-hidden rounded-full bg-muted"
			>
				<SliderPrimitive.Range
					data-slot="slider-range"
					className="absolute h-full bg-foreground"
				/>
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				className="block size-3.5 shrink-0 rounded-full border border-foreground bg-background shadow-sm transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</SliderPrimitive.Root>
	);
}

export { Slider };
