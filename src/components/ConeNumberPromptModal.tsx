import React, { useState, useEffect, useRef } from 'react';
import { Gender, Tier, TIER_LABELS } from '../types';
import { Sparkles, X, Check, Hash } from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface ConeNumberPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetName: string;
  targetGender: Gender;
  targetTier: Tier;
  initialConeNumber?: number | string;
  onConfirm: (coneNumber: string) => void;
  onSkip?: () => void;
}

export const ConeNumberPromptModal: React.FC<ConeNumberPromptModalProps> = ({
  isOpen,
  onClose,
  targetName,
  targetGender,
  targetTier,
  initialConeNumber = '',
  onConfirm,
  onSkip,
}) => {
  const [coneNumberInput, setConeNumberInput] = useState<string>(
    initialConeNumber ? String(initialConeNumber) : ''
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setConeNumberInput(initialConeNumber ? String(initialConeNumber) : '');
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialConeNumber]);

  if (!isOpen) return null;

  const tierMeta = TIER_LABELS[targetTier] || TIER_LABELS.Beginner;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inputRef.current?.blur();
    soundEffects.playRacketHit();
    onConfirm(coneNumberInput.trim());
  };

  const handleSkip = () => {
    inputRef.current?.blur();
    soundEffects.playRacketHit();
    if (onSkip) {
      onSkip();
    } else {
      onConfirm('');
    }
  };

  const handleClose = () => {
    inputRef.current?.blur();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-sm bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Top Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3.5 top-3.5 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon & Title */}
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3.5 shadow-sm shadow-amber-500/20">
          <Hash className="w-6 h-6" />
        </div>

        <h3 className="text-base sm:text-lg font-bold text-white mb-1.5">
          꼬깔 번호를 입력해 주세요
        </h3>

        {/* Player Profile Preview */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950/80 border border-slate-800 mb-3">
          <span
            className={`text-sm font-bold ${
              targetGender === 'M' ? 'text-blue-400' : 'text-pink-400'
            }`}
          >
            {targetName}
          </span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
              targetGender === 'M'
                ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                : 'bg-pink-500/15 border-pink-500/30 text-pink-300'
            }`}
          >
            {targetGender === 'M' ? '남성' : '여성'}
          </span>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border ${tierMeta.bg} ${tierMeta.color}`}
          >
            {tierMeta.short}
          </span>
        </div>

        {/* Input Form */}
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              placeholder="꼬깔 번호 (예: 1, 2, 3...)"
              value={coneNumberInput}
              onChange={(e) => setConeNumberInput(e.target.value)}
              className="w-full text-center text-xl font-bold font-mono tracking-wider py-3 px-4 bg-slate-950 border-2 border-amber-400/70 rounded-xl text-amber-300 placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/40 transition-all shadow-inner"
            />
          </div>

          <p className="text-[11px] text-slate-400 leading-tight">
            입력한 번호는 명단의 선수 이름 바로 옆에 같은 글자 크기와 성별 색상으로 표시됩니다.
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSkip}
              className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 font-bold text-xs transition-all cursor-pointer"
            >
              건너뛰기
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] text-slate-950 font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>확인 (Enter)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
