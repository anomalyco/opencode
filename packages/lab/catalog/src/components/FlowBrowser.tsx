import type { Catalog, Flow } from "../catalog"
import { frameFor } from "../catalog"
import { TerminalFrame } from "./TerminalFrame"
import { CaptureContextMenu } from "./CaptureContextMenu"
import { feedbackIssueUrl } from "../feedback"
import { CaptureActionsMenu } from "./CaptureActionsMenu"

interface FlowBrowserProps {
  readonly catalog: Catalog
  readonly flows: ReadonlyArray<Flow>
  readonly activeFlow: Flow | undefined
  readonly variantId: string
  readonly onFlow: (id: string) => void
  readonly onOpen: (screenId: string) => void
  readonly deepLinkFor: (screenId: string, flowId: string) => string
}

export function FlowBrowser({ catalog, flows, activeFlow, variantId, onFlow, onOpen, deepLinkFor }: FlowBrowserProps) {
  const groupedFlows = new Map<string, Array<Flow>>()
  for (const flow of flows) {
    const grouped = groupedFlows.get(flow.group)
    if (grouped) grouped.push(flow)
    else groupedFlows.set(flow.group, [flow])
  }
  const navigation = (
    <nav className="flow-navigation" aria-label="Flow catalog">
      {Array.from(groupedFlows, ([group, groupFlows]) => (
        <section key={group}>
          <h2>{group}</h2>
          {groupFlows.map((flow) => (
            <button
              type="button"
              key={flow.id}
              className={flow.id === activeFlow?.id ? "active" : ""}
              aria-current={flow.id === activeFlow?.id ? "true" : undefined}
              onClick={() => onFlow(flow.id)}
            >
              <span>{flow.title}</span>
              <small>{flow.steps.length}</small>
            </button>
          ))}
        </section>
      ))}
    </nav>
  )

  if (!activeFlow) {
    return <p className="empty-state">No flows match.</p>
  }

  return (
    <section className="flow-browser">
      <aside className="flow-sidebar">
        <div className="flow-sidebar-heading">
          <span>Flow catalog</span>
          <small>{flows.length}</small>
        </div>
        {navigation}
      </aside>
      <details className="flow-mobile-nav">
        <summary>
          <span>{activeFlow.title}</span>
          <small>Browse flows ↓</small>
        </summary>
        {navigation}
      </details>
      <article className="flow-content">
        <header className="flow-heading">
          <div>
            <p>{activeFlow.group}</p>
            <h1>{activeFlow.title}</h1>
          </div>
          <span>
            {activeFlow.steps.length} {activeFlow.steps.length === 1 ? "step" : "steps"}
          </span>
          <p>{activeFlow.description}</p>
          {!activeFlow.replayable ? (
            <small className="flow-browse-only">Browse only · IDs identify captures, not recipes</small>
          ) : undefined}
        </header>
        <ol className="flow-rail" role="list">
          {activeFlow.steps.map((step, index) => {
            const screen = catalog.screens.find((candidate) => candidate.id === step.screenId)
            if (!screen) return undefined
            const frame = frameFor(screen, variantId)
            if (!frame) {
              return (
                <li key={`${activeFlow.id}:${index}:${step.screenId}`} className="flow-step flow-step-unavailable">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step.title}</strong>
                  <small>Not captured in this set</small>
                </li>
              )
            }
            const identifier = activeFlow.replayable ? `${activeFlow.id}/${screen.id}` : screen.id
            const deepLink = deepLinkFor(screen.id, activeFlow.id)
            return (
              <li key={`${activeFlow.id}:${index}:${step.screenId}`} className="flow-step">
                <button
                  type="button"
                  className="flow-open"
                  aria-label={`Open ${step.title}`}
                  onClick={() => onOpen(screen.id)}
                >
                  <CaptureContextMenu
                    identifier={identifier}
                    deepLink={deepLink}
                    issueLink={feedbackIssueUrl({ title: screen.title, identifier, deepLink, variant: variantId })}
                  >
                    <span className="flow-frame">
                      <TerminalFrame frame={frame} label={screen.title} lazy />
                    </span>
                  </CaptureContextMenu>
                </button>
                <footer className="flow-step-meta">
                  <span className="flow-step-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="flow-step-text">
                    <span className="flow-step-title">
                      <strong>{step.title}</strong>
                      <CaptureActionsMenu
                        identifier={identifier}
                        deepLink={deepLink}
                        issueLink={feedbackIssueUrl({ title: screen.title, identifier, deepLink, variant: variantId })}
                      />
                    </span>
                    {step.trigger ? <small>{step.trigger}</small> : undefined}
                  </span>
                </footer>
              </li>
            )
          })}
        </ol>
      </article>
    </section>
  )
}
