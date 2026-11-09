import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  X,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { Transaction, AccessibilityTheme, PayPalStatus } from '../types';
import { soundService } from '../services/soundService';
import { speechService } from '../services/speechService';
import { apiFetch } from '../utils/api';

interface PayPalCheckoutModalProps {
  isOpen: boolean;
  draft: Transaction | null;
  authorizationToken: string | null;
  paypalStatus: PayPalStatus | null;
  theme: AccessibilityTheme;
  onClose: () => void;
  onPaymentSuccess: () => void;
}

export const PayPalCheckoutModal: React.FC<PayPalCheckoutModalProps> = ({
  isOpen,
  draft,
  authorizationToken,
  paypalStatus,
  theme,
  onClose,
  onPaymentSuccess,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(draft?.paypalOrderId || null);
  const [receipt, setReceipt] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Automatically initialize PayPal Sandbox order upon opening
  useEffect(() => {
    let isMounted = true;

    async function initOrder() {
      if (!isOpen || !draft || !authorizationToken || receipt) return;
      setErrorMsg('');

      try {
        if (!draft.paypalOrderId) {
          const createData = await apiFetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authorizationToken }),
          });

          if (isMounted && createData.success) {
            setOrderId(createData.order.orderId);
            speechService.speak('Proceeding to PayPal Sandbox. Select Approve to automatically complete your payment.');
          }
        } else {
          setOrderId(draft.paypalOrderId);
          speechService.speak('Proceeding to PayPal Sandbox. Select Approve to automatically complete your payment.');
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err?.message || 'Failed to initialize PayPal Sandbox order');
        }
      }
    }

    initOrder();

    return () => {
      isMounted = false;
    };
  }, [isOpen, draft, authorizationToken, receipt]);

  if (!isOpen || !draft || !authorizationToken) return null;

  // Handles PayPal buyer approval with AUTOMATIC CAPTURE
  const handleApproveAndAutoCapture = async () => {
    setIsProcessing(true);
    setErrorMsg('');

    try {
      // Announce approval step
      speechService.speak('PayPal approval received. Completing your payment.');

      const activeId = orderId || draft.paypalOrderId;
      const data = await apiFetch('/api/paypal/approve-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationToken,
          orderId: activeId,
        }),
      });

      if (!data.success) {
        throw new Error(data.error || 'Failed to approve and capture PayPal payment');
      }

      setReceipt(data);
      soundService.playSuccess();

      // Announce the required final payment status through speech
      const announcement = data.spokenAnnouncement ||
        `PayPal approval received. Completing your payment. Your payment has been captured successfully. Payment of $${draft.amount.toFixed(2)} ${draft.currency} to ${draft.recipient} has been completed via PayPal Sandbox. Your new available balance is $${data.finalized.newBalance.toFixed(2)} ${draft.currency}.`;

      await speechService.speak(announcement);

      setTimeout(() => {
        onPaymentSuccess();
      }, 2000);
    } catch (err: any) {
      console.warn('PayPal checkout error:', err?.message || err);
      const errMsg = err?.message || 'PayPal payment approval or capture failed.';
      setErrorMsg(errMsg);
      soundService.playError();
      speechService.speak(`Payment error: ${errMsg}. Please try approving again or cancel.`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paypal-modal-title"
      className="fixed inset-0 lg:right-[41.666%] z-40 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn"
    >
      <div
        className="w-full max-w-lg rounded-3xl p-6 sm:p-8 border border-slate-200 bg-white text-slate-900 shadow-2xl relative transition-all"
      >
        {/* Close Button */}
        {!receipt && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2.5 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
            aria-label="Close PayPal checkout modal"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}

        {/* Modal Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 bg-blue-50 border border-blue-200 text-[#0070BA]">
            <CreditCard className="w-4 h-4" aria-hidden="true" />
            <span>PayPal Sandbox Integration</span>
          </div>
          <h2
            id="paypal-modal-title"
            className="text-2xl sm:text-3xl font-extrabold text-[#001C3F] tracking-tight"
          >
            {receipt ? 'Payment Confirmed' : 'PayPal Sandbox Buyer Approval'}
          </h2>
          <p className="text-xs sm:text-sm font-medium text-slate-500 mt-1">
            {paypalStatus?.isLiveSandbox
              ? 'Connected to live PayPal Sandbox REST API v2.'
              : 'Operating in clearly labelled PayPal Sandbox demo simulation mode.'}
          </p>
        </div>

        {/* Order Details Card */}
        <div
          className={`p-5 rounded-2xl border mb-6 space-y-3 ${
            theme === 'yellow-black'
              ? 'border-yellow-400/50 bg-yellow-400/5 text-yellow-300'
              : 'border-slate-200 bg-slate-50 text-slate-900'
          }`}
        >
          <div className="flex justify-between items-center text-xs sm:text-sm font-semibold text-slate-600">
            <span>Recipient:</span>
            <span className="font-bold text-slate-900 text-base">{draft.recipient}</span>
          </div>
          <div className="flex justify-between items-center text-xs sm:text-sm font-semibold text-slate-600">
            <span>Purpose:</span>
            <span className="font-medium text-slate-800">{draft.purpose}</span>
          </div>
          <div className="flex justify-between items-center text-xs sm:text-sm font-semibold text-slate-600">
            <span>PayPal Order ID:</span>
            <span className="font-mono text-xs text-[#0070BA] font-bold">
              {orderId || draft.paypalOrderId || 'Initializing...'}
            </span>
          </div>
          <div className="flex justify-between items-center text-base font-bold border-t border-slate-200 pt-3">
            <span className="text-slate-800">Total to Charge:</span>
            <span className="text-2xl font-black text-[#0070BA]">
              ${draft.amount.toFixed(2)} {draft.currency}
            </span>
          </div>
        </div>

        {/* Successful Receipt Display */}
        {receipt && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-left space-y-2 animate-fadeIn">
            <div className="flex items-center gap-2 font-bold text-lg text-emerald-800">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>PayPal Sandbox Capture Successful</span>
            </div>
            <p className="text-sm font-medium text-emerald-800">{receipt.spokenAnnouncement || receipt.finalized?.message}</p>
            <div className="text-xs font-mono text-emerald-700 pt-2 border-t border-emerald-200">
              <div>Order ID: {receipt.capture?.orderId}</div>
              <div>Capture ID: {receipt.capture?.captureId}</div>
              <div>Verified Balance: ${receipt.finalized?.newBalance?.toFixed(2)}</div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-3 font-semibold text-sm"
          >
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Action Controls: Only the required PayPal buyer approval step! Automatic capture runs immediately upon approval */}
        {!receipt ? (
          <button
            onClick={handleApproveAndAutoCapture}
            disabled={isProcessing}
            className={`w-full py-3.5 px-6 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 transition-all shadow-md cursor-pointer disabled:opacity-50 ${
              theme === 'yellow-black'
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-[#0070BA] text-white hover:bg-[#003087]'
            }`}
            aria-label="Approve checkout with PayPal Sandbox to automatically capture payment"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                <span>Approving & Capturing via PayPal Sandbox...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                <span>Approve with PayPal Sandbox</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onClose}
            className="w-full py-3.5 px-6 rounded-xl font-bold text-base bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close Receipt
          </button>
        )}
      </div>
    </div>
  );
};
