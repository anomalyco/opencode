import ubuntu from "../assets/wsl/ubuntu.svg"
import opensuse from "../assets/wsl/opensuse.svg"
import suse from "../assets/wsl/suse.svg"
import kaliLinux from "../assets/wsl/kali-linux.svg"
import debian from "../assets/wsl/debian.svg"
import almalinux from "../assets/wsl/almalinux.svg"
import archLinux from "../assets/wsl/arch-linux.svg"
import fedora from "../assets/wsl/fedora.svg"
import elxr from "../assets/wsl/elxr.png"
import oracle from "../assets/wsl/oracle.svg"

type WslDistroIconProps = {
  name: string
  label?: string
  class?: string
}

const icons = [
  { src: ubuntu, match: (value: string) => value.includes("ubuntu") },
  { src: opensuse, match: (value: string) => value.includes("opensuse") || value.includes("open suse") },
  {
    src: suse,
    match: (value: string) =>
      value.includes("suse-linux-enterprise") ||
      value.includes("suse linux enterprise") ||
      value.includes("sles"),
  },
  { src: kaliLinux, match: (value: string) => value.includes("kali") },
  { src: debian, match: (value: string) => value.includes("debian") },
  { src: almalinux, match: (value: string) => value.includes("almalinux") || value.includes("alma linux") },
  { src: archLinux, match: (value: string) => value.includes("arch") },
  { src: fedora, match: (value: string) => value.includes("fedora") },
  { src: elxr, match: (value: string) => value.includes("elxr") },
  { src: oracle, match: (value: string) => value.includes("oracle") },
]

export function WslDistroIcon(props: WslDistroIconProps) {
  const value = `${props.name} ${props.label ?? ""}`.toLowerCase()
  const icon = icons.find((item) => item.match(value))
  const sizeClass = () => props.class ?? "h-8 w-8"
  if (icon) {
    return (
      <img
        data-component="wsl-distro-icon"
        src={icon.src}
        alt=""
        draggable={false}
        class={`${sizeClass()} shrink-0 object-contain`}
      />
    )
  }
  return (
    <div
      data-component="wsl-distro-icon"
      class={`flex ${sizeClass()} shrink-0 items-center justify-center rounded-full bg-background-panel text-12-medium text-text-weak`}
      aria-hidden="true"
    >
      {props.label?.trim().charAt(0).toUpperCase() || props.name.trim().charAt(0).toUpperCase() || "L"}
    </div>
  )
}
