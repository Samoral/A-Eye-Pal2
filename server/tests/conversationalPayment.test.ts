import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoDatabase, getDatabase } from '../db.js';
import { ConversationalPaymentEngine } from '../conversationalEngine.js';
import { FinancialEngine } from '../financialEngine.js';
import { PayPalService } from '../paypalService.js';

describe('A-Eye Pal Conversational Payment Engine Transition Suite', () => {
  beforeEach(() => {
    resetDemoDatabase();
  });

  it('Turn 1: Initiates payment and asks whether to read details', () => {
    const turn1 = ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');

    expect(turn1.spokenResponse).toBe(
      'You are about to pay John $50. Would you like me to read the transaction details?'
    );
    expect(turn1.stage).toBe('AWAITING_DETAILS_CONFIRMATION');
    expect(turn1.activeDraft).not.toBeNull();
    expect(turn1.activeDraft?.recipient).toBe('John');
    expect(turn1.activeDraft?.amount).toBe(50);
    expect(turn1.activeDraft?.currency).toBe('USD');
    expect(turn1.activeDraft?.authorizationToken).toBeNull();
  });

  it('Turn 2: Reads complete details when user confirms with "Yes."', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    const turn2 = ConversationalPaymentEngine.processTurn('Yes.');

    expect(turn2.spokenResponse).toBe(
      'Recipient: John. Amount: $50 USD. Payment purpose: not specified. Is this correct?'
    );
    expect(turn2.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
    expect(turn2.activeDraft?.recipient).toBe('John');
  });

  it('Turn 3: Modifies amount, preserves recipient, and asks for confirmation with updated figures', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');

    // User says: "No, change it to $75."
    const turn3 = ConversationalPaymentEngine.processTurn('No, change it to $75.');

    expect(turn3.spokenResponse).toBe(
      'Your payment amount has been updated to $75. You are about to pay John $75 USD. Is this correct?'
    );
    expect(turn3.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
    expect(turn3.activeDraft?.amount).toBe(75);
    expect(turn3.activeDraft?.recipient).toBe('John'); // NEVER ask for recipient again
    expect(turn3.activeDraft?.authorizationToken).toBeNull();
  });

  it('Turn 4: Confirms updated details and asks for authorization', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('No, change it to $75.');

    // User says: "Yes."
    const turn4 = ConversationalPaymentEngine.processTurn('Yes.');

    expect(turn4.spokenResponse).toBe('Do you authorize this payment?');
    expect(turn4.stage).toBe('AWAITING_AUTHORIZATION');
    expect(turn4.activeDraft?.amount).toBe(75);
  });

  it('Turn 5 (Ambiguity Check): Never treats ambiguous speech as authorization', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('No, change it to $75.');
    ConversationalPaymentEngine.processTurn('Yes.'); // Now in AWAITING_AUTHORIZATION

    // User gives ambiguous answer
    const ambiguousTurn = ConversationalPaymentEngine.processTurn('maybe');

    expect(ambiguousTurn.spokenResponse).toContain('I did not receive a clear authorization');
    expect(ambiguousTurn.spokenResponse).toContain('Do you authorize this payment of $75 to John?');
    expect(ambiguousTurn.stage).toBe('AWAITING_AUTHORIZATION');
    expect(ambiguousTurn.activeDraft?.authorizationToken).toBeNull();
    expect(ambiguousTurn.modalAction).toBe('none');
  });

  it('Turn 5: Authorizes payment on explicit command and opens demo fingerprint verification', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('No, change it to $75.');
    ConversationalPaymentEngine.processTurn('Yes.');

    // User says: "I authorize this payment."
    const turn5 = ConversationalPaymentEngine.processTurn('I authorize this payment.');

    expect(turn5.spokenResponse).toBe(
      'Your payment is authorized. Please complete the demo fingerprint verification.'
    );
    expect(turn5.stage).toBe('AUTHORIZED_PENDING_FINGERPRINT');
    expect(turn5.modalAction).toBe('open_fingerprint');
    expect(turn5.activeDraft?.status).toBe('authorized');
    expect(turn5.activeDraft?.authorizationToken).toBeTruthy();
  });

  it('Simulated Fingerprint: Emits required demo announcement and transitions to PayPal checkout', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('I authorize this payment.');

    // Complete simulated fingerprint verification
    const fpResult = FinancialEngine.authorizeDraftWithDemoFingerprint();

    expect(fpResult.success).toBe(true);
    expect(fpResult.announcement).toContain('Demo fingerprint verification successful. No real fingerprint was accessed.');
    expect(fpResult.draft?.conversationStage).toBe('FINGERPRINT_VERIFIED');
  });

  it('Strict Invalidation: Any modification after authorization clears the authorization token', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('I authorize this payment.');

    const dbBefore = getDatabase();
    expect(dbBefore.activeDraft?.authorizationToken).toBeTruthy();

    // User changes mind and changes amount to $100
    const modTurn = ConversationalPaymentEngine.processTurn('Change it to $100');

    expect(modTurn.spokenResponse).toContain('Your payment amount has been updated to $100');
    expect(modTurn.activeDraft?.amount).toBe(100);
    expect(modTurn.activeDraft?.authorizationToken).toBeNull(); // Strictly invalidated!
    expect(modTurn.activeDraft?.status).toBe('draft');
    expect(modTurn.stage).toBe('AWAITING_CORRECTION_OR_APPROVAL');
  });

  it('Cancellation at each stage: Discards draft and resets state to IDLE', () => {
    // Stage 1 cancel
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    const cancel1 = ConversationalPaymentEngine.processTurn('Cancel');
    expect(cancel1.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancel1.stage).toBe('IDLE');
    expect(cancel1.activeDraft).toBeNull();

    // Stage 3 cancel
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const cancel2 = ConversationalPaymentEngine.processTurn('Stop');
    expect(cancel2.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancel2.stage).toBe('IDLE');
    expect(cancel2.activeDraft).toBeNull();

    // Stage 4 cancel
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.'); // in AWAITING_AUTHORIZATION
    const cancel3 = ConversationalPaymentEngine.processTurn('No');
    expect(cancel3.spokenResponse).toBe('Your payment draft has been cancelled.');
    expect(cancel3.stage).toBe('IDLE');
    expect(cancel3.activeDraft).toBeNull();
  });

  it('Recipient preservation: Updates recipient without asking for amount again', () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');

    // User changes recipient
    const modRecip = ConversationalPaymentEngine.processTurn('Change recipient to Sarah');

    expect(modRecip.activeDraft?.recipient).toBe('Sarah');
    expect(modRecip.activeDraft?.amount).toBe(50); // Preserved
    expect(modRecip.spokenResponse).toContain('Your recipient has been updated to Sarah');
    expect(modRecip.spokenResponse).toContain('You are about to pay Sarah $50 USD. Is this correct?');
  });

  it('Duplicate Capture Prevention: Deducts balance only once upon repeated capture requests', async () => {
    ConversationalPaymentEngine.processTurn('I want to pay $50 to John.');
    ConversationalPaymentEngine.processTurn('Yes.');
    ConversationalPaymentEngine.processTurn('Yes.');
    const authTurn = ConversationalPaymentEngine.processTurn('I authorize this payment.');
    const token = authTurn.activeDraft?.authorizationToken!;

    const order = await PayPalService.createOrder({
      amount: 50,
      currency: 'USD',
      recipient: 'John',
      purpose: 'not specified',
      referenceId: authTurn.activeDraft?.id!,
    });

    // Capture 1
    const capture1 = FinancialEngine.finalizePayment({
      authorizationToken: token,
      paypalOrderId: order.orderId,
      paypalCaptureId: 'CAP-DUP-1',
      isDemoMode: true,
    });

    expect(capture1.success).toBe(true);
    expect(capture1.newBalance).toBe(600.00); // 650 - 50 = 600

    // Capture 2 (Accidental duplicate / network retry)
    const capture2 = FinancialEngine.finalizePayment({
      authorizationToken: token,
      paypalOrderId: order.orderId,
      paypalCaptureId: 'CAP-DUP-2',
      isDemoMode: true,
    });

    expect(capture2.success).toBe(true);
    expect(capture2.newBalance).toBe(600.00); // BALANCE MUST REMAIN 600, NOT 550!
    expect(capture2.message).toContain('has already been completed via PayPal Sandbox');

    const db = getDatabase();
    // Only one debit record for this order
    const completedForOrder = db.transactions.filter(t => t.paypalOrderId === order.orderId);
    expect(completedForOrder.length).toBe(1);
  });
});
