use reqwest::Client;
use std::time::Duration;

use crate::retry::{with_retry, RetryConfig};
use crate::types::{Payment, PaymentError};

const GATEWAY_URL: &str = "https://gateway.example.com/charge";
const GATEWAY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_millis(100);

async fn call_gateway(client: &Client, payment: &Payment) -> Result<String, PaymentError> {
    let response = client
        .post(GATEWAY_URL)
        .json(payment)
        .timeout(GATEWAY_TIMEOUT)
        .send()
        .await
        .map_err(|e| PaymentError::Network { message: e.to_string() })?;

    let status = response.status();

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| PaymentError::Network { message: e.to_string() })?;

    match status.as_u16() {
        200 => {
            let tx_id = body["transactionId"]
                .as_str()
                .ok_or_else(|| PaymentError::Network {
                    message: "missing transactionId in response".to_string(),
                })?;
            Ok(tx_id.to_string())
        }
        402 => Err(PaymentError::InsufficientFunds {
            message: format!("gateway returned {status}"),
        }),
        _ => Err(PaymentError::CardDeclined {
            message: format!("gateway returned {status}"),
        }),
    }
}

pub async fn process_payment(payment: &Payment) -> Result<String, PaymentError> {
    let client = Client::new();
    let config = RetryConfig {
        max_attempts: MAX_RETRIES,
        delay: RETRY_DELAY,
    };

    with_retry(&config, || call_gateway(&client, payment)).await
}

pub fn validate_payment(payment: &Payment) -> Result<(), PaymentError> {
    if payment.amount <= 0.0 {
        return Err(PaymentError::Network {
            message: "payment amount must be positive".to_string(),
        });
    }
    if payment.customer_id.is_empty() {
        return Err(PaymentError::Network {
            message: "customer ID is required".to_string(),
        });
    }
    Ok(())
}
