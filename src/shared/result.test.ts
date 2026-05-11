import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, type Result } from "./result";

describe("Result", () => {
  it("ok() wraps a value in a successful Result", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("err() wraps an error in a failed Result", () => {
    const result = err("boom");
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("isOk narrows the type to Ok<T>", () => {
    const result: Result<number, string> = ok(1);
    if (isOk(result)) {
      // Within this branch, TypeScript knows result.value exists.
      expect(result.value).toBe(1);
    } else {
      throw new Error("expected ok");
    }
  });

  it("isErr narrows the type to Err<E>", () => {
    const result: Result<number, string> = err("nope");
    if (isErr(result)) {
      expect(result.error).toBe("nope");
    } else {
      throw new Error("expected err");
    }
  });
});
