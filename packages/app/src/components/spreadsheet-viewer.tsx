import * as XLSX from "xlsx";
import {
	createSolidTable,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	flexRender,
	type ColumnDef,
} from "@tanstack/solid-table";
import { createStore } from "solid-js/store";
import { createMemo, For, Show, createEffect, on } from "solid-js";
import { useSDK } from "@/context/sdk";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@opencode-ai/ui/table";
import { Tabs } from "@opencode-ai/ui/tabs";

type Row = Record<string, unknown>;

type Sheet = {
	name: string;
	rows: number;
	cols: number;
	cells: number;
	data: Row[];
	columns: ColumnDef<Row>[];
	blocked: string | null;
};

type Book = {
	sheets: Sheet[];
	blocked: string | null;
};

function size(ref?: string) {
	if (!ref) return { rows: 0, cols: 0, cells: 0 };
	const rng = XLSX.utils.decode_range(ref);
	const rows = rng.e.r - rng.s.r + 1;
	const cols = rng.e.c - rng.s.c + 1;
	return { rows, cols, cells: rows * cols };
}

export async function parseSpreadsheetBuffer(buf: ArrayBuffer): Promise<Book> {
	const book = XLSX.read(buf);
	const meta = book.SheetNames.map((name) => {
		const sheet = book.Sheets[name];
		const info = size(sheet?.["!ref"]);
		return {
			name,
			...info,
			blocked: null,
		};
	});

	return {
		blocked: null,
		sheets: meta.map((item) => {
			const sheet = book.Sheets[item.name];
			const data = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
			return {
				...item,
				data,
				columns: makeColumns(data),
			};
		}),
	};
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer as ArrayBuffer;
}

function makeColumns(rows: Row[]): ColumnDef<Row>[] {
	const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
	return keys.map((key) => ({
		accessorKey: key,
		header: key,
	}));
}

type State = {
	sheets: Sheet[];
	active: string;
	filter: string;
	loading: boolean;
	error: string | null;
	blocked: string | null;
};

type Props = {
	filePath?: string;
};

