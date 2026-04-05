import { Component, Show, createMemo, createEffect, onCleanup, useRef } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"

export interface ThemePreviewProps {
  id: string
  name: string
  isActive: boolean
  isPreviewing: boolean
  onSelect: () => void
  onPreview: () => void
  onCancelPreview: () => void
  onCommitPreview: () => void
}

export function ThemePreview(props: ThemePreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null)

  const isActive = createMemo(() => props.isActive)
  const isPreviewing = createMemo(() => props.isPreviewing)

  return (
    <div
      ref={previewRef}
      classList={{
        "relative rounded-lg overflow-hidden border border-border-weak-base hover:border-border-strong-base transition-colors cursor-pointer group": true,
        "ring-2 ring-icon-info-active": isActive() || isPreviewing(),
      }}
      onClick={props.onSelect}
    >
      {/* 主题预览卡片 */}
      <div class="h-32 w-full bg-background-base flex flex-col">
        {/* 模拟编辑器界面 */}
        <div class="h-6 bg-surface-base border-b border-border-weak-base flex items-center px-3">
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-red-500"></div>
            <div class="w-2 h-2 rounded-full bg-yellow-500"></div>
            <div class="w-2 h-2 rounded-full bg-green-500"></div>
          </div>
        </div>
        <div class="flex-1 p-3 text-sm font-mono">
          <div class="text-syntax-keyword">function</div>
          <div class="text-syntax-function">hello</div>
          <div class="text-text-weak">()</div>
          <div class="text-text-weak">{`{`}</div>
          <div class="pl-4 text-syntax-string">console.log</div>
          <div class="text-text-weak">(</div>
          <div class="text-syntax-string">"Hello, World!"</div>
          <div class="text-text-weak">)</div>
          <div class="text-text-weak">{`}`}</div>
        </div>
      </div>
      
      {/* 主题信息 */}
      <div class="p-3 bg-surface-base border-t border-border-weak-base">
        <div class="flex items-center justify-between">
          <div class="font-medium text-text-strong">{props.name}</div>
          <div class="flex items-center gap-1">
            <Show when={isPreviewing()}>
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="small"
                  icon="check"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onCommitPreview()
                  }}
                  aria-label="Apply theme"
                />
                <Button
                  variant="ghost"
                  size="small"
                  icon="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onCancelPreview()
                  }}
                  aria-label="Cancel preview"
                />
              </div>
            </Show>
            <Show when={!isPreviewing()}>
              <Button
                variant="ghost"
                size="small"
                icon="eye"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onPreview()
                }}
                aria-label="Preview theme"
              />
            </Show>
          </div>
        </div>
      </div>
      
      {/* 活动状态指示器 */}
      <Show when={isActive()}>
        <div class="absolute top-2 right-2 bg-icon-info-active text-icon-invert-base rounded-full w-5 h-5 flex items-center justify-center text-xs font-medium">
          ✓
        </div>
      </Show>
    </div>
  )
}
