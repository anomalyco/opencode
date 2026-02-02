import { type ComponentProps, splitProps } from "solid-js"

export interface ReasoningIconProps extends Pick<ComponentProps<"svg">, "class" | "classList"> {
  percentage: number
  size?: number
  strokeWidth?: number
}

export function ReasoningIcon(props: ReasoningIconProps) {
  const [split, rest] = splitProps(props, ["percentage", "size", "strokeWidth", "class", "classList"])

  const size = () => split.size || 16
  const strokeWidth = () => split.strokeWidth || 1.25

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox={`0 0 16 16`}
      fill="none"
      data-component="reasoning-icon"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <path
        d="M5.83196 10.3225V11.1666C5.83196 11.7189 6.27967 12.1666 6.83196 12.1666H9.16687C9.71915 12.1666 10.1669 11.7189 10.1669 11.1666V10.3225M5.83196 10.3225C5.55695 10.1843 5.29695 10.0206 5.05505 9.83459C3.90601 8.95086 3.16549 7.56219 3.16549 6.00055C3.16549 3.33085 5.32971 1.16663 7.99941 1.16663C10.6691 1.16663 12.8333 3.33085 12.8333 6.00055C12.8333 7.56219 12.0928 8.95086 10.9438 9.83459C10.7019 10.0206 10.4419 10.1843 10.1669 10.3225M5.83196 10.3225H10.1669M6.5 14.1666H9.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle
        cx="8"
        cy="5.83325"
        r="2.86364"
        fill="currentColor"
        stroke="currentColor"
        stroke-width={strokeWidth()}
        style={{ "--reasoning-icon-percentage": split.percentage / 100 }}
        data-slot="reasoning-icon-percentage"
      />
    </svg>
  )
}
