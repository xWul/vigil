import { describe, expect, it } from "vitest";

import { detectLanguage, isTestFile } from "./language.js";

describe("detectLanguage", () => {
  it.each([
    ["src/foo.ts", "typescript"],
    ["src/foo.tsx", "typescript"],
    ["src/foo.js", "typescript"],
    ["src/foo.jsx", "typescript"],
    ["src/foo.mts", "typescript"],
    ["src/foo.cts", "typescript"],
    ["src/foo.mjs", "typescript"],
    ["src/foo.cjs", "typescript"],
    ["src/foo.py", "python"],
    ["com/example/Foo.java", "java"],
    ["src/Foo.cs", "csharp"],
    ["pkg/foo.go", "go"],
    ["lib/foo.rb", "ruby"],
    ["src/Foo.kt", "kotlin"],
    ["src/Foo.kts", "kotlin"],
    ["src/lib.rs", "rust"],
  ] as const)("detects %s as %s", (path, expected) => {
    expect(detectLanguage(path)).toBe(expected);
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguage("config.yaml")).toBeNull();
    expect(detectLanguage("Makefile")).toBeNull();
    expect(detectLanguage("src/foo.xml")).toBeNull();
    expect(detectLanguage("noextension")).toBeNull();
  });
});

describe("isTestFile", () => {
  it.each([
    // TypeScript / JavaScript
    ["src/foo.test.ts", true],
    ["src/foo.spec.ts", true],
    ["src/foo.test.tsx", true],
    ["src/foo.test.js", true],
    ["src/foo.spec.js", true],
    ["src/foo.ts", false],
    ["src/index.ts", false],

    // Java
    ["com/example/FooTest.java", true],
    ["com/example/FooTests.java", true],
    ["com/example/FooSpec.java", true],
    ["com/example/Foo.java", false],
    ["com/example/TestFoo.java", false],

    // Python
    ["tests/test_foo.py", true],
    ["src/foo_test.py", true],
    ["test_bar.py", true],
    ["src/foo.py", false],
    ["src/conftest.py", false],

    // C#
    ["Tests/FooTests.cs", true],
    ["Tests/FooTest.cs", true],
    ["Tests/FooSpec.cs", true],
    ["Foo.cs", false],

    // Go
    ["pkg/foo_test.go", true],
    ["pkg/foo.go", false],

    // Ruby
    ["spec/foo_spec.rb", true],
    ["test/foo_test.rb", true],
    ["lib/foo.rb", false],

    // Kotlin
    ["FooTest.kt", true],
    ["FooTests.kt", true],
    ["FooSpec.kt", true],
    ["Foo.kt", false],
  ] as const)("%s → %s", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it("returns false for unrecognised language files", () => {
    expect(isTestFile("config.yaml")).toBe(false);
    expect(isTestFile("Makefile")).toBe(false);
  });
});
