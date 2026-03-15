# Veritly Components

Custom components for MDX rendering in OpenCode.

## Components

### Chart

SVG-based chart component supporting line and bar charts.

```tsx
import { Chart } from "@veritly/components"

<Chart 
  data={{
    labels: ["Jan", "Feb", "Mar"],
    datasets: [
      { label: "Sales", data: [10, 20, 30], color: "#06b6d4" },
      { label: "Revenue", data: [15, 25, 35] }
    ]
  }}
  type="line" // or "bar"
/>
```

### MDXContent

Render MDX content with custom components.

```tsx
import { MDXContent, defaultComponents } from "@veritly/components"

<MDXContent 
  content="# Hello\n\n<Chart data={data} type=\"line\" />"
  components={defaultComponents}
/>
```

## Usage in Markdown

Write MDX in your markdown files:

```mdx
# Sales Report

Here's our monthly performance:

<Chart 
  data={{
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "datasets": [
      { "label": "Sales", "data": [100, 200, 150, 300] }
    ]
  }}
  type="line"
/>

## Details

Regular markdown **works** too!
```

## Integration with OpenCode UI

The `@opencode-ai/ui` package can use these components by replacing the `marked` parser with MDX:

```tsx
import { MDXContent, defaultComponents } from "@veritly/components"

// Instead of using marked, use MDXContent
function MyMarkdownRenderer(props: { content: string }) {
  return <MDXContent content={props.content} components={defaultComponents} />
}
```
