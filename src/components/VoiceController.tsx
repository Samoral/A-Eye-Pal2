import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Square,
  Sparkles,
  Loader2,
  Volume2,
  AlertCircle
} from 'lucide-react';
import { AccessibilityTheme, Transaction, VoiceState } from '../types';
import { speechService } from '../services/speechService';

interface VoiceControllerProps {
  theme: AccessibilityTheme;
  isProcessing: boolean;
  spokenAssistantResponse: string;
  draft: Transaction | null;
  onSendVoiceCommand: (text: string) => Promise<void>;
  onRepeatSpeech: () => void;
  onStopSpeech: () => void;
}

export const VoiceController: React.FC<VoiceControllerProps> = ({
  isProcessing,
  spokenAssistantResponse,
  draft,
  onSendVoiceCommand,
  onRepeatSpeech,
  onStopSpeech,
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>('INITIALIZING');
  const [stateMessage, setStateMessage] = useState<string>('');
  const [transcript, setTranscript] = useState('');
  const [manualText, setManualText] = useState('');
  const [hasStartedAutoListen, setHasStartedAutoListen] = useState(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe to speech service state & transcripts
  useEffect(() => {
    // 1. Transcript listener
    const unsubTranscript = speechService.onTranscript((text, isFinal) => {
      setTranscript(text);

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      // If speech finalized or short pause after speech, dispatch command
      if (isFinal) {
        silenceTimerRef.current = setTimeout(() => {
          submitSpokenText(text);
        }, 300);
      } else {
        silenceTimerRef.current = setTimeout(() => {
          if (text.trim().length > 1) {
            submitSpokenText(text);
          }
        }, 1000);
      }
    });

    // 2. State Machine listener
    const unsubState = speechService.onStateChange((state, msg) => {
      setVoiceState(state);
      if (msg) setStateMessage(msg);
    });

    return () => {
      unsubTranscript();
      unsubState();
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, []);

  // Sync processing state from parent
  useEffect(() => {
    if (isProcessing) {
      setVoiceState('PROCESSING');
      speechService.setState('PROCESSING');
    }
  }, [isProcessing]);

  // Initial Auto-kickoff on mount
  useEffect(() => {
    if (!hasStartedAutoListen) {
      setHasStartedAutoListen(true);
      speechService.requestMicrophonePermission().then((granted) => {
        if (granted) {
          speechService.startListening();
        } else {
          setVoiceState('WAITING_FOR_USER');
        }
      });
    }
  }, [hasStartedAutoListen]);

  const submitSpokenText = (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || isProcessing) return;

    setTranscript('');
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Intercept client voice controls immediately for instant non-blocking action
    const lower = clean.toLowerCase();
    if (lower === 'pause listening' || lower === 'stop listening' || lower === 'pause voice') {
      speechService.pauseListening(true);
      return;
    }
    if (lower === 'resume listening' || lower === 'start listening' || lower === 'resume voice') {
      speechService.resumeListening(true);
      return;
    }

    onSendVoiceCommand(clean);
  };

  const handleMicToggle = () => {
    const isCurrentlyListening = voiceState === 'LISTENING' || voiceState === 'SPEECH_DETECTED';

    if (isCurrentlyListening) {
      speechService.pauseListening(false);
    } else {
      speechService.resumeListening(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim() || isProcessing) return;
    const txt = manualText.trim();
    setManualText('');
    submitSpokenText(txt);
  };

  // Contextual voice suggestions
  const getContextualCommands = () => {
    if (!draft || draft.status === 'completed' || draft.status === 'cancelled') {
      return [
        { label: "Pay $50 to John", phrase: "I want to pay $50 to John." },
        { label: "Check Balance", phrase: "What is my balance?" },
        { label: "Recent Spending", phrase: "How much did I spend this week?" },
        { label: "Pause Listening", phrase: "Pause listening." },
      ];
    }

    if (draft.conversationStage === 'AWAITING_DETAILS_CONFIRMATION') {
      return [
        { label: 'Say "Yes" (Review Details)', phrase: "Yes." },
        { label: 'Change to $75', phrase: "No, change it to $75." },
        { label: "Cancel", phrase: "Cancel" },
      ];
    }

    if (draft.conversationStage === 'AWAITING_CORRECTION_OR_APPROVAL') {
      return [
        { label: 'Say "Yes" (Approve)', phrase: "Yes." },
        { label: 'Change to $75', phrase: "No, change it to $75." },
        { label: 'Change Recipient to Sarah', phrase: "Change recipient to Sarah" },
        { label: "Cancel", phrase: "Cancel" },
      ];
    }

    if (draft.conversationStage === 'AWAITING_AUTHORIZATION') {
      return [
        { label: 'Say "I authorize this payment"', phrase: "I authorize this payment." },
        { label: 'Change to $75', phrase: "No, change it to $75." },
        { label: "Cancel", phrase: "Cancel" },
      ];
    }

    return [
      { label: "Check Balance", phrase: "What is my balance?" },
      { label: "Repeat Details", phrase: "Repeat the transaction details" },
      { label: "Cancel", phrase: "Cancel" },
    ];
  };

  const sampleCommands = getContextualCommands();

  // Distinct visual configuration based on VoiceState for PayPal Fintech design
  const getVisualState = () => {
    switch (voiceState) {
      case 'LISTENING':
      case 'SPEECH_DETECTED':
        return {
          label: voiceState === 'SPEECH_DETECTED' ? 'SPEECH DETECTED' : 'LISTENING',
          badgeText: 'Microphone Active • Continuous Mode',
          btnBg: 'bg-[#0070BA] text-white ring-4 ring-[#0070BA]/25 shadow-lg shadow-blue-500/20 scale-105',
          pulse: true,
          icon: Mic,
          badgeColor: 'text-[#0070BA] bg-blue-50 border-blue-200',
        };
      case 'PROCESSING':
        return {
          label: 'PROCESSING REQUEST',
          badgeText: 'Interpreting financial command...',
          btnBg: 'bg-blue-50 text-[#0070BA] border-2 border-blue-300 shadow-sm',
          pulse: true,
          icon: Loader2,
          badgeColor: 'text-[#003087] bg-blue-100/70 border-blue-300',
        };
      case 'ASSISTANT_SPEAKING':
        return {
          label: 'A-EYE PAL IS SPEAKING',
          badgeText: 'Assistant audio active',
          btnBg: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20',
          pulse: false,
          icon: Volume2,
          badgeColor: 'text-emerald-800 bg-emerald-50 border-emerald-200',
        };
      case 'PAUSED':
        return {
          label: 'MICROPHONE PAUSED',
          badgeText: 'Say "Resume listening" or click to speak',
          btnBg: 'bg-slate-100 border border-slate-300 text-slate-500 hover:text-slate-800',
          pulse: false,
          icon: MicOff,
          badgeColor: 'text-slate-600 bg-slate-100 border-slate-200',
        };
      case 'ERROR':
        return {
          label: 'MICROPHONE ERROR',
          badgeText: stateMessage || 'Permission denied. Please enable microphone.',
          btnBg: 'bg-rose-50 border border-rose-300 text-rose-700',
          pulse: false,
          icon: AlertCircle,
          badgeColor: 'text-rose-700 bg-rose-50 border-rose-200',
        };
      case 'WAITING_FOR_USER':
      case 'INITIALIZING':
      default:
        return {
          label: "I'M LISTENING",
          badgeText: 'A-Eye Pal is ready • Speak naturally',
          btnBg: 'bg-[#003087] text-white hover:bg-[#002060] shadow-md shadow-blue-900/10',
          pulse: false,
          icon: Mic,
          badgeColor: 'text-[#003087] bg-blue-50 border-blue-200',
        };
    }
  };

  const visual = getVisualState();
  const IconComponent = visual.icon;
  const isListeningOrSpeech = voiceState === 'LISTENING' || voiceState === 'SPEECH_DETECTED';

  return (
    <section
      aria-label="Voice Interaction Hub"
      className="w-full rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 relative shadow-sm transition-all"
    >
      <div className="flex flex-col items-center text-center max-w-xl mx-auto space-y-5">
        {/* Screen Reader Live Region for Non-Visual State Changes */}
        <div role="status" aria-live="polite" className="sr-only">
          {voiceState === 'LISTENING' && 'A-Eye Pal is listening. You can speak now.'}
          {voiceState === 'SPEECH_DETECTED' && 'I heard you. Processing your request.'}
          {voiceState === 'PROCESSING' && "I'm processing your request."}
          {voiceState === 'ASSISTANT_SPEAKING' && `Assistant speaking: ${spokenAssistantResponse}`}
          {voiceState === 'WAITING_FOR_USER' && "I'm listening."}
          {voiceState === 'PAUSED' && 'Voice listening is paused.'}
          {voiceState === 'ERROR' &&
            'Microphone access is unavailable. Please enable microphone permission in your browser settings.'}
        </div>

        {/* State Status Pill */}
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase border ${visual.badgeColor}`}
          >
            <span
              className={`w-2 h-2 rounded-full bg-current ${visual.pulse ? 'animate-ping' : ''}`}
              aria-hidden="true"
            />
            <span>{visual.label}</span>
          </span>
          {voiceState === 'PAUSED' && (
            <button
              onClick={() => speechService.resumeListening(true)}
              className="text-xs text-[#0070BA] hover:text-[#003087] font-semibold underline cursor-pointer"
            >
              Resume
            </button>
          )}
        </div>

        {/* Prominent Microphone Control Button */}
        <div className="relative my-1">
          {isListeningOrSpeech && (
            <>
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-20 bg-[#0070BA] pointer-events-none"
                aria-hidden="true"
              />
              <span
                className="absolute -inset-2.5 rounded-full border-2 border-[#0070BA]/20 animate-pulse pointer-events-none"
                aria-hidden="true"
              />
            </>
          )}

          <button
            onClick={handleMicToggle}
            aria-pressed={isListeningOrSpeech}
            aria-label={`${visual.label}: Click to ${isListeningOrSpeech ? 'pause' : 'resume'} listening`}
            className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center transition-all duration-200 active:scale-95 focus:outline-none focus:ring-4 cursor-pointer relative z-10 ${visual.btnBg}`}
          >
            <IconComponent
              className={`w-11 h-11 sm:w-12 sm:h-12 ${
                voiceState === 'PROCESSING'
                  ? 'animate-spin'
                  : isListeningOrSpeech
                  ? 'animate-pulse'
                  : ''
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] font-bold uppercase tracking-wider mt-1 text-current opacity-95">
              {visual.label === 'LISTENING'
                ? 'Listening'
                : visual.label === 'MICROPHONE PAUSED'
                ? 'Paused'
                : visual.label === 'PROCESSING REQUEST'
                ? 'Working'
                : 'Listening'}
            </span>
          </button>
        </div>

        {/* Live Animated Waveform when listening or speaking */}
        {isListeningOrSpeech ? (
          <div className="flex items-center gap-1.5 h-5" aria-hidden="true">
            <span className="w-1 bg-[#0070BA] rounded-full animate-pulse h-3" />
            <span className="w-1 bg-[#0070BA] rounded-full animate-pulse h-5" style={{ animationDelay: '100ms' }} />
            <span className="w-1 bg-[#0070BA] rounded-full animate-pulse h-6" style={{ animationDelay: '200ms' }} />
            <span className="w-1 bg-[#0070BA] rounded-full animate-pulse h-4" style={{ animationDelay: '300ms' }} />
            <span className="w-1 bg-[#0070BA] rounded-full animate-pulse h-2" style={{ animationDelay: '400ms' }} />
          </div>
        ) : voiceState === 'ASSISTANT_SPEAKING' ? (
          <div className="flex items-center gap-1.5 h-5" aria-hidden="true">
            <span className="w-1 bg-emerald-500 rounded-full animate-pulse h-4" />
            <span className="w-1 bg-emerald-500 rounded-full animate-pulse h-6" style={{ animationDelay: '150ms' }} />
            <span className="w-1 bg-emerald-500 rounded-full animate-pulse h-3" style={{ animationDelay: '300ms' }} />
            <span className="w-1 bg-emerald-500 rounded-full animate-pulse h-5" style={{ animationDelay: '75ms' }} />
          </div>
        ) : (
          <p className="text-xs text-slate-500 font-medium">{visual.badgeText}</p>
        )}

        {/* Live Recognized User Speech Banner */}
        {transcript && (
          <div
            className="w-full px-4 py-2.5 rounded-xl border border-blue-200 bg-blue-50/70 text-left text-sm font-medium text-[#003087] animate-fadeIn"
            aria-live="polite"
          >
            <span className="text-[10px] uppercase font-bold tracking-wider block text-[#0070BA] mb-0.5">
              User Speech:
            </span>
            "{transcript}"
          </div>
        )}

        {/* Assistant Response Box */}
        {spokenAssistantResponse && (
          <div
            className="w-full p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-slate-50/70 text-left transition-all shadow-2xs"
            aria-label="Assistant Spoken Output"
          >
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#0070BA] uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Assistant Response</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onRepeatSpeech}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                  title="Repeat assistant speech (Hotkey: R)"
                  aria-label="Repeat response"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Repeat</span>
                </button>
                {voiceState === 'ASSISTANT_SPEAKING' && (
                  <button
                    onClick={onStopSpeech}
                    className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer"
                    title="Silence speech (Hotkey: S)"
                    aria-label="Silence speech"
                  >
                    <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                    <span>Stop</span>
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm sm:text-base font-semibold text-[#001C3F] leading-relaxed">
              "{spokenAssistantResponse}"
            </p>
          </div>
        )}

        {/* Suggested Voice Commands */}
        <div className="w-full pt-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Suggested Voice Commands:
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {sampleCommands.map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => submitSpokenText(cmd.phrase)}
                disabled={isProcessing}
                className="text-xs font-medium px-3 py-1.2 rounded-full border border-slate-200 bg-white text-slate-700 hover:border-[#0070BA] hover:text-[#0070BA] hover:bg-blue-50/30 transition-all cursor-pointer shadow-2xs"
                aria-label={`Voice prompt: ${cmd.phrase}`}
              >
                "{cmd.label}"
              </button>
            ))}
          </div>
        </div>

        {/* Text Fallback Input */}
        <form
          onSubmit={handleManualSubmit}
          className="w-full max-w-md flex items-center gap-2 pt-1"
          role="search"
          aria-label="Text command fallback"
        >
          <label htmlFor="voice-text-input" className="sr-only">
            Type command if microphone is unavailable
          </label>
          <input
            id="voice-text-input"
            ref={textInputRef}
            type="text"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            disabled={isProcessing}
            placeholder='Or type e.g., "Pay $50 to John", "What is my balance?"...'
            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0070BA] focus:ring-1 focus:ring-[#0070BA] transition-colors"
          />
          <button
            type="submit"
            disabled={isProcessing || !manualText.trim()}
            className="p-2 rounded-xl font-medium bg-[#0070BA] text-white hover:bg-[#003087] transition-colors disabled:opacity-40 cursor-pointer shadow-xs"
            aria-label="Submit command"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
};
