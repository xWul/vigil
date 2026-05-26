package payment

type Payment struct {
	ID         string  `json:"id"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	CustomerID string  `json:"customerId"`
}

type PaymentError struct {
	Code    string
	Message string
}

func (e *PaymentError) Error() string {
	return e.Message
}
