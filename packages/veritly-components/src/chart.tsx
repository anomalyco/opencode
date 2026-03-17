import { createEffect, createMemo, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";

export interface ChartDataset {
	label: string;
	data: number[];
	color?: string;
}

export interface ChartData {
	labels: string[];
	datasets: ChartDataset[];
}

export type ChartType = "line" | "bar" | "radar";
export type AreaRange = "7d" | "30d" | "90d";

export interface AreaPoint {
	date: string;
	desktop: number;
	mobile: number;
}

const COLOR = ["#06b6d4", "#f43f5e", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899"];

function parse(raw: ChartData | string): ChartData | null {
	try {
		if (typeof raw === "string") return JSON.parse(raw) as ChartData;
		return raw;
	} catch {
		return null;
	}
}

function num(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function chartColor(ds: ChartDataset, i: number): string {
	return ds.color || COLOR[i % COLOR.length];
}

function days(range: AreaRange): number {
	if (range === "7d") return 7;
	if (range === "30d") return 30;
	return 90;
}

function parseArea(raw: AreaPoint[] | string): AreaPoint[] | null {
	try {
		if (typeof raw === "string") return JSON.parse(raw) as AreaPoint[];
		return raw;
	} catch {
		return null;
	}
}

function sample(days = 120): AreaPoint[] {
	const out: AreaPoint[] = [];
	const end = new Date();
	end.setHours(0, 0, 0, 0);
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(end);
		d.setDate(end.getDate() - i);
		const desktop = Math.round(170 + Math.sin(i / 4.2) * 110 + (i % 9) * 14 + (i % 5) * 9);
		const mobile = Math.round(130 + Math.cos(i / 5.6) * 90 + (i % 7) * 11 + (i % 4) * 7);
		out.push({
			date: d.toISOString().slice(0, 10),
			desktop: Math.max(20, desktop),
			mobile: Math.max(20, mobile),
		});
	}
	return out;
}

export function Chart(props: { data?: ChartData | string; type?: ChartType }): JSX.Element {
	const data = createMemo(() => {
		if (!props.data) return null;
		return parse(props.data);
	});
	const kind = createMemo<ChartType>(() => props.type || "line");
	let node: HTMLDivElement | undefined;
	let chart: { destroy: () => void; render: () => Promise<unknown> } | undefined;

	createEffect(() => {
		const d = data();
		const el = node;
		if (!d) return;
		if (!el) return;

		let stop = false;

		void import("apexcharts").then(async (mod) => {
			if (stop) return;
			const Apex = mod.default;
			const common = {
				chart: {
					type: kind(),
					background: "transparent",
					foreColor: "#cbd5e1",
					toolbar: { show: false },
					animations: { enabled: true, speed: 550 },
				},
				theme: { mode: "dark" as const },
				stroke: { curve: "smooth" as const, width: kind() === "bar" ? 0 : 3 },
				fill: { opacity: kind() === "radar" ? 0.18 : 0.9 },
				dataLabels: { enabled: false },
				legend: {
					show: true,
					position: "bottom" as const,
					labels: { colors: "#cbd5e1" },
					itemMargin: { horizontal: 10, vertical: 2 },
				},
				tooltip: {
					theme: "dark" as const,
					y: {
						formatter: (v: number) => num(v),
					},
				},
				grid: { borderColor: "#334155" },
				series: d.datasets.map((ds, i) => ({
					name: ds.label,
					data: ds.data,
					color: chartColor(ds, i),
				})),
				labels: d.labels,
				xaxis: {
					categories: d.labels,
					labels: { style: { colors: "#94a3b8" } },
				},
				yaxis: {
					labels: {
						style: { colors: "#94a3b8" },
						formatter: (v: number) => num(v),
					},
				},
				plotOptions: {
					bar: {
						borderRadius: 4,
						columnWidth: "58%",
					},
					radar: {
						polygons: {
							strokeColors: "#334155",
							connectorColors: "#334155",
							fill: { colors: ["#0f172a", "#111827"] },
						},
					},
				},
				markers: { size: kind() === "line" ? 3 : 0 },
				responsive: [
					{
						breakpoint: 700,
						options: {
							legend: { position: "bottom" as const },
							chart: { height: 300 },
						},
					},
				],
			};

			chart?.destroy();
			const inst = new Apex(el, {
				...common,
				chart: {
					...common.chart,
					height: kind() === "radar" ? 360 : 320,
				},
			});
			chart = inst;
			await inst.render();
		});

		onCleanup(() => {
			stop = true;
			chart?.destroy();
			chart = undefined;
		});
	});

	return (
		<div class="my-6 rounded-xl bg-slate-800/60 border border-slate-700 p-4 overflow-hidden">
			{(() => {
				const d = data();
				if (!d) return <div class="text-sm text-slate-400 italic">Unable to render chart (invalid data)</div>;
				return (
					<div class="w-full min-h-[320px]">
						<div ref={node} class="w-full h-[320px]" />
					</div>
				);
			})()}
		</div>
	);
}

export function LineChart(props: { data?: ChartData | string }) {
	return <Chart data={props.data} type="line" />;
}

export function BarChart(props: { data?: ChartData | string }) {
	return <Chart data={props.data} type="bar" />;
}

export function RadarChart(props: { data?: ChartData | string }) {
	return <Chart data={props.data} type="radar" />;
}

export function ChartAreaInteractive(props: {
	data?: AreaPoint[] | string;
	title?: string;
	description?: string;
	defaultRange?: AreaRange;
}) {
	const data = createMemo(() => {
		if (!props.data) return sample();
		const parsed = parseArea(props.data);
		return parsed && parsed.length > 0 ? parsed : sample();
	});

	const [range, setRange] = createSignal<AreaRange>(props.defaultRange || "90d");
	const filtered = createMemo(() => {
		const src = [...data()].sort((a, b) => +new Date(a.date) - +new Date(b.date));
		if (src.length === 0) return src;
		const ref = new Date(src[src.length - 1].date);
		ref.setHours(0, 0, 0, 0);
		const start = new Date(ref);
		start.setDate(ref.getDate() - days(range()));
		return src.filter((x) => new Date(x.date) >= start);
	});

	let node: HTMLDivElement | undefined;
	let chart: { destroy: () => void; render: () => Promise<unknown> } | undefined;

	createEffect(() => {
		const el = node;
		const src = filtered();
		if (!el || src.length === 0) return;
		let stop = false;

		void import("apexcharts").then(async (mod) => {
			if (stop) return;
			const Apex = mod.default;
			const series = [
				{
					name: "Mobile",
					data: src.map((x) => [new Date(x.date).getTime(), x.mobile]),
					color: "#06b6d4",
				},
				{
					name: "Desktop",
					data: src.map((x) => [new Date(x.date).getTime(), x.desktop]),
					color: "#8b5cf6",
				},
			];

			chart?.destroy();
			const inst = new Apex(el, {
				chart: {
					type: "area",
					stacked: true,
					height: 280,
					background: "transparent",
					foreColor: "#cbd5e1",
					toolbar: { show: false },
					animations: { enabled: true, speed: 550 },
				},
				theme: { mode: "dark" as const },
				series,
				xaxis: {
					type: "datetime",
					labels: { style: { colors: "#94a3b8" }, datetimeUTC: false },
				},
				yaxis: {
					labels: {
						style: { colors: "#94a3b8" },
						formatter: (v: number) => num(v),
					},
				},
				grid: { borderColor: "#334155" },
				dataLabels: { enabled: false },
				stroke: { curve: "smooth", width: 2.6 },
				fill: {
					type: "gradient",
					gradient: {
						shadeIntensity: 0.35,
						opacityFrom: 0.72,
						opacityTo: 0.12,
						stops: [5, 95],
					},
				},
				markers: { size: 0 },
				tooltip: {
					theme: "dark",
					x: { format: "MMM dd, yyyy" },
					y: { formatter: (v: number) => num(v) },
				},
				legend: {
					show: true,
					position: "bottom",
					labels: { colors: "#cbd5e1" },
					itemMargin: { horizontal: 10, vertical: 2 },
				},
			});
			chart = inst;
			await inst.render();
		});

		onCleanup(() => {
			stop = true;
			chart?.destroy();
			chart = undefined;
		});
	});

	return (
		<div class="my-6 rounded-xl bg-slate-800/60 border border-slate-700 overflow-hidden">
			<div class="px-4 py-3 border-b border-slate-700/80 flex items-center justify-between gap-3">
				<div>
					<div class="text-sm font-medium text-slate-100">{props.title || "Area Chart - Interactive"}</div>
					<div class="text-xs text-slate-400">{props.description || "Showing total visitors for the last 3 months"}</div>
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						data-component="button"
						data-variant={range() === "90d" ? "secondary" : "ghost"}
						data-size="small"
						onClick={() => setRange("90d")}
					>
						90d
					</button>
					<button
						type="button"
						data-component="button"
						data-variant={range() === "30d" ? "secondary" : "ghost"}
						data-size="small"
						onClick={() => setRange("30d")}
					>
						30d
					</button>
					<button
						type="button"
						data-component="button"
						data-variant={range() === "7d" ? "secondary" : "ghost"}
						data-size="small"
						onClick={() => setRange("7d")}
					>
						7d
					</button>
				</div>
			</div>
			<div class="px-2 pt-3 pb-2 sm:px-4">
				<div ref={node} class="w-full h-[280px]" />
			</div>
		</div>
	);
}
