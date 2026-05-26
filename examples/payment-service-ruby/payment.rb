require "net/http"
require "json"
require_relative "types"
require_relative "retry"

GATEWAY_URL = URI("https://gateway.example.com/charge")
GATEWAY_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_DELAY_MS = 100

def call_gateway(payment)
  http = Net::HTTP.new(GATEWAY_URL.host, GATEWAY_URL.port)
  http.use_ssl = true
  http.read_timeout = GATEWAY_TIMEOUT

  body = JSON.generate(
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    customerId: payment.customer_id
  )

  request = Net::HTTP::Post.new(GATEWAY_URL.path, "Content-Type" => "application/json")
  request.body = body

  response = http.request(request)
  data = JSON.parse(response.body)

  unless response.is_a?(Net::HTTPSuccess)
    code = response.code == "402" ? "insufficient_funds" : "card_declined"
    raise PaymentError.new(code: code, message: "Gateway returned #{response.code}")
  end

  data["transactionId"]
end

def process_payment(payment)
  retry_helper = RetryHelper.new(max_attempts: MAX_RETRIES, delay_ms: RETRY_DELAY_MS)
  retry_helper.execute { call_gateway(payment) }
end

def validate_payment(payment)
  if payment.amount <= 0
    raise ArgumentError, "Payment amount must be positive"
  end

  if payment.customer_id.nil? || payment.customer_id.strip.empty?
    raise ArgumentError, "Customer ID is required"
  end

  unless %w[USD EUR GBP].include?(payment.currency)
    raise ArgumentError, "Unsupported currency: #{payment.currency}"
  end

  if payment.amount > 10_000
    raise ArgumentError, "Amount exceeds single-transaction limit"
  end

  true
end
