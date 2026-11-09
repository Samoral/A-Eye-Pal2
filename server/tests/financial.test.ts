import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase } from '../db.js';
import { FinancialEngine } from '../financialEngine.js';
import { PayPalService } from '../paypalService.js';

describe('A-Eye Pal Financial & Payment Workflow Engine', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  describe('Financial Awareness & Balance', () => {
    it('accurately calculates balance, weekly, and monthly spending', () => {
      const summary = FinancialEngine.getFinancialSummary();
      expect(summary.balance).toBe(650.00);
      expect(summary.currency).toBe('USD');
      expect(summary.totalSpent).toBeGreaterThan(0);
      expect(summary.recentTransactions.length).toBeGreaterThan(0);
      expect(summary.label).toContain('Demo Balance');
    });
  });

  describe('Payment Initiation & Draft Creation', () => {
    it('creates a draft with positive amount and recipient and sets status to draft', () => {
      const result = FinancialEngine.createOrUpdateDraft({
        amount: 50.00,
        recipient: 'John',
        purpose: 'Electricity reimbursement',
        currency: 'USD',
      });

      expect(result.draft.amount).toBe(50.00);
      expect(result.draft.recipient).toBe('John');
      expect(result.draft.status).toBe('draft');
      expect(result.draft.authorizationToken).toBeNull();
      expect(result.isComplete).toBe(true);
      expect(result.isOverBalance).toBe(false);
    });

    it('flags drafts that exceed available balance', () => {
      const result = FinancialEngine.createOrUpdateDraft({
        amount: 9999.00,
        recipient: 'Luxury Store',
        purpose: 'Diamond ring',
      });

      expect(result.isOverBalance).toBe(true);
      expect(result.validationMessage).toContain('exceeds your available demo balance');
    });
  });

  describe('Transaction Modification & Authorization Invalidation', () => {
    it('CRITICAL: strictly clears previous authorization token whenever details are modified', () => {
      // 1. Create draft
      FinancialEngine.createOrUpdateDraft({
        amount: 50.00,
        recipient: 'John',
        purpose: 'Lunch',
      });

      // 2. Authorize it
      const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();
      expect(auth.success).toBe(true);
      expect(auth.authorizationToken).toBeTruthy();

      const dbBefore = getDatabase();
      expect(dbBefore.activeDraft?.status).toBe('authorized');
      expect(dbBefore.activeDraft?.authorizationToken).toBeTruthy();

      // 3. User modifies the amount: "Change the amount to $75"
      const modified = FinancialEngine.modifyDraft({ amount: 75.00 });

      expect(modified.draft.amount).toBe(75.00);
      expect(modified.draft.status).toBe('draft');
      expect(modified.draft.authorizationToken).toBeNull(); // MUST BE NULL
      expect(modified.clarificationText).toContain('Any previous authorization has been cleared');

      const dbAfter = getDatabase();
      expect(dbAfter.activeDraft?.authorizationToken).toBeNull();
      expect(dbAfter.activeDraft?.status).toBe('draft');
    });

    it('updates recipient and preserves active context while invalidating authorization', () => {
      FinancialEngine.createOrUpdateDraft({
        amount: 40.00,
        recipient: 'John',
      });
      FinancialEngine.authorizeDraftWithDemoFingerprint();

      const mod = FinancialEngine.modifyDraft({ recipient: 'Sarah' });
      expect(mod.draft.recipient).toBe('Sarah');
      expect(mod.draft.amount).toBe(40.00);
      expect(mod.draft.authorizationToken).toBeNull();
    });
  });

  describe('Simulated Fingerprint Authorization', () => {
    it('issues authorization token for valid complete draft within balance', () => {
      FinancialEngine.createOrUpdateDraft({
        amount: 35.00,
        recipient: 'Sarah',
        purpose: 'Dinner',
      });

      const res = FinancialEngine.authorizeDraftWithDemoFingerprint();
      expect(res.success).toBe(true);
      expect(res.authorizationToken).toMatch(/^DEMO-AUTH-/);
      expect(res.announcement).toContain('Demo fingerprint verification successful. No real fingerprint was accessed');
    });

    it('rejects authorization when amount exceeds available balance', () => {
      FinancialEngine.createOrUpdateDraft({
        amount: 1500.00,
        recipient: 'Travel Agent',
        purpose: 'Flight tickets',
      });

      const res = FinancialEngine.authorizeDraftWithDemoFingerprint();
      expect(res.success).toBe(false);
      expect(res.authorizationToken).toBeNull();
      expect(res.error).toBe('INSUFFICIENT_FUNDS');
    });
  });

  describe('PayPal Checkout & Finalization', () => {
    it('executes sandbox checkout and updates balance and ledger with valid token', async () => {
      FinancialEngine.createOrUpdateDraft({
        amount: 50.00,
        recipient: 'City Power',
        purpose: 'Electricity bill',
      });

      const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();
      expect(auth.success).toBe(true);
      const token = auth.authorizationToken!;

      // Create PayPal order
      const order = await PayPalService.createOrder({
        amount: 50.00,
        currency: 'USD',
        recipient: 'City Power',
        purpose: 'Electricity bill',
        referenceId: 'ref-1',
      });
      expect(order.orderId).toBeTruthy();

      // Finalize payment
      const finalize = FinancialEngine.finalizePayment({
        authorizationToken: token,
        paypalOrderId: order.orderId,
        paypalCaptureId: 'CAP-TEST-1',
        isDemoMode: true,
      });

      expect(finalize.success).toBe(true);
      expect(finalize.newBalance).toBe(600.00); // 650 - 50 = 600
      expect(finalize.completedTransaction?.status).toBe('completed');

      const db = getDatabase();
      expect(db.activeDraft).toBeNull();
      expect(db.transactions[0].recipient).toBe('City Power');
      expect(db.transactions[0].amount).toBe(50.00);
    });

    it('strictly denies payment execution if authorization token is invalid or missing', () => {
      FinancialEngine.createOrUpdateDraft({
        amount: 25.00,
        recipient: 'Alex',
        purpose: 'Coffee',
      });

      const finalize = FinancialEngine.finalizePayment({
        authorizationToken: 'WRONG-TOKEN',
        paypalOrderId: 'ORD-1',
        paypalCaptureId: 'CAP-1',
        isDemoMode: true,
      });

      expect(finalize.success).toBe(false);
      expect(finalize.message).toContain('Authorization token mismatch');
    });
  });

  describe('Budget Management & Math Validation', () => {
    it('calculates unallocated balance when budget is within available funds', () => {
      // Balance is 650.00
      const allocations = [
        { category: 'Groceries', amount: 200.00 },
        { category: 'Transport', amount: 100.00 },
      ];

      const res = FinancialEngine.evaluateBudget(allocations);
      expect(res.isValid).toBe(true);
      expect(res.budget.totalAllocated).toBe(300.00);
      expect(res.budget.shortfall).toBe(0);
      expect(res.budget.unallocated).toBe(350.00); // 650 - 300 = 350
    });

    it('identifies exact shortfall when proposed budget exceeds available balance and blocks saving', () => {
      // Available: 650. Proposed: 750. Shortfall: 100
      const allocations = [
        { category: 'Rent', amount: 500.00 },
        { category: 'Shopping', amount: 250.00 },
      ];

      const res = FinancialEngine.evaluateBudget(allocations);
      expect(res.isValid).toBe(false);
      expect(res.budget.totalAllocated).toBe(750.00);
      expect(res.budget.shortfall).toBe(100.00);
      expect(res.spokenAnalysis).toContain('exceeds your available balance of $650.00 by $100.00');

      // Attempt save should fail
      const saveRes = FinancialEngine.saveCurrentBudget();
      expect(saveRes.success).toBe(false);
      expect(saveRes.spokenResponse).toContain('Cannot save budget');
    });

    it('allows voice reduction of category to resolve shortfall and then successfully saves', () => {
      // Start over-budget
      FinancialEngine.evaluateBudget([
        { category: 'Food', amount: 400.00 },
        { category: 'Transport', amount: 300.00 },
      ]); // Total 700, shortfall 50 on 650 balance

      // User says: "Reduce food to 300"
      const mod = FinancialEngine.modifyBudgetCategory({
        category: 'Food',
        newAmount: 300.00,
      });

      expect(mod.isValid).toBe(true);
      expect(mod.budget.totalAllocated).toBe(600.00);
      expect(mod.budget.shortfall).toBe(0);
      expect(mod.budget.unallocated).toBe(50.00);

      // Now save
      const saveRes = FinancialEngine.saveCurrentBudget();
      expect(saveRes.success).toBe(true);
      expect(saveRes.budget.status).toBe('saved');
    });
  });
});
