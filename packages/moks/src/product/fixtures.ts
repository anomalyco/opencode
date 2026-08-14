import path from "path"

/** Single source of truth for shipping sample hiring materials. */
export const HiringFixturesDir = path.join(import.meta.dir, "fixtures", "hiring")

export const HiringFixtures = {
  dir: HiringFixturesDir,
  hiring: path.join(HiringFixturesDir, "HIRING.md"),
  card: path.join(HiringFixturesDir, "candidates", "jordan-lee.md"),
} as const
