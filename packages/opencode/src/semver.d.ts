declare module "semver" {
  const semver: {
    satisfies(version: string, range: string): boolean
    lt(lhs: string, rhs: string): boolean
  }

  export default semver
}
