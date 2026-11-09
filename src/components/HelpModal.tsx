import React from 'react';
import { X, Mic, Keyboard, Volume2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { AccessibilityTheme } from '../types';

interface HelpModalProps {
  isOpen: boolean;
  theme: AccessibilityTheme;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, theme, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn"
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl p-6 sm:p-8 border border-slate-200 bg-white text-slate-900 shadow-2xl relative"
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 cursor-pointer transition-colors"
          aria-label="Close help guide"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <h2 id="help-title" className="text-xl sm:text-2xl font-bold mb-4 flex items-center gap-2 text-[#001C3F]">
          <Mic className="w-6 h-6 text-[#0070BA]" aria-hidden="true" />
          <span>A-Eye Pal Voice & Accessibility Guide</span>
        </h2>

        {/* Keyboard Shortcuts */}
        <div className="mb-6 p-4 rounded-2xl border border-slate-100 bg-slate-50/70">
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2 text-slate-500">
            <Keyboard className="w-4 h-4 text-[#0070BA]" aria-hidden="true" />
            <span>Keyboard Shortcuts</span>
          </h3>
          <ul className="space-y-2 text-xs sm:text-sm text-slate-700 font-medium">
            <li><kbd className="px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-[#0070BA] mr-2">Spacebar</kbd> Start or stop microphone listening</li>
            <li><kbd className="px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-[#0070BA] mr-2">R</kbd> Repeat last spoken assistant message</li>
            <li><kbd className="px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-[#0070BA] mr-2">S</kbd> Immediately silence assistant speech</li>
            <li><kbd className="px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-[#0070BA] mr-2">B</kbd> Read available demo balance aloud</li>
            <li><kbd className="px-2 py-0.5 rounded font-mono font-bold bg-white border border-slate-200 text-[#0070BA] mr-2">Esc</kbd> Close open dialogs</li>
          </ul>
        </div>

        {/* Spoken Voice Commands Reference */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Voice Commands You Can Say
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="font-bold text-[#0070BA] block mb-1">Payments & Initiations:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>"Pay $50 to John"</li>
                <li>"Pay for my electricity"</li>
                <li>"Send a payment of $100"</li>
              </ul>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="font-bold text-amber-700 block mb-1">Modifications:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>"Change the amount to $75"</li>
                <li>"I meant $150, not $50"</li>
                <li>"Change recipient to Sarah"</li>
              </ul>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="font-bold text-indigo-700 block mb-1">Clarifications & Auth:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>"Repeat transaction details"</li>
                <li>"What am I about to pay?"</li>
                <li>"I authorize this payment"</li>
              </ul>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="font-bold text-emerald-700 block mb-1">Financial Awareness:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>"What's my balance?"</li>
                <li>"How much did I spend this week?"</li>
                <li>"Did my last payment go through?"</li>
              </ul>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 sm:col-span-2">
              <span className="font-bold text-[#0070BA] block mb-1">Budgeting Commands:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>"I have $500. Allocate $150 for food, $100 for transport, $100 for electricity and $100 for savings"</li>
                <li>"Reduce food to $80" • "Remove transport"</li>
                <li>"Read my allocations" • "Save my budget"</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 text-center">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-bold text-sm bg-[#0070BA] text-white hover:bg-[#003087] transition-colors cursor-pointer shadow-xs"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
