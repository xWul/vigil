namespace PaymentService;

using System.Net.Http.Json;
using System.Text.Json;

public class PaymentService
{
    private const string GatewayUrl = "https://gateway.example.com/charge";
    private const int MaxRetries = 3;
    private static readonly TimeSpan GatewayTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(100);

    private readonly HttpClient _httpClient;
    private readonly RetryHelper _retryHelper;

    public PaymentService()
    {
        _httpClient = new HttpClient { Timeout = GatewayTimeout };
        _retryHelper = new RetryHelper(MaxRetries, RetryDelay);
    }

    private async Task<string> CallGatewayAsync(Payment payment)
    {
        var response = await _httpClient.PostAsJsonAsync(GatewayUrl, new
        {
            id = payment.Id,
            amount = payment.Amount,
            currency = payment.Currency,
            customerId = payment.CustomerId,
        });

        var body = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"DEBUG: {body}");

        response.EnsureSuccessStatusCode();

        var data = JsonSerializer.Deserialize<JsonElement>(body);
        return data.GetProperty("transactionId").GetString()
            ?? throw new InvalidOperationException("Missing transactionId in response");
    }

    public Task<string> ProcessPaymentAsync(Payment payment) =>
        _retryHelper.ExecuteAsync(() => CallGatewayAsync(payment));

    public static void ValidatePayment(Payment payment)
    {
        if (payment.Amount <= 0)
            throw new ArgumentException("Payment amount must be positive", nameof(payment));

        if (string.IsNullOrWhiteSpace(payment.CustomerId))
            throw new ArgumentException("Customer ID is required", nameof(payment));
    }
}
