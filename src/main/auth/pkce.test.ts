import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { deriveChallenge, generatePkce, generateVerifier } from "./pkce.js";

describe("generateVerifier", () => {
  it("produces a 43-character base64url string", () => {
    const verifier = generateVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("produces unique values on each call", () => {
    const a = generateVerifier();
    const b = generateVerifier();
    expect(a).not.toBe(b);
  });
});

describe("deriveChallenge", () => {
  it("produces the S256 challenge for a known verifier", () => {
    // RFC 7636 Appendix B test vector
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url");
    expect(deriveChallenge(verifier)).toBe(expected);
  });

  it("produces only base64url characters", () => {
    const challenge = deriveChallenge(generateVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("produces a 43-character string for a SHA-256 digest", () => {
    // SHA-256 → 32 bytes → 43 base64url chars (no padding)
    const challenge = deriveChallenge(generateVerifier());
    expect(challenge).toHaveLength(43);
  });
});

describe("generatePkce", () => {
  it("returns a verifier and challenge that form a valid S256 pair", () => {
    const { verifier, challenge } = generatePkce();
    expect(deriveChallenge(verifier)).toBe(challenge);
  });

  it("produces unique pairs on each call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("verifier meets RFC 7636 length constraints (43–128 chars)", () => {
    const { verifier } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});
