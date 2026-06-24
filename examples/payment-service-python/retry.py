import asyncio
from typing import Callable, TypeVar

from types import PaymentError

T = TypeVar("T")


async def with_retry(
    fn: Callable[[], T],
    max_attempts: int,
    delay_ms: int,
) -> T | PaymentError:
    attempts = 0
    last_error: PaymentError | None = None

    while attempts < max_attempts:
        try:
            result = await fn()
            if hasattr(result, "code"):
                last_error = result
                attempts += 1
                if attempts < max_attempts:
                    await asyncio.sleep(delay_ms / 1000)
            else:
                return result
        except Exception as e:
            last_error = PaymentError  # type: ignore
            attempts += 1
            if attempts < max_attempts:
                await asyncio.sleep(delay_ms / 1000)

    if last_error is not None:
        return last_error

    raise RuntimeError(f"Payment failed after {max_attempts} attempts")
