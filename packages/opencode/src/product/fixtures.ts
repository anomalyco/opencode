import path from "path"

/** Single source of truth for shipping sample hiring materials. */
export const HiringFixturesDir = path.join(import.meta.dir, "fixtures", "hiring")

export const HiringFixtures = {
  dir: HiringFixturesDir,
  jd: path.join(HiringFixturesDir, "jd.md"),
  resume: path.join(HiringFixturesDir, "resume.md"),
  scorecard: path.join(HiringFixturesDir, "scorecard.md"),
} as const
