import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { HiringSkills } from "../../src/product/hiring-skills"
import { HiringFixtures } from "../../src/product/fixtures"
import PROMPT_RECRUIT from "../../src/product/agents/recruit.txt"
import PROMPT_INITIALIZE from "../../src/command/template/initialize.txt"
import path from "path"

const node = LayerNode.compile(CrossSpawnSpawner.node)
const it = testEffect(Layer.mergeAll(LayerNode.compile(Skill.node), node, testInstanceStoreLayer))

const HIRING_NAMES = ["req-context", "score-candidate", "draft-outreach", "commit-disposition"] as const

it.effect("HiringSkills exports four named packs with non-empty content", () =>
  Effect.sync(() => {
    expect(HiringSkills.map((s) => s.name)).toEqual([...HIRING_NAMES])
    for (const skill of HiringSkills) {
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.content.length).toBeGreaterThan(0)
    }
  }),
)

it.effect("HiringFixtures paths resolve to on-disk samples", () =>
  Effect.promise(async () => {
    expect(path.basename(HiringFixtures.dir)).toBe("hiring")
    for (const file of [HiringFixtures.jd, HiringFixtures.resume, HiringFixtures.scorecard]) {
      expect(await Bun.file(file).exists()).toBe(true)
      expect((await Bun.file(file).text()).length).toBeGreaterThan(0)
    }
  }),
)

it.effect("score-candidate writes a score file path; commit-disposition cites it", () =>
  Effect.sync(() => {
    const score = HiringSkills.find((s) => s.name === "score-candidate")
    const commit = HiringSkills.find((s) => s.name === "commit-disposition")
    expect(score?.content).toContain(".moks/reqs/<req-slug>/scores/<candidate-slug>.md")
    expect(score?.content).toContain("You are not done until the file is written")
    expect(commit?.content).toContain("--target-id")
    expect(commit?.content).toContain("--meta")
    expect(commit?.content).toContain('{"score":".moks/reqs/<req-slug>/scores/<candidate-slug>.md"}')
    expect(PROMPT_RECRUIT).toContain(".moks/reqs/<req-slug>/scores/<candidate-slug>.md")
    expect(PROMPT_RECRUIT).toContain("--meta")
    expect(PROMPT_RECRUIT).toContain("Keep asking")
    expect(PROMPT_RECRUIT).toContain("question tool")
    expect(PROMPT_RECRUIT).not.toContain("packages/opencode/src/product/fixtures/hiring/")
    expect(PROMPT_INITIALIZE).toContain(".moks/reqs/<slug>")
    expect(PROMPT_INITIALIZE).toContain("Do not overwrite non-empty user content")
    expect(PROMPT_INITIALIZE).toContain("Keep going until title, level, team/HM, location, and must-haves are real")
    expect(PROMPT_INITIALIZE).not.toContain("ask once")
  }),
)

it.live("built-in skills include hiring packs", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const list = yield* skill.all()
        const builtIn = list.filter((s) => s.location === "<built-in>")
        for (const name of HIRING_NAMES) {
          const item = builtIn.find((s) => s.name === name)
          expect(item).toBeDefined()
          if (!item) continue
          expect(item.description?.length ?? 0).toBeGreaterThan(0)
          expect(item.content.length).toBeGreaterThan(0)
        }
      }),
    { git: true },
  ),
)
