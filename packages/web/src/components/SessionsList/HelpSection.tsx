import styles from "./HelpSection.module.css"

interface HelpSectionProps {
  children: any
}

export default function HelpSection(props: HelpSectionProps) {
  return (
    <div class={styles.helpSection}>
      <h3>How to use:</h3>
      {props.children}
    </div>
  )
}