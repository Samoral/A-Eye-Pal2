import React, { useState } from 'react';
import {
  Wallet,
  TrendingDown,
  Calendar,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  ChevronUp,
  Volume2
} from 'lucide-react';
import { AccountSummary, AccessibilityTheme } from '../types';

interface FinancialAwarenessProps {
  account: AccountSummary;
  theme: AccessibilityTheme;
  onVoiceQuery: (query: string) => void;
}

export const FinancialAwareness: React.FC<FinancialAwarenessProps> = ({
  account,
  onVoiceQuery,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section
      aria-labelledby="financial-info-heading"
      className="w-full rounded-2xl border border-slate-200/90 bg-white overflow-hidden transition-all shadow-xs"
    >
      {/* Clickable Header Accordion Bar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="financial-info-content"
        className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0070BA]">
            <Wallet className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="financial-info-heading" className="text-sm font-bold text-[#001C3F]">
                Account & Ledger Information
              </h2>
              <span className="text-xs font-mono text-[#0070BA] font-bold">
                ${account.balance.toFixed(2)} {account.currency}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isOpen ? 'Tap to hide financial details' : 'Tap or ask "What is my balance?" to view ledger'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-500">
          <span className="text-xs font-semibold hidden sm:inline">
            {isOpen ? 'Hide' : 'Show Details'}
          </span>
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expandable Financial Details */}
      {isOpen && (
        <div id="financial-info-content" className="p-5 border-t border-slate-100 space-y-5 animate-fadeIn">
          {/* Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Balance */}
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="font-medium">Available Demo Balance</span>
                <span className="text-[10px] uppercase font-bold text-slate-400 border border-slate-200 px-1 rounded">Demo</span>
              </div>
              <div className="text-2xl font-black text-[#001C3F] font-mono">
                ${account.balance.toFixed(2)}{' '}
                <span className="text-xs font-semibold text-slate-500">{account.currency}</span>
              </div>
              <button
                onClick={() => onVoiceQuery("What is my balance?")}
                className="mt-2 text-xs text-[#0070BA] hover:text-[#003087] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Volume2 className="w-3 h-3" />
                <span>Hear balance</span>
              </button>
            </div>

            {/* Spent This Week */}
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="font-medium">Spent This Week</span>
                <Calendar className="w-3.5 h-3.5 text-[#0070BA]" />
              </div>
              <div className="text-2xl font-bold text-slate-800 font-mono">
                ${account.spentThisWeek.toFixed(2)}
              </div>
              <button
                onClick={() => onVoiceQuery("How much did I spend this week?")}
                className="mt-2 text-xs text-[#0070BA] hover:text-[#003087] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Volume2 className="w-3 h-3" />
                <span>Hear weekly sum</span>
              </button>
            </div>

            {/* Spent This Month */}
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="font-medium">Spent (Last 30 Days)</span>
                <Clock className="w-3.5 h-3.5 text-[#0070BA]" />
              </div>
              <div className="text-2xl font-bold text-slate-800 font-mono">
                ${account.spentThisMonth.toFixed(2)}
              </div>
              <button
                onClick={() => onVoiceQuery("How much did I spend this month?")}
                className="mt-2 text-xs text-[#0070BA] hover:text-[#003087] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Volume2 className="w-3 h-3" />
                <span>Hear monthly sum</span>
              </button>
            </div>
          </div>

          {/* Recent Completed Transactions */}
          <div>
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              Recent Completed Ledger Activity
            </h3>
            <div className="space-y-1.5">
              {account.recentTransactions.slice(0, 4).map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center ${
                        tx.type === 'debit'
                          ? 'bg-rose-50 text-rose-600'
                          : 'bg-emerald-50 text-emerald-600'
                      }`}
                    >
                      {tx.type === 'debit' ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-[#001C3F]">{tx.recipient}</p>
                      <p className="text-[11px] text-slate-500">{tx.purpose || 'Transaction'}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`font-bold font-mono ${
                        tx.type === 'debit' ? 'text-slate-800' : 'text-emerald-600'
                      }`}
                    >
                      {tx.type === 'debit' ? '-' : '+'}${tx.amount.toFixed(2)}
                    </span>
                    <span className="block text-[10px] text-slate-400 capitalize">
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
