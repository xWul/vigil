# ADR-0008: AIProvider Streaming via AsyncIterable

## Status

Accepted — 2026-05-12

## Context

The `AIProvider` interface needs to support streaming LLM responses.
Both Anthropic and OpenAI SDKs return token streams natively; buffering
to a complete string wastes time-to-first-token and makes it impossible
to show incremental output in the Phase 5 UI.

Three shapes were considered:

1. **Two methods** — `complete(request): Promise<string>` and
   `stream(request): AsyncIterable<string>`
2. **One `stream` method** — `stream(request): AsyncIterable<string>`,
   with a shared `collectStream` helper for callers that need the full
   string
3. **Callback** — `stream(request, onChunk: (s: string) => void): Promise<void>`

## Decision

One method: `stream(request: AIRequest): AsyncIterable<string>`.

A `collectStream(iterable: AsyncIterable<string>): Promise<string>`
helper is provided for callers that do not need incremental output.

The model name, system prompt, messages, and max tokens are passed via
`AIRequest`. The provider is stateless with respect to the request —
all configuration is in the request object, not the constructor.

## Considered Options

### Two methods (complete + stream)

Forces implementations to maintain two code paths. In both Anthropic
and OpenAI SDKs the non-streaming path is just `await collectStream()`
under the hood — duplicating it on every implementation adds no value.
Also means the review engine must decide at compile time whether it
wants streaming or not, rather than deciding at runtime.

Not chosen.

### Callback

`onChunk` callbacks compose poorly with `async/await` and require
manual error propagation. `AsyncIterable` integrates naturally with
`for await...of`, is cancellable via `return()`, and is the standard
Node.js pattern for async sequences.

Not chosen.

## Consequences

- All AI pass implementations use `for await (const chunk of provider.stream(req))`.
- The Phase 5 streaming UI (findings appear as passes complete) uses the
  same `AsyncIterable` directly — no interface change needed.
- `collectStream` is the only place where streaming responses are
  buffered into strings.
- `AnthropicProvider` and `OpenAIProvider` each implement one method.
  Test doubles implement the same single method.

## References

- `docs/specs/ai-review-pipeline.md` — AIProvider interface definition
- `src/main/ai/AIProvider.ts` — implementation
