/**
 * MDX Content component for rendering MDX with custom components
 *
 * Usage:
 * ```tsx
 * import { MDXContent } from "@veritly/components"
 * import { Chart } from "@veritly/components"
 *
 * <MDXContent content="# Hello\n\n<Chart data={data} />" components={{ Chart }} />
 * ```
 */

import { createResource, Show, type Component, type JSX } from "solid-js";
import { evaluate } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import * as runtime from "solid-js/h/jsx-runtime";
import { BarChart, Chart, ChartAreaInteractive, LineChart, RadarChart } from "./chart";

export {
	BarChart,
	Chart,
	ChartAreaInteractive,
	LineChart,
	RadarChart,
	type AreaPoint,
	type AreaRange,
	type ChartData,
	type ChartDataset,
	type ChartType,
} from "./chart";

export interface MDXComponents {
	Chart?: typeof Chart;
	ChartAreaInteractive?: typeof ChartAreaInteractive;
	LineChart?: typeof LineChart;
	BarChart?: typeof BarChart;
	RadarChart?: typeof RadarChart;
	[key: string]: Component<any> | undefined;
}

export interface MDXContentProps {
	content: string;
	components?: MDXComponents;
}

async function compileMdx(content: string, components: MDXComponents) {
	const evaluated = await evaluate(content, {
		...(runtime as any),
		remarkPlugins: [remarkGfm],
		useMDXComponents: () => components as any,
	});

	return evaluated.default as unknown as Component;
}

export function MDXContent(props: MDXContentProps): JSX.Element {
	const [Content] = createResource(
		() => ({ content: props.content, components: props.components }),
		async ({ content, components }) => {
			try {
				return await compileMdx(content, components || {});
			} catch (err) {
				console.error("MDX compilation error:", err);
				return null;
			}
		},
	);

	return (
		<Show
			when={Content()}
			fallback={
				<div class="prose prose-invert max-w-none">
					<pre class="whitespace-pre-wrap">{props.content}</pre>
				</div>
			}
		>
			{(() => {
				const Component = Content();
				if (!Component) return null;
				return <Component />;
			})()}
		</Show>
	);
}

export const defaultComponents: MDXComponents = {
	Chart,
	ChartAreaInteractive,
	LineChart,
	BarChart,
	RadarChart,
};
