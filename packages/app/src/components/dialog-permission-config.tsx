import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

export type PermissionAction = "allow" | "ask" | "deny"

export interface PatternRuleItem {
  id: string
  pattern: string
  action: PermissionAction
}

export interface PermissionFormProps {
  toolID?: string
  initialAction?: PermissionAction
  initialPatterns?: PatternRuleItem[]
  onBack?: () => void
  onClose?: () => void
}

const COMMON_TOOLS = [
  { value: "bash", label: "运行命令行 (bash)", desc: "Shell 与终端命令执行" },
  { value: "edit", label: "文件修改 (edit)", desc: "写入、编辑与补丁文件" },
  { value: "read", label: "文件读取 (read)", desc: "读取文件内容" },
  { value: "external_directory", label: "项目外目录 (external_directory)", desc: "访问项目目录以外的文件" },
  { value: "webfetch", label: "网页抓取 (webfetch)", desc: "从 URL 获取网络资源" },
  { value: "websearch", label: "网页搜索 (websearch)", desc: "通过搜索引擎检索网络" },
  { value: "task", label: "派发子代理 (task)", desc: "启动与调度子智能体" },
  { value: "skill", label: "技能调用 (skill)", desc: "加载与调用 Skill" },
  { value: "todowrite", label: "待办清单 (todowrite)", desc: "创建与更新待办事项" },
  { value: "question", label: "向用户提问 (question)", desc: "交互过程中向用户主动发问" },
  { value: "glob", label: "Glob 查找 (glob)", desc: "使用模式匹配文件路径" },
  { value: "grep", label: "Grep 检索 (grep)", desc: "正则全文检索文件内容" },
  { value: "list", label: "目录列表 (list)", desc: "列出目录中的文件结构" },
  { value: "doom_loop", label: "死循环熔断 (doom_loop)", desc: "相同输入重复调用的安全拦截" },
] as const

const ACTION_OPTIONS: Array<{ value: PermissionAction; label: string; desc: string }> = [
  { value: "allow", label: "允许 (allow)", desc: "无需确认直接放行执行" },
  { value: "ask", label: "每次询问 (ask)", desc: "执行前弹出对话框等待人工批准" },
  { value: "deny", label: "拒绝 (deny)", desc: "静默或直接拦截执行" },
]

/**
 * 权限规则配置与细粒度模式弹窗
 */
