Payment = Struct.new(:id, :amount, :currency, :customer_id, keyword_init: true)

class PaymentError < StandardError
  attr_reader :code

  def initialize(code:, message:)
    @code = code
    super(message)
  end
end
