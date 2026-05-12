import { createHash, randomBytes } from "node:crypto";

/**
 * A PKCE verifier/challenge pair per RFC 7636.
 * The verifier is kept secret; the challenge is sent to the authorization server.
 */
export interface PkcePair {
  verifier: string; // base64url-encoded, 43 chars (32 random bytes)
  challenge: string; // base64url(sha256(verifier)) — S256 method
}

/** Generates a cryptographically random PKCE verifier (43 base64url chars). */
export function generateVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derives the S256 PKCE challenge from an existing verifier. */
export function deriveChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Generates a fresh PKCE verifier/challenge pair. */
export function generatePkce(): PkcePair {
  const verifier = generateVerifier();
  return { verifier, challenge: deriveChallenge(verifier) };
}
