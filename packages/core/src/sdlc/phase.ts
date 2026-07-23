import { Schema } from "effect"

export const PhaseLevel = Schema.Literal("Critical", "Standard", "Light")
export type PhaseLevel = typeof PhaseLevel.Type

export const QualityThresholds: Record<PhaseLevel, number> = {
  Critical: 100,
  Standard: 90,
  Light: 80,
}

export class SDLCPhase extends Schema.Class<SDLCPhase>("SDLCPhase")({
  id: Schema.Number,
  name: Schema.String,
  level: PhaseLevel,
  description: Schema.String,
  requiredPassingPercentage: Schema.Number,
}) {
  static make(id: number, name: string, level: PhaseLevel, description: string) {
    return new SDLCPhase({
      id,
      name,
      level,
      description,
      requiredPassingPercentage: QualityThresholds[level],
    })
  }
}

export const SDLCPhases: readonly SDLCPhase[] = [
  SDLCPhase.make(0, "Existing Project Analysis", "Critical", "Audit existing code, architecture, database, and API"),
  SDLCPhase.make(1, "Penetration Testing (Static)", "Critical", "Static code vulnerability scanning and secret leakage audit"),
  SDLCPhase.make(2, "Ideation", "Light", "Concept exploration and feasibility study"),
  SDLCPhase.make(3, "MVP Definition", "Standard", "Core features definition and scope boundaries"),
  SDLCPhase.make(4, "Product Strategy", "Standard", "User stories, acceptance criteria, and roadmap"),
  SDLCPhase.make(5, "Architecture Design", "Critical", "System architecture, ADRs, and component design"),
  SDLCPhase.make(6, "UI/UX Design", "Light", "Wireframes, workflows, and accessibility guidelines"),
  SDLCPhase.make(7, "Development Setup", "Standard", "Environment, CI/CD pipelines, and project scaffolding"),
  SDLCPhase.make(8, "Database Design", "Standard", "Schema modeling, migrations, and indexing strategy"),
  SDLCPhase.make(9, "Backend Development", "Standard", "Core services, domain logic, and API endpoints"),
  SDLCPhase.make(10, "Testing & Code Review", "Standard", "Unit testing, integration testing, and code review"),
  SDLCPhase.make(11, "Frontend Development", "Standard", "UI implementation, component tree, and state management"),
  SDLCPhase.make(12, "Integration", "Standard", "End-to-end integration and API wiring"),
  SDLCPhase.make(13, "DevOps / Deployment", "Standard", "Infrastructure setup, staging deploy, and release automation"),
  SDLCPhase.make(14, "Penetration Testing (Dynamic)", "Critical", "Runtime security testing and post-deploy vulnerability audit"),
  SDLCPhase.make(15, "Maintenance & Monitoring", "Standard", "SLI/SLO monitoring, error budget management, and logging"),
]
