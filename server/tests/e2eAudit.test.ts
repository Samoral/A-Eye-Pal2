import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase, saveDatabase } from '../db.js';
import { FinancialEngine } from '../financialEngine.js';
import { ConversationalPaymentEngine } from '../conversationalEngine.js';
import { PayPalService } from '../paypalService.js';

describe('A-Eye Pal Complete End-to-End Audit Suite', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  // ==========================================
  // SECTION 1: PAYMENT TESTS
  // ==========================================
  describe('Payment Tests (Voice Interaction Flow)', () => {
    it('1. Initiate a payment: extracts recipient, amount, currency, and purpose without initiating checkout', () => {
      const turn1 = ConversationalPaymentEngine.processTurn('I want to pay $50 to John for lunch.');

      expect(turn1.intent).toBe('INITIATE_PAYMENT');
      expect(turn1.stage).toBe('AWAITING_DETAILS_CONFIRMATION');
      expect(turn1.spokenResponse).toBe(
        'You are about to pay John $50. Would you like me to read the transaction details?'
      );
      expect(turn1.activeDraft).not.toBeNull();
      expect(turn1.activeDraft?.recipient).toBe('John');
      expect(turn1.activeDraft?.amount).toBe(50);
      expect(turn1.activeDraft?.currency).toBe('USD');
      expect(turn1.activeDraft?.purpose).toBe('lunch');
      expect(turn1.activeDraft?.status).toBe('draft');
      expect(turn1.activeDraft?.authorizationToken).toBeNull();
    });

    it('2. Correct an incorrect amount: preserves recipient and updates amount', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.'); // reads details

      // User corrects amount
      const correctionTurn = ConversationalPaymentEngine.processTurn('No, change it to $75.');

      expect(correctionTurn.intent).toBe('MODIFY_TRANSACTION');
      expect(correctionTurn.spokenResponse).toContain('Your payment amount has been updated to $75');
      expect(correctionTurn.spokenResponse).toContain('You are about to pay John $75 USD. Is this correct?');
      expect(correctionTurn.activeDraft?.amount).toBe(75);
      expect(correctionTurn.activeDraft?.recipient).toBe('John'); // Preserved!
      expect(correctionTurn.activeDraft?.authorizationToken).toBeNull();
    });

    it('3. Change the recipient: updates recipient while preserving amount', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');

      const changeRecipientTurn = ConversationalPaymentEngine.processTurn('Change recipient to Sarah');

      expect(changeRecipientTurn.intent).toBe('MODIFY_TRANSACTION');
      expect(changeRecipientTurn.activeDraft?.recipient).toBe('Sarah');
      expect(changeRecipientTurn.activeDraft?.amount).toBe(50); // Preserved!
      expect(changeRecipientTurn.spokenResponse).toContain('Your recipient has been updated to Sarah');
    });

    it('4. Change currency: updates currency and invalidates prior status', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');

      const changeCurrencyTurn = ConversationalPaymentEngine.processTurn('Change currency to EUR');

      expect(changeCurrencyTurn.intent).toBe('MODIFY_TRANSACTION');
      expect(changeCurrencyTurn.activeDraft?.currency).toBe('EUR');
      expect(changeCurrencyTurn.spokenResponse).toContain('Your payment currency has been updated to EUR');
    });

    it('5. Review transaction details: reads recipient, amount, currency, and purpose', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      const reviewTurn = ConversationalPaymentEngine.processTurn('Yes.');

      expect(reviewTurn.intent).toBe('CLARIFY_TRANSACTION');
      expect(reviewTurn.spokenResponse).toBe(
        'Recipient: John. Amount: $50 USD. Payment purpose: not specified. Is this correct?'
      );
      expect(reviewTurn.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
    });

    it('6. Repeat transaction details: supports on-demand repetition', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');

      const repeatTurn = ConversationalPaymentEngine.processTurn('Repeat the transaction details.');

      expect(repeatTurn.intent).toBe('CLARIFY_TRANSACTION');
      expect(repeatTurn.spokenResponse).toContain('Recipient: John. Amount: $50 USD');
      expect(repeatTurn.spokenResponse).toContain('Is this correct?');
    });

    it('7. Authorize payment: explicit approval prepares payment for demo fingerprint verification', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.'); // Approves details -> AWAITING_AUTHORIZATION

      const authTurn = ConversationalPaymentEngine.processTurn('I authorize this payment.');

      expect(authTurn.intent).toBe('AUTHORIZE_PAYMENT');
      expect(authTurn.spokenResponse).toBe(
        'Your payment is authorized. Please complete the demo fingerprint verification.'
      );
      expect(authTurn.stage).toBe('AUTHORIZED_PENDING_FINGERPRINT');
      expect(authTurn.modalAction).toBe('open_fingerprint');
      expect(authTurn.activeDraft?.status).toBe('authorized');
      expect(authTurn.activeDraft?.authorizationToken).toBeTruthy();
    });

    it('8. Complete mock fingerprint verification: delivers required disclaimer announcement', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('I authorize this payment.');

      const mockFpResult = FinancialEngine.authorizeDraftWithDemoFingerprint();

      expect(mockFpResult.success).toBe(true);
      expect(mockFpResult.announcement).toBe(
        'Demo fingerprint verification successful. No real fingerprint was accessed. Payment of $50.00 USD to John is now authorized for PayPal Sandbox checkout.'
      );
      expect(mockFpResult.draft?.conversationStage).toBe('FINGERPRINT_VERIFIED');
    });

    it('9 & 10. Complete PayPal Sandbox checkout and verify payment capture', async () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.');
      const authTurn = ConversationalPaymentEngine.processTurn('I authorize this payment.');
      const token = authTurn.activeDraft?.authorizationToken!;

      // 9. Create PayPal Sandbox Order
      const order = await PayPalService.createOrder({
        amount: 50,
        currency: 'USD',
        recipient: 'John',
        purpose: 'not specified',
        referenceId: authTurn.activeDraft?.id!,
      });
      expect(order.orderId).toBeTruthy();
      expect(order.status).toBe('CREATED');

      // 10. Capture PayPal Order
      const capture = await PayPalService.captureOrder(order.orderId, 50, 'USD');
      expect(capture.status).toBe('COMPLETED');

      // Settle in backend ledger
      const finalize = FinancialEngine.finalizePayment({
        authorizationToken: token,
        paypalOrderId: order.orderId,
        paypalCaptureId: capture.captureId,
        isDemoMode: capture.isDemoMode,
      });

      expect(finalize.success).toBe(true);
      expect(finalize.newBalance).toBe(600.00); // 650.00 - 50.00
      expect(finalize.completedTransaction?.status).toBe('completed');
      expect(finalize.completedTransaction?.paypalOrderId).toBe(order.orderId);

      // Verify active draft is cleared
      const db = getDatabase();
      expect(db.activeDraft).toBeNull();
    });

    it('11. Cancel a pending transaction: discards draft and restores IDLE state', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      const cancelTurn = ConversationalPaymentEngine.processTurn('Cancel');

      expect(cancelTurn.intent).toBe('CANCEL_TRANSACTION');
      expect(cancelTurn.spokenResponse).toBe('Your payment draft has been cancelled.');
      expect(cancelTurn.stage).toBe('IDLE');
      expect(cancelTurn.activeDraft).toBeNull();
    });

    it('12. Reject ambiguous authorization: refuses to proceed on unclear words or silence', () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.'); // in AWAITING_AUTHORIZATION

      const ambiguousTurn = ConversationalPaymentEngine.processTurn('um maybe I think so');

      expect(ambiguousTurn.intent).toBe('AMBIGUOUS_RESPONSE');
      expect(ambiguousTurn.spokenResponse).toContain('I did not receive a clear authorization');
      expect(ambiguousTurn.stage).toBe('AWAITING_AUTHORIZATION');
      expect(ambiguousTurn.modalAction).toBe('none');
    });

    it('13. Prevent duplicate payments: idempotency protects against multiple captures', async () => {
      ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.');
      const auth = ConversationalPaymentEngine.processTurn('I authorize this payment.');
      const token = auth.activeDraft?.authorizationToken!;

      const order = await PayPalService.createOrder({
        amount: 50,
        currency: 'USD',
        recipient: 'John',
        purpose: 'lunch',
        referenceId: auth.activeDraft?.id!,
      });

      // Capture 1
      const cap1 = FinancialEngine.finalizePayment({
        authorizationToken: token,
        paypalOrderId: order.orderId,
        paypalCaptureId: 'CAP-DUP-A',
        isDemoMode: true,
      });
      expect(cap1.success).toBe(true);
      expect(cap1.newBalance).toBe(600.00);

      // Capture 2 (replay)
      const cap2 = FinancialEngine.finalizePayment({
        authorizationToken: token,
        paypalOrderId: order.orderId,
        paypalCaptureId: 'CAP-DUP-B',
        isDemoMode: true,
      });
      expect(cap2.success).toBe(true);
      expect(cap2.newBalance).toBe(600.00); // Balance NOT deducted twice!
      expect(cap2.message).toContain('has already been completed via PayPal Sandbox');
    });

    it('14. Explain actual payment errors: explains insufficient funds accurately', () => {
      // Balance is 650.00. Attempt 900.00
      ConversationalPaymentEngine.processTurn('I want to pay $900 to Electric Co.');
      ConversationalPaymentEngine.processTurn('Yes.');
      ConversationalPaymentEngine.processTurn('Yes.');

      const authDeclined = ConversationalPaymentEngine.processTurn('I authorize this payment.');

      expect(authDeclined.intent).toBe('AUTHORIZE_PAYMENT');
      expect(authDeclined.soundCue).toBe('warning');
      expect(authDeclined.spokenResponse).toContain('Payment authorization declined');
      expect(authDeclined.spokenResponse).toContain('exceeds available demo balance by $250.00');
    });
  });

  // ==========================================
  // SECTION 2: FINANCIAL AWARENESS TESTS
  // ==========================================
  describe('Financial Awareness Tests', () => {
    it('1. Ask for available balance: returns accurate balance with demo label', () => {
      const res = ConversationalPaymentEngine.processTurn('What is my balance?');
      expect(res.intent).toBe('CHECK_BALANCE');
      expect(res.spokenResponse).toContain('Your available demo balance is $650.00 USD. This is a demonstration account.');
    });

    it('2. Ask how much was spent this week: returns accurate weekly debit sum', () => {
      const res = ConversationalPaymentEngine.processTurn('How much did I spend this week?');
      expect(res.intent).toBe('CHECK_SPENDING');
      expect(res.spokenResponse).toContain('You have spent $127.50 USD this week from completed payments.');
    });

    it('3. Ask how much was spent this month: returns accurate monthly debit sum', () => {
      const res = ConversationalPaymentEngine.processTurn('How much did I spend this month?');
      expect(res.intent).toBe('CHECK_SPENDING');
      expect(res.spokenResponse).toContain('You have spent $127.50 USD in the last 30 days from completed payments.');
    });

    it('4. Ask about the last payment: reports recipient, amount, status, and method', () => {
      const res = ConversationalPaymentEngine.processTurn('What was my last payment?');
      expect(res.intent).toBe('CHECK_SPENDING');
      expect(res.spokenResponse).toContain('Your last payment was $45.00 USD to Metro Transit System');
      expect(res.spokenResponse).toContain('successfully completed via PayPal Sandbox');
    });

    it('5. Confirm pending and failed transactions are excluded from completed spending', () => {
      const db = getDatabase();
      db.transactions.push({
        id: 'tx-audit-pending',
        type: 'debit',
        amount: 500.00,
        currency: 'USD',
        recipient: 'Pending Store',
        purpose: 'Test',
        status: 'draft',
        authorizationToken: null,
        paymentMethod: 'PayPal Sandbox',
        paypalOrderId: null,
        paypalCaptureId: null,
        isDemoMode: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      db.transactions.push({
        id: 'tx-audit-cancelled',
        type: 'debit',
        amount: 800.00,
        currency: 'USD',
        recipient: 'Cancelled Store',
        purpose: 'Test',
        status: 'cancelled',
        authorizationToken: null,
        paymentMethod: 'PayPal Sandbox',
        paypalOrderId: null,
        paypalCaptureId: null,
        isDemoMode: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      saveDatabase(db);

      const summary = FinancialEngine.getFinancialSummary();
      // Total spent must still be 127.50, excluding the 500 draft and 800 cancelled
      expect(summary.totalSpent).toBe(127.50);

      const voice = ConversationalPaymentEngine.processTurn('How much have I spent?');
      expect(voice.spokenResponse).toContain('$127.50 USD');
      expect(voice.spokenResponse).toContain('Pending or draft payments are excluded');
    });
  });

  // ==========================================
  // SECTION 3: BUDGET TESTS
  // ==========================================
  describe('Budget Tests', () => {
    it('1. Create a valid budget: parses speech and calculates unallocated funds', () => {
      const res = ConversationalPaymentEngine.processTurn(
        'I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings.'
      );
      expect(res.intent).toBe('CREATE_OR_MODIFY_BUDGET');
      expect(res.budget.totalAllocated).toBe(450.00);
      expect(res.budget.shortfall).toBe(0);
      expect(res.budget.unallocated).toBe(50.00);
      expect(res.spokenResponse).toContain('You have proposed a budget of $450.00');
      expect(res.spokenResponse).toContain('$50.00 remaining unallocated');
    });

    it('2 & 3. Create budget exceeding available balance and calculate exact shortfall', () => {
      // Balance is 650.00. Total proposed is 750.00
      const res = ConversationalPaymentEngine.processTurn(
        'Allocate $300 for food, $200 for transport, $150 for electricity and $100 for savings.'
      );
      expect(res.budget.totalAllocated).toBe(750.00);
      expect(res.budget.shortfall).toBe(100.00);
      expect(res.spokenResponse).toContain('exceeds your available balance of $650.00 by $100.00');
      expect(res.spokenResponse).toContain('Which category would you like to reduce?');
    });

    it('4 & 5. Correct an allocation using voice and recalculate the budget', () => {
      // Start with over-budget
      ConversationalPaymentEngine.processTurn('Allocate $400 for food and $300 for transport.');

      // Correct food allocation
      const corrected = ConversationalPaymentEngine.processTurn('Reduce food to $300.');
      expect(corrected.budget.totalAllocated).toBe(600.00);
      expect(corrected.budget.shortfall).toBe(0);
      expect(corrected.budget.unallocated).toBe(50.00);
      expect(corrected.spokenResponse).toContain('Total allocated is now $600.00 out of $650.00');
    });

    it('6. Confirm and save the budget: persists valid budget with spoken confirmation', () => {
      ConversationalPaymentEngine.processTurn('Allocate $200 for food and $100 for transport.');
      const saveRes = ConversationalPaymentEngine.processTurn('Save my budget.');

      expect(saveRes.intent).toBe('SAVE_BUDGET');
      expect(saveRes.budget.status).toBe('saved');
      expect(saveRes.spokenResponse).toContain('Your budget of $300.00 across 2 categories has been saved');
    });

    it('7. Retrieve a saved budget: accurately reads back saved allocations', () => {
      const readRes = ConversationalPaymentEngine.processTurn('Read my allocations.');
      expect(readRes.intent).toBe('READ_BUDGET');
      expect(readRes.spokenResponse).toContain('Saved budget');
      expect(readRes.spokenResponse).toContain('Total allocated is $400.00');
    });

    it('8. Update an existing budget: modifies allocations without destroying unaffected categories', () => {
      // Initial saved has Food, Transport, Electricity, Savings
      const updateRes = ConversationalPaymentEngine.processTurn('Increase savings to $150.');
      expect(updateRes.budget.allocations.find((c: any) => c.category.toLowerCase().includes('savings'))?.amount).toBe(150.00);
      expect(updateRes.budget.allocations.some((c: any) => c.category.toLowerCase().includes('food'))).toBe(true);
    });

    it('9. Verify that budgeting never initiates payments', () => {
      const budgetRes = ConversationalPaymentEngine.processTurn('Allocate $100 for food.');
      expect(budgetRes.intent).toBe('CREATE_OR_MODIFY_BUDGET');

      // Draft must NOT be created
      const db = getDatabase();
      expect(db.activeDraft).toBeNull();
    });

    it('10. Verify that a new completed payment triggers an affordability check', () => {
      // Current saved budget is 400.00, balance is 650.00
      FinancialEngine.createOrUpdateDraft({
        amount: 350.00,
        recipient: 'Apartment Leasing Co',
        purpose: 'Rent',
      });
      const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

      const finalize = FinancialEngine.finalizePayment({
        authorizationToken: auth.authorizationToken!,
        paypalOrderId: 'ORD-AUDIT-AFFORD',
        paypalCaptureId: 'CAP-AUDIT-AFFORD',
        isDemoMode: true,
      });

      expect(finalize.newBalance).toBe(300.00);
      expect(finalize.message).toContain('Notice: Following this payment, your saved budget of $400.00 now exceeds your available balance of $300.00 by $100.00.');
      expect(finalize.message).toContain('Your saved allocations were not modified');

      const db = getDatabase();
      expect(db.budget.status).toBe('saved');
      expect(db.budget.shortfall).toBe(100.00);
    });
  });

  // ==========================================
  // SECTION 4: ACCESSIBILITY TESTS
  // ==========================================
  describe('Accessibility Tests', () => {
    it('Spoken response contract: Every turn yields a complete spoken response string', () => {
      const testInputs = [
        'What is my balance?',
        'I want to pay $50 to John.',
        'Repeat the transaction details.',
        'How much did I spend this week?',
        'Allocate $100 for food.',
        'Read my allocations.',
        'Cancel',
      ];

      for (const input of testInputs) {
        const result = ConversationalPaymentEngine.processTurn(input);
        expect(result.spokenResponse).toBeTruthy();
        expect(result.spokenResponse.length).toBeGreaterThan(10);
      }
    });

    it('Unclear speech triggers helpful clarification without breaking state', () => {
      const res = ConversationalPaymentEngine.processTurn('asdfghjkl random noise');
      expect(res.intent).toBe('GENERAL_ASSIST');
      expect(res.spokenResponse).toContain('A-Eye Pal is ready');
    });
  });
});
