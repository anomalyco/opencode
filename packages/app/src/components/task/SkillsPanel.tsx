import { Component, For, Show, createSignal, onMount } from 'solid-js'
import { useServer } from '@opencode-ai/app/context/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { usePlatform } from '@opencode-ai/app/context/platform'
import styles from './SkillsPanel.module.css'

export interface SkillInfo {
  name: string
  description: string
  location: string
}

export const SkillsPanel: Component = () => {
  const server = useServer()
  const platform = usePlatform()
  const [skills, setSkills] = createSignal<SkillInfo[]>([])
  const [searchQuery, setSearchQuery] = createSignal('')
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    await fetchSkills()
  })

  const fetchSkills = async () => {
    if (!server.url) return

    setIsLoading(true)
    setError(null)

    try {
      const sdk = createOpencodeClient({
        baseUrl: server.url,
        fetch: platform.fetch,
      })

      const response = await sdk.app.skills()
      setSkills(response as SkillInfo[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch skills')
      console.error('Error fetching skills:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredSkills = () => {
    const query = searchQuery().toLowerCase()
    if (!query) return skills()

    return skills().filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    )
  }

  const handleInvoke = (skillName: string) => {
    // TODO: Implement skill invocation
    console.log('Invoking skill:', skillName)
    alert(`Skill invocation for "${skillName}" is not yet implemented.`)
  }

  const handleRefresh = () => {
    fetchSkills()
  }

  return (
    <div class={styles.panel}>
      <div class={styles.header}>
        <h2 class={styles.title}>Skills</h2>
        <button
          class={styles.refreshButton}
          onClick={handleRefresh}
          disabled={isLoading()}
          title="Refresh skills list"
        >
          {isLoading() ? '...' : '↻'}
        </button>
      </div>

      <div class={styles.searchContainer}>
        <input
          type="text"
          class={styles.searchInput}
          placeholder="Search skills..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>

      <Show when={error()}>
        <div class={styles.error}>
          <span class={styles.errorIcon}>⚠</span>
          {error()}
        </div>
      </Show>

      <Show when={isLoading() && skills().length === 0}>
        <div class={styles.loading}>Loading skills...</div>
      </Show>

      <Show when={!isLoading() && skills().length === 0 && !error()}>
        <div class={styles.empty}>No skills found</div>
      </Show>

      <div class={styles.skillsList}>
        <For each={filteredSkills()}>
          {(skill) => (
            <div class={styles.skillCard}>
              <div class={styles.skillHeader}>
                <h3 class={styles.skillName}>{skill.name}</h3>
                <button
                  class={styles.invokeButton}
                  onClick={() => handleInvoke(skill.name)}
                  title={`Invoke ${skill.name}`}
                >
                  Invoke
                </button>
              </div>
              <p class={styles.skillDescription}>{skill.description}</p>
              <div class={styles.skillLocation}>
                <span class={styles.locationIcon}>📁</span>
                {skill.location}
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={!isLoading() && filteredSkills().length === 0 && skills().length > 0}>
        <div class={styles.noResults}>No skills match your search</div>
      </Show>
    </div>
  )
}
