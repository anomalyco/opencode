import styles from "./EmptyState.module.css"

interface EmptyStateProps {
  message: string
}

export default function EmptyState(props: EmptyStateProps) {
  return <p class={styles.emptyState}>{props.message}</p>
}