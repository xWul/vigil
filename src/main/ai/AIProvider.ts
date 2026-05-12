export interface AIMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AIRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly AIMessage[];
  readonly maxTokens: number;
}

export interface AIProvider {
  readonly id: "anthropic" | "openai";
  stream(request: AIRequest): AsyncIterable<string>;
}
