import { CodeFrame } from "~/component/site/code-frame"

// Code passed as a prop rather than fenced, in the same frame as fenced code. Copy works through client.ts.
export function CodeBlock(props: { code: string; label?: string }) {
  return (
    <CodeFrame variant="code" kind="code" label={props.label ?? ""} copy={props.code}>
      <pre tabindex={0} data-funnel-copy="snippet">
        <code>{props.code}</code>
      </pre>
    </CodeFrame>
  )
}
