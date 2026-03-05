import { Component } from "solid-js"
import { List } from "@opencode-ai/ui/list"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Button } from "@opencode-ai/ui/button"
import { Tag } from "@opencode-ai/ui/tag"
import { useLanguage } from "@/context/language"
import { getRelativeTime } from "@/utils/time"

type Release = {
  tag: string
  body: string
  date: string
}

interface ReleaseListProps {
  releases: Release[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

export const ReleaseList: Component<ReleaseListProps> = (props) => {
  const language = useLanguage()

  return (
    <List
      items={props.releases}
      key={(x) => x.tag}
      search={false}
      emptyMessage="No releases found"
      loadingMessage={language.t("common.loading")}
      class="flex-1 min-h-0 overflow-hidden flex flex-col [&_[data-slot=list-scroll]]:session-scroller [&_[data-slot=list-item]]:block [&_[data-slot=list-item]]:p-0 [&_[data-slot=list-item]]:border-0 [&_[data-slot=list-item]]:bg-transparent [&_[data-slot=list-item]]:text-left [&_[data-slot=list-item]]:cursor-default [&_[data-slot=list-item]]:hover:bg-transparent [&_[data-slot=list-item]]:focus:outline-none"
      add={{
        render: () =>
          props.hasMore ? (
            <div class="p-4 flex justify-center">
              <Button variant="secondary" size="small" onClick={props.onLoadMore} loading={props.loadingMore}>
                {language.t("common.loadMore")}
              </Button>
            </div>
          ) : null,
      }}
    >
      {(item) => (
        <div class="mb-8">
          <div class="py-2 pr-3 pl-2 flex items-baseline gap-2 sticky top-0 z-10 bg-surface-raised-stronger-non-alpha">
            <span class="text-[20px] font-semibold">{item.tag}</span>
            <span class="text-xs text-text-weak">{item.date ? getRelativeTime(item.date, language.t) : ""}</span>
            {item.tag === props.releases[0]?.tag && <Tag>{language.t("changelog.tag.latest")}</Tag>}
          </div>
          <div class="px-2 pb-2">
            <Markdown
              text={item.body}
              class="prose prose-sm max-w-none text-text-base [&_h2]:border-b [&_h2]:border-border-weak-base [&_h2]:pb-1 [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:capitalize [&_h2:first-child]:mt-4 [&_a.external-link]:text-text-interactive-base [&_a.external-link]:font-medium"
            />
          </div>
        </div>
      )}
    </List>
  )
}
