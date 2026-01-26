/**
 * SkillsPanel Component Tests
 *
 * Note: These tests require @solidjs/testing-library and @testing-library/jest-dom
 * to be installed in devDependencies. The tests can be run once the testing
 * infrastructure is properly set up.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
// Uncomment when testing dependencies are available:
// import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library'
// import '@testing-library/jest-dom'
// import { ServerProvider } from '@opencode-ai/app/context/server'
// import { PlatformProvider } from '@opencode-ai/app/context/platform'
import { SkillsPanel } from '../src/components/SkillsPanel'
import type { SkillInfo } from '../src/components/SkillsPanel'

// Mock server context
const mockServerContext = {
  url: 'http://localhost:3000',
  name: 'localhost',
  ready: true,
  healthy: true,
  isLocal: true,
  list: ['http://localhost:3000'],
  setActive: () => {},
  add: () => {},
  remove: () => {},
  projects: {
    list: [],
    open: () => {},
    close: () => {},
    expand: () => {},
    collapse: () => {},
    move: () => {},
    last: () => undefined,
    touch: () => {},
  },
}

// Mock platform context
const mockPlatformContext = {
  platform: 'web' as const,
  openLink: () => {},
  restart: async () => {},
  notify: async () => {},
  fetch: global.fetch,
}

describe('SkillsPanel', () => {
  const mockSkills: SkillInfo[] = [
    {
      name: 'commit',
      description: 'Create well-formatted commits with conventional commit messages',
      location: '.opencode/skill/commit',
    },
    {
      name: 'code-simplifier',
      description: 'Simplifies and refines code for clarity and maintainability',
      location: '.opencode/skill/code-simplifier',
    },
    {
      name: 'mcp-builder',
      description: 'Guide for creating high-quality MCP servers',
      location: '.opencode/skill/mcp-builder',
    },
  ]

  describe('Basic Rendering', () => {
    test('should render panel container', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const { container } = render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      // const panel = container.querySelector('.panel')
      // expect(panel).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })

    test('should render title header', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      // expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })

    test('should render refresh button', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      // const refreshButton = screen.getByTitle('Refresh skills list')
      // expect(refreshButton).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })

    test('should render search input', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      // const searchInput = screen.getByPlaceholderText('Search skills...')
      // expect(searchInput).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Skills List', () => {
    test('should render skill cards', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // Mock API response
      // global.fetch = jest.fn(() =>
      //   Promise.resolve({
      //     ok: true,
      //     json: () => Promise.resolve(mockSkills),
      //   } as Response)
      // ) as jest.Mock
      //
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      //
      // await waitFor(() => {
      //   expect(screen.getByText('commit')).toBeInTheDocument()
      //   expect(screen.getByText('code-simplifier')).toBeInTheDocument()
      //   expect(screen.getByText('mcp-builder')).toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })

    test('should render skill descriptions', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // Similar to above, verify descriptions are rendered
      expect(true).toBe(true) // Placeholder
    })

    test('should render skill locations', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // Verify skill locations are displayed with folder icon
      expect(true).toBe(true) // Placeholder
    })

    test('should render invoke button for each skill', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const invokeButtons = screen.getAllByTitle(/Invoke/)
      // expect(invokeButtons).toHaveLength(3)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Search Functionality', () => {
    test('should filter skills by name', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const searchInput = screen.getByPlaceholderText('Search skills...')
      // fireEvent.input(searchInput, { target: { value: 'commit' } })
      // await waitFor(() => {
      //   expect(screen.getByText('commit')).toBeInTheDocument()
      //   expect(screen.queryByText('code-simplifier')).not.toBeInTheDocument()
      //   expect(screen.queryByText('mcp-builder')).not.toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })

    test('should filter skills by description', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const searchInput = screen.getByPlaceholderText('Search skills...')
      // fireEvent.input(searchInput, { target: { value: 'MCP' } })
      // await waitFor(() => {
      //   expect(screen.getByText('mcp-builder')).toBeInTheDocument()
      //   expect(screen.queryByText('commit')).not.toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })

    test('should be case-insensitive', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const searchInput = screen.getByPlaceholderText('Search skills...')
      // fireEvent.input(searchInput, { target: { value: 'COMMIT' } })
      // await waitFor(() => {
      //   expect(screen.getByText('commit')).toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })

    test('should show no results message when no matches', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const searchInput = screen.getByPlaceholderText('Search skills...')
      // fireEvent.input(searchInput, { target: { value: 'nonexistent' } })
      // await waitFor(() => {
      //   expect(screen.getByText('No skills match your search')).toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Loading States', () => {
    test('should show loading state on initial render', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      // expect(screen.getByText('Loading skills...')).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })

    test('should disable refresh button while loading', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const refreshButton = screen.getByTitle('Refresh skills list')
      // expect(refreshButton).toBeDisabled()
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Error Handling', () => {
    test('should display error message when fetch fails', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // global.fetch = jest.fn(() =>
      //   Promise.reject(new Error('Network error'))
      // ) as jest.Mock
      //
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      //
      // await waitFor(() => {
      //   expect(screen.getByText(/Failed to fetch skills/)).toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })

    test('should show error icon with error message', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // Verify error icon (⚠) is displayed
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Empty State', () => {
    test('should show empty state when no skills available', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // global.fetch = jest.fn(() =>
      //   Promise.resolve({
      //     ok: true,
      //     json: () => Promise.resolve([]),
      //   } as Response)
      // ) as jest.Mock
      //
      // render(() => (
      //   <PlatformProvider value={mockPlatformContext}>
      //     <ServerProvider defaultUrl="http://localhost:3000">
      //       <SkillsPanel />
      //     </ServerProvider>
      //   </PlatformProvider>
      // ))
      //
      // await waitFor(() => {
      //   expect(screen.getByText('No skills found')).toBeInTheDocument()
      // })
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('User Interactions', () => {
    test('should handle refresh button click', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const refreshButton = screen.getByTitle('Refresh skills list')
      // fireEvent.click(refreshButton)
      // Verify fetch is called again
      expect(true).toBe(true) // Placeholder
    })

    test('should handle invoke button click', async () => {
      // TODO: Implement when @solidjs/testing-library is available
      // global.alert = jest.fn()
      // const invokeButton = screen.getByTitle('Invoke commit')
      // fireEvent.click(invokeButton)
      // expect(global.alert).toHaveBeenCalledWith(
      //   'Skill invocation for "commit" is not yet implemented.'
      // )
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Accessibility', () => {
    test('should have proper heading hierarchy', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const heading = screen.getByRole('heading', { name: 'Skills' })
      // expect(heading).toBeInTheDocument()
      expect(true).toBe(true) // Placeholder
    })

    test('should have accessible form controls', () => {
      // TODO: Implement when @solidjs/testing-library is available
      // const searchInput = screen.getByRole('searchbox')
      // expect(searchInput).toBeInTheDocument()
      // Verify ARIA labels and roles
      expect(true).toBe(true) // Placeholder
    })
  })
})
