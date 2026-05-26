package com.example.payment;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class PaymentService {
    private static final String GATEWAY_URL = "https://gateway.example.com/charge";
    private static final Duration GATEWAY_TIMEOUT = Duration.ofSeconds(30);
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 100;

    private final HttpClient httpClient;
    private final RetryHelper retryHelper;

    public PaymentService() {
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(GATEWAY_TIMEOUT)
            .build();
        this.retryHelper = new RetryHelper(MAX_RETRIES, RETRY_DELAY_MS);
    }

    private String callGateway(Payment payment) throws IOException, InterruptedException {
        String body = String.format(
            "{\"id\":\"%s\",\"amount\":%.2f,\"currency\":\"%s\",\"customerId\":\"%s\"}",
            payment.id(), payment.amount(), payment.currency(), payment.customerId()
        );

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(GATEWAY_URL))
            .header("Content-Type", "application/json")
            .timeout(GATEWAY_TIMEOUT)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        HttpResponse<String> response = httpClient.send(
            request, HttpResponse.BodyHandlers.ofString()
        );

        System.out.println("DEBUG: response " + response.body());

        if (response.statusCode() != 200) {
            String code = response.statusCode() == 402 ? "insufficient_funds" : "card_declined";
            throw new IOException("Gateway returned " + response.statusCode() + " (" + code + ")");
        }

        return response.body();
    }

    public String processPayment(Payment payment) throws Exception {
        return retryHelper.execute(() -> callGateway(payment));
    }

    public void validatePayment(Payment payment) {
        if (payment.amount() <= 0) {
            throw new IllegalArgumentException("Payment amount must be positive");
        }
        if (payment.customerId() == null || payment.customerId().isBlank()) {
            throw new IllegalArgumentException("Customer ID is required");
        }
    }
}
