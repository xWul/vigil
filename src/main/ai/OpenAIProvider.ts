import OpenAI from "openai";

import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AIProvider, AIRequest } from "./AIProvider.js";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly logger: Logger = new NoopLogger(),
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async *stream(request: AIRequest): AsyncIterable<string> {
    this.logger.info("openai.stream.start", { model: request.model, maxTokens: request.maxTokens });
    const start = Date.now();

    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        { role: "system", content: request.system },
        ...request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      max_tokens: request.maxTokens,
      stream: true,
    });

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
      this.logger.info("openai.stream.complete", {
        model: request.model,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      this.logger.error("openai.stream.error", {
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

export function createOpenAIProvider(apiKey: string, logger?: Logger): OpenAIProvider {
  return new OpenAIProvider(apiKey, logger);
}
