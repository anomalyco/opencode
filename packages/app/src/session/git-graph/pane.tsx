import type { Vcs } from "@opencode/schema/vcs"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { layoutGitGraph, LANE_COLOUR_COUNT, type GitGraphLayoutPath } from "./layout"

const GRAPH_COLUMN_MIN_WIDTH = 64
const LOAD_MORE_THRESHOLD = 96

function laneColour(colourIndex: number) {
  return `var(--git-graph-lane-${colourIndex % LANE_COLOUR_COUNT})`
}

function shortHash(hash: string) {
  return hash.slice(0, 8)
}

function pathRelated(path: GitGraphLayoutPath, hash?: string) {
  return !!hash && path.relatedHashes.includes(hash)
}

export function GitGraphPane(props: {
  commits: readonly Vcs.GraphCommit[]
  selectedHash?: string
  expandedHash?: string
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  onSelect: (hash: string) => void
  onLoadMore: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ hoveredHash: undefined as string | undefined })
  const layout = createMemo(() => layoutGitGraph(props.commits))
  const graphWidth = createMemo(() => Math.max(GRAPH_COLUMN_MIN_WIDTH, layout().width + 12))
  const expandedCommit = createMemo(() => props.commits.find((commit) => commit.hash === props.expandedHash))
  const date = (value: number | null, style: "short" | "long") => {
    if (value === null) return language.t("gitGraph.value.unknown")
    return new Intl.DateTimeFormat(language.intl(), {
      dateStyle: style === "short" ? "medium" : "full",
      timeStyle: style === "short" ? "short" : "long",
    }).format(new Date(value))
  }
  const onScroll = (event: Event) => {
    if (!props.hasMore || props.loadingMore) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    if (target.scrollHeight - target.scrollTop - target.clientHeight <= LOAD_MORE_THRESHOLD) props.onLoadMore()
  }

  return (
    <section class="git-graph-pane">
      <div class="git-graph-scroll" data-scrollable onScroll={onScroll}>
        <div class="git-graph-table" style={{ "--git-graph-width": `${graphWidth()}px` }}>
          <div class="git-graph-header git-graph-header-graph">{language.t("gitGraph.column.graph")}</div>
          <div class="git-graph-header git-graph-header-fields">
            <span>{language.t("gitGraph.column.description")}</span>
            <span>{language.t("gitGraph.column.date")}</span>
            <span>{language.t("gitGraph.column.author")}</span>
            <span>{language.t("gitGraph.column.commit")}</span>
          </div>

          <div class="git-graph-canvas" style={{ height: `${layout().height}px` }}>
            <svg
              width={graphWidth()}
              height={layout().height}
              viewBox={`0 0 ${graphWidth()} ${layout().height}`}
              role="img"
              aria-label={language.t("gitGraph.graph.ariaLabel")}
            >
              <For each={layout().paths}>
                {(path) => (
                  <path
                    d={path.path}
                    fill="none"
                    stroke={laneColour(path.colourIndex)}
                    stroke-width="2"
                    data-muted={state.hoveredHash && !pathRelated(path, state.hoveredHash) ? "true" : undefined}
                    data-highlighted={pathRelated(path, state.hoveredHash) ? "true" : undefined}
                  />
                )}
              </For>
              <For each={layout().rows}>
                {(row) => (
                  <g>
                    <circle
                      cx={row.x}
                      cy={row.y}
                      r={row.commit.hash === props.selectedHash ? 4.5 : 4}
                      fill={laneColour(row.colourIndex)}
                      class="git-graph-node"
                    />
                    <Show when={row.commit.hash === props.selectedHash}>
                      <circle
                        cx={row.x}
                        cy={row.y}
                        r="6"
                        fill="none"
                        stroke={laneColour(row.colourIndex)}
                        stroke-width="1"
                        class="git-graph-node-ring"
                      />
                    </Show>
                  </g>
                )}
              </For>
            </svg>
          </div>

          <div class="git-graph-rows">
            <For each={layout().rows}>
              {(row) => {
                const selected = () => row.commit.hash === props.selectedHash
                return (
                  <button
                    type="button"
                    class="git-graph-row"
                    data-selected={selected() ? "true" : undefined}
                    aria-expanded={row.commit.hash === props.expandedHash}
                    style={{ height: `${layout().rowHeight}px` }}
                    onClick={() => props.onSelect(row.commit.hash)}
                    onMouseEnter={() => setState("hoveredHash", row.commit.hash)}
                    onMouseLeave={() => setState("hoveredHash", undefined)}
                    onFocus={() => setState("hoveredHash", row.commit.hash)}
                    onBlur={() => setState("hoveredHash", undefined)}
                  >
                    <span class="git-graph-description">
                      <span class="git-graph-refs">
                        <For each={row.commit.refs.slice(0, 4)}>
                          {(ref) => (
                            <span class="git-graph-ref" data-kind={ref.kind} title={ref.name}>
                              <Show when={ref.kind === "head" || ref.kind === "branch" || ref.kind === "remote"}>
                                <Icon name="branch" size="small" />
                              </Show>
                              <span>{ref.name}</span>
                            </span>
                          )}
                        </For>
                        <Show when={row.commit.refs.length > 4}>
                          <span
                            class="git-graph-ref git-graph-ref-more"
                            title={row.commit.refs
                              .slice(4)
                              .map((ref) => ref.name)
                              .join(", ")}
                          >
                            +{row.commit.refs.length - 4}
                          </span>
                        </Show>
                      </span>
                      <span class="git-graph-subject" title={row.commit.subject}>
                        {row.commit.subject || shortHash(row.commit.hash)}
                      </span>
                      <Show when={row.commit.parents.length > 1}>
                        <span class="git-graph-merge" title={language.t("gitGraph.merge")}>
                          <Icon name="branch-out" size="small" />
                        </span>
                      </Show>
                      <Show when={row.truncated}>
                        <span class="git-graph-continues" title={language.t("gitGraph.continues")}>
                          <Icon name="collapse" size="small" />
                        </span>
                      </Show>
                    </span>
                    <span class="git-graph-date" title={date(row.commit.authoredAtMs, "long")}>
                      {date(row.commit.authoredAtMs, "short")}
                    </span>
                    <span class="git-graph-author" title={row.commit.authorName ?? undefined}>
                      {row.commit.authorName ?? language.t("gitGraph.value.unknown")}
                    </span>
                    <code class="git-graph-hash" title={row.commit.hash}>
                      {shortHash(row.commit.hash)}
                    </code>
                  </button>
                )
              }}
            </For>
          </div>

          <Show when={props.hasMore || props.loadMoreFailed}>
            <div class="git-graph-load-more" role={props.loadMoreFailed ? "alert" : undefined}>
              <Show when={props.loadMoreFailed}>
                <span>{language.t("gitGraph.error.loadMore")}</span>
              </Show>
              <Button size="small" variant="ghost-muted" disabled={props.loadingMore} onClick={props.onLoadMore}>
                {props.loadingMore ? language.t("gitGraph.loadingMore") : language.t("gitGraph.loadMore")}
              </Button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={expandedCommit()}>
        {(commit) => (
          <aside class="git-graph-detail" aria-label={language.t("gitGraph.detail.ariaLabel")}>
            <div class="git-graph-detail-subject">{commit().subject || shortHash(commit().hash)}</div>
            <dl>
              <div>
                <dt>{language.t("gitGraph.detail.commit")}</dt>
                <dd>
                  <code>{commit().hash}</code>
                </dd>
              </div>
              <div>
                <dt>{language.t("gitGraph.detail.author")}</dt>
                <dd>{commit().authorName ?? language.t("gitGraph.value.unknown")}</dd>
              </div>
              <div>
                <dt>{language.t("gitGraph.detail.date")}</dt>
                <dd>{date(commit().authoredAtMs, "long")}</dd>
              </div>
              <div>
                <dt>{language.t("gitGraph.detail.parents")}</dt>
                <dd>
                  {commit().parents.length
                    ? commit()
                        .parents.map((parent) => shortHash(parent))
                        .join(", ")
                    : language.t("gitGraph.value.none")}
                </dd>
              </div>
              <div>
                <dt>{language.t("gitGraph.detail.refs")}</dt>
                <dd>
                  {commit().refs.length
                    ? commit()
                        .refs.map((ref) => ref.name)
                        .join(", ")
                    : language.t("gitGraph.value.none")}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </Show>
    </section>
  )
}
