import fs from 'fs';
import path from 'path';

export type ConversationStage =
  | 'IDLE'
  | 'AWAITING_DETAILS_CONFIRMATION'
  | 'AWAITING_CORRECTION_OR_APPROVAL'
  | 'AWAITING_AUTHORIZATION'
  | 'AUTHORIZED_PENDING_FINGERPRINT'
  | 'FINGERPRINT_VERIFIED'
  | 'AWAITING_PAYPAL_APPROVAL'
  | 'PAYPAL_ORDER_APPROVED'
  | 'PROCESSING'
  | 'COMPLETED';

export interface Transaction {
  id: string;
  type: 'debit' | 'credit';
  amount: number;
  currency: string;
  recipient: string;
  purpose: string;
  status: 'draft' | 'awaiting_authorization' | 'authorized' | 'processing' | 'completed' | 'cancelled' | 'failed';
  conversationStage?: ConversationStage;
  authorizationToken: string | null;
  authorizedDetails?: {
    amount: number;
    currency: string;
    recipient: string;
    purpose: string;
    draftVersion?: number;
  } | null;
  draftVersion?: number;
  idempotencyKey?: string | null;
  paymentMethod: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  isBuyerApproved?: boolean;
  isDemoMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  category: string;
  amount: number;
  notes?: string;
}

export interface BudgetPlan {
  id: string;
  allocations: BudgetCategory[];
  totalAllocated: number;
  availableBalance: number;
  shortfall: number;
  unallocated: number;
  status: 'draft' | 'saved';
  lastUpdated: string;
}

export interface StoreData {
  account: {
    accountNumber: string;
    accountHolder: string;
    balance: number;
    currency: string;
    label: string;
  };
  activeDraft: Transaction | null;
  transactions: Transaction[];
  budget: BudgetPlan;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'pal_store.json');

const INITIAL_DATA: StoreData = {
  account: {
    accountNumber: 'PAL-DEMO-98214',
    accountHolder: 'Jordan Taylor (Demo Account)',
    balance: 650.00,
    currency: 'USD',
    label: 'A-Eye Pal Demo Balance (Not Real Money)'
  },
  activeDraft: null,
  transactions: [
    {
      id: 'tx-init-1',
      type: 'debit',
      amount: 45.00,
      currency: 'USD',
      recipient: 'Metro Transit System',
      purpose: 'Monthly transit pass',
      status: 'completed',
      authorizationToken: 'auth-demo-001',
      paymentMethod: 'PayPal Sandbox',
      paypalOrderId: 'SANDBOX-ORDER-99120',
      paypalCaptureId: 'SANDBOX-CAP-1102',
      isDemoMode: true,
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 3 * 86400000).toISOString()
    },
    {
      id: 'tx-init-2',
      type: 'debit',
      amount: 82.50,
      currency: 'USD',
      recipient: 'City Power & Electric',
      purpose: 'Electricity utility bill',
      status: 'completed',
      authorizationToken: 'auth-demo-002',
      paymentMethod: 'PayPal Sandbox',
      paypalOrderId: 'SANDBOX-ORDER-99121',
      paypalCaptureId: 'SANDBOX-CAP-1103',
      isDemoMode: true,
      createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 6 * 86400000).toISOString()
    },
    {
      id: 'tx-init-3',
      type: 'credit',
      amount: 300.00,
      currency: 'USD',
      recipient: 'Direct Deposit',
      purpose: 'Freelance audio consultation',
      status: 'completed',
      authorizationToken: null,
      paymentMethod: 'Bank Transfer',
      paypalOrderId: null,
      paypalCaptureId: null,
      isDemoMode: true,
      createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 86400000).toISOString()
    }
  ],
  budget: {
    id: 'budget-active-1',
    allocations: [
      { id: 'b-1', category: 'Food & Groceries', amount: 150.00 },
      { id: 'b-2', category: 'Transport', amount: 60.00 },
      { id: 'b-3', category: 'Electricity & Utilities', amount: 90.00 },
      { id: 'b-4', category: 'Emergency Savings', amount: 100.00 }
    ],
    totalAllocated: 400.00,
    availableBalance: 650.00,
    shortfall: 0,
    unallocated: 250.00,
    status: 'saved',
    lastUpdated: new Date().toISOString()
  }
};

export function getDatabase(): StoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DATA, null, 2), 'utf-8');
      return JSON.parse(JSON.stringify(INITIAL_DATA));
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading pal_store.json, using fallback:', err);
    return JSON.parse(JSON.stringify(INITIAL_DATA));
  }
}

export function saveDatabase(data: StoreData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Error saving pal_store.json:', err);
  }
}

export function resetDemoDatabase(): StoreData {
  const fresh = JSON.parse(JSON.stringify(INITIAL_DATA));
  saveDatabase(fresh);
  return fresh;
}
