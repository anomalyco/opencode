# MDX Chart Examples

These examples are valid with `MarkdownMdx` and the built-in components:
`Chart`, `LineChart`, `BarChart`, `RadarChart`, and `ChartAreaInteractive`.

## 1) Generic line chart

<Chart type="line" data='{"labels":["Jan","Feb","Mar","Apr","May"],"datasets":[{"label":"Revenue","data":[12000,15600,14100,18900,21000],"color":"#06b6d4"},{"label":"Cost","data":[9000,10400,9900,12100,14200],"color":"#f43f5e"}]}' />

## 2) Explicit line chart component

<LineChart data='{"labels":["Mon","Tue","Wed","Thu","Fri"],"datasets":[{"label":"Latency (ms)","data":[240,198,210,186,172]}]}' />

## 3) Bar chart

<BarChart data='{"labels":["Auth","Search","Ingest","Export"],"datasets":[{"label":"Desktop","data":[186,305,237,73],"color":"#3b82f6"},{"label":"Mobile","data":[80,200,120,190],"color":"#10b981"}]}' />

## 4) Radar chart (shadcn-style)

<RadarChart data='{"labels":["Performance","Reliability","Security","DX","Docs","Testing"],"datasets":[{"label":"Current","data":[72,81,78,69,64,71],"color":"#8b5cf6"},{"label":"Target","data":[85,90,88,84,82,86],"color":"#f59e0b"}]}' />

## 5) Generic chart in radar mode

<Chart type="radar" data='{"labels":["API","UI","CLI","Infra","QA"],"datasets":[{"label":"Coverage","data":[68,74,59,81,65],"color":"#ec4899"}]}' />

## 6) Invalid data example (fallback)

```mdx
<RadarChart data="not-json" />
```

## 7) Professional interactive area chart (shadcn-like)

<ChartAreaInteractive />

## 8) Interactive area chart with custom title

<ChartAreaInteractive title="Traffic Trends" description="Desktop vs mobile over time" defaultRange="30d" />

