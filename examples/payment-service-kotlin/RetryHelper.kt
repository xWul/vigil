package com.example.payment

import kotlinx.coroutines.delay

data class RetryConfig(val maxAttempts: Int, val delayMs: Long)

suspend fun <T> withRetry(config: RetryConfig, fn: suspend () -> T): T {
    var attempts = 0
    var lastException: Exception? = null

    while (attempts < config.maxAttempts) {
        try {
            return fn()
        } catch (e: Exception) {
            lastException = e
            attempts++
            if (attempts < config.maxAttempts) {
                delay(config.delayMs)
            }
        }
    }

    throw RuntimeException("Payment failed after ${config.maxAttempts} attempts", lastException)
}
