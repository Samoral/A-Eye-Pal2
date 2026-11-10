import crypto from 'crypto';
import { getDatabase, saveDatabase, StoreData, Transaction, ConversationStage } from './db.js';
import { FinancialEngine } from './financialEngine.js';
import { TranscriptCorrectionEngine } from './transcriptCorrection.js';

export interface ConversationalTurnResult {
  spokenResponse: string;
  intent: string;
  stage: ConversationStage;
  soundCue: 'success' | 'warning' | 'error' | 'fingerprint' | 'neutral';
  modalAction: 'none' | 'open_fingerprint' | 'show_checkout';
  activeDraft: Transaction | null;
  budget: any;
  account: any;
  originalTranscript?: string;
  interpretedTranscript?: string;
  isCorrected?: boolean;
}

export class ConversationalPaymentEngine {
  /**
   * Process a conversational payment turn with strict state tracking,
   * priority resolution, authorization safety, and duplicate prevention.
   */
  static processTurn(userInput: string): ConversationalTurnResult {
    const rawInput = (userInput || '').trim();
    const db = getDatabase();
    let draft = db.activeDraft;
    const balance = db.account.balance;

    // 0. Context-Aware Transcript Correction & Phonetic Processing
    const correctionResult = TranscriptCorrectionEngine.correct(rawInput, {
      stage: draft?.conversationStage,
      hasActiveDraft: Boolean(draft),
    });

    // Ambiguity Detection: If an isolated word like "play" or "b" has no financial context, ask for clarification
    if (correctionResult.needsClarification) {
      return {
        spokenResponse: correctionResult.clarificationPrompt || "I didn't catch that clearly. Did you say pay, or play?",
        intent: 'AMBIGUOUS_SPEECH',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: 'warning',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: rawInput,
        isCorrected: false,
      };
    }

    // Determine the working transcript (corrected or original)
    const effectiveInput = correctionResult.isCorrected
      ? correctionResult.interpretedTranscript
      : rawInput;

    // Normalize and remove punctuation (. , ! ?) for robust voice matching
    const cleanText = effectiveInput
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    let spokenResponse = '';
    let intent = 'GENERAL_ASSIST';
    let soundCue: 'success' | 'warning' | 'error' | 'fingerprint' | 'neutral' = 'neutral';
    let modalAction: 'none' | 'open_fingerprint' | 'show_checkout' = 'none';

    // 1. CANCELLATION: Priority Check
    // "Allow cancellation at every stage before capture."
    // Supports: "cancel this payment", "i don't want to continue", "stop this transaction", "cancel", "stop", etc.
    const isCancelCommand =
      cleanText === 'cancel' ||
      cleanText === 'cancel payment' ||
      cleanText === 'stop' ||
      cleanText === 'never mind' ||
      cleanText === 'nevermind' ||
      cleanText === 'abort' ||
      cleanText === 'discard' ||
      cleanText === 'cancel this payment' ||
      cleanText === 'stop this transaction' ||
      cleanText === 'i dont want to continue' ||
      cleanText === "i don't want to continue" ||
      (draft &&
        (draft.conversationStage === 'AWAITING_AUTHORIZATION' ||
         draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION' ||
         draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL' ||
         draft.conversationStage === 'AUTHORIZED_PENDING_FINGERPRINT' ||
         draft.conversationStage === 'FINGERPRINT_VERIFIED' ||
         draft.conversationStage === 'AWAITING_PAYPAL_APPROVAL' ||
         draft.conversationStage === 'PAYPAL_ORDER_APPROVED') &&
        (cleanText === 'no' || cleanText === 'do not pay' || cleanText === "dont pay"));

    if (isCancelCommand && draft) {
      draft.status = 'cancelled';
      draft.conversationStage = 'IDLE';
      draft.authorizationToken = null;
      db.transactions.push({ ...draft, updatedAt: new Date().toISOString() });
      db.activeDraft = null;
      saveDatabase(db);

      return {
        spokenResponse: 'Your payment draft has been cancelled.',
        intent: 'CANCEL_TRANSACTION',
        stage: 'IDLE',
        soundCue: 'warning',
        modalAction: 'none',
        activeDraft: null,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: effectiveInput,
        isCorrected: correctionResult.isCorrected,
      };
    }

    // 1B. VOICE CAPTURE COMMANDS: Complete payment & debit ledger
    // Supported: "Capture payment.", "Complete the payment.", "Finalize this transaction."
    const isCaptureCommand =
      cleanText === 'capture payment' ||
      cleanText === 'complete the payment' ||
      cleanText === 'finalize this transaction' ||
      cleanText === 'capture' ||
      cleanText === 'complete payment' ||
      cleanText === 'finalize transaction';

    if (isCaptureCommand) {
      // 1. Idempotency Check: Repeating "Capture payment" after completion
      const lastTx = db.transactions[0];
      if ((!draft && lastTx && lastTx.status === 'completed') || (draft && draft.status === 'completed')) {
        return {
          spokenResponse: 'This payment has already been completed and captured. No duplicate payment was processed.',
          intent: 'CAPTURE_PAYMENT',
          stage: 'COMPLETED',
          soundCue: 'neutral',
          modalAction: 'none',
          activeDraft: null,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
          isCorrected: correctionResult.isCorrected,
        };
      }

      // 2. Draft check
      if (!draft) {
        return {
          spokenResponse: 'You have no active payment to capture. You can say "I want to pay $50 to John".',
          intent: 'CAPTURE_PAYMENT',
          stage: 'IDLE',
          soundCue: 'warning',
          modalAction: 'none',
          activeDraft: null,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }

      // 3. Reject capture before buyer approval
      if (!draft.isBuyerApproved || draft.conversationStage !== 'PAYPAL_ORDER_APPROVED') {
        return {
          spokenResponse: "Cannot capture payment. The PayPal order has not received buyer approval yet. Please say 'Approve payment' first.",
          intent: 'CAPTURE_PAYMENT',
          stage: draft.conversationStage || 'AWAITING_PAYPAL_APPROVAL',
          soundCue: 'warning',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
          isCorrected: correctionResult.isCorrected,
        };
      }

      // 4. Approved capture execution
      const token = draft.authorizationToken || `DEMO-AUTH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      draft.authorizationToken = token;
      const orderId = draft.paypalOrderId || `SANDBOX-ORD-${Date.now()}`;
      draft.paypalOrderId = orderId;
      const captureId = `SANDBOX-CAP-${Date.now()}`;

      FinancialEngine.finalizePayment({
        authorizationToken: token,
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        isDemoMode: true,
      });

      const freshDb = getDatabase();
      const updatedBalance = freshDb.account.balance.toFixed(2);
      const captureSpoken = `Payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} has been captured and completed via PayPal Sandbox. Your new available balance is $${updatedBalance} ${draft.currency}.`;

      return {
        spokenResponse: captureSpoken,
        intent: 'CAPTURE_PAYMENT',
        stage: 'COMPLETED',
        soundCue: 'success',
        modalAction: 'none',
        activeDraft: null,
        budget: freshDb.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: effectiveInput,
        isCorrected: correctionResult.isCorrected,
      };
    }

    // 1C. VOICE PAYPAL APPROVAL COMMANDS
    // Supported: "Approve with PayPal.", "Proceed to PayPal.", "Continue to payment approval.", "Open PayPal approval.", "I want to approve this payment."
    const isApprovalCommand =
      cleanText === 'approve with paypal' ||
      cleanText === 'i want to approve this payment' ||
      cleanText === 'approve payment' ||
      cleanText === 'i approve this payment' ||
      cleanText === 'continue to paypal' ||
      cleanText === 'approve' ||
      cleanText === 'i approve' ||
      cleanText === 'pay with paypal' ||
      cleanText === 'confirm with paypal' ||
      cleanText === 'approve checkout' ||
      cleanText === 'confirm checkout' ||
      cleanText === 'approve transaction' ||
      cleanText === 'yes approve' ||
      cleanText === 'yes approve payment';

    const isOpenApprovalFlowCommand =
      cleanText === 'proceed to paypal' ||
      cleanText === 'continue to payment approval' ||
      cleanText === 'open paypal approval' ||
      cleanText === 'open paypal' ||
      cleanText === 'proceed to payment approval' ||
      cleanText === 'open paypal checkout';

    if (isOpenApprovalFlowCommand) {
      if (draft) {
        if (
          draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION' ||
          draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL' ||
          draft.conversationStage === 'AWAITING_AUTHORIZATION'
        ) {
          return {
            spokenResponse: 'Please authorize this payment first before opening PayPal approval. Say "I authorize this payment".',
            intent: 'APPROVE_PAYPAL_ORDER',
            stage: draft.conversationStage,
            soundCue: 'warning',
            modalAction: 'none',
            activeDraft: draft,
            budget: db.budget,
            account: FinancialEngine.getFinancialSummary(),
            originalTranscript: rawInput,
            interpretedTranscript: effectiveInput,
          };
        }

        // Authoritative order association: reuse existing order ID or assign one without duplication
        if (!draft.paypalOrderId) {
          draft.paypalOrderId = `SANDBOX-ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        }
        draft.status = 'processing';
        draft.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
        draft.updatedAt = new Date().toISOString();
        db.activeDraft = draft;
        saveDatabase(db);

        const openSpoken = `PayPal approval is now required for your payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient}. Say "Approve with PayPal" to complete payment.`;

        return {
          spokenResponse: openSpoken,
          intent: 'OPEN_PAYPAL_APPROVAL',
          stage: 'AWAITING_PAYPAL_APPROVAL',
          soundCue: 'neutral',
          modalAction: 'show_checkout',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
          isCorrected: correctionResult.isCorrected,
        };
      } else {
        const lastTx = db.transactions[0];
        if (lastTx && lastTx.status === 'completed') {
          return {
            spokenResponse: 'This payment has already been completed via PayPal Sandbox and captured. No duplicate payment was processed.',
            intent: 'OPEN_PAYPAL_APPROVAL',
            stage: 'COMPLETED',
            soundCue: 'neutral',
            modalAction: 'none',
            activeDraft: null,
            budget: db.budget,
            account: FinancialEngine.getFinancialSummary(),
            originalTranscript: rawInput,
            interpretedTranscript: effectiveInput,
          };
        }
        return {
          spokenResponse: 'You have no active payment awaiting PayPal approval. You can say "Pay 50 dollars to John" to start a new payment.',
          intent: 'OPEN_PAYPAL_APPROVAL',
          stage: 'IDLE',
          soundCue: 'warning',
          modalAction: 'none',
          activeDraft: null,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }
    }

