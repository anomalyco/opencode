import { type ComponentProps } from "solid-js"

const glyph = (
  <g fill="currentColor">
    <path d="M608 369 641 220Q644 201 661 192L802 124Q819 115 836 124L949 181Q956 184 952 192L897 302Q895 307 890 312L806 387Q802 391 797 394L677 463Q672 467 668 462L618 400Q605 386 608 369Z" />
    <path d="M967 198Q969 192 975 195L1015 217Q1028 224 1029 239L1031 300Q1031 306 1025 306H922Q914 306 918 298Z" />
    <path d="M908 321H1028Q1034 321 1034 327L1035 394Q1036 405 1029 414L927 530Q922 536 917 530L822 404Q818 398 824 393L901 324Q904 321 908 321Z" />
    <path d="M800 410Q805 406 809 411L899 529Q903 536 896 537H748Q729 537 718 524L686 486Q681 479 689 475Z" />
  </g>
)

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="603 113 435 435"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {glyph}
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="603 113 435 435"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {glyph}
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="603 113 435 435"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {glyph}
    </svg>
  )
}
