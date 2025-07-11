import { Show } from "solid-js"
import { getProjectPath } from "./utils"
import type { SessionData } from "./types"
import styles from "./Header.module.css"

interface HeaderProps {
  title: string
  sessions: SessionData[]
  error?: string | null
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
}

export default function Header(props: HeaderProps) {
  return (
    <div class={styles.headerRow}>
      <div class={styles.headerTitleContainer}>
        <h1 class={styles.headerTitle}>{props.title}</h1>
        <div class={styles.subheaderRow}>
          <p class={styles.projectPathSubheader}>{getProjectPath(props.sessions)}</p>
        </div>
      </div>
      <Show when={!props.error && props.sessions.length > 0}>
        <input
          type="text"
          placeholder="Search sessions..."
          value={props.globalFilter}
          onInput={(e) => props.onGlobalFilterChange(e.target.value)}
          class={styles.searchInput}
        />
      </Show>
    </div>
  )
}