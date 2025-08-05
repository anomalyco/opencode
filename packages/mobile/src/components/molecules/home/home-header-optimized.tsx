import React, { useState, useRef, useCallback, memo } from "react"
import { Box, Text } from "@/components/ui/primitives"
import { useProjectsQuery } from "@/services/api/local/projects"
import { useSessionManager } from "@/services/session-manager"
import { QuickActions, RecentSessionsHeader } from "@/components/molecules/home"
import { ConnectionStatusOptimized } from "./connection-status-optimized"
import { ProjectConnectionSheetOptimized } from "./project-connection-sheet-optimized"
import { ProjectListSheetOptimized } from "./project-list-sheet-optimized"
import { ProjectSelectorButton } from "@/components/molecules/home/project-selector-button"

import type { ProjectConnectionSheetOptimizedRef } from "./project-connection-sheet-optimized"
import type { ProjectListSheetOptimizedRef } from "./project-list-sheet-optimized"
import type { Project } from "@/db/types"

export const HomeHeaderOptimized = memo(() => {
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const connectionSheetRef = useRef<ProjectConnectionSheetOptimizedRef>(null)
  const projectListSheetRef = useRef<ProjectListSheetOptimizedRef>(null)

  const { data: projects } = useProjectsQuery()
  const projectsArray = projects || []
  const sessionManager = useSessionManager()

  const handleNewSession = useCallback(async () => {
    setIsCreatingSession(true)
    try {
      await sessionManager.navigateToNewSession()
    } catch (error) {
      // Handle error silently
    } finally {
      setIsCreatingSession(false)
    }
  }, [sessionManager])

  const handleOpenConnectionSheet = useCallback(() => {
    setEditingProject(null)
    connectionSheetRef.current?.present()
  }, [])

  const handleCloseConnectionSheet = useCallback(() => {
    setEditingProject(null)
    connectionSheetRef.current?.dismiss()
  }, [])

  const handleEditProject = useCallback((project: Project) => {
    setEditingProject(project)
    connectionSheetRef.current?.present()
  }, [])

  const handleEditActiveProject = useCallback(() => {
    // Get the active project from the projects array
    const activeProject = projectsArray.find((p) => p.isActive)
    if (activeProject) {
      handleEditProject(activeProject)
    }
  }, [projectsArray, handleEditProject])

  const handleConnectionAction = useCallback(() => {
    // If no projects exist, open add new project sheet
    if (projectsArray.length === 0) {
      handleOpenConnectionSheet()
    } else {
      // If projects exist, edit the active one
      handleEditActiveProject()
    }
  }, [projectsArray.length, handleOpenConnectionSheet, handleEditActiveProject])

  const handleProjectSelectorPress = useCallback(() => {
    if (projectsArray.length === 0) {
      handleOpenConnectionSheet()
    } else {
      projectListSheetRef.current?.present()
    }
  }, [projectsArray.length, handleOpenConnectionSheet])

  const handleCloseProjectListSheet = useCallback(() => {
    projectListSheetRef.current?.dismiss()
  }, [])

  return (
    <>
      <Box gap="lg">
        <Box p="md" gap="lg">
          {/* Header with Project Selector */}
          <Box direction="row" justifyContent="space-between" alignItems="center">
            <Box gap="xs">
              <Text size="xl" weight="bold" style={{ lineHeight: 28 }}>
                opencode
              </Text>
              <Text size="md" mode="subtle" style={{ lineHeight: 20 }}>
                AI-powered development assistant
              </Text>
            </Box>
            <ProjectSelectorButton onPress={handleProjectSelectorPress} />
          </Box>

          {/* Connection Status */}
          <ConnectionStatusOptimized onOpenConnectionSheet={handleConnectionAction} />

          {/* Quick Actions */}
          <QuickActions onNewSession={handleNewSession} isCreatingSession={isCreatingSession} />
        </Box>

        <Box pl="md" pr="md">
          {/* Sessions Header */}
          <RecentSessionsHeader />
        </Box>
      </Box>

      <ProjectConnectionSheetOptimized
        ref={connectionSheetRef}
        onClose={handleCloseConnectionSheet}
        editingProject={editingProject}
        onEditExistingProject={handleEditProject}
      />

      <ProjectListSheetOptimized
        ref={projectListSheetRef}
        onClose={handleCloseProjectListSheet}
        onAddServer={handleOpenConnectionSheet}
        onEditProject={handleEditProject}
      />
    </>
  )
})

HomeHeaderOptimized.displayName = "HomeHeaderOptimized"
