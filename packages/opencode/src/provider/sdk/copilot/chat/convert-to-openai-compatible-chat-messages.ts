import {
  type LanguageModelV2Prompt,
  type SharedV2ProviderMetadata,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import type { OpenAICompatibleChatPrompt } from './openai-compatible-api-types';
import { convertToBase64 } from '@ai-sdk/provider-utils';

// Copilot-specific cache control added to all messages for prompt caching
const CACHE_CONTROL = { copilot_cache_control: { type: 'ephemeral' as const } };

function getOpenAIMetadata(message: {
  providerOptions?: SharedV2ProviderMetadata;
}) {
  return message?.providerOptions?.copilot ?? {};
}

export function convertToOpenAICompatibleChatMessages(
  prompt: LanguageModelV2Prompt,
): OpenAICompatibleChatPrompt {
  const messages: OpenAICompatibleChatPrompt = [];
  for (const { role, content, ...message } of prompt) {
    const metadata = getOpenAIMetadata({ ...message });
    switch (role) {
      case 'system': {
        // Copilot uses content array format with cache control on each part
        messages.push({
          role: 'system',
          content: [
            {
              type: 'text',
              text: content,
              ...CACHE_CONTROL,
            },
          ],
          ...metadata,
        });
        break;
      }

      case 'user': {
        if (content.length === 1 && content[0].type === 'text') {
          messages.push({
            role: 'user',
            content: content[0].text,
            ...CACHE_CONTROL,
            ...getOpenAIMetadata(content[0]),
          });
          break;
        }

        messages.push({
          role: 'user',
          content: content.map(part => {
            const partMetadata = getOpenAIMetadata(part);
            switch (part.type) {
              case 'text': {
                return { type: 'text', text: part.text, ...partMetadata };
              }
              case 'file': {
                if (part.mediaType.startsWith('image/')) {
                  const mediaType =
                    part.mediaType === 'image/*'
                      ? 'image/jpeg'
                      : part.mediaType;

                  return {
                    type: 'image_url',
                    image_url: {
                      url:
                        part.data instanceof URL
                          ? part.data.toString()
                          : `data:${mediaType};base64,${convertToBase64(part.data)}`,
                    },
                    ...partMetadata,
                  };
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part media type ${part.mediaType}`,
                  });
                }
              }
            }
          }),
          ...CACHE_CONTROL,
          ...metadata,
        });

        break;
      }

      case 'assistant': {
        let text = '';
        let reasoningText: string | undefined;
        let reasoningOpaque: string | undefined;
        const toolCalls: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }> = [];

        for (const part of content) {
          const partMetadata = getOpenAIMetadata(part);
          // Check for reasoningOpaque on any part (may be attached to text/tool-call)
          const partOpaque = (
            part.providerOptions as { copilot?: { reasoningOpaque?: string } }
          )?.copilot?.reasoningOpaque;
          if (partOpaque && !reasoningOpaque) {
            reasoningOpaque = partOpaque;
          }

          switch (part.type) {
            case 'text': {
              text += part.text;
              break;
            }
            case 'reasoning': {
              reasoningText = part.text;
              break;
            }
            case 'tool-call': {
              toolCalls.push({
                id: part.toolCallId,
                type: 'function',
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
                ...partMetadata,
              });
              break;
            }
          }
        }

        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning_text: reasoningText,
          reasoning_opaque: reasoningOpaque,
          ...CACHE_CONTROL,
          ...metadata,
        });

        break;
      }

      case 'tool': {
        for (const toolResponse of content) {
          const output = toolResponse.output;

          let contentValue: string;
          switch (output.type) {
            case 'text':
            case 'error-text':
              contentValue = output.value;
              break;
            case 'content':
            case 'json':
            case 'error-json':
              contentValue = JSON.stringify(output.value);
              break;
          }

          const toolResponseMetadata = getOpenAIMetadata(toolResponse);
          messages.push({
            role: 'tool',
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
            ...CACHE_CONTROL,
            ...toolResponseMetadata,
          });
        }
        break;
      }

      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }

  return messages;
}
