/* [fork-only] DeskFox 品牌 logo,不与 anomalyco/opencode 上游同步 */
/* SVG 路径数据 verbatim 来自 D:\Kbase\奇思妙想\opencode\品牌设计\{icon-naked,icon-primary,icon-mono,icon-favicon,loading,wordmark}.svg */
/* viewBox 跟 user 原 SVG 一致(256×256 / 200×200 / 300×100 / 64×64),内容占满 viewBox 100%; */
/* fill 全部走 css var(在 theme.css 定义),light/dark 自动切;严禁 filter:invert(1)(珊瑚 #FF9A7A 会被染青) */

import { Match, Switch, type ComponentProps } from "solid-js"

/**
 * Mark — 狐脸 icon。两种 variant:
 *
 * - **naked**(默认):无容器版,fill 走 css var,自动跟 light/dark 主题切。
 *   适合嵌入任意背景(sidebar / 任意窗口内)。来源:icon-naked.svg。
 * - **branded**:带圆角深底容器,按当前构建 env(`VITE_DESKFOX_ENV` = dev/beta/prod)
 *   选不同样式 — 跟 .exe 任务栏图标一致。固定 hex 色(容器自带深底,不需主题适配)。
 *   - prod → icon-primary 样式(完整 8 元素,正式发布)
 *   - beta → icon-mono     样式(单色,测试阶段)
 *   - dev  → icon-favicon  样式(极简 5 元素,开发调试)
 *
 * 父级 CSS class 控制实际显示像素(如 size-6 = 24px)。
 */
export const Mark = (props: { class?: string; variant?: "naked" | "branded" }) => {
  const env = import.meta.env.VITE_DESKFOX_ENV ?? "dev"
  return (
    <Switch fallback={<MarkNaked class={props.class} />}>
      <Match when={props.variant === "branded" && env === "prod"}>
        <MarkPrimary class={props.class} />
      </Match>
      <Match when={props.variant === "branded" && env === "beta"}>
        <MarkMono class={props.class} />
      </Match>
      <Match when={props.variant === "branded"}>
        {/* dev or unknown env */}
        <MarkFavicon class={props.class} />
      </Match>
    </Switch>
  )
}

const MarkNaked = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    data-variant="naked"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 256 256"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate(128, 132)">
      {/* 双耳:外深 + 内珊瑚 */}
      <path d="M -68,-10 L -36,-72 L -18,-12 Z" fill="var(--logo-text)" />
      <path d="M -56,-20 L -38,-56 L -28,-22 Z" fill="var(--logo-coral)" />
      <path d="M 68,-10 L 36,-72 L 18,-12 Z" fill="var(--logo-text)" />
      <path d="M 56,-20 L 38,-56 L 28,-22 Z" fill="var(--logo-coral)" />
      {/* 脸 */}
      <path d="M -68,-10 L 68,-10 L 0,68 Z" fill="var(--logo-text)" />
      {/* 嘴 */}
      <path d="M -22,18 L 22,18 L 0,52 Z" fill="var(--logo-text-secondary)" />
      {/* 圆眼 */}
      <circle cx="-22" cy="4" r="5" fill="var(--logo-eye)" />
      <circle cx="22" cy="4" r="5" fill="var(--logo-eye)" />
    </g>
  </svg>
)

const MarkPrimary = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    data-variant="primary"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="dfMarkPrimaryBg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#243353" />
        <stop offset="100%" stop-color="#172238" />
      </linearGradient>
      <linearGradient id="dfMarkPrimaryFace" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#9DBBE3" />
        <stop offset="100%" stop-color="#7295C4" />
      </linearGradient>
    </defs>
    <rect width="256" height="256" rx="56" fill="url(#dfMarkPrimaryBg)" />
    <g transform="translate(128, 132)">
      <path d="M -68,-10 L -36,-72 L -18,-12 Z" fill="#7295C4" />
      <path d="M -56,-20 L -38,-56 L -28,-22 Z" fill="#FF9A7A" />
      <path d="M 68,-10 L 36,-72 L 18,-12 Z" fill="#7295C4" />
      <path d="M 56,-20 L 38,-56 L 28,-22 Z" fill="#FF9A7A" />
      <path d="M -68,-10 L 68,-10 L 0,68 Z" fill="url(#dfMarkPrimaryFace)" />
      <path d="M -22,18 L 22,18 L 0,52 Z" fill="#F4F7FB" />
      <circle cx="-22" cy="4" r="5" fill="#172238" />
      <circle cx="22" cy="4" r="5" fill="#172238" />
    </g>
  </svg>
)

