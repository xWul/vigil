import json
from urllib import request, error

from types import Payment, PaymentError, TimeoutError, NetworkError
from retry import with_retry

GATEWAY_URL = "https://gateway.example.com/charge"
GATEWAY_TIMEOUT_S = 30
MAX_RETRIES = 3
RETRY_DELAY_MS = 100


async def call_gateway(payment: Payment) -> str | PaymentError:
    payload = json.dumps(
        {
            "id": payment.id,
            "amount": payment.amount,
            "currency": payment.currency,
            "customerId": payment.customer_id,
        }
    ).encode()

    req = request.Request(
        GATEWAY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=GATEWAY_TIMEOUT_S) as response:
            data = json.loads(response.read())
            print("DEBUG gateway response:", data)
            return data["transactionId"]
    except error.HTTPError as e:
        code = "insufficient_funds" if e.code == 402 else "card_declined"
        return PaymentError(code=code, message=f"Gateway returned {e.code}")  # type: ignore
    except TimeoutError:
        return TimeoutError(code="timeout", message="Gateway timed out")
    except OSError as e:
        return NetworkError(code="network", message=str(e))


async def process_payment(payment: Payment) -> str | PaymentError:
    return await with_retry(
        lambda: call_gateway(payment),
        max_attempts=MAX_RETRIES,
        delay_ms=RETRY_DELAY_MS,
    )


def validate_payment(payment: Payment) -> None:
    if payment.amount <= 0:
        raise ValueError("Payment amount must be positive")
    if not payment.customer_id:
        raise ValueError("Customer ID is required")
