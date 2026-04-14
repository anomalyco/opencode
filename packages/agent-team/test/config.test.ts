import { describe, test, expect } from "bun:test"
import { parseTeamConfig } from "../src/config.js"

describe("TeamConfig validation", () => {
  test("parses valid full config", () => {
    const cfg = parseTeamConfig({
      enabled: true,
      agents: {
        coder: {
          role: "coder",
          role_priority: 5,
          capabilities: {
            tools: ["read", "edit", "bash"],
            share_to_team: true,
            delegate: true,
            max_delegation_depth: 3,
            disk_quota_mb: 1000,
          },
          max_tasks_per_day: 30,
          disk_quota_mb: 1000,
        },
      },
      human_authority: "advisory",
      limits: {
        max_agents: 8,
        max_concurrent_tasks: 4,
        max_delegation_depth: 2,
      },
      budget: {
        daily_limit_usd: 100,
        per_agent_daily_usd: 20,
      },
      git: {
        protected_branches: ["main", "release"],
        denied_commands: ["push --force"],
        pre_merge_validation: "bun test",
      },
    })
    expect(cfg.enabled).toBe(true)
    expect(cfg.agents.coder.role).toBe("coder")
    expect(cfg.human_authority).toBe("advisory")
    expect(cfg.limits.max_agents).toBe(8)
    expect(cfg.budget.daily_limit_usd).toBe(100)
    expect(cfg.git.pre_merge_validation).toBe("bun test")
  })

  test("provides defaults for missing fields", () => {
    const cfg = parseTeamConfig({})
    expect(cfg.enabled).toBe(false)
    expect(cfg.human_authority).toBe("always")
    expect(cfg.limits.max_agents).toBe(10)
    expect(cfg.limits.max_concurrent_tasks).toBe(5)
    expect(cfg.budget.daily_limit_usd).toBe(50)
    expect(cfg.budget.per_agent_daily_usd).toBe(15)
    expect(cfg.gc.cleanup_timeout_ms).toBe(259200000)
    expect(cfg.watchdog.heartbeat_interval_ms).toBe(30000)
    expect(cfg.watchdog.zombie_timeout_ms).toBe(120000)
    expect(cfg.git.protected_branches).toEqual(["main", "dev"])
    expect(cfg.git.denied_commands).toEqual(["push --force", "reset --hard"])
  })

  test("rejects invalid human_authority", () => {
    expect(() => parseTeamConfig({ human_authority: "maybe" })).toThrow()
  })

  test("rejects negative budget values", () => {
    expect(() => parseTeamConfig({ budget: { daily_limit_usd: -1 } })).toThrow()
    expect(() => parseTeamConfig({ budget: { per_agent_daily_usd: -5 } })).toThrow()
    expect(() => parseTeamConfig({ budget: { per_task_max_usd: -1 } })).toThrow()
    expect(() => parseTeamConfig({ budget: { per_task_max_tokens: -100 } })).toThrow()
  })

  test("rejects zero or negative max_agents", () => {
    expect(() => parseTeamConfig({ limits: { max_agents: 0 } })).toThrow()
    expect(() => parseTeamConfig({ limits: { max_agents: -1 } })).toThrow()
  })

  test("rejects negative max_concurrent_tasks", () => {
    expect(() => parseTeamConfig({ limits: { max_concurrent_tasks: -1 } })).toThrow()
  })

  test("rejects negative max_delegation_depth", () => {
    expect(() => parseTeamConfig({ limits: { max_delegation_depth: -1 } })).toThrow()
  })

  test("rejects invalid gc.cleanup_timeout_ms", () => {
    expect(() => parseTeamConfig({ gc: { cleanup_timeout_ms: 0 } })).toThrow()
    expect(() => parseTeamConfig({ gc: { cleanup_timeout_ms: -1 } })).toThrow()
  })

  test("rejects invalid watchdog values", () => {
    expect(() => parseTeamConfig({ watchdog: { heartbeat_interval_ms: 0 } })).toThrow()
    expect(() => parseTeamConfig({ watchdog: { zombie_timeout_ms: -1 } })).toThrow()
  })

  test("accepts valid git.protected_branches", () => {
    const cfg = parseTeamConfig({ git: { protected_branches: ["main", "dev", "release"] } })
    expect(cfg.git.protected_branches).toEqual(["main", "dev", "release"])
  })

  test("accepts valid git.denied_commands", () => {
    const cfg = parseTeamConfig({ git: { denied_commands: ["push --force", "rebase"] } })
    expect(cfg.git.denied_commands).toEqual(["push --force", "rebase"])
  })

  test("accepts pre_merge_validation string", () => {
    const cfg = parseTeamConfig({ git: { pre_merge_validation: "bun test" } })
    expect(cfg.git.pre_merge_validation).toBe("bun test")
  })

  test("accepts nested agents with all capability fields", () => {
    const cfg = parseTeamConfig({
      agents: {
        researcher: {
          role: "researcher",
          capabilities: {
            tools: ["read", "glob", "grep"],
            share_to_team: false,
            delegate: false,
            max_delegation_depth: 0,
            disk_quota_mb: 200,
          },
          max_tasks_per_day: 10,
          disk_quota_mb: 200,
        },
      },
    })
    expect(cfg.agents.researcher.capabilities.tools).toEqual(["read", "glob", "grep"])
    expect(cfg.agents.researcher.capabilities.delegate).toBe(false)
    expect(cfg.agents.researcher.max_tasks_per_day).toBe(10)
  })

  test("partial agent config inherits defaults from base capabilities", () => {
    const cfg = parseTeamConfig({
      agents: {
        coder: {
          role: "coder",
          capabilities: { tools: ["read", "edit"] },
        },
      },
    })
    expect(cfg.agents.coder.capabilities.tools).toEqual(["read", "edit"])
    expect(cfg.agents.coder.capabilities.share_to_team).toBe(false)
    expect(cfg.agents.coder.capabilities.delegate).toBe(true)
    expect(cfg.agents.coder.capabilities.max_delegation_depth).toBe(2)
    expect(cfg.agents.coder.capabilities.disk_quota_mb).toBe(500)
    expect(cfg.agents.coder.max_tasks_per_day).toBe(50)
    expect(cfg.agents.coder.disk_quota_mb).toBe(500)
  })
})
