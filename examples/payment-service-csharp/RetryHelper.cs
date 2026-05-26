namespace PaymentService;

public class RetryHelper
{
    private readonly int _maxAttempts;
    private readonly TimeSpan _delay;

    public RetryHelper(int maxAttempts, TimeSpan delay)
    {
        _maxAttempts = maxAttempts;
        _delay = delay;
    }

    public async Task<T> ExecuteAsync<T>(Func<Task<T>> fn)
    {
        int attempts = 0;
        Exception? lastException = null;

        while (attempts < _maxAttempts)
        {
            try
            {
                return await fn();
            }
            catch (Exception ex)
            {
                lastException = ex;
                attempts++;
                if (attempts < _maxAttempts)
                {
                    await Task.Delay(_delay);
                }
            }
        }

        throw new InvalidOperationException(
            $"Payment failed after {_maxAttempts} attempts",
            lastException
        );
    }
}
