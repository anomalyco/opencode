# AF Build Console Specification Changelog

> Track changes to the design specification

## 2026-01-15 - Initial Implementation Decisions

### ✅ Confirmed Design Decisions

#### 1. Package Naming
- **Decision**: `packages/console`
- **Reason**: Concise, aligns with "console" concept

#### 2. Tauri Version
- **Decision**: Tauri 2.x
- **Reason**: Consistent with OpenCode Desktop, latest stable version

#### 3. Layout Ratio
- **Decision**: Hardcoded 40/60 split (MVP)
- **Original Spec**: Mentioned "draggable"
- **Change**: MVP uses fixed ratio, Phase 2 adds drag-to-resize
- **Reason**: Reduce initial complexity, faster validation

#### 4. OpenCode Server Startup
- **Decision**: Auto-start (Tauri spawn)
- **Original Spec**: Not explicitly specified
- **Addition**: Detect and start `opencode serve --port 4096` in Tauri main.rs
- **Reason**: Better UX, one-click launch

#### 5. Actions Bar Button Count
- **Decision**: 4 buttons (Open Workspace + Deploy/Export/Copy)
- **Original Spec**: 3 buttons (Deploy/Export/Copy)
- **Change**: Added "Open Workspace" button
- **Reason**: Easier for users to open folders, improved usability

#### 6. Editor Selection
- **Decision**: CodeMirror 6
- **Original Spec**: "Monaco/CodeMirror"
- **Confirmation**: Use CodeMirror for reasons outlined in design doc (lightweight, mobile support)

### 📝 New Requirements

#### 1. README Documentation
- **Added**: packages/console/README.md
- **Content**: Quick start, project structure, tech stack, development guide

#### 2. Icon Assets
- **To Add**: src-tauri/icons/*.png, *.icns, *.ico
- **Temporary**: Use placeholder icons
- **Future**: Design AF Build Studio specific icons

### 🔄 Items Requiring Clarification

#### 1. Deploy to AF Flow Details
- **Question**: Which API provides OSS upload credentials?
- **Need**: Specific AF Backend API endpoint
- **Tentative**: `/api/v1/artifact/upload-credential`

#### 2. Capacitor Bridge Configuration
- **Question**: Which Capacitor plugins does iOS WKWebView need?
- **Original Spec**: Mentioned "filesystem, camera"
- **To Confirm**: Complete list of required plugins

#### 3. Workspace Data Persistence
- **Question**: Is localStorage sufficient?
- **Consider**: Need SQLite or IndexedDB?
- **MVP Decision**: Start with localStorage, upgrade if data grows

### 🚫 Explicit Non-Goals (MVP)

1. **Drag-to-resize layout**: Phase 2
2. **LSP integration**: Phase 2+
3. **Container sandbox**: Phase 2
4. **Mobile support**: Phase 3
5. **Multiple session switching**: Week 4+

### 📊 Technical Decision Log

| Technology | Decision | Reason |
|-----------|----------|--------|
| Frontend Framework | React 18 | Different from OpenCode (Desktop uses SolidJS), but more mature |
| State Management | Zustand | Lightweight, clean API, suitable for small-medium apps |
| Styling | Tailwind CSS | Consistent with OpenCode, rapid development. |
| Editor | CodeMirror 6 | Lightweight, 200KB vs Monaco 5MB |
| Build Tool | Vite 5 | Fast HMR, consistent with OpenCode |
| Package Manager | Bun | Consistent with OpenCode, fast |

### 🔍 Questions Requiring User Confirmation

_Currently no confirmation needed. May need further refinement during Week 2 development._

---

**Maintenance Note**: Update this document whenever design changes occur