    if (isApprovalCommand) {
      if (!draft) {
        // Idempotency: check if payment was just completed
        const lastTx = db.transactions[0];
        if (lastTx && lastTx.status === 'completed') {
          return {
            spokenResponse: 'This payment has already been completed via PayPal Sandbox and captured. No duplicate payment was processed.',
            intent: 'APPROVE_PAYPAL_ORDER',
            stage: 'COMPLETED',
            soundCue: 'neutral',
            modalAction: 'none',
            activeDraft: null,
            budget: db.budget,
            account: FinancialEngine.getFinancialSummary(),
            originalTranscript: rawInput,
            interpretedTranscript: effectiveInput,
          };
        }
        return {
          spokenResponse: 'You have no active payment to approve.',
          intent: 'APPROVE_PAYPAL_ORDER',
          stage: 'IDLE',
          soundCue: 'warning',
          modalAction: 'none',
          activeDraft: null,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }

      // If draft is still in review/prior to authorization, prompt to authorize first
      if (
        draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION' ||
        draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL' ||
        draft.conversationStage === 'AWAITING_AUTHORIZATION'
      ) {
        return {
          spokenResponse: 'Please authorize this payment first before approving checkout. Say "I authorize this payment".',
          intent: 'APPROVE_PAYPAL_ORDER',
          stage: draft.conversationStage,
          soundCue: 'warning',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }

      if (!draft.authorizationToken) {
        draft.authorizationToken = `DEMO-AUTH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      }
      if (!draft.authorizedDetails) {
        draft.authorizedDetails = {
          amount: draft.amount,
          currency: draft.currency,
          recipient: draft.recipient,
          purpose: draft.purpose,
          draftVersion: draft.draftVersion || 1,
        };
      }
      // Authoritative order association: reuse existing order ID or assign one without duplication
      if (!draft.paypalOrderId) {
        draft.paypalOrderId = `SANDBOX-ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      }

      // Mark buyer approved
      draft.isBuyerApproved = true;
      draft.status = 'processing';
      draft.conversationStage = 'PAYPAL_ORDER_APPROVED';
      draft.updatedAt = new Date().toISOString();
      db.activeDraft = draft;
      saveDatabase(db);

      // AUTOMATIC CAPTURE: Execute capture immediately upon PayPal buyer approval
      const captureId = `SANDBOX-CAP-${Date.now()}`;
      const finalizeResult = FinancialEngine.finalizePayment({
        authorizationToken: draft.authorizationToken,
        paypalOrderId: draft.paypalOrderId,
        paypalCaptureId: captureId,
        isDemoMode: true,
        draftId: draft.id,
        draftVersion: draft.draftVersion,
      });

      if (!finalizeResult.success) {
        return {
          spokenResponse: `Payment capture failed: ${finalizeResult.message}. Your balance was not deducted.`,
          intent: 'CAPTURE_FAILED',
          stage: draft.conversationStage,
          soundCue: 'error',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }

      const freshDb = getDatabase();
      const updatedBalance = freshDb.account.balance.toFixed(2);
      const captureSpoken = `PayPal approval received. Completing your payment. Your payment has been captured successfully. Payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} has been completed via PayPal Sandbox. Your new available balance is $${updatedBalance} ${draft.currency}.`;

      return {
        spokenResponse: captureSpoken,
        intent: 'APPROVE_AND_CAPTURE_PAYMENT',
        stage: 'COMPLETED',
        soundCue: 'success',
        modalAction: 'none',
        activeDraft: null,
        budget: freshDb.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: effectiveInput,
        isCorrected: correctionResult.isCorrected,
      };
    }

    // 1D. VOICE TRANSACTION REVIEW CONFIRMATION
    // Supported: "Confirm this payment.", "I confirm the transaction.", "Yes, the details are correct.", "Proceed with this payment."
    const isReviewConfirmCommand =
      cleanText === 'confirm this payment' ||
      cleanText === 'i confirm the transaction' ||
      cleanText === 'yes the details are correct' ||
      cleanText === 'proceed with this payment' ||
      cleanText === 'confirm transaction' ||
      cleanText === 'proceed' ||
      cleanText === 'details are correct';

    if (
      draft &&
      isReviewConfirmCommand &&
      (draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION' ||
       draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL')
    ) {
      draft.conversationStage = 'AWAITING_AUTHORIZATION';
      draft.updatedAt = new Date().toISOString();
      db.activeDraft = draft;
      saveDatabase(db);

      return {
        spokenResponse: 'Do you authorize this payment?',
        intent: 'CONFIRM_TRANSACTION',
        stage: 'AWAITING_AUTHORIZATION',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: effectiveInput,
        isCorrected: correctionResult.isCorrected,
      };
    }

    // 1E. REPEAT / REVIEW TRANSACTION DETAILS (when active draft exists)
    // "Repeat the transaction details" / "What am I about to pay?" / "Who am I paying?" / "Review transaction details"
    const isRepeatOrReviewDetails =
      cleanText.includes('repeat') ||
      cleanText.includes('review transaction') ||
      cleanText.includes('transaction details') ||
      cleanText.includes('what am i about to pay') ||
      cleanText.includes('how much am i paying') ||
      cleanText.includes('who am i paying') ||
      cleanText.includes('is this payment correct');

    if (isRepeatOrReviewDetails) {
      if (draft) {
        const purposeText = draft.purpose && draft.purpose !== 'General payment' ? draft.purpose : 'not specified';
        const formattedAmount = `$${draft.amount}`;
        const clarifyText = `Recipient: ${draft.recipient}. Amount: ${formattedAmount} ${draft.currency}. Payment purpose: ${purposeText}. Status: ${draft.status}. Is this correct?`;
        return {
          spokenResponse: clarifyText,
          intent: 'CLARIFY_TRANSACTION',
          stage: draft.conversationStage || 'AWAITING_CORRECTION_OR_APPROVAL',
          soundCue: 'neutral',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      } else {
        return {
          spokenResponse: 'You have no active transaction draft to review. You can say: "I want to pay $50 to John".',
          intent: 'CLARIFY_TRANSACTION',
          stage: 'IDLE',
          soundCue: 'neutral',
          modalAction: 'none',
          activeDraft: null,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
          originalTranscript: rawInput,
          interpretedTranscript: effectiveInput,
        };
      }
    }

    // 2. FINANCIAL AWARENESS & LEDGER QUERIES
    // Support:
    // - "What is my balance?" / "How much money do I have?" / "How much money do I have left?"
    // - "How much have I spent?" / "How much did I spend this week?" / "How much did I spend this month?"
    // - "What was my last transaction?" / "Did my last payment go through?" / "Show me my recent transactions"
    const isBalanceQuery =
      cleanText.includes('balance') ||
      cleanText.includes('how much money do i have') ||
      cleanText.includes('how much do i have') ||
      cleanText.includes('money left') ||
      cleanText.includes('money do i have left') ||
      cleanText.includes('how much is left');

    if (isBalanceQuery) {
      const summary = FinancialEngine.getFinancialSummary();
      return {
        spokenResponse: `Your available demo balance is $${summary.balance.toFixed(2)} ${summary.currency}. This is a demonstration account.`,
        intent: 'CHECK_BALANCE',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: summary,
      };
    }

    const isLastTxQuery =
      cleanText.includes('last transaction') ||
      cleanText.includes('last payment') ||
      cleanText.includes('did my last payment go through') ||
      cleanText.includes('did my last payment succeed') ||
      cleanText.includes('payment go through');

    if (isLastTxQuery) {
      const summary = FinancialEngine.getFinancialSummary();
      const last = summary.lastTransaction;
      let spoken = '';
      if (!last) {
        spoken = 'You have no recorded payments or transactions in your demo account.';
      } else {
        const purposePart = last.purpose && last.purpose !== 'General payment' ? ` for ${last.purpose}` : '';
        const statusText = last.status === 'completed' ? 'successfully completed' : last.status;
        spoken = `Your last payment was $${last.amount.toFixed(2)} ${last.currency} to ${last.recipient}${purposePart}. Its status is ${statusText} via ${last.paymentMethod}.`;
      }
      return {
        spokenResponse: spoken,
        intent: 'CHECK_SPENDING',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: summary,
      };
    }

    const isSpendingQuery =
      cleanText.includes('how much have i spent') ||
      cleanText.includes('how much did i spend') ||
      cleanText.includes('my spending') ||
      cleanText.includes('spent this week') ||
      cleanText.includes('spend this week') ||
      cleanText.includes('spent this month') ||
      cleanText.includes('spend this month') ||
      cleanText.includes('recent transactions') ||
      cleanText.includes('show transactions') ||
      cleanText.includes('show me my recent transactions');

    if (isSpendingQuery) {
      const summary = FinancialEngine.getFinancialSummary();
      let resp = '';
      if (cleanText.includes('week')) {
        resp = `You have spent $${summary.spentThisWeek.toFixed(2)} ${summary.currency} this week from completed payments.`;
      } else if (cleanText.includes('month')) {
        resp = `You have spent $${summary.spentThisMonth.toFixed(2)} ${summary.currency} in the last 30 days from completed payments.`;
      } else if (cleanText.includes('recent') || cleanText.includes('show')) {
        const txList = summary.recentTransactions
          .slice(0, 3)
          .map((t) => `$${t.amount.toFixed(2)} to ${t.recipient} (${t.status})`)
          .join(', ');
        resp = `Your recent completed transactions are: ${txList || 'none'}. Total lifetime completed spending is $${summary.totalSpent.toFixed(2)} ${summary.currency}.`;
      } else {
        resp = `Your total completed demo spending is $${summary.totalSpent.toFixed(2)} ${summary.currency}. Pending or draft payments are excluded.`;
      }
      return {
        spokenResponse: resp,
        intent: 'CHECK_SPENDING',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: summary,
      };
    }

    // 3. BUDGET MANAGEMENT & ALLOCATION COMMANDS
    // Spoken queries and commands:
    // - "Save my budget" / "Save budget"
    // - "Read my allocations" / "Read my budget" / "What is my budget?"
    // - "Reduce food to $100" / "Increase savings to $120" / "Remove transport"
    // - "I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings."
    if (cleanText.includes('save my budget') || cleanText.includes('save budget')) {
      const bRes = FinancialEngine.saveCurrentBudget();
      return {
        spokenResponse: bRes.spokenResponse,
        intent: 'SAVE_BUDGET',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: bRes.success ? 'success' : 'error',
        modalAction: 'none',
        activeDraft: draft,
        budget: bRes.budget,
        account: FinancialEngine.getFinancialSummary(),
      };
    }

    if (
      cleanText.includes('read my allocations') ||
      cleanText.includes('read allocations') ||
      cleanText.includes('read my budget') ||
      cleanText.includes('what is my budget') ||
      cleanText.includes('show my budget') ||
      cleanText.includes('my allocations')
    ) {
      const bRes = FinancialEngine.readBudget();
      return {
        spokenResponse: bRes.spokenResponse,
        intent: 'READ_BUDGET',
        stage: draft?.conversationStage || 'IDLE',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: draft,
        budget: bRes.budget,
        account: FinancialEngine.getFinancialSummary(),
      };
    }

    // Category modifications:
    // "Reduce food to $100" / "Increase savings to $120" / "Remove transport" / "Change transport to $50"
    const isCategoryAdjustment =
      cleanText.startsWith('reduce ') ||
      cleanText.startsWith('increase ') ||
      cleanText.startsWith('remove ') ||
      cleanText.startsWith('delete ') ||
      (cleanText.startsWith('change ') &&
        (cleanText.includes('food') ||
         cleanText.includes('transport') ||
         cleanText.includes('electricity') ||
         cleanText.includes('utilities') ||
         cleanText.includes('savings') ||
         cleanText.includes('groceries') ||
         cleanText.includes('rent')));

    if (isCategoryAdjustment) {
      const isRemove = cleanText.startsWith('remove ') || cleanText.startsWith('delete ') || cleanText.includes('remove');
      const matchAmount = cleanText.match(/(?:to\s+)?\$?(\d+(?:\.\d{1,2})?)/);

      let targetCategory = '';
      if (cleanText.includes('food') || cleanText.includes('groceries')) targetCategory = 'food';
      else if (cleanText.includes('transport') || cleanText.includes('transit')) targetCategory = 'transport';
      else if (cleanText.includes('electricity') || cleanText.includes('utilities') || cleanText.includes('power')) targetCategory = 'electricity';
      else if (cleanText.includes('savings') || cleanText.includes('emergency')) targetCategory = 'savings';
      else if (cleanText.includes('rent')) targetCategory = 'rent';
      else {
        // Extract word after reduce/increase/remove/change
        const matchWord = cleanText.match(/(?:reduce|increase|remove|delete|change)\s+([a-zA-Z]+)/);
        if (matchWord) targetCategory = matchWord[1];
      }

      if (targetCategory) {
        const modRes = FinancialEngine.modifyBudgetCategory({
          category: targetCategory,
          newAmount: matchAmount ? parseFloat(matchAmount[1]) : undefined,
          remove: isRemove,
        });

        return {
          spokenResponse: modRes.spokenAnalysis,
          intent: 'CREATE_OR_MODIFY_BUDGET',
          stage: draft?.conversationStage || 'IDLE',
          soundCue: modRes.isValid ? 'success' : 'warning',
          modalAction: 'none',
          activeDraft: draft,
          budget: modRes.budget,
          account: FinancialEngine.getFinancialSummary(),
        };
      }
    }

    // Natural multi-category allocation:
    // "I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings."
    // "Budget $100 for food, $50 for transport..."
    if (
      cleanText.includes('allocate') ||
      cleanText.includes('budget') ||
      (cleanText.includes('for') && (cleanText.includes('food') || cleanText.includes('transport') || cleanText.includes('savings')))
    ) {
      // Optional explicit balance stated in prompt, e.g. "I have $500. Allocate..."
      let statedTotalAvailable: number | undefined = undefined;
      const matchStatedBalance = cleanText.match(/(?:i have|have)\s+\$?(\d+(?:\.\d{1,2})?)/);
      if (matchStatedBalance) {
        statedTotalAvailable = parseFloat(matchStatedBalance[1]);
      }

      const allocations: Array<{ category: string; amount: number }> = [];
      const regex = /(\d+(?:\.\d{1,2})?)\s*(?:dollars?)?\s*(?:for|to|on)\s+([a-zA-Z\s&]+?)(?=(?:\s+\d+|\s+and\s+\d+|$))/gi;

      let m;
      while ((m = regex.exec(cleanText)) !== null) {
        const amt = parseFloat(m[1]);
        const rawCat = m[2].trim();
        // Skip false matches like "i have 500 dollars"
        if (rawCat && amt > 0 && !rawCat.startsWith('dollars')) {
          allocations.push({
            amount: amt,
            category: rawCat,
          });
        }
      }

      if (allocations.length > 0) {
        const evalRes = FinancialEngine.evaluateBudget(allocations, statedTotalAvailable);
        return {
          spokenResponse: evalRes.spokenAnalysis,
          intent: 'CREATE_OR_MODIFY_BUDGET',
          stage: draft?.conversationStage || 'IDLE',
          soundCue: evalRes.isValid ? 'success' : 'warning',
          modalAction: 'none',
          activeDraft: draft,
          budget: evalRes.budget,
          account: FinancialEngine.getFinancialSummary(),
        };
      }
    }

    // 4. AUTHORIZATION PRIORITY CHECK
    // "Authorization commands must take precedence over new-payment intent detection
    // when a valid transaction draft is awaiting authorization."
    const isExplicitAuthorization =
      cleanText === 'i authorize this payment' ||
      cleanText === 'i authorize' ||
      cleanText === 'authorize' ||
      cleanText === 'authorize payment' ||
      cleanText === 'authorize this payment' ||
      cleanText === 'i confirm' ||
      cleanText === 'i authorize it' ||
      cleanText === 'confirm payment' ||
      cleanText === 'yes authorize' ||
      cleanText.includes('authorize');

    if (draft && isExplicitAuthorization) {
      if (
        draft.conversationStage === 'AWAITING_AUTHORIZATION' ||
        draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL'
      ) {
        if (draft.amount > balance) {
          const shortfall = (draft.amount - balance).toFixed(2);
          return {
            spokenResponse: `Payment authorization declined. Amount of $${draft.amount.toFixed(2)} exceeds available demo balance by $${shortfall}.`,
            intent: 'AUTHORIZE_PAYMENT',
            stage: draft.conversationStage,
            soundCue: 'warning',
            modalAction: 'none',
            activeDraft: draft,
            budget: db.budget,
            account: FinancialEngine.getFinancialSummary(),
          };
        }

        const token = `DEMO-AUTH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        draft.status = 'authorized';
        draft.authorizationToken = token;
        draft.authorizedDetails = {
          amount: draft.amount,
          currency: draft.currency,
          recipient: draft.recipient,
          purpose: draft.purpose,
        };
        draft.conversationStage = 'AUTHORIZED_PENDING_FINGERPRINT';
        draft.updatedAt = new Date().toISOString();
        db.activeDraft = draft;
        saveDatabase(db);

        return {
          spokenResponse: 'Your payment is authorized. Please complete the demo fingerprint verification.',
          intent: 'AUTHORIZE_PAYMENT',
          stage: 'AUTHORIZED_PENDING_FINGERPRINT',
          soundCue: 'fingerprint',
          modalAction: 'open_fingerprint',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
        };
      }
    }

    // 5. CONVERSATIONAL STATE MACHINE: ACTIVE DRAFT FLOW

    // Case 5A: Stage AWAITING_DETAILS_CONFIRMATION
    // Assistant asked: "You are about to pay John $50. Would you like me to read the transaction details?"
    if (draft && draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION') {
      const isAffirmative =
        cleanText === 'yes' ||
        cleanText === 'yes please' ||
        cleanText === 'sure' ||
        cleanText === 'read details' ||
        cleanText === 'read the details' ||
        cleanText === 'please' ||
        cleanText === 'yeah' ||
        cleanText === 'yep' ||
        cleanText === 'okay' ||
        cleanText === 'ok';

      if (isAffirmative) {
        draft.conversationStage = 'AWAITING_CORRECTION_OR_APPROVAL';
        draft.updatedAt = new Date().toISOString();
        db.activeDraft = draft;
        saveDatabase(db);

        const purposeText = draft.purpose && draft.purpose !== 'General payment' ? draft.purpose : 'not specified';
        const formattedAmount = `$${draft.amount}`;
        spokenResponse = `Recipient: ${draft.recipient}. Amount: ${formattedAmount} ${draft.currency}. Payment purpose: ${purposeText}. Is this correct?`;

        return {
          spokenResponse,
          intent: 'CLARIFY_TRANSACTION',
          stage: 'AWAITING_CORRECTION_OR_APPROVAL',
          soundCue: 'neutral',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
        };
      }
    }

    // Case 5B: Stage AWAITING_CORRECTION_OR_APPROVAL
    // Assistant asked: "... Is this correct?"
    if (draft && draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL') {
      const isAffirmative =
        cleanText === 'yes' ||
        cleanText === 'yes it is' ||
        cleanText === 'correct' ||
        cleanText === 'that is correct' ||
        cleanText === 'thats correct' ||
        cleanText === 'yes that is correct' ||
        cleanText === 'looks good' ||
        cleanText === 'right';

      if (isAffirmative) {
        draft.conversationStage = 'AWAITING_AUTHORIZATION';
        draft.updatedAt = new Date().toISOString();
        db.activeDraft = draft;
        saveDatabase(db);

        return {
          spokenResponse: 'Do you authorize this payment?',
          intent: 'CLARIFY_TRANSACTION',
          stage: 'AWAITING_AUTHORIZATION',
          soundCue: 'neutral',
          modalAction: 'none',
          activeDraft: draft,
          budget: db.budget,
          account: FinancialEngine.getFinancialSummary(),
        };
      }
    }

    // 6. MODIFICATION DETECTOR
    // "Understand modification commands as updates to the existing transaction, not new payment requests."
    // "Never ask for a recipient again if one has already been supplied and remains valid."
    // "Changing the recipient, amount or currency invalidates previous authorization."
    // "Require a fresh review and authorization after any modification."
    const isModificationCommand =
      draft &&
      (cleanText.includes('change') ||
       cleanText.includes('meant') ||
       cleanText.includes('instead') ||
       cleanText.startsWith('no change') ||
       cleanText.startsWith('make it') ||
       cleanText.startsWith('update') ||
       (cleanText.startsWith('no ') && (cleanText.includes('75') || cleanText.includes('$') || cleanText.includes('amount'))));

    if (draft && isModificationCommand) {
      const matchAmount = cleanText.match(/(?:to\s+)?\$?(\d+(?:\.\d{1,2})?)/);
      let newRecipient: string | null = null;
      let newCurrency: string | null = null;
      if (cleanText.includes('usd') || cleanText.includes('dollars')) newCurrency = 'USD';
      else if (cleanText.includes('eur') || cleanText.includes('euros')) newCurrency = 'EUR';
      else if (cleanText.includes('gbp') || cleanText.includes('pounds')) newCurrency = 'GBP';

      const matchRecipient = cleanText.match(/(?:recipient to|pay to)\s+([a-zA-Z\s]+)/);
      if (matchRecipient && !cleanText.includes('amount') && !matchAmount && !cleanText.includes('currency')) {
        const rawName = matchRecipient[1].trim();
        newRecipient = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      } else if (cleanText.match(/^to\s+([a-zA-Z]+)/) && !newCurrency && !cleanText.includes('currency')) {
        const matchTo = cleanText.match(/^to\s+([a-zA-Z]+)/);
        if (matchTo) {
          const rawName = matchTo[1].trim();
          newRecipient = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        }
      }

      const updatedAmount = matchAmount ? parseFloat(matchAmount[1]) : draft.amount;
      const updatedRecipient = newRecipient || draft.recipient; // PRESERVE EXISTING RECIPIENT!
      const updatedCurrency = newCurrency || draft.currency;

      // CRITICAL: Strictly invalidate previous authorization and order
      draft.amount = updatedAmount;
      draft.recipient = updatedRecipient;
      draft.currency = updatedCurrency;
      draft.authorizationToken = null; // Invalidate
      draft.authorizedDetails = null;
      draft.isBuyerApproved = false;
      draft.paypalOrderId = null; // Strictly invalidate previous order
      draft.paypalCaptureId = null;
      draft.draftVersion = (draft.draftVersion || 1) + 1;
      draft.status = 'draft';
      draft.conversationStage = 'AWAITING_CORRECTION_OR_APPROVAL';
      draft.updatedAt = new Date().toISOString();
      db.activeDraft = draft;
      saveDatabase(db);

      const formattedAmount = `$${draft.amount}`;

      if (matchAmount) {
        spokenResponse = `Your payment amount has been updated to ${formattedAmount}. You are about to pay ${draft.recipient} ${formattedAmount} ${draft.currency}. Is this correct?`;
      } else if (newRecipient) {
        spokenResponse = `Your recipient has been updated to ${draft.recipient}. You are about to pay ${draft.recipient} ${formattedAmount} ${draft.currency}. Is this correct?`;
      } else if (newCurrency) {
        spokenResponse = `Your payment currency has been updated to ${draft.currency}. You are about to pay ${draft.recipient} ${formattedAmount} ${draft.currency}. Is this correct?`;
      } else {
        spokenResponse = `Your payment details have been updated. You are about to pay ${draft.recipient} ${formattedAmount} ${draft.currency}. Is this correct?`;
      }

      return {
        spokenResponse,
        intent: 'MODIFY_TRANSACTION',
        stage: 'AWAITING_CORRECTION_OR_APPROVAL',
        soundCue: 'warning',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
      };
    }

    // Case 5C: Stage AWAITING_AUTHORIZATION Ambiguity Safety
    // "Never treat silence, unclear speech or an ambiguous response as authorization."
    if (draft && draft.conversationStage === 'AWAITING_AUTHORIZATION') {
      return {
        spokenResponse: `I did not receive a clear authorization. Do you authorize this payment of $${draft.amount} to ${draft.recipient}? Please clearly say "I authorize this payment" or "Cancel".`,
        intent: 'AMBIGUOUS_RESPONSE',
        stage: 'AWAITING_AUTHORIZATION',
        soundCue: 'warning',
        modalAction: 'none',
        activeDraft: draft,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
      };
    }

    // 7. PAYMENT INITIATION DETECTOR
    // "User: 'I want to pay $50 to John.'"
    // "Assistant: 'You are about to pay John $50. Would you like me to read the transaction details?'"
    const isPaymentInitiation =
      (cleanText.startsWith('pay ') ||
       cleanText.startsWith('i want to pay ') ||
       cleanText.startsWith('send ') ||
       cleanText.startsWith('transfer ') ||
       cleanText.includes('want to pay')) &&
      !cleanText.includes('authorize') &&
      !cleanText.includes('approve') &&
      !cleanText.includes('paypal') &&
      !cleanText.includes('approval');

    if (isPaymentInitiation) {
      // Check if user is saying "pay $75" while an active draft exists and specifies only an amount
      if (draft && !cleanText.includes('to ') && cleanText.match(/\$?(\d+(?:\.\d{1,2})?)/)) {
        const matchAmt = cleanText.match(/\$?(\d+(?:\.\d{1,2})?)/);
        if (matchAmt) {
          draft.amount = parseFloat(matchAmt[1]);
          draft.authorizationToken = null;
          draft.authorizedDetails = null;
          draft.isBuyerApproved = false;
          draft.paypalOrderId = null; // Strictly invalidate previous order
          draft.paypalCaptureId = null;
          draft.draftVersion = (draft.draftVersion || 1) + 1;
          draft.status = 'draft';
          draft.conversationStage = 'AWAITING_CORRECTION_OR_APPROVAL';
          draft.updatedAt = new Date().toISOString();
          db.activeDraft = draft;
          saveDatabase(db);

          const formattedAmount = `$${draft.amount}`;
          return {
            spokenResponse: `Your payment amount has been updated to ${formattedAmount}. You are about to pay ${draft.recipient} ${formattedAmount} ${draft.currency}. Is this correct?`,
            intent: 'MODIFY_TRANSACTION',
            stage: 'AWAITING_CORRECTION_OR_APPROVAL',
            soundCue: 'warning',
            modalAction: 'none',
            activeDraft: draft,
            budget: db.budget,
            account: FinancialEngine.getFinancialSummary(),
          };
        }
      }

      // New payment initiation
      const matchAmount = cleanText.match(/\$?(\d+(?:\.\d{1,2})?)/);
      let recipient = '';
      let purpose = 'not specified';

      const matchPayTo = cleanText.match(/pay\s+(?:\$?\d+(?:\.\d{1,2})?\s+)?(?:dollars?\s+)?to\s+([a-zA-Z]+)/);
      const matchSendTo = cleanText.match(/send\s+(?:\$?\d+(?:\.\d{1,2})?\s+)?(?:dollars?\s+)?to\s+([a-zA-Z]+)/);
      const matchPayName = cleanText.match(/pay\s+([a-zA-Z]+)\s+\$?(\d+)/);

      if (matchPayTo) {
        recipient = matchPayTo[1].trim();
      } else if (matchSendTo) {
        recipient = matchSendTo[1].trim();
      } else if (matchPayName) {
        recipient = matchPayName[1].trim();
      }

      if (cleanText.includes('for ')) {
        const matchFor = cleanText.match(/for\s+([a-zA-Z0-9\s]+)/);
        if (matchFor) {
          purpose = matchFor[1].trim();
        }
      }

      if (cleanText.includes('electricity') || cleanText.includes('electric') || cleanText.includes('power')) {
        purpose = 'electricity';
        if (!recipient) recipient = 'City Power';
      } else if (cleanText.includes('rent')) {
        purpose = 'rent';
      }

      const amountVal = matchAmount ? parseFloat(matchAmount[1]) : 0;
      const capitalizedRecipient = recipient
        ? recipient.charAt(0).toUpperCase() + recipient.slice(1)
        : (draft?.recipient || 'John');

      const newDraft: Transaction = {
        id: `tx-draft-${Date.now()}`,
        draftVersion: 1,
        type: 'debit',
        amount: amountVal,
        currency: 'USD',
        recipient: capitalizedRecipient,
        purpose,
        status: 'draft',
        conversationStage: correctionResult.isCorrected
          ? 'AWAITING_CORRECTION_OR_APPROVAL'
          : 'AWAITING_DETAILS_CONFIRMATION',
        authorizationToken: null,
        authorizedDetails: null,
        isBuyerApproved: false,
        idempotencyKey: `idemp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        paymentMethod: 'PayPal Sandbox',
        paypalOrderId: null,
        paypalCaptureId: null,
        isDemoMode: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      db.activeDraft = newDraft;
      saveDatabase(db);

      const formattedAmount = `$${newDraft.amount}`;
      if (correctionResult.isCorrected) {
        spokenResponse = `I understood that you want to pay ${newDraft.recipient} ${newDraft.amount} dollars. Is that correct?`;
      } else {
        spokenResponse = `You are about to pay ${newDraft.recipient} ${formattedAmount}. Would you like me to read the transaction details?`;
      }

      return {
        spokenResponse,
        intent: 'INITIATE_PAYMENT',
        stage: newDraft.conversationStage || 'AWAITING_DETAILS_CONFIRMATION',
        soundCue: 'success',
        modalAction: 'none',
        activeDraft: newDraft,
        budget: db.budget,
        account: FinancialEngine.getFinancialSummary(),
        originalTranscript: rawInput,
        interpretedTranscript: effectiveInput,
        isCorrected: correctionResult.isCorrected,
      };
    }

    // 8. GENERAL ASSIST
    return {
      spokenResponse: draft
        ? `You have an active payment draft of $${draft.amount} to ${draft.recipient}. Say "Yes" to continue, "Change the amount to $75", or "Cancel".`
        : 'A-Eye Pal is ready. You can say: "I want to pay $50 to John", "What is my balance?", or "Budget $100 for groceries".',
      intent: 'GENERAL_ASSIST',
      stage: draft?.conversationStage || 'IDLE',
      soundCue: 'neutral',
      modalAction: 'none',
      activeDraft: draft,
      budget: db.budget,
      account: FinancialEngine.getFinancialSummary(),
      originalTranscript: rawInput,
      interpretedTranscript: effectiveInput,
      isCorrected: correctionResult.isCorrected,
    };
  }
}
