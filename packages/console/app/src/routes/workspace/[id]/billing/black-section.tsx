import styles from "./black-section.module.css"

export function BlackSection() {
  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Black</h2>
        <p>You are subscribed to Black.</p>
      </div>
    </section>
  )
}
