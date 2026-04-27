export function sessionNewPane(width: number) {
  if (width >= 2200) return "96rem"
  if (width >= 1800) return "88rem"
  if (width >= 1500) return "80rem"
  if (width >= 1280) return "72rem"
  return "64rem"
}

export function sessionNewMeta(agent: boolean) {
  if (agent) return ""
  return "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]"
}
