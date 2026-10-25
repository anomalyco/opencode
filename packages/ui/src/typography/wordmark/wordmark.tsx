import { createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              opacity="0.7"
              d="M277.385 36.8571H240.462V92.1429H277.385V36.8571ZM295.846 110.571H222V0H240.462V18.4286H295.846V110.571Z"
              fill="currentColor"
            />
            <path
              opacity="0.7"
              d="M369.385 36.4286H332.462V91.7143H369.385V36.4286ZM387.846 110.143H314V18H387.846V110.143Z"
              fill="currentColor"
            />
            <path opacity="0.7" d="M424.462 110.571H406V0H424.462V110.571Z" fill="currentColor" />
            <path
              opacity="0.7"
              d="M461.462 110.571H443V0H461.462V110.571ZM498.385 36.8571H443V18.4286H498.385V36.8571ZM498.385 110.571H461.462V92.1429H498.385V110.571Z"
              fill="currentColor"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
