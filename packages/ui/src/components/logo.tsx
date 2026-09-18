// 校园 Harness: Mark（侧栏图标）/ Splash（加载态）→ 品牌色圆角方块 + 米白「民/湖」字；
// Logo（首次启动引导页横幅）→ 校名文字。品牌来自 @opencode-ai/brand。
// 保留原组件 API（muc 渲染与历史版本逐字节一致）。

import { type ComponentProps } from "solid-js"
import { resolveBrand } from "@opencode-ai/brand"

const brand = resolveBrand()
const markFill = brand.id === "hubu" ? brand.colors.primary : "#B01F24"
const markGlyph = brand.id === "hubu" ? "湖" : "民"
const markTextFill = brand.id === "hubu" ? "#F2F0E6" : "#FCF1E2"
const logoSchoolName = brand.id === "hubu" ? brand.name : "中央民族大学"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1.5" y="0.5" width="13" height="19" rx="3" fill={markFill} />
      <text
        x="8"
        y="14.3"
        text-anchor="middle"
        font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
        font-size="12"
        font-weight="700"
        fill={markTextFill}
      >
        {markGlyph}
      </text>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="24" y="20" width="32" height="60" rx="6" fill={markFill} />
      <text
        x="40"
        y="62"
        text-anchor="middle"
        font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
        font-size="34"
        font-weight="700"
        fill={markTextFill}
      >
        {markGlyph}
      </text>
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <text
        x="117"
        y="31"
        text-anchor="middle"
        font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
        font-size="32"
        font-weight="600"
        letter-spacing="2"
        fill="var(--icon-strong-base)"
      >
        {logoSchoolName}
      </text>
    </svg>
  )
}
