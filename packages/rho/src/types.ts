// Shapes observed in the Rho public API (docs.rho.co, v1) and its sandbox.
// Monetary amounts are integers in the smallest currency unit (cents).
export interface Money { amount: number; currency: string }

export interface Account {
  id: string;
  account_name: string;
  account_type: string; // checking | credit | ...
  balance: Money;
  account_number_last_4?: string;
}

export interface BillLine {
  id: string;
  index: number;
  description?: string;
  amount: Money;
}

export interface Bill {
  id: string;
  status: string; // draft | awaiting_approval | ready_for_payment | scheduled | pending_payment | failed_payment | missing_payment_details | paid | archived | other
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  payment_date?: string;
  amount?: Money;
  counterparty?: { id: string };
  lines?: BillLine[];
  memo?: string;
  created_at: string;
  updated_at?: string;
}

export interface PaymentMethod {
  id: string;
  type: string; // ach | wire | check | international | single_use_card | vendor_card
  description?: string;
  is_default?: boolean;
  currency?: string;
}

export interface Counterparty {
  id: string;
  legal_name: string;
  nickname?: string;
  status: string; // active | invited | incomplete | archived
  payment_methods: PaymentMethod[];
  w9_status?: string; // complete | complete_externally | sent_pending | (absent)
  is_business?: boolean;
  memo?: string;
  registration_country_code?: string;
  address?: { country_code?: string; [k: string]: unknown };
}

export interface ScheduledTransaction {
  id: string;
  amount: Money;
  bill: { id: string } | null;
  counterparty: { id: string; name: string };
  payment_type: string;
  source_account: { id: string };
  schedule: {
    frequency: string; // one_time | weekly | monthly | ...
    next_release_date: string | null;
    failed: boolean;
    end_condition: { type: string; end_date: string | null; occurrence_count: number | null };
  };
}

export interface Invoice {
  id: string;
  status?: string;
  due_date?: string;
  amount_due?: Money;
  total?: Money;
  [k: string]: unknown;
}

export interface RhoSnapshot {
  fetched_at: string;
  source: string;
  accounts: Account[];
  bills: Bill[];
  counterparties: Counterparty[];
  scheduled_transactions: ScheduledTransaction[];
  invoices: Invoice[];
}
