import path from "path"
import { Effect, FileSystem } from "effect"
import { AbsolutePath } from "../schema"

// OpenWork fixed folder layout. Every work folder has the same shape so the work
// agent can rely on it without discovering structure each run.
export interface WorkFolder {
  readonly root: AbsolutePath
  readonly aboutMe: AbsolutePath
  readonly projects: AbsolutePath
  readonly templates: AbsolutePath
  readonly outputs: AbsolutePath
  readonly folderMd: AbsolutePath
}

export const LAYOUT = {
  aboutMeDir: "ABOUT-ME",
  aboutMeFile: "about-me.md",
  writingStyleFile: "writing-style.md",
  projectsDir: "PROJECTS",
  templatesDir: "TEMPLATES",
  outputsDir: "OUTPUTS",
  folderMd: "FOLDER.md",
} as const

const ABOUT_ME_TEMPLATE = `# About me

<!-- Write here who you are, what you do, and any stable context the work agent should know. -->
<!-- This file is read before every task. Keep it short and factual. -->

## Role

## Context

## Preferences
`

const WRITING_STYLE_TEMPLATE = `# Writing style

<!-- Describe the voice, tone, and formatting the work agent should follow. -->
<!-- Examples: "concise and direct", "use bullet points for lists", "neutral Spanish". -->

## Voice

## Tone

## Formatting rules
`

const FOLDER_MD_TEMPLATE = `# Folder instructions

<!-- Per-folder instructions for the work agent. This file is read alongside ABOUT-ME/. -->
<!-- Example: "Always use ISO dates in filenames", "weekly reports go to OUTPUTS/reports/". -->

## Conventions

## Defaults
`

export const Scaffold = {
  // Build the WorkFolder record for a root path. Pure, no IO.
  at(root: AbsolutePath): WorkFolder {
    return {
      root,
      aboutMe: path.join(root, LAYOUT.aboutMeDir) as AbsolutePath,
      projects: path.join(root, LAYOUT.projectsDir) as AbsolutePath,
      templates: path.join(root, LAYOUT.templatesDir) as AbsolutePath,
      outputs: path.join(root, LAYOUT.outputsDir) as AbsolutePath,
      folderMd: path.join(root, LAYOUT.folderMd) as AbsolutePath,
    }
  },

  // Detect whether a directory already has the OpenWork layout.
  detect(root: AbsolutePath) {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = Scaffold.at(root)
      const checks = [
        fs.exists(folder.aboutMe),
        fs.exists(folder.projects),
        fs.exists(folder.templates),
        fs.exists(folder.outputs),
      ]
      const results = yield* Effect.all(checks, { concurrency: "unbounded" })
      return results.every(Boolean)
    })
  },

  // Create the OpenWork layout inside an existing directory. Idempotent: existing
  // directories are kept, seed markdown templates are written ONLY when missing.
  create(root: AbsolutePath) {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = Scaffold.at(root)

      yield* fs.makeDirectory(folder.aboutMe, { recursive: true })
      yield* fs.makeDirectory(folder.projects, { recursive: true })
      yield* fs.makeDirectory(folder.templates, { recursive: true })
      yield* fs.makeDirectory(folder.outputs, { recursive: true })

      // Seed templates only if the file does not already exist (never overwrite user content).
      yield* seedFile(fs, path.join(folder.aboutMe, LAYOUT.aboutMeFile), ABOUT_ME_TEMPLATE)
      yield* seedFile(fs, path.join(folder.aboutMe, LAYOUT.writingStyleFile), WRITING_STYLE_TEMPLATE)
      yield* seedFile(fs, folder.folderMd, FOLDER_MD_TEMPLATE)

      // Placeholder so empty PROJECTS/TEMPLATES/OUTPUTS survive in git.
      yield* seedFile(fs, path.join(folder.projects, ".gitkeep"), "")
      yield* seedFile(fs, path.join(folder.templates, ".gitkeep"), "")
      yield* seedFile(fs, path.join(folder.outputs, ".gitkeep"), "")

      return folder
    })
  },
}

function seedFile(fs: FileSystem.FileSystem, file: string, content: string) {
  return Effect.gen(function* () {
    const exists = yield* fs.exists(file)
    if (exists) return
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(file, content)
  })
}