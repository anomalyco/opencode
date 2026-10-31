import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { useLayout } from "@/shell/state/layout"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { addProjects } from "@/home/projects/add"
import {
  DESIGN_COLORS,
  DESIGN_SHAPES,
  addObject,
  createScene,
  duplicateObject,
  interpretPrompt,
  parseDesignScene,
  removeObject,
  updateMaterial,
  updateObject,
  type DesignNoticeKey,
  type DesignObject,
  type DesignScene,
  type DesignShape,
  type Vec3,
} from "./scene/model"
import {
  downloadExport,
  exportSceneGLB,
  exportSceneOBJ,
  sceneFileName,
  type ExportFormat,
} from "./scene/export"
import { DesignViewport, type TransformMode } from "./scene/viewport"
import { UiDesigner } from "./ui/designer"
import type { DesignProjectTarget } from "./project"
import { extractJson, generateDesignText, scenePrompt } from "./ai"
import { Spinner } from "@opencode/ui/spinner"
import "./studio.css"

const STORAGE_KEY = "opencode.design.scene.v1"

type Notice = { key: DesignNoticeKey; params?: Record<string, string | number>; ok: boolean }

type SaveStatus = { key: "design.save.saved" | "design.save.failed"; params: Record<string, string>; ok: boolean }

