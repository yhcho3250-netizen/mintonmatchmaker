import React, { useRef, useState, useEffect } from 'react';
import {
  CourtMatch,
  Player,
  MatchOptions,
  CourtInfo,
  ConeItem,
  SwapSelection,
  isPlayerLastMatchCompleted,
  getNormalizedTurnQueue,
} from '../types';
import { CourtCard } from './CourtCard';
import { EmptyCourtCard } from './EmptyCourtCard';
import { OtherClubCourtCard } from './OtherClubCourtCard';
import { RestingBench } from './RestingBench';
import { CustomNMatchModal } from './CustomNMatchModal';
import { ArrowLeftRight, X, Plus, Clock, Scale, Shuffle, Users2, Users, SlidersHorizontal, LayoutGrid } from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { isSpecialMatchTurnReady } from '../utils/matchmaker';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
  subscribeDeviceStorageHydration,
} from '../utils/deviceStorage';

interface CourtBoardViewProps {
  currentRound: number;
  courts: CourtInfo[];
  activeMatches: CourtMatch[];
  queuedMatches: CourtMatch[];
  completedMatches?: CourtMatch[];
  restingPlayers: Player[];
  playersMap: Map<string, Player>;
  allPlayers?: Player[];
  options: MatchOptions;
  meetupName: string;
  onUpdateMeetupName: (name: string) => void;
  onOpenGenerateModal: () => void;
  onCompleteMatch: (matchId: string) => void;
  onResetMatch: (matchId: string) => void;
  onCompleteAllMatches: () => void;
  selectedSwap: SwapSelection | null;
  onSelectPlayerForSwap: (
    playerId: string,
    matchId?: string,
    team?: 'teamA' | 'teamB',
    slot?: 1 | 2
  ) => void;
  onCancelSwap: () => void;
  onTogglePlayerActive: (playerId: string) => void;
  // Bench multi-selection & court assignment
  selectedBenchPlayerIds: string[];
  onToggleSelectBenchPlayer: (playerId: string) => void;
  onClearBenchSelection: () => void;
  onAssignSelectedToCourt: (targetCourtNumber?: number) => void;
  onAssignSelectedToQueue?: () => void;
  onPreGenerateOneMatch?: () => void;
  onPreGenerateFourMatches?: () => void;
  onPreGenerateNMatches?: (count: number) => void;
  // Court & Cone Management
  onAddCourt: () => void;
  onRemoveCourt: (courtNumber: number) => void;
  onRenameCourt: (courtNumber: number, newName: string) => void;
  onReorderCourts?: (newCourts: CourtInfo[]) => void;
  onAdvanceCourtTurn: (courtNumber: number) => void;
  onUpdateCourtCones: (courtNumber: number, cones: ConeItem[], currentConeIndex: number) => void;
  onGenerateForCourt: (courtNumber: number, pregeneratedMatch?: CourtMatch) => void;
  onAssignQueueToCourt: (matchId: string, courtNumber: number) => void;
  onClearCourtMatch: (courtNumber: number) => void;
  onRevertPreviousMatch?: (courtNumber: number) => void;
  onOpenAssignQueueModal?: (courtNumber: number) => void;
  allCompletedMatches?: CourtMatch[];
  onSetPlayerSpecialStatus?: (playerId: string, status: 'resting' | 'lesson' | 'last_match' | 'exited' | null) => void;
  conflictPlayerIds?: string[];
}