export function DialogPermissionConfig(props: PermissionFormProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSync = useServerSync()
  const isEditing = !!props.toolID

  const [toolID, setToolID] = createSignal(props.toolID ?? "bash")
  const [isCustomTool, setIsCustomTool] = createSignal(
    !props.toolID || !COMMON_TOOLS.some((t) => t.value === props.toolID),
  )
  const [defaultAction, setDefaultAction] = createSignal<PermissionAction>(props.initialAction ?? "ask")
  const [patterns, setPatterns] = createStore<PatternRuleItem[]>(
    props.initialPatterns ? JSON.parse(JSON.stringify(props.initialPatterns)) : [],
  )

  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const handleBack = () => {
    if (props.onBack) {
      props.onBack()
    } else {
      dialog.close()
    }
  }

  const addPattern = () => {
    setPatterns(
      patterns.length,
      {
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pattern: "",
        action: "ask",
      },
    )
  }

  const removePattern = (index: number) => {
    setPatterns((prev) => prev.filter((_, i) => i !== index))
  }

  const save = async (e: Event) => {
    e.preventDefault()
    const targetID = toolID().trim()
    if (!targetID) {
      setError("工具标识不能为空")
      return
    }

    setBusy(true)
    setError(undefined)

    try {
      const currentConfig = serverSync().data.config
      const rawPerm = currentConfig.permission

      // 转换为标准 map
      let permMap: Record<string, unknown> = {}
      if (rawPerm && typeof rawPerm === "object" && !Array.isArray(rawPerm)) {
        permMap = { ...(rawPerm as Record<string, unknown>) }
      } else if (typeof rawPerm === "string") {
        permMap = { "*": rawPerm }
      }

      // 处理有效 pattern 列表
      const validPatterns = patterns.filter((p) => p.pattern.trim().length > 0)

      if (validPatterns.length === 0) {
        // 无细粒度规则，使用扁平动作字符串
        permMap[targetID] = defaultAction()
      } else {
        // 组装模式字典，保证通配符与特定模式按序存在
        const ruleObj: Record<string, PermissionAction> = {}
        for (const item of validPatterns) {
          ruleObj[item.pattern.trim()] = item.action
        }
        // 如果没有显式配置通配符 *，添加默认动作
        if (ruleObj["*"] === undefined) {
          ruleObj["*"] = defaultAction()
        }
        permMap[targetID] = ruleObj
      }

      await serverSync().updateConfig({ permission: permMap as never })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEditing ? "权限规则已更新" : "权限规则已添加",
        description: `工具「${targetID}」的授权规则已写回本地配置并立即生效。`,
      })

      handleBack()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      showToast({ variant: "error", title: "保存失败", description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={
        <div class="flex items-center gap-3">
          <IconButton icon="arrow-left" variant="ghost" onClick={handleBack} aria-label={language.t("common.goBack")} />
          <span class="text-16-medium text-text-strong">
            {isEditing ? `配置工具权限: ${props.toolID}` : "添加工具权限规则"}
          </span>
        </div>
      }
      size="large"
      class="h-full flex flex-col min-h-0 overflow-hidden"
      transition
    >
      <form onSubmit={save} class="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
        <div class="flex-1 overflow-y-auto no-scrollbar px-6 sm:px-8 py-5 flex flex-col gap-6 w-full">
          <Show when={error()}>
            <div class="p-3 text-13-regular rounded-lg bg-surface-critical-base text-text-critical-base">
              {error()}
            </div>
          </Show>

          {/* 工具选择 */}
          <div class="flex flex-col gap-2">
            <label class="text-13-medium text-text-strong">目标工具 / 功能标识</label>
            <Show
              when={!isEditing}
              fallback={
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base/40 text-13-regular font-mono text-text-strong">
                  <Icon name="shield" class="size-4 text-icon-base" />
                  <span>{props.toolID}</span>
                </div>
              }
            >
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                  <Select
                    options={COMMON_TOOLS as unknown as Array<{ value: string; label: string; desc: string }>}
                    current={COMMON_TOOLS.find((t) => t.value === toolID())}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(opt) => {
                      if (opt) {
                        setToolID(opt.value)
                        setIsCustomTool(false)
                      }
                    }}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    class="flex-1"
                  />
                  <Button
                    size="small"
                    variant={isCustomTool() ? "primary" : "secondary"}
                    onClick={() => {
                      setIsCustomTool(!isCustomTool())
                      if (!isCustomTool()) {
                        setToolID("bash")
                      } else {
                        setToolID("")
                      }
                    }}
                  >
                    {isCustomTool() ? "从常用选择" : "手填自定义"}
                  </Button>
                </div>

                <Show when={isCustomTool()}>
                  <TextField
                    placeholder="输入工具名称（如: git, docker, my_plugin 等）"
                    value={toolID()}
                    onChange={setToolID}
                    class="text-13-regular font-mono"
                    required
                  />
                </Show>
              </div>
            </Show>
          </div>

          {/* 默认执行动作 */}
          <div class="flex flex-col gap-2">
            <label class="text-13-medium text-text-strong">默认执行策略 (兜底动作)</label>
            <span class="text-12-regular text-text-weak">
              当请求未匹配下方任何特定规则，或未配置细粒度规则时的全局兜底策略。
            </span>
            <div class="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
              <For each={ACTION_OPTIONS}>
                {(opt) => {
                  const isSelected = () => defaultAction() === opt.value
                  return (
                    <button
                      type="button"
                      onClick={() => setDefaultAction(opt.value)}
                      class={`flex flex-col gap-1 p-3 rounded-lg border text-left transition-all ${
                        isSelected()
                          ? "bg-surface-raised-base border-border-base shadow-sm ring-1 ring-border-base"
                          : "bg-surface-base border-border-weak-base/40 hover:bg-surface-base-hover/50 text-text-weak"
                      }`}
                    >
                      <div class="flex items-center justify-between w-full">
                        <span class={`text-13-medium ${isSelected() ? "text-text-strong font-medium" : ""}`}>
                          {opt.label}
                        </span>
                        <Show when={isSelected()}>
                          <Icon name="check" class="size-3.5 text-text-strong" />
                        </Show>
                      </div>
                      <span class="text-11-regular text-text-weak leading-tight">{opt.desc}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          {/* 细粒度模式匹配规则列表 */}
          <div class="flex flex-col gap-3 pt-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <label class="text-13-medium text-text-strong">细粒度模式匹配规则</label>
                <Tag class="text-10-regular font-mono bg-surface-base border-border-weak-base/30">
                  {patterns.length} 条规则
                </Tag>
              </div>
              <Button size="small" variant="secondary" icon="plus" onClick={addPattern} type="button">
                添加模式规则
              </Button>
            </div>

            <span class="text-12-regular text-text-weak">
              Basalt 按照从上到下的顺序匹配，最后匹配命中的规则将作为最终裁决依据。
            </span>

            <Show
              when={patterns.length > 0}
              fallback={
                <div class="py-6 px-4 rounded-lg border border-dashed border-border-weak-base/40 text-center bg-surface-base/30 text-text-weak text-12-regular">
                  暂无针对命令或路径的细粒度规则。当前该工具将纯粹按照默认策略（{defaultAction()}）执行。
                </div>
              }
            >
              <div class="flex flex-col gap-2 rounded-lg bg-surface-base p-3 border border-border-weak-base/40">
                <For each={patterns}>
                  {(item, index) => (
                    <div class="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-base-hover/40 transition-colors">
                      <span class="text-11-medium font-mono text-text-weak w-6 shrink-0 text-center select-none">
                        #{index() + 1}
                      </span>
                      <div class="flex-1 min-w-0">
                        <TextField
                          placeholder="匹配模式，如: git *、rm *、src/** 或 ~/secrets/**"
                          value={item.pattern}
                          onChange={(v) => setPatterns(index(), "pattern", v)}
                          class="text-12-regular font-mono w-full"
                        />
                      </div>
                      <div class="shrink-0">
                        <Select
                          options={ACTION_OPTIONS}
                          current={ACTION_OPTIONS.find((o) => o.value === item.action)}
                          value={(o) => o.value}
                          label={(o) => o.label}
                          onSelect={(opt) => opt && setPatterns(index(), "action", opt.value)}
                          variant="secondary"
                          size="small"
                          triggerStyle={{ height: "24px", "min-width": "112px", display: "inline-flex", "align-items": "center" }}
                          valueClass="text-12-regular"
                        />
                      </div>
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        onClick={() => removePattern(index())}
                        title="删除该条规则"
                        class="text-icon-weak-base hover:text-text-critical-base shrink-0"
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        {/* 底部吸底按钮栏 */}
        <div class="flex items-center justify-end gap-3 px-6 sm:px-8 py-4 border-t border-border-weak-base/40 bg-surface-raised-stronger-non-alpha shrink-0">
          <Button variant="secondary" onClick={handleBack} disabled={busy()} type="button">
            取消
          </Button>
          <Button variant="primary" type="submit" disabled={busy()}>
            {busy() ? "保存中..." : "保存并立即生效"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
