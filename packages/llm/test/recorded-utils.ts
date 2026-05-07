export const kebab = (value: string) =>
  value
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()

export const missingEnv = (names: ReadonlyArray<string>) => names.filter((name) => !process.env[name])

export const envList = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "")

export const unique = (items: ReadonlyArray<string>) => Array.from(new Set(items))

export const classifiedTags = (input: {
  readonly prefix?: string
  readonly provider?: string
  readonly protocol?: string
  readonly tags?: ReadonlyArray<string>
}) =>
  unique([
    ...(input.prefix ? [`prefix:${input.prefix}`] : []),
    ...(input.provider ? [`provider:${input.provider}`] : []),
    ...(input.protocol ? [`protocol:${input.protocol}`] : []),
    ...(input.tags ?? []),
  ])

export const matchesSelected = (input: {
  readonly prefix: string
  readonly name: string
  readonly cassette: string
  readonly tags: ReadonlyArray<string>
}) => {
  const prefixes = envList("RECORDED_PREFIX")
  const providers = envList("RECORDED_PROVIDER")
  const requiredTags = envList("RECORDED_TAGS")
  const tests = envList("RECORDED_TEST")
  const tags = input.tags.map((tag) => tag.toLowerCase())
  const names = [input.name, kebab(input.name), input.cassette].map((item) => item.toLowerCase())

  if (prefixes.length > 0 && !prefixes.includes(input.prefix.toLowerCase())) return false
  if (providers.length > 0 && !providers.some((provider) => tags.includes(`provider:${provider}`))) return false
  if (requiredTags.length > 0 && !requiredTags.every((tag) => tags.includes(tag))) return false
  if (tests.length > 0 && !tests.some((test) => names.some((name) => name.includes(test)))) return false
  return true
}

export const cassetteName = (
  prefix: string,
  name: string,
  options: { readonly cassette?: string; readonly id?: string },
) => options.cassette ?? `${prefix}/${options.id ?? kebab(name)}`
