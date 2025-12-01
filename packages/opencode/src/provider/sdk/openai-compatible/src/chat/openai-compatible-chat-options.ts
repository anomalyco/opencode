import { z } from 'zod/v4';

export type OpenAICompatibleChatModelId = string;

export const openaiCompatibleProviderOptions = z.object({
  /**
   * A unique identifier representing your end-user, which can help the provider to
   * monitor and detect abuse.
   */
  user: z.string().optional(),

  /**
   * Reasoning effort for reasoning models. Defaults to `medium`.
   */
  reasoningEffort: z.string().optional(),
});

export type OpenAICompatibleProviderOptions = z.infer<
  typeof openaiCompatibleProviderOptions
>;
