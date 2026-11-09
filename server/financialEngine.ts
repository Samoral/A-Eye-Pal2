import crypto from 'crypto';
import { getDatabase, saveDatabase, StoreData, Transaction, BudgetCategory, BudgetPlan } from './db.js';

export interface FinancialSummary {
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

export class FinancialEngine {
  /**
   * Returns current account balance and comprehensive spending analysis
   */
  static getFinancialSummary(): FinancialSummary {
    const db = getDatabase();
    const now = Date.now();
    const oneWeekAgo = now - 7 * 86400000;
    const thirtyDaysAgo = now - 30 * 86400000;

    const completedDebits = db.transactions.filter(
      (tx) => tx.type === 'debit' && tx.status === 'completed'
    );

    const totalSpent = completedDebits.reduce((acc, tx) => acc + tx.amount, 0);

    const spentThisWeek = completedDebits
      .filter((tx) => new Date(tx.createdAt).getTime() >= oneWeekAgo)
      .reduce((acc, tx) => acc + tx.amount, 0);

    const spentThisMonth = completedDebits
      .filter((tx) => new Date(tx.createdAt).getTime() >= thirtyDaysAgo)
      .reduce((acc, tx) => acc + tx.amount, 0);

    const sorted = [...db.transactions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
      accountNumber: db.account.accountNumber,
      accountHolder: db.account.accountHolder,
      balance: Math.round(db.account.balance * 100) / 100,
      currency: db.account.currency,
      label: db.account.label,
      totalSpent: Math.round(totalSpent * 100) / 100,
      spentThisWeek: Math.round(spentThisWeek * 100) / 100,
      spentThisMonth: Math.round(spentThisMonth * 100) / 100,
      recentTransactions: sorted.slice(0, 5),
      lastTransaction: sorted[0] || null,
    };
  }

