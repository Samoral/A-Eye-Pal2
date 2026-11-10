import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { VoiceController } from './components/VoiceController';
import { ActiveDraftCard } from './components/ActiveDraftCard';
import { FinancialAwareness } from './components/FinancialAwareness';
import { BudgetManager } from './components/BudgetManager';
import { FingerprintAuthModal } from './components/FingerprintAuthModal';
import { PayPalCheckoutModal } from './components/PayPalCheckoutModal';
import { LiveBackendActivityPanel } from './components/LiveBackendActivityPanel';
import { HelpModal } from './components/HelpModal';
import {
  Transaction,
  BudgetPlan,
  AccountSummary,
  PayPalStatus,
  AccessibilityTheme,
  TextScale,
  ActivityEvent,
  ActivityStatus
} from './types';
import { speechService } from './services/speechService';
import { soundService } from './services/soundService';
import { apiFetch } from './utils/api';

export default function App() {
  // Theme & Accessibility Preferences
  const [theme, setTheme] = useState<AccessibilityTheme>('dark-emerald');
  const [textScale, setTextScale] = useState<TextScale>('normal');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // App State from Server
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [activeDraft, setActiveDraft] = useState<Transaction | null>(null);
  const [budget, setBudget] = useState<BudgetPlan | null>(null);
  const [paypalStatus, setPaypalStatus] = useState<PayPalStatus | null>(null);

  // Live System Activity State
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Interaction State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [spokenAssistantResponse, setSpokenAssistantResponse] = useState<string>(
    "Welcome to A-Eye Pal. I'm listening. You can ask about your finances, make a payment or manage your budget."
  );

  // Modals
  const [isFingerprintOpen, setIsFingerprintOpen] = useState<boolean>(false);
  const [isPayPalCheckoutOpen, setIsPayPalCheckoutOpen] = useState<boolean>(false);
  const [activeAuthToken, setActiveAuthToken] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  // Update speech rate in service
  useEffect(() => {
    speechService.setSpeechRate(speechRate);
  }, [speechRate]);

  // Emit client-side speech events to the authoritative activity logger
  const emitClientActivity = useCallback((params: {
    stage: 'SPEECH_INPUT' | 'RESPONSE';
    service: string;
    eventType: string;
    message: string;
    status?: ActivityStatus;
    duration?: number;
    sanitizedMetadata?: Record<string, any>;
  }) => {
    fetch('/api/activity/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).catch(() => {});
  }, []);

  // Real-time EventSource Stream for Live System Activity Pipeline
  useEffect(() => {
    // 1. Initial REST fetch for recent events
    fetch('/api/activity/recent')
      .then((res) => {
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : null;
      })
      .then((data) => {
        if (data && data.events && Array.isArray(data.events)) {
          setActivityEvents(data.events);
        }
      })
      .catch((err) => console.warn('Activity initial fetch error:', err));

    // 2. Open SSE stream
    let eventSource: EventSource | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    try {
      eventSource = new EventSource('/api/activity/stream');

      eventSource.onopen = () => {
        setIsLiveConnected(true);
      };

      eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'INIT' && Array.isArray(payload.events)) {
            setActivityEvents(payload.events);
          } else if (payload.type === 'EVENT' && payload.event) {
            setActivityEvents((prev) => [payload.event, ...prev.slice(0, 99)]);
          }
        } catch (err) {
          console.warn('Error parsing SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        setIsLiveConnected(false);
        // Fallback polling if SSE disconnects or during local rebuilds
        if (!fallbackInterval) {
          fallbackInterval = setInterval(async () => {
            try {
              const res = await fetch('/api/activity/recent');
              const ct = res.headers.get('content-type') || '';
              if (res.ok && ct.includes('application/json')) {
                const data = await res.json();
                if (data.events) {
                  setActivityEvents(data.events);
                }
              }
            } catch {}
          }, 3500);
        }
      };
    } catch {
      setIsLiveConnected(false);
    }

    // 3. Audio status event listener
    const unsubStatus = speechService.onStatus((status) => {
      if (status === 'listening') {
        emitClientActivity({
          stage: 'SPEECH_INPUT',
          service: 'MICROPHONE',
          eventType: 'MIC_LISTENING',
          message: 'Microphone active and listening for user voice command.',
          status: 'processing',
        });
      }
    });

    return () => {
      if (eventSource) eventSource.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
      unsubStatus();
    };
  }, [emitClientActivity]);

  // Initial Data Fetch
  const fetchAccountSummary = useCallback(async () => {
    try {
      const data = await apiFetch('/api/account/summary');
      setAccount(data.summary);
      setActiveDraft(data.activeDraft);
      setBudget(data.budget);
      setPaypalStatus(data.paypalStatus);
    } catch (err) {
      console.warn('Failed to load account data from server:', err);
    }
  }, []);

  useEffect(() => {
    fetchAccountSummary();
  }, [fetchAccountSummary]);

  // Handle return from PayPal Sandbox redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paypalReturn = params.get('paypal_return');
    const token = params.get('token') || params.get('orderId');

    if (paypalReturn) {
      window.history.replaceState({}, '', window.location.pathname);
      if (paypalReturn === 'success') {
        speechService.speak('Returned from PayPal. Completing your payment approval and capture.');
        apiFetch('/api/paypal/approve-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: token,
          }),
        })
          .then((res) => {
            if (res.success) {
              soundService.playSuccess();
              const msg = res.spokenAnnouncement || 'Payment successfully captured via PayPal Sandbox.';
              setSpokenAssistantResponse(msg);
              speechService.speak(msg);
              fetchAccountSummary();
            }
          })
          .catch((err) => {
            soundService.playError();
            const errText = `PayPal payment capture failed: ${err.message || 'Unknown error'}`;
            setSpokenAssistantResponse(errText);
            speechService.speak(errText);
          });
      } else if (paypalReturn === 'cancel') {
        soundService.playWarning();
        const cancelMsg = 'PayPal payment was cancelled. Your account balance remains unchanged.';
        setSpokenAssistantResponse(cancelMsg);
        speechService.speak(cancelMsg);
        fetchAccountSummary();
      }
    }
  }, [fetchAccountSummary]);

  // Clear System Activity Events
  const handleClearActivityEvents = async () => {
    setActivityEvents([]);
    try {
      await fetch('/api/activity/clear', { method: 'POST' });
    } catch (err) {
      console.warn('Failed to clear activity on server:', err);
    }
  };

  // Central Voice Command Dispatcher
  const handleSendVoiceCommand = useCallback(async (spokenText: string) => {
    const cleanText = spokenText.trim();
    if (!cleanText) {
      const unclearMsg = "I couldn't hear that clearly. Please repeat.";
      setSpokenAssistantResponse(unclearMsg);
      soundService.playWarning();
      speechService.speak(unclearMsg);
      return;
    }

    const lower = cleanText.toLowerCase();
    // Spoken voice command: Pause continuous listening
    if (lower === 'pause listening' || lower === 'stop listening' || lower === 'pause voice') {
      speechService.pauseListening(true);
      emitClientActivity({
        stage: 'SPEECH_INPUT',
        service: 'VOICE_CONTROLLER',
        eventType: 'LISTENING_PAUSED',
        message: 'Continuous voice listening paused by user command.',
        status: 'cancelled',
      });
      return;
    }

    // Spoken voice command: Resume continuous listening
    if (lower === 'resume listening' || lower === 'start listening' || lower === 'resume voice') {
      speechService.resumeListening(true);
      emitClientActivity({
        stage: 'SPEECH_INPUT',
        service: 'VOICE_CONTROLLER',
        eventType: 'LISTENING_RESUMED',
        message: 'Continuous voice listening resumed by user command.',
        status: 'success',
      });
      return;
    }

    emitClientActivity({
      stage: 'SPEECH_INPUT',
      service: 'SPEECH_RECOGNITION',
      eventType: 'COMMAND_DISPATCHED',
      message: `User spoke: "${cleanText}"`,
      status: 'success',
    });

    soundService.playProcessing();
    setIsProcessing(true);
    try {
      const data = await apiFetch('/api/voice/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cleanText }),
      });

      setSpokenAssistantResponse(data.spokenResponse);
      setActiveDraft(data.activeDraft);
      setBudget(data.budget);
      setAccount(data.account);

      // Play appropriate earcon cue
      if (data.soundCue === 'success') {
        soundService.playSuccess();
      } else if (data.soundCue === 'warning') {
        soundService.playWarning();
      } else if (data.soundCue === 'error') {
        soundService.playError();
      } else if (data.soundCue === 'fingerprint') {
        soundService.playFingerprintTick();
      }

      // Check modal trigger and stage synchronization
      if (data.modalAction === 'open_fingerprint') {
        setIsFingerprintOpen(true);
      } else if (data.modalAction === 'show_checkout' || data.stage === 'AWAITING_PAYPAL_APPROVAL') {
        setIsFingerprintOpen(false);
        setIsPayPalCheckoutOpen(true);
        if (data.activeDraft?.authorizationToken) {
          setActiveAuthToken(data.activeDraft.authorizationToken);
        }
      } else if (data.stage === 'COMPLETED' || data.intent === 'CANCEL_TRANSACTION' || !data.activeDraft) {
        setIsFingerprintOpen(false);
        setIsPayPalCheckoutOpen(false);
      } else if (data.stage === 'PAYPAL_ORDER_APPROVED') {
        setIsFingerprintOpen(false);
        setIsPayPalCheckoutOpen(true);
        if (data.activeDraft?.authorizationToken) {
          setActiveAuthToken(data.activeDraft.authorizationToken);
        }
      }

      // Read response aloud to the user (speechService automatically resumes listening when done!)
      await speechService.speak(data.spokenResponse);
    } catch (err: any) {
      console.warn('Voice processing message:', err?.message || err);
      const errMsg =
        err?.message && !err.message.includes('Unexpected') && !err.message.includes('JSON')
          ? err.message
          : 'I encountered an issue processing that command. Please try again.';
      setSpokenAssistantResponse(errMsg);
      soundService.playError();
      speechService.speak(errMsg);
    } finally {
      setIsProcessing(false);
    }
  }, [emitClientActivity]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        speechService.toggleListening();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        speechService.repeatLastSpeech();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        speechService.stopSpeech();
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        handleSendVoiceCommand("What's my balance?");
      } else if (e.key === 'Escape') {
        setIsFingerprintOpen(false);
        setIsPayPalCheckoutOpen(false);
        setIsHelpOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSendVoiceCommand]);

  // Actions
  const handleRepeatSpeech = () => {
    speechService.repeatLastSpeech();
  };

  const handleStopSpeech = () => {
    speechService.stopSpeech();
  };

  const handleClarifyDraft = async () => {
    try {
      const data = await apiFetch('/api/draft/clarify');
      setSpokenAssistantResponse(data.spokenClarification);
      speechService.speak(data.spokenClarification);
    } catch (err: any) {
      console.warn('Clarify draft error:', err?.message || err);
    }
  };

  const handleModifyDraft = async (changes: any) => {
    try {
      const data = await apiFetch('/api/draft/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      setActiveDraft(data.draft);
      setSpokenAssistantResponse(data.clarificationText);
      soundService.playWarning(); // Invalidation cue
      speechService.speak(data.clarificationText);
    } catch (err: any) {
      console.warn('Modify draft error:', err?.message || err);
    }
  };

  const handleCancelDraft = async () => {
    try {
      const data = await apiFetch('/api/draft/cancel', { method: 'POST' });
      setActiveDraft(null);
      setSpokenAssistantResponse(data.message);
      soundService.playWarning();
      speechService.speak(data.message);
      fetchAccountSummary();
    } catch (err: any) {
      console.warn('Cancel draft error:', err?.message || err);
    }
  };

  const handleFingerprintSuccess = (token: string) => {
    setActiveAuthToken(token);
    setIsFingerprintOpen(false);
    setIsPayPalCheckoutOpen(true);
    fetchAccountSummary();
  };

  const handlePayPalPaymentSuccess = () => {
    setIsPayPalCheckoutOpen(false);
    setActiveAuthToken(null);
    fetchAccountSummary();
  };

  const handleModifyBudgetCategory = async (category: string, newAmount?: number, remove?: boolean) => {
    try {
      const data = await apiFetch('/api/budget/modify-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, newAmount, remove }),
      });
      setBudget(data.budget);
      setSpokenAssistantResponse(data.spokenAnalysis);
      if (data.isValid) soundService.playSuccess();
      else soundService.playWarning();
      speechService.speak(data.spokenAnalysis);
    } catch (err: any) {
      console.warn('Modify budget error:', err?.message || err);
    }
  };

  const handleSaveBudget = async () => {
    try {
      const data = await apiFetch('/api/budget/save', { method: 'POST' });
      setBudget(data.budget);
      setSpokenAssistantResponse(data.spokenResponse);
      if (data.success) soundService.playSuccess();
      else soundService.playError();
      speechService.speak(data.spokenResponse);
    } catch (err: any) {
      console.warn('Save budget error:', err?.message || err);
    }
  };

  const handleReadBudget = async () => {
    try {
      const data = await apiFetch('/api/budget/read');
      setSpokenAssistantResponse(data.spokenResponse);
      speechService.speak(data.spokenResponse);
    } catch (err: any) {
      console.warn('Read budget error:', err?.message || err);
    }
  };

  const handleResetDemo = async () => {
    try {
      const data = await apiFetch('/api/account/reset-demo', { method: 'POST' });
      setSpokenAssistantResponse(data.message);
      soundService.playSuccess();
      speechService.speak(data.message);
      fetchAccountSummary();
    } catch (err: any) {
      console.warn('Reset demo error:', err?.message || err);
    }
  };

  // Font size class mapping
  const textScaleClasses =
    textScale === 'xl'
      ? 'text-xl'
      : textScale === 'large'
      ? 'text-lg'
      : 'text-base';

  return (
    <div
      className={`min-h-screen transition-colors flex flex-col font-sans ${textScaleClasses} ${
        theme === 'yellow-black'
          ? 'bg-black text-yellow-300'
          : theme === 'high-contrast-light'
          ? 'bg-slate-100 text-slate-900'
          : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Skip to Main Content Link for Screen Readers */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 z-50 px-4 py-2 bg-emerald-500 text-black font-extrabold rounded-lg shadow-xl"
      >
        Skip to main content
      </a>

      {/* App Header */}
      <Header
        theme={theme}
        setTheme={setTheme}
        textScale={textScale}
        setTextScale={setTextScale}
        speechRate={speechRate}
        setSpeechRate={setSpeechRate}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        paypalStatus={paypalStatus}
        isAiConnected={true}
        onResetDemo={handleResetDemo}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Main Content Area: Responsive Two-Column Layout */}
      <main
        id="main-content"
        className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-6 sm:px-6 lg:px-8"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Primary Voice & Financial Assistant (~60%) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Voice Interaction Hub */}
            <VoiceController
              theme={theme}
              isProcessing={isProcessing}
              spokenAssistantResponse={spokenAssistantResponse}
              draft={activeDraft}
              onSendVoiceCommand={handleSendVoiceCommand}
              onRepeatSpeech={handleRepeatSpeech}
              onStopSpeech={handleStopSpeech}
            />

            {/* Active Payment Draft Card */}
            <ActiveDraftCard
              draft={activeDraft}
              theme={theme}
              availableBalance={account?.balance || 0}
              onClarify={handleClarifyDraft}
              onModify={handleModifyDraft}
              onCancel={handleCancelDraft}
              onOpenFingerprintModal={() => setIsFingerprintOpen(true)}
            />

            {/* Financial Awareness & History Drawer */}
            {account && (
              <FinancialAwareness
                account={account}
                theme={theme}
                onVoiceQuery={handleSendVoiceCommand}
              />
            )}

            {/* Voice Budget Manager Drawer */}
            {budget && (
              <BudgetManager
                budget={budget}
                availableBalance={account?.balance || 0}
                theme={theme}
                onVoiceCommand={handleSendVoiceCommand}
                onModifyCategory={handleModifyBudgetCategory}
                onSaveBudget={handleSaveBudget}
                onReadBudget={handleReadBudget}
              />
            )}
          </div>

          {/* Right Column: Persistent Live Technical Audit Panel (~40%) */}
          <div className="lg:col-span-5 relative z-50 lg:sticky lg:top-20 h-[560px] lg:h-[calc(100vh-6.5rem)]">
            <LiveBackendActivityPanel
              events={activityEvents}
              theme={theme}
              isLiveConnected={isLiveConnected}
              onClearEvents={handleClearActivityEvents}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        role="contentinfo"
        className={`border-t py-6 px-4 text-center text-xs font-semibold ${
          theme === 'yellow-black'
            ? 'border-yellow-400/40 text-yellow-400/80 bg-black'
            : theme === 'high-contrast-light'
            ? 'border-slate-300 text-slate-600 bg-white'
            : 'border-slate-800 text-slate-400 bg-slate-900/40'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            A-Eye Pal • Designed for accessible, voice-first independent financial control.
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsHelpOpen(true)}
              className="underline hover:no-underline cursor-pointer"
            >
              Shortcuts & Commands
            </button>
            <span>•</span>
            <span>PayPal Sandbox Integration</span>
          </div>
        </div>
      </footer>

      {/* Simulated Fingerprint Authorization Modal */}
      <FingerprintAuthModal
        isOpen={isFingerprintOpen}
        draft={activeDraft}
        theme={theme}
        onClose={() => setIsFingerprintOpen(false)}
        onAuthorizedSuccess={handleFingerprintSuccess}
      />

      {/* PayPal Sandbox Checkout Modal */}
      <PayPalCheckoutModal
        isOpen={isPayPalCheckoutOpen}
        draft={activeDraft}
        authorizationToken={activeAuthToken || activeDraft?.authorizationToken || null}
        paypalStatus={paypalStatus}
        theme={theme}
        onClose={() => setIsPayPalCheckoutOpen(false)}
        onPaymentSuccess={handlePayPalPaymentSuccess}
        onDraftUpdated={(updatedDraft) => setActiveDraft(updatedDraft)}
      />

      {/* Accessibility Help & Shortcuts Modal */}
      <HelpModal
        isOpen={isHelpOpen}
        theme={theme}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
