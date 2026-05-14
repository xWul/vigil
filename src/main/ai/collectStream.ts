export async function collectStream(iterable: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
