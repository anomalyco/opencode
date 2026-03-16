export const hide = (value?: string) => {
  const flag = value?.trim().toLowerCase()
  return flag === "1" || flag === "true"
}