const MarkMono = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    data-variant="mono"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="256" height="256" rx="56" fill="#1F2D44" />
    <g transform="translate(128, 132)" fill="#F4F7FB">
      <path d="M -68,-10 L -36,-72 L -18,-12 Z" />
      <path d="M 68,-10 L 36,-72 L 18,-12 Z" />
      <path d="M -68,-10 L 68,-10 L 0,68 Z" />
    </g>
    <g transform="translate(128, 132)" fill="#1F2D44">
      <path d="M -22,18 L 22,18 L 0,52 Z" />
      <circle cx="-22" cy="4" r="5" />
      <circle cx="22" cy="4" r="5" />
    </g>
  </svg>
)

const MarkFavicon = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    data-variant="favicon"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 64 64"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="64" height="64" rx="14" fill="#1F2D44" />
    <g transform="translate(32, 34)">
      <path d="M -19,-3 L -10,-21 L -5,-3 Z" fill="#7295C4" />
      <path d="M 19,-3 L 10,-21 L 5,-3 Z" fill="#7295C4" />
      <path d="M -19,-3 L 19,-3 L 0,18 Z" fill="#9DBBE3" />
      <circle cx="-7" cy="3" r="2" fill="#172238" />
      <circle cx="7" cy="3" r="2" fill="#172238" />
    </g>
  </svg>
)

/**
 * Splash — 启动屏 loading 动效,3 三角围绕中心旋转 + 中心固定小三角。
 * 来源:loading.svg(SMIL 动画 type=rotate,各三角 phase 错开 120°),viewBox 200×200 verbatim。
 */
export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(100, 100)">
        {/* 三角 1 - 顶部,蓝 */}
        <g>
          <path d="M -22,-40 L 22,-40 L 0,-12 Z" fill="var(--logo-text-secondary)">
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="0;360"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        </g>
        {/* 三角 2 - 右下,珊瑚 */}
        <g>
          <path d="M 12,8 L 48,28 L 24,42 Z" fill="var(--logo-coral)">
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="120;480"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        </g>
        {/* 三角 3 - 左下,亮蓝 */}
        <g>
          <path d="M -12,8 L -48,28 L -24,42 Z" fill="var(--logo-text-accent)">
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="240;600"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        </g>
        {/* 中心固定小三角 - 主色 */}
        <path d="M -6,-4 L 6,-4 L 0,6 Z" fill="var(--logo-text)" />
      </g>
    </svg>
  )
}

/**
 * Logo — 纯 wordmark "DeskFoX"(X 由 3 三角拼成,珊瑚色点缀)。
 * 来源:wordmark.svg verbatim,viewBox 300×100。
 * 用 textLength + lengthAdjust 锁定文字宽度,免受字体回退影响。
 */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 300 100"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g
        font-family="'Inter', 'Segoe UI', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif"
        font-weight="800"
      >
        <text
          x="0"
          y="84"
          font-size="72"
          fill="var(--logo-text)"
          textLength="172"
          lengthAdjust="spacingAndGlyphs"
        >
          Desk
        </text>
        <text
          x="172"
          y="84"
          font-size="72"
          fill="var(--logo-text-secondary)"
          textLength="78"
          lengthAdjust="spacingAndGlyphs"
        >
          Fo
        </text>
      </g>
      <g transform="translate(252, 36)">
        <path d="M 0,48 L 0,40 L 38,0 L 38,8 Z" fill="var(--logo-text-secondary)" />
        <path d="M 0,0 L 8,0 L 38,40 L 38,48 Z" fill="var(--logo-text)" />
        <path d="M 14,20 L 24,20 L 19,28 Z" fill="var(--logo-coral)" />
      </g>
    </svg>
  )
}
