import React, { useState, useEffect } from 'react';
import { RotateCcw, AlertTriangle, X, Check, Trash2, Sparkles } from 'lucide-react';
import { soundEffects } from '../utils/audio';

export type ResetType = 'matches_only' | 'full_reset';

interface ResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmReset: (type: ResetType) => void;
  activeMatchCount: number;
  queuedMatchCount: number;
  completedMatchCount: number;
  totalPlayersCount: number;
}

export const ResetModal: React.FC<ResetModalProps> = ({
  isOpen,
  onClose,
  onConfirmReset,
  activeMatchCount,
  queuedMatchCount,
  completedMatchCount,
  totalPlayersCount,
}) => {
  const [selectedType, setSelectedType] = useState<ResetType>('matches_only');

  useEffect(() => {
    if (isOpen) {
      setSelectedType('matches_only');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    soundEffects.playWhistle();
    onConfirmReset(selectedType);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-colors ${
                selectedType === 'matches_only'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">앱 데이터 초기화</h3>
              <p className="text-[11px] text-slate-400">원하시는 초기화 방식을 선택해주세요</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3.5">
          {/* Option 1: Matches Only (Default) */}
          <div
            onClick={() => setSelectedType('matches_only')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
              selectedType === 'matches_only'
                ? 'bg-emerald-500/10 border-emerald-500/60 ring-1 ring-emerald-500/40'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                selectedType === 'matches_only'
                  ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                  : 'border-slate-700 bg-slate-900'
              }`}
            >
              {selectedType === 'matches_only' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">경기 및 대진 기록만 초기화</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                  기본 선택
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                참가자 명단({totalPlayersCount}명)과 코트 설정은 유지하고, 진행/대기 경기({activeMatchCount + queuedMatchCount}개)와 완료 기록({completedMatchCount}개)만 초기화합니다.
              </p>
            </div>
          </div>

          {/* Option 2: Full Reset */}
          <div
            onClick={() => setSelectedType('full_reset')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
              selectedType === 'full_reset'
                ? 'bg-rose-500/10 border-rose-500/60 ring-1 ring-rose-500/40'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                selectedType === 'full_reset'
                  ? 'border-rose-400 bg-rose-400 text-slate-950'
                  : 'border-slate-700 bg-slate-900'
              }`}
            >
              {selectedType === 'full_reset' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">전체 완전 초기화 (백지 상태)</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                모든 참가자 명단, 코트 설정, 대진 기록을 전부 지웁니다. (샘플 데이터 없이 완전 빈 백지 상태로 깨끗하게 초기화)
              </p>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5 text-xs text-amber-300/90">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <span>
              초기화 후에는 이전 경기 기록이나 점수를 되돌릴 수 없습니다. (단, 기기 내부 로컬 저장소에 보관된 <strong>[전체 회원]</strong> 명부는 사라지지 않고 안전하게 유지됩니다.)
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-850 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              selectedType === 'full_reset'
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>초기화 실행</span>
          </button>
        </div>
      </div>
    </div>
  );
};
