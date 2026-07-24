import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(
  props: Pick<ComponentProps<"svg">, "class"> & { opacity?: number; animated?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()
  const innerOpacity = () => props.opacity ?? 0.16
  const isAnimated = () => props.animated ?? true

  return (
    <div class={`relative inline-flex items-center justify-center group ${props.class ?? ""}`}>
      {/* Embedded Infinite Typewriter & Blinking Cursor Animation */}
      <style>{`
        @keyframes wm-type-o { 0%, 2% { opacity: 0; } 4%, 93% { opacity: 0.7; } 95%, 100% { opacity: 0; } }
        @keyframes wm-type-p { 0%, 5% { opacity: 0; } 7%, 90% { opacity: 0.7; } 92%, 100% { opacity: 0; } }
        @keyframes wm-type-e1 { 0%, 8% { opacity: 0; } 10%, 87% { opacity: 0.7; } 89%, 100% { opacity: 0; } }
        @keyframes wm-type-n { 0%, 11% { opacity: 0; } 13%, 84% { opacity: 0.7; } 86%, 100% { opacity: 0; } }
        @keyframes wm-type-c { 0%, 14% { opacity: 0; } 16%, 81% { opacity: 0.7; } 83%, 100% { opacity: 0; } }
        @keyframes wm-type-o2 { 0%, 17% { opacity: 0; } 19%, 78% { opacity: 0.7; } 80%, 100% { opacity: 0; } }
        @keyframes wm-type-d { 0%, 20% { opacity: 0; } 22%, 75% { opacity: 0.7; } 77%, 100% { opacity: 0; } }
        @keyframes wm-type-e2 { 0%, 23% { opacity: 0; } 25%, 72% { opacity: 0.7; } 74%, 100% { opacity: 0; } }

        @keyframes wm-cursor-track {
          0% { transform: translateX(0px); }
          3.5% { transform: translateX(73px); }
          7.0% { transform: translateX(165px); }
          10.5% { transform: translateX(258px); }
          14.0% { transform: translateX(350px); }
          17.5% { transform: translateX(442px); }
          21.0% { transform: translateX(535px); }
          24.5%, 72% { transform: translateX(725px); }
          75% { transform: translateX(627px); }
          78% { transform: translateX(535px); }
          81% { transform: translateX(442px); }
          84% { transform: translateX(350px); }
          87% { transform: translateX(258px); }
          90% { transform: translateX(165px); }
          93% { transform: translateX(73px); }
          96%, 100% { transform: translateX(0px); }
        }

        @keyframes wm-cursor-blink {
          0%, 45% { opacity: 0.95; }
          50%, 95% { opacity: 0.05; }
        }

        @keyframes wm-aura-glow {
          0%, 100% {
            filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.04));
          }
          50% {
            filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.18));
          }
        }

        .wm-path-o { animation: wm-type-o 5.5s infinite; }
        .wm-path-p { animation: wm-type-p 5.5s infinite; }
        .wm-path-e1 { animation: wm-type-e1 5.5s infinite; }
        .wm-path-n { animation: wm-type-n 5.5s infinite; }
        .wm-path-c { animation: wm-type-c 5.5s infinite; }
        .wm-path-o2 { animation: wm-type-o2 5.5s infinite; }
        .wm-path-d { animation: wm-type-d 5.5s infinite; }
        .wm-path-e2 { animation: wm-type-e2 5.5s infinite; }

        .wm-cursor-group {
          animation: wm-cursor-track 5.5s infinite;
        }
        .wm-cursor-bar {
          animation: wm-cursor-blink 0.6s infinite;
        }
        .animate-wm-aura {
          animation: wm-aura-glow 4s ease-in-out infinite;
        }
      `}</style>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 760 129"
        fill="none"
        class={`w-full h-full transition-transform duration-300 group-hover:scale-[1.02] ${
          isAnimated() ? "animate-wm-aura" : ""
        }`}
      >
        <g opacity="0.6">
          <g mask={`url(#${mask})`}>
            <g opacity={innerOpacity()}>
              {/* Letter 1: O */}
              <path
                class={isAnimated() ? "wm-path-o" : ""}
                opacity="0.7"
                d="M55.3846 36.4286H18.4615V91.7143H55.3846V36.4286ZM73.8462 110.143H0V18H73.8462V110.143Z"
                fill="currentColor"
              />
              {/* Letter 2: P */}
              <path
                class={isAnimated() ? "wm-path-p" : ""}
                opacity="0.7"
                d="M110.462 91.7143H147.385V36.4286H110.462V91.7143ZM165.846 110.143H110.462V128.571H92V18H165.846V110.143Z"
                fill="currentColor"
              />
              {/* Letter 3: E */}
              <path
                class={isAnimated() ? "wm-path-e1" : ""}
                opacity="0.7"
                d="M258.846 73.2857H203.462V91.7143H258.846V110.143H185V18H258.846V73.2857ZM203.462 54.8571H240.385V36.4286H203.462V54.8571Z"
                fill="currentColor"
              />
              {/* Letter 4: N */}
              <path
                class={isAnimated() ? "wm-path-n" : ""}
                opacity="0.7"
                d="M332.385 36.4286H295.462V110.143H277V18H332.385V36.4286ZM350.846 110.143H332.385V36.4286H350.846V110.143Z"
                fill="currentColor"
              />
              {/* Letter 5: C */}
              <path
                class={isAnimated() ? "wm-path-c" : ""}
                opacity="0.7"
                d="M442.846 36.4286H387.462V91.7143H442.846V110.143H369V18H442.846V36.4286Z"
                fill="currentColor"
              />
              {/* Letter 6: O */}
              <path
                class={isAnimated() ? "wm-path-o2" : ""}
                opacity="0.7"
                d="M517.385 36.4286H480.462V91.7143H517.385V36.4286ZM535.846 110.143H462V18H535.846V110.143Z"
                fill="currentColor"
              />
              {/* Letter 7: D */}
              <path
                class={isAnimated() ? "wm-path-d" : ""}
                opacity="0.7"
                d="M609.385 36.8571H572.462V92.1429H609.385V36.8571ZM627.846 110.571H554V18.4286H609.385V0H627.846V110.571Z"
                fill="currentColor"
              />
              {/* Letter 8: E */}
              <path
                class={isAnimated() ? "wm-path-e2" : ""}
                opacity="0.7"
                d="M664.462 36.4286V54.8571H701.385V36.4286H664.462ZM719.846 73.2857H664.462V91.7143H719.846V110.143H646V18H719.846V73.2857Z"
                fill="currentColor"
              />

              {/* Infinite Animated Blinking Cursor Caret */}
              {isAnimated() && (
                <g class="wm-cursor-group">
                  <rect
                    class="wm-cursor-bar"
                    x="2"
                    y="18"
                    width="14"
                    height="92"
                    fill="currentColor"
                  />
                </g>
              )}
            </g>
          </g>
        </g>
        <defs>
          <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="129">
            <rect width="760" height="129" fill={`url(#${maskGradient})`} />
          </mask>
          <linearGradient id={maskGradient} x1="0%" y1="0%" x2="100%" y2="0%" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="white" stop-opacity="0.7" />
            <stop offset="100%" stop-color="white" stop-opacity="0.7" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}
