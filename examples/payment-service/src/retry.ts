import { err } from "./result.js";
import type { Result } from "./result.js";
import type { PaymentError } from "./types.js";

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
}

export async function withRetry(
  fn: () => Promise<Result<string, PaymentError>>,
  config: RetryConfig,
): Promise<Result<string, PaymentError>> {
  let attempts = 0;
  while (attempts < config.maxAttempts) {
    const result = await fn();
    if (result.ok) return result;
    attempts++;
    if (attempts < config.maxAttempts) {
      await delay(config.delayMs);
    }
  }
  return err({ code: "timeout", message: `Payment failed after ${config.maxAttempts} attempts` });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
