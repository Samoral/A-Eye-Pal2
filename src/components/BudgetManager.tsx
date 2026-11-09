import React, { useState } from 'react';
import {
  PieChart,
  ChevronDown,
  ChevronUp,
  Volume2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Plus
} from 'lucide-react';
import { BudgetPlan, AccessibilityTheme } from '../types';

interface BudgetManagerProps {
  budget: BudgetPlan;
  availableBalance: number;
  theme: AccessibilityTheme;
  onVoiceCommand: (cmd: string) => void;
  onModifyCategory: (category: string, newAmount?: number, remove?: boolean) => void;
  onSaveBudget: () => void;
  onReadBudget: () => void;
}

export const BudgetManager: React.FC<BudgetManagerProps> = ({
  budget,
  availableBalance,
  onVoiceCommand,
  onModifyCategory,
  onSaveBudget,
  onReadBudget,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatAmount, setNewCatAmount] = useState('');

  const isOverBudget = budget.shortfall > 0;
  const isSaved = budget.status === 'saved';

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || !newCatAmount) return;
    onModifyCategory(newCatName.trim(), parseFloat(newCatAmount));
    setNewCatName('');
    setNewCatAmount('');
  };

  return (
    <section
      aria-labelledby="budget-info-heading"
      className="w-full rounded-2xl border border-slate-200/90 bg-white overflow-hidden transition-all shadow-xs"
    >
      {/* Clickable Header Accordion Bar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="budget-info-content"
        className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0070BA]">
            <PieChart className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="budget-info-heading" className="text-sm font-bold text-[#001C3F]">
                Budget Allocations
              </h2>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  isSaved
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {isSaved ? 'Saved Budget' : 'Draft'}
              </span>
              <span className="text-xs font-mono text-slate-500 font-semibold">
                ${budget.totalAllocated.toFixed(2)} allocated
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isOpen ? 'Tap to hide allocations' : 'Tap or say "Read my budget" to view planning'}
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

      {/* Expandable Budget Content */}
      {isOpen && (
        <div id="budget-info-content" className="p-5 border-t border-slate-100 space-y-4 animate-fadeIn">
          {/* Over-Budget Alert */}
          {isOverBudget && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-bold block">Budget Exceeds Balance by ${budget.shortfall.toFixed(2)}</span>
                <span>Please reduce or remove a category by saying e.g. "Reduce food to $100".</span>
              </div>
            </div>
          )}

          {/* Allocation Figures Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="text-slate-500 font-medium block mb-0.5">Total Allocated</span>
              <span className="text-lg font-bold text-[#001C3F] font-mono">
                ${budget.totalAllocated.toFixed(2)}
              </span>
            </div>
            <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
              <span className="text-slate-500 font-medium block mb-0.5">Remaining Unallocated</span>
              <span className="text-lg font-bold text-[#0070BA] font-mono">
                ${budget.unallocated.toFixed(2)}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 p-3 rounded-xl border border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <div>
                <span className="text-slate-500 font-medium block mb-0.5">Status</span>
                <span className="font-bold text-[#001C3F] capitalize">{budget.status}</span>
              </div>
              <button
                onClick={onReadBudget}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-[#0070BA] hover:text-[#003087] hover:bg-slate-50 cursor-pointer transition-colors"
                title="Hear budget read aloud"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Categories List */}
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Allocated Categories
            </h3>
            {budget.allocations.map((cat) => (
              <div
                key={cat.id}
                className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-slate-800">{cat.category}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-[#001C3F]">${cat.amount.toFixed(2)}</span>
                  <button
                    onClick={() => onModifyCategory(cat.category, undefined, true)}
                    className="text-[11px] text-slate-400 hover:text-rose-600 font-medium cursor-pointer"
                    aria-label={`Remove category ${cat.category}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Save / Voice Help Button Bar */}
          <div className="pt-2 flex items-center justify-between text-xs">
            <p className="text-slate-500 text-[11px]">
              Say <span className="text-[#001C3F] font-bold">"Save my budget"</span> to persist changes.
            </p>
            {budget.status !== 'saved' && budget.shortfall === 0 && (
              <button
                onClick={onSaveBudget}
                className="px-3.5 py-1.5 rounded-lg bg-[#0070BA] text-white font-bold hover:bg-[#003087] transition-colors cursor-pointer text-xs shadow-xs"
              >
                Save Budget
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
