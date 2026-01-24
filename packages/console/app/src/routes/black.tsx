import { A, createAsync, RouteSectionProps } from "@solidjs/router"
import { Title, Meta, Link } from "@solidjs/meta"
import { createMemo, createSignal } from "solid-js"
import { github } from "~/lib/github"
import { config } from "~/config"
import Spotlight, { defaultConfig, type SpotlightAnimationState } from "~/component/spotlight"
import "./black.css"

export default function BlackLayout(props: RouteSectionProps) {
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()!.stars!)
      : config.github.starsFormatted.compact,
  )

  const [spotlightAnimationState, setSpotlightAnimationState] = createSignal<SpotlightAnimationState>({
    time: 0,
    intensity: 0.5,
    pulseValue: 1,
  })

  const svgLightingValues = createMemo(() => {
    const state = spotlightAnimationState()
    const t = state.time

    const wave1 = Math.sin(t * 1.5) * 0.5 + 0.5
    const wave2 = Math.sin(t * 2.3 + 1.2) * 0.5 + 0.5
    const wave3 = Math.sin(t * 0.8 + 2.5) * 0.5 + 0.5

    const shimmerPos = Math.sin(t * 0.7) * 0.5 + 0.5
    const glowIntensity = Math.max(state.intensity * state.pulseValue * 0.35, 0.15)
    const fillOpacity = Math.max(0.1 + wave1 * 0.08 * state.pulseValue, 0.12)
    const strokeBrightness = Math.max(55 + wave2 * 25 * state.pulseValue, 60)

    const shimmerIntensity = Math.max(wave3 * 0.15 * state.pulseValue, 0.08)

    return {
      glowIntensity,
      fillOpacity,
      strokeBrightness,
      shimmerPos,
      shimmerIntensity,
    }
  })

  const svgLightingStyle = createMemo(() => {
    const values = svgLightingValues()
    return {
      "--hero-black-glow-intensity": values.glowIntensity.toFixed(3),
      "--hero-black-stroke-brightness": `${values.strokeBrightness.toFixed(0)}%`,
    } as Record<string, string>
  })

  const handleAnimationFrame = (state: SpotlightAnimationState) => {
    setSpotlightAnimationState(state)
  }

  const spotlightConfig = () => defaultConfig

  return (
    <div data-page="black">
      <Title>OpenCode Black | Access all the world's best coding models</Title>
      <Meta
        name="description"
        content="Get access to Claude, GPT, Gemini and more with OpenCode Black subscription plans."
      />
      <Link rel="canonical" href={`${config.baseUrl}/black`} />
      <Meta property="og:type" content="website" />
      <Meta property="og:url" content={`${config.baseUrl}/black`} />
      <Meta property="og:title" content="OpenCode Black | Access all the world's best coding models" />
      <Meta
        property="og:description"
        content="Get access to Claude, GPT, Gemini and more with OpenCode Black subscription plans."
      />
      <Meta property="og:image" content="/social-share-black.png" />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content="OpenCode Black | Access all the world's best coding models" />
      <Meta
        name="twitter:description"
        content="Get access to Claude, GPT, Gemini and more with OpenCode Black subscription plans."
      />
      <Meta name="twitter:image" content="/social-share-black.png" />

      <Spotlight config={spotlightConfig} class="header-spotlight" onAnimationFrame={handleAnimationFrame} />

      <header data-component="header">
        <A href="/" data-component="header-logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="179" height="32" viewBox="0 0 179 32" fill="none">
            <title>opencode</title>
            <g clip-path="url(#clip0_3654_210259)">
              <mask
                id="mask0_3654_210259"
                style="mask-type:luminance"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="179"
                height="32"
              >
                <path d="M178.286 0H0V32H178.286V0Z" fill="white" />
              </mask>
              <g mask="url(#mask0_3654_210259)">
                <path d="M13.7132 22.8577H4.57031V13.7148H13.7132V22.8577Z" fill="#444444" />
                <path
                  d="M13.7143 9.14174H4.57143V22.856H13.7143V9.14174ZM18.2857 27.4275H0V4.57031H18.2857V27.4275Z"
                  fill="#CDCDCD"
                />
                <path d="M36.5725 22.8577H27.4297V13.7148H36.5725V22.8577Z" fill="#444444" />
                <path
                  d="M27.4308 22.856H36.5737V9.14174H27.4308V22.856ZM41.1451 27.4275H27.4308V31.9989H22.8594V4.57031H41.1451V27.4275Z"
                  fill="#CDCDCD"
                />
                <path d="M64.0033 18.2852V22.8566H50.2891V18.2852H64.0033Z" fill="#444444" />
                <path
                  d="M63.9967 18.2846H50.2824V22.856H63.9967V27.4275H45.7109V4.57031H63.9967V18.2846ZM50.2824 13.7132H59.4252V9.14174H50.2824V13.7132Z"
                  fill="#CDCDCD"
                />
                <path d="M82.2835 27.4291H73.1406V13.7148H82.2835V27.4291Z" fill="#444444" />
                <path
                  d="M82.2846 9.14174H73.1417V27.4275H68.5703V4.57031H82.2846V9.14174ZM86.856 27.4275H82.2846V9.14174H86.856V27.4275Z"
                  fill="#CDCDCD"
                />
                <path d="M109.714 22.8577H96V13.7148H109.714V22.8577Z" fill="#444444" />
                <path
                  d="M109.715 9.14174H96.0011V22.856H109.715V27.4275H91.4297V4.57031H109.715V9.14174Z"
                  fill="white"
                />
                <path d="M128.002 22.8577H118.859V13.7148H128.002V22.8577Z" fill="#444444" />
                <path
                  d="M128.003 9.14174H118.86V22.856H128.003V9.14174ZM132.575 27.4275H114.289V4.57031H132.575V27.4275Z"
                  fill="white"
                />
                <path d="M150.854 22.8577H141.711V13.7148H150.854V22.8577Z" fill="#444444" />
                <path
                  d="M150.855 9.14286H141.712V22.8571H150.855V9.14286ZM155.426 27.4286H137.141V4.57143H150.855V0H155.426V27.4286Z"
                  fill="white"
                />
                <path d="M178.285 18.2852V22.8566H164.57V18.2852H178.285Z" fill="#444444" />
                <path
                  d="M164.571 9.14174V13.7132H173.714V9.14174H164.571ZM178.286 18.2846H164.571V22.856H178.286V27.4275H160V4.57031H178.286V18.2846Z"
                  fill="white"
                />
              </g>
            </g>
            <defs>
              <clipPath id="clip0_3654_210259">
                <rect width="178.286" height="32" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </A>
      </header>
      <main data-component="content">
        <div data-slot="hero">
          <h1>Access all the world's best coding models</h1>
          <p>Including Claude, GPT, Gemini and more</p>
        </div>
        <div data-slot="hero-black" style={svgLightingStyle()}>
          <svg width="591" height="90" viewBox="0 0 591 90" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient
                id="hero-black-fill-gradient"
                x1="290.82"
                y1="1.57422"
                x2="290.82"
                y2="87.0326"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color="white" />
                <stop offset="1" stop-color="white" stop-opacity="0" />
              </linearGradient>

              <linearGradient
                id="hero-black-stroke-gradient"
                x1="290.82"
                y1="2.03255"
                x2="290.82"
                y2="87.0325"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color={`hsl(0 0% ${svgLightingValues().strokeBrightness}%)`} />
                <stop offset="1" stop-color="white" stop-opacity="0" />
              </linearGradient>

              <linearGradient
                id="hero-black-shimmer-gradient"
                x1="0"
                y1="0"
                x2="591"
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset={Math.max(0, svgLightingValues().shimmerPos - 0.12)} stop-color="transparent" />
                <stop
                  offset={svgLightingValues().shimmerPos}
                  stop-color={`rgba(255, 255, 255, ${svgLightingValues().shimmerIntensity})`}
                />
                <stop offset={Math.min(1, svgLightingValues().shimmerPos + 0.12)} stop-color="transparent" />
              </linearGradient>

              <linearGradient
                id="hero-black-top-glow"
                x1="290.82"
                y1="0"
                x2="290.82"
                y2="45"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stop-color={`rgba(255, 255, 255, ${svgLightingValues().glowIntensity})`} />
                <stop offset="1" stop-color="transparent" />
              </linearGradient>

              <linearGradient
                id="hero-black-shimmer-mask"
                x1="290.82"
                y1="0"
                x2="290.82"
                y2="50"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stop-color="white" />
                <stop offset="0.8" stop-color="white" stop-opacity="0.5" />
                <stop offset="1" stop-color="white" stop-opacity="0" />
              </linearGradient>

              <mask id="shimmer-top-mask">
                <rect x="0" y="0" width="591" height="90" fill="url(#hero-black-shimmer-mask)" />
              </mask>
            </defs>

            <path
              d="M425.56 0.75C429.464 0.750017 432.877 1.27807 435.78 2.35645C438.656 3.42455 441.138 4.86975 443.215 6.69727C445.268 8.50382 446.995 10.5587 448.394 12.8604C449.77 15.0464 450.986 17.2741 452.04 19.5439L452.357 20.2275L451.672 20.542L443.032 24.502L442.311 24.833L442.021 24.0938C441.315 22.2906 440.494 20.6079 439.557 19.0459L439.552 19.0391L439.548 19.0322C438.626 17.419 437.517 16.0443 436.223 14.9023L436.206 14.8867L436.189 14.8701C434.989 13.6697 433.518 12.7239 431.766 12.0381L431.755 12.0342V12.0332C430.111 11.3607 428.053 11.0098 425.56 11.0098C419.142 11.0098 414.433 13.4271 411.308 18.2295C408.212 23.109 406.629 29.6717 406.629 37.9805V51.6602C406.629 59.9731 408.214 66.5377 411.312 71.418C414.438 76.2157 419.145 78.6299 425.56 78.6299C428.054 78.6299 430.111 78.2782 431.756 77.6055L431.766 77.6016L432.413 77.333C433.893 76.6811 435.154 75.8593 436.206 74.873C437.512 73.644 438.625 72.2626 439.548 70.7275C440.489 69.0801 441.314 67.3534 442.021 65.5469L442.311 64.8076L443.032 65.1387L451.672 69.0986L452.348 69.4082L452.044 70.0869C450.99 72.439 449.773 74.7099 448.395 76.8994C446.995 79.1229 445.266 81.1379 443.215 82.9434C441.138 84.7708 438.656 86.2151 435.78 87.2832C432.877 88.3616 429.464 88.8896 425.56 88.8896C415.111 88.8896 407.219 85.0777 402.019 77.4004L402.016 77.3965C396.939 69.7818 394.449 58.891 394.449 44.8203C394.449 30.7495 396.939 19.8589 402.016 12.2441L402.019 12.2393C407.219 4.56202 415.111 0.75 425.56 0.75ZM29.9404 2.19043C37.2789 2.19051 43.125 4.19131 47.3799 8.2793C51.6307 12.3635 53.7305 17.8115 53.7305 24.54C53.7305 29.6953 52.4605 33.8451 49.835 36.8994L49.8359 36.9004C47.7064 39.4558 45.0331 41.367 41.835 42.6445C45.893 43.8751 49.3115 45.9006 52.0703 48.7295C55.2954 51.9546 56.8496 56.6143 56.8496 62.5801C56.8496 66.0251 56.2751 69.2753 55.1211 72.3252C53.9689 75.3702 52.3185 78.014 50.1689 80.249L50.1699 80.25C48.0996 82.4858 45.6172 84.2628 42.7314 85.582L42.7227 85.5859C39.9002 86.8312 36.8362 87.4502 33.54 87.4502H0.75V2.19043H29.9404ZM148.123 2.19043V77.1904H187.843V87.4502H136.543V2.19043H148.123ZM298.121 2.19043L298.283 2.71973L323.963 86.4805L324.261 87.4502H312.006L311.848 86.9131L304.927 63.5703H276.646L269.726 86.9131L269.566 87.4502H257.552L257.85 86.4805L283.529 2.71973L283.691 2.19043H298.121ZM539.782 2.19043V44.9209L549.845 32.2344L549.851 32.2275L549.855 32.2207L574.575 2.46094L574.801 2.19043H588.874L587.849 3.41992L558.795 38.2832L588.749 86.3027L589.464 87.4502H575.934L575.714 87.0938L550.937 46.9316L539.782 60.0947V87.4502H528.202V2.19043H539.782ZM12.3301 77.1904H30.54C35.0749 77.1904 38.5307 76.1729 40.9961 74.2305C43.4059 72.3317 44.6699 69.3811 44.6699 65.2197V60.2998C44.6699 56.2239 43.4093 53.3106 40.9961 51.4092L40.9854 51.4004C38.5207 49.3838 35.0691 48.3301 30.54 48.3301H12.3301V77.1904ZM279.485 53.3096H302.087L290.786 14.4482L279.485 53.3096ZM12.3301 38.5498H28.8604C33 38.5498 36.1378 37.6505 38.3633 35.9443C40.5339 34.2015 41.6698 31.5679 41.6699 27.9004V23.2197C41.6699 19.5455 40.5299 16.9088 38.3516 15.166C36.1272 13.3865 32.9938 12.4502 28.8604 12.4502H12.3301V38.5498Z"
              fill="url(#hero-black-fill-gradient)"
              fill-opacity={svgLightingValues().fillOpacity}
              stroke="url(#hero-black-stroke-gradient)"
              stroke-width="1.5"
              data-slot="black-base"
            />

            <path
              d="M425.56 0.75C429.464 0.750017 432.877 1.27807 435.78 2.35645C438.656 3.42455 441.138 4.86975 443.215 6.69727C445.268 8.50382 446.995 10.5587 448.394 12.8604C449.77 15.0464 450.986 17.2741 452.04 19.5439L452.357 20.2275L451.672 20.542L443.032 24.502L442.311 24.833L442.021 24.0938C441.315 22.2906 440.494 20.6079 439.557 19.0459L439.552 19.0391L439.548 19.0322C438.626 17.419 437.517 16.0443 436.223 14.9023L436.206 14.8867L436.189 14.8701C434.989 13.6697 433.518 12.7239 431.766 12.0381L431.755 12.0342V12.0332C430.111 11.3607 428.053 11.0098 425.56 11.0098C419.142 11.0098 414.433 13.4271 411.308 18.2295C408.212 23.109 406.629 29.6717 406.629 37.9805V51.6602C406.629 59.9731 408.214 66.5377 411.312 71.418C414.438 76.2157 419.145 78.6299 425.56 78.6299C428.054 78.6299 430.111 78.2782 431.756 77.6055L431.766 77.6016L432.413 77.333C433.893 76.6811 435.154 75.8593 436.206 74.873C437.512 73.644 438.625 72.2626 439.548 70.7275C440.489 69.0801 441.314 67.3534 442.021 65.5469L442.311 64.8076L443.032 65.1387L451.672 69.0986L452.348 69.4082L452.044 70.0869C450.99 72.439 449.773 74.7099 448.395 76.8994C446.995 79.1229 445.266 81.1379 443.215 82.9434C441.138 84.7708 438.656 86.2151 435.78 87.2832C432.877 88.3616 429.464 88.8896 425.56 88.8896C415.111 88.8896 407.219 85.0777 402.019 77.4004L402.016 77.3965C396.939 69.7818 394.449 58.891 394.449 44.8203C394.449 30.7495 396.939 19.8589 402.016 12.2441L402.019 12.2393C407.219 4.56202 415.111 0.75 425.56 0.75ZM29.9404 2.19043C37.2789 2.19051 43.125 4.19131 47.3799 8.2793C51.6307 12.3635 53.7305 17.8115 53.7305 24.54C53.7305 29.6953 52.4605 33.8451 49.835 36.8994L49.8359 36.9004C47.7064 39.4558 45.0331 41.367 41.835 42.6445C45.893 43.8751 49.3115 45.9006 52.0703 48.7295C55.2954 51.9546 56.8496 56.6143 56.8496 62.5801C56.8496 66.0251 56.2751 69.2753 55.1211 72.3252C53.9689 75.3702 52.3185 78.014 50.1689 80.249L50.1699 80.25C48.0996 82.4858 45.6172 84.2628 42.7314 85.582L42.7227 85.5859C39.9002 86.8312 36.8362 87.4502 33.54 87.4502H0.75V2.19043H29.9404ZM148.123 2.19043V77.1904H187.843V87.4502H136.543V2.19043H148.123ZM298.121 2.19043L298.283 2.71973L323.963 86.4805L324.261 87.4502H312.006L311.848 86.9131L304.927 63.5703H276.646L269.726 86.9131L269.566 87.4502H257.552L257.85 86.4805L283.529 2.71973L283.691 2.19043H298.121ZM539.782 2.19043V44.9209L549.845 32.2344L549.851 32.2275L549.855 32.2207L574.575 2.46094L574.801 2.19043H588.874L587.849 3.41992L558.795 38.2832L588.749 86.3027L589.464 87.4502H575.934L575.714 87.0938L550.937 46.9316L539.782 60.0947V87.4502H528.202V2.19043H539.782ZM12.3301 77.1904H30.54C35.0749 77.1904 38.5307 76.1729 40.9961 74.2305C43.4059 72.3317 44.6699 69.3811 44.6699 65.2197V60.2998C44.6699 56.2239 43.4093 53.3106 40.9961 51.4092L40.9854 51.4004C38.5207 49.3838 35.0691 48.3301 30.54 48.3301H12.3301V77.1904ZM279.485 53.3096H302.087L290.786 14.4482L279.485 53.3096ZM12.3301 38.5498H28.8604C33 38.5498 36.1378 37.6505 38.3633 35.9443C40.5339 34.2015 41.6698 31.5679 41.6699 27.9004V23.2197C41.6699 19.5455 40.5299 16.9088 38.3516 15.166C36.1272 13.3865 32.9938 12.4502 28.8604 12.4502H12.3301V38.5498Z"
              fill="url(#hero-black-top-glow)"
              stroke="none"
              data-slot="black-glow"
            />

            <path
              d="M425.56 0.75C429.464 0.750017 432.877 1.27807 435.78 2.35645C438.656 3.42455 441.138 4.86975 443.215 6.69727C445.268 8.50382 446.995 10.5587 448.394 12.8604C449.77 15.0464 450.986 17.2741 452.04 19.5439L452.357 20.2275L451.672 20.542L443.032 24.502L442.311 24.833L442.021 24.0938C441.315 22.2906 440.494 20.6079 439.557 19.0459L439.552 19.0391L439.548 19.0322C438.626 17.419 437.517 16.0443 436.223 14.9023L436.206 14.8867L436.189 14.8701C434.989 13.6697 433.518 12.7239 431.766 12.0381L431.755 12.0342V12.0332C430.111 11.3607 428.053 11.0098 425.56 11.0098C419.142 11.0098 414.433 13.4271 411.308 18.2295C408.212 23.109 406.629 29.6717 406.629 37.9805V51.6602C406.629 59.9731 408.214 66.5377 411.312 71.418C414.438 76.2157 419.145 78.6299 425.56 78.6299C428.054 78.6299 430.111 78.2782 431.756 77.6055L431.766 77.6016L432.413 77.333C433.893 76.6811 435.154 75.8593 436.206 74.873C437.512 73.644 438.625 72.2626 439.548 70.7275C440.489 69.0801 441.314 67.3534 442.021 65.5469L442.311 64.8076L443.032 65.1387L451.672 69.0986L452.348 69.4082L452.044 70.0869C450.99 72.439 449.773 74.7099 448.395 76.8994C446.995 79.1229 445.266 81.1379 443.215 82.9434C441.138 84.7708 438.656 86.2151 435.78 87.2832C432.877 88.3616 429.464 88.8896 425.56 88.8896C415.111 88.8896 407.219 85.0777 402.019 77.4004L402.016 77.3965C396.939 69.7818 394.449 58.891 394.449 44.8203C394.449 30.7495 396.939 19.8589 402.016 12.2441L402.019 12.2393C407.219 4.56202 415.111 0.75 425.56 0.75ZM29.9404 2.19043C37.2789 2.19051 43.125 4.19131 47.3799 8.2793C51.6307 12.3635 53.7305 17.8115 53.7305 24.54C53.7305 29.6953 52.4605 33.8451 49.835 36.8994L49.8359 36.9004C47.7064 39.4558 45.0331 41.367 41.835 42.6445C45.893 43.8751 49.3115 45.9006 52.0703 48.7295C55.2954 51.9546 56.8496 56.6143 56.8496 62.5801C56.8496 66.0251 56.2751 69.2753 55.1211 72.3252C53.9689 75.3702 52.3185 78.014 50.1689 80.249L50.1699 80.25C48.0996 82.4858 45.6172 84.2628 42.7314 85.582L42.7227 85.5859C39.9002 86.8312 36.8362 87.4502 33.54 87.4502H0.75V2.19043H29.9404ZM148.123 2.19043V77.1904H187.843V87.4502H136.543V2.19043H148.123ZM298.121 2.19043L298.283 2.71973L323.963 86.4805L324.261 87.4502H312.006L311.848 86.9131L304.927 63.5703H276.646L269.726 86.9131L269.566 87.4502H257.552L257.85 86.4805L283.529 2.71973L283.691 2.19043H298.121ZM539.782 2.19043V44.9209L549.845 32.2344L549.851 32.2275L549.855 32.2207L574.575 2.46094L574.801 2.19043H588.874L587.849 3.41992L558.795 38.2832L588.749 86.3027L589.464 87.4502H575.934L575.714 87.0938L550.937 46.9316L539.782 60.0947V87.4502H528.202V2.19043H539.782ZM12.3301 77.1904H30.54C35.0749 77.1904 38.5307 76.1729 40.9961 74.2305C43.4059 72.3317 44.6699 69.3811 44.6699 65.2197V60.2998C44.6699 56.2239 43.4093 53.3106 40.9961 51.4092L40.9854 51.4004C38.5207 49.3838 35.0691 48.3301 30.54 48.3301H12.3301V77.1904ZM279.485 53.3096H302.087L290.786 14.4482L279.485 53.3096ZM12.3301 38.5498H28.8604C33 38.5498 36.1378 37.6505 38.3633 35.9443C40.5339 34.2015 41.6698 31.5679 41.6699 27.9004V23.2197C41.6699 19.5455 40.5299 16.9088 38.3516 15.166C36.1272 13.3865 32.9938 12.4502 28.8604 12.4502H12.3301V38.5498Z"
              fill="url(#hero-black-shimmer-gradient)"
              stroke="none"
              data-slot="black-shimmer"
              mask="url(#shimmer-top-mask)"
              style={{ "mix-blend-mode": "overlay" }}
            />
          </svg>
        </div>
        {props.children}
      </main>
      <footer data-component="footer">
        <div data-slot="footer-content">
          <span data-slot="anomaly">
            ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
          </span>
          <a href={config.github.repoUrl} target="_blank">
            GitHub <span data-slot="github-stars">[{starCount()}]</span>
          </a>
          <a href="/docs">Docs</a>
          <span>
            <A href="/legal/privacy-policy">Privacy</A>
          </span>
          <span>
            <A href="/legal/terms-of-service">Terms</A>
          </span>
        </div>
        <span data-slot="anomaly-alt">
          ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
        </span>
      </footer>
    </div>
  )
}
