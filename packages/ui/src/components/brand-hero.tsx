import heroLg from "../assets/brand/hero-lg.webp"
import heroMd from "../assets/brand/hero-md.webp"
import heroSm from "../assets/brand/hero-sm.webp"
import { type ComponentProps, splitProps } from "solid-js"

const sources = {
  sm: heroSm,
  md: heroMd,
  lg: heroLg,
} as const

type Size = keyof typeof sources

export function BrandHero(props: ComponentProps<"img"> & { size?: Size }) {
  const [local, rest] = splitProps(props, ["size", "class", "classList"])
  const size = () => local.size ?? "md"
  return (
    <img
      data-component="brand-hero"
      src={sources[size()]}
      alt=""
      role="presentation"
      classList={{ [local.class ?? ""]: !!local.class, ...local.classList }}
      {...rest}
    />
  )
}
