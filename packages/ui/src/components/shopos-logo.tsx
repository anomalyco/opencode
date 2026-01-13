import "./shopos-logo.css"

export interface ShopOSLogoProps {
  size?: "sm" | "md" | "lg"
  showText?: boolean
  class?: string
}

export function ShopOSLogo(props: ShopOSLogoProps) {
  const size = () => props.size ?? "md"

  return (
    <div
      data-component="shopos-logo"
      data-size={size()}
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <div data-slot="icon">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Shopping bag with circuit pattern */}
          <path
            d="M6 10L8 4H24L26 10M6 10V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V10M6 10H26"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {/* AI circuit nodes */}
          <circle cx="12" cy="18" r="2" fill="currentColor" />
          <circle cx="20" cy="18" r="2" fill="currentColor" />
          <circle cx="16" cy="22" r="2" fill="currentColor" />
          <path
            d="M12 18L16 22M20 18L16 22"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </div>
      {props.showText !== false && (
        <span data-slot="text">ShopOS</span>
      )}
    </div>
  )
}

export function ShopOSMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" data-component="shopos-mark">
      <path
        d="M6 10L8 4H24L26 10M6 10V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V10M6 10H26"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="18" r="2" fill="currentColor" />
      <circle cx="20" cy="18" r="2" fill="currentColor" />
      <circle cx="16" cy="22" r="2" fill="currentColor" />
      <path d="M12 18L16 22M20 18L16 22" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  )
}
