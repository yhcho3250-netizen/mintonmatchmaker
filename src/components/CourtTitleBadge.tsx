import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Edit2, X, Check, Hash } from 'lucide-react';
import { extractCourtNumberLabel, formatCourtName } from '../types';
import { soundEffects } from '../utils/audio';

interface CourtTitleBadgeProps {
  courtNumber: number;
  courtName?: string;
  onRenameCourt?: (courtNumber: number, newName: string) => void;
}

export const CourtTitleBadge: React.FC<CourtTitleBadgeProps> = ({
  courtNumber,
  courtName,
  onRenameCourt,
}) => {
  const currentN = extractCourtNumberLabel(courtName, courtNumber);
  const formattedTitle = formatCourtName(currentN);

  const [isHovered, setIsHovered] = useState(false);
  const [isTouchRevealed, setIsTouchRevealed] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [courtNumInput, setCourtNumInput] = useState(currentN);

  const badgeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerTypeRef = useRef<string>('mouse');
  const touchRevealTimeRef = useRef<number>(0);

  // Sync input when modal opens
  useEffect(() => {
    if (isModalOpen) {
      setCourtNumInput(currentN);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isModalOpen, currentN]);

  // Dismiss mobile touch overlay when tapping outside the court title
  useEffect(() => {
    if (!isTouchRevealed) return;

    const handleOutsidePointerDown = (e: PointerEvent | MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (badgeRef.current && badgeRef.current.contains(target)) {
        return;
      }
      setIsTouchRevealed(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsidePointerDown, true);
      document.addEventListener('touchstart', handleOutsidePointerDown, true);
    }, 30);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      document.removeEventListener('touchstart', handleOutsidePointerDown, true);
    };
  }, [isTouchRevealed]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    pointerTypeRef.current = e.pointerType || 'mouse';
  };

  const handleTitleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!onRenameCourt) return;

    if (pointerTypeRef.current === 'touch') {
      // 모바일 터치: 첫 터치 시 코트이름 위에 변경 이미지 표시, 다시 터치 시 변경 메뉴 실행
      if (!isTouchRevealed) {
        soundEffects.playScorePoint();
        touchRevealTimeRef.current = Date.now();
        setIsTouchRevealed(true);
        return;
      }
      // Prevent accidental double-fire within 120ms of first touch
      if (Date.now() - touchRevealTimeRef.current < 120) {
        return;
      }
      soundEffects.playRacketHit();
      setIsTouchRevealed(false);
      setIsModalOpen(true);
    } else {
      // 데스크톱 마우스: 마우스 오버로 변경 이미지가 표시된 상태에서 클릭 시 바로 변경 메뉴 실행
      soundEffects.playRacketHit();
      setIsHovered(false);
      setIsModalOpen(true);
    }
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = courtNumInput.trim();
    if (!trimmed) return;
    soundEffects.playRacketHit();
    if (onRenameCourt) {
      onRenameCourt(courtNumber, formatCourtName(trimmed));
    }
    setIsModalOpen(false);
  };

  const showEditOverlay = Boolean(onRenameCourt && (isHovered || isTouchRevealed));
  const previewN = courtNumInput.trim() || currentN;

  return (
    <>
      <div
        ref={badgeRef}
        onPointerDown={handlePointerDown}
        onMouseEnter={() => {
          if (pointerTypeRef.current !== 'touch') {
            setIsHovered(true);
          }
        }}
        onMouseLeave={() => {
          setIsHovered(false);
        }}
        onClick={handleTitleClick}
        title={
          onRenameCourt
            ? `${formattedTitle} (클릭/터치하여 코트 번호 변경)`
            : formattedTitle
        }
        className="relative inline-flex items-center justify-center px-1.5 py-0.5 rounded-md cursor-pointer select-none shrink-0"
      >
        {/* 기본 코트 제목: n코트 */}
        <span className="font-bold text-white text-xs sm:text-sm tracking-tight whitespace-nowrap">
          {formattedTitle}
        </span>

        {/* 코트 이름을 덮으며 위에 나타나는 변경 이미지 오버레이 (마우스 오버 또는 모바일 1차 터치 시 표시) */}
        <div
          className={`absolute inset-0 z-20 rounded-md bg-slate-950/95 border border-emerald-400/90 shadow-[0_0_10px_rgba(16,185,129,0.4)] flex items-center justify-center gap-1 transition-opacity duration-150 ${
            showEditOverlay
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <Edit2 className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[10px] font-bold text-emerald-300 whitespace-nowrap leading-none">
            변경
          </span>
        </div>
      </div>

      {/* 코트번호를 입력해 주세요 모달 (꼬깔 번호를 입력해 주세요 메뉴와 동일한 디자인) */}
      {isModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
            onClick={(e) => {
              e.stopPropagation();
              setIsModalOpen(false);
            }}
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
                onClick={() => setIsModalOpen(false)}
                className="absolute right-3.5 top-3.5 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon & Title */}
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3.5 shadow-sm shadow-amber-500/20">
                <Hash className="w-6 h-6" />
              </div>

              <h3 className="text-base sm:text-lg font-bold text-white mb-2">
                코트번호를 입력해 주세요
              </h3>

              {/* Court Name Preview ('코트'는 고정, 번호 n만 변경됨) */}
              <div className="inline-flex items-center gap-0.5 px-3.5 py-1 rounded-xl bg-slate-950/80 border border-slate-800 mb-5 text-sm font-bold">
                <span className="text-amber-300 font-mono text-base px-0.5">{previewN}</span>
                <span className="text-slate-400">코트</span>
              </div>

              {/* Input Form: '코트'는 고정된 라벨로 두고 n만 입력 */}
              <form onSubmit={handleConfirmSubmit} className="space-y-4">
                <div className="flex items-center justify-center gap-2.5">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="코트 번호 (예: 1, 2...)"
                    value={courtNumInput}
                    onChange={(e) => setCourtNumInput(e.target.value)}
                    className="w-full text-center text-xl font-bold font-mono tracking-wider py-3 px-4 bg-slate-950 border-2 border-amber-400/70 rounded-xl text-amber-300 placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/40 transition-all shadow-inner"
                  />
                  <span className="text-lg font-bold text-slate-300 select-none shrink-0 px-3 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                    코트
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-tight">
                  &apos;코트&apos;는 고정된 이름이며, 입력한 번호(n)만 변경되어 모든 메뉴에 동일하게 반영됩니다.
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      soundEffects.playRacketHit();
                      setIsModalOpen(false);
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 font-bold text-xs transition-all cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={!courtNumInput.trim()}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 active:scale-[0.98] text-slate-950 font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>확인 (Enter)</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
