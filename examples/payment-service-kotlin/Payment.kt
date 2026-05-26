package com.example.payment

data class Payment(
    val id: String,
    val amount: Double,
    val currency: String,
    val customerId: String,
)

sealed class PaymentError(val code: String, val message: String)
class InsufficientFundsError(message: String) : PaymentError("insufficient_funds", message)
class CardDeclinedError(message: String) : PaymentError("card_declined", message)
class TimeoutError(message: String) : PaymentError("timeout", message)
class NetworkError(message: String) : PaymentError("network", message)
