import { useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react"
import type { BrowseMode, Catalog, Facet, FacetSelections, Taxonomy } from "./catalog"
import { buildFacetIndex, emptyFacetSelections, facetValues, filterFlows, filterScreens, frameFor } from "./catalog"
import { CommandPalette } from "./components/CommandPalette"
import { ContactSheet } from "./components/ContactSheet"
import { FilterBar } from "./components/FilterBar"
import { FlowBrowser } from "./components/FlowBrowser"
import { Header } from "./components/Header"
import { MatrixNavigation } from "./components/MatrixNavigation"
import { Viewer } from "./components/Viewer"
import { preloadFrame } from "./components/TerminalFrame"
import { catalogBrowseUrl, catalogDeepLink, catalogRootUrl, readCatalogLocation } from "./deep-link"

interface AppProps {
  readonly catalog: Catalog
}

interface UiState {
  readonly mode: BrowseMode
  readonly query: string
  readonly screenLabels: ReadonlyArray<string>
  readonly uiElements: ReadonlyArray<string>
  readonly facets: FacetSelections
  readonly activeFlowId: string | undefined
  readonly selectedScreenId: string | undefined
  readonly viewerOpen: boolean
  readonly paletteOpen: boolean
  readonly gridFocusTick: number
}

type UiAction =
  | { readonly type: "set-mode"; readonly mode: BrowseMode }
  | { readonly type: "search"; readonly query: string }
  | { readonly type: "toggle-taxonomy"; readonly taxonomy: Taxonomy; readonly value: string }
  | { readonly type: "clear-taxonomy"; readonly taxonomy: Taxonomy }
  | { readonly type: "toggle-facet"; readonly facet: Facet; readonly value: string }
  | { readonly type: "clear-facet"; readonly facet: Facet }
  | { readonly type: "clear-facets" }
  | { readonly type: "reset-view" }
  | { readonly type: "clear-search" }
  | { readonly type: "select-flow"; readonly id: string }
  | { readonly type: "select-screen"; readonly id: string }
  | { readonly type: "navigate"; readonly id: string }
  | { readonly type: "open-viewer"; readonly id: string }
  | { readonly type: "close-viewer" }
  | { readonly type: "jump-to-screen"; readonly id: string }
  | { readonly type: "jump-to-flow"; readonly id: string }
  | { readonly type: "open-palette" }
  | { readonly type: "close-palette" }
  | { readonly type: "toggle-palette" }
  | {
      readonly type: "restore-location"
      readonly screenId?: string
      readonly flowId?: string
      readonly mode: BrowseMode
      readonly query: string
      readonly screenLabels: ReadonlyArray<string>
      readonly uiElements: ReadonlyArray<string>
      readonly facets: FacetSelections
    }

function toggle(values: ReadonlyArray<string>, value: string): ReadonlyArray<string> {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
}

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "set-mode":
      // Filters and query survive tab switches, matching Mobbin's browse behavior.
      return {
        ...state,
        mode: action.mode,
        viewerOpen: false,
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    case "search":
      return { ...state, query: action.query }
    case "toggle-taxonomy": {
      // Palette stays open so stacked filter selections read as additive.
      const key = action.taxonomy === "screen" ? "screenLabels" : "uiElements"
      return {
        ...state,
        mode: action.taxonomy === "screen" ? "screens" : "ui-elements",
        [key]: toggle(state[key], action.value),
        viewerOpen: false,
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    }
    case "clear-taxonomy": {
      const key = action.taxonomy === "screen" ? "screenLabels" : "uiElements"
      return { ...state, [key]: [], selectedScreenId: undefined, gridFocusTick: state.gridFocusTick + 1 }
    }
    case "toggle-facet":
      return {
        ...state,
        facets: { ...state.facets, [action.facet]: toggle(state.facets[action.facet], action.value) },
        viewerOpen: false,
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    case "clear-facet":
      return {
        ...state,
        facets: { ...state.facets, [action.facet]: [] },
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    case "clear-facets":
      return {
        ...state,
        facets: emptyFacetSelections,
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    case "reset-view":
      return {
        ...state,
        query: "",
        screenLabels: [],
        uiElements: [],
        facets: emptyFacetSelections,
        selectedScreenId: undefined,
        gridFocusTick: state.gridFocusTick + 1,
      }
    case "clear-search":
      return { ...state, query: "", gridFocusTick: state.gridFocusTick + 1 }
    case "select-flow":
      return { ...state, activeFlowId: action.id }
    case "select-screen":
      return { ...state, selectedScreenId: action.id, gridFocusTick: state.gridFocusTick + 1 }
    case "navigate":
      return { ...state, selectedScreenId: action.id }
    case "open-viewer":
      return { ...state, selectedScreenId: action.id, viewerOpen: true }
    case "close-viewer":
      return { ...state, viewerOpen: false, gridFocusTick: state.gridFocusTick + 1 }
    case "jump-to-screen":
      return {
        ...state,
        mode: "screens",
        query: "",
        paletteOpen: false,
        selectedScreenId: action.id,
        viewerOpen: true,
      }
    case "jump-to-flow":
      return {
        ...state,
        mode: "flows",
        query: "",
        activeFlowId: action.id,
        selectedScreenId: undefined,
        viewerOpen: false,
        paletteOpen: false,
      }
    case "open-palette":
      return { ...state, paletteOpen: true }
    case "close-palette":
      return {
        ...state,
        paletteOpen: false,
        gridFocusTick: state.viewerOpen ? state.gridFocusTick : state.gridFocusTick + 1,
      }
    case "toggle-palette":
      return state.paletteOpen ? uiReducer(state, { type: "close-palette" }) : { ...state, paletteOpen: true }
    case "restore-location":
      return {
        ...state,
        mode: action.flowId ? "flows" : action.mode,
        query: action.query,
        screenLabels: action.screenLabels,
        uiElements: action.uiElements,
        facets: action.facets,
        activeFlowId: action.flowId ?? state.activeFlowId,
        selectedScreenId: action.screenId,
        viewerOpen: action.screenId !== undefined,
      }
  }
}

export function App({ catalog }: AppProps) {
  const initialLocation = readCatalogLocation(new URL(window.location.href))
  const initialScreen = catalog.screens.some((screen) => screen.id === initialLocation.screenId)
    ? initialLocation.screenId
    : undefined
  const initialFlow = catalog.flows.some((flow) => flow.id === initialLocation.flowId)
    ? initialLocation.flowId
    : undefined
  const initialMode = initialFlow
    ? "flows"
    : initialLocation.mode === "ui-elements" || initialLocation.mode === "flows"
      ? initialLocation.mode
      : "screens"
  const [ui, dispatch] = useReducer(uiReducer, {
    mode: initialMode,
    query: initialLocation.query,
    screenLabels: initialLocation.screenLabels,
    uiElements: initialLocation.uiElements,
    facets: {
      surface: initialLocation.surfaces,
      pattern: initialLocation.patterns,
      feature: initialLocation.features,
      state: initialLocation.states,
    },
    activeFlowId: initialFlow ?? catalog.flows[0]?.id,
    selectedScreenId: initialScreen ?? catalog.screens[0]?.id,
    viewerOpen: initialScreen !== undefined,
    paletteOpen: false,
    gridFocusTick: 0,
  })
  const [variantIndex, setVariantIndex] = useState(() => {
    const index = catalog.variants.findIndex((variant) => variant.id === initialLocation.variantId)
    if (index >= 0) return index
    const opencode = catalog.variants.findIndex((variant) => variant.id === "opencode")
    if (opencode >= 0) return opencode
    const coverage = catalog.variants.map(
      (variant) => catalog.screens.filter((screen) => frameFor(screen, variant.id) !== undefined).length,
    )
    return coverage.indexOf(Math.max(...coverage))
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const activeVariant = catalog.variants[variantIndex] ?? catalog.variants[0]

  const deepLinkFor = (screenId: string, flowId?: string) =>
    catalogDeepLink(screenId, { flowId, variantId: activeVariant.id })

  const openViewer = (screenId: string, flowId?: string) => {
    window.history.pushState(null, "", deepLinkFor(screenId, flowId))
    dispatch({ type: "open-viewer", id: screenId })
  }
  const availableScreens = useMemo(
    () => catalog.screens.filter((screen) => frameFor(screen, activeVariant.id) !== undefined),
    [catalog.screens, activeVariant.id],
  )

  const facetIndex = useMemo(() => buildFacetIndex(catalog.screens), [catalog.screens])
  const screens = useMemo(
    () =>
      filterScreens(availableScreens, ui.query, ui.mode, {
        screenLabels: ui.screenLabels,
        uiElements: ui.uiElements,
        facets: ui.facets,
      }),
    [availableScreens, ui.query, ui.mode, ui.screenLabels, ui.uiElements, ui.facets],
  )
  const flows = useMemo(() => filterFlows(catalog.flows, ui.query), [catalog.flows, ui.query])
  const activeFlow = flows.find((flow) => flow.id === ui.activeFlowId) ?? flows[0]
  const viewerScreens = useMemo(
    () =>
      ui.mode === "flows" && activeFlow
        ? activeFlow.steps.flatMap((step) => {
            const screen = availableScreens.find((candidate) => candidate.id === step.screenId)
            return screen ? [screen] : []
          })
        : screens,
    [activeFlow, availableScreens, screens, ui.mode],
  )
  const selectedId = viewerScreens.some((screen) => screen.id === ui.selectedScreenId)
    ? ui.selectedScreenId
    : viewerScreens[0]?.id
  const selectedScreen = availableScreens.find((screen) => screen.id === selectedId)
  const taxonomy = ui.mode === "screens" ? catalog.screenTaxonomy : catalog.uiElementTaxonomy
  const taxonomyValues = ui.mode === "screens" ? ui.screenLabels : ui.uiElements
  const taxonomyCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const screen of availableScreens) {
      const values = ui.mode === "screens" ? screen.screenLabels : screen.uiElements
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return counts
  }, [availableScreens, ui.mode])
  const facetCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const screen of availableScreens) {
      for (const facet of ["surface", "pattern", "feature", "state"] as ReadonlyArray<Facet>) {
        for (const value of facetValues(screen, facet)) {
          counts.set(`${facet}:${value}`, (counts.get(`${facet}:${value}`) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [availableScreens])

  const navigateViewer = (direction: 1 | -1) => {
    if (viewerScreens.length === 0) return
    const current = viewerScreens.findIndex((screen) => screen.id === selectedId)
    const next = viewerScreens[(current + direction + viewerScreens.length) % viewerScreens.length]
    if (next) {
      window.history.replaceState(null, "", deepLinkFor(next.id, ui.mode === "flows" ? activeFlow?.id : undefined))
      dispatch({ type: "navigate", id: next.id })
    }
  }

  const navigateVariant = (direction: 1 | -1) => {
    setVariantIndex((current) => (current + direction + catalog.variants.length) % catalog.variants.length)
  }

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      dispatch({ type: "toggle-palette" })
      return
    }
    if (ui.paletteOpen || ui.viewerOpen) return
    const target = event.target
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    if (editing) return
    if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault()
      navigateVariant(event.key === "ArrowUp" ? -1 : 1)
      return
    }
    if (event.key === "/") {
      event.preventDefault()
      searchRef.current?.focus()
      return
    }
    const hasFilters = taxonomyValues.length > 0 || Object.values(ui.facets).some((values) => values.length > 0)
    if (event.key === "Escape" && (ui.query !== "" || hasFilters)) {
      event.preventDefault()
      dispatch({ type: "reset-view" })
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleWindowKeyDown(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  useEffect(() => {
    if (ui.viewerOpen) return
    window.history.replaceState(
      null,
      "",
      catalogBrowseUrl({
        variantId: activeVariant.id,
        mode: ui.mode,
        query: ui.query,
        screenLabels: ui.screenLabels,
        uiElements: ui.uiElements,
        surfaces: ui.facets.surface,
        patterns: ui.facets.pattern,
        features: ui.facets.feature,
        states: ui.facets.state,
      }),
    )
  }, [activeVariant.id, ui.facets, ui.mode, ui.query, ui.screenLabels, ui.uiElements, ui.viewerOpen])

  useEffect(() => {
    if (!ui.viewerOpen || !selectedScreen) return
    const url = new URL(
      catalogDeepLink(selectedScreen.id, {
        flowId: ui.mode === "flows" ? activeFlow?.id : undefined,
        variantId: activeVariant.id,
      }),
    )
    if (window.location.hash.startsWith("#annotations=")) url.hash = window.location.hash
    window.history.replaceState(
      null,
      "",
      url,
    )
  }, [activeVariant.id, activeFlow?.id, selectedScreen, ui.mode, ui.viewerOpen])

  useEffect(() => {
    if (!ui.viewerOpen || selectedId === undefined || viewerScreens.length < 2) return
    const current = viewerScreens.findIndex((screen) => screen.id === selectedId)
    for (const offset of [-1, 1]) {
      const screen = viewerScreens[(current + offset + viewerScreens.length) % viewerScreens.length]
      const frame = screen && frameFor(screen, activeVariant.id)
      if (frame) void preloadFrame(frame)
    }
  }, [activeVariant.id, selectedId, ui.viewerOpen, viewerScreens])

  useEffect(() => {
    const restore = () => {
      const location = readCatalogLocation(new URL(window.location.href))
      const screenId = catalog.screens.some((screen) => screen.id === location.screenId) ? location.screenId : undefined
      const flowId = catalog.flows.some((flow) => flow.id === location.flowId) ? location.flowId : undefined
      const nextVariant = catalog.variants.findIndex((variant) => variant.id === location.variantId)
      if (nextVariant >= 0) setVariantIndex(nextVariant)
      const mode = flowId
        ? "flows"
        : location.mode === "ui-elements" || location.mode === "flows"
          ? location.mode
          : "screens"
      dispatch({
        type: "restore-location",
        screenId,
        flowId,
        mode,
        query: location.query,
        screenLabels: location.screenLabels,
        uiElements: location.uiElements,
        facets: {
          surface: location.surfaces,
          pattern: location.patterns,
          feature: location.features,
          state: location.states,
        },
      })
    }
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [catalog])

  const taxonomyType: Taxonomy = ui.mode === "ui-elements" ? "ui-element" : "screen"

  return (
    <>
      <main className="catalog-app">
        <Header
          catalog={catalog}
          mode={ui.mode}
          query={ui.query}
          resultCount={ui.mode === "flows" ? flows.length : screens.length}
          searchRef={searchRef}
          variant={activeVariant}
          onMode={(mode) => dispatch({ type: "set-mode", mode })}
          onQuery={(query) => dispatch({ type: "search", query })}
          onClearSearch={() => dispatch({ type: "clear-search" })}
          onOpenPalette={() => dispatch({ type: "open-palette" })}
          onVariantSelect={(id) =>
            setVariantIndex(
              Math.max(
                0,
                catalog.variants.findIndex((variant) => variant.id === id),
              ),
            )
          }
        />
        {ui.mode !== "flows" ? (
          <>
            <FilterBar
              taxonomyName={ui.mode === "screens" ? "Screen patterns" : "UI elements"}
              taxonomy={taxonomy}
              taxonomyValues={taxonomyValues}
              taxonomyCounts={taxonomyCounts}
              facetOptions={{
                surface: catalog.surfaces,
                pattern: catalog.patterns,
                feature: catalog.features,
                state: catalog.states,
              }}
              facets={ui.facets}
              facetCounts={facetCounts}
              query={ui.query}
              resultCount={screens.length}
              onTaxonomy={(value) => dispatch({ type: "toggle-taxonomy", taxonomy: taxonomyType, value })}
              onClearTaxonomy={() => dispatch({ type: "clear-taxonomy", taxonomy: taxonomyType })}
              onFacet={(facet, value) => dispatch({ type: "toggle-facet", facet, value })}
              onClearFacet={(facet) => dispatch({ type: "clear-facet", facet })}
              onClearQuery={() => dispatch({ type: "clear-search" })}
              onClearAll={() => dispatch({ type: "reset-view" })}
            />
            <MatrixNavigation screens={screens} />
          </>
        ) : undefined}
        {ui.mode === "flows" ? (
          <FlowBrowser
            catalog={catalog}
            flows={flows}
            activeFlow={activeFlow}
            variantId={activeVariant.id}
            onFlow={(id) => dispatch({ type: "select-flow", id })}
            onOpen={(id) => openViewer(id, activeFlow?.id)}
            deepLinkFor={deepLinkFor}
          />
        ) : (
          <ContactSheet
            screens={screens}
            selectedId={selectedId}
            focusTick={ui.gridFocusTick}
            keyboardEnabled={!ui.viewerOpen && !ui.paletteOpen}
            variantId={activeVariant.id}
            onSelect={(id) => dispatch({ type: "select-screen", id })}
            onOpen={(id) => openViewer(id)}
            onClearFilters={() => dispatch({ type: "reset-view" })}
            deepLinkFor={deepLinkFor}
          />
        )}
      </main>
      {ui.viewerOpen && selectedScreen ? (
        <Viewer
          key={`${selectedScreen.id}:${activeVariant.id}`}
          screen={selectedScreen}
          identifier={
            ui.mode === "flows" && activeFlow?.replayable ? `${activeFlow.id}/${selectedScreen.id}` : selectedScreen.id
          }
          deepLink={deepLinkFor(selectedScreen.id, ui.mode === "flows" ? activeFlow?.id : undefined)}
          variant={activeVariant}
          variants={catalog.variants}
          screenTaxonomy={catalog.screenTaxonomy}
          uiElementTaxonomy={catalog.uiElementTaxonomy}
          position={viewerScreens.findIndex((screen) => screen.id === selectedScreen.id) + 1}
          total={viewerScreens.length}
          active={!ui.paletteOpen}
          onClose={() => {
            window.history.pushState(null, "", catalogRootUrl())
            dispatch({ type: "close-viewer" })
          }}
          onNavigate={navigateViewer}
          onVariant={navigateVariant}
          onVariantSelect={(id) =>
            setVariantIndex(
              Math.max(
                0,
                catalog.variants.findIndex((variant) => variant.id === id),
              ),
            )
          }
          onFacet={(filter) => dispatch({ type: "toggle-facet", ...filter })}
          onTaxonomy={(taxonomy, value) => dispatch({ type: "toggle-taxonomy", taxonomy, value })}
        />
      ) : undefined}
      {ui.paletteOpen ? (
        <CommandPalette
          catalog={catalog}
          facetIndex={facetIndex}
          selections={{ screenLabels: ui.screenLabels, uiElements: ui.uiElements, facets: ui.facets }}
          onClose={() => dispatch({ type: "close-palette" })}
          onFacet={(filter) => dispatch({ type: "toggle-facet", ...filter })}
          onTaxonomy={(taxonomy, value) => dispatch({ type: "toggle-taxonomy", taxonomy, value })}
          onScreen={(id) => dispatch({ type: "jump-to-screen", id })}
          onFlow={(id) => dispatch({ type: "jump-to-flow", id })}
        />
      ) : undefined}
    </>
  )
}