export default function DesignStudio() {
  const language = useLanguage()
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const navigate = useNavigate()
  const pickDirectory = useDirectoryPicker()

  const [scene, setScene] = createStore<DesignScene>(loadScene())
  const [selectedID, setSelectedID] = createSignal<string>()
  const [mode, setMode] = createSignal<TransformMode>("translate")
  const [prompt, setPrompt] = createSignal("")
  const [promptMode, setPromptMode] = createSignal<"local" | "ai">("ai")
  const [generating, setGenerating] = createSignal(false)
  const [aiError, setAiError] = createSignal<string>()
  const [notice, setNotice] = createSignal<Notice>()
  const [undoStack, setUndoStack] = createSignal<DesignScene[]>([])
  const [redoStack, setRedoStack] = createSignal<DesignScene[]>([])

  const [workspace, setWorkspace] = createSignal<"3d" | "ui">(
    localStorage.getItem("opencode.design.workspace") === "ui" ? "ui" : "3d",
  )

  const [saving, setSaving] = createSignal<"json" | ExportFormat>()
  const [saveStatus, setSaveStatus] = createSignal<SaveStatus>()
  const [saveFolder, setSaveFolder] = createSignal("design")

  const selected = createMemo(() => scene.objects.find((object) => object.id === selectedID()))

  const snapshot = () => structuredClone(unwrap(scene))

  const pushHistory = () => {
    setUndoStack((stack) => [...stack.slice(-39), snapshot()])
    setRedoStack([])
  }

  const applyScene = (next: DesignScene, selection: string | undefined) => {
    setScene(reconcile(next))
    setSelectedID(next.objects.some((object) => object.id === selection) ? selection : undefined)
  }

  const commit = (next: DesignScene, selection: string | undefined) => {
    pushHistory()
    applyScene(next, selection)
  }

  const undo = () => {
    const stack = undoStack()
    const previous = stack.at(-1)

    if (!previous) return
    setUndoStack(stack.slice(0, -1))
    setRedoStack((redo) => [...redo, snapshot()])
    applyScene(previous, selectedID())
  }

  const redo = () => {
    const stack = redoStack()
    const next = stack.at(-1)

    if (!next) return
    setRedoStack(stack.slice(0, -1))
    setUndoStack((undo) => [...undo, snapshot()])
    applyScene(next, selectedID())
  }

  const newScene = () => {
    commit(createScene(), undefined)
    setNotice({ key: "design.notice.cleared", ok: true })
    setPrompt("")
  }

  const addPrimitive = (shape: DesignShape) => {
    const next = unwrap(scene)
    const result = addObject(next, shape)
    const count = next.objects.length
    const column = (count % 3) - 1
    const row = Math.floor(count / 3) % 3

    result.object.position = [column * 1.7, result.object.position[1], (row - 1) * 1.7]
    commit(result.scene, result.object.id)
    setNotice({ key: "design.notice.added", params: { name: result.object.name }, ok: true })
  }

  const runPrompt = async () => {
    const value = prompt().trim()

    if (!value || generating()) return

    if (promptMode() === "local") {
      const outcome = interpretPrompt(unwrap(scene), value, selectedID())

      if (outcome.ok) {
        commit(outcome.scene, outcome.selection)
        setPrompt("")
      }

      setNotice({ ...outcome.notice, ok: outcome.ok })
      setAiError(undefined)

      return
    }

    const server = target()?.server ?? servers.visible[0]

    if (!server) {
      setAiError(language.t("design.ai.noServer"))
      setNotice({ key: "design.notice.aiFailed", ok: false })

      return
    }

    setGenerating(true)
    setAiError(undefined)
    setNotice(undefined)

    try {
      const ctx = global.ensureServerCtx(server)
      const request = scenePrompt(unwrap(scene), value)
      const text = await generateDesignText(ctx, request)
      const next =
        parseDesignScene(extractJson(text)) ??
        parseDesignScene(
          extractJson(
            await generateDesignText(
              ctx,
              `${request}\n\nYour previous response could not be parsed. Return only the complete JSON object.`,
            ),
          ),
        )

      if (!next) throw new Error(language.t("design.ai.invalid"))
      commit(next, next.objects[0]?.id)
      setNotice({ key: "design.notice.aiUpdated", ok: true })
      setPrompt("")
    } catch (cause) {
      setAiError(errorMessage(cause, language.t("design.ai.failed")))
      setNotice({ key: "design.notice.aiFailed", ok: false })
    } finally {
      setGenerating(false)
    }
  }

  const updateSelected = (update: Partial<Omit<DesignObject, "id">>, record = true) => {
    const id = selectedID()

    if (!id) return
    const next = updateObject(unwrap(scene), id, update)

    if (record) commit(next, id)
    else applyScene(next, id)
  }

  const updateSelectedMaterial = (update: Partial<DesignObject["material"]>, record = true) => {
    const id = selectedID()

    if (!id) return
    const next = updateMaterial(unwrap(scene), id, update)

    if (record) commit(next, id)
    else applyScene(next, id)
  }

  const deleteSelected = () => {
    const current = selected()

    if (!current) return
    commit(removeObject(unwrap(scene), current.id), undefined)
    setNotice({ key: "design.notice.deleted", params: { name: current.name }, ok: true })
  }

  const duplicateSelected = () => {
    const current = selected()

    if (!current) return
    const result = duplicateObject(unwrap(scene), current.id)
    commit(result.scene, result.object?.id)
    setNotice({ key: "design.notice.duplicated", params: { name: current.name }, ok: true })
  }

  const toggleVisibility = (object: DesignObject) => {
    commit(updateObject(unwrap(scene), object.id, { visible: !object.visible }), selectedID())
  }

  const renameScene = (name: string) => {
    commit({ ...unwrap(scene), name: name.trim() || "Untitled scene" }, selectedID())
  }

  const onTransformStart = () => pushHistory()

  const onTransform = (id: string, update: { position: Vec3; rotation: Vec3; scale: Vec3 }) => {
    applyScene(updateObject(unwrap(scene), id, update), id)
  }

  const targets = createMemo<DesignProjectTarget[]>(() =>
    servers.visible.flatMap((server) => {
      const key = ServerConnection.key(server)

      if (global.servers.health[key]?.healthy === false) return []

      return global
        .ensureServerCtx(server)
        .projects.used()
        .map((project) => ({
          key: `${key}\n${project.worktree}`,
          server,
          directory: project.worktree,
          label: displayName(project),
          serverLabel: servers.tag(server),
        }))
    }),
  )

  const target = createMemo(() => {
    const selection = layout.home.selection()

    const current = selection.directory
      ? targets().find(
          (item) => ServerConnection.key(item.server) === selection.server && item.directory === selection.directory,
        )
      : undefined

    return current ?? targets()[0]
  })

  const selectTarget = (item: DesignProjectTarget | null | undefined) => {
    if (!item) return
    layout.home.setSelection({ server: ServerConnection.key(item.server), directory: item.directory })
  }

  const addProject = () => {
    const server = target()?.server ?? servers.visible[0]

    if (!server) return
    pickDirectory({
      server,
      title: language.t("design.project.add"),
      multiple: true,
      onSelect: (result) => {
        if (!result) return
        const directories = Array.isArray(result) ? result : [result]

        void addProjects(global.ensureServerCtx(server), directories).then((project) => {
          if (!project) return
          layout.home.setSelection({ server: ServerConnection.key(server), directory: project.worktree })
        })
      },
    })
  }

  const writeProjectFile = async (filename: string, payload: Uint8Array, folderValue: string) => {
    const destination = target()

    if (!destination) throw new Error(language.t("design.project.none"))
    const folder = folderValue
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/g, "")
    const path = folder ? `${folder}/${filename}` : filename

    await global.ensureServerCtx(destination.server).sdk.api.experimental.file.write({
      location: { directory: destination.directory },
      path,
      payload,
    })

    return path
  }

  const generateWithModel = (promptValue: string) => {
    const server = target()?.server ?? servers.visible[0]

    if (!server) return Promise.reject(new Error(language.t("design.ai.noServer")))

    return generateDesignText(global.ensureServerCtx(server), promptValue)
  }

  const saveFile = async (format: "json" | ExportFormat) => {
    const destination = target()

    if (!destination) return
    setSaving(format)
    setSaveStatus(undefined)

    try {
      const current = unwrap(scene)
      const filename = sceneFileName(current, format)

      const payload =
        format === "json"
          ? new TextEncoder().encode(JSON.stringify(current, null, 2))
          : format === "glb"
            ? new Uint8Array(await exportSceneGLB(current))
            : new TextEncoder().encode(exportSceneOBJ(current))

      const path = await writeProjectFile(filename, payload, saveFolder())

      setSaveStatus({ key: "design.save.saved", params: { path }, ok: true })
    } catch (cause) {
      const reason = errorMessage(cause, language.t("design.save.failed", { path: sceneFileName(unwrap(scene), format) }))
      setSaveStatus({ key: "design.save.failed", params: { path: reason }, ok: false })
    } finally {
      setSaving(undefined)
    }
  }

  const exportFile = async (format: ExportFormat) => {
    const current = unwrap(scene)
    setSaving(format)

    try {
      const filename = sceneFileName(current, format)
      const data = format === "glb" ? await exportSceneGLB(current) : exportSceneOBJ(current)

      downloadExport(
        data,
        filename,
        format === "glb" ? "model/gltf-binary" : "text/plain",
      )
      showToast({ variant: "success", title: language.t("design.export.done", { name: filename }), icon: "download" })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("design.export.failed"),
        description: errorMessage(cause, language.t("design.export.failed")),
        icon: "circle-xmark",
      })
    } finally {
      setSaving(undefined)
    }
  }

  createEffect(() => {
    const value = JSON.stringify(scene)
    const timer = setTimeout(() => localStorage.setItem(STORAGE_KEY, value), 250)

    onCleanup(() => clearTimeout(timer))
  })

  createEffect(() => localStorage.setItem("opencode.design.workspace", workspace()))

  return (
    <SessionRouteFrame padded>
      <SessionPanelFrame raised>
        <div data-slot="design-studio" class="flex min-h-0 min-w-0 flex-1 flex-col">
          <header data-slot="design-studio-header">
            <div class="flex min-w-0 items-center gap-2">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-v2-background-bg-layer-02 text-v2-icon-icon-base">
                <Icon name={workspace() === "3d" ? "cube" : "outline-photo"} />
              </span>
              <span class="truncate text-[13px] font-medium text-v2-text-text-base">{language.t("design.title")}</span>
            </div>
            <div class="ms-2 shrink-0">
              <SegmentedControl value={workspace()} onChange={(value) => value && setWorkspace(value as "3d" | "ui")}>
                <SegmentedControlItem value="3d">{language.t("design.mode.3d")}</SegmentedControlItem>
                <SegmentedControlItem value="ui">{language.t("design.mode.ui")}</SegmentedControlItem>
              </SegmentedControl>
            </div>
            <Show when={workspace() === "3d"}>
              <div class="ms-1 flex min-w-0 items-center gap-0.5">
                <Tooltip placement="bottom" value={language.t("design.action.undo")}>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    disabled={undoStack().length === 0}
                    onClick={undo}
                    aria-label={language.t("design.action.undo")}
                    icon={<Icon name="outline-undo" />}
                  />
                </Tooltip>
                <Tooltip placement="bottom" value={language.t("design.action.redo")}>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    disabled={redoStack().length === 0}
                    onClick={redo}
                    aria-label={language.t("design.action.redo")}
                    icon={<Icon name="outline-undo" class="[transform:scaleX(-1)]" />}
                  />
                </Tooltip>
              </div>
            </Show>
            <div class="flex-1" />
            <Show when={workspace() === "3d"}>
              <div class="flex shrink-0 items-center gap-1">
                <Button type="button" size="small" variant="ghost-muted" onClick={newScene}>
                  {language.t("design.action.new")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="neutral"
                  icon="download"
                  disabled={saving() === "glb" || scene.objects.length === 0}
                  onClick={() => void exportFile("glb")}
                >
                  {language.t("design.action.exportGlb")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="neutral"
                  icon="download"
                  disabled={saving() === "obj" || scene.objects.length === 0}
                  onClick={() => void exportFile("obj")}
                >
                  {language.t("design.action.exportObj")}
                </Button>
              </div>
            </Show>
          </header>

          <Show
            when={workspace() === "3d"}
            fallback={
              <UiDesigner
                project={{
                  target,
                  targets,
                  select: selectTarget,
                  add: addProject,
                  openHome: () => navigate("/"),
                  folder: saveFolder,
                  setFolder: setSaveFolder,
                  write: writeProjectFile,
                  generate: generateWithModel,
                }}
              />
            }
          >
          <div class="flex min-h-0 min-w-0 flex-1">
            <aside data-slot="design-studio-objects">
              <div class="flex h-9 shrink-0 items-center justify-between px-3">
                <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.scene")}</span>
                <span class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 text-[11px] tabular-nums text-v2-text-text-faint">
                  {scene.objects.length}
                </span>
              </div>

              <div class="grid grid-cols-2 gap-1 px-2 pb-2">
                <For each={DESIGN_SHAPES}>
                  {(shape) => (
                    <Button
                      type="button"
                      size="small"
                      variant="neutral"
                      class="justify-start"
                      onClick={() => addPrimitive(shape)}
                    >
                      {language.t(shapeKey(shape))}
                    </Button>
                  )}
                </For>
              </div>

              <div data-slot="design-object-list" data-scrollable class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <Show when={scene.objects.length > 0} fallback={<div class="px-2 py-6 text-center text-[12px] leading-4 text-v2-text-text-faint">{language.t("design.objects.empty")}</div>}>
                  <For each={scene.objects}>
                    {(object) => (
                      <div
                        role="button"
                        tabindex={0}
                        data-slot="design-object-row"
                        data-selected={selectedID() === object.id ? "" : undefined}
                        class="group flex h-8 w-full min-w-0 items-center gap-2 rounded-[6px] px-2 text-start outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                        onClick={() => setSelectedID(object.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          setSelectedID(object.id)
                        }}
                      >
                        <span
                          class="size-3 shrink-0 rounded-[3px] border border-v2-border-border-strong"
                          style={{ "background-color": object.material.color }}
                          aria-hidden="true"
                        />
                        <span
                          class="min-w-0 flex-1 truncate text-[13px] leading-4"
                          classList={{ "text-v2-text-text-faint line-through": !object.visible }}
                        >
                          {object.name}
                        </span>
                        <span class="shrink-0 text-[11px] text-v2-text-text-faint group-hover:hidden">
                          {language.t(shapeKey(object.shape))}
                        </span>
                        <span class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                          <IconButton
                            type="button"
                            size="small"
                            variant="ghost-muted"
                            aria-label={language.t(object.visible ? "design.action.hide" : "design.action.show")}
                            icon={<Icon name={object.visible ? "outline-eye" : "outline-eye-slash"} size="small" />}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleVisibility(object)
                            }}
                          />
                          <IconButton
                            type="button"
                            size="small"
                            variant="ghost-muted"
                            aria-label={language.t("design.action.delete")}
                            icon={<Icon name="outline-trash" size="small" />}
                            onClick={(event) => {
                              event.stopPropagation()
                              commit(removeObject(unwrap(scene), object.id), undefined)
                            }}
                          />
                        </span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              <div data-slot="design-prompt">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.prompt.title")}</span>
                  <Tooltip placement="top" value={language.t("design.prompt.aiHint")}>
                    <Switch
                      appearance="compact"
                      checked={promptMode() === "ai"}
                      onChange={(ai) => setPromptMode(ai ? "ai" : "local")}
                    >
                      {language.t("design.prompt.ai")}
                    </Switch>
                  </Tooltip>
                </div>
                <Textarea
                  rows={3}
                  value={prompt()}
                  placeholder={language.t("design.prompt.placeholder")}
                  onInput={(event) => setPrompt(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    void runPrompt()
                  }}
                />
                <div class="mt-1.5 flex items-center gap-1">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    onClick={() => setPrompt(language.t("design.prompt.example"))}
                  >
                    {language.t("design.prompt.exampleShort")}
                  </Button>
                  <div class="flex-1" />
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={!prompt().trim() || generating()}
                    onClick={() => void runPrompt()}
                  >
                    <Show when={generating()} fallback={language.t("design.prompt.run")}>
                      <Spinner class="size-3" />
                      {language.t("design.prompt.generating")}
                    </Show>
                  </Button>
                </div>
                <Show when={notice()}>
                  {(value) => (
                    <div
                      class="mt-1.5 min-h-4 text-[11px] leading-4"
                      classList={{
                        "text-v2-state-fg-danger": !value().ok,
                        "text-v2-text-text-muted": value().ok,
                      }}
                    >
                      {language.t(value().key, value().params)}
                    </div>
                  )}
                </Show>
                <Show when={aiError()}>
                  {(message) => (
                    <div class="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-[5px] bg-v2-state-bg-danger px-2 py-1 text-[11px] leading-4 text-v2-state-fg-danger">
                      {message()}
                    </div>
                  )}
                </Show>
              </div>
            </aside>

            <main data-slot="design-stage" class="relative min-h-0 min-w-0 flex-1">
              <DesignViewport
                scene={() => scene}
                selectedID={selectedID}
                mode={mode}
                onSelect={setSelectedID}
                onTransformStart={onTransformStart}
                onTransform={onTransform}
              />
              <div data-slot="design-transform-bar" class="absolute start-3 top-3 z-10">
                <SegmentedControl
                  value={mode()}
                  onChange={(value) => value && setMode(value as TransformMode)}
                  class="shadow-[var(--v2-elevation-floating)]"
                >
                  <SegmentedControlItem value="translate">{language.t("design.transform.move")}</SegmentedControlItem>
                  <SegmentedControlItem value="rotate">{language.t("design.transform.rotate")}</SegmentedControlItem>
                  <SegmentedControlItem value="scale">{language.t("design.transform.scaleMode")}</SegmentedControlItem>
                </SegmentedControl>
              </div>
              <div class="pointer-events-none absolute inset-x-3 bottom-2 z-10 flex items-end justify-between gap-3">
                <span class="rounded-[5px] bg-v2-background-bg-base/85 px-2 py-1 text-[11px] leading-4 text-v2-text-text-muted shadow-[var(--v2-elevation-raised)] backdrop-blur">
                  {selected()?.name ?? language.t("design.viewport.none")}
                </span>
                <span class="hidden rounded-[5px] bg-v2-background-bg-base/85 px-2 py-1 text-[11px] leading-4 text-v2-text-text-faint shadow-[var(--v2-elevation-raised)] backdrop-blur md:block">
                  {language.t("design.viewport.hint")}
                </span>
              </div>
            </main>

            <aside data-slot="design-studio-inspector">
              <div class="flex h-9 shrink-0 items-center justify-between px-3">
                <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.inspector")}</span>
                <Show when={selected()}>
                  <div class="flex items-center gap-0.5">
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      aria-label={language.t("design.action.duplicate")}
                      icon={<Icon name="outline-copy" size="small" />}
                      onClick={duplicateSelected}
                    />
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      aria-label={language.t("design.action.delete")}
                      icon={<Icon name="outline-trash" size="small" />}
                      onClick={deleteSelected}
                    />
                  </div>
                </Show>
              </div>

              <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <FieldLabel>{language.t("design.scene.name")}</FieldLabel>
                <TextInput
                  class="mt-1"
                  appearance="small"
                  value={scene.name}
                  onChange={(event) => renameScene(event.currentTarget.value)}
                  aria-label={language.t("design.scene.name")}
                />

                <Show
                  when={selected()}
                  fallback={
                    <div class="mt-6 rounded-[6px] border border-dashed border-v2-border-border-muted px-3 py-4 text-center text-[12px] leading-4 text-v2-text-text-faint">
                      {language.t("design.inspector.empty")}
                    </div>
                  }
                >
                  {(object) => (
                    <>
                      <div class="mt-4 border-t border-v2-border-border-muted pt-3">
                        <FieldLabel>{language.t("design.object.name")}</FieldLabel>
                        <TextInput
                          class="mt-1"
                          appearance="small"
                          value={object().name}
                          onChange={(event) =>
                            updateSelected({ name: event.currentTarget.value.trim() || object().name })
                          }
                          aria-label={language.t("design.object.name")}
                        />
                        <FieldLabel class="mt-3">{language.t("design.object.type")}</FieldLabel>
                        <div class="mt-1 flex h-7 items-center text-[12px] text-v2-text-text-muted">
                          {language.t(shapeKey(object().shape))}
                        </div>
                      </div>

                      <div class="mt-4 border-t border-v2-border-border-muted pt-3">
                        <FieldLabel>{language.t("design.transform.position")}</FieldLabel>
                        <VectorField
                          values={object().position}
                          step={0.1}
                          onChange={(position) => updateSelected({ position })}
                        />

                        <FieldLabel class="mt-3">{language.t("design.transform.rotation")}</FieldLabel>
                        <VectorField
                          values={object().rotation.map(radiansToDegrees) as Vec3}
                          step={1}
                          suffix="°"
                          onChange={(rotation) => updateSelected({ rotation: rotation.map(degreesToRadians) as Vec3 })}
                        />

                        <FieldLabel class="mt-3">{language.t("design.transform.scale")}</FieldLabel>
                        <VectorField
                          values={object().scale}
                          step={0.1}
                          onChange={(scale) => updateSelected({ scale: scale.map((value) => (value === 0 ? 0.001 : value)) as Vec3 })}
                        />
                      </div>

                      <div class="mt-4 border-t border-v2-border-border-muted pt-3">
                        <div class="flex items-center justify-between gap-2">
                          <FieldLabel>{language.t("design.material")}</FieldLabel>
                          <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-v2-text-text-faint">
                            <span>{language.t("design.material.color")}</span>
                            <input
                              data-slot="design-color-picker"
                              type="color"
                              value={object().material.color}
                              onPointerDown={pushHistory}
                              onInput={(event) => updateSelectedMaterial({ color: event.currentTarget.value }, false)}
                              aria-label={language.t("design.material.color")}
                            />
                          </label>
                        </div>
                        <div class="mt-2 grid grid-cols-8 gap-1.5">
                          <For each={DESIGN_COLORS}>
                            {(color) => (
                              <button
                                type="button"
                                class="aspect-square rounded-[4px] border outline-none ring-offset-1 focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
                                classList={{
                                  "border-v2-text-text-base ring-1 ring-v2-text-text-base": object().material.color.toLowerCase() === color,
                                  "border-v2-border-border-strong": object().material.color.toLowerCase() !== color,
                                }}
                                style={{ "background-color": color }}
                                aria-label={color}
                                onClick={() => updateSelectedMaterial({ color })}
                              />
                            )}
                          </For>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2">
                          <HexField
                            label={language.t("design.material.emissive")}
                            value={object().material.emissive}
                            onChange={(emissive) => updateSelectedMaterial({ emissive })}
                          />
                        </div>
                        <RangeField
                          label={language.t("design.material.metalness")}
                          value={object().material.metalness}
                          min={0}
                          max={1}
                          step={0.01}
                          onStart={pushHistory}
                          onInput={(metalness) => updateSelectedMaterial({ metalness }, false)}
                        />
                        <RangeField
                          label={language.t("design.material.roughness")}
                          value={object().material.roughness}
                          min={0}
                          max={1}
                          step={0.01}
                          onStart={pushHistory}
                          onInput={(roughness) => updateSelectedMaterial({ roughness }, false)}
                        />
                        <RangeField
                          label={language.t("design.material.opacity")}
                          value={object().material.opacity}
                          min={0.05}
                          max={1}
                          step={0.01}
                          onStart={pushHistory}
                          onInput={(opacity) => updateSelectedMaterial({ opacity }, false)}
                        />
                        <RangeField
                          label={language.t("design.material.emissiveIntensity")}
                          value={object().material.emissiveIntensity}
                          min={0}
                          max={3}
                          step={0.05}
                          onStart={pushHistory}
                          onInput={(emissiveIntensity) => updateSelectedMaterial({ emissiveIntensity }, false)}
                        />
                        <div class="mt-3 flex flex-col gap-2">
                          <Switch
                            checked={object().material.wireframe}
                            onChange={(wireframe) => updateSelectedMaterial({ wireframe })}
                          >
                            {language.t("design.material.wireframe")}
                          </Switch>
                          <Switch
                            checked={object().visible}
                            onChange={(visible) => updateSelected({ visible })}
                          >
                            {language.t("design.material.visible")}
                          </Switch>
                        </div>
                      </div>
                    </>
                  )}
                </Show>
              </div>

              <div data-slot="design-save">
                <div class="flex items-center justify-between gap-2">
                  <FieldLabel>{language.t("design.project")}</FieldLabel>
                  <button
                    type="button"
                    class="text-[11px] text-v2-text-text-accent underline-offset-2 hover:underline"
                    onClick={addProject}
                  >
                    {language.t("design.project.add")}
                  </button>
                </div>
                <Show
                  when={target()}
                  fallback={
                    <div class="mt-1.5 rounded-[5px] border border-dashed border-v2-border-border-muted px-2 py-2 text-[11px] leading-4 text-v2-text-text-faint">
                      {language.t("design.project.none")}{" "}
                      <button
                        type="button"
                        class="text-v2-text-text-accent underline-offset-2 hover:underline"
                        onClick={() => navigate("/")}
                      >
                        {language.t("design.project.openHome")}
                      </button>
                    </div>
                  }
                >
                  {(destination) => (
                    <>
                      <Select
                        class="mt-1.5 w-full"
                        options={targets()}
                        current={destination()}
                        value={(item) => item.key}
                        label={(item) => item.label}
                        onSelect={selectTarget}
                        aria-label={language.t("design.project.select")}
                      >
                        {(item) => (
                          <span class="flex min-w-0 items-center gap-2">
                            <span class="truncate">{item.label}</span>
                            <Show when={item.serverLabel}>
                              <span class="truncate text-[11px] text-v2-text-text-faint">{item.serverLabel}</span>
                            </Show>
                          </span>
                        )}
                      </Select>
                      <TextInput
                        class="mt-1.5"
                        appearance="small"
                        value={saveFolder()}
                        placeholder={language.t("design.project.folder")}
                        onChange={(event) => setSaveFolder(event.currentTarget.value)}
                        aria-label={language.t("design.project.folder")}
                      />
                      <div class="mt-2 flex items-center gap-1">
                        <Button
                          type="button"
                          size="small"
                          variant="neutral"
                          class="flex-1"
                          disabled={!!saving()}
                          onClick={() => void saveFile("json")}
                        >
                          {language.t("design.save.scene")}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="neutral"
                          class="flex-1"
                          disabled={!!saving() || scene.objects.length === 0}
                          onClick={() => void saveFile("glb")}
                        >
                          GLB
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="neutral"
                          class="flex-1"
                          disabled={!!saving() || scene.objects.length === 0}
                          onClick={() => void saveFile("obj")}
                        >
                          OBJ
                        </Button>
                      </div>
                      <div class="mt-1.5 text-[10px] leading-3 text-v2-text-text-faint">
                        {language.t("design.export.robloxHint")}
                      </div>
                      <Show when={saveStatus()}>
                        {(status) => (
                          <div
                            class="mt-1.5 break-words text-[11px] leading-4"
                            classList={{
                              "text-v2-state-fg-danger": !status().ok,
                              "text-v2-state-fg-success": status().ok,
                            }}
                          >
                            {language.t(status().key, status().params)}
                          </div>
                        )}
                      </Show>
                    </>
                  )}
                </Show>
              </div>
            </aside>
          </div>
          </Show>
        </div>
      </SessionPanelFrame>
    </SessionRouteFrame>
  )
}

