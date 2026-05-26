use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: String,
    pub amount: f64,
    pub currency: String,
    pub customer_id: String,
}

#[derive(Debug, Clone)]
pub enum PaymentError {
    InsufficientFunds { message: String },
    CardDeclined { message: String },
    Timeout { message: String },
    Network { message: String },
}

impl std::fmt::Display for PaymentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentError::InsufficientFunds { message } => write!(f, "insufficient_funds: {}", message),
            PaymentError::CardDeclined { message } => write!(f, "card_declined: {}", message),
            PaymentError::Timeout { message } => write!(f, "timeout: {}", message),
            PaymentError::Network { message } => write!(f, "network: {}", message),
        }
    }
}

impl std::error::Error for PaymentError {}
