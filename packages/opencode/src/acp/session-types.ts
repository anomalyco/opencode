export interface SessionInfo {
	id: string
	title: string
	createdAt: string
	updatedAt: string
	projectPath?: string
	messageCount: number
}

export interface SessionListParams {
	limit?: number
	projectPath?: string
}

export interface SessionListResult {
	sessions: SessionInfo[]
}

export interface SessionSwitchParams {
	sessionId: string
}

export interface SessionCreateParams {
	title?: string
	projectPath?: string
}

export interface SessionForkParams {
	sessionId: string
	messageId: string
	title?: string
}

export interface SessionRenameParams {
	sessionId: string
	title: string
}

export interface SessionDeleteParams {
	sessionId: string
}

export interface SessionInfoParams {
	sessionId: string
}

export interface SessionUndoParams {
	sessionId?: string
}

export interface SessionRedoParams {
	sessionId?: string
}

export interface SessionCompactParams {
	sessionId?: string
}

export interface SessionExportParams {
	sessionId?: string
	format?: "text" | "json" | "markdown"
}

export interface SessionExportResult {
	content: string
	filename: string
}

export interface SessionJumpParams {
	sessionId: string
	messageId: string
}

export interface SessionDuplicateParams {
	sessionId: string
	title?: string
}

export const SESSION_STORAGE_PATH = "~/.local/share/opencode/storage/session/"

// Helper to format session for API response (for use in handlers)
export function formatSessionInfo(session: any): SessionInfo {
	return {
		id: session.id,
		title: session.title ?? `Session ${session.id.slice(0, 8)}`,
		createdAt: session.createdAt?.toISOString() ?? new Date().toISOString(),
		updatedAt: session.updatedAt?.toISOString() ?? new Date().toISOString(),
		projectPath: session.projectPath,
		messageCount: session.messages?.length ?? 0,
	}
}
