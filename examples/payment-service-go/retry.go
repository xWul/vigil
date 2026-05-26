package payment

import (
	"fmt"
	"time"
)

type RetryConfig struct {
	MaxAttempts int
	Delay       time.Duration
}

func WithRetry(fn func() (string, error), cfg RetryConfig) (string, error) {
	var lastErr error

	for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
		result, err := fn()
		if err == nil {
			return result, nil
		}

		lastErr = err

		if attempt < cfg.MaxAttempts-1 {
			time.Sleep(cfg.Delay)
		}
	}

	return "", fmt.Errorf("payment failed after %d attempts: %w", cfg.MaxAttempts, lastErr)
}
