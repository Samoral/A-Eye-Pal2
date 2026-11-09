import React from 'react';
import {
  CreditCard,
  Volume2,
  VolumeX,
  HelpCircle,
  RotateCcw
} from 'lucide-react';
import { AccessibilityTheme, TextScale, PayPalStatus } from '../types';
import { soundService } from '../services/soundService';

interface HeaderProps {
  theme: AccessibilityTheme;
  setTheme: (t: AccessibilityTheme) => void;
  textScale: TextScale;
  setTextScale: (s: TextScale) => void;
  speechRate: number;
  setSpeechRate: (r: number) => void;
  isMuted: boolean;
  setIsMuted: (m: boolean) => void;
  paypalStatus: PayPalStatus | null;
  isAiConnected?: boolean;
  onResetDemo: () => void;
  onOpenHelp: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isMuted,
  setIsMuted,
  paypalStatus,
  isAiConnected = true,
  onResetDemo,
  onOpenHelp,
}) => {
  return (
    <header
      role="banner"
      className="w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-4 py-2.5 sm:px-6 sticky top-0 z-40 shadow-xs"
    >
      <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-3">
        {/* Brand identity & Tagline */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg bg-[#003087] flex items-center justify-center font-black text-white text-xs tracking-tight shadow-xs shrink-0"
            aria-hidden="true"
          >
            A•I
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[#001C3F] tracking-tight">
                A-Eye Pal
              </h1>
              <span className="hidden sm:inline-block text-[10px] font-semibold text-slate-500 border border-slate-200 px-1.5 py-0.2 rounded-full">
                Voice Assistant
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-normal leading-none hidden sm:block">
              Your money. Your voice. Your control.
            </p>
          </div>
        </div>

        {/* Minimalist Status Badges & Controls */}
        <div className="flex items-center gap-2 flex-wrap" role="toolbar" aria-label="System status">
          {/* AI Connection Status */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 bg-slate-50 text-slate-700"
            title={isAiConnected ? 'Gemini AI active' : 'Rule-based engine active'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isAiConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}
              aria-hidden="true"
            />
            <span className="text-[11px] font-medium">{isAiConnected ? 'AI Online' : 'AI Offline'}</span>
          </div>

          {/* PayPal Sandbox Status */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-blue-200 bg-blue-50/70 text-[#003087]"
            title={paypalStatus?.note || 'PayPal Sandbox Mode'}
          >
            <CreditCard className="w-3.5 h-3.5 text-[#0070BA]" aria-hidden="true" />
            <span className="text-[11px]">
              {paypalStatus?.isLiveSandbox ? 'PayPal Live Sandbox' : 'PayPal Sandbox'}
            </span>
          </div>

          {/* Sound Effects Mute Toggle */}
          <button
            onClick={() => {
              const nextMute = !isMuted;
              setIsMuted(nextMute);
              soundService.setMuted(nextMute);
            }}
            className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
              isMuted
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
            title={isMuted ? 'Earcons muted (Spoken announcements stay active)' : 'Earcons active'}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
          >
            {isMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            )}
          </button>

          {/* Reset Demo Ledger */}
          <button
            onClick={onResetDemo}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Reset demo account to initial $650.00"
            aria-label="Reset demo balance"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          {/* Voice Shortcuts / Help Modal */}
          <button
            onClick={onOpenHelp}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-xs font-medium cursor-pointer"
            aria-label="Voice shortcuts and help"
          >
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span className="hidden md:inline text-[11px]">Commands</span>
          </button>
        </div>
      </div>
    </header>
  );
};
