import { createMemo, For } from "solid-js";
import type { JSX } from "solid-js";

export interface ChartDataset {
	label: string;
	data: number[];
	color?: string;
}

export interface ChartData {
	labels: string[];
	datasets: ChartDataset[];
}

const DEFAULT_COLORS = ["#06b6d4", "#f43f5e", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899"];

const CHART_PADDING = { top: 24, right: 24, bottom: 48, left: 56 };
const CHART_WIDTH = 600;
const CHART_HEIGHT = 300;

function parseChartData(raw: ChartData | string): ChartData | null {
	try {
		if (typeof raw === "string") {
			return JSON.parse(raw) as ChartData;
		}
		return raw;
	} catch {
		return null;
	}
}

export function Chart(props: { data?: ChartData | string; type?: "line" | "bar" }): JSX.Element {
	const chartData = createMemo(() => {
		if (!props.data) return null;
		return parseChartData(props.data);
	});

	const plotArea = createMemo(() => ({
		x: CHART_PADDING.left,
		y: CHART_PADDING.top,
		width: CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right,
		height: CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom,
	}));

	const yRange = createMemo(() => {
		const d = chartData();
		if (!d) return { min: 0, max: 1 };
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const ds of d.datasets) {
			for (const v of ds.data) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
		if (min === max) {
			min -= 1;
			max += 1;
		}
		const padding = (max - min) * 0.1;
		return { min: min - padding, max: max + padding };
	});

	const yTicks = createMemo(() => {
		const { min, max } = yRange();
		const count = 5;
		const step = (max - min) / (count - 1);
		return Array.from({ length: count }, (_, i) => min + step * i);
	});

	function toX(index: number, total: number): number {
		const area = plotArea();
		if (total <= 1) return area.x + area.width / 2;
		return area.x + (index / (total - 1)) * area.width;
	}

	function toY(value: number): number {
		const area = plotArea();
		const { min, max } = yRange();
		const ratio = (value - min) / (max - min);
		return area.y + area.height - ratio * area.height;
	}

	function polyline(data: number[]): string {
		return data.map((v, i) => `${toX(i, data.length)},${toY(v)}`).join(" ");
	}

	const isBar = createMemo(() => props.type === "bar");

	function formatNumber(n: number): string {
		if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return n % 1 === 0 ? String(n) : n.toFixed(1);
	}

	return (
		<div class="my-6 rounded-xl bg-slate-800/60 border border-slate-700 p-4 overflow-x-auto">
			{(() => {
				const d = chartData();
				if (!d) {
					return <div class="text-sm text-slate-400 italic">Unable to render chart (invalid data)</div>;
				}

				return (
					<>
						<svg
							viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
							class="w-full max-w-[600px] mx-auto"
							xmlns="http://www.w3.org/2000/svg"
							role="img"
							aria-label="Data chart"
						>
							<For each={yTicks()}>
								{(tick) => (
									<g>
										<line
											x1={plotArea().x}
											y1={toY(tick)}
											x2={plotArea().x + plotArea().width}
											y2={toY(tick)}
											stroke="#334155"
											stroke-width="1"
										/>
										<text x={plotArea().x - 8} y={toY(tick) + 4} text-anchor="end" fill="#94a3b8" font-size="11">
											{formatNumber(tick)}
										</text>
									</g>
								)}
							</For>

							<For each={d.labels}>
								{(label, i) => {
									const total = d.labels.length;
									const skip = Math.ceil(total / 12);
									if (i() % skip !== 0) return null;
									return (
										<text x={toX(i(), total)} y={CHART_HEIGHT - 8} text-anchor="middle" fill="#94a3b8" font-size="10">
											{label.length > 8 ? `${label.slice(0, 8)}…` : label}
										</text>
									);
								}}
							</For>

							<For each={d.datasets}>
								{(dataset, dsIdx) => {
									const color = () => dataset.color || DEFAULT_COLORS[dsIdx() % DEFAULT_COLORS.length];

									if (isBar()) {
										const total = d.labels.length;
										const dsCount = d.datasets.length;
										const groupWidth = plotArea().width / total;
										const barWidth = (groupWidth * 0.7) / dsCount;

										return (
											<For each={dataset.data}>
												{(value, i) => {
													const x = () => toX(i(), total) - (groupWidth * 0.7) / 2 + dsIdx() * barWidth;
													const barHeight = () => plotArea().y + plotArea().height - toY(value);
													return (
														<rect
															x={x()}
															y={toY(value)}
															width={barWidth - 1}
															height={Math.max(0, barHeight())}
															fill={color()}
															opacity="0.85"
															rx="2"
														/>
													);
												}}
											</For>
										);
									}

									return (
										<>
											<polyline
												points={polyline(dataset.data)}
												fill="none"
												stroke={color()}
												stroke-width="2.5"
												stroke-linejoin="round"
												stroke-linecap="round"
											/>
											<For each={dataset.data}>
												{(value, i) => (
													<circle cx={toX(i(), dataset.data.length)} cy={toY(value)} r="3" fill={color()} />
												)}
											</For>
										</>
									);
								}}
							</For>
						</svg>

						<div class="flex flex-wrap gap-4 justify-center mt-3">
							<For each={d.datasets}>
								{(dataset, dsIdx) => (
									<div class="flex items-center gap-1.5 text-xs text-slate-300">
										<span
											class="inline-block w-3 h-3 rounded-sm"
											style={{
												"background-color": dataset.color || DEFAULT_COLORS[dsIdx() % DEFAULT_COLORS.length],
											}}
										/>
										{dataset.label}
									</div>
								)}
							</For>
						</div>
					</>
				);
			})()}
		</div>
	);
}
