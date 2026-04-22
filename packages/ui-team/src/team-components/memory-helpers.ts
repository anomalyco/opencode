import type { UiI18n } from "../../../ui/src/context/i18n"

type Entry = {
  title: string
  content: string
  title_ui?: string
  content_ui?: string
  ui_locale?: string
}

export function memoryAreaText(i18n: UiI18n, value?: string) {
  if (value === "project_rules") return i18n.t("ui.memory.area.projectRules")
  if (value === "atlas_private") return i18n.t("ui.memory.area.atlasPrivate")
  if (value === "lessons") return i18n.t("ui.memory.area.lessons")
  if (value === "feature_memory") return i18n.t("ui.memory.area.featureMemory")
  return value
}

export function memoryClassText(i18n: UiI18n, value?: string) {
  if (value === "rule") return i18n.t("ui.memory.class.rule")
  if (value === "knowledge") return i18n.t("ui.memory.class.knowledge")
  if (value === "evidence") return i18n.t("ui.memory.class.evidence")
  if (value === "artifact") return i18n.t("ui.memory.class.artifact")
  return value
}

export function memoryKindText(i18n: UiI18n, value?: string) {
  if (value === "repo_convention") return i18n.t("ui.memory.kind.repoConvention")
  if (value === "package_behavior") return i18n.t("ui.memory.kind.packageBehavior")
  if (value === "runtime_behavior") return i18n.t("ui.memory.kind.runtimeBehavior")
  if (value === "validation") return i18n.t("ui.memory.kind.validation")
  if (value === "migration_gotcha") return i18n.t("ui.memory.kind.migrationGotcha")
  if (value === "finding") return i18n.t("ui.memory.kind.finding")
  if (value === "remediation") return i18n.t("ui.memory.kind.remediation")
  if (value === "verification") return i18n.t("ui.memory.kind.verification")
  if (value === "measurement") return i18n.t("ui.memory.kind.measurement")
  if (value === "baseline") return i18n.t("ui.memory.kind.baseline")
  if (value === "optimization") return i18n.t("ui.memory.kind.optimization")
  if (value === "lesson") return i18n.t("ui.memory.kind.lesson")
  if (value === "note") return i18n.t("ui.memory.kind.note")
  return value
}

export function memoryDomainText(i18n: UiI18n, value?: string) {
  if (value === "general") return i18n.t("ui.memory.domain.general")
  if (value === "security") return i18n.t("ui.memory.domain.security")
  if (value === "performance") return i18n.t("ui.memory.domain.performance")
  if (value === "data") return i18n.t("ui.memory.domain.data")
  if (value === "frontend") return i18n.t("ui.memory.domain.frontend")
  if (value === "tooling" || value === "runtime" || value === "atlas") return i18n.t("ui.memory.domain.general")
  return value
}

export function memoryStatusText(i18n: UiI18n, value?: string) {
  if (value === "active") return i18n.t("ui.memory.status.active")
  if (value === "archived") return i18n.t("ui.memory.status.archived")
  return value
}

export function memoryCopy(item: Entry, locale: string) {
  if (item.ui_locale !== locale) {
    return {
      title: item.title,
      content: item.content,
    }
  }

  return {
    title: item.title_ui ?? item.title,
    content: item.content_ui ?? item.content,
  }
}
