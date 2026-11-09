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

export type VoiceState =
  | 'INITIALIZING'
  | 'LISTENING'
  | 'SPEECH_DETECTED'
  | 'PROCESSING'
  | 'ASSISTANT_SPEAKING'
  | 'WAITING_FOR_USER'
  | 'ERROR'
  | 'PAUSED';

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
  } | null;
  idempotencyKey?: string | null;
  paymentMethod: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  isBuyerApproved?: boolean;
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

export interface AccountSummary {
  accountNumber: string;
  accountHolder: string;
  balance: number;
  currency: string;
  label: string;
  totalSpent: number;
  spentThisWeek: number;
  spentThisMonth: number;
  recentTransactions: Transaction[];
  lastTransaction: Transaction | null;
}

export interface PayPalStatus {
  isLiveSandbox: boolean;
  environment: string;
  note: string;
}

export type AccessibilityTheme = 'dark-emerald' | 'yellow-black' | 'high-contrast-light';
export type TextScale = 'normal' | 'large' | 'xl';

export type ActivityStage =
  | 'SPEECH_INPUT'
  | 'AI_PROCESSING'
  | 'BACKEND_PROCESSING'
  | 'PAYPAL_SANDBOX'
  | 'RESPONSE';

export type ActivityStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface ActivityEvent {
  eventId: string;
  timestamp: string;
  stage: ActivityStage;
  service: string;
  eventType: string;
  message: string;
  status: ActivityStatus;
  duration?: number;
  correlationId?: string;
  sanitizedMetadata?: Record<string, any>;
}