  /**
   * Creates or updates a transaction draft
   */
  static createOrUpdateDraft(params: {
    amount?: number | null;
    recipient?: string | null;
    purpose?: string | null;
    currency?: string | null;
  }): { draft: Transaction; validationMessage: string; isComplete: boolean; isOverBalance: boolean } {
    const db = getDatabase();
    const existing = db.activeDraft;

    const currency = (params.currency || existing?.currency || db.account.currency || 'USD').toUpperCase();
    const amount = params.amount !== undefined && params.amount !== null ? Number(params.amount) : existing?.amount || 0;
    const recipient = params.recipient !== undefined && params.recipient !== null ? params.recipient.trim() : existing?.recipient || '';
    const purpose = params.purpose !== undefined && params.purpose !== null ? params.purpose.trim() : existing?.purpose || 'General payment';

    // Invalidate previous authorization on ANY creation or update
    const draft: Transaction = {
      id: existing?.id || `tx-draft-${Date.now()}`,
      type: 'debit',
      amount: Math.round(amount * 100) / 100,
      currency,
      recipient,
      purpose,
      status: 'draft',
      authorizationToken: null, // CRITICAL: Reset authorization
      paymentMethod: 'PayPal Sandbox',
      paypalOrderId: null,
      paypalCaptureId: null,
      isDemoMode: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.activeDraft = draft;
    saveDatabase(db);

    const isComplete = Boolean(draft.recipient && draft.amount > 0);
    const isOverBalance = draft.amount > db.account.balance;

    let validationMessage = '';
    if (!draft.recipient && draft.amount <= 0) {
      validationMessage = 'Please state who you would like to pay and the amount.';
    } else if (!draft.recipient) {
      validationMessage = `I have recorded an amount of $${draft.amount.toFixed(2)} ${draft.currency}. Who would you like to pay?`;
    } else if (draft.amount <= 0) {
      validationMessage = `I have set the recipient to ${draft.recipient}. How much would you like to pay?`;
    } else if (isOverBalance) {
      const diff = (draft.amount - db.account.balance).toFixed(2);
      validationMessage = `Warning: Payment of $${draft.amount.toFixed(2)} exceeds your available demo balance of $${db.account.balance.toFixed(2)} by $${diff}.`;
    } else {
      validationMessage = `Payment draft prepared: $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} for ${draft.purpose}. Previous authorizations have been cleared. Ready for your review and authorization.`;
    }

    return { draft, validationMessage, isComplete, isOverBalance };
  }

  /**
   * Modifies an existing draft, ensuring previous authorization is strictly invalidated
   */
  static modifyDraft(changes: {
    amount?: number;
    recipient?: string;
    purpose?: string;
    currency?: string;
  }): { draft: Transaction; clarificationText: string; isComplete: boolean; isOverBalance: boolean } {
    const db = getDatabase();
    if (!db.activeDraft) {
      // If no draft exists, create new draft with changes
      const created = this.createOrUpdateDraft(changes);
      return {
        draft: created.draft,
        clarificationText: created.validationMessage,
        isComplete: created.isComplete,
        isOverBalance: created.isOverBalance,
      };
    }

    const current = db.activeDraft;
    const updatedAmount = changes.amount !== undefined ? Number(changes.amount) : current.amount;
    const updatedRecipient = changes.recipient !== undefined ? changes.recipient.trim() : current.recipient;
    const updatedPurpose = changes.purpose !== undefined ? changes.purpose.trim() : current.purpose;
    const updatedCurrency = changes.currency !== undefined ? changes.currency.toUpperCase() : current.currency;

    // Invalidate previous authorization
    const updatedDraft: Transaction = {
      ...current,
      amount: Math.round(updatedAmount * 100) / 100,
      recipient: updatedRecipient,
      purpose: updatedPurpose,
      currency: updatedCurrency,
      status: 'draft',
      authorizationToken: null, // Strictly invalidated!
      authorizedDetails: null, // Strictly cleared!
      isBuyerApproved: false,
      updatedAt: new Date().toISOString(),
    };

    db.activeDraft = updatedDraft;
    saveDatabase(db);

    const isComplete = Boolean(updatedDraft.recipient && updatedDraft.amount > 0);
    const isOverBalance = updatedDraft.amount > db.account.balance;

    let clarificationText = `I have updated your payment details. You are paying $${updatedDraft.amount.toFixed(2)} ${updatedDraft.currency} to ${updatedDraft.recipient} for ${updatedDraft.purpose}. Any previous authorization has been cleared.`;
    if (isOverBalance) {
      const diff = (updatedDraft.amount - db.account.balance).toFixed(2);
      clarificationText += ` Please note, this exceeds your available demo balance of $${db.account.balance.toFixed(2)} by $${diff}.`;
    }

    return { draft: updatedDraft, clarificationText, isComplete, isOverBalance };
  }

  /**
   * Generates a complete spoken clarification of the active draft
   */
  static clarifyDraft(): {
    hasDraft: boolean;
    spokenClarification: string;
    details: {
      recipient: string;
      amount: number;
      currency: string;
      purpose: string;
      paymentMethod: string;
      status: string;
      isAuthorized: boolean;
      availableBalance: number;
    } | null;
  } {
    const db = getDatabase();
    const draft = db.activeDraft;

    if (!draft) {
      return {
        hasDraft: false,
        spokenClarification: 'You have no active payment draft. You can say: Pay 50 dollars to John.',
        details: null,
      };
    }

    const isAuthorized = Boolean(draft.authorizationToken && draft.status === 'authorized');
    const authStatus = isAuthorized ? 'Authorized and ready for checkout' : 'Pending your authorization';

    const spokenClarification =
      `Here are your transaction details: ` +
      `Recipient: ${draft.recipient || 'Not specified'}. ` +
      `Amount: $${draft.amount.toFixed(2)} ${draft.currency}. ` +
      `Purpose: ${draft.purpose}. ` +
      `Payment method: ${draft.paymentMethod}. ` +
      `Status: ${authStatus}. ` +
      `Your available balance is $${db.account.balance.toFixed(2)}. ` +
      (draft.amount > db.account.balance
        ? `Warning: this payment exceeds your balance.`
        : isAuthorized
        ? `Say "Confirm checkout" to process via PayPal Sandbox.`
        : `Say "Authorize" or use the demo fingerprint touch to confirm.`);

    return {
      hasDraft: true,
      spokenClarification,
      details: {
        recipient: draft.recipient,
        amount: draft.amount,
        currency: draft.currency,
        purpose: draft.purpose,
        paymentMethod: draft.paymentMethod,
        status: draft.status,
        isAuthorized,
        availableBalance: db.account.balance,
      },
    };
  }

  /**
   * Discards the active draft
   */
  static cancelDraft(): { success: boolean; message: string } {
    const db = getDatabase();
    if (!db.activeDraft) {
      return { success: true, message: 'There was no active transaction to cancel.' };
    }
    const cancelledTx = {
      ...db.activeDraft,
      status: 'cancelled' as const,
      updatedAt: new Date().toISOString(),
    };
    db.transactions.push(cancelledTx);
    db.activeDraft = null;
    saveDatabase(db);
    return { success: true, message: 'The payment draft has been cancelled.' };
  }

  /**
   * Authorizes the active draft via simulated fingerprint demonstration
   * Emits an authoritative token only after verifying validity and balance.
   */
  static authorizeDraftWithDemoFingerprint(): {
    success: boolean;
    authorizationToken: string | null;
    draft: Transaction | null;
    announcement: string;
    error?: string;
  } {
    const db = getDatabase();
    const draft = db.activeDraft;

    if (!draft) {
      return {
        success: false,
        authorizationToken: null,
        draft: null,
        announcement: 'No payment draft found to authorize. Please initiate a payment first.',
        error: 'NO_DRAFT',
      };
    }

    if (!draft.recipient || draft.amount <= 0) {
      return {
        success: false,
        authorizationToken: null,
        draft,
        announcement: 'Cannot authorize incomplete payment. Please ensure recipient and a positive amount are specified.',
        error: 'INCOMPLETE_DRAFT',
      };
    }

    if (draft.amount > db.account.balance) {
      const shortfall = (draft.amount - db.account.balance).toFixed(2);
      return {
        success: false,
        authorizationToken: null,
        draft,
        announcement: `Payment authorization declined. Amount of $${draft.amount.toFixed(2)} exceeds available demo balance by $${shortfall}.`,
        error: 'INSUFFICIENT_FUNDS',
      };
    }

    // Security check: Must have a valid draft in review or authorization stage
    // Mock verification is not sufficient on its own unless user has initiated and authorized the transaction
    if (draft.status === 'cancelled' || draft.status === 'completed') {
      return {
        success: false,
        authorizationToken: null,
        draft,
        announcement: 'Active payment draft is no longer in a valid authorization state.',
        error: 'INVALID_DRAFT_STATE',
      };
    }

    // Generate secure demo authorization token and bind to exact details
    const token = `DEMO-AUTH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    draft.status = 'authorized';
    draft.authorizationToken = token;
    draft.authorizedDetails = {
      amount: draft.amount,
      currency: draft.currency,
      recipient: draft.recipient,
      purpose: draft.purpose,
    };
    draft.conversationStage = 'FINGERPRINT_VERIFIED';
    draft.updatedAt = new Date().toISOString();

    db.activeDraft = draft;
    saveDatabase(db);

    const announcement =
      `Demo fingerprint verification successful. No real fingerprint was accessed. ` +
      `Fingerprint verification successful. Your payment is authorized. Proceeding to PayPal Sandbox.`;

    return {
      success: true,
      authorizationToken: token,
      draft,
      announcement,
    };
  }

  /**
   * Completes payment execution after checkout capture
   */
  static finalizePayment(params: {
    authorizationToken: string;
    paypalOrderId: string;
    paypalCaptureId: string;
    isDemoMode: boolean;
  }): { success: boolean; completedTransaction: Transaction | null; newBalance: number; message: string } {
    const db = getDatabase();

    // Idempotency: check first if transaction with this paypalOrderId has already been completed
    const existingCompleted = db.transactions.find(
      (tx) => (params.paypalOrderId && tx.paypalOrderId === params.paypalOrderId && tx.status === 'completed') ||
              (db.activeDraft && db.activeDraft.idempotencyKey && tx.idempotencyKey === db.activeDraft.idempotencyKey && tx.status === 'completed')
    );
    if (existingCompleted) {
      return {
        success: true,
        completedTransaction: existingCompleted,
        newBalance: db.account.balance,
        message: `This payment has already been completed and captured. No duplicate payment was processed.`,
      };
    }

    const draft = db.activeDraft;

    if (!draft) {
      return { success: false, completedTransaction: null, newBalance: db.account.balance, message: 'No active transaction draft to complete.' };
    }

    if (!draft.authorizationToken || draft.authorizationToken !== params.authorizationToken) {
      return { success: false, completedTransaction: null, newBalance: db.account.balance, message: 'Authorization token mismatch or expired. Payment aborted.' };
    }

    // Server-side check: never capture an unapproved order
    if (!draft.isBuyerApproved) {
      return { success: false, completedTransaction: null, newBalance: db.account.balance, message: 'Cannot capture payment. The PayPal order has not received buyer approval yet.' };
    }

    // Server-side check: bind authorization to exact transaction details
    if (
      !draft.authorizedDetails ||
      draft.authorizedDetails.amount !== draft.amount ||
      draft.authorizedDetails.recipient !== draft.recipient ||
      draft.authorizedDetails.currency !== draft.currency
    ) {
      return {
        success: false,
        completedTransaction: null,
        newBalance: db.account.balance,
        message: 'Transaction details have changed since authorization was granted. Authorization invalidated.',
      };
    }

    if (draft.amount > db.account.balance) {
      return { success: false, completedTransaction: null, newBalance: db.account.balance, message: 'Insufficient demo account balance.' };
    }

    // Deduct balance
    db.account.balance = Math.round((db.account.balance - draft.amount) * 100) / 100;

    const completedTx: Transaction = {
      ...draft,
      status: 'completed',
      paypalOrderId: params.paypalOrderId,
      paypalCaptureId: params.paypalCaptureId,
      isDemoMode: params.isDemoMode,
      updatedAt: new Date().toISOString(),
    };

    db.transactions.unshift(completedTx);
    db.activeDraft = null;

    // Recalculate budget available balance
    db.budget.availableBalance = db.account.balance;
    db.budget.shortfall = Math.max(0, Math.round((db.budget.totalAllocated - db.budget.availableBalance) * 100) / 100);
    db.budget.unallocated = Math.max(0, Math.round((db.budget.availableBalance - db.budget.totalAllocated) * 100) / 100);

    let message = `Payment of $${completedTx.amount.toFixed(2)} ${completedTx.currency} to ${completedTx.recipient} has been completed via PayPal Sandbox. Your new demo balance is $${db.account.balance.toFixed(2)}.`;

    // Recalculate budget affordability and notify user if budget exceeds remaining balance
    if (db.budget.status === 'saved' && db.budget.shortfall > 0) {
      message += ` Notice: Following this payment, your saved budget of $${db.budget.totalAllocated.toFixed(2)} now exceeds your available balance of $${db.account.balance.toFixed(2)} by $${db.budget.shortfall.toFixed(2)}. Your saved allocations were not modified. Say "Read my allocations" to review or adjust.`;
    }

    saveDatabase(db);

    return {
      success: true,
      completedTransaction: completedTx,
      newBalance: db.account.balance,
      message,
    };
  }

  /**
   * Budget Engine: Process and validate spoken budget proposals
   */
  static evaluateBudget(allocations: { category: string; amount: number }[], customTotalAvailable?: number): {
    budget: BudgetPlan;
    spokenAnalysis: string;
    isValid: boolean;
  } {
    const db = getDatabase();
    const available = customTotalAvailable !== undefined ? customTotalAvailable : db.account.balance;

    const mappedAllocations: BudgetCategory[] = allocations.map((a, i) => ({
      id: `b-${Date.now()}-${i}`,
      category: a.category.trim(),
      amount: Math.round(Math.max(0, a.amount) * 100) / 100,
    }));

    const totalAllocated = Math.round(mappedAllocations.reduce((acc, cat) => acc + cat.amount, 0) * 100) / 100;
    const shortfall = Math.max(0, Math.round((totalAllocated - available) * 100) / 100);
    const unallocated = Math.max(0, Math.round((available - totalAllocated) * 100) / 100);

    const budget: BudgetPlan = {
      id: `budget-draft-${Date.now()}`,
      allocations: mappedAllocations,
      totalAllocated,
      availableBalance: available,
      shortfall,
      unallocated,
      status: 'draft',
      lastUpdated: new Date().toISOString(),
    };

    let spokenAnalysis = '';
    const isValid = shortfall === 0;

    if (shortfall > 0) {
      spokenAnalysis =
        `Your proposed budget of $${totalAllocated.toFixed(2)} exceeds your available balance of $${available.toFixed(2)} by $${shortfall.toFixed(2)}. ` +
        `Which category would you like to reduce? You can say: Reduce food to 80 dollars, or Change transport to 40 dollars.`;
    } else {
      const breakdown = mappedAllocations.map((c) => `$${c.amount.toFixed(2)} for ${c.category}`).join(', ');
      spokenAnalysis =
        `You have proposed a budget of $${totalAllocated.toFixed(2)}: ${breakdown}. ` +
        (unallocated > 0
          ? `You have $${unallocated.toFixed(2)} remaining unallocated. `
          : `This uses your exact available balance. `) +
        `Say "Save budget" to confirm and save.`;
    }

    db.budget = budget;
    saveDatabase(db);

    return { budget, spokenAnalysis, isValid };
  }

  /**
   * Adjusts category allocation in active budget
   */
  static modifyBudgetCategory(params: {
    category: string;
    newAmount?: number;
    remove?: boolean;
  }): {
    budget: BudgetPlan;
    spokenAnalysis: string;
    isValid: boolean;
  } {
    const db = getDatabase();
    const current = db.budget;
    const catNameLower = params.category.toLowerCase().trim();

    let updatedAllocations = [...current.allocations];

    if (params.remove) {
      updatedAllocations = updatedAllocations.filter(
        (c) => !c.category.toLowerCase().includes(catNameLower)
      );
    } else if (params.newAmount !== undefined) {
      const targetIndex = updatedAllocations.findIndex((c) =>
        c.category.toLowerCase().includes(catNameLower)
      );
      if (targetIndex >= 0) {
        updatedAllocations[targetIndex] = {
          ...updatedAllocations[targetIndex],
          amount: Math.round(Math.max(0, params.newAmount) * 100) / 100,
        };
      } else {
        // Add new category
        updatedAllocations.push({
          id: `b-cat-${Date.now()}`,
          category: params.category,
          amount: Math.round(Math.max(0, params.newAmount) * 100) / 100,
        });
      }
    }

    const available = current.availableBalance || db.account.balance;
    const totalAllocated = Math.round(
      updatedAllocations.reduce((acc, cat) => acc + cat.amount, 0) * 100
    ) / 100;
    const shortfall = Math.max(0, Math.round((totalAllocated - available) * 100) / 100);
    const unallocated = Math.max(0, Math.round((available - totalAllocated) * 100) / 100);

    const updatedBudget: BudgetPlan = {
      ...current,
      allocations: updatedAllocations,
      totalAllocated,
      shortfall,
      unallocated,
      status: 'draft',
      lastUpdated: new Date().toISOString(),
    };

    const isValid = shortfall === 0;
    let spokenAnalysis = '';

    if (shortfall > 0) {
      spokenAnalysis =
        `Updated budget is $${totalAllocated.toFixed(2)}, which still exceeds your available balance of $${available.toFixed(2)} by $${shortfall.toFixed(2)}. ` +
        `Which category would you like to adjust next?`;
    } else {
      spokenAnalysis =
        `Budget updated. Total allocated is now $${totalAllocated.toFixed(2)} out of $${available.toFixed(2)}, leaving $${unallocated.toFixed(2)} unallocated. ` +
        `Say "Save budget" to confirm and save.`;
    }

    db.budget = updatedBudget;
    saveDatabase(db);

    return { budget: updatedBudget, spokenAnalysis, isValid };
  }

  /**
   * Confirms and permanently saves the budget plan
   */
  static saveCurrentBudget(): { success: boolean; budget: BudgetPlan; spokenResponse: string } {
    const db = getDatabase();
    const current = db.budget;

    if (current.shortfall > 0) {
      return {
        success: false,
        budget: current,
        spokenResponse: `Cannot save budget. It exceeds your available balance by $${current.shortfall.toFixed(2)}. Please reduce an allocation first.`,
      };
    }

    if (current.allocations.length === 0) {
      return {
        success: false,
        budget: current,
        spokenResponse: 'You have no budget categories to save. Try saying: Budget 100 dollars for food and 50 dollars for transport.',
      };
    }

    current.status = 'saved';
    current.lastUpdated = new Date().toISOString();
    db.budget = current;
    saveDatabase(db);

    const spokenResponse = `Your budget of $${current.totalAllocated.toFixed(2)} across ${current.allocations.length} categories has been saved. Unallocated balance is $${current.unallocated.toFixed(2)}.`;
    return { success: true, budget: current, spokenResponse };
  }

  /**
   * Reads back the saved or active budget plan
   */
  static readBudget(): { budget: BudgetPlan; spokenResponse: string } {
    const db = getDatabase();
    const b = db.budget;

    if (!b || b.allocations.length === 0) {
      return {
        budget: b,
        spokenResponse: 'You do not have a budget configured yet. You can say: Budget 100 dollars for groceries and 50 dollars for transport.',
      };
    }

    const details = b.allocations.map((a) => `$${a.amount.toFixed(2)} for ${a.category}`).join(', ');
    const statusText = b.status === 'saved' ? 'Saved budget' : 'Draft budget';

    const spokenResponse =
      `${statusText}: Total allocated is $${b.totalAllocated.toFixed(2)} out of $${b.availableBalance.toFixed(2)}. ` +
      `Allocations are: ${details}. ` +
      (b.shortfall > 0
        ? `Warning: It exceeds your balance by $${b.shortfall.toFixed(2)}.`
        : `Remaining unallocated balance is $${b.unallocated.toFixed(2)}.`);

    return { budget: b, spokenResponse };
  }
}
