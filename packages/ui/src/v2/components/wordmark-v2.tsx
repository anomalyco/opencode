import { type ComponentProps } from "solid-js"
import { resolveBrand } from "@opencode-ai/brand"

// 校园 Harness: 文字水印品牌化 —— muc：mucode（民大红渐变）；hubu：HUBU AI（深湖大绿→青铜金渐变）。
// 保留原组件 API（props.class）；渲染层用 class 控制颜色时可改回 currentColor。

const brand = resolveBrand()

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const isHubu = brand.id === "hubu"
  const gradId = isHubu ? "hubu-fade" : "mucode-fade"
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        {isHubu ? (
          <linearGradient id="hubu-fade" x1="360" y1="30" x2="360" y2="129" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#135440" />
            <stop offset="100%" stop-color="#BC9D53" />
          </linearGradient>
        ) : (
          <linearGradient id="mucode-fade" x1="360" y1="30" x2="360" y2="129" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#AC0E0F" />
            <stop offset="100%" stop-color="#C9736F" />
          </linearGradient>
        )}
      </defs>
      <text
        x="360"
        y="104"
        text-anchor="middle"
        font-family="'Inter','PingFang SC','Hiragino Sans GB',sans-serif"
        font-size={isHubu ? "118" : "128"}
        font-weight="800"
        letter-spacing="-2"
        fill={`url(#${gradId})`}
      >
        {isHubu ? "HUBU AI" : "mucode"}
      </text>
    </svg>
  )
}
