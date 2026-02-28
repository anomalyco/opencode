import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="mark-bg" cx="50%" cy="45%" r="72%" fx="48%" fy="42%" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#12142B"/>
          <stop offset="100%" stop-color="#060710"/>
        </radialGradient>
        <linearGradient id="mark-bracket" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00D4FF"/>
          <stop offset="50%" stop-color="#6DD5FA"/>
          <stop offset="100%" stop-color="#A78BFA"/>
        </linearGradient>
        <clipPath id="mark-squircle">
          <path d="M256 4c-69 0-124.2 1.5-160 14.5C58.5 33 33 58.5 18.5 96 5.5 131.8 4 187 4 256s1.5 124.2 14.5 160C33 453.5 58.5 479 96 493.5c35.8 13 91 14.5 160 14.5s124.2-1.5 160-14.5c37.5-14.5 63-40 77.5-77.5 13-35.8 14.5-91 14.5-160s-1.5-124.2-14.5-160C479 58.5 453.5 33 416 18.5 380.2 5.5 325 4 256 4Z"/>
        </clipPath>
        <radialGradient id="mark-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
          <stop offset="18%" stop-color="#B0F0FF" stop-opacity="0.85"/>
          <stop offset="40%" stop-color="#00D4FF" stop-opacity="0.6"/>
          <stop offset="65%" stop-color="#0891B2" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#00D4FF" stop-opacity="0"/>
        </radialGradient>
        <filter id="mark-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <g clip-path="url(#mark-squircle)">
        <rect width="512" height="512" fill="#0A0C1A"/>
        <circle cx="256" cy="256" r="80" fill="url(#mark-core)" opacity="0.5"/>
        <circle cx="256" cy="256" r="40" fill="url(#mark-core)" opacity="0.6"/>
        <g filter="url(#mark-glow)">
          <path d="M178 180 L118 256 L178 332" fill="none" stroke="url(#mark-bracket)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path d="M334 180 L394 256 L334 332" fill="none" stroke="url(#mark-bracket)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <line x1="266" y1="195" x2="246" y2="317" stroke="url(#mark-bracket)" stroke-width="14" stroke-linecap="round" opacity="0.9"/>
        </g>
        <circle cx="268" cy="190" r="5" fill="#00D4FF" opacity="0.7"/>
        <circle cx="268" cy="190" r="2.5" fill="#FFFFFF" opacity="0.8"/>
      </g>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="splash-bg" cx="50%" cy="45%" r="72%" fx="48%" fy="42%">
          <stop offset="0%" stop-color="#12142B"/>
          <stop offset="45%" stop-color="#0D0F1E"/>
          <stop offset="100%" stop-color="#060710"/>
        </radialGradient>
        <radialGradient id="splash-wash" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#00D4FF" stop-opacity="0.06"/>
          <stop offset="40%" stop-color="#7C3AED" stop-opacity="0.04"/>
          <stop offset="100%" stop-color="#060710" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="splash-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
          <stop offset="18%" stop-color="#B0F0FF" stop-opacity="0.85"/>
          <stop offset="40%" stop-color="#00D4FF" stop-opacity="0.6"/>
          <stop offset="65%" stop-color="#0891B2" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#00D4FF" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="splash-bracket" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00D4FF"/>
          <stop offset="50%" stop-color="#6DD5FA"/>
          <stop offset="100%" stop-color="#A78BFA"/>
        </linearGradient>
        <linearGradient id="splash-inner" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#66EEFF"/>
          <stop offset="100%" stop-color="#C4B5FD"/>
        </linearGradient>
        <clipPath id="splash-squircle">
          <path d="M256 4c-69 0-124.2 1.5-160 14.5C58.5 33 33 58.5 18.5 96 5.5 131.8 4 187 4 256s1.5 124.2 14.5 160C33 453.5 58.5 479 96 493.5c35.8 13 91 14.5 160 14.5s124.2-1.5 160-14.5c37.5-14.5 63-40 77.5-77.5 13-35.8 14.5-91 14.5-160s-1.5-124.2-14.5-160C479 58.5 453.5 33 416 18.5 380.2 5.5 325 4 256 4Z"/>
        </clipPath>
        <filter id="splash-radiance" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur1"/>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur2"/>
          <feMerge>
            <feMergeNode in="blur1"/>
            <feMergeNode in="blur2"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <filter id="splash-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <filter id="splash-emission" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="bigBlur"/>
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="tightBlur"/>
          <feMerge>
            <feMergeNode in="bigBlur"/>
            <feMergeNode in="tightBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <g clip-path="url(#splash-squircle)">
        <rect width="512" height="512" fill="url(#splash-bg)"/>
        <rect width="512" height="512" fill="url(#splash-wash)"/>
        {/* Core glow */}
        <circle cx="256" cy="256" r="110" fill="url(#splash-core)" opacity="0.5" filter="url(#splash-radiance)"/>
        <circle cx="256" cy="256" r="65" fill="url(#splash-core)" opacity="0.7"/>
        <circle cx="256" cy="256" r="28" fill="#00D4FF" opacity="0.15"/>
        <circle cx="256" cy="256" r="14" fill="#FFFFFF" opacity="0.12"/>
        {/* Bracket emission glow */}
        <g filter="url(#splash-emission)" opacity="0.5">
          <path d="M170 176 L110 256 L170 336" fill="none" stroke="#00D4FF" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M342 176 L402 256 L342 336" fill="none" stroke="#A78BFA" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        {/* Crisp brackets */}
        <g filter="url(#splash-glow)">
          <path d="M178 180 L118 256 L178 332" fill="none" stroke="url(#splash-bracket)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path d="M175 188 L122 256 L175 324" fill="none" stroke="url(#splash-inner)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
          <path d="M334 180 L394 256 L334 332" fill="none" stroke="url(#splash-bracket)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <path d="M337 188 L390 256 L337 324" fill="none" stroke="url(#splash-inner)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
        </g>
        {/* Central cursor/slash */}
        <g filter="url(#splash-emission)" opacity="0.4">
          <line x1="256" y1="196" x2="256" y2="316" stroke="#00D4FF" stroke-width="10" stroke-linecap="round"/>
        </g>
        <g filter="url(#splash-glow)">
          <line x1="266" y1="195" x2="246" y2="317" stroke="url(#splash-bracket)" stroke-width="14" stroke-linecap="round" opacity="0.9"/>
          <line x1="264" y1="202" x2="248" y2="310" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.25"/>
        </g>
        {/* Cursor blink dot */}
        <circle cx="268" cy="190" r="5" fill="#00D4FF" opacity="0.7" filter="url(#splash-glow)"/>
        <circle cx="268" cy="190" r="2.5" fill="#FFFFFF" opacity="0.8"/>
        {/* Particles */}
        <g opacity="0.5">
          <circle cx="95" cy="180" r="1.5" fill="#00D4FF" opacity="0.6"/>
          <circle cx="420" cy="200" r="1.2" fill="#A78BFA" opacity="0.5"/>
          <circle cx="105" cy="340" r="1.0" fill="#A78BFA" opacity="0.4"/>
          <circle cx="410" cy="350" r="1.5" fill="#00D4FF" opacity="0.5"/>
        </g>
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
      <defs>
        <linearGradient id="logo-open" x1="0" y1="6" x2="114" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--icon-interactive-base, #00D4FF)"/>
          <stop offset="100%" stop-color="var(--icon-info-base, #A78BFA)"/>
        </linearGradient>
        <linearGradient id="logo-code" x1="120" y1="6" x2="234" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--icon-info-base, #A78BFA)"/>
          <stop offset="100%" stop-color="var(--icon-strong-base, #E0E0E0)"/>
        </linearGradient>
      </defs>
      <g>
        {/* OPEN — aurora gradient */}
        <path d="M18 30H6V18H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="url(#logo-open)" />
        <path d="M48 30H36V18H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" fill="url(#logo-open)" />
        <path d="M84 24V30H66V24H84Z" fill="var(--icon-weak-base)" />
        <path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="url(#logo-open)" />
        <path d="M108 36H96V18H108V36Z" fill="var(--icon-weak-base)" />
        <path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" fill="url(#logo-open)" />
        {/* CODE — violet-to-white gradient */}
        <path d="M144 30H126V18H144V30Z" fill="var(--icon-weak-base)" />
        <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="url(#logo-code)" />
        <path d="M168 30H156V18H168V30Z" fill="var(--icon-weak-base)" />
        <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="url(#logo-code)" />
        <path d="M198 30H186V18H198V30Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="url(#logo-code)" />
        <path d="M234 24V30H216V24H234Z" fill="var(--icon-weak-base)" />
        <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="url(#logo-code)" />
      </g>
    </svg>
  )
}
