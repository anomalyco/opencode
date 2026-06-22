import type { ReactNode } from "react"

// 図・スクショ・動画の「差し込み枠」。実素材がまだ無くてもレイアウトが
// 完成するよう、プレースホルダ（破線ボーダー + ラベル）を表示する。
// 素材が用意できたら children に <img> / <video muted loop playsInline
// autoPlay poster> 等を渡せば、そのまま枠内に表示される。

const ASPECT: Record<string, string> = {
  video: "aspect-video", // 16:9
  square: "aspect-square",
  wide: "aspect-[2/1]",
}

export function LpMediaSlot({
  label = "イメージ（準備中）",
  aspect = "video",
  caption,
  children,
}: {
  label?: string
  aspect?: "video" | "square" | "wide"
  caption?: string
  children?: ReactNode
}) {
  return (
    <figure className="w-full">
      <div
        className={`relative w-full overflow-hidden rounded-2xl ${ASPECT[aspect]} ${
          children
            ? "border border-slate-200 bg-slate-50 shadow-sm"
            : "border-2 border-dashed border-slate-300 bg-slate-50"
        }`}
      >
        {children ?? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
            <svg
              className="size-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="9" r="1.5" />
              <path d="m21 15-5-5-9 8" />
            </svg>
            <span className="text-xs font-medium">{label}</span>
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-xs text-slate-400">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
