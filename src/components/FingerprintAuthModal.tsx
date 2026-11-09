import React, { useState, useEffect, useRef } from 'react';
import {
  Fingerprint,
  ShieldCheck,
  ShieldAlert,
  AlertOctagon,
  X,
  Volume2,
  CheckCircle2,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { Transaction, AccessibilityTheme } from '../types';
import { soundService } from '../services/soundService';
import { speechService } from '../services/speechService';
import { apiFetch } from '../utils/api';

interface FingerprintAuthModalProps {
  isOpen: boolean;
  draft: Transaction | null;
  theme: AccessibilityTheme;
  onClose: () => void;
  onAuthorizedSuccess: (token: string) => void;
}

export const FingerprintAuthModal: React.FC<FingerprintAuthModalProps> = ({
  isOpen,
  draft,
  theme,
  onClose,
  onAuthorizedSuccess,
}) => {
  const [scanProgress, setScanProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationAnnouncement, setVerificationAnnouncement] = useState('');
  const [errorText, setErrorText] = useState('');
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Read transaction aloud on open
  useEffect(() => {
    if (isOpen && draft) {
      setIsVerified(false);
      setScanProgress(0);
      setErrorText('');
      setVerificationAnnouncement('');

      const promptText =
        `Transaction Authorization. You are authorizing a payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} for ${draft.purpose}. ` +
        `This is a simulated biometric demonstration. To confirm, press and hold the demo touch pad or say "Authorize".`;

      speechService.speak(promptText);
    }
  }, [isOpen, draft]);

  if (!isOpen || !draft) return null;

  const startScan = () => {
    if (isVerified) return;
    setIsScanning(true);
    setErrorText('');

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([30, 40, 30]);
    }

    let progress = 0;
    scanTimerRef.current = setInterval(() => {
      progress += 5;
      soundService.playFingerprintTick();
      setScanProgress(progress);

      // Periodically announce progress for screen readers
      if (progress === 25 || progress === 50 || progress === 75) {
        speechService.speak(`${progress} percent verified`);
      }

      if (progress >= 100) {
        clearInterval(scanTimerRef.current!);
        completeVerification();
      }
    }, 60);
  };

  const cancelScan = () => {
    if (isVerified) return;
    setIsScanning(false);
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
    }
    if (scanProgress < 100) {
      setScanProgress(0);
      speechService.speak('Verification paused. Press and hold to resume.');
    }
  };

  const completeVerification = async () => {
    setIsScanning(false);
    try {
      // Call authoritative backend API to issue real demo token
      const data = await apiFetch('/api/draft/authorize-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!data.success) {
        setErrorText(data.announcement || 'Authorization failed. Please try again.');
        soundService.playError();
        speechService.speak(data.announcement || 'Payment authorization declined.');
        return;
      }

      setIsVerified(true);
      soundService.playFingerprintSuccess();

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([80, 50, 120]);
      }

      // Exact announcements required by prompt
      const announce =
        'Demo fingerprint verification successful. No real fingerprint was accessed. Fingerprint verification successful. Your payment is authorized. Proceeding to PayPal Sandbox.';
      setVerificationAnnouncement(announce);
      await speechService.speak(announce);

      setTimeout(() => {
        onAuthorizedSuccess(data.authorizationToken);
      }, 1200);
    } catch (err: any) {
      setErrorText(err?.message || 'Verification error');
      soundService.playError();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fingerprint-modal-title"
      className="fixed inset-0 lg:right-[41.666%] z-40 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn"
    >
      <div
        className="w-full max-w-lg rounded-3xl p-6 sm:p-8 border border-slate-200 bg-white text-slate-900 shadow-2xl relative transition-all"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2.5 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
          aria-label="Close demo authorization modal"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 border border-blue-200 bg-blue-50 text-[#0070BA]">
            <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
            <span>Simulated Biometric Demo</span>
          </div>
          <h2
            id="fingerprint-modal-title"
            className="text-2xl sm:text-3xl font-extrabold text-[#001C3F] tracking-tight"
          >
            Authorize Payment
          </h2>
        </div>

        {/* Prominent Legal & Privacy Disclaimer */}
        <div
          role="note"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs sm:text-sm font-semibold mb-5 flex items-start gap-2.5"
        >
          <AlertOctagon className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
          <div>
            <span className="uppercase tracking-wider font-bold block text-amber-950">
              Notice: Demonstration Only
            </span>
            <span>
              This is a demonstration, NOT real biometric authentication. No device sensor is accessed. No biometric data is collected or stored.
            </span>
          </div>
        </div>

        {/* Readback Summary Card */}
        <div
          className={`p-4 rounded-2xl border mb-6 ${
            theme === 'yellow-black'
              ? 'border-yellow-400/40 bg-yellow-400/5 text-yellow-300'
              : 'border-slate-200 bg-slate-50 text-slate-900'
          }`}
        >
          <div className="flex justify-between items-center text-xs font-semibold text-slate-500 mb-1">
            <span>Amount to Authorize:</span>
            <span>Method:</span>
          </div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-2xl sm:text-3xl font-black text-[#0070BA]">
              ${draft.amount.toFixed(2)} {draft.currency}
            </span>
            <span className="font-bold text-slate-700">{draft.paymentMethod}</span>
          </div>
          <p className="text-sm font-semibold border-t border-slate-200 pt-2 text-slate-800">
            Paying to: <span className="font-bold text-[#001C3F]">{draft.recipient}</span> ({draft.purpose})
          </p>
        </div>

        {/* Simulated Fingerprint Interactive Pad */}
        <div className="flex flex-col items-center justify-center my-4">
          <div className="relative">
            {/* Concentric scan rings */}
            <div
              className={`w-36 h-36 rounded-full border-4 flex items-center justify-center transition-all ${
                isVerified
                  ? 'border-emerald-500 bg-emerald-50 scale-105'
                  : isScanning
                  ? 'border-[#0070BA] animate-pulse bg-blue-50 scale-105'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50'
              }`}
            >
              <button
                onMouseDown={startScan}
                onMouseUp={cancelScan}
                onMouseLeave={cancelScan}
                onTouchStart={startScan}
                onTouchEnd={cancelScan}
                disabled={isVerified}
                aria-label="Press and hold simulated touch pad to verify demo fingerprint"
                className={`w-28 h-28 rounded-full flex flex-col items-center justify-center transition-transform active:scale-90 focus:outline-none focus:ring-4 cursor-pointer shadow-md ${
                  isVerified
                    ? 'bg-emerald-600 text-white'
                    : isScanning
                    ? 'bg-[#0070BA] text-white'
                    : 'bg-[#0070BA] hover:bg-[#003087] text-white'
                }`}
              >
                {isVerified ? (
                  <CheckCircle2 className="w-14 h-14" aria-hidden="true" />
                ) : (
                  <Fingerprint className={`w-14 h-14 ${isScanning ? 'animate-bounce' : ''}`} aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Circular progress overlay badge */}
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase bg-[#001C3F] text-white border border-slate-200 shadow-xs">
              {isVerified ? 'Verified' : isScanning ? `${scanProgress}%` : 'Hold To Verify'}
            </div>
          </div>

          <p className="mt-6 text-sm sm:text-base font-bold text-center text-slate-800">
            {isVerified
              ? 'Verification complete! Redirecting to PayPal Sandbox...'
              : isScanning
              ? 'Scanning simulated touch pad... Keep holding'
              : 'Press & hold the fingerprint sensor pad above'}
          </p>
        </div>

        {/* Verification Success Announcement */}
        {verificationAnnouncement && (
          <div
            role="status"
            aria-live="assertive"
            className="mt-4 p-4 rounded-2xl bg-emerald-500/20 border-2 border-emerald-400 text-emerald-200 text-center font-bold text-base animate-fadeIn"
          >
            "{verificationAnnouncement}"
          </div>
        )}

        {/* Error Announcement */}
        {errorText && (
          <div
            role="alert"
            className="mt-4 p-4 rounded-2xl bg-red-500/20 border-2 border-red-400 text-red-200 text-center font-bold text-sm"
          >
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
};
