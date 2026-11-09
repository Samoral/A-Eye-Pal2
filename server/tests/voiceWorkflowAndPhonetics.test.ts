import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase } from '../db.js';
import { ConversationalPaymentEngine } from '../conversationalEngine.js';
import { TranscriptCorrectionEngine } from '../transcriptCorrection.js';
import { FinancialEngine } from '../financialEngine.js';

describe('Voice-Controlled PayPal Automatic Capture & Accuracy Suite', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  // Scenario 1: Normal voice flow with AUTOMATIC CAPTURE on PayPal approval
  it('Scenario 1: Complete end-to-end voice flow with automatic capture on PayPal approval', () => {
    // 1. Initiate
    const turn1 = ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    expect(turn1.stage).toBe('AWAITING_DETAILS_CONFIRMATION');
    expect(turn1.activeDraft?.amount).toBe(50);
    expect(turn1.activeDraft?.recipient).toBe('John');

    // 2. Review confirmation
    const turn2 = ConversationalPaymentEngine.processTurn('Confirm this payment');
    expect(turn2.spokenResponse).toBe('Do you authorize this payment?');
    expect(turn2.stage).toBe('AWAITING_AUTHORIZATION');

    // 3. Authorization
    const turn3 = ConversationalPaymentEngine.processTurn('I authorize this payment');
    expect(turn3.spokenResponse).toBe(
      'Your payment is authorized. Please complete the demo fingerprint verification.'
    );
    expect(turn3.stage).toBe('AUTHORIZED_PENDING_FINGERPRINT');
    expect(turn3.activeDraft?.status).toBe('authorized');
    expect(turn3.activeDraft?.authorizationToken).toBeTruthy();

    // 4. PayPal Sandbox approval with AUTOMATIC CAPTURE
    const turn4 = ConversationalPaymentEngine.processTurn('Approve payment');
    expect(turn4.spokenResponse).toContain('PayPal approval received. Completing your payment. Your payment has been captured successfully.');
    expect(turn4.spokenResponse).toContain('600.00'); // 650.00 - 50.00 = 600.00
    expect(turn4.stage).toBe('COMPLETED');
    expect(turn4.activeDraft).toBeNull();

    const db = getDatabase();
    expect(db.account.balance).toBe(600.00);

    // 5. Subsequent capture request is safely handled idempotently without duplicate debit
    const turn5 = ConversationalPaymentEngine.processTurn('Capture payment');
    expect(turn5.spokenResponse).toBe(
      'This payment has already been completed and captured. No duplicate payment was processed.'
    );
    expect(getDatabase().account.balance).toBe(600.00); // Still 600.00!
  });

  // Scenario 2: Phonetic correction "B 50 dollars to John"
  it('Scenario 2: Phonetic correction of "B 50 dollars to John" correctly interpreted as "Pay 50 dollars to John"', () => {
    const correction = TranscriptCorrectionEngine.correct('B 50 dollars to John');
    expect(correction.isCorrected).toBe(true);
    expect(correction.interpretedTranscript.toLowerCase()).toBe('pay 50 dollars to john');

    const turn = ConversationalPaymentEngine.processTurn('B 50 dollars to John');
    expect(turn.isCorrected).toBe(true);
    expect(turn.spokenResponse).toBe('I understood that you want to pay John 50 dollars. Is that correct?');
    expect(turn.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
    expect(turn.activeDraft?.amount).toBe(50);
    expect(turn.activeDraft?.recipient).toBe('John');
  });

  // Scenario 3: Phonetic correction "Play 50 dollars to John"
  it('Scenario 3: Phonetic correction of "Play 50 dollars to John" correctly interpreted as "Pay 50 dollars to John"', () => {
    const correction = TranscriptCorrectionEngine.correct('Play 50 dollars to John');
    expect(correction.isCorrected).toBe(true);
    expect(correction.interpretedTranscript.toLowerCase()).toBe('pay 50 dollars to john');

    const turn = ConversationalPaymentEngine.processTurn('Play 50 dollars to John');
    expect(turn.isCorrected).toBe(true);
    expect(turn.spokenResponse).toBe('I understood that you want to pay John 50 dollars. Is that correct?');
    expect(turn.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
    expect(turn.activeDraft?.amount).toBe(50);
    expect(turn.activeDraft?.recipient).toBe('John');
  });

  // Scenario 4: Clarification on ambiguous input: "Play" alone
  it('Scenario 4: Clarification on ambiguous input: "Play" alone asks "I didn\'t catch that clearly. Did you say pay, or play?"', () => {
    const turn = ConversationalPaymentEngine.processTurn('Play');
    expect(turn.spokenResponse).toBe("I didn't catch that clearly. Did you say pay, or play?");
    expect(turn.intent).toBe('AMBIGUOUS_SPEECH');
    expect(turn.activeDraft).toBeNull();
  });

  // Scenario 5: Voice review confirmation "Confirm this payment"
  it('Scenario 5: Voice review confirmation: "Confirm this payment" advances from review to authorization', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    const turn = ConversationalPaymentEngine.processTurn('Confirm this payment');

    expect(turn.spokenResponse).toBe('Do you authorize this payment?');
    expect(turn.stage).toBe('AWAITING_AUTHORIZATION');
    expect(turn.intent).toBe('CONFIRM_TRANSACTION');
  });

  // Scenario 6: Voice review confirmation "Yes, the details are correct"
  it('Scenario 6: Voice review confirmation: "Yes, the details are correct" advances from review to authorization', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    const turn = ConversationalPaymentEngine.processTurn('Yes, the details are correct');

    expect(turn.spokenResponse).toBe('Do you authorize this payment?');
    expect(turn.stage).toBe('AWAITING_AUTHORIZATION');
    expect(turn.intent).toBe('CONFIRM_TRANSACTION');
  });

  // Scenario 7: Voice review confirmation "Proceed with this payment"
  it('Scenario 7: Voice review confirmation: "Proceed with this payment" advances from review to authorization', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    const turn = ConversationalPaymentEngine.processTurn('Proceed with this payment');

    expect(turn.spokenResponse).toBe('Do you authorize this payment?');
    expect(turn.stage).toBe('AWAITING_AUTHORIZATION');
    expect(turn.intent).toBe('CONFIRM_TRANSACTION');
  });

  // Scenario 8: Voice PayPal approval "Approve payment" triggers automatic capture
  it('Scenario 8: Voice PayPal approval: "Approve payment" automatically captures and settles payment', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    ConversationalPaymentEngine.processTurn('I authorize this payment');

    const turn = ConversationalPaymentEngine.processTurn('Approve payment');
    expect(turn.spokenResponse).toContain('PayPal approval received. Completing your payment. Your payment has been captured successfully.');
    expect(turn.spokenResponse).toContain('600.00');
    expect(turn.stage).toBe('COMPLETED');
    expect(getDatabase().account.balance).toBe(600.00);
  });

  // Scenario 9: Voice PayPal approval "Continue to PayPal" triggers automatic capture
  it('Scenario 9: Voice PayPal approval: "Continue to PayPal" automatically captures and settles payment', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    ConversationalPaymentEngine.processTurn('I authorize this payment');

    const turn = ConversationalPaymentEngine.processTurn('Continue to PayPal');
    expect(turn.spokenResponse).toContain('PayPal approval received. Completing your payment. Your payment has been captured successfully.');
    expect(turn.spokenResponse).toContain('600.00');
    expect(turn.stage).toBe('COMPLETED');
    expect(getDatabase().account.balance).toBe(600.00);
  });

  // Scenario 10: Declined payment (insufficient funds)
  it('Scenario 10: Declined payment: Payment exceeding available balance is strictly declined', () => {
    ConversationalPaymentEngine.processTurn('Pay 1000 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');

    // Attempt authorization with $1000 when balance is $650
    const turn = ConversationalPaymentEngine.processTurn('I authorize this payment');
    expect(turn.spokenResponse).toContain('Payment authorization declined');
    expect(turn.spokenResponse).toContain('exceeds available demo balance by $350.00');
    expect(turn.stage).toBe('AWAITING_AUTHORIZATION');
    expect(getDatabase().account.balance).toBe(650.00);
  });

  // Scenario 11: Unapproved order cannot be captured
  it('Scenario 11: Unapproved order: Attempting capture before approval is strictly rejected', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    const authTurn = ConversationalPaymentEngine.processTurn('I authorize this payment');
    const token = authTurn.activeDraft?.authorizationToken!;

    // Server-side check: Attempting capture on unapproved order
    const finalizeAttempt = FinancialEngine.finalizePayment({
      authorizationToken: token,
      paypalOrderId: 'ORD-UNAPPROVED-99',
      paypalCaptureId: 'CAP-FAIL',
      isDemoMode: true,
    });

    expect(finalizeAttempt.success).toBe(false);
    expect(finalizeAttempt.message).toContain('Cannot capture payment. The PayPal order has not received buyer approval yet.');
    expect(getDatabase().account.balance).toBe(650.00); // Balance untouched!
  });

  // Scenario 12: Idempotent capture prevents double-debiting
  it('Scenario 12: Idempotent capture: Repeated capture requests do not double debit', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    ConversationalPaymentEngine.processTurn('I authorize this payment');
    ConversationalPaymentEngine.processTurn('Approve payment'); // Automatically captures ($650 -> $600)

    expect(getDatabase().account.balance).toBe(600.00);

    // Repeated capture commands
    const repeat1 = ConversationalPaymentEngine.processTurn('Capture payment');
    expect(repeat1.spokenResponse).toBe(
      'This payment has already been completed and captured. No duplicate payment was processed.'
    );
    expect(getDatabase().account.balance).toBe(600.00);

    const repeat2 = ConversationalPaymentEngine.processTurn('Complete the payment');
    expect(repeat2.spokenResponse).toBe(
      'This payment has already been completed and captured. No duplicate payment was processed.'
    );
    expect(getDatabase().account.balance).toBe(600.00);
  });

  // Scenario 13: Changed transaction details strictly invalidates authorization
  it('Scenario 13: Changed transaction details: Invalidate authorization and prevent capture with stale token', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    const authTurn = ConversationalPaymentEngine.processTurn('I authorize this payment');
    const token = authTurn.activeDraft?.authorizationToken!;

    expect(token).toBeTruthy();

    // User modifies amount to $75
    const modTurn = ConversationalPaymentEngine.processTurn('Change amount to $75');
    expect(modTurn.activeDraft?.amount).toBe(75);
    expect(modTurn.activeDraft?.authorizationToken).toBeNull(); // Cleared!
    expect(modTurn.activeDraft?.isBuyerApproved).toBe(false);

    // Attempting to finalize with the old token is rejected
    const staleAttempt = FinancialEngine.finalizePayment({
      authorizationToken: token,
      paypalOrderId: 'SANDBOX-ORD-STALE',
      paypalCaptureId: 'CAP-STALE',
      isDemoMode: true,
    });

    expect(staleAttempt.success).toBe(false);
    expect(staleAttempt.message).toContain('Authorization token mismatch or expired');
    expect(getDatabase().account.balance).toBe(650.00);
  });

  // Scenario 14: Simulated fingerprint verification announces required accessibility phrases
  it('Scenario 14: Biometric simulation: Emits required accessibility announcements', () => {
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');

    const fpResult = FinancialEngine.authorizeDraftWithDemoFingerprint();
    expect(fpResult.success).toBe(true);
    expect(fpResult.announcement).toContain('Fingerprint verification successful. Your payment is authorized.');
    expect(fpResult.announcement).toContain('Proceeding to PayPal Sandbox.');
  });

  // Scenario 15: Voice cancellation at each stage
  it('Scenario 15: Voice cancellation: "Cancel this payment" or "Stop this transaction" works at all stages', () => {
    // 15A: During review stage
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    const cancelReview = ConversationalPaymentEngine.processTurn('Cancel this payment');
    expect(cancelReview.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancelReview.stage).toBe('IDLE');
    expect(cancelReview.activeDraft).toBeNull();

    // 15B: During authorization stage
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    const cancelAuth = ConversationalPaymentEngine.processTurn('Stop this transaction');
    expect(cancelAuth.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancelAuth.stage).toBe('IDLE');
    expect(cancelAuth.activeDraft).toBeNull();

    // 15C: During PayPal stage
    ConversationalPaymentEngine.processTurn('Pay 50 dollars to John');
    ConversationalPaymentEngine.processTurn('Confirm this payment');
    ConversationalPaymentEngine.processTurn('I authorize this payment');
    const cancelApprove = ConversationalPaymentEngine.processTurn('I don\'t want to continue');
    expect(cancelApprove.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancelApprove.stage).toBe('IDLE');
    expect(cancelApprove.activeDraft).toBeNull();
  });
});
