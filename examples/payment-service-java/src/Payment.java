package com.example.payment;

public record Payment(
    String id,
    double amount,
    String currency,
    String customerId
) {}
