from dataclasses import dataclass
from typing import Literal, Union


@dataclass
class Payment:
    id: str
    amount: float
    currency: str
    customer_id: str


@dataclass
class InsufficientFundsError:
    code: Literal["insufficient_funds"]
    message: str


@dataclass
class CardDeclinedError:
    code: Literal["card_declined"]
    message: str


@dataclass
class TimeoutError:
    code: Literal["timeout"]
    message: str


@dataclass
class NetworkError:
    code: Literal["network"]
    message: str


PaymentError = Union[InsufficientFundsError, CardDeclinedError, TimeoutError, NetworkError]
