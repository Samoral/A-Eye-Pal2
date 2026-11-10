import React, { useState } from 'react';
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Fingerprint,
  ArrowRight
} from 'lucide-react';
import { Transaction, AccessibilityTheme } from '../types';

interface ActiveDraftCardProps {
  draft: Transaction | null;
  theme: AccessibilityTheme;
  availableBalance: number;
  onClarify: () => void;
  onModify: (changes: { amount?: number; recipient?: string; purpose?: string; currency?: string }) => void;
  onCancel: () => void;
  onOpenFingerprintModal: () => void;
}

export const ActiveDraftCard: React.FC<ActiveDraftCardProps> = ({
  draft,
  availableBalance,
  onClarify,
  onCancel,
  onOpenFingerprintModal,
}) => {
  // If no draft is active, keep the interface clean without cluttering empty cards
  if (!draft) return null;

  const isOverBalance = draft.amount > availableBalance;
  const isAuthorized = Boolean(draft.authorizationToken && draft.status === 'authorized');

  return (
    <section
      aria-labelledby="active-draft-heading"
      className="w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs relative transition-all animate-fadeIn"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#0070BA]" aria-hidden="true" />
          <h2 id="active-draft-heading" className="text-sm font-bold text-[#001C3F] tracking-tight">
            Transaction In Progress
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {isAuthorized ? (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Authorized
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
              Pending Authorization
            </span>
          )}
        </div>
      </div>

      {/* Over balance warning */}
      {isOverBalance && (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" aria-hidden="true" />
          <span>Payment of ${draft.amount.toFixed(2)} exceeds available demo balance of ${availableBalance.toFixed(2)}.</span>
        </div>
      )}

      {/* Key Transaction Information Review */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2 text-left">
        <div>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-semibold">
            Recipient
          </span>
          <span className="text-base sm:text-lg font-bold text-[#001C3F] mt-0.5 block">
            {draft.recipient || 'Not specified'}
          </span>
        </div>

        <div>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-semibold">
            Amount & Currency
          </span>
          <span className="text-base sm:text-lg font-extrabold text-[#0070BA] mt-0.5 block font-mono">
            ${draft.amount.toFixed(2)} {draft.currency}
          </span>
        </div>

        <div>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-semibold">
            Payment Purpose
          </span>
          <span className="text-sm font-medium text-slate-700 mt-0.5 block truncate">
            {draft.purpose || 'General payment'}
          </span>
        </div>

        <div>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-semibold">
            Payment Method
          </span>
          <span className="text-sm font-medium text-slate-700 mt-0.5 block">
            {draft.paymentMethod}
          </span>
        </div>
      </div>

      {/* Action Review Bar */}
      <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 font-medium">
          {draft.conversationStage === 'PAYPAL_ORDER_APPROVED' ? (
            <>
              Say <span className="text-[#0070BA] font-bold">"Capture payment"</span> to complete checkout, or <span className="text-[#001C3F] font-bold">"Cancel"</span>.
            </>
          ) : draft.conversationStage === 'AWAITING_PAYPAL_APPROVAL' || draft.conversationStage === 'AUTHORIZED_PENDING_FINGERPRINT' ? (
            <>
              Say <span className="text-[#0070BA] font-bold">"Approve with PayPal"</span> or <span className="text-[#0070BA] font-bold">"Proceed to PayPal"</span> to approve and automatically complete payment.
            </>
          ) : draft.conversationStage === 'AWAITING_AUTHORIZATION' ? (
            <>
              Say <span className="text-[#0070BA] font-bold">"I authorize this payment"</span> to authorize.
            </>
          ) : (
            <>
              Say <span className="text-[#0070BA] font-bold">"Confirm this payment"</span> or <span className="text-[#001C3F] font-bold">"Cancel"</span>.
            </>
          )}
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={onClarify}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            aria-label="Repeat and clarify transaction details aloud"
          >
            Review Details
          </button>

          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-colors cursor-pointer"
            aria-label="Cancel this payment draft"
          >
            Cancel Draft
          </button>

          {isAuthorized && (
            <button
              onClick={onOpenFingerprintModal}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0070BA] text-white text-xs font-bold hover:bg-[#003087] transition-colors cursor-pointer shadow-xs"
              aria-label="Open simulated fingerprint verification"
            >
              <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Verify & Pay</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
