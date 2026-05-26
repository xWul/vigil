package payment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	gatewayURL     = "https://gateway.example.com/charge"
	gatewayTimeout = 30 * time.Second
	maxRetries     = 3
	retryDelay     = 100 * time.Millisecond
)

var httpClient = &http.Client{Timeout: gatewayTimeout}

func callGateway(p *Payment) (string, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("marshal payment: %w", err)
	}

	resp, err := httpClient.Post(gatewayURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return "", &PaymentError{Code: "network", Message: err.Error()}
	}
	defer resp.Body.Close()

	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	fmt.Println("DEBUG gateway response:", data)

	if resp.StatusCode != http.StatusOK {
		code := "card_declined"
		if resp.StatusCode == http.StatusPaymentRequired {
			code = "insufficient_funds"
		}
		return "", &PaymentError{Code: code, Message: fmt.Sprintf("gateway returned %d", resp.StatusCode)}
	}

	txID, ok := data["transactionId"].(string)
	if !ok {
		return "", fmt.Errorf("missing transactionId in response")
	}
	return txID, nil
}

func ProcessPayment(p *Payment) (string, error) {
	return WithRetry(func() (string, error) {
		return callGateway(p)
	}, RetryConfig{MaxAttempts: maxRetries, Delay: retryDelay})
}

func ValidatePayment(p *Payment) error {
	if p.Amount <= 0 {
		return fmt.Errorf("payment amount must be positive")
	}
	if p.CustomerID == "" {
		return fmt.Errorf("customer ID is required")
	}
	return nil
}
