// The copy button works through client.ts.
export function CodeBlock(props: { code: string }) {
  return (
    <div class="docs-code-block">
      <pre>
        <code>{props.code}</code>
      </pre>
      <button type="button" data-copy-code data-code={props.code}>
        Copy
      </button>
    </div>
  )
}
