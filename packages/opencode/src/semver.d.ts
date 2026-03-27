declare module "semver" {
  const semver: {
    satisfies(version: string, range: string): boolean
    lt(lhs: string, rhs: string): boolean
    gt(lhs: string, rhs: string): boolean
    major(version: string): number
    minor(version: string): number
  }

  export default semver
}
