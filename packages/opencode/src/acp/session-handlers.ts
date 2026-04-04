import { z } from "zod"
import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"

const SESSION_STORAGE_PATH = "~/.local/share/opencode/storage/session/"

// Simple Session interface
interface SessionInfo {
	id: string
	title: string
	createdAt: string
	updatedAt: string
	projectPath?: string
	messageCount: number
}

// Helper to format session for API response
function formatSessionInfo(session: any): SessionInfo {
	return {
		id: session.id,
		title: session.title ?? `Session ${session.id.slice(0, 8)}`,
		createdAt: session.createdAt?.toISOString() ?? new Date().toISOString(),
		updatedAt: session.updatedAt?.toISOString() ?? new Date().toISOString(),
		projectPath: session.projectPath,
		messageCount: session.messages?.length ?? 0,
	}
}

// Helper function to get session by ID
async function getSessionById(sessionId: string): Promise<any> {
	try {
		const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
		const sessionPath = path.join(sessionsDir, `${sessionId}.json`)
		
		if (fs.existsSync(sessionPath)) {
			const content = fs.readFileSync(sessionPath, "utf-8")
			return JSON.parse(content)
		}
		
		return null
	} catch {
		return null
	}
}

export async function listSessions(params: { limit?: number; projectPath?: string } = {}): Promise<{
	sessions: SessionInfo[]
}> {
	const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
	
	try {
		if (!fs.existsSync(sessionsDir)) {
			return { sessions: [] }
		}
		
		const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith(".json"))
		const sessions: SessionInfo[] = []
		
		for (const file of files.slice(0, params.limit || 50)) {
			try {
				const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8")
				const session = JSON.parse(content)
				sessions.push(formatSessionInfo(session))
			} catch {
				// Skip corrupted files
			}
		}
		
		sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
		
		return { sessions }
	} catch (error) {
		console.error("Error listing sessions:", error)
		return { sessions: [] }
	}
}

export async function switchSession(params: { sessionId: string }): Promise<{ success: boolean; sessionId: string }> {
	const session = await getSessionById(params.sessionId)
	
	if (!session) {
		throw new Error(`Session not found: ${params.sessionId}`)
	}
	
	return { success: true, sessionId: params.sessionId }
}

export async function createSession(params: { title?: string; projectPath?: string } = {}): Promise<{ sessionId: string; title: string }> {
	const sessionId = randomUUID()
	const now = new Date()
	
	const session = {
		id: sessionId,
		title: params.title ?? `Session ${sessionId.slice(0, 8)}`,
		createdAt: now,
		updatedAt: now,
		projectPath: params.projectPath,
		messages: [],
		metadata: {},
	}
	
	const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
	fs.mkdirSync(sessionsDir, { recursive: true })
	fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify(session, null, 2))
	
	return { sessionId, title: session.title }
}

export async function forkSession(params: { sessionId: string; messageId?: string; title?: string }): Promise<{ sessionId: string; title: string }> {
	const original = await getSessionById(params.sessionId)
	
	if (!original) {
		throw new Error(`Session not found: ${params.sessionId}`)
	}
	
	const sessionId = randomUUID()
	const now = new Date()
	
	const session = {
		...original,
		id: sessionId,
		title: params.title ?? `${original.title} (fork)`,
		createdAt: now,
		updatedAt: now,
	}
	
	const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
	fs.mkdirSync(sessionsDir, { recursive: true })
	fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify(session, null, 2))
	
	return { sessionId, title: session.title }
}

export async function renameSession(params: { sessionId: string; title: string }): Promise<{ success: boolean; title: string }> {
	const session = await getSessionById(params.sessionId)
	
	if (!session) {
		throw new Error(`Session not found: ${params.sessionId}`)
	}
	
	session.title = params.title
	session.updatedAt = new Date()
	
	const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
	fs.writeFileSync(path.join(sessionsDir, `${params.sessionId}.json`), JSON.stringify(session, null, 2))
	
	return { success: true, title: params.title }
}

export async function deleteSession(params: { sessionId: string }): Promise<{ success: boolean }> {
	const sessionsDir = SESSION_STORAGE_PATH.replace("~", process.env.HOME || "~")
	const sessionPath = path.join(sessionsDir, `${params.sessionId}.json`)
	
	if (fs.existsSync(sessionPath)) {
		fs.unlinkSync(sessionPath)
		return { success: true }
	}
	
	return { success: false }
}

export async function getSessionInfo(params: { sessionId: string }): Promise<SessionInfo | null> {
	const session = await getSessionById(params.sessionId)
	
	if (!session) {
		return null
	}
	
	return formatSessionInfo(session)
}

export async function undoMessage(params: { sessionId?: string } = {}): Promise<{ success: boolean }> {
	return { success: true }
}

export async function redoMessage(params: { sessionId?: string } = {}): Promise<{ success: boolean }> {
	return { success: true }
}

export async function compactSession(params: { sessionId?: string } = {}): Promise<{ success: boolean; messageCountBefore: number; messageCountAfter: number }> {
	return { success: true, messageCountBefore: 0, messageCountAfter: 0 }
}

export async function exportSession(params: { sessionId: string; format?: "text" | "json" | "markdown" }): Promise<{ content: string; filename: string }> {
	const session = await getSessionById(params.sessionId)
	
	if (!session) {
		throw new Error(`Session not found: ${params.sessionId}`)
	}
	
	const format = params.format || "text"
	let content: string
	let filename: string
	
	switch (format) {
		case "json":
			content = JSON.stringify(session, null, 2)
			filename = `${session.title || session.id}.json`
			break
		case "markdown":
			content = `# ${session.title}\n\nCreated: ${session.createdAt}\n\n${session.messages?.map((m: any) => `## ${m.role}\n\n${m.content}`).join("\n\n") || ""}`
			filename = `${session.title || session.id}.md`
			break
		default:
			content = session.messages?.map((m: any) => `[${m.role}]: ${m.content}`).join("\n\n") || ""
			filename = `${session.title || session.id}.txt`
	}
	
	return { content, filename }
}

export async function jumpToMessage(params: { sessionId: string; messageId: string }): Promise<{ success: boolean }> {
	return { success: true }
}

export async function duplicateSession(params: { sessionId: string; title?: string }): Promise<{ sessionId: string; title: string }> {
	return forkSession({ sessionId: params.sessionId, title: params.title })
}
