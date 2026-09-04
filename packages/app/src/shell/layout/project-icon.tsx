import { ProjectAvatar, type ProjectAvatarProps } from "@opencode-ai/ui/project-avatar"
import { splitProps } from "solid-js"
import { displayName, getProjectAvatarSource } from "@/shell/layout/helpers"
import { getProjectAvatarVariant, type LocalProject } from "@/shell/state/layout"

type ProjectIconProps = Omit<ProjectAvatarProps, "fallback" | "src" | "variant"> & {
  project: LocalProject
  fallback?: string
  icon?: LocalProject["icon"]
}

export function ProjectIcon(props: ProjectIconProps) {
  const [local, rest] = splitProps(props, ["project", "fallback", "icon"])
  const icon = () => local.icon ?? local.project.icon

  return (
    <ProjectAvatar
      {...rest}
      fallback={local.fallback ?? displayName(local.project)}
      src={getProjectAvatarSource(local.project.id, icon())}
      variant={getProjectAvatarVariant(icon()?.color)}
    />
  )
}