export function SpreadsheetViewer(props: Props) {
	const sdk = useSDK();

	const [state, setState] = createStore<State>({
		sheets: [],
		active: "",
		filter: "",
		loading: false,
		error: null,
		blocked: null,
	});

	createEffect(
		on(
			() => props.filePath,
			async (path) => {
				if (!path) return;
				setState({ loading: true, error: null, blocked: null, sheets: [], active: "", filter: "" });
				try {
					const response = await sdk.client.file.read({ path });
					const content = response.data;
					if (!content) {
						setState({ error: "Failed to load file", loading: false });
						return;
					}
					if (content.type === "binary" && !content.encoding) {
						setState({ error: "Cannot read binary file", loading: false });
						return;
					}
					let buf: ArrayBuffer;
					if (content.type === "binary" && content.encoding === "base64") {
						buf = base64ToArrayBuffer(content.content);
					} else {
						const encoded = new TextEncoder().encode(content.content);
						buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
					}
					const book = await parseSpreadsheetBuffer(buf);
					setState({
						sheets: book.sheets,
						active: book.sheets.find((sheet) => !sheet.blocked)?.name ?? book.sheets[0]?.name ?? "",
						filter: "",
						loading: false,
						error: null,
						blocked: book.blocked,
					});
				} catch (e) {
					setState({
						error: e instanceof Error ? e.message : "Failed to load file",
						loading: false,
					});
				}
			},
		),
	);

	const sheet = createMemo(() => state.sheets.find((item) => item.name === state.active) ?? state.sheets[0]);

	const table = createMemo(() =>
		createSolidTable({
			get data() {
				return sheet()?.data ?? [];
			},
			get columns() {
				return sheet()?.columns ?? [];
			},
			getCoreRowModel: getCoreRowModel(),
			getSortedRowModel: getSortedRowModel(),
			getFilteredRowModel: getFilteredRowModel(),
			state: {
				get globalFilter() {
					return state.filter;
				},
			},
			onGlobalFilterChange: (updater) => {
				const value = typeof updater === "function" ? updater(state.filter) : updater;
				setState("filter", value);
			},
			globalFilterFn: "includesString",
		}),
	);

	const total = createMemo(() => state.sheets.reduce((sum, item) => sum + item.cells, 0));

	return (
		<div class="flex flex-col gap-4 w-full h-full">
			<Show when={state.loading}>
				<div class="flex items-center justify-center h-full">
					<span class="text-muted-foreground">Loading spreadsheet...</span>
				</div>
			</Show>

			<Show when={state.error}>
				<div class="flex flex-col items-center justify-center h-full gap-2">
					<span class="text-destructive">{state.error}</span>
				</div>
			</Show>

			<Show when={!state.loading && !state.error && state.sheets.length > 0}>
				<Tabs
					value={state.active}
					onChange={(value) => setState({ active: value, filter: "" })}
					class="flex h-full flex-col"
				>
					<div class="flex items-center justify-between gap-4 border-b border-border px-1">
						<Tabs.List class="flex h-10 gap-1">
							<For each={state.sheets}>
								{(item) => (
									<Tabs.Trigger
										value={item.name}
										class="shrink-0"
										classes={{
											button:
												"h-9 px-3 text-sm font-medium transition-colors hover:text-foreground data-[selected]:text-foreground data-[selected]:border-b-2 data-[selected]:border-foreground",
										}}
									>
										<span class="max-w-[160px] truncate">{item.name}</span>
									</Tabs.Trigger>
								)}
							</For>
						</Tabs.List>

						<Show when={!state.blocked && sheet() && !sheet()?.blocked}>
							<input
								type="text"
								placeholder="Filter rows..."
								value={state.filter}
								onInput={(e) => setState("filter", e.currentTarget.value)}
								class="h-8 w-[180px] rounded-md border border-input bg-background px-3 text-sm"
							/>
						</Show>
					</div>

					<Show when={state.blocked}>
						<div class="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-muted-foreground">
							<div class="font-medium text-foreground">Preview skipped</div>
							<div>{state.blocked}</div>
						</div>
					</Show>

					<Show when={sheet()}>
						{(item) => (
							<div class="mt-4 flex flex-col gap-3">
								<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
									<span>
										{item().rows.toLocaleString()} rows · {item().cols.toLocaleString()} cols ·{" "}
										{item().cells.toLocaleString()} cells
									</span>
								</div>

								<Show when={item().blocked && !state.blocked}>
									<div class="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-muted-foreground">
										<div class="font-medium text-foreground">Sheet preview skipped</div>
										<div>{item().blocked}</div>
									</div>
								</Show>

								<Show when={!state.blocked && !item().blocked && item().data.length === 0}>
									<div class="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
										No rows to preview in this sheet.
									</div>
								</Show>

								<Show when={!state.blocked && !item().blocked && item().data.length > 0}>
									<div class="rounded-md border">
										<Table>
											<TableHeader>
												<For each={table().getHeaderGroups()}>
													{(headerGroup) => (
														<TableRow>
															<For each={headerGroup.headers}>
																{(header) => (
																	<TableHead
																		class="cursor-pointer select-none"
																		onClick={header.column.getToggleSortingHandler()}
																	>
																		<div class="flex items-center gap-2">
																			{flexRender(header.column.columnDef.header, header.getContext())}
																			<Show when={header.column.getIsSorted() === "asc"}>
																				<span class="text-xs">↑</span>
																			</Show>
																			<Show when={header.column.getIsSorted() === "desc"}>
																				<span class="text-xs">↓</span>
																			</Show>
																		</div>
																	</TableHead>
																)}
															</For>
														</TableRow>
													)}
												</For>
											</TableHeader>
											<TableBody>
												<For each={table().getRowModel().rows}>
													{(row) => (
														<TableRow>
															<For each={row.getVisibleCells()}>
																{(cell) => (
																	<TableCell>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
																)}
															</For>
														</TableRow>
													)}
												</For>
											</TableBody>
										</Table>
									</div>

									<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
										<span>
											{table().getRowModel().rows.length.toLocaleString()} of {item().data.length.toLocaleString()} rows
										</span>
										<Show when={state.filter}>
											<span>Filtered by: "{state.filter}"</span>
										</Show>
									</div>
								</Show>
							</div>
						)}
					</Show>
				</Tabs>
			</Show>
		</div>
	);
}
