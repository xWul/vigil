package com.example.payment

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

private const val GATEWAY_URL = "https://gateway.example.com/charge"
private val GATEWAY_TIMEOUT = Duration.ofSeconds(30)
private const val MAX_RETRIES = 3
private const val RETRY_DELAY_MS = 100L

class PaymentService {
    private val httpClient = HttpClient.newBuilder()
        .connectTimeout(GATEWAY_TIMEOUT)
        .build()

    private suspend fun callGateway(payment: Payment): String {
        val body = """{"id":"${payment.id}","amount":${payment.amount},"currency":"${payment.currency}","customerId":"${payment.customerId}"}"""

        val request = HttpRequest.newBuilder()
            .uri(URI.create(GATEWAY_URL))
            .header("Content-Type", "application/json")
            .timeout(GATEWAY_TIMEOUT)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        System.out.println("DEBUG: ${response.body()}")

        if (response.statusCode() != 200) {
            val code = if (response.statusCode() == 402) "insufficient_funds" else "card_declined"
            throw PaymentError("$code: Gateway returned ${response.statusCode()}")
        }

        return response.body()
    }

    suspend fun processPayment(payment: Payment): String {
        val config = RetryConfig(maxAttempts = MAX_RETRIES, delayMs = RETRY_DELAY_MS)
        return withRetry(config) { callGateway(payment) }
    }

    fun validatePayment(payment: Payment) {
        require(payment.amount > 0) { "Payment amount must be positive" }
        require(payment.customerId.isNotBlank()) { "Customer ID is required" }
    }
}
