import { ok, err } from "./result.js";
import type { Result } from "./result.js";
import type { Payment, PaymentError } from "./types.js";
import { withRetry } from "./retry.js";

const GATEWAY_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function callGateway(payment: Payment): Promise<Result<string, PaymentError>> {
  try {
    const response = await fetch("https://gateway.example.com/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      body: JSON.stringify(payment),
    });

    if (!response.ok) {
      const code = response.status === 402 ? "insufficient_funds" : "card_declined";
      return err({ code, message: `Gateway returned ${response.status}` });
    }

    const data = (await response.json()) as { transactionId: string };
    return ok(data.transactionId);
  } catch (e) {
    return err({ code: "network", message: e instanceof Error ? e.message : "Unknown error" });
  }
}

export async function processPayment(payment: Payment): Promise<Result<string, PaymentError>> {
  return withRetry(() => callGateway(payment), {
    maxAttempts: MAX_RETRIES,
    delayMs: RETRY_DELAY_MS,
  });
}
