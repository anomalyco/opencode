# OpenTUI Web Performance Optimization Plan

## Priority 1: Component Splitting (MessagesPanel.tsx)
- [ ] Extract MessageItem component (user/assistant messages)
- [ ] Extract ToolDisplay component (tool execution rendering)
- [ ] Extract UserMessage component
- [ ] Extract AssistantMessage component

## Priority 2: Optimize Rendering
- [ ] Replace array mapping with SolidJS <For> component
- [ ] Add proper indexes to prevent full re-renders
- [ ] Cache tool expansion states per session
- [ ] Optimize renderMessages memo dependencies

## Priority 3: Auto-scroll Optimization
- [ ] Debounce auto-scroll effect
- [ ] Only scroll when at bottom (user intent preservation)
- [ ] Use IntersectionObserver instead of scroll calculations

## Priority 4: Autocomplete Optimization
- [ ] Add debouncing (300ms) to file fetching
- [ ] Implement cache for file list results by directory
- [ ] Add LRU cache eviction strategy

## Priority 5: Timer Cleanup
- [ ] Audit all setInterval/setTimeout usage
- [ ] Ensure onCleanup hooks for all timers
- [ ] Fix cursor blink interval cleanup in MainScreen, TerminalLayout

## Priority 6: Virtual Scrolling (Future)
- [ ] Research SolidJS virtual list libraries
- [ ] Implement windowing for message rendering
- [ ] Only render visible + buffer messages
