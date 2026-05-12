import Anthropic from "@anthropic-ai/sdk";

import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AIProvider, AIRequest } from "./AIProvider.js";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly logger: Logger = new NoopLogger(),
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *stream(request: AIRequest): AsyncIterable<string> {
    this.logger.info("anthropic.stream.start", {
      model: request.model,
      maxTokens: request.maxTokens,
    });
    const start = Date.now();

    const stream = this.client.messages.stream({
      model: request.model,
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: request.maxTokens,
    });

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      this.logger.info("anthropic.stream.complete", {
        model: request.model,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      this.logger.error("anthropic.stream.error", {
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

export function createAnthropicProvider(apiKey: string, logger?: Logger): AnthropicProvider {
  return new AnthropicProvider(apiKey, logger);
}
