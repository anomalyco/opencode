import { Collapsible } from "@kobalte/core/collapsible"
import { ParentProps } from "solid-js"

export function Faq(props: ParentProps & { question: string }) {
  return (
    <Collapsible data-slot="faq-item">
      <Collapsible.Trigger data-slot="faq-question">
        <svg
          data-slot="faq-icon-plus"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12.5 11.5H19V12.5H12.5V19H11.5V12.5H5V11.5H11.5V5H12.5V11.5Z" fill="currentColor" />
        </svg>
        <svg
          data-slot="faq-icon-minus"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 11.5H19V12.5H5Z" fill="currentColor" />
        </svg>
        <div data-slot="faq-question-text">{props.question}</div>
      </Collapsible.Trigger>
      <Collapsible.Content data-slot="faq-answer">{props.children}</Collapsible.Content>
    </Collapsible>
  )
}
