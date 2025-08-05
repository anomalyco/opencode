import React, { useRef, useCallback } from "react"
import { HomePage } from "@/components/pages/home"
import { WelcomeScreen } from "@/components/molecules/home/welcome-screen"
import { ProjectConnectionSheetOptimized } from "@/components/molecules/home/project-connection-sheet-optimized"
import { useProjectsQuery } from "@/services/api/local/projects"
import type { ProjectConnectionSheetOptimizedRef } from "@/components/molecules/home/project-connection-sheet-optimized"

export default function Page() {
  const { data: projects } = useProjectsQuery()
  const projectsArray = projects || []
  const connectionSheetRef = useRef<ProjectConnectionSheetOptimizedRef>(null)

  const handleAddProject = useCallback(() => {
    connectionSheetRef.current?.present()
  }, [])

  const handleCloseConnectionSheet = useCallback(() => {
    connectionSheetRef.current?.dismiss()
  }, [])

  // Show welcome screen if no projects exist
  if (projectsArray.length === 0) {
    return (
      <>
        <WelcomeScreen onAddProject={handleAddProject} />
        <ProjectConnectionSheetOptimized
          ref={connectionSheetRef}
          onClose={handleCloseConnectionSheet}
          editingProject={null}
          onEditExistingProject={() => {}}
        />
      </>
    )
  }

  // Show normal home page with projects
  return <HomePage />
}
