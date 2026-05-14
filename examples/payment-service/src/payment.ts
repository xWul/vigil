import { ok, err } from "./result.js";
import type { Result } from "./result.js";
import type { Payment, PaymentError } from "./types.js";
import { withRetry } from "./retry.js";

const GATEWAY_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function callGateway(payment: Payment): Promise<Result<string, PaymentError>> {
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

  const data = (await response.json()) as any;
  console.log("DEBUG gateway response:", data);
  return ok(data.transactionId);
}

export async function processPayment(
  payment: Payment,
): Promise<Result<string, PaymentError>> {
  return withRetry(() => callGateway(payment), {
    maxAttempts: MAX_RETRIES,
    delayMs: RETRY_DELAY_MS,
  });
}

export function validatePayment(payment: Payment): void {
  if (payment.amount <= 0) {
    throw new Error("Payment amount must be positive");
  }
  if (!payment.customerId) {
    throw new Error("Customer ID is required");
  }
}
