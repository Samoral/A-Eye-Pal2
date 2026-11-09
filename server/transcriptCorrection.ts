/**
 * Context-Aware Financial Transcript Correction Engine for A-Eye Pal.
 * Corrects common speech recognition phonetic misrecognitions (e.g. "B" / "Play" -> "Pay"),
 * provides confidence scoring, clarification triggers, and preserves original speech transcripts
 * without ever silently executing financially consequential actions without user confirmation.
 */

import { ConversationStage } from './db.js';

export interface TranscriptCorrectionResult {
  originalTranscript: string;
  interpretedTranscript: string;
  isCorrected: boolean;
  correctionReason?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  needsClarification: boolean;
  clarificationPrompt?: string;
  detectedIntent?: string;
}

export class TranscriptCorrectionEngine {
  /**
   * Financial vocabulary dictionary for context-biasing and correction.
   */
  public static readonly FINANCIAL_VOCABULARY = [
    'pay',
    'payment',
    'paypal',
    'transfer',
    'send',
    'authorize',
    'approve',
    'confirm',
    'capture',
    'cancel',
    'recipient',
    'amount',
    'balance',
    'budget',
    'transaction',
    'currency',
    'dollars',
    'naira',
    'euros',
    'pounds',
    'cents',
  ];

  /**
   * Phonetic variations of "pay" commonly misrecognized by Web Speech API.
   */
  private static readonly PAY_PHONETIC_VARIANTS = [
    'b',
    'play',
    'bay',
    'pey',
    'pei',
    'hey',
    'p',
    'bee',
    'pea',
    'bae',
    'paid',
    'playing',
  ];

  /**
   * Analyzes and corrects a spoken transcript based on financial grammar and conversation state.
   */
  public static correct(
    rawInput: string,
    context?: {
      stage?: ConversationStage;
      hasActiveDraft?: boolean;
    }
  ): TranscriptCorrectionResult {
    const originalTranscript = (rawInput || '').trim();
    if (!originalTranscript) {
      return {
        originalTranscript: '',
        interpretedTranscript: '',
        isCorrected: false,
        confidence: 'LOW',
        needsClarification: false,
      };
    }

    const clean = originalTranscript
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. Ambiguity Detection: Single isolated phonetic words without context
    if (
      clean === 'play' ||
      clean === 'b' ||
      clean === 'bay' ||
      clean === 'bee' ||
      clean === 'hey' ||
      clean === 'pei' ||
      clean === 'pey'
    ) {
      return {
        originalTranscript,
        interpretedTranscript: originalTranscript,
        isCorrected: false,
        confidence: 'LOW',
        needsClarification: true,
        clarificationPrompt: "I didn't catch that clearly. Did you say pay, or play?",
        detectedIntent: 'AMBIGUOUS_SPEECH',
      };
    }

    // 2. Check for phonetic replacement of "pay" with financial surroundings
    // e.g. "B 50 dollars to John", "Play 50 dollars to John", "B $50 to Sarah", "Play for electricity"
    const words = clean.split(' ');
    const firstWord = words[0];

    const hasFinancialSurroundings =
      clean.match(/\$?(\d+(?:\.\d{1,2})?)/) !== null ||
      clean.includes('dollar') ||
      clean.includes('dollars') ||
      clean.includes('naira') ||
      clean.includes('euro') ||
      clean.includes('to ') ||
      clean.includes('for ') ||
      clean.includes('electricity') ||
      clean.includes('rent') ||
      clean.includes('bill');

    if (this.PAY_PHONETIC_VARIANTS.includes(firstWord) && hasFinancialSurroundings) {
      // Reconstruct with "Pay" and proper capitalization
      const remainderWords = words.slice(1).map((w, i, arr) => {
        if (i > 0 && arr[i - 1] === 'to') {
          return w.charAt(0).toUpperCase() + w.slice(1);
        }
        return w;
      });
      const interpreted = `Pay ${remainderWords.join(' ')}`;

      return {
        originalTranscript,
        interpretedTranscript: interpreted,
        isCorrected: true,
        correctionReason: `Phonetic misrecognition ("${firstWord.toUpperCase()}" -> "Pay") corrected using surrounding financial context.`,
        confidence: 'HIGH',
        needsClarification: false,
        detectedIntent: 'INITIATE_PAYMENT',
      };
    }

    // 3. Alternative pattern: "I want to b 50 dollars" / "I want to play 50 dollars"
    const matchIWantTo = clean.match(/^i want to (b|play|bay|pey|hey)\s+(.*)$/);
    if (matchIWantTo) {
      const remainder = matchIWantTo[2];
      return {
        originalTranscript,
        interpretedTranscript: `I want to pay ${remainder}`,
        isCorrected: true,
        correctionReason: `Phonetic misrecognition ("${matchIWantTo[1].toUpperCase()}" -> "Pay") corrected in statement.`,
        confidence: 'HIGH',
        needsClarification: false,
        detectedIntent: 'INITIATE_PAYMENT',
      };
    }

    // 4. Context-aware intent detection for existing drafts
    if (context?.hasActiveDraft) {
      // Distinguish review confirmation
      if (
        clean === 'confirm this payment' ||
        clean === 'i confirm the transaction' ||
        clean === 'yes the details are correct' ||
        clean === 'proceed with this payment'
      ) {
        return {
          originalTranscript,
          interpretedTranscript: originalTranscript,
          isCorrected: false,
          confidence: 'HIGH',
          needsClarification: false,
          detectedIntent: 'CONFIRM_TRANSACTION',
        };
      }

      // Distinguish PayPal checkout approval
      if (
        clean === 'approve payment' ||
        clean === 'i approve this payment' ||
        clean === 'continue to paypal'
      ) {
        return {
          originalTranscript,
          interpretedTranscript: originalTranscript,
          isCorrected: false,
          confidence: 'HIGH',
          needsClarification: false,
          detectedIntent: 'APPROVE_PAYPAL_ORDER',
        };
      }

      // Distinguish capture commands
      if (
        clean === 'capture payment' ||
        clean === 'complete the payment' ||
        clean === 'finalize this transaction'
      ) {
        return {
          originalTranscript,
          interpretedTranscript: originalTranscript,
          isCorrected: false,
          confidence: 'HIGH',
          needsClarification: false,
          detectedIntent: 'CAPTURE_PAYMENT',
        };
      }

      // Distinguish cancellation commands
      if (
        clean === 'cancel this payment' ||
        clean === 'i dont want to continue' ||
        clean === "i don't want to continue" ||
        clean === 'stop this transaction'
      ) {
        return {
          originalTranscript,
          interpretedTranscript: originalTranscript,
          isCorrected: false,
          confidence: 'HIGH',
          needsClarification: false,
          detectedIntent: 'CANCEL_TRANSACTION',
        };
      }
    }

    // Default: Return as-is
    return {
      originalTranscript,
      interpretedTranscript: originalTranscript,
      isCorrected: false,
      confidence: 'HIGH',
      needsClarification: false,
    };
  }
}
