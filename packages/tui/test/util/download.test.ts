import { describe, expect, test } from "bun:test"
import {
  downloadDetail,
  downloadPercent,
  downloadProgressBar,
  formatDownloadBytes,
  parseDownloadProgress,
  type DownloadProgress,
} from "../../src/util/download"

function progress(input: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    phase: "downloading",
    url: "https://example.com/archive.zip",
    filePath: "/tmp/archive.zip",
    receivedBytes: 50 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    percent: 50,
    bytesPerSecond: 10 * 1024 * 1024,
    elapsedMs: 5000,
    ...input,
  }
}

describe("download display", () => {
  test("parses metadata and renders a determinate progress bar", () => {
    const value = parseDownloadProgress(progress())
    expect(value).toBeDefined()
    expect(downloadPercent(value!)).toBe(50)
    expect(downloadProgressBar(value!, 10)).toBe("█████░░░░░")
    expect(downloadDetail(value!)).toBe("50.0 MiB / 100 MiB · 10.0 MiB/s · 5s remaining")
  })

  test("renders an animated indeterminate bar when content length is unknown", () => {
    const first = progress({ totalBytes: undefined, percent: undefined, elapsedMs: 0 })
    const second = progress({ totalBytes: undefined, percent: undefined, elapsedMs: 750 })
    expect(downloadProgressBar(first, 12)).not.toBe(downloadProgressBar(second, 12))
    expect(downloadDetail(first)).toBe("50.0 MiB · 10.0 MiB/s")
  })

  test("formats gigabyte-scale values compactly", () => {
    expect(formatDownloadBytes(1024 ** 3)).toBe("1.00 GiB")
  })
})
