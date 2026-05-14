export interface Payment {
  id: string;
  amount: number;
  currency: string;
  customerId: string;
}

export type PaymentError =
  | { code: "insufficient_funds"; message: string }
  | { code: "card_declined"; message: string }
  | { code: "timeout"; message: string }
  | { code: "network"; message: string };
