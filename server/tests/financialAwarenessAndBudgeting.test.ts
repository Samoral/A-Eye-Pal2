import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase, saveDatabase } from '../db.js';
import { FinancialEngine } from '../financialEngine.js';
import { ConversationalPaymentEngine } from '../conversationalEngine.js';

describe('A-Eye Pal Financial Awareness & Budgeting Engine Test Suite', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  describe('Part 1: Financial Awareness & Ledger Source of Truth', () => {
    it('answers "What is my balance?" clearly identifying demo account and accurate balance', () => {
      const res = ConversationalPaymentEngine.processTurn('What is my balance?');
      expect(res.intent).toBe('CHECK_BALANCE');
      expect(res.spokenResponse).toContain('Your available demo balance is $650.00 USD');
      expect(res.spokenResponse).toContain('demonstration account');
    });

    it('answers "How much money do I have left?" accurately', () => {
      const res = ConversationalPaymentEngine.processTurn('How much money do I have left?');
      expect(res.intent).toBe('CHECK_BALANCE');
      expect(res.spokenResponse).toContain('Your available demo balance is $650.00 USD');
    });

    it('calculates completed spending and excludes pending, draft, and cancelled payments', () => {
      const db = getDatabase();

      // Add a pending transaction, cancelled transaction, and failed transaction
      db.transactions.push({
        id: 'tx-test-pending',
        type: 'debit',
        amount: 250.00,
        currency: 'USD',
        recipient: 'Pending Merchant',
        purpose: 'Pending purchase',
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
        id: 'tx-test-cancelled',
        type: 'debit',
        amount: 900.00,
        currency: 'USD',
        recipient: 'Cancelled Store',
        purpose: 'Aborted order',
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
      // Initial completed debits in INITIAL_DATA are:
      // 45.00 (Metro Transit) + 82.50 (City Power) = 127.50
      // Credit is 300 (Direct deposit) which is not spending
      // Draft 250 and Cancelled 900 MUST NOT be included!
      expect(summary.totalSpent).toBe(127.50);

      const voiceRes = ConversationalPaymentEngine.processTurn('How much have I spent?');
      expect(voiceRes.intent).toBe('CHECK_SPENDING');
      expect(voiceRes.spokenResponse).toContain('$127.50 USD');
      expect(voiceRes.spokenResponse).toContain('Pending or draft payments are excluded');
    });

    it('calculates "How much did I spend this week?" and "How much did I spend this month?"', () => {
      const weekRes = ConversationalPaymentEngine.processTurn('How much did I spend this week?');
      expect(weekRes.intent).toBe('CHECK_SPENDING');
      expect(weekRes.spokenResponse).toContain('spent $127.50 USD this week from completed payments');

      const monthRes = ConversationalPaymentEngine.processTurn('How much did I spend this month?');
      expect(monthRes.intent).toBe('CHECK_SPENDING');
      expect(monthRes.spokenResponse).toContain('in the last 30 days from completed payments');
    });

    it('reports last transaction details and whether payment went through', () => {
      const lastTxRes = ConversationalPaymentEngine.processTurn('What was my last transaction?');
      expect(lastTxRes.intent).toBe('CHECK_SPENDING');
      expect(lastTxRes.spokenResponse).toContain('Your last payment was $45.00 USD to Metro Transit System');
      expect(lastTxRes.spokenResponse).toContain('successfully completed');

      const goThroughRes = ConversationalPaymentEngine.processTurn('Did my last payment go through?');
      expect(goThroughRes.spokenResponse).toContain('successfully completed via PayPal Sandbox');
    });
  });

  describe('Part 2: Natural Spoken Budgeting', () => {
    it('understands spoken budget allocations and calculates unallocated funds', () => {
      // User says: "I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings."
      const res = ConversationalPaymentEngine.processTurn(
        'I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings.'
      );

      expect(res.intent).toBe('CREATE_OR_MODIFY_BUDGET');
      expect(res.budget).toBeDefined();
      expect(res.budget.totalAllocated).toBe(450.00); // 150 + 100 + 100 + 100
      expect(res.budget.shortfall).toBe(0);
      expect(res.budget.unallocated).toBe(50.00); // 500 - 450 = 50
      expect(res.spokenResponse).toContain('You have proposed a budget of $450.00');
      expect(res.spokenResponse).toContain('$50.00 remaining unallocated');
      expect(res.spokenResponse).toContain('Say "Save budget" to confirm and save');
    });

    it('detects budget shortfall when proposed allocations exceed available balance and explains exact difference', () => {
      // Available balance is $650.00. Propose $750.00 allocation.
      const res = ConversationalPaymentEngine.processTurn(
        'Allocate $300 for food, $200 for transport, $150 for electricity and $100 for savings.'
      );

      // Total = 300 + 200 + 150 + 100 = 750. Available = 650. Shortfall = 100.
      expect(res.budget.totalAllocated).toBe(750.00);
      expect(res.budget.shortfall).toBe(100.00);
      expect(res.spokenResponse).toContain('exceeds your available balance of $650.00 by $100.00');
      expect(res.spokenResponse).toContain('Which category would you like to reduce?');
    });

    it('strictly refuses to save invalid budgets with shortfall > 0', () => {
      // Set an invalid budget in draft
      FinancialEngine.evaluateBudget([
        { category: 'Food', amount: 500.00 },
        { category: 'Entertainment', amount: 300.00 },
      ]); // 800 > 650 balance, shortfall = 150

      const saveAttempt = ConversationalPaymentEngine.processTurn('Save my budget.');
      expect(saveAttempt.intent).toBe('SAVE_BUDGET');
      expect(saveAttempt.spokenResponse).toContain('Cannot save budget. It exceeds your available balance by $150.00');

      const db = getDatabase();
      expect(db.budget.status).toBe('draft'); // Must NOT be saved
    });

    it('allows spoken category modifications: reduce, increase, and remove', () => {
      // 1. Propose over-budget: 400 food + 300 transport = 700 on 650 balance (shortfall 50)
      ConversationalPaymentEngine.processTurn('Allocate $400 for food and $300 for transport.');

      // 2. Reduce food to $300: Total becomes 300 + 300 = 600 (shortfall 0, unallocated 50)
      const reduceRes = ConversationalPaymentEngine.processTurn('Reduce food to $300.');
      expect(reduceRes.budget.totalAllocated).toBe(600.00);
      expect(reduceRes.budget.shortfall).toBe(0);
      expect(reduceRes.budget.unallocated).toBe(50.00);
      expect(reduceRes.spokenResponse).toContain('Total allocated is now $600.00');

      // 3. Increase savings to $40: Total becomes 640 (unallocated 10)
      const incRes = ConversationalPaymentEngine.processTurn('Increase savings to $40.');
      expect(incRes.budget.totalAllocated).toBe(640.00);
      expect(incRes.budget.unallocated).toBe(10.00);

      // 4. Remove transport: Total becomes 640 - 300 = 340 (unallocated 310)
      const removeRes = ConversationalPaymentEngine.processTurn('Remove transport.');
      expect(removeRes.budget.totalAllocated).toBe(340.00);
      expect(removeRes.budget.allocations.some((c: { category: string }) => c.category.toLowerCase().includes('transport'))).toBe(false);

      // 5. Save budget now that it is valid
      const saveRes = ConversationalPaymentEngine.processTurn('Save my budget.');
      expect(saveRes.spokenResponse).toContain('Your budget of $340.00 across 2 categories has been saved');
      expect(saveRes.budget.status).toBe('saved');
    });

    it('reads back saved allocations accurately on "Read my allocations"', () => {
      const readRes = ConversationalPaymentEngine.processTurn('Read my allocations.');
      expect(readRes.intent).toBe('READ_BUDGET');
      expect(readRes.spokenResponse).toContain('Saved budget');
      expect(readRes.spokenResponse).toContain('Food & Groceries');
      expect(readRes.spokenResponse).toContain('Transport');
    });
  });

  describe('Part 3: Post-Payment Budget Affordability Recalculation', () => {
    it('notifies user of budget deficit when a payment reduces available balance below saved budget without modifying saved allocations', () => {
      // 1. Initial saved budget is $400.00, initial balance is $650.00
      const dbInitial = getDatabase();
      expect(dbInitial.budget.status).toBe('saved');
      expect(dbInitial.budget.totalAllocated).toBe(400.00);
      expect(dbInitial.account.balance).toBe(650.00);

      // 2. User pays $350.00 for Rent
      FinancialEngine.createOrUpdateDraft({
        amount: 350.00,
        recipient: 'Landlord',
        purpose: 'Monthly apartment rent',
      });
      const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

      // 3. Finalize payment
      const finalize = FinancialEngine.finalizePayment({
        authorizationToken: auth.authorizationToken!,
        paypalOrderId: 'ORD-RENT-TEST',
        paypalCaptureId: 'CAP-RENT-TEST',
        isDemoMode: true,
      });

      // New balance = 650 - 350 = 300.00
      expect(finalize.newBalance).toBe(300.00);

      // Total saved budget was $400.00. Now balance is $300.00. Deficit/shortfall is $100.00!
      expect(finalize.message).toContain('Notice: Following this payment, your saved budget of $400.00 now exceeds your available balance of $300.00 by $100.00.');
      expect(finalize.message).toContain('Your saved allocations were not modified');

      // Check DB persistence: saved allocations must remain intact!
      const dbAfter = getDatabase();
      expect(dbAfter.budget.status).toBe('saved');
      expect(dbAfter.budget.totalAllocated).toBe(400.00); // Intact! Never silently changed
      expect(dbAfter.budget.shortfall).toBe(100.00);
      expect(dbAfter.budget.availableBalance).toBe(300.00);
      expect(dbAfter.budget.allocations.length).toBe(4);
    });
  });
});
