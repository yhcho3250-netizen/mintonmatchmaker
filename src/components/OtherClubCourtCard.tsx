import React, { useState, useRef, useEffect } from 'react';
import {
  CourtInfo,
  ConeItem,
  ConeColor,
  extractCourtNumberLabel,
  formatCourtName,
  getNormalizedTurnQueue,
  addConeToTurnQueue,
  removeConeFromTurnQueue,
  formatConeTurnSequence,
} from '../types';
import { ConeIcon } from './ConeIcon';
import { CourtTitleBadge } from './CourtTitleBadge';
import { HeaderConeScroll } from './HeaderConeScroll';
import { DragScrollContainer } from './DragScrollContainer';
import { RotateCw, RotateCcw, ArrowRight, Settings2, Trash2 } from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface OtherClubCourtCardProps {
  court: CourtInfo;
  onAdvanceTurn: (courtNumber: number) => void;
  onUpdateCones: (courtNumber: number, cones: ConeItem[], currentConeIndex: number) => void;
  onRenameCourt: (courtNumber: number, newName: string) => void;
  onRemoveCourt: (courtNumber: number) => void;
  nextQueuedTeamName?: string;
  onRevertPreviousMatch?: (courtNumber: number) => void;
  hasPreviousMatch?: boolean;
  previousMatchSummary?: string;
  onOpenAssignQueueModal?: (courtNumber: number) => void;
}

