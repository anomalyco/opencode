import { Show, For } from "solid-js"
import { ProviderIcon } from "./share/part"
import { IconOpencode } from "./icons/custom"

export interface SessionData {
  id: string
  title?: string
  time: {
    created: number
    updated: number
  }
  version?: string
  exportedAt?: number
  computedData: {
    rootDir?: string
    created: number
    completed?: number
    models: Record<string, string[]>
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
    }
  }
}

interface SessionsListProps {
  sessions: SessionData[]
  title: string
  emptyMessage: string
  helpText?: string
  error?: string | null
  apiUrl?: string
  basePath?: string
}

export default function SessionsList(props: SessionsListProps) {
  return (
    <div class="local-sessions">
      <h1>{props.title}</h1>

      <Show when={props.error}>
        <div class="error-message">
          <strong>Error:</strong> {props.error}
          <p>Make sure opencode serve is running on {props.apiUrl}</p>
        </div>
      </Show>

      <Show when={!props.error}>
        <div>
          <Show when={props.sessions.length === 0}>
            <p class="empty-state">{props.emptyMessage}</p>
          </Show>

          <Show when={props.sessions.length > 0}>
            <div class="sessions-list">
              <For each={props.sessions}>
                {(session) => (
                  <div class="session-item">
                    <div class="session-title">
                      <h3>
                        <a
                          href={`${props.basePath}/${session.id}`}
                          class="session-link"
                        >
                          {session.title?.trim() || "(no title)"}
                        </a>
                      </h3>
                    </div>
                    <div data-section="row">
                      <ul data-section="stats">
                        <li>
                          <span data-element-label>Cost</span>
                          {session.computedData.cost !== undefined ? (
                            <span>${session.computedData.cost.toFixed(2)}</span>
                          ) : (
                            <span data-placeholder>&mdash;</span>
                          )}
                        </li>
                        <li>
                          <span data-element-label>Input Tokens</span>
                          {session.computedData.tokens.input ? (
                            <span>{session.computedData.tokens.input}</span>
                          ) : (
                            <span data-placeholder>&mdash;</span>
                          )}
                        </li>
                        <li>
                          <span data-element-label>Output Tokens</span>
                          {session.computedData.tokens.output ? (
                            <span>{session.computedData.tokens.output}</span>
                          ) : (
                            <span data-placeholder>&mdash;</span>
                          )}
                        </li>
                        <li>
                          <span data-element-label>Reasoning Tokens</span>
                          {session.computedData.tokens.reasoning ? (
                            <span>{session.computedData.tokens.reasoning}</span>
                          ) : (
                            <span data-placeholder>&mdash;</span>
                          )}
                        </li>
                      </ul>
                      <Show when={session.computedData.rootDir}>
                        <ul data-section="stats" data-section-root>
                          <li title="Project root">
                            <div data-slot="icon">
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                              </svg>
                            </div>
                            <span>{session.computedData.rootDir}</span>
                          </li>
                          <li title="opencode version">
                            <div data-slot="icon" title="opencode">
                              <IconOpencode width={16} height={16} />
                            </div>
                            <span>v{session.version || "0.0.1"}</span>
                          </li>
                        </ul>
                      </Show>
                      <Show when={!session.computedData.rootDir}>
                        <ul data-section="stats" data-section-root>
                          <li title="opencode version">
                            <div data-slot="icon" title="opencode">
                              <IconOpencode width={16} height={16} />
                            </div>
                            <span>v{session.version || "0.0.1"}</span>
                          </li>
                        </ul>
                      </Show>
                      <ul data-section="stats" data-section-models>
                        <Show
                          when={
                            Object.values(session.computedData.models).length >
                            0
                          }
                          fallback={
                            <li>
                              <span data-element-label>Models</span>
                              <span data-placeholder>&mdash;</span>
                            </li>
                          }
                        >
                          <For
                            each={Object.values(session.computedData.models)}
                          >
                            {(item) => (
                              <li data-slot="item">
                                <div data-slot="icon" title={item[0]}>
                                  <ProviderIcon model={item[1]} />
                                </div>
                                <span data-slot="model">{item[1]}</span>
                              </li>
                            )}
                          </For>
                        </Show>
                      </ul>
                      <div data-section="time">
                        <Show
                          when={session.computedData.created}
                          fallback={
                            <span data-element-label data-placeholder>
                              Started at &mdash;
                            </span>
                          }
                        >
                          <span
                            title={new Date(
                              session.computedData.created,
                            ).toLocaleString()}
                          >
                            Started{" "}
                            {new Date(
                              session.computedData.created,
                            ).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            }) +
                              ", " +
                              new Date(
                                session.computedData.created,
                              ).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                          </span>
                        </Show>
                        <Show when={session.exportedAt}>
                          <span
                            title={new Date(
                              session.exportedAt!,
                            ).toLocaleString()}
                            style="font-size: 0.9em; color: #666;"
                          >
                            Exported{" "}
                            {new Date(session.exportedAt!).toLocaleDateString(
                              "en-US",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            ) +
                              ", " +
                              new Date(session.exportedAt!).toLocaleTimeString(
                                "en-US",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.helpText}>
        <div class="help-section">
          <h3>How to use:</h3>
          <div innerHTML={props.helpText} />
        </div>
      </Show>
    </div>
  )
}
