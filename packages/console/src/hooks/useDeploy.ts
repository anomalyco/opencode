import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AFDeployConfig, AFDeployResult, BuildResult, BundleResult, DeployProgress, DeployState } from '../types'
import { afBackendClient } from '../lib'

export function useDeploy() {
  const [state, setState] = useState<DeployState>({
    isDeploying: false,
    progress: null,
    lastDeployResult: null,
    error: null,
  })

  const updateProgress = useCallback((progress: DeployProgress) => {
    setState(prev => ({
      ...prev,
      progress,
      error: progress.error || null,
    }))
  }, [])

  const deployToAF = useCallback(async (rootPath: string, config: AFDeployConfig): Promise<AFDeployResult> => {
    setState(prev => ({
      ...prev,
      isDeploying: true,
      error: null,
      progress: {
        step: 'building',
        message: 'Starting build process...',
        progress: 0,
      }
    }))

    try {
      // Step 1: Build the project
      updateProgress({
        step: 'building',
        message: 'Running pnpm build...',
        progress: 10,
      })

      const buildResult = await invoke<BuildResult>('deploy_build_workspace', {
        workspaceId: config.workspaceId,
        rootPath,
      })

      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.error}`)
      }

      // Step 2: Bundle the dist directory
      updateProgress({
        step: 'bundling',
        message: 'Creating deployment bundle...',
        progress: 30,
      })

      const bundleFileName = `${config.workspaceId}-${Date.now()}.tar.gz`
      const bundleResult = await invoke<BundleResult>('bundle_dist', {
        distPath: buildResult.distPath,
        outputName: bundleFileName,
      })

      if (!bundleResult.success) {
        throw new Error(`Bundle creation failed: ${bundleResult.error}`)
      }

      // Step 3: Get OSS upload credentials
      updateProgress({
        step: 'uploading',
        message: 'Getting upload credentials...',
        progress: 40,
      })

      const uploadCred = await afBackendClient.getUploadCredential(
        config.workspaceId,
        bundleFileName
      )

      // Step 4: Upload to OSS
      updateProgress({
        step: 'uploading',
        message: 'Uploading to cloud storage...',
        progress: 50,
      })

      await invoke<string>('upload_to_oss', {
        filePath: bundleResult.bundlePath,
        credential: uploadCred,
      })

      // Step 5: Register artifact with AF
      updateProgress({
        step: 'registering',
        message: 'Registering artifact...',
        progress: 80,
      })

      const artifact = await afBackendClient.createArtifact({
        workspaceId: config.workspaceId,
        type: 'webapp',
        name: config.name,
        description: config.description,
        tags: config.tags,
        storageRef: uploadCred.ossKey,
        manifest: {
          bundleUrl: uploadCred.publicUrl,
          entryPoint: 'index.html',
          capacitorConfig: {
            plugins: ['@capacitor/filesystem', '@capacitor/camera'],
          },
        },
      })

      // Step 6: Publish to feed (optional for prod)
      if (config.env === 'prod') {
        updateProgress({
          step: 'publishing',
          message: 'Publishing to feed...',
          progress: 90,
        })

        await afBackendClient.publishToFeed(artifact.id)
      }

      // Step 7: Complete
      updateProgress({
        step: 'completed',
        message: 'Deployment completed successfully!',
        progress: 100,
      })

      const result: AFDeployResult = {
        artifactId: artifact.id,
        bundleUrl: uploadCred.publicUrl,
        shareUrl: `https://app.agent-foundry.com/a/${artifact.id}`,
        version: artifact.version,
      }

      // Cleanup bundle file
      try {
        await invoke('cleanup_bundle', { bundlePath: bundleResult.bundlePath })
      } catch (err) {
        console.warn('Failed to cleanup bundle file:', err)
      }

      setState(prev => ({
        ...prev,
        isDeploying: false,
        lastDeployResult: result,
      }))

      return result

    } catch (error: any) {
      const errorMessage = error.message || 'Deployment failed with unknown error'

      updateProgress({
        step: 'error',
        message: 'Deployment failed',
        progress: 0,
        error: errorMessage,
      })

      setState(prev => ({
        ...prev,
        isDeploying: false,
        error: errorMessage,
      }))

      throw error
    }
  }, [updateProgress])

  const clearError = useCallback(() => {
    setState(prev => ({
      ...prev,
      error: null,
    }))
  }, [])

  const resetState = useCallback(() => {
    setState({
      isDeploying: false,
      progress: null,
      lastDeployResult: null,
      error: null,
    })
  }, [])

  return {
    ...state,
    deployToAF,
    clearError,
    resetState,
  }
}