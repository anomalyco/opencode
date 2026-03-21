import type { FileContent } from "@opencode-ai/sdk/v2"
import LuckyExcel from "@mertdeveci55/univer-import-export"
import { UniverInstanceType } from "@univerjs/core"
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core"
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US"
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets"
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import "@univerjs/preset-sheets-core/lib/index.css"
import { useTheme } from "@opencode-ai/ui/theme"
import { useSDK } from "@/context/sdk"

type Props = {
	filePath?: string
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes.buffer
}

function fileNameFromPath(p: string): string {
	const normalized = p.replace(/\\/g, "/")
	const i = normalized.lastIndexOf("/")
	return i >= 0 ? normalized.slice(i + 1) : normalized
}

function fileContentToArrayBuffer(content: FileContent): ArrayBuffer {
	if (content.type === "binary") {
		if (content.encoding !== "base64") {
			throw new Error("Cannot read binary file without base64 encoding")
		}
		return base64ToArrayBuffer(content.content)
	}
	const encoded = new TextEncoder().encode(content.content)
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
}

function isCsvPath(p: string): boolean {
	return /\.csv$/i.test(p)
}

export function SpreadsheetViewer(props: Props) {
	const sdk = useSDK()
	const theme = useTheme()
	const [host, setHost] = createSignal<HTMLDivElement | undefined>()
	const [error, setError] = createSignal<string | null>(null)
	const [loading, setLoading] = createSignal(false)

	let runtime: ReturnType<typeof createUniver> | null = null
	let activeUnitId: string | null = null
	let loadSeq = 0

	createEffect(() => {
		const el = host()
		if (!el || typeof window === "undefined") return

		const instance = createUniver({
			locale: LocaleType.EN_US,
			locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
			presets: [
				UniverSheetsCorePreset({
					container: el,
					header: true,
					toolbar: true,
					ribbonType: "classic",
					formulaBar: true,
					// @ts-expect-error sheets-ui types omit boolean `true`; matches Univer examples / user config
					footer: true,
				}),
			],
		})
		runtime = instance

		onCleanup(() => {
			activeUnitId = null
			instance.univer.dispose()
			runtime = null
		})
	})

	createEffect(() => {
		const el = host()
		if (!el || typeof window === "undefined") return
		const current = runtime
		if (!current) return
		const dark = theme.mode() === "dark"
		current.univerAPI.toggleDarkMode(dark)
	})

	createEffect(
		on(
			[() => host(), () => props.filePath],
			async ([el, path]) => {
				if (!el || !path) return
				const current = runtime
				if (!current) return

				setLoading(true)
				setError(null)

				const seq = ++loadSeq
				const stale = () => seq !== loadSeq || runtime !== current

				try {
					const response = await sdk.client.file.read({ path })
					if (stale()) return

					if (response.error) {
						setError(String(response.error))
						return
					}

					const content = response.data
					if (!content) {
						setError("Failed to load file")
						return
					}

					const name = fileNameFromPath(path)
					const { univer, univerAPI } = current

					if (activeUnitId) {
						univerAPI.disposeUnit(activeUnitId)
						activeUnitId = null
					}

					const applyWorkbook = (data: { id: string }) => {
						if (stale()) return
						activeUnitId = data.id
						univer.createUnit(UniverInstanceType.UNIVER_SHEET, data)
					}

					if (isCsvPath(path)) {
						const buf = fileContentToArrayBuffer(content)
						const file = new File([buf], name, { type: "text/csv;charset=utf-8" })
						await new Promise<void>((resolve) => {
							LuckyExcel.transformCsvToUniver(
								file,
								(univerData) => {
									applyWorkbook(univerData)
									resolve()
								},
								(err) => {
									console.error("CSV import error:", err)
									setError(err.message)
									resolve()
								},
							)
						})
					} else {
						if (content.type === "binary" && content.encoding !== "base64") {
							setError("Cannot read binary file")
							return
						}
						const buf = fileContentToArrayBuffer(content)
						const file = new File([buf], name, {
							type:
								content.mimeType ??
								"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
						})
						await LuckyExcel.transformExcelToUniver(
							file,
							(univerData) => applyWorkbook(univerData),
							(err) => {
								console.error("Import error:", err)
								setError(err.message)
							},
						)
					}

				} catch (e) {
					if (stale()) return
					setError(e instanceof Error ? e.message : "Failed to load spreadsheet")
				} finally {
					if (!stale()) setLoading(false)
				}
			},
		),
	)

	return (
		<div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
			<Show when={loading()}>
				<div class="text-muted-foreground shrink-0 text-sm">Loading spreadsheet…</div>
			</Show>
			<Show when={error()}>
				{(err) => <div class="text-destructive shrink-0 text-sm">{err()}</div>}
			</Show>
			<div ref={setHost} class="min-h-[min(480px,70dvh)] w-full min-w-0 flex-1" />
		</div>
	)
}
