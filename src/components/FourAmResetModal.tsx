import React from 'react';
import { Clock, RotateCcw, Check, X, CalendarCheck2 } from 'lucide-react';
import { formatKoreanDateLabel, THREE_MINUTES_MS } from '../utils/workoutHistoryStorage';

interface FourAmResetModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  archiveDateKey: string;
  onConfirmReset: () => void;
  onCancelSnooze: () => void;
}

export const FourAmResetModal: React.FC<FourAmResetModalProps> = ({
  isOpen,
  remainingSeconds,
  archiveDateKey,
  onConfirmReset,
  onCancelSnooze,
}) => {
  if (!isOpen) return null;

  const totalSeconds = Math.floor(THREE_MINUTES_MS / 1000);
  const clampedSeconds = Math.max(0, Math.min(totalSeconds, remainingSeconds));
  const mins = String(Math.floor(clampedSeconds / 60)).padStart(2, '0');
  const secs = String(clampedSeconds % 60).padStart(2, '0');
  const progressPercent = Math.max(0, Math.min(100, (clampedSeconds / totalSeconds) * 100));

  return (
    <div
      data-court-modal="true"
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        className="relative w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Countdown Progress Bar */}
        <div className="w-full h-1.5 bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-rose-500 transition-all duration-1000 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          {/* Icon & Countdown Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <RotateCcw className="w-5 h-5 animate-spin-slow" />
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-1.5 text-rose-300 font-mono text-xs sm:text-sm font-bold">
              <Clock className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
              <span>자동 초기화까지 {mins}:{secs}</span>
            </div>
          </div>

          {/* Main Notice Text */}
          <div className="space-y-2 text-left">
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              전체 초기화 됩니다
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              오전 <strong className="text-amber-300 font-bold">04:00</strong> 시간이 되어 현재의{' '}
              <strong className="text-white">코트현황 · 게임목록 · 참가자명단 · 대진기록</strong>이
              전날 날짜로 운동 기록에 자동 저장되며 전체 완전 초기화가 진행됩니다.
            </p>
          </div>

          {/* Archive Target Info Box */}
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                <CalendarCheck2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>운동 기록 저장 날짜 (전날)</span>
              </span>
              <span className="font-bold text-emerald-300">
                {formatKoreanDateLabel(archiveDateKey)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1 leading-relaxed">
              <p>
                • <strong className="text-emerald-300">[확인]</strong> 클릭 또는{' '}
                <strong className="text-rose-300">3분 경과 시</strong>: 모든 기록을 전날 날짜로
                운동 기록에 저장하고 <strong className="text-white">전체 완전 초기화</strong>를
                실행합니다.
              </p>
              <p>
                • <strong className="text-amber-300">[취소]</strong> 클릭 시: 초기화를 실행하지 않고
                그대로 앱을 이용할 수 있으며, <strong className="text-amber-300">30분 뒤</strong>에
                다시 알림이 표시됩니다.
              </p>
            </div>
          </div>

          {/* Action Buttons: 확인 / 취소 */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancelSnooze}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <X className="w-4 h-4 text-slate-400 shrink-0" />
              <span>취소 (30분 뒤 알림)</span>
            </button>

            <button
              type="button"
              onClick={onConfirmReset}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
            >
              <Check className="w-4 h-4 stroke-[2.5] shrink-0" />
              <span>확인 (전체 초기화)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