export const OtherClubCourtCard: React.FC<OtherClubCourtCardProps> = ({
  court,
  onAdvanceTurn,
  onUpdateCones,
  onRenameCourt,
  onRemoveCourt,
  nextQueuedTeamName,
  onRevertPreviousMatch,
  hasPreviousMatch,
  previousMatchSummary,
  onOpenAssignQueueModal,
}) => {
  const [showConeSettings, setShowConeSettings] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const fallbackStartRef = useRef<number>(Date.now());
  const cones = getNormalizedTurnQueue(court.cones || [], court.currentConeIndex || 0);
  const nextIdx = cones.length > 0 ? 1 % cones.length : 0;
  const nextCone = cones[nextIdx];
  const isNextConeOtherClub = nextCone?.color === 'gray';

  useEffect(() => {
    fallbackStartRef.current = Date.now();
  }, [court.currentConeIndex, cones[0]?.id]);

  const computeElapsedSeconds = () => {
    const start = court.turnStartedAt || fallbackStartRef.current;
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
  };

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(computeElapsedSeconds);

  useEffect(() => {
    setElapsedSeconds(computeElapsedSeconds());
    const interval = setInterval(() => {
      setElapsedSeconds(computeElapsedSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, [court.turnStartedAt, court.currentConeIndex, cones[0]?.id]);

  const formattedElapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60
  ).padStart(2, '0')}`;

  useEffect(() => {
    if (!showConeSettings) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node;
      if (!target) return;
      if (
        settingsPanelRef.current &&
        settingsPanelRef.current.contains(target)
      ) {
        return;
      }
      if (
        settingsButtonRef.current &&
        settingsButtonRef.current.contains(target)
      ) {
        return;
      }
      setShowConeSettings(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsideClick, true);
      document.addEventListener('touchstart', handleOutsideClick, true);
      document.addEventListener('click', handleOutsideClick, true);
    }, 40);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, true);
      document.removeEventListener('click', handleOutsideClick, true);
    };
  }, [showConeSettings]);

  const [isTouched, setIsTouched] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isButtonInteractable, setIsButtonInteractable] = useState(false);
  const touchRevealTimeRef = useRef<number>(0);

  // When isTouched becomes true on mobile, delay button interactivity by 350ms to prevent ghost clicks
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isTouched) {
      touchRevealTimeRef.current = Date.now();
      timer = setTimeout(() => {
        setIsButtonInteractable(true);
      }, 350);
    } else {
      setIsButtonInteractable(false);
    }
    return () => clearTimeout(timer);
  }, [isTouched]);

  const canClickAction = () => {
    if (isHovered) return true;
    if (!isButtonInteractable) return false;
    if (Date.now() - touchRevealTimeRef.current < 400) return false;
    return true;
  };

  const handleAddCone = (color: ConeColor) => {
    if (!court || !onUpdateCones) return;
    soundEffects.playRacketHit();
    const { cones: updated, currentConeIndex: nextConeIdx } = addConeToTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      color
    );
    onUpdateCones(court.courtNumber, updated, nextConeIdx);
  };

  const handleRemoveCone = (index: number) => {
    if (!court || !onUpdateCones) return;
    if ((court.cones || []).length <= 1) return;
    soundEffects.playRacketHit();
    const { cones: updated, currentConeIndex: nextConeIdx } = removeConeFromTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      index
    );
    onUpdateCones(court.courtNumber, updated, nextConeIdx);
  };

  const currentIdx = 0;
  const courtDisplayName = formatCourtName(extractCourtNumberLabel(court.name, court.courtNumber));

  return (
    <div
      onClick={() => {
        if (showConeSettings) {
          setShowConeSettings(false);
          return;
        }
        if (!isTouched) {
          setIsTouched(true);
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsTouched(false);
      }}
      className="group relative rounded-2xl border border-slate-700/80 bg-slate-900/80 backdrop-blur-sm overflow-hidden flex flex-col justify-between shadow-lg select-none touch-manipulation cursor-pointer"
    >
      {/* Unified Single-Row Header on Mobile: Court Title + Status + Cone Sequence + Actions */}
      <div className="px-3 sm:px-4 h-[42px] bg-slate-800/80 border-b border-slate-700/70 flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto touch-manipulation no-scrollbar">
        {/* Left: Court Name + Turn status + Cone sequence (Strictly 1 line) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <ConeIcon color="gray" size="sm" isActive={true} />
            <CourtTitleBadge
              courtNumber={court.courtNumber}
              courtName={court.name}
              onRenameCourt={onRenameCourt}
            />
          </div>

          {/* Inline Cone Sequence Order (꼬깔 3개 이후부터 좌우 스크롤, 스크롤바 및 <,> 버튼 숨김) */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400 pl-1.5 border-l border-slate-700/80 shrink-0">
            <HeaderConeScroll cones={cones} currentIdx={currentIdx} />
          </div>
        </div>

        {/* Right: 경기 진행 시간 (설정 버튼 왼쪽에 밀착) + 설정 버튼 */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span
            title="현재 다른클럽 턴 진행 시간 (분:초)"
            className="px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-slate-300 font-mono font-bold text-[10px] sm:text-[11px] tabular-nums tracking-tight inline-flex items-center gap-1 shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse shrink-0" />
            <span>{formattedElapsed}</span>
          </span>
          <button
            ref={settingsButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowConeSettings(!showConeSettings);
            }}
            title="꼬깔 순서 및 추가 설정"
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 border shrink-0 ${
              showConeSettings
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800/90 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700/80'
            }`}
          >
            <Settings2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
            <span>설정</span>
          </button>
        </div>
      </div>

      {/* Backdrop for closing settings when clicking/touching outside within court card */}
      {showConeSettings && (
        <div
          className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[0.5px]"
          onClick={(e) => {
            e.stopPropagation();
            setShowConeSettings(false);
          }}
        />
      )}

      {/* Expanded Cone Management Settings Panel Overlay (코트 기능 위에 덮어씌움) */}
      {showConeSettings && (
        <div
          ref={settingsPanelRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 top-[42px] bottom-0 z-30 overflow-y-auto p-3.5 bg-slate-950/95 backdrop-blur-md space-y-2.5 animate-in fade-in duration-150 rounded-b-2xl border-t border-slate-800"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{courtDisplayName} 꼬깔(턴) 순서 설정</span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundEffects.playRacketHit();
                setShowConeSettings(false);
                onRemoveCourt(court.courtNumber);
              }}
              className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-rose-200 font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer active:scale-95 shrink-0"
              title="코트 삭제"
            >
              <Trash2 className="w-3 h-3 text-rose-400 shrink-0" />
              <span>코트 삭제</span>
            </button>
          </div>

          {/* Cone List & Delete (새로운 꼬깔 추가 시 뒤에서부터 생성, 꼬깔 순환 매커니즘 적용) */}
          <DragScrollContainer
            scrollToEndTrigger={cones.length}
            className="flex flex-nowrap items-center gap-1.5 py-0.5 max-w-full"
          >
            {cones.map((cone, idx) => {
              const isActive = idx === currentIdx;
              return (
                <div
                  key={cone.id || idx}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs shrink-0 ${
                    isActive
                      ? 'bg-slate-800 border-emerald-400/70 text-white shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  <ConeIcon color={cone.color} size="xs" isActive={isActive} />
                  {isActive && (
                    <span className="text-[9px] px-1 bg-emerald-500/20 text-emerald-300 rounded font-bold shrink-0">
                      현재
                    </span>
                  )}
                  {cones.length > 1 && (
                    <button
                      onClick={() => handleRemoveCone(idx)}
                      title="꼬깔 제거"
                      className="ml-0.5 text-slate-500 hover:text-rose-400 cursor-pointer p-0.5 shrink-0"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </DragScrollContainer>

          {/* Add Cone Buttons */}
          <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button
              onClick={() => handleAddCone('red')}
              className="flex-1 py-1.5 px-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ConeIcon color="red" size="xs" />
              <span>+ 빨간 꼬깔 (우리클럽)</span>
            </button>
            <button
              onClick={() => handleAddCone('gray')}
              className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ConeIcon color="gray" size="xs" />
              <span>+ 회색 꼬깔 (다른클럽)</span>
            </button>
          </div>

          {/* Revert to Previous Match Team Button (전 경기 팀으로 되돌리기 - 항상 활성화) */}
          {onRevertPreviousMatch && (
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onRevertPreviousMatch(court.courtNumber);
                  setShowConeSettings(false);
                  setIsTouched(false);
                  setIsHovered(false);
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 shadow-sm active:scale-98"
                title={
                  hasPreviousMatch
                    ? '해당 코트의 직전 경기 팀으로 되돌리고 꼬깔과 대진기록을 복원합니다'
                    : '대진기록에 해당 코트의 전 경기가 없습니다'
                }
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>전 경기 팀으로 되돌리기</span>
                {previousMatchSummary && (
                  <span className="text-[10px] font-normal text-amber-400/90 truncate max-w-[150px]">
                    ({previousMatchSummary})
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Other Club Turn Body with Center Hover/Touch Overlay */}
      <div className="relative min-h-[190px] p-6 flex-1 flex flex-col justify-center items-center text-center space-y-3 overflow-hidden">
        {/* Base: Gray Cone & Status */}
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center shadow-inner">
          <ConeIcon color="gray" size="md" isActive={true} />
        </div>

        <div className="space-y-1">
          <h4 className="text-sm font-bold text-slate-300">
            다른클럽 경기 진행 중
          </h4>
          <p className="text-xs text-slate-500">
            회색 꼬깔 턴입니다
          </p>
        </div>

        {nextQueuedTeamName && (
          <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
            <span>다음 대기:</span>
            <span className="font-semibold text-white">{nextQueuedTeamName}</span>
          </div>
        )}

        {/* Hover / Touch Overlay (코트 중앙의 회색 꼬깔 이미지를 덮으며 턴넘기기 버튼 표시) */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsTouched(false);
          }}
          className={`absolute inset-0 z-20 p-4 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center transition-all duration-200 ${
            isTouched || isHovered
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`flex flex-col items-center gap-2 transition-all ${
              isHovered || isButtonInteractable ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!canClickAction()) return;
                setIsTouched(false);
                setIsHovered(false);
                if (isNextConeOtherClub) {
                  onAdvanceTurn(court.courtNumber);
                  return;
                }
                soundEffects.playWhistle();
                onAdvanceTurn(court.courtNumber);
                if (onOpenAssignQueueModal) {
                  onOpenAssignQueueModal(court.courtNumber);
                }
              }}
              className="py-3 px-6 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-sm rounded-xl shadow-xl shadow-red-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer ring-2 ring-red-400/40"
              title={
                isNextConeOtherClub
                  ? '다음 다른클럽 턴으로 넘깁니다'
                  : '우리클럽 턴으로 넘기고 배정선수관리를 실행합니다'
              }
            >
              <RotateCw className="w-4 h-4 shrink-0" />
              <span>
                {isNextConeOtherClub ? '턴 넘기기 (다음 다른클럽 턴)' : '턴 넘기기 (우리클럽 입장)'}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
            <span className="text-[11px] text-slate-400">
              {isNextConeOtherClub
                ? '클릭 시 다음 다른클럽 꼬깔로 전환됩니다'
                : '클릭 시 우리클럽 턴으로 전환되며 배정선수관리 메뉴가 실행됩니다'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
