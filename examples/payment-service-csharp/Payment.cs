namespace PaymentService;

public record Payment(string Id, decimal Amount, string Currency, string CustomerId);

public abstract record PaymentError(string Code, string Message);
public record InsufficientFundsError(string Message) : PaymentError("insufficient_funds", Message);
public record CardDeclinedError(string Message) : PaymentError("card_declined", Message);
public record TimeoutError(string Message) : PaymentError("timeout", Message);
public record NetworkError(string Message) : PaymentError("network", Message);
