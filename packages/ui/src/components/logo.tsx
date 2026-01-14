export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 72 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* OpenWork OW Mark - O with chevrons and W wave */}
      <g stroke="var(--icon-strong-base)" stroke-width="2.5" fill="none">
        {/* O circle */}
        <circle cx="18" cy="18" r="12" />
        {/* Left chevron inside O */}
        <polyline points="14,13 9,18 14,23" stroke-linecap="round" stroke-linejoin="round" />
        {/* Right chevron inside O */}
        <polyline points="22,13 27,18 22,23" stroke-linecap="round" stroke-linejoin="round" />
        {/* W as stylized wave */}
        <path d="M36,8 C36,8 40,18 44,18 C48,18 48,8 52,8 C56,8 56,18 60,18 C64,18 68,8 68,8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M36,28 C36,28 40,18 44,18 C48,18 48,28 52,28 C56,28 56,18 60,18 C64,18 68,28 68,28" stroke-linecap="round" stroke-linejoin="round" />
      </g>
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
      {/* OpenWork logo - OW mark only (scaled to fit original viewBox) */}
      <g stroke="var(--icon-strong-base)" stroke-width="3" fill="none" transform="translate(45, 3)">
        {/* O circle */}
        <circle cx="18" cy="18" r="14" />
        {/* Left chevron inside O */}
        <polyline points="14,12 8,18 14,24" stroke-linecap="round" stroke-linejoin="round" />
        {/* Right chevron inside O */}
        <polyline points="22,12 28,18 22,24" stroke-linecap="round" stroke-linejoin="round" />
        {/* W as stylized wave */}
        <path d="M40,6 C40,6 46,18 52,18 C58,18 58,6 64,6 C70,6 70,18 76,18 C82,18 88,6 88,6" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M40,30 C40,30 46,18 52,18 C58,18 58,30 64,30 C70,30 70,18 76,18 C82,18 88,30 88,30" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
  )
}