function FieldLabel(props: { class?: string; children: string }) {
  return (
    <div
      data-slot="design-field-label"
      class={`text-[11px] font-[530] leading-4 text-v2-text-text-faint ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  )
}

function VectorField(props: { values: Vec3; step: number; suffix?: string; onChange: (value: Vec3) => void }) {
  return (
    <div class="mt-1 grid grid-cols-3 gap-1">
      <For each={["X", "Y", "Z"] as const}>
        {(axis, index) => (
          <label class="flex min-w-0 items-center gap-1 rounded-[5px] bg-v2-background-bg-layer-01 ps-1.5">
            <span class="shrink-0 text-[10px] font-[530] text-v2-text-text-faint">{axis}</span>
            <TextInput
              class="min-w-0 flex-1"
              appearance="small"
              surface="invisible"
              numeric
              type="number"
              step={props.step}
              value={formatNumber(props.values[index()])}
              onChange={(event) => {
                const value = Number(event.currentTarget.value)

                if (!Number.isFinite(value)) return
                const next = [...props.values] as Vec3
                next[index()] = value
                props.onChange(next)
              }}
              aria-label={axis}
            />
            <Show when={props.suffix}>
              <span class="pe-1 text-[10px] text-v2-text-text-faint">{props.suffix}</span>
            </Show>
          </label>
        )}
      </For>
    </div>
  )
}

function RangeField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onStart: () => void
  onInput: (value: number) => void
}) {
  return (
    <label class="mt-2 flex items-center gap-2">
      <span class="w-[92px] shrink-0 text-[11px] leading-4 text-v2-text-text-faint">{props.label}</span>
      <input
        data-slot="design-range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={props.onStart}
        onKeyDown={props.onStart}
        onInput={(event) => {
          const value = Number(event.currentTarget.value)

          if (Number.isFinite(value)) props.onInput(value)
        }}
        aria-label={props.label}
      />
      <span class="w-8 shrink-0 text-end text-[10px] tabular-nums text-v2-text-text-faint">
        {props.value.toFixed(2)}
      </span>
    </label>
  )
}

function HexField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label class="flex min-w-0 flex-col gap-1">
      <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.label}</span>
      <span class="flex items-center gap-1.5">
        <span
          class="size-5 shrink-0 rounded-[4px] border border-v2-border-border-strong"
          style={{ "background-color": props.value }}
          aria-hidden="true"
        />
        <TextInput
          class="min-w-0 flex-1"
          appearance="small"
          value={props.value}
          onChange={(event) => {
            const value = event.currentTarget.value.trim()

            if (/^#[0-9a-f]{6}$/i.test(value)) props.onChange(value.toLowerCase())
          }}
          aria-label={props.label}
        />
      </span>
    </label>
  )
}

function shapeKey(shape: DesignShape) {
  return `design.shape.${shape}` as const
}

function formatNumber(value: number) {
  return Number(value.toFixed(3)).toString()
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function radiansToDegrees(value: number) {
  return Number(((value * 180) / Math.PI).toFixed(3))
}

function loadScene(): DesignScene {
  const raw = localStorage.getItem(STORAGE_KEY)

  if (!raw) return starterScene()

  try {
    return parseDesignScene(JSON.parse(raw)) ?? starterScene()
  } catch {
    return starterScene()
  }
}

function starterScene(): DesignScene {
  const first = addObject(createScene(), "box", [-1.2, 0.5, 0])

  first.object.material = { ...first.object.material, color: "#5b8def", metalness: 0.12, roughness: 0.35 }
  const second = addObject(first.scene, "sphere", [1.2, 0.75, 0])

  second.object.material = { ...second.object.material, color: "#e8833a", metalness: 0.05, roughness: 0.4 }

  return second.scene
}
