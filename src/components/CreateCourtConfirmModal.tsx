import React from 'react';
import { LayoutGrid, Check, X } from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface CreateCourtConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedPlayerCount: number;
}

export const CreateCourtConfirmModal: React.FC<CreateCourtConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedPlayerCount,
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    soundEffects.playWhistle();
    onConfirm();
  };

  const handleCancel = () => {
    soundEffects.playRacketHit();
    onClose();
  };

  return (
    <div
      data-court-modal="true"
      onClick={handleCancel}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scaleUp"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <LayoutGrid className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">코트 생성 확인</h3>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 text-center space-y-3">
          <div className="text-sm sm:text-base font-bold text-slate-100 leading-snug">
            현재 코트가 없습니다.<br />
            코트를 생성하시겠습니까?
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            확인을 누르면 새 코트가 생성되고 선택된 팀({selectedPlayerCount}명)이 즉시 배정됩니다.
          </p>
        </div>

        {/* Action Buttons: 취소 / 확인 */}
        <div className="p-4 bg-slate-950/70 border-t border-slate-800 flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs sm:text-sm transition-colors cursor-pointer active:scale-98"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-emerald-600/30 active:scale-98"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>확인</span>
          </button>
        </div>
      </div>
    </div>
  );
};
