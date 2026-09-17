import { createUniqueId, type ComponentProps } from "solid-js"


export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="white" stop-opacity="1" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <mask id={mask}>
          <rect x="0" y="0" width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
      </defs>
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <text
            x="360"
            y="102"
            text-anchor="middle"
            font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
            font-size="104"
            font-weight="600"
            letter-spacing="8"
            fill="currentColor"
            opacity="0.7"
          >
            中央民族大学
          </text>
        </g>
      </g>
    </svg>
  )
}
