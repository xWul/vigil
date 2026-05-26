package com.example.payment;

import java.util.concurrent.Callable;

public class RetryHelper {
    private final int maxAttempts;
    private final long delayMs;

    public RetryHelper(int maxAttempts, long delayMs) {
        this.maxAttempts = maxAttempts;
        this.delayMs = delayMs;
    }

    public <T> T execute(Callable<T> fn) throws Exception {
        int attempts = 0;
        Exception lastException = null;

        while (attempts < maxAttempts) {
            try {
                return fn.call();
            } catch (Exception e) {
                lastException = e;
                attempts++;
                if (attempts < maxAttempts) {
                    Thread.sleep(delayMs);
                }
            }
        }

        throw new RuntimeException(
            "Payment failed after " + maxAttempts + " attempts",
            lastException
        );
    }
}
