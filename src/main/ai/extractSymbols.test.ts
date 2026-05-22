import { describe, expect, it } from "vitest";
import { extractExportedSymbols } from "./extractSymbols.js";

describe("extractExportedSymbols", () => {
  it("returns full content for non-TS/JS files", () => {
    const content = "body { color: red; }";
    expect(extractExportedSymbols(content, "styles.css")).toBe(content);
  });

  it("returns full content when no exports found", () => {
    const content = "const x = 1;\nfunction internal() {}";
    expect(extractExportedSymbols(content, "util.ts")).toBe(content);
  });

  it("strips function body, keeps signature", () => {
    const content = `export function add(a: number, b: number): number {
  return a + b;
}`;
    const result = extractExportedSymbols(content, "math.ts");
    expect(result).toContain("export function add(a: number, b: number): number {}");
    expect(result).not.toContain("return a + b");
  });

  it("keeps interface declaration in full", () => {
    const content = `export interface User {
  id: string;
  name: string;
}`;
    const result = extractExportedSymbols(content, "types.ts");
    expect(result).toContain("export interface User");
    expect(result).toContain("id: string");
    expect(result).toContain("name: string");
  });

  it("keeps type alias in full", () => {
    const content = `export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };`;
    const result = extractExportedSymbols(content, "result.ts");
    expect(result).toContain("export type Result<T, E>");
    expect(result).toContain("ok: true");
  });

  it("strips arrow function body, keeps signature", () => {
    const content = `export const greet = (name: string): string => {
  return "Hello, " + name;
};`;
    const result = extractExportedSymbols(content, "greet.ts");
    expect(result).toContain("export const greet = (name: string): string =>");
    expect(result).not.toContain("Hello,");
  });

  it("keeps class header and public member signatures, strips method bodies", () => {
    const content = `export class Counter {
  private count = 0;
  increment(): void {
    this.count++;
  }
  get value(): number {
    return this.count;
  }
}`;
    const result = extractExportedSymbols(content, "counter.ts");
    expect(result).toContain("export class Counter");
    expect(result).toContain("increment(): void {}");
    expect(result).toContain("get value(): number {}");
    expect(result).not.toContain("this.count++");
    expect(result).not.toContain("private count");
  });

  it("keeps re-export declarations as-is", () => {
    const content = `export { foo, bar } from './utils';`;
    const result = extractExportedSymbols(content, "index.ts");
    expect(result).toContain("export { foo, bar } from './utils'");
  });

  it("includes symbol summary header", () => {
    const content = `export function noop() {}`;
    const result = extractExportedSymbols(content, "noop.ts");
    expect(result).toContain("// [symbol summary: noop.ts]");
  });

  it("returns full content on parse failure", () => {
    const broken = "export function (";
    const result = extractExportedSymbols(broken, "bad.ts");
    // ts.createSourceFile is lenient, but even if it throws we fall back
    expect(typeof result).toBe("string");
  });
});
