import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { getDatabase, saveDatabase, resetDemoDatabase } from './server/db.js';
import { FinancialEngine } from './server/financialEngine.js';
import { ConversationalPaymentEngine } from './server/conversationalEngine.js';
import { GeminiService } from './server/geminiService.js';
import { PayPalService } from './server/paypalService.js';
import { activityLogger } from './server/activityLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Real-Time System Activity SSE Endpoint
  app.get('/api/activity/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial ping and recent events
    res.write(`data: ${JSON.stringify({ type: 'INIT', events: activityLogger.getRecentEvents(30) })}\n\n`);

    const unsubscribe = activityLogger.subscribe((event) => {
      res.write(`data: ${JSON.stringify({ type: 'EVENT', event })}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  // REST endpoint for recent activity events
  app.get('/api/activity/recent', (_req: Request, res: Response) => {
    res.json({ events: activityLogger.getRecentEvents(50) });
  });

  // Clear activity events
  app.post('/api/activity/clear', (_req: Request, res: Response) => {
    activityLogger.clear();
    res.json({ success: true });
  });

  // Client speech-event beacon (allows frontend mic/speech-synthesis events into the real activity pipeline)
  app.post('/api/activity/client-event', (req: Request, res: Response) => {
    const { stage, service, eventType, message, status, duration, sanitizedMetadata } = req.body;
    if (stage && service && message) {
      activityLogger.emit({
        stage,
        service,
        eventType: eventType || 'CLIENT_EVENT',
        message,
        status: status || 'success',
        duration,
        sanitizedMetadata,
      });
    }
    res.json({ success: true });
  });

  // 1. Account Summary & Status
  app.get('/api/account/summary', (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const summary = FinancialEngine.getFinancialSummary();
      const clarify = FinancialEngine.clarifyDraft();
      const paypalStatus = PayPalService.getStatus();

      res.json({
        summary,
        activeDraft: db.activeDraft,
        clarification: clarify,
        budget: db.budget,
        paypalStatus,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch account summary' });
    }
  });

  // 2. Reset Demo Ledger
  app.post('/api/account/reset-demo', (_req: Request, res: Response) => {
    try {
      const fresh = resetDemoDatabase();
      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'LEDGER_RESET',
        message: 'Demo account ledger reset to initial state ($650.00 USD).',
        status: 'success',
      });
      res.json({
        success: true,
        message: 'Demo account and balance reset to initial sample state ($650.00 USD).',
        account: fresh.account,
        transactions: fresh.transactions,
        budget: fresh.budget,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Central Voice Processing Pipeline
  app.post('/api/voice/process', async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Missing spoken text message' });
        return;
      }

      activityLogger.emit({
        stage: 'SPEECH_INPUT',
        service: 'SPEECH_RECOGNITION',
        eventType: 'INPUT_RECEIVED',
        message: `Recognized user command: "${message.slice(0, 100)}"`,
        status: 'success',
      });

      const db = getDatabase();

      // Step A: Primary Conversational Payment Engine
      const turnResult = ConversationalPaymentEngine.processTurn(message);
      const duration = Date.now() - startTime;

      if (turnResult.isCorrected) {
        activityLogger.emit({
          stage: 'SPEECH_INPUT',
          service: 'TRANSCRIPT_CORRECTION',
          eventType: 'TRANSCRIPT_CORRECTED',
          message: `Phonetic correction applied: "${turnResult.originalTranscript}" -> "${turnResult.interpretedTranscript}"`,
          status: 'success',
          sanitizedMetadata: {
            originalTranscript: turnResult.originalTranscript,
            interpretedTranscript: turnResult.interpretedTranscript,
            isCorrected: true,
          },
        });
      }

      if (turnResult.intent === 'APPROVE_PAYPAL_ORDER' && turnResult.activeDraft?.isBuyerApproved) {
        activityLogger.emit({
          stage: 'PAYPAL_SANDBOX',
          service: 'PAYPAL_SANDBOX',
          eventType: 'ORDER_APPROVED',
          message: `PayPal Sandbox order approved by buyer. Ready for capture.`,
          status: 'success',
          sanitizedMetadata: {
            orderId: turnResult.activeDraft?.paypalOrderId,
            amount: turnResult.activeDraft?.amount,
          },
        });
      } else if (turnResult.intent === 'CAPTURE_PAYMENT' && turnResult.stage === 'COMPLETED') {
        activityLogger.emit({
          stage: 'PAYPAL_SANDBOX',
          service: 'PAYPAL_SANDBOX',
          eventType: 'CAPTURE_COMPLETED',
          message: `PayPal Sandbox capture executed successfully. Account ledger debited.`,
          status: 'success',
          sanitizedMetadata: {
            newBalance: turnResult.account?.balance,
          },
        });
      }

      if (turnResult.intent !== 'GENERAL_ASSIST' || db.activeDraft) {
        activityLogger.emit({
          stage: 'BACKEND_PROCESSING',
          service: 'BACKEND',
          eventType: 'TURN_PROCESSED',
          message: `Processed intent: ${turnResult.intent} (Stage: ${turnResult.stage}).`,
          status: 'success',
          duration,
          sanitizedMetadata: {
            intent: turnResult.intent,
            stage: turnResult.stage,
            hasDraft: Boolean(turnResult.activeDraft),
          },
        });

        activityLogger.emit({
          stage: 'RESPONSE',
          service: 'ASSISTANT',
          eventType: 'RESPONSE_PREPARED',
          message: `Assistant response generated for speech delivery.`,
          status: 'success',
          sanitizedMetadata: {
            responsePreview: turnResult.spokenResponse.slice(0, 80) + '...',
          },
        });

        res.json({
          spokenResponse: turnResult.spokenResponse,
          intent: turnResult.intent,
          stage: turnResult.stage,
          soundCue: turnResult.soundCue,
          modalAction: turnResult.modalAction,
          activeDraft: turnResult.activeDraft,
          budget: turnResult.budget,
          account: turnResult.account,
          originalTranscript: turnResult.originalTranscript || message,
          interpretedTranscript: turnResult.interpretedTranscript || message,
          isCorrected: turnResult.isCorrected || false,
        });
        return;
      }

      // Step B: Natural Language Understanding via Gemini for open-ended assistance
      const interpretation = await GeminiService.interpretVoiceInput(message, {
        hasActiveDraft: false,
        availableBalance: db.account.balance,
      });

      const updatedDb = getDatabase();
      const updatedSummary = FinancialEngine.getFinancialSummary();

      activityLogger.emit({
        stage: 'RESPONSE',
        service: 'ASSISTANT',
        eventType: 'RESPONSE_PREPARED',
        message: `Assistant response generated for speech delivery.`,
        status: 'success',
        sanitizedMetadata: {
          intent: interpretation.intent,
        },
      });

      res.json({
        spokenResponse: interpretation.spokenResponse || turnResult.spokenResponse,
        intent: interpretation.intent,
        stage: 'IDLE',
        soundCue: 'neutral',
        modalAction: 'none',
        activeDraft: updatedDb.activeDraft,
        budget: updatedDb.budget,
        account: updatedSummary,
      });
    } catch (err: any) {
      console.error('Error processing voice input:', err);
      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'COMMAND_PROCESSING_FAILED',
        message: `Command processing error: ${err.message || 'unknown error'}`,
        status: 'failed',
      });
      res.status(500).json({
        spokenResponse: 'I encountered an error processing your request. Please try again.',
        error: err.message,
      });
    }
  });

  // 4. Draft Modification Direct API
  app.post('/api/draft/modify', (req: Request, res: Response) => {
    try {
      const { amount, recipient, purpose, currency } = req.body;
      const result = FinancialEngine.modifyDraft({ amount, recipient, purpose, currency });
      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'DRAFT_MODIFIED',
        message: `Payment draft updated: $${result.draft.amount} to ${result.draft.recipient}. Authorizations cleared.`,
        status: 'success',
        sanitizedMetadata: {
          amount: result.draft.amount,
          currency: result.draft.currency,
          recipient: result.draft.recipient,
        },
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Clarify Draft API
  app.get('/api/draft/clarify', (_req: Request, res: Response) => {
    try {
      const result = FinancialEngine.clarifyDraft();
      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'TRANSACTION_CLARIFIED',
        message: 'Transaction details clarified and read back to user.',
        status: 'success',
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Cancel Draft API
  app.post('/api/draft/cancel', (_req: Request, res: Response) => {
    try {
      const result = FinancialEngine.cancelDraft();
      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'TRANSACTION_CANCELLED',
        message: 'Active transaction draft discarded and marked cancelled.',
        status: 'cancelled',
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Simulated Fingerprint Authorization API
  app.post('/api/draft/authorize-demo', (_req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const draft = db.activeDraft;
      if (draft) {
        activityLogger.emit({
          stage: 'BACKEND_PROCESSING',
          service: 'FINANCIAL_ENGINE',
          eventType: 'DETAILS_CONFIRMED',
          message: `Transaction details confirmed: $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient}.`,
          status: 'success',
        });
      }

      const result = FinancialEngine.authorizeDraftWithDemoFingerprint();
      if (result.success) {
        activityLogger.emit({
          stage: 'BACKEND_PROCESSING',
          service: 'BIOMETRIC_SIMULATION',
          eventType: 'FINGERPRINT_VERIFIED',
          message: 'Demo fingerprint verification successful. No real fingerprint was accessed.',
          status: 'success',
        });
        activityLogger.emit({
          stage: 'BACKEND_PROCESSING',
          service: 'FINANCIAL_ENGINE',
          eventType: 'PAYMENT_AUTHORIZED',
          message: 'Internal payment authorization granted. Bound to transaction details.',
          status: 'success',
          sanitizedMetadata: {
            tokenPrefix: result.authorizationToken?.slice(0, 14) + '...',
            recipient: result.draft?.recipient,
            amount: result.draft?.amount,
          },
        });
      } else {
        activityLogger.emit({
          stage: 'BACKEND_PROCESSING',
          service: 'FINANCIAL_ENGINE',
          eventType: 'FINGERPRINT_AUTH_DECLINED',
          message: `Authorization declined: ${result.announcement}`,
          status: 'failed',
          sanitizedMetadata: { error: result.error },
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. PayPal Sandbox Order Creation
  app.post('/api/paypal/create-order', async (req: Request, res: Response) => {
    try {
      const { authorizationToken, draftId, draftVersion } = req.body;
      const db = getDatabase();
      const draft = db.activeDraft;

      if (!draft) {
        res.status(400).json({ error: 'No active transaction draft found' });
        return;
      }

      if (draftId && draft.id !== draftId) {
        res.status(400).json({ error: 'Active draft ID mismatch' });
        return;
      }

      if (draftVersion && draft.draftVersion && draft.draftVersion !== draftVersion) {
        res.status(400).json({ error: 'Draft version mismatch. Transaction details have changed.' });
        return;
      }

      const effectiveToken = authorizationToken || draft.authorizationToken;
      if (!draft.authorizationToken || draft.authorizationToken !== effectiveToken) {
        res.status(403).json({ error: 'Invalid or missing authorization token. Please authorize via fingerprint first.' });
        return;
      }

      // Check if transaction details changed since authorization
      if (
        draft.authorizedDetails &&
        (draft.authorizedDetails.amount !== draft.amount ||
         draft.authorizedDetails.recipient !== draft.recipient ||
         draft.authorizedDetails.currency !== draft.currency)
      ) {
        res.status(400).json({ error: 'Transaction details have changed since authorization was granted. Authorization invalidated.' });
        return;
      }

      // Duplicate prevention: If draft already has an active order, reuse it
      if (draft.paypalOrderId && (draft.status === 'processing' || draft.status === 'authorized')) {
        res.json({
          success: true,
          order: {
            orderId: draft.paypalOrderId,
            status: 'CREATED',
            approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${draft.paypalOrderId}`,
            isDemoMode: draft.isDemoMode,
            currency: draft.currency,
            amount: draft.amount,
            recipient: draft.recipient,
            purpose: draft.purpose,
          },
          draft,
        });
        return;
      }

      const orderResult = await PayPalService.createOrder({
        amount: draft.amount,
        currency: draft.currency,
        recipient: draft.recipient,
        purpose: draft.purpose,
        referenceId: draft.id,
      });

      draft.paypalOrderId = orderResult.orderId;
      draft.status = 'processing';
      draft.conversationStage = 'AWAITING_PAYPAL_APPROVAL';
      saveDatabase(db);

      res.json({
        success: true,
        order: orderResult,
        draft,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8B. PayPal Sandbox Buyer Approval with AUTOMATIC CAPTURE
  app.post('/api/paypal/approve-order', async (req: Request, res: Response) => {
    try {
      const { authorizationToken, orderId, draftId, draftVersion } = req.body;
      const db = getDatabase();
      const draft = db.activeDraft;

      // Idempotency: Check if already captured
      const existingCaptured = db.transactions.find(
        (tx) => (orderId && tx.paypalOrderId === orderId) || (draft && draft.paypalOrderId && tx.paypalOrderId === draft.paypalOrderId) || (draft && draft.idempotencyKey && tx.idempotencyKey === draft.idempotencyKey)
      );
      if (existingCaptured && existingCaptured.status === 'completed') {
        res.json({
          success: true,
          approved: true,
          captured: true,
          capture: {
            orderId: existingCaptured.paypalOrderId || orderId,
            captureId: existingCaptured.paypalCaptureId || 'CAP-IDEMP',
            status: 'COMPLETED',
            isDemoMode: existingCaptured.isDemoMode,
            amount: existingCaptured.amount,
            currency: existingCaptured.currency,
            verifiedAt: existingCaptured.updatedAt,
          },
          finalized: {
            success: true,
            completedTransaction: existingCaptured,
            newBalance: db.account.balance,
            message: `This payment has already been completed and captured. No duplicate payment was processed.`,
          },
          spokenAnnouncement: `This payment has already been completed and captured. No duplicate payment was processed.`,
        });
        return;
      }

      if (!draft) {
        res.status(400).json({ error: 'No transaction draft available to approve' });
        return;
      }

      if (draftId && draft.id !== draftId) {
        res.status(400).json({ error: 'Active draft ID mismatch' });
        return;
      }

      if (draftVersion && draft.draftVersion && draft.draftVersion !== draftVersion) {
        res.status(400).json({ error: 'Draft version mismatch. Transaction details have changed.' });
        return;
      }

      const effectiveToken = authorizationToken || draft.authorizationToken;
      if (!draft.authorizationToken || draft.authorizationToken !== effectiveToken) {
        res.status(403).json({ error: 'Invalid or missing authorization token' });
        return;
      }

      if (draft.paypalOrderId && orderId && draft.paypalOrderId !== orderId) {
        res.status(400).json({ error: 'PayPal order ID mismatch with active draft' });
        return;
      }

      // Check if transaction details changed since authorization
      if (
        draft.authorizedDetails &&
        (draft.authorizedDetails.amount !== draft.amount ||
         draft.authorizedDetails.recipient !== draft.recipient ||
         draft.authorizedDetails.currency !== draft.currency)
      ) {
        res.status(400).json({ error: 'Transaction details have changed since authorization was granted. Authorization invalidated.' });
        return;
      }

      const activeOrderId = draft.paypalOrderId || orderId;
      if (!activeOrderId) {
        res.status(400).json({ error: 'No PayPal order ID associated with this transaction draft. Please create or initialize the order first.' });
        return;
      }

      draft.paypalOrderId = activeOrderId;
      draft.isBuyerApproved = true;
      draft.conversationStage = 'PAYPAL_ORDER_APPROVED';
      draft.status = 'processing';
      saveDatabase(db);

      // 4. PayPal order approved
      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'ORDER_APPROVED',
        message: `PayPal order ${activeOrderId} approved by buyer.`,
        status: 'success',
        sanitizedMetadata: {
          orderId: activeOrderId,
          recipient: draft.recipient,
          amount: draft.amount,
        },
      });

      // 5. Automatic capture initiated
      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'AUTO_CAPTURE_INITIATED',
        message: `Automatic capture initiated for approved PayPal order ${activeOrderId}.`,
        status: 'processing',
        sanitizedMetadata: {
          orderId: activeOrderId,
          amount: draft.amount,
        },
      });

      // 6. Actual PayPal capture response received
      const captureResult = await PayPalService.captureOrder(activeOrderId, draft.amount, draft.currency);

      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'CAPTURE_RESPONSE_RECEIVED',
        message: `Actual PayPal capture response received with status: ${captureResult.status}. Capture ID: ${captureResult.captureId}.`,
        status: 'success',
        sanitizedMetadata: {
          orderId: activeOrderId,
          captureId: captureResult.captureId,
          status: captureResult.status,
        },
      });

      if (captureResult.status !== 'COMPLETED') {
        res.status(500).json({ error: 'PayPal Sandbox payment capture was not completed' });
        return;
      }

      // Finalize backend balance ledger
      const finalized = FinancialEngine.finalizePayment({
        authorizationToken: effectiveToken,
        paypalOrderId: activeOrderId,
        paypalCaptureId: captureResult.captureId,
        isDemoMode: captureResult.isDemoMode,
        draftId: draft.id,
        draftVersion: draft.draftVersion,
      });

      if (!finalized.success) {
        res.status(400).json({ error: finalized.message });
        return;
      }

      // 7. Capture status verified
      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'CAPTURE_VERIFIED',
        message: `Capture status verified: COMPLETED. Ledger debited $${draft.amount.toFixed(2)}. New balance: $${finalized.newBalance.toFixed(2)}.`,
        status: 'success',
        sanitizedMetadata: {
          recipient: draft.recipient,
          amount: draft.amount,
          newBalance: finalized.newBalance,
        },
      });

      const spokenAnnouncement = `PayPal approval received. Completing your payment. Your payment has been captured successfully. Payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} has been completed via PayPal Sandbox. Your new available balance is $${finalized.newBalance.toFixed(2)} ${draft.currency}.`;

      res.json({
        success: true,
        orderApproved: true,
        capture: captureResult,
        finalized,
        spokenAnnouncement,
      });
    } catch (err: any) {
      console.error('Error approving and capturing order:', err);
      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'CAPTURE_FAILED',
        message: `PayPal capture failed or timed out: ${err.message}. Ledger not debited.`,
        status: 'failed',
      });
      res.status(500).json({ error: err.message || 'Payment capture failed. Your balance was not deducted.' });
    }
  });

  // 9. PayPal Sandbox Capture & Settlement (Direct REST endpoint)
  app.post('/api/paypal/capture', async (req: Request, res: Response) => {
    try {
      const { authorizationToken, orderId, draftId, draftVersion } = req.body;
      const db = getDatabase();
      const draft = db.activeDraft;

      // Duplicate capture prevention: If already captured, return existing finalized receipt
      const existingCaptured = db.transactions.find(
        (tx) => (orderId && tx.paypalOrderId === orderId) || (draft && draft.paypalOrderId && tx.paypalOrderId === draft.paypalOrderId) || (draft && draft.idempotencyKey && tx.idempotencyKey === draft.idempotencyKey)
      );
      if (existingCaptured && existingCaptured.status === 'completed') {
        res.json({
          success: true,
          capture: {
            orderId: existingCaptured.paypalOrderId || orderId,
            captureId: existingCaptured.paypalCaptureId || 'CAP-IDEMP',
            status: 'COMPLETED',
            isDemoMode: existingCaptured.isDemoMode,
            amount: existingCaptured.amount,
            currency: existingCaptured.currency,
            verifiedAt: existingCaptured.updatedAt,
          },
          finalized: {
            success: true,
            completedTransaction: existingCaptured,
            newBalance: db.account.balance,
            message: `This payment has already been completed and captured. No duplicate payment was processed.`,
          },
        });
        return;
      }

      if (!draft) {
        res.status(400).json({ error: 'No transaction draft available' });
        return;
      }

      if (draftId && draft.id !== draftId) {
        res.status(400).json({ error: 'Active draft ID mismatch' });
        return;
      }

      if (draftVersion && draft.draftVersion && draft.draftVersion !== draftVersion) {
        res.status(400).json({ error: 'Draft version mismatch' });
        return;
      }

      const effectiveToken = authorizationToken || draft.authorizationToken;
      if (!draft.authorizationToken || draft.authorizationToken !== effectiveToken) {
        res.status(403).json({ error: 'Invalid authorization token' });
        return;
      }

      // Order ID mismatch validation
      if (draft.paypalOrderId && orderId && draft.paypalOrderId !== orderId) {
        res.status(400).json({ error: 'PayPal order ID mismatch with active draft' });
        return;
      }

      // Server-side check: never capture an unapproved order
      if (!draft.isBuyerApproved) {
        res.status(400).json({ error: 'Cannot capture payment. The PayPal order has not received buyer approval yet.' });
        return;
      }

      // Server-side check: bind authorization to exact transaction details
      if (
        draft.authorizedDetails &&
        (draft.authorizedDetails.amount !== draft.amount ||
         draft.authorizedDetails.recipient !== draft.recipient ||
         draft.authorizedDetails.currency !== draft.currency)
      ) {
        res.status(400).json({ error: 'Transaction details have changed since authorization was granted. Authorization invalidated.' });
        return;
      }

      const activeOrderId = orderId || draft.paypalOrderId;
      // Execute capture via PayPal Sandbox service
      const captureResult = await PayPalService.captureOrder(activeOrderId, draft.amount, draft.currency);

      if (captureResult.status !== 'COMPLETED') {
        res.status(500).json({ error: 'PayPal Sandbox payment capture was not completed' });
        return;
      }

      // Finalize backend balance ledger
      const finalized = FinancialEngine.finalizePayment({
        authorizationToken: effectiveToken,
        paypalOrderId: activeOrderId,
        paypalCaptureId: captureResult.captureId,
        isDemoMode: captureResult.isDemoMode,
        draftId: draft.id,
        draftVersion: draft.draftVersion,
      });

      if (!finalized.success) {
        res.status(400).json({ error: finalized.message });
        return;
      }

      activityLogger.emit({
        stage: 'BACKEND_PROCESSING',
        service: 'BACKEND',
        eventType: 'PAYMENT_SETTLED',
        message: `Ledger debited $${draft.amount.toFixed(2)}. New balance: $${finalized.newBalance.toFixed(2)}.`,
        status: 'success',
        sanitizedMetadata: {
          recipient: draft.recipient,
          amount: draft.amount,
          newBalance: finalized.newBalance,
        },
      });

      res.json({
        success: true,
        capture: captureResult,
        finalized,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PayPal Sandbox Return & Cancel Redirect Endpoints
  app.get('/api/paypal/return', (req: Request, res: Response) => {
    const token = (req.query.token as string) || '';
    const payerId = (req.query.PayerID as string) || '';
    res.redirect(`/?paypal_return=success&token=${encodeURIComponent(token)}&payerId=${encodeURIComponent(payerId)}`);
  });

  app.get('/api/paypal/cancel', (req: Request, res: Response) => {
    const token = (req.query.token as string) || '';
    res.redirect(`/?paypal_return=cancel&token=${encodeURIComponent(token)}`);
  });

  // 10. Budget Management Endpoints
  app.post('/api/budget/evaluate', (req: Request, res: Response) => {
    try {
      const { allocations } = req.body;
      const result = FinancialEngine.evaluateBudget(allocations || []);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/budget/modify-category', (req: Request, res: Response) => {
    try {
      const { category, newAmount, remove } = req.body;
      const result = FinancialEngine.modifyBudgetCategory({ category, newAmount, remove });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/budget/save', (_req: Request, res: Response) => {
    try {
      const result = FinancialEngine.saveCurrentBudget();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/budget/read', (_req: Request, res: Response) => {
    try {
      const result = FinancialEngine.readBudget();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Explicit 404 handler for any unhandled /api/* route:
  // Guarantees API endpoints always return JSON, NEVER HTML
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Global error handler for /api/* requests:
  // Catches any uncaught exceptions in async routes and returns JSON
  app.use((err: any, req: Request, res: Response, next: any) => {
    if (req.path.startsWith('/api/')) {
      console.error('[API Error]', err);
      if (!res.headersSent) {
        return res.status(500).json({
          error: err.message || 'Internal server error',
          spokenResponse: 'I encountered an issue processing that command. Please try again.',
        });
      }
    }
    next(err);
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[A-Eye Pal] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting A-Eye Pal server:', err);
  process.exit(1);
});
