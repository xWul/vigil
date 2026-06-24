require_relative "types"

class RetryHelper
  def initialize(max_attempts:, delay_ms:)
    @max_attempts = max_attempts
    @delay_s = delay_ms / 1000.0
  end

  def execute(&block)
    attempts = 0
    last_error = nil

    while attempts < @max_attempts
      begin
        return yield
      rescue PaymentError => e
        last_error = e
        attempts += 1
        sleep(@delay_s) if attempts < @max_attempts
      rescue StandardError => e
        last_error = e
        attempts += 1
        sleep(@delay_s) if attempts < @max_attempts
      end
    end

    raise last_error || RuntimeError.new("Payment failed after #{@max_attempts} attempts")
  end
end
