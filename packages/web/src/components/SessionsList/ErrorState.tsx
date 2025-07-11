import styles from "./ErrorState.module.css"

interface ErrorStateProps {
  error: string
  apiUrl?: string
}

export default function ErrorState(props: ErrorStateProps) {
  return (
    <div class={styles.errorMessage}>
      <strong>Error:</strong> {props.error}
      <p>Make sure opencode serve is running on {props.apiUrl}</p>
    </div>
  )
}