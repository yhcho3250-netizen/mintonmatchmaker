import React, { useState, useEffect } from 'react';
import { X, Sparkles, Clock, Scale, Shuffle, Users, Users2, SlidersHorizontal } from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { MatchOptions } from '../types';

interface CustomNMatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (count: number) => void;
  activePlayersCount?: number;
  courtCount?: number;
  options?: MatchOptions;
  onOpenGenerateModal?: () => void;
}

export const CustomNMatchModal: React.FC<CustomNMatchModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  activePlayersCount = 0,
  courtCount = 0,
  options,
  onOpenGenerateModal,
}) => {
  const effectiveCourts = Math.max(1, courtCount || 4);
  const [count, setCount] = useState<number>(effectiveCourts);

  useEffect(() => {
    if (isOpen) {
      setCount(Math.max(1, courtCount || 4));
    }
  }, [isOpen, courtCount]);

  if (!isOpen) return null;

  const handlePreset = (val: number) => {
    soundEffects.playRacketHit();
    setCount(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(count) || count < 1) return;
    soundEffects.playWhistle();
    onConfirm(count);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">
                대기 경기 연속 생성 (+N)
              </h3>
              <p className="text-[11px] text-slate-400">
                현재 코트 수({courtCount}개) 및 매칭 옵션에 실시간 연동됩니다
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Active Matchmaking Mode Badge */}
          {options && (
            <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-300 min-w-0">
                {options.mode === 'balanced' ? (
                  <>
                    <Scale className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-slate-400">조 편성:</span>
                    <span className="font-bold text-emerald-400 truncate">실력 밸런스</span>
                  </>
                ) : options.mode === 'random' ? (
                  <>
                    <Shuffle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-slate-400">조 편성:</span>
                    <span className="font-bold text-emerald-400 truncate">완전 랜덤</span>
                  </>
                ) : options.mode === 'doubles_only' ? (
                  <>
                    <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-slate-400">조 편성:</span>
                    <span className="font-bold text-emerald-400 truncate">복식 우선 (남·여복 전용)</span>
                  </>
                ) : (
                  <>
                    <Users2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-slate-400">조 편성:</span>
                    <span className="font-bold text-emerald-400 truncate">혼복 우선</span>
                  </>
                )}
              </div>
              {onOpenGenerateModal && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGenerateModal();
                  }}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                >
                  <SlidersHorizontal className="w-3 h-3 text-emerald-400" />
                  <span>옵션 변경</span>
                </button>
              )}
            </div>
          )}

          {/* Court-Proportional Info & Presets */}
          {courtCount > 0 && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-300 font-bold">
                  실시간 코트 연동: {courtCount}코트 ({courtCount * 4}명 단위)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handlePreset(courtCount)}
                  className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    count === courtCount
                      ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-sm'
                      : 'bg-slate-950/80 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                  }`}
                >
                  1회전 (+{courtCount}경기 · {courtCount * 4}명)
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(courtCount * 2)}
                  className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    count === courtCount * 2
                      ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-sm'
                      : 'bg-slate-950/80 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                  }`}
                >
                  2회전 (+{courtCount * 2}경기 · {courtCount * 8}명)
                </button>
              </div>
            </div>
          )}

          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              빠른 경기 수 선택
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 6, 8].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePreset(num)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    count === num
                      ? 'bg-amber-500/25 border-amber-400 text-amber-300 ring-1 ring-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  +{num}경기 ({num * 4}명)
                </button>
              ))}
            </div>
          </div>

          {/* Number Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              직접 경기 수 입력
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={count}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '');
                  setCount(Math.max(1, Math.min(20, parseInt(digits, 10) || 1)));
                }}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-xl text-sm font-bold text-white font-mono outline-none"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                경기 ({count * 4}명 배정)
              </span>
            </div>
            {activePlayersCount > 0 && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                현재 출전 가능 참가자: <strong className="text-emerald-400">{activePlayersCount}명</strong> (휴식/레슨 제외)
              </p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-3 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 shadow-md shadow-amber-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>+{count}경기 생성</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
