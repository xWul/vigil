mod payment;
mod retry;
mod types;

use types::Payment;

#[tokio::main]
async fn main() {
    let p = Payment {
        id: "pay_001".to_string(),
        amount: 49.99,
        currency: "USD".to_string(),
        customer_id: "cust_abc".to_string(),
    };

    match payment::process_payment(&p).await {
        Ok(tx_id) => println!("Payment succeeded: {tx_id}"),
        Err(e) => eprintln!("Payment failed: {e}"),
    }
}
