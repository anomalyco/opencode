export type ProgressStage = "checking" | "downloading" | "installing" | "complete" | "failed"

export interface DownloadProgress {
  stage: "downloading"
  version: string
  downloaded: number
  total: number
  speed?: number
  percentage: number
}

export interface InstallationProgress {
  stage: "checking" | "installing" | "complete" | "failed"
  version?: string
  message?: string
}

export type ProgressCallback = (progress: DownloadProgress | InstallationProgress) => void

export function formatProgress(progress: DownloadProgress | InstallationProgress): string {
  switch (progress.stage) {
    case "checking":
      return "Checking for updates..."
    case "downloading": {
      const percentage = progress.percentage.toFixed(0)
      const mb = (progress.total / 1024 / 1024).toFixed(1)
      const speed = progress.speed ? `${(progress.speed / 1024 / 1024).toFixed(1)} MB/s` : ""
      const speedStr = speed ? `, ${speed}` : ""
      return `Downloading ${progress.version} (${percentage}%, ${mb} MB${speedStr})`
    }
    case "installing":
      return "Installing..."
    case "complete":
      return "Upgrade complete"
    case "failed":
      return progress.message || "Upgrade failed"
  }
}