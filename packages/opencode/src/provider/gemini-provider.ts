import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { geminiAuth } from "./gemini-auth";
import { fetch } from "bun";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";

export function createGeminiCloudCode(options: any = {}) {
  return createOpenAICompatible({
    name: "gemini-cloud-code",
    baseURL: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}`,
    fetch: (async (url: any, init: any) => {
        // This fetch adapter converts OpenAI format to Gemini Cloud Code format
        const token = await geminiAuth.getAccessToken();
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || "default-project";

        // Provide a dummy integration for simple non-chat requests if any
        if (!init || !init.body) {
            return fetch(url, init);
        }

        // Parse OpenAI body
        const openaiBody = JSON.parse(init.body as string);
        
        // We only intercept chat completions
        if (!url.toString().endsWith("/chat/completions")) {
             return fetch(url, init);
        }

        const isStreaming = openaiBody.stream;
        const geminiUrl = isStreaming 
            ? `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
            : `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`;

        const geminiBody = {
            model: openaiBody.model || "gemini-2.5-flash", 
            project: projectId,
            request: {
                contents: convertMessages(openaiBody.messages),
                generationConfig: {
                    temperature: openaiBody.temperature,
                    maxOutputTokens: openaiBody.max_tokens,
                }
            }
        };

        const response = await fetch(geminiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(geminiBody),
        });

        if (!response.ok) {
             const text = await response.text();
             console.error("Gemini API Error", response.status, text);
             // Return validation error formatted as OpenAI error if possible, or just throw
             throw new Error(`Gemini API Error: ${response.status} ${text}`);
        }

        if (isStreaming) {
            // Transform SSE stream
             const stream = response.body;
             if (!stream) throw new Error("No stream body");
             
             const transformedStream = transformSSEStream(stream, geminiBody.model);
             
             return new Response(transformedStream, {
                 headers: { "Content-Type": "text/event-stream" }
             });
        } else {
            // Transform JSON response
            const data = await response.json();
            const openaiResponse = convertResponse(data, geminiBody.model);
            return new Response(JSON.stringify(openaiResponse), {
                headers: { "Content-Type": "application/json" }
            });
        }
    }) as any,
  });
}

function convertMessages(messages: any[]) {
    return messages.map(msg => {
        const role = msg.role === "assistant" ? "model" : "user";
        // Handle content blocks if present, or just text
        let parts = [];
        if (typeof msg.content === "string") {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            parts = msg.content.map((c: any) => c.type === "text" ? { text: c.text } : null).filter(Boolean);
        }

        return { role, parts };
    });
}

function convertResponse(data: any, modelId: string) {
    const candidate = data.response?.candidates?.[0] || data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let content = "";
    for (const part of parts) {
        if (part.text) content += part.text;
    }
    
    // Extract usage info if available
    const usage = data.usageMetadata || {};

    return {
        id: "chatcmpl-" + Math.random().toString(36).substring(2),
        object: "chat.completion",
        created: Date.now(),
        model: modelId,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: content,
                },
                finish_reason: mapFinishReason(candidate?.finishReason),
            }
        ],
        usage: {
            prompt_tokens: usage.promptTokenCount || 0,
            completion_tokens: usage.candidatesTokenCount || 0,
            total_tokens: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
        }
    };
}

function mapFinishReason(reason: string) {
    if (!reason) return "stop";
    switch (reason.toLowerCase()) {
        case "stop": return "stop";
        case "max_tokens": return "length";
        default: return "stop";
    }
}

function transformSSEStream(stream: ReadableStream, modelId: string) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    
    return new ReadableStream({
        async start(controller) {
            let buffer = "";
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data: ")) continue;
                        const dataStr = trimmed.slice(6);
                        if (dataStr === "[DONE]") {
                            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                             continue;
                        }

                        try {
                            const data = JSON.parse(dataStr);
                            const candidate = data.response?.candidates?.[0] || data.candidates?.[0];
                            if (!candidate) continue;

                            const parts = candidate.content?.parts || [];
                            let text = "";
                            for (const part of parts) {
                                if (part.text) text += part.text;
                            }

                            if (text) {
                                const chunk = {
                                    id: "chatcmpl-" + Math.random().toString(36).substring(2),
                                    object: "chat.completion.chunk",
                                    created: Date.now(),
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: { content: text },
                                        finish_reason: null
                                    }]
                                };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                            }
                            
                            if (candidate.finishReason) {
                                 const chunk = {
                                    id: "chatcmpl-" + Math.random().toString(36).substring(2),
                                    object: "chat.completion.chunk",
                                    created: Date.now(),
                                    model: modelId,
                                    choices: [{
                                        index: 0,
                                        delta: {},
                                        finish_reason: mapFinishReason(candidate.finishReason)
                                    }]
                                };
                                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                            }

                        } catch (e) {
                             // ignore
                        }
                    }
                }
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                controller.close();
            } catch (e) {
                controller.error(e);
            }
        }
    });
}
