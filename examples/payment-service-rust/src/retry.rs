use std::time::Duration;
use tokio::time::sleep;

pub struct RetryConfig {
    pub max_attempts: u32,
    pub delay: Duration,
}

pub async fn with_retry<F, Fut, T, E>(config: &RetryConfig, mut f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Debug,
{
    let mut attempts = 0;
    let mut last_err = None;

    loop {
        match f().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                last_err = Some(e);
                attempts += 1;

                if attempts >= config.max_attempts {
                    break;
                }

                if attempts < config.max_attempts {
                    sleep(config.delay).await;
                }
            }
        }
    }

    Err(last_err.expect("loop exited without error"))
}
