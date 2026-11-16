import { Index } from "solid-js"
import { DocumentSurface } from "./document-surface"

const defaults = { pages: 1, width: 640 }

export default {
  title: "UI/DocumentSurface",
  id: "ui-document-surface",
  args: defaults,
  argTypes: {
    pages: { control: { type: "range", min: 1, max: 5, step: 1 } },
    width: { control: { type: "range", min: 240, max: 800, step: 10 } },
  },
  render: (args: typeof defaults) => (
    <div class="max-w-full [container-type:inline-size]" style={{ width: `${args.width}px` }}>
      <div
        data-scrollable
        data-document-surface-scrollport
        class="max-h-[60dvh] overflow-auto rounded-md bg-v2-background-bg-layer-01 py-3"
      >
        <div data-document-surface-column data-document-surface-inset class="grid gap-3">
          <Index each={Array.from({ length: args.pages })}>
            {(_, i) => (
              <DocumentSurface class="flex min-h-64 flex-col justify-between p-6">
                <h3 class="font-medium">Project notes</h3>
                <p>
                  Page {i + 1} of {args.pages}
                </p>
              </DocumentSurface>
            )}
          </Index>
        </div>
      </div>
    </div>
  ),
}

export const SinglePage = {}

export const PageStack = { args: { pages: 3 } }

export const Narrow = { args: { pages: 2, width: 300 } }
