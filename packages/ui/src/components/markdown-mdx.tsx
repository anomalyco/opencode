/**
 * MDX Markdown component - renders markdown with JSX component support
 *
 * This component replaces the standard marked-based rendering with MDX,
 * allowing embedded components like <Chart /> in markdown content.
 */

import { type ComponentProps, createResource, Show, splitProps, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { evaluate } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import * as runtime from "solid-js/h/jsx-runtime";
import { BarChart, Chart, ChartAreaInteractive, LineChart, RadarChart } from "@veritly/components";

// Components available in MDX
const mdxComponents = {
	Chart,
	ChartAreaInteractive,
	LineChart,
	BarChart,
	RadarChart,
};

async function compileMdx(markdown: string): Promise<(() => JSX.Element) | null> {
	try {
		const evaluated = await evaluate(markdown, {
			...(runtime as any),
			remarkPlugins: [remarkGfm],
			useMDXComponents: () => mdxComponents as any,
		});
		return evaluated.default as unknown as () => JSX.Element;
	} catch (err) {
		console.error("MDX compilation error:", err);
		return null;
	}
}

export function MarkdownMdx(
	props: ComponentProps<"div"> & {
		text: string;
		class?: string;
		classList?: Record<string, boolean>;
	},
) {
	const [local, others] = splitProps(props, ["text", "class", "classList"]);

	const [Content] = createResource(
		() => local.text,
		(markdown) => compileMdx(markdown),
		{ initialValue: isServer ? null : null },
	);

	return (
		<div
			data-component="markdown"
			data-renderer="mdx"
			classList={{
				...(local.classList ?? {}),
				[local.class ?? ""]: !!local.class,
			}}
			{...others}
		>
			<Show when={Content()}>
				{(() => {
					const Component = Content();
					if (!Component) return null;
					return <Component />;
				})()}
			</Show>
		</div>
	);
}

export { BarChart, Chart, ChartAreaInteractive, LineChart, RadarChart };
export type { AreaPoint, AreaRange, ChartData, ChartDataset, ChartType } from "@veritly/components";
