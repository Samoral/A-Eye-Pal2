import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { FinancialEngine } from './financialEngine.js';
import { activityLogger } from './activityLogger.js';

export interface InterpretedVoiceCommand {
  intent:
    | 'INITIATE_PAYMENT'
    | 'MODIFY_TRANSACTION'
    | 'CLARIFY_TRANSACTION'
    | 'AUTHORIZE_PAYMENT'
    | 'CANCEL_TRANSACTION'
    | 'CHECK_BALANCE'
    | 'CHECK_SPENDING'
    | 'CREATE_OR_MODIFY_BUDGET'
    | 'SAVE_BUDGET'
    | 'READ_BUDGET'
    | 'GENERAL_ASSIST';
  extractedData: {
    recipient?: string | null;
    amount?: number | null;
    currency?: string | null;
    purpose?: string | null;
    budgetCategories?: Array<{ category: string; amount: number }> | null;
    budgetAdjustment?: {
      category: string;
      newAmount?: number;
      remove?: boolean;
    } | null;
    spendingTimeframe?: 'week' | 'month' | 'all' | 'last_transaction' | null;
  };
  spokenResponse: string;
  confidenceNotes?: string;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return new GoogleGenAI({
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiService {
  /**
   * Interprets spoken user audio or text input in financial context
   */
  static async interpretVoiceInput(
    userInput: string,
    context: {
      hasActiveDraft: boolean;
      activeDraftSummary?: string;
      activeBudgetSummary?: string;
      availableBalance: number;
    }
  ): Promise<InterpretedVoiceCommand> {
    const trimmed = (userInput || '').trim();
    if (!trimmed) {
      return {
        intent: 'GENERAL_ASSIST',
        extractedData: {},
        spokenResponse: 'I am listening. You can ask for your balance, start a payment, or manage your budget.',
      };
    }

    // Attempt Gemini 3.8 Flash structured interpretation if key available
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      const startTime = Date.now();
      activityLogger.emit({
        stage: 'AI_PROCESSING',
        service: 'GEMINI_AI',
        eventType: 'GEMINI_REQUEST_DISPATCHED',
        message: 'Request dispatched to Gemini 3.8 Flash for natural speech understanding.',
        status: 'processing',
        sanitizedMetadata: { model: 'gemini-3.8-flash' },
      });

      try {
        const systemPrompt = `You are the natural language voice understanding core for "A-Eye Pal", a voice-first financial assistant designed for blind and low-vision individuals.
Your job is to analyze the user's spoken command and extract their financial intent, numbers, names, and purpose into structured JSON.

Context:
- User available demo balance: $${context.availableBalance.toFixed(2)} USD
- Active transaction draft: ${context.hasActiveDraft ? context.activeDraftSummary : 'None currently'}
- Active budget: ${context.activeBudgetSummary || 'None currently'}

Intent Guide:
- INITIATE_PAYMENT: User wants to pay someone or something (e.g., "Pay $50 to John", "Pay my electricity bill", "Send 100 dollars to Sarah").
- MODIFY_TRANSACTION: User wants to alter an existing transaction draft (e.g., "Change the amount to $75", "I meant $150, not $50", "Change recipient to Sarah", "Change currency to EUR").
- CLARIFY_TRANSACTION: User wants details repeated or explained (e.g., "What am I about to pay?", "Who am I paying?", "How much am I paying?", "Repeat the transaction details", "Is this payment correct?").
- AUTHORIZE_PAYMENT: User explicitly approves/authorizes the payment (e.g., "Authorize", "I confirm", "Yes, pay it", "Authorize payment").
- CANCEL_TRANSACTION: User cancels or aborts (e.g., "Cancel", "Stop", "Never mind", "Discard payment").
- CHECK_BALANCE: User asks about balance or money (e.g., "What's my balance?", "How much money do I have?").
- CHECK_SPENDING: User asks about expenses (e.g., "How much have I spent?", "How much did I spend this week?", "How much did I spend this month?", "Did my last payment go through?", "Show recent transactions").
- CREATE_OR_MODIFY_BUDGET: User specifies category allocations (e.g. "I have $300. Budget $100 for food, $50 for transport...", "Reduce food to $80", "Change transport to $40", "Remove entertainment").
- SAVE_BUDGET: User asks to save the budget (e.g., "Save my budget", "Confirm budget").
- READ_BUDGET: User asks to hear budget details (e.g., "Read my budget again", "What is my budget?").
- GENERAL_ASSIST: Greetings, requests for help or available commands.

Accessibility Tone Guidelines for spokenResponse:
- Clear, respectful, direct, optimized for screen readers and speech synthesis.
- Plain numbers and names.
- Do NOT perform math yourself if the backend will recalculate it. Provide concise initial confirmation of what was heard.`;

        const ai = getAiClient();
        const geminiPromise = ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: `Spoken input: "${trimmed}"`,
          config: {
            systemInstruction: systemPrompt,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: {
                  type: Type.STRING,
                  description:
                    'One of: INITIATE_PAYMENT, MODIFY_TRANSACTION, CLARIFY_TRANSACTION, AUTHORIZE_PAYMENT, CANCEL_TRANSACTION, CHECK_BALANCE, CHECK_SPENDING, CREATE_OR_MODIFY_BUDGET, SAVE_BUDGET, READ_BUDGET, GENERAL_ASSIST',
                },
                extractedData: {
                  type: Type.OBJECT,
                  properties: {
                    recipient: { type: Type.STRING, description: 'Extracted recipient name or business' },
                    amount: { type: Type.NUMBER, description: 'Extracted numeric payment or budget amount' },
                    currency: { type: Type.STRING, description: '3-letter currency code e.g. USD, EUR' },
                    purpose: { type: Type.STRING, description: 'Payment reason or category' },
                    budgetCategories: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          category: { type: Type.STRING },
                          amount: { type: Type.NUMBER },
                        },
                      },
                    },
                    budgetAdjustment: {
                      type: Type.OBJECT,
                      properties: {
                        category: { type: Type.STRING },
                        newAmount: { type: Type.NUMBER },
                        remove: { type: Type.BOOLEAN },
                      },
                    },
                    spendingTimeframe: {
                      type: Type.STRING,
                      description: 'week, month, all, or last_transaction',
                    },
                  },
                },
                spokenResponse: {
                  type: Type.STRING,
                  description: 'Clear speech response tailored for speech synthesis to the blind user',
                },
              },
              required: ['intent', 'spokenResponse'],
            },
          },
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), 3500)
        );

        const response: any = await Promise.race([geminiPromise, timeoutPromise]);
        const duration = Date.now() - startTime;

        const parsed = JSON.parse(response.text || '{}');
        if (parsed.intent) {
          activityLogger.emit({
            stage: 'AI_PROCESSING',
            service: 'GEMINI_AI',
            eventType: 'INTENT_DETECTED',
            message: `Gemini detected intent: ${parsed.intent}.`,
            status: 'success',
            duration,
            sanitizedMetadata: {
              intent: parsed.intent,
              extractedRecipient: parsed.extractedData?.recipient || null,
              extractedAmount: parsed.extractedData?.amount || null,
            },
          });

          return {
            intent: parsed.intent,
            extractedData: parsed.extractedData || {},
            spokenResponse: parsed.spokenResponse,
          };
        }
      } catch (err: any) {
        console.warn('Gemini API call failed or timed out, using fallback rule-based interpreter:', err);
        activityLogger.emit({
          stage: 'AI_PROCESSING',
          service: 'GEMINI_AI',
          eventType: 'GEMINI_FAILED_FALLBACK',
          message: `Gemini call failed or timed out (${err.message || 'error'}). Using local rule-based engine.`,
          status: 'failed',
        });
      }
    }

    // Deterministic Rule-Based Fallback (guarantees offline & zero-key reliability)
    return this.ruleBasedFallback(trimmed, context);
  }

  /**
   * Deterministic fallback rule-based interpreter
   */
  private static ruleBasedFallback(
    input: string,
    context: { hasActiveDraft: boolean; availableBalance: number }
  ): InterpretedVoiceCommand {
    const text = input.toLowerCase();

    // Check Balance
    if (text.includes('balance') || text.includes('how much money do i have') || text.includes('how much do i have')) {
      return {
        intent: 'CHECK_BALANCE',
        extractedData: {},
        spokenResponse: `Your current available demo balance is $${context.availableBalance.toFixed(2)} USD.`,
      };
    }

    // Check Spending
    if (text.includes('how much have i spent') || text.includes('spent this week') || text.includes('spent this month') || text.includes('last payment') || text.includes('transactions')) {
      let timeframe: 'week' | 'month' | 'all' | 'last_transaction' = 'all';
      if (text.includes('week')) timeframe = 'week';
      else if (text.includes('month')) timeframe = 'month';
      else if (text.includes('last payment') || text.includes('went through') || text.includes('go through')) timeframe = 'last_transaction';

      return {
        intent: 'CHECK_SPENDING',
        extractedData: { spendingTimeframe: timeframe },
        spokenResponse: 'Checking your recent spending records.',
      };
    }

    // Budget Commands
    if (text.includes('save my budget') || text.includes('save budget')) {
      return {
        intent: 'SAVE_BUDGET',
        extractedData: {},
        spokenResponse: 'Processing budget save confirmation.',
      };
    }

    if (text.includes('read my budget') || text.includes('what is my budget') || text.includes('show my budget')) {
      return {
        intent: 'READ_BUDGET',
        extractedData: {},
        spokenResponse: 'Reading your budget plan.',
      };
    }

    if (text.startsWith('reduce ') || text.startsWith('change ') && (text.includes('food') || text.includes('transport') || text.includes('electricity') || text.includes('savings') || text.includes('entertainment'))) {
      const matchAmount = text.match(/(?:to\s+)?\$?(\d+(?:\.\d{1,2})?)/);
      const isRemove = text.includes('remove') || text.includes('delete');
      let category = 'food';
      if (text.includes('transport')) category = 'transport';
      else if (text.includes('electricity') || text.includes('utilities')) category = 'electricity';
      else if (text.includes('savings')) category = 'savings';
      else if (text.includes('entertainment')) category = 'entertainment';

      return {
        intent: 'CREATE_OR_MODIFY_BUDGET',
        extractedData: {
          budgetAdjustment: {
            category,
            newAmount: matchAmount ? parseFloat(matchAmount[1]) : undefined,
            remove: isRemove,
          },
        },
        spokenResponse: `Updating ${category} allocation.`,
      };
    }

    if (text.includes('budget') && (text.includes('for') || text.includes('have'))) {
      // Parse multi-category budget, e.g. "Budget $100 for food, $50 for transport..."
      const allocations: Array<{ category: string; amount: number }> = [];
      const regex = /\$?(\d+(?:\.\d{1,2})?)\s*(?:dollars?)?\s*(?:for|to|on)\s+([a-zA-Z\s&]+?)(?:,|\.|$|and|\sand\s)/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        allocations.push({
          amount: parseFloat(m[1]),
          category: m[2].trim(),
        });
      }

      if (allocations.length > 0) {
        return {
          intent: 'CREATE_OR_MODIFY_BUDGET',
          extractedData: { budgetCategories: allocations },
          spokenResponse: `Analyzing your proposed budget allocations.`,
        };
      }
    }

    // Authorize
    if (text === 'authorize' || text === 'i authorize' || text.includes('authorize payment') || text === 'confirm' || text === 'pay now') {
      return {
        intent: 'AUTHORIZE_PAYMENT',
        extractedData: {},
        spokenResponse: 'Initiating demo fingerprint authorization.',
      };
    }

    // Cancel
    if (text.includes('cancel') || text.includes('stop') || text.includes('never mind') || text.includes('discard')) {
      return {
        intent: 'CANCEL_TRANSACTION',
        extractedData: {},
        spokenResponse: 'Cancelling active transaction draft.',
      };
    }

    // Clarify
    if (
      text.includes('repeat') ||
      text.includes('what am i about to pay') ||
      text.includes('how much am i paying') ||
      text.includes('who am i paying') ||
      text.includes('is this payment correct') ||
      text.includes('details')
    ) {
      return {
        intent: 'CLARIFY_TRANSACTION',
        extractedData: {},
        spokenResponse: 'Clarifying transaction details.',
      };
    }

    // Transaction Modification
    if (context.hasActiveDraft && (text.includes('change') || text.includes('meant') || text.includes('instead') || text.includes('make it'))) {
      const matchAmount = text.match(/(?:to\s+)?\$?(\d+(?:\.\d{1,2})?)/);
      let recipient: string | undefined;
      const matchRecipient = text.match(/(?:recipient to|pay to|to)\s+([a-zA-Z\s]+)/);
      if (matchRecipient && !text.includes('amount')) {
        recipient = matchRecipient[1].trim();
      }

      return {
        intent: 'MODIFY_TRANSACTION',
        extractedData: {
          amount: matchAmount ? parseFloat(matchAmount[1]) : undefined,
          recipient,
        },
        spokenResponse: 'Updating transaction draft.',
      };
    }

    // Payment Initiation
    if (text.includes('pay') || text.includes('send') || text.includes('transfer')) {
      const matchAmount = text.match(/\$?(\d+(?:\.\d{1,2})?)/);
      let recipient = '';
      let purpose = 'General payment';

      const matchRecipient = text.match(/(?:to|for)\s+([a-zA-Z0-9\s]+?)(?:\s+for|\s+of|$|\.)/);
      if (matchRecipient) {
        recipient = matchRecipient[1].replace(/electricity|power|rent|water|wifi/i, '').trim();
      }

      if (text.includes('electricity') || text.includes('electric') || text.includes('power')) {
        purpose = 'Electricity bill';
        if (!recipient) recipient = 'City Power & Light';
      } else if (text.includes('water')) {
        purpose = 'Water utility';
        if (!recipient) recipient = 'Municipal Water Department';
      }

      return {
        intent: 'INITIATE_PAYMENT',
        extractedData: {
          amount: matchAmount ? parseFloat(matchAmount[1]) : null,
          recipient: recipient || null,
          purpose,
          currency: 'USD',
        },
        spokenResponse: 'Preparing your payment draft.',
      };
    }

    // General Assist
    return {
      intent: 'GENERAL_ASSIST',
      extractedData: {},
      spokenResponse: `A-Eye Pal is ready. You can say: "Pay 50 dollars to John", "What is my balance?", or "Budget 100 dollars for groceries".`,
    };
  }
}
