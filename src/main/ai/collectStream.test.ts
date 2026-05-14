import { describe, expect, it } from "vitest";

import { collectStream } from "./collectStream.js";

function fromArray(chunks: string[]): AsyncIterable<string> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

describe("collectStream", () => {
  it("joins all chunks into a single string", async () => {
    const result = await collectStream(fromArray(["hello", " ", "world"]));
    expect(result).toBe("hello world");
  });

  it("returns empty string for empty iterable", async () => {
    const result = await collectStream(fromArray([]));
    expect(result).toBe("");
  });

  it("handles a single chunk", async () => {
    const result = await collectStream(fromArray(["only"]));
    expect(result).toBe("only");
  });
});
