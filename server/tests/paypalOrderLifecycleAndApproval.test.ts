import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase, saveDatabase } from '../db.js';
import { ConversationalPaymentEngine } from '../conversationalEngine.js';
import { FinancialEngine } from '../financialEngine.js';
import { PayPalService } from '../paypalService.js';

describe('PayPal Order Lifecycle, Single Authoritative State & Voice Approval Suite', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  // Scenario 1: New payment and successful approval
  it('Scenario 1: New payment draft creation, authorization, and successful approval with auto-capture', async () => {
    const initBalance = getDatabase().account.balance;

    // Step 1: Initiate draft
    const turn1 = ConversationalPaymentEngine.processTurn('I want to pay $35 to Sarah for dinner.');
    expect(turn1.activeDraft).not.toBeNull();
    expect(turn1.activeDraft?.amount).toBe(35);
    expect(turn1.activeDraft?.recipient).toBe('Sarah');
    expect(turn1.activeDraft?.draftVersion).toBe(1);

    // Step 2: Confirm details
    const turn2 = ConversationalPaymentEngine.processTurn('Yes.');
    expect(turn2.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');

    // Step 3: Confirm accuracy -> prompts for authorization
    const turn3 = ConversationalPaymentEngine.processTurn('Yes.');
    expect(turn3.stage).toBe('AWAITING_AUTHORIZATION');

    // Step 4: Authorize via demo fingerprint
    const authResult = FinancialEngine.authorizeDraftWithDemoFingerprint();
    expect(authResult.success).toBe(true);
    expect(authResult.authorizationToken).toBeDefined();

    // Step 5: Create authoritative PayPal order
    const db = getDatabase();
    const orderResult = await PayPalService.createOrder({
      amount: db.activeDraft!.amount,
      currency: db.activeDraft!.currency,
      recipient: db.activeDraft!.recipient,
      purpose: db.activeDraft!.purpose,
      referenceId: db.activeDraft!.id,
    });
    db.activeDraft!.paypalOrderId = orderResult.orderId;
    db.activeDraft!.status = 'processing';
    db.activeDraft!.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
    saveDatabase(db);

    // Step 6: Approval with automatic capture
    const finalizeResult = FinancialEngine.finalizePayment({
      authorizationToken: authResult.authorizationToken!,
      paypalOrderId: orderResult.orderId,
      paypalCaptureId: `CAP-${orderResult.orderId}`,
      isDemoMode: true,
      draftId: db.activeDraft!.id,
      draftVersion: db.activeDraft!.draftVersion,
    });

    expect(finalizeResult.success).toBe(true);
    expect(finalizeResult.newBalance).toBe(initBalance - 35);
    expect(getDatabase().account.balance).toBe(initBalance - 35);
    expect(getDatabase().activeDraft).toBeNull();
  });

  // Scenario 2: Change payment amount before approval
  it('Scenario 2: Changing payment amount before approval invalidates previous PayPal order and authorization', async () => {
    // Step 1: Initiate and authorize draft
    ConversationalPaymentEngine.processTurn('Send $40 to David.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth1 = FinancialEngine.authorizeDraftWithDemoFingerprint();
    expect(auth1.success).toBe(true);

    const db = getDatabase();
    const oldOrderId = 'SANDBOX-ORD-OLD-AMOUNT';
    db.activeDraft!.paypalOrderId = oldOrderId;
    saveDatabase(db);

    // User modifies payment amount: "Change amount to 60 dollars"
    const modTurn = ConversationalPaymentEngine.processTurn('Change amount to 60 dollars.');
    expect(modTurn.activeDraft?.amount).toBe(60);
    expect(modTurn.activeDraft?.recipient).toBe('David');
    expect(modTurn.activeDraft?.paypalOrderId).toBeNull(); // Old order invalidated
    expect(modTurn.activeDraft?.authorizationToken).toBeNull(); // Authorization invalidated
    expect(modTurn.activeDraft?.isBuyerApproved).toBe(false);
    expect(modTurn.activeDraft?.draftVersion).toBe(2);

    // Attempting to finalize with the old order ID and old authorization token MUST be rejected
    const failedFinalize = FinancialEngine.finalizePayment({
      authorizationToken: auth1.authorizationToken!,
      paypalOrderId: oldOrderId,
      paypalCaptureId: 'CAP-FAIL',
      isDemoMode: true,
      draftId: modTurn.activeDraft!.id,
      draftVersion: 1, // Stale version
    });

    expect(failedFinalize.success).toBe(false);
    expect(failedFinalize.message).toContain('mismatch');
  });

  // Scenario 3: Change recipient before approval
  it('Scenario 3: Changing recipient before approval invalidates previous order and authorization', async () => {
    ConversationalPaymentEngine.processTurn('Send $25 to Alice.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth1 = FinancialEngine.authorizeDraftWithDemoFingerprint();
    expect(auth1.success).toBe(true);

    const db = getDatabase();
    const oldOrderId = 'SANDBOX-ORD-ALICE';
    db.activeDraft!.paypalOrderId = oldOrderId;
    saveDatabase(db);

    // User changes recipient
    const modTurn = ConversationalPaymentEngine.processTurn('Change recipient to Bob.');
    expect(modTurn.activeDraft?.recipient).toBe('Bob');
    expect(modTurn.activeDraft?.amount).toBe(25);
    expect(modTurn.activeDraft?.paypalOrderId).toBeNull(); // Cleared
    expect(modTurn.activeDraft?.authorizationToken).toBeNull(); // Invalidation
    expect(modTurn.activeDraft?.draftVersion).toBe(2);

    // Stale authorization rejection
    const staleResult = FinancialEngine.finalizePayment({
      authorizationToken: auth1.authorizationToken!,
      paypalOrderId: oldOrderId,
      paypalCaptureId: 'CAP-STALE',
      isDemoMode: true,
      draftId: modTurn.activeDraft!.id,
      draftVersion: 1,
    });
    expect(staleResult.success).toBe(false);
  });

  // Scenario 4: Old PayPal order ID presented to active draft (Mismatch error)
  it('Scenario 4: Presenting an old or mismatched PayPal order ID to active draft is strictly rejected', () => {
    ConversationalPaymentEngine.processTurn('Pay $15 to Charlie.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    const legitimateOrderId = 'SANDBOX-ORD-LEGIT-999';
    db.activeDraft!.paypalOrderId = legitimateOrderId;
    saveDatabase(db);

    // Client presents an old or stale order ID: "SANDBOX-ORD-E7EGLSB"
    const mismatchedOrderId = 'SANDBOX-ORD-E7EGLSB';
    const mismatchResult = FinancialEngine.finalizePayment({
      authorizationToken: auth.authorizationToken!,
      paypalOrderId: mismatchedOrderId,
      paypalCaptureId: 'CAP-MISMATCH',
      isDemoMode: true,
      draftId: db.activeDraft!.id,
      draftVersion: db.activeDraft!.draftVersion,
    });

    expect(mismatchResult.success).toBe(false);
    expect(mismatchResult.message).toContain('PayPal order ID mismatch with active draft');
    expect(getDatabase().activeDraft).not.toBeNull();
  });

  // Scenario 5: Voice-triggered approval
  it('Scenario 5: Natural voice command triggers PayPal approval and automatic capture without second order', () => {
    const initBalance = getDatabase().account.balance;
    ConversationalPaymentEngine.processTurn('Pay $30 to Maria.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    const authoritativeOrderId = 'SANDBOX-ORD-MARIA-001';
    db.activeDraft!.paypalOrderId = authoritativeOrderId;
    db.activeDraft!.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
    saveDatabase(db);

    // Voice command: "Approve with PayPal."
    const voiceApproveTurn = ConversationalPaymentEngine.processTurn('Approve with PayPal.');

    expect(voiceApproveTurn.intent).toBe('APPROVE_AND_CAPTURE_PAYMENT');
    expect(voiceApproveTurn.stage).toBe('COMPLETED');
    expect(voiceApproveTurn.spokenResponse).toContain('captured successfully');
    expect(voiceApproveTurn.account?.balance).toBe(initBalance - 30);
    expect(getDatabase().account.balance).toBe(initBalance - 30);
  });

  // Scenario 6: Repeated voice approval command (Idempotency)
  it('Scenario 6: Repeated voice approval command returns idempotent response without double-debiting ledger', () => {
    const initBalance = getDatabase().account.balance;
    ConversationalPaymentEngine.processTurn('Pay $20 to Sam.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    db.activeDraft!.paypalOrderId = 'SANDBOX-ORD-SAM-001';
    db.activeDraft!.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
    saveDatabase(db);

    // First voice approval
    const turn1 = ConversationalPaymentEngine.processTurn('I want to approve this payment.');
    expect(turn1.stage).toBe('COMPLETED');
    expect(turn1.account?.balance).toBe(initBalance - 20);

    // Second repeated voice approval
    const turn2 = ConversationalPaymentEngine.processTurn('Approve with PayPal.');
    expect(turn2.stage).toBe('COMPLETED');
    expect(turn2.spokenResponse).toContain('already been completed');
    // Balance is STILL only debited once!
    expect(getDatabase().account.balance).toBe(initBalance - 20);
  });

  // Scenario 7: User cancels PayPal approval
  it('Scenario 7: User cancels PayPal approval cleanly with no balance changes', () => {
    const initBalance = getDatabase().account.balance;
    ConversationalPaymentEngine.processTurn('Pay $50 to Liam.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    FinancialEngine.authorizeDraftWithDemoFingerprint();

    // User speaks cancellation
    const cancelTurn = ConversationalPaymentEngine.processTurn('Cancel payment.');
    expect(cancelTurn.stage).toBe('IDLE');
    expect(cancelTurn.spokenResponse).toContain('cancelled');
    expect(cancelTurn.activeDraft).toBeNull();
    expect(getDatabase().activeDraft).toBeNull();
    expect(getDatabase().account.balance).toBe(initBalance);
  });

  // Scenario 8: Successful PayPal approval followed by automatic capture
  it('Scenario 8: Successful PayPal approval automatically captures payment without requiring a separate capture click', () => {
    const initBalance = getDatabase().account.balance;
    ConversationalPaymentEngine.processTurn('Send $45 to Emma.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    const orderId = 'SANDBOX-ORD-AUTO-CAP';
    db.activeDraft!.paypalOrderId = orderId;
    db.activeDraft!.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
    saveDatabase(db);

    // Finalize payment simulates the immediate auto-capture invoked upon buyer approval
    const autoCapResult = FinancialEngine.finalizePayment({
      authorizationToken: auth.authorizationToken!,
      paypalOrderId: orderId,
      paypalCaptureId: 'SANDBOX-CAP-12345',
      isDemoMode: true,
      draftId: db.activeDraft!.id,
      draftVersion: db.activeDraft!.draftVersion,
    });

    expect(autoCapResult.success).toBe(true);
    expect(autoCapResult.newBalance).toBe(initBalance - 45);
    expect(autoCapResult.completedTransaction?.status).toBe('completed');
    expect(autoCapResult.completedTransaction?.paypalCaptureId).toBe('SANDBOX-CAP-12345');
  });

  // Scenario 9: Failed capture handling
  it('Scenario 9: Unapproved orders or invalid capture states do not debit user account ledger', () => {
    const initBalance = getDatabase().account.balance;
    ConversationalPaymentEngine.processTurn('Pay $100 to Oliver.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    db.activeDraft!.paypalOrderId = 'SANDBOX-ORD-UNAPPROVED-TEST';
    db.activeDraft!.isBuyerApproved = false; // Never received genuine buyer approval
    saveDatabase(db);

    const captureAttempt = FinancialEngine.finalizePayment({
      authorizationToken: auth.authorizationToken!,
      paypalOrderId: 'SANDBOX-ORD-UNAPPROVED-TEST',
      paypalCaptureId: 'CAP-FAIL',
      isDemoMode: true,
    });

    expect(captureAttempt.success).toBe(false);
    expect(captureAttempt.message).toContain('buyer approval');
    // Balance strictly maintained
    expect(getDatabase().account.balance).toBe(initBalance);
  });

  // Scenario 10: Browser refresh during approval
  it('Scenario 10: Authoritative draft and order association persist across browser refresh / re-fetching', () => {
    ConversationalPaymentEngine.processTurn('Pay $80 to Lucas.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const auth = FinancialEngine.authorizeDraftWithDemoFingerprint();

    const db = getDatabase();
    const persistentOrderId = 'SANDBOX-ORD-PERSIST-10';
    db.activeDraft!.paypalOrderId = persistentOrderId;
    db.activeDraft!.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
    saveDatabase(db);

    // Simulate browser reload calling getFinancialSummary / getDatabase
    const refreshedSummary = FinancialEngine.getFinancialSummary();
    const persistedDraft = getDatabase().activeDraft;

    expect(persistedDraft).not.toBeNull();
    expect(persistedDraft?.recipient).toBe('Lucas');
    expect(persistedDraft?.amount).toBe(80);
    expect(persistedDraft?.paypalOrderId).toBe(persistentOrderId);
    expect(persistedDraft?.authorizationToken).toBe(auth.authorizationToken);
    expect(persistedDraft?.conversationStage).toBe('AWAITING_PAYPAL_APPROVAL');

    // Proceeding to approve on the reloaded state succeeds using the persisted order ID
    const finalizeAfterReload = FinancialEngine.finalizePayment({
      authorizationToken: persistedDraft!.authorizationToken!,
      paypalOrderId: persistedDraft!.paypalOrderId!,
      paypalCaptureId: 'CAP-AFTER-REFRESH',
      isDemoMode: true,
      draftId: persistedDraft!.id,
      draftVersion: persistedDraft!.draftVersion,
    });

    expect(finalizeAfterReload.success).toBe(true);
    expect(refreshedSummary.balance - 80).toBe(finalizeAfterReload.newBalance);
  });
});