export const CourtBoardView: React.FC<CourtBoardViewProps> = ({
  currentRound = 1,
  courts,
  activeMatches,
  queuedMatches,
  completedMatches = [],
  restingPlayers,
  playersMap,
  allPlayers = [],
  options,
  onOpenGenerateModal,
  onCompleteMatch,
  onResetMatch,
  selectedSwap,
  onSelectPlayerForSwap,
  onCancelSwap,
  onTogglePlayerActive,
  selectedBenchPlayerIds,
  onToggleSelectBenchPlayer,
  onClearBenchSelection,
  onAssignSelectedToCourt,
  onAssignSelectedToQueue,
  onPreGenerateOneMatch,
  onPreGenerateFourMatches,
  onPreGenerateNMatches,
  onAddCourt,
  onRemoveCourt,
  onRenameCourt,
  onReorderCourts,
  onAdvanceCourtTurn,
  onUpdateCourtCones,
  onGenerateForCourt,
  onAssignQueueToCourt,
  onClearCourtMatch,
  onRevertPreviousMatch,
  onOpenAssignQueueModal,
  allCompletedMatches = [],
  onSetPlayerSpecialStatus,
  conflictPlayerIds = [],
}) => {
  const [showCustomNModal, setShowCustomNModal] = useState(false);
  const [noPrevMatchAlertCourts, setNoPrevMatchAlertCourts] = useState<Record<number, boolean>>({});
  const noPrevAlertTimersRef = useRef<Record<number, number>>({});

  const triggerNoPrevMatchAlert = (courtNumber: number) => {
    soundEffects.playScorePoint();
    if (noPrevAlertTimersRef.current[courtNumber]) {
      window.clearTimeout(noPrevAlertTimersRef.current[courtNumber]);
    }
    setNoPrevMatchAlertCourts((prev) => ({ ...prev, [courtNumber]: true }));
    noPrevAlertTimersRef.current[courtNumber] = window.setTimeout(() => {
      setNoPrevMatchAlertCourts((prev) => ({ ...prev, [courtNumber]: false }));
      delete noPrevAlertTimersRef.current[courtNumber];
    }, 2000);
  };

  const selectedCourtPlayer = selectedSwap?.source === 'court'
    ? playersMap.get(selectedSwap.playerId)
    : null;

  const rosterForSpecial = allPlayers.length > 0 ? allPlayers : restingPlayers;
  const nextQueuedMatch = queuedMatches.find(
    (m) =>
      !m.isSpecialMatch ||
      isSpecialMatchTurnReady(m, rosterForSpecial, activeMatches, queuedMatches, options)
  );
  const nextQueuedTeamName = nextQueuedMatch
    ? [
        playersMap.get(nextQueuedMatch.teamA.player1Id)?.name,
        playersMap.get(nextQueuedMatch.teamA.player2Id)?.name,
        playersMap.get(nextQueuedMatch.teamB.player1Id)?.name,
        playersMap.get(nextQueuedMatch.teamB.player2Id)?.name,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [isScrollMode, setIsScrollMode] = useState<boolean>(() => {
    try {
      const saved = getDeviceStorageItem(DEVICE_STORAGE_KEYS.COURT_SCROLL_MODE);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    return subscribeDeviceStorageHydration((restored) => {
      if (DEVICE_STORAGE_KEYS.COURT_SCROLL_MODE in restored) {
        setIsScrollMode(restored[DEVICE_STORAGE_KEYS.COURT_SCROLL_MODE] === 'true');
      }
    });
  }, []);

  const handleToggleScrollMode = () => {
    setIsScrollMode((prev) => {
      const next = !prev;
      setDeviceStorageItem(DEVICE_STORAGE_KEYS.COURT_SCROLL_MODE, String(next));
      return next;
    });
  };

  const dragStateRef = useRef({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    hasMoved: false,
  });

  // ============================================================================
  // Long-Press (Touch & Mouse) Court Card Reordering
  // ============================================================================
  const [draggedCourtNum, setDraggedCourtNum] = useState<number | null>(null);

  const courtCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const courtsRef = useRef(courts);
  courtsRef.current = courts;
  const onReorderCourtsRef = useRef(onReorderCourts);
  onReorderCourtsRef.current = onReorderCourts;
  const isScrollModeRef = useRef(isScrollMode);
  isScrollModeRef.current = isScrollMode;

  const courtLongPressPendingNumRef = useRef<number | null>(null);
  const courtLongPressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const courtLongPressTimerRef = useRef<number | null>(null);
  const courtDragActiveNumRef = useRef<number | null>(null);
  const courtLastLiveSwapTimeRef = useRef<number>(0);
  const didCourtReorderRef = useRef<boolean>(false);
  const suppressCourtClickAfterDragRef = useRef<boolean>(false);

  const clearCourtLongPressTimer = () => {
    if (courtLongPressTimerRef.current !== null) {
      window.clearTimeout(courtLongPressTimerRef.current);
      courtLongPressTimerRef.current = null;
    }
  };

  const findCourtCardNumAtPoint = (clientX: number, clientY: number): number | null => {
    if (typeof document !== 'undefined' && document.elementFromPoint) {
      const el = document.elementFromPoint(clientX, clientY);
      const cardEl = el?.closest?.('[data-court-card-num]') as HTMLElement | null;
      const attrNum = cardEl?.getAttribute('data-court-card-num');
      if (attrNum) {
        const parsed = Number(attrNum);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }

    let closestNum: number | null = null;
    let closestDist = Infinity;
    for (const c of courtsRef.current) {
      const el = courtCardRefs.current[c.courtNumber];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return c.courtNumber;
      }
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;
      const dist = Math.hypot(clientX - centerX, clientY - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closestNum = c.courtNumber;
      }
    }
    return closestNum;
  };

  const activateCourtLongPressDrag = (courtNumber: number) => {
    if (courtsRef.current.length < 2) return;
    // Cancel horizontal scroll container drag so moving pointer reorders courts instead
    dragStateRef.current.isDown = false;
    dragStateRef.current.hasMoved = false;
    setIsMouseDown(false);
    setIsDragging(false);

    courtDragActiveNumRef.current = courtNumber;
    didCourtReorderRef.current = false;
    suppressCourtClickAfterDragRef.current = true;
    setDraggedCourtNum(courtNumber);
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(35);
      }
    } catch {
      // ignore vibration errors
    }
    soundEffects.playRacketHit();
  };

  const handleCourtTouchStart = (e: React.TouchEvent<HTMLDivElement>, courtNumber: number) => {
    if (courts.length < 2) return;
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return;
    }

    const touch = e.touches[0];
    courtLongPressPendingNumRef.current = courtNumber;
    courtLongPressStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    clearCourtLongPressTimer();

    courtLongPressTimerRef.current = window.setTimeout(() => {
      courtLongPressTimerRef.current = null;
      if (courtLongPressPendingNumRef.current === courtNumber) {
        activateCourtLongPressDrag(courtNumber);
      }
    }, 220);
  };

  const handleCourtMouseDownLongPress = (e: React.MouseEvent<HTMLDivElement>, courtNumber: number) => {
    if (e.button !== 0 || courts.length < 2) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return;
    }

    courtLongPressPendingNumRef.current = courtNumber;
    courtLongPressStartPosRef.current = { x: e.clientX, y: e.clientY };
    clearCourtLongPressTimer();

    courtLongPressTimerRef.current = window.setTimeout(() => {
      courtLongPressTimerRef.current = null;
      if (courtLongPressPendingNumRef.current === courtNumber) {
        activateCourtLongPressDrag(courtNumber);
      }
    }, 220);
  };

  useEffect(() => {
    const handlePointerMoveReorder = (clientX: number, clientY: number, preventDefaultFn?: () => void) => {
      // 1. Before long-press timer fires: if finger/mouse moves > 14px, cancel long-press so normal scrolling works
      if (courtDragActiveNumRef.current === null) {
        if (courtLongPressPendingNumRef.current !== null && courtLongPressStartPosRef.current) {
          const dx = Math.abs(clientX - courtLongPressStartPosRef.current.x);
          const dy = Math.abs(clientY - courtLongPressStartPosRef.current.y);
          if (dx > 14 || dy > 14) {
            clearCourtLongPressTimer();
            courtLongPressPendingNumRef.current = null;
            courtLongPressStartPosRef.current = null;
          }
        }
        return;
      }

      // 2. Active court drag mode: prevent default scroll, auto-scroll edges, and live-swap courts
      preventDefaultFn?.();

      const edgeThreshold = 85;
      if (clientY < edgeThreshold) {
        window.scrollBy({ top: -10, behavior: 'auto' });
      } else if (clientY > window.innerHeight - edgeThreshold) {
        window.scrollBy({ top: 10, behavior: 'auto' });
      }

      if (isScrollModeRef.current && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const rect = container.getBoundingClientRect();
        if (clientX < rect.left + edgeThreshold) {
          container.scrollLeft -= 14;
        } else if (clientX > rect.right - edgeThreshold) {
          container.scrollLeft += 14;
        }
      }

      const activeNum = courtDragActiveNumRef.current;
      const targetNum = findCourtCardNumAtPoint(clientX, clientY);
      if (targetNum === null) return;

      if (targetNum !== activeNum) {
        const now = Date.now();
        if (now - courtLastLiveSwapTimeRef.current < 140) return;

        const currentList = courtsRef.current;
        const fromIdx = currentList.findIndex((c) => c.courtNumber === activeNum);
        const toIdx = currentList.findIndex((c) => c.courtNumber === targetNum);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          courtLastLiveSwapTimeRef.current = now;
          const updated = [...currentList];
          const [moved] = updated.splice(fromIdx, 1);
          updated.splice(toIdx, 0, moved);
          courtsRef.current = updated;
          didCourtReorderRef.current = true;
          onReorderCourtsRef.current?.(updated);
          try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(15);
            }
          } catch {
            // ignore
          }
        }
      }
    };

    const finishCourtLongPressDrag = () => {
      clearCourtLongPressTimer();
      courtLongPressPendingNumRef.current = null;
      courtLongPressStartPosRef.current = null;

      if (courtDragActiveNumRef.current !== null) {
        courtDragActiveNumRef.current = null;
        setDraggedCourtNum(null);

        if (didCourtReorderRef.current) {
          soundEffects.playScorePoint();
        }
        window.setTimeout(() => {
          suppressCourtClickAfterDragRef.current = false;
        }, 320);
        didCourtReorderRef.current = false;
      }
    };

    const onWindowTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handlePointerMoveReorder(touch.clientX, touch.clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      if (courtLongPressPendingNumRef.current === null && courtDragActiveNumRef.current === null) {
        return;
      }
      handlePointerMoveReorder(e.clientX, e.clientY, () => {
        e.preventDefault();
      });
    };

    const onWindowTouchEnd = () => finishCourtLongPressDrag();
    const onWindowMouseUp = () => finishCourtLongPressDrag();

    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', onWindowTouchEnd);
    window.addEventListener('touchcancel', onWindowTouchEnd);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchEnd);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (courtDragActiveNumRef.current !== null) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) return;

    dragStateRef.current = {
      isDown: true,
      startX: e.clientX,
      scrollLeft: container.scrollLeft,
      hasMoved: false,
    };
    setIsMouseDown(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (courtDragActiveNumRef.current !== null) return;
    if (!dragStateRef.current.isDown) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const deltaX = e.clientX - dragStateRef.current.startX;
    if (!dragStateRef.current.hasMoved && Math.abs(deltaX) > 6) {
      dragStateRef.current.hasMoved = true;
      setIsDragging(true);
    }

    if (dragStateRef.current.hasMoved) {
      e.preventDefault();
      container.scrollLeft = dragStateRef.current.scrollLeft - deltaX;
    }
  };

  const handleMouseUpOrLeave = () => {
    if (dragStateRef.current.isDown) {
      dragStateRef.current.isDown = false;
      setIsMouseDown(false);
      if (dragStateRef.current.hasMoved) {
        setTimeout(() => {
          setIsDragging(false);
          dragStateRef.current.hasMoved = false;
        }, 60);
      } else {
        setIsDragging(false);
      }
    }
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragStateRef.current.isDown) {
        dragStateRef.current.isDown = false;
        setIsMouseDown(false);
        if (dragStateRef.current.hasMoved) {
          setTimeout(() => {
            setIsDragging(false);
            dragStateRef.current.hasMoved = false;
          }, 60);
        } else {
          setIsDragging(false);
        }
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  const handleClickCapture = (e: React.MouseEvent) => {
    if (suppressCourtClickAfterDragRef.current || dragStateRef.current.hasMoved || isDragging) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div className="space-y-3">
      {/* Top Action Bar: 코트 현황 & 조 편성 방식 & 코트 생성하기 / 대기열 연속 생성 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-nowrap w-full overflow-x-auto no-scrollbar">
          <h1 className="text-lg font-bold text-white flex items-center gap-2 shrink-0 whitespace-nowrap">
            <LayoutGrid className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>코트 현황</span>
          </h1>

          <button
            type="button"
            onClick={onOpenGenerateModal}
            title="클릭하여 복식 조 편성 방식(실력 밸런스 / 완전 랜덤 / 복식 우선 / 혼복 우선) 변경"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-white transition-all cursor-pointer text-[11px] sm:text-xs shadow-sm whitespace-nowrap shrink-0"
          >
            {options.mode === 'balanced' ? (
              <>
                <Scale className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-bold text-emerald-400">실력 밸런스</span>
              </>
            ) : options.mode === 'random' ? (
              <>
                <Shuffle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-bold text-emerald-400">완전 랜덤</span>
              </>
            ) : options.mode === 'doubles_only' ? (
              <>
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-bold text-emerald-400">복식 우선</span>
              </>
            ) : (
              <>
                <Users2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-bold text-emerald-400">혼복 우선</span>
              </>
            )}
            <SlidersHorizontal className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full">
          <button
            onClick={() => {
              soundEffects.playRacketHit();
              onAddCourt();
            }}
            title="새 코트 추가"
            className="flex-1 min-w-[120px] px-3 py-2 text-xs sm:text-sm font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-98 rounded-xl shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap min-h-[38px]"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>코트 생성하기</span>
          </button>

          <button
            onClick={() => {
              if (courts.length > 0 && onPreGenerateNMatches) {
                onPreGenerateNMatches(courts.length);
              } else {
                onPreGenerateFourMatches?.();
              }
            }}
            title={
              courts.length > 0
                ? `현재 운영 코트(${courts.length}개)에 비례하여 ${courts.length}경기(${courts.length * 4}명)를 대기열에 연속 생성`
                : '코트를 먼저 생성하면 코트 수에 비례하여 대기열을 생성합니다'
            }
            className="flex-1 min-w-[140px] px-3 py-2 text-xs sm:text-sm font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 border border-amber-400 active:scale-98 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-h-[38px] shadow-md shadow-amber-500/20"
          >
            <Clock className="w-3.5 h-3.5 text-slate-950 shrink-0" />
            <span>
              {courts.length > 0
                ? `연속 생성 (+${courts.length} · ${courts.length * 4}명)`
                : '연속 생성 (코트 필요)'}
            </span>
          </button>
        </div>
      </div>

      {/* Swap In-Progress Alert Banner */}
      {selectedSwap?.source === 'court' && selectedCourtPlayer && (
        <div className="p-3.5 rounded-xl bg-amber-500/20 border border-amber-400/60 text-white flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2 text-xs">
            <ArrowLeftRight className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              교체 대기 중:{' '}
              <strong className="text-amber-300 font-bold underline">
                {selectedCourtPlayer.name}
              </strong>
              (을)를 교체할 다른 선수(코트 또는 대기석)를 클릭하세요.
            </span>
          </div>
          <button
            onClick={onCancelSwap}
            className="px-2.5 py-1 text-xs font-semibold bg-slate-900/80 hover:bg-slate-900 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>교체 취소</span>
          </button>
        </div>
      )}

      {/* Courts Board Display */}
      {courts.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl mx-auto">
            🏸
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              코트 현황
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              운영 중인 코트가 없습니다.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => {
                soundEffects.playRacketHit();
                onAddCourt();
              }}
              className="px-6 py-3 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer inline-flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span>코트 생성하기</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {courts.length > 1 && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pb-0.5">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>코트 {courts.length}개 운영 중</span>
              </span>
              <div className="flex items-center gap-2">
                {isScrollMode && (
                  <span className="text-[10px] text-emerald-400 font-medium hidden sm:inline">
                    ← 마우스 드래그 / 스크롤 →
                  </span>
                )}
                <div className="flex items-center gap-1">
                  {/* 좌우 스크롤 체크버튼 */}
                  <label
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer flex items-center justify-center min-w-[26px] min-h-[26px]"
                    title={
                      isScrollMode
                        ? '체크 해제: 전체 코트 한눈에 보기 (스크롤 없음)'
                        : '체크: 코트 좌우 스크롤 모드 (마우스 드래그/터치 스크롤)'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isScrollMode}
                      onChange={handleToggleScrollMode}
                      className="w-3.5 h-3.5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-400 focus:ring-offset-0 bg-slate-900 cursor-pointer accent-emerald-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
          <div
            ref={scrollContainerRef}
            onMouseDown={isScrollMode ? handleMouseDown : undefined}
            onMouseMove={isScrollMode ? handleMouseMove : undefined}
            onMouseUp={isScrollMode ? handleMouseUpOrLeave : undefined}
            onClickCapture={handleClickCapture}
            className={
              isScrollMode
                ? `flex flex-nowrap overflow-x-auto touch-manipulation no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden gap-3.5 sm:gap-4 pb-3.5 pt-0.5 px-1 -mx-1 ${
                    isMouseDown || draggedCourtNum !== null
                      ? 'snap-none cursor-grabbing select-none'
                      : 'snap-x snap-mandatory cursor-grab'
                  }`
                : `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4 pb-3.5 pt-0.5 px-1 -mx-1 ${
                    draggedCourtNum !== null ? 'select-none' : ''
                  }`
            }
          >
            {courts.map((court) => {
              const cones = getNormalizedTurnQueue(court.cones || [], court.currentConeIndex || 0);
              const activeCone = cones.length > 0 ? cones[0] : null;
              const isOtherClubTurn = activeCone?.color === 'gray';

              // Find most recent completed match for this court to support revert (되돌리기)
              const prevMatch = allCompletedMatches.find(
                (m) => Number(m.courtNumber) === Number(court.courtNumber)
              );

              const lastTurn =
                court.turnHistory && court.turnHistory.length > 0
                  ? court.turnHistory[court.turnHistory.length - 1]
                  : undefined;
              const hasPrevGrayTurn =
                lastTurn?.prevTurnColor === 'gray' &&
                (court.cones || []).some((c) => c.color === 'gray');

              const prevMatchSummary = hasPrevGrayTurn
                ? '다른클럽 꼬깔'
                : prevMatch
                ? [
                    playersMap.get(prevMatch.teamA.player1Id)?.name,
                    playersMap.get(prevMatch.teamA.player2Id)?.name,
                    playersMap.get(prevMatch.teamB.player1Id)?.name,
                    playersMap.get(prevMatch.teamB.player2Id)?.name,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : undefined;

              // Check if there is an active match assigned to this court
              const activeMatch = activeMatches.find(
                (m) => m.courtNumber === court.courtNumber
              );

              const hasPrevious = Boolean(prevMatch) || Boolean(hasPrevGrayTurn);

              const handleCourtRevertClick = (cNum: number) => {
                if (!hasPrevious && !activeMatch) {
                  triggerNoPrevMatchAlert(cNum);
                  return;
                }
                onRevertPreviousMatch?.(cNum);
              };

              const isBeingDragged = draggedCourtNum === court.courtNumber;

              return (
                <div
                  key={court.id || court.courtNumber}
                  ref={(el) => {
                    courtCardRefs.current[court.courtNumber] = el;
                  }}
                  data-court-card-num={court.courtNumber}
                  onTouchStart={(e) => handleCourtTouchStart(e, court.courtNumber)}
                  onMouseDown={(e) => handleCourtMouseDownLongPress(e, court.courtNumber)}
                  className={`relative ${
                    isScrollMode
                      ? 'w-[86vw] sm:w-[420px] md:w-[440px] max-w-[460px] shrink-0 snap-center flex flex-col'
                      : 'w-full flex flex-col'
                  } transition-transform duration-150 ${
                    isBeingDragged
                      ? 'opacity-75 scale-[0.98] ring-2 ring-emerald-400/80 rounded-2xl z-20 select-none'
                      : ''
                  }`}
                >
                  {isOtherClubTurn ? (
                    <OtherClubCourtCard
                      court={court}
                      onAdvanceTurn={onAdvanceCourtTurn}
                      onUpdateCones={onUpdateCourtCones}
                      onRenameCourt={onRenameCourt}
                      onRemoveCourt={onRemoveCourt}
                      nextQueuedTeamName={nextQueuedTeamName}
                      onRevertPreviousMatch={handleCourtRevertClick}
                      hasPreviousMatch={hasPrevious}
                      previousMatchSummary={prevMatchSummary}
                      onOpenAssignQueueModal={onOpenAssignQueueModal}
                    />
                  ) : activeMatch ? (
                    <CourtCard
                      match={activeMatch}
                      court={court}
                      playersMap={playersMap}
                      onCompleteMatch={onCompleteMatch}
                      onResetMatch={onResetMatch}
                      onSelectPlayerForSwap={(playerId, matchId, team, slot) =>
                        onSelectPlayerForSwap(playerId, matchId, team, slot)
                      }
                      selectedSwap={selectedSwap}
                      onAdvanceTurn={onAdvanceCourtTurn}
                      onUpdateCones={onUpdateCourtCones}
                      onRenameCourt={onRenameCourt}
                      onClearCourtMatch={onClearCourtMatch}
                      onRemoveCourt={onRemoveCourt}
                      onRevertPreviousMatch={handleCourtRevertClick}
                      hasPreviousMatch={hasPrevious}
                      previousMatchSummary={prevMatchSummary}
                      activeMatches={activeMatches}
                      queuedMatches={queuedMatches}
                      conflictPlayerIds={conflictPlayerIds}
                    />
                  ) : (
                    <EmptyCourtCard
                      court={court}
                      queuedMatches={queuedMatches}
                      restingPlayers={restingPlayers}
                      playersMap={playersMap}
                      allPlayers={allPlayers}
                      options={options}
                      activeMatches={activeMatches}
                      currentRound={currentRound}
                      onAssignQueueToCourt={onAssignQueueToCourt}
                      onGenerateForCourt={onGenerateForCourt}
                      onRemoveCourt={onRemoveCourt}
                      onRenameCourt={onRenameCourt}
                      onAdvanceTurn={onAdvanceCourtTurn}
                      onUpdateCones={onUpdateCourtCones}
                      selectedBenchPlayersCount={selectedBenchPlayerIds.length}
                      onAssignSelectedToThisCourt={onAssignSelectedToCourt}
                      onRevertPreviousMatch={handleCourtRevertClick}
                      onOpenAssignQueueModal={onOpenAssignQueueModal}
                      hasPreviousMatch={hasPrevious}
                      previousMatchSummary={prevMatchSummary}
                    />
                  )}

                  {/* 대진기록에 해당 코트의 전 경기가 없을 때 해당 코트 중앙 알림 */}
                  {noPrevMatchAlertCourts[court.courtNumber] && (
                    <div
                      onClick={() =>
                        setNoPrevMatchAlertCourts((prev) => ({
                          ...prev,
                          [court.courtNumber]: false,
                        }))
                      }
                      className="absolute inset-x-0 top-[42px] bottom-0 z-40 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[2px] rounded-b-2xl animate-in fade-in duration-150 cursor-pointer"
                    >
                      <div className="px-4 py-2.5 rounded-xl bg-slate-900/95 border border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.35)] flex items-center justify-center gap-2 animate-in zoom-in-95 duration-150">
                        <span className="text-xs sm:text-sm font-extrabold text-amber-300 tracking-tight whitespace-nowrap">
                          전 경기가 없습니다
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resting / Waiting Bench (대기/휴식자 명단) */}
      <RestingBench
        restingPlayers={restingPlayers}
        allPlayers={allPlayers.filter((p) => !p.attendancePending)}
        selectedBenchPlayerIds={selectedBenchPlayerIds}
        onToggleSelectBenchPlayer={onToggleSelectBenchPlayer}
        onClearBenchSelection={onClearBenchSelection}
        onAssignSelectedToCourt={onAssignSelectedToCourt}
        onAssignSelectedToQueue={onAssignSelectedToQueue}
        selectedCourtPlayerName={selectedCourtPlayer?.name}
        onTogglePlayerActive={onTogglePlayerActive}
        activeMatches={activeMatches}
        queuedMatches={queuedMatches}
        completedMatches={completedMatches}
        options={options}
        onSetPlayerSpecialStatus={onSetPlayerSpecialStatus}
      />

      {/* Custom N-Match Queue Generator Modal */}
      <CustomNMatchModal
        isOpen={showCustomNModal}
        onClose={() => setShowCustomNModal(false)}
        onConfirm={(count) => {
          if (onPreGenerateNMatches) {
            onPreGenerateNMatches(count);
          } else {
            onPreGenerateFourMatches?.();
          }
        }}
        activePlayersCount={
          allPlayers.filter((p) => {
            if (
              !p.isActive ||
              p.attendancePending ||
              p.specialStatus === 'resting' ||
              p.specialStatus === 'lesson' ||
              isPlayerLastMatchCompleted(p)
            ) {
              return false;
            }
            if (p.specialStatus === 'last_match') {
              const inActive = activeMatches.some(
                (m) =>
                  m.status !== 'completed' &&
                  (m.teamA.player1Id === p.id ||
                    m.teamA.player2Id === p.id ||
                    m.teamB.player1Id === p.id ||
                    m.teamB.player2Id === p.id)
              );
              const inQueue = queuedMatches.some(
                (m) =>
                  m.teamA.player1Id === p.id ||
                  m.teamA.player2Id === p.id ||
                  m.teamB.player1Id === p.id ||
                  m.teamB.player2Id === p.id
              );
              if (inActive || inQueue) return false;
            }
            return true;
          }).length
        }
        courtCount={courts.length}
        options={options}
        onOpenGenerateModal={onOpenGenerateModal}
      />
    </div>
  );
};
