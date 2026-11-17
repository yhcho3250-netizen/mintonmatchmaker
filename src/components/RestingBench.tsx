import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Player, TIER_LABELS, CourtMatch, MatchOptions, isPlayerLastMatchCompleted } from '../types';
import {
  Coffee,
  GraduationCap,
  Flag,
  ArrowLeftRight,
  Check,
  Sparkles,
  X,
  Users,
  Layers,
  DoorOpen,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { PartnerDot } from './PartnerDot';
import {
  computeEffectiveAssignedMap,
  isLateRegisteredPlayer,
  getPlayerRegistrationTime,
  getPlayerWaitingMinutes,
  isSpecialMatchTurnReady,
} from '../utils/matchmaker';

interface RestingBenchProps {
  restingPlayers: Player[];
  allPlayers?: Player[];
  selectedBenchPlayerIds: string[];
  onToggleSelectBenchPlayer: (playerId: string) => void;
  onClearBenchSelection: () => void;
  onAssignSelectedToCourt: () => void;
  onAssignSelectedToQueue?: () => void;
  selectedCourtPlayerName?: string | null;
  onTogglePlayerActive?: (playerId: string) => void;
  activeMatches?: CourtMatch[];
  queuedMatches?: CourtMatch[];
  completedMatches?: CourtMatch[];
  options?: MatchOptions;
  onSetPlayerSpecialStatus?: (playerId: string, status: 'resting' | 'lesson' | 'last_match' | 'exited' | null) => void;
}

export const RestingBench: React.FC<RestingBenchProps> = ({
  restingPlayers,
  allPlayers,
  selectedBenchPlayerIds,
  onToggleSelectBenchPlayer,
  onClearBenchSelection,
  onAssignSelectedToCourt,
  onAssignSelectedToQueue,
  selectedCourtPlayerName,
  activeMatches = [],
  queuedMatches = [],
  completedMatches = [],
  options,
  onSetPlayerSpecialStatus,
}) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  // Radial / Fan-shaped Menu State
  const [radialMenuPlayer, setRadialMenuPlayer] = useState<Player | null>(null);
  const [radialMenuPos, setRadialMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Status Cancel Confirmation Modal State
  const [statusConfirmPlayer, setStatusConfirmPlayer] = useState<Player | null>(null);

  // Toast message for swap restrictions
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  };

  // Long-press detection refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressTriggeredRef = useRef<boolean>(false);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const suppressClickAfterBenchCancelRef = useRef<boolean>(false);

  // 대기/휴식자 명단에서 선수 1명 이상 선택(터치) 시 외부 영역 클릭(터치)으로 선택 취소 처리
  useEffect(() => {
    if (selectedBenchPlayerIds.length === 0) return;

    const handleBenchOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 모달 내부 클릭/터치는 모달에서 처리
      if (target.closest('[data-court-modal="true"]')) return;

      // 코트에 배정 / 대기열에 배정 버튼 클릭/터치 시에는 배정 실행 유지
      if (target.closest('[data-bench-assign-btn="true"]')) return;

      // 대기/휴식자 명단 선수 카드 클릭/터치 시에는 선수 선택 추가/해제 토글 유지
      if (target.closest('[data-bench-player-card="true"]')) return;

      // 대기 선수 1명 선택 상태에서 코트 선수 슬롯 클릭/터치 시에는 1:1 맞교체 실행 유지
      if (
        selectedBenchPlayerIds.length === 1 &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        return;
      }

      // 2명 이상 선택 상태에서 코트 선수 카드를 클릭/터치하여 선택을 취소할 때 해당 코트 선수가 선택되지 않도록 클릭 소비
      if (target.closest('[data-player-swap-item="true"]')) {
        suppressClickAfterBenchCancelRef.current = true;
      }

      onClearBenchSelection();
    };

    const handleBenchOutsideClick = (e: MouseEvent) => {
      if (suppressClickAfterBenchCancelRef.current) {
        suppressClickAfterBenchCancelRef.current = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-court-modal="true"]')) return;
      if (target.closest('[data-bench-assign-btn="true"]')) return;
      if (target.closest('[data-bench-player-card="true"]')) return;
      if (
        selectedBenchPlayerIds.length === 1 &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        return;
      }

      onClearBenchSelection();
    };

    document.addEventListener('pointerdown', handleBenchOutsidePointerDown);
    document.addEventListener('click', handleBenchOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleBenchOutsidePointerDown);
      document.removeEventListener('click', handleBenchOutsideClick, true);
    };
  }, [selectedBenchPlayerIds.length, onClearBenchSelection]);

  // 선수별 '몇 코트 뒤 배정' 계산 (대기열 편성 순번 및 출전 우선순위 기반)
  const playerCourtOffsetMap = useMemo(() => {
    const map = new Map<string, { offset: number; isQueued: boolean }>();

    // 1. 이미 다음 대기열 경기에 편성되어 있는 선수들 (출전 가능한 스페셜 1순위 및 일반 대기열: 1번 경기 -> 1코트 뒤, 2번 경기 -> 2코트 뒤...)
    const roster = allPlayers && allPlayers.length > 0 ? allPlayers : restingPlayers;
    const normalQueuedMatches = queuedMatches.filter((m) => !m.isSpecialMatch);
    const deployableQueuedMatches = queuedMatches.filter(
      (m) =>
        !m.isSpecialMatch ||
        isSpecialMatchTurnReady(m, roster, activeMatches, queuedMatches, options)
    );
    deployableQueuedMatches.forEach((match, matchIdx) => {
      [
        match.teamA.player1Id,
        match.teamA.player2Id,
        match.teamB.player1Id,
        match.teamB.player2Id,
      ].forEach((id) => {
        if (id && !map.has(id)) {
          map.set(id, { offset: matchIdx + 1, isQueued: true });
        }
      });
    });

    // 2. 대기열에 아직 배정되지 않은 휴식자들의 우선순위 정렬 (휴식중/레슨중/퇴장!은 배정 대상 제외)
    const rawAssignedMap: Record<string, number> = {};
    const recentOrActiveIds = new Set<string>();
    activeMatches.forEach((m) => {
      if (m.status !== 'completed') {
        [m.teamA.player1Id, m.teamA.player2Id, m.teamB.player1Id, m.teamB.player2Id].forEach((id) => {
          if (id) recentOrActiveIds.add(id);
        });
      }
    });
    roster.forEach((p) => {
      const inCourt = recentOrActiveIds.has(p.id) ? 1 : 0;
      const inQueue = normalQueuedMatches.filter(
        (m) =>
          m.teamA.player1Id === p.id ||
          m.teamA.player2Id === p.id ||
          m.teamB.player1Id === p.id ||
          m.teamB.player2Id === p.id
      ).length;
      rawAssignedMap[p.id] = (p.gamesPlayed || 0) + inCourt + inQueue;
      if ((p.consecutiveRestRounds || 0) === 0 && (p.gamesPlayed || 0) > (p.restStartGamesPlayed ?? 0)) {
        recentOrActiveIds.add(p.id);
      }
    });
    const effMap = computeEffectiveAssignedMap(roster, rawAssignedMap, recentOrActiveIds, roster);

    const unqueuedResting = restingPlayers.filter(
      (p) =>
        !map.has(p.id) &&
        p.specialStatus !== 'resting' &&
        p.specialStatus !== 'lesson' &&
        !isPlayerLastMatchCompleted(p)
    );
    const sortedUnqueued = [...unqueuedResting].sort((a, b) => {
      const aIsLate = isLateRegisteredPlayer(a, roster);
      const bIsLate = isLateRegisteredPlayer(b, roster);
      const aLateConsecutive = aIsLate && recentOrActiveIds.has(a.id) ? 1 : 0;
      const bLateConsecutive = bIsLate && recentOrActiveIds.has(b.id) ? 1 : 0;
      if (aLateConsecutive !== bLateConsecutive) {
        return aLateConsecutive - bLateConsecutive;
      }

      const aAssigned = effMap[a.id] ?? (rawAssignedMap[a.id] || 0);
      const bAssigned = effMap[b.id] ?? (rawAssignedMap[b.id] || 0);
      const aEff = a.tier === 'S' ? aAssigned * 0.65 : aAssigned;
      const bEff = b.tier === 'S' ? bAssigned * 0.65 : bAssigned;

      if ((aIsLate || bIsLate) && Math.abs(aEff - bEff) >= 0.5) {
        return aEff - bEff;
      }

      if (options?.avoidConsecutiveRests) {
        const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        if (bRested !== aRested) return bRested - aRested;
        if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
          return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
        }
      }
      if (aEff !== bEff) return aEff - bEff;
      if (a.tier === 'S' && b.tier !== 'S') return -1;
      if (b.tier === 'S' && a.tier !== 'S') return 1;
      const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
      if (regDiff !== 0) return regDiff;
      return 0;
    });

    // 파트너가 함께 대기 중인 경우 인접 순번으로 묶어 같은 예상 코트 순번(대기N)에 매핑되도록 정렬 보정
    const clusteredUnqueued: Player[] = [];
    const visitedIds = new Set<string>();
    for (const p of sortedUnqueued) {
      if (visitedIds.has(p.id)) continue;
      clusteredUnqueued.push(p);
      visitedIds.add(p.id);
      if (p.partnerId) {
        const partner = sortedUnqueued.find(
          (cand) => !visitedIds.has(cand.id) && (cand.id === p.partnerId || cand.partnerId === p.id)
        );
        if (partner) {
          clusteredUnqueued.push(partner);
          visitedIds.add(partner.id);
        }
      }
    }

    // 4명씩 다음 코트 순번에 매핑 (대기열 다음 경기부터 순차적)
    clusteredUnqueued.forEach((p, idx) => {
      const matchOffset = queuedMatches.length + Math.floor(idx / 4) + 1;
      map.set(p.id, { offset: matchOffset, isQueued: false });
    });

    return map;
  }, [queuedMatches, restingPlayers, allPlayers, activeMatches, options]);

  // Pointer event handlers for Long-Press / Long-Touch
  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, player: Player) => {
    isLongPressTriggeredRef.current = false;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

    const targetElement = e.currentTarget;
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const topY = rect.top;

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if (navigator.vibrate) {
        navigator.vibrate(40);
      }
      soundEffects.playRacketHit();
      setRadialMenuPos({ x: centerX, y: topY });
      setRadialMenuPlayer(player);
    }, 450);
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!longPressTimerRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y
    );
    if (dist > 12) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCardPointerUpOrCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCardClick = (player: Player) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }

    const isLastMatchDone = isPlayerLastMatchCompleted(player);
    const isAlreadyQueued = queuedMatches.some(
      (m) =>
        m.teamA.player1Id === player.id ||
        m.teamA.player2Id === player.id ||
        m.teamB.player1Id === player.id ||
        m.teamB.player2Id === player.id
    );

    // 코트 선수 교체 대기 중일 때:
    if (selectedCourtPlayerName) {
      if (
        player.specialStatus === 'resting' ||
        player.specialStatus === 'lesson' ||
        isLastMatchDone
      ) {
        soundEffects.playScorePoint();
        showToast(
          player.specialStatus === 'resting'
            ? `${player.name} 선수는 현재 휴식중입니다. (교체 불가)`
            : player.specialStatus === 'lesson'
            ? `${player.name} 선수는 현재 레슨중입니다. (교체 불가)`
            : `${player.name} 선수는 마지막판 완료(퇴장!) 상태입니다. (교체 불가)`
        );
        return;
      }
      if (player.specialStatus === 'last_match' && isAlreadyQueued) {
        soundEffects.playScorePoint();
        showToast(
          `${player.name} 선수는 마지막판 상태로 이미 대기열에 배정되어 있습니다. (중복 배정 불가)`
        );
        return;
      }
      onToggleSelectBenchPlayer(player.id);
      return;
    }

    // 1. If player is currently 'resting', 'lesson', or 'last_match' ('막판!' / '퇴장!'): clicking asks to end it!
    if (player.specialStatus) {
      soundEffects.playScorePoint();
      setStatusConfirmPlayer(player);
      return;
    }

    // 2. Normal player selection for court assignment
    const isSelected = selectedBenchPlayerIds.includes(player.id);
    if (!isSelected && selectedBenchPlayerIds.length >= 4) {
      soundEffects.playScorePoint();
      return;
    }
    onToggleSelectBenchPlayer(player.id);
  };

  if (restingPlayers.length === 0) {
    return (
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-center">
        <div className="text-xs text-slate-400">
          {!allPlayers || allPlayers.length === 0
            ? '참가자 명단 메뉴에서 선수를 등록해주세요.'
            : '모든 참가자가 현재 코트에서 경기 중입니다.'}
        </div>
      </div>
    );
  }

  const selectedCount = selectedBenchPlayerIds.length;
  const selectedNames = selectedBenchPlayerIds
    .map((id) => restingPlayers.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 relative">
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-950/95 border border-indigo-400/60 text-indigo-200 text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {toastMessage.includes('레슨') ? (
            <GraduationCap className="w-4 h-4 text-indigo-400 shrink-0" />
          ) : (
            <Coffee className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{toastMessage}</span>
        </div>
      )}
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Coffee className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>대기 / 휴식자 명단</span>
              <span className="text-xs font-mono tabular-nums text-amber-400 font-semibold px-1.5 py-0.2 rounded bg-amber-400/10">
                {restingPlayers.length}명
              </span>
              {selectedCount > 0 && (
                <span className="text-xs font-mono tabular-nums text-emerald-400 font-bold px-1.5 py-0.2 rounded bg-emerald-400/15 border border-emerald-400/30">
                  선택 {selectedCount}/4명
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              선수를 <strong className="text-emerald-400 font-semibold underline decoration-dotted">길게 누르면(터치)</strong> 휴식/레슨/마지막판/퇴장 선택
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Action Banner based on selection */}
      {selectedCourtPlayerName ? (
        <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/60 text-white flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2 text-xs">
            <ArrowLeftRight className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              선수 교체 대기 중: 코트 <strong className="text-amber-300 font-bold underline">{selectedCourtPlayerName}</strong> ↔ 맞바꿀 대기 선수를 클릭하세요.
            </span>
          </div>
        </div>
      ) : selectedCount === 1 ? (
        <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs">
            <ArrowLeftRight className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              선택됨: <strong className="text-white font-bold">{selectedNames}</strong> (1명)
              <span className="text-slate-300 ml-1.5">➔  1:1 맞교체 또는 바로 배정</span>
            </span>
          </div>
          <div className="w-full flex items-center gap-2">
            <button
              type="button"
              data-bench-assign-btn="true"
              onClick={() => {
                soundEffects.playWhistle();
                onAssignSelectedToCourt();
              }}
              className="flex-1 basis-0 min-w-0 px-2.5 py-1 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-98 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>코트에 배정</span>
            </button>
            {onAssignSelectedToQueue && (
              <button
                type="button"
                data-bench-assign-btn="true"
                onClick={() => {
                  soundEffects.playWhistle();
                  onAssignSelectedToQueue();
                }}
                className="flex-1 basis-0 min-w-0 px-2.5 py-1 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 active:scale-98 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>대기열에 배정</span>
              </button>
            )}
          </div>
        </div>
      ) : selectedCount > 1 ? (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs">
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              대기 선수: <strong className="text-white font-bold">{selectedCount}/4명</strong> ({selectedNames})
            </span>
          </div>
          <div className="w-full flex items-center gap-2">
            <button
              type="button"
              data-bench-assign-btn="true"
              onClick={() => {
                soundEffects.playWhistle();
                onAssignSelectedToCourt();
              }}
              className="flex-1 basis-0 min-w-0 px-3 py-1 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-98 rounded-lg shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{selectedCount}명 코트에 배정</span>
            </button>
            {onAssignSelectedToQueue && (
              <button
                type="button"
                data-bench-assign-btn="true"
                onClick={() => {
                  soundEffects.playWhistle();
                  onAssignSelectedToQueue();
                }}
                className="flex-1 basis-0 min-w-0 px-3 py-1 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 active:scale-98 rounded-lg shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>{selectedCount}명 대기열에 배정</span>
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Bench Player Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {restingPlayers.map((player) => {
          const isSelected = selectedBenchPlayerIds.includes(player.id);
          const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;
          const isResting = player.specialStatus === 'resting';
          const isLesson = player.specialStatus === 'lesson';
          const isLastMatchDone = isPlayerLastMatchCompleted(player);
          const isLastMatchActive = player.specialStatus === 'last_match' && !isLastMatchDone;

          const activeCount = activeMatches.filter(
            (m) =>
              m.teamA.player1Id === player.id ||
              m.teamA.player2Id === player.id ||
              m.teamB.player1Id === player.id ||
              m.teamB.player2Id === player.id
          ).length;

          const queuedCount = queuedMatches.filter(
            (m) =>
              m.teamA.player1Id === player.id ||
              m.teamA.player2Id === player.id ||
              m.teamB.player1Id === player.id ||
              m.teamB.player2Id === player.id
          ).length;

          const assignedCount = player.gamesPlayed + activeCount + queuedCount;
          const progressCount = player.gamesPlayed;
          const courtOffsetInfo = playerCourtOffsetMap.get(player.id);

          return (
            <div
              key={player.id}
              data-player-swap-item="true"
              data-bench-player-card="true"
              onPointerDown={(e) => handleCardPointerDown(e, player)}
              onPointerMove={handleCardPointerMove}
              onPointerUp={handleCardPointerUpOrCancel}
              onPointerCancel={handleCardPointerUpOrCancel}
              onContextMenu={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setRadialMenuPos({ x: rect.left + rect.width / 2, y: rect.top });
                setRadialMenuPlayer(player);
              }}
              onClick={() => handleCardClick(player)}
              className={`p-2.5 rounded-lg border transition-all cursor-pointer relative group select-none touch-manipulation overflow-hidden ${
                isSelected
                  ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 shadow-md'
                  : isResting
                  ? 'bg-amber-950/70 border-2 border-amber-500/80 shadow-md shadow-amber-500/20 ring-1 ring-amber-400/40'
                  : isLesson
                  ? 'bg-indigo-950/70 border-2 border-indigo-500/80 shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400/40'
                  : isLastMatchDone
                  ? 'bg-slate-900/80 border-2 border-slate-400/60 ring-1 ring-slate-400/30 animate-subtle-gray-glow'
                  : isLastMatchActive
                  ? 'bg-rose-950/70 border-2 border-rose-500/80 shadow-md shadow-rose-500/20 ring-1 ring-rose-400/40'
                  : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Top Row: Name & Tier */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span
                    className={`text-xs font-bold truncate ${
                      isLastMatchDone
                        ? 'text-slate-400'
                        : player.gender === 'M'
                        ? 'text-blue-400'
                        : 'text-pink-400'
                    }`}
                  >
                    {player.name}
                  </span>
                  <PartnerDot player={player} allPlayers={allPlayers || restingPlayers} size="xs" />
                  {isResting && (
                    <span
                      title="휴식중 (클릭 시 해제)"
                      className="inline-flex items-center justify-center p-0.5 rounded bg-amber-500/25 border border-amber-400/60 text-amber-300 animate-pulse shrink-0"
                    >
                      <Coffee className="w-2.5 h-2.5 text-amber-300" />
                    </span>
                  )}
                  {isLesson && (
                    <span
                      title="레슨중 (클릭 시 해제)"
                      className="inline-flex items-center justify-center p-0.5 rounded bg-indigo-500/25 border border-indigo-400/60 text-indigo-300 animate-pulse shrink-0"
                    >
                      <GraduationCap className="w-2.5 h-2.5 text-indigo-300" />
                    </span>
                  )}
                  {isLastMatchActive && (
                    <span
                      title="마지막판! (클릭 시 해제)"
                      className="inline-flex items-center justify-center p-0.5 rounded bg-rose-500/25 border border-rose-400/60 text-rose-300 animate-pulse shrink-0"
                    >
                      <Flag className="w-2.5 h-2.5 text-rose-300" />
                    </span>
                  )}
                  {isLastMatchDone && (
                    <span
                      title="퇴장(마지막판 완료) - 클릭 시 해제"
                      className="inline-flex items-center justify-center p-0.5 rounded bg-slate-800/90 border border-slate-400/70 text-slate-200 shadow-[0_0_8px_rgba(148,163,184,0.4)] shrink-0"
                    >
                      <DoorOpen className="w-2.5 h-2.5 text-slate-200" />
                    </span>
                  )}
                  {courtOffsetInfo && !isResting && !isLesson && !isLastMatchActive && !isLastMatchDone && (
                    <span
                      className={`text-[9px] font-mono font-semibold transition-all tabular-nums shrink-0 ${
                        courtOffsetInfo.isQueued
                          ? 'text-amber-300'
                          : 'text-slate-300'
                      }`}
                      title={
                        courtOffsetInfo.isQueued
                          ? `대기열 ${courtOffsetInfo.offset}번째 경기에 편성됨 (${courtOffsetInfo.offset}코트 뒤 배정)`
                          : `대기 우선순위 기준 예상 ${courtOffsetInfo.offset}코트 뒤 배정`
                      }
                    >
                      대기{courtOffsetInfo.offset}
                    </span>
                  )}
                </div>

                <span
                  className={`text-[10px] font-semibold shrink-0 ${tierMeta.color}`}
                >
                  {tierMeta.short}
                </span>
              </div>

              {/* Bottom Row: Stats & Waiting Time (N분 in red, text only) */}
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-300 font-mono tabular-nums">
                <span className="font-medium text-slate-300">
                  배정 {assignedCount} / 진행 {progressCount}
                </span>
                {activeCount === 0 && (
                  <span className="text-rose-500 font-bold font-mono tabular-nums">
                    {getPlayerWaitingMinutes(player, completedMatches, now)}분
                  </span>
                )}
              </div>

              {/* RESTING (휴식중) OVERLAY: '선수이름 휴식중' 문구가 은은하게 반짝임 */}
              {isResting && (
                <div className="absolute inset-0 bg-slate-950/92 backdrop-blur-[2px] rounded-lg border-2 border-amber-500/80 p-2 flex flex-col items-center justify-center gap-1.5 z-20 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-400/80 text-amber-300 font-black text-xs sm:text-sm animate-pulse shadow-[0_0_14px_rgba(251,191,36,0.65)] max-w-full">
                    <Coffee className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span className="text-white font-black drop-shadow truncate">{player.name}</span>
                    <span className="text-amber-300 font-extrabold shrink-0">휴식중</span>
                  </div>
                  <div className="text-[10px] text-amber-200/70 font-medium">클릭 시 해제</div>
                </div>
              )}

              {/* LESSON (레슨중) OVERLAY: '선수이름 레슨중' 문구가 은은하게 반짝임 */}
              {isLesson && (
                <div className="absolute inset-0 bg-slate-950/92 backdrop-blur-[2px] rounded-lg border-2 border-indigo-500/80 p-2 flex flex-col items-center justify-center gap-1.5 z-20 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/25 border border-indigo-400/80 text-indigo-300 font-black text-xs sm:text-sm animate-pulse shadow-[0_0_14px_rgba(129,140,248,0.65)] max-w-full">
                    <GraduationCap className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                    <span className="text-white font-black drop-shadow truncate">{player.name}</span>
                    <span className="text-indigo-300 font-extrabold shrink-0">레슨중</span>
                  </div>
                  <div className="text-[10px] text-indigo-200/70 font-medium">클릭 시 해제</div>
                </div>
              )}

              {/* LAST MATCH ACTIVE (마지막판 배정 전/진행 전) OVERLAY: '선수이름 막판!' 문구가 은은하게 반짝임 */}
              {isLastMatchActive && (
                <div className="absolute inset-0 bg-slate-950/92 backdrop-blur-[2px] rounded-lg border-2 border-rose-500/80 p-2 flex flex-col items-center justify-center gap-1.5 z-20 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/25 border border-rose-400/80 text-rose-300 font-black text-xs sm:text-sm animate-pulse shadow-[0_0_14px_rgba(244,63,94,0.65)] max-w-full">
                    <Flag className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                    <span className="text-white font-black drop-shadow truncate">{player.name}</span>
                    <span className="text-rose-300 font-extrabold shrink-0">막판!</span>
                  </div>
                  <div className="text-[10px] text-rose-200/70 font-medium">클릭 시 해제</div>
                </div>
              )}

              {/* LAST MATCH COMPLETED (막판 코트 배정 및 완료 후) OVERLAY: 문이 열려있는 이미지 + '선수이름 퇴장!' 회색이 은은하게 빛나는 스타일 (취소선 없음) */}
              {isLastMatchDone && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-[2px] rounded-lg border-2 border-slate-400/60 p-2 flex flex-col items-center justify-center gap-1.5 z-20 animate-subtle-gray-glow">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/95 border border-slate-400/70 text-slate-200 font-black text-xs sm:text-sm max-w-full shadow-[0_0_12px_rgba(148,163,184,0.45)]">
                    <DoorOpen className="w-4 h-4 text-slate-200 shrink-0" />
                    <span className="text-slate-200 font-extrabold truncate">
                      {player.name} 퇴장!
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">클릭 시 해제</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FAN-SHAPED (부채꼴) RADIAL MENU MODAL */}
      {radialMenuPlayer && radialMenuPos && (
        <div data-court-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity animate-fadeIn cursor-pointer"
            onClick={() => setRadialMenuPlayer(null)}
          />

          {/* Fan Arc Menu Container positioned relative to the clicked card */}
          {(() => {
            const menuHeight = 190;
            const isNearTop = radialMenuPos.y < menuHeight + 20;
            const topPos = isNearTop
              ? Math.min(window.innerHeight - menuHeight - 10, radialMenuPos.y + 60)
              : radialMenuPos.y - 10;
            const transformStyle = isNearTop
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)';

            return (
              <div
                className="fixed z-50 pointer-events-auto flex flex-col items-center select-none animate-in fade-in zoom-in-95 duration-150"
                style={{
                  left: Math.max(168, Math.min(window.innerWidth - 168, radialMenuPos.x)),
                  top: topPos,
                  transform: transformStyle,
                }}
              >
                {/* 320x160 True Geometric Semicircle (부채꼴 반원) Container: 휴식 / 레슨 / 마지막판 / 퇴장 */}
                <div className="relative w-[320px] h-[160px] flex items-center justify-center">
                  {/* Clean SVG Semicircle Background */}
                  <svg
                    viewBox="0 0 320 160"
                    className="absolute inset-0 w-[320px] h-[160px] pointer-events-none drop-shadow-[0_16px_36px_rgba(0,0,0,0.85)]"
                  >
                    <defs>
                      <radialGradient id="fanSemicircleBg" cx="50%" cy="100%" r="100%">
                        <stop offset="0%" stopColor="#1e293b" stopOpacity="0.98" />
                        <stop offset="55%" stopColor="#0f172a" stopOpacity="0.98" />
                        <stop offset="100%" stopColor="#020617" stopOpacity="0.99" />
                      </radialGradient>
                    </defs>

                    {/* Semicircle Solid Sector: Center (160, 156), Radius 152 */}
                    <path
                      d="M 8 156 A 152 152 0 0 1 312 156 Z"
                      fill="url(#fanSemicircleBg)"
                      stroke="rgba(51, 65, 85, 0.7)"
                      strokeWidth="1.5"
                    />
                  </svg>

                  {/* 1. 휴식 (Break) */}
                  <div
                    className="absolute z-10 flex flex-col items-center"
                    style={{ left: '52px', top: '94px', transform: 'translate(-50%, -50%)' }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetPlayerSpecialStatus?.(radialMenuPlayer.id, 'resting');
                        soundEffects.playWhistle();
                        setRadialMenuPlayer(null);
                      }}
                      className="flex flex-col items-center gap-1 group/btn cursor-pointer transition-all transform -rotate-18 hover:scale-110 active:scale-95"
                    >
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 border-2 border-amber-200 text-slate-950 flex items-center justify-center shadow-xl shadow-amber-500/40 group-hover/btn:ring-4 group-hover/btn:ring-amber-400/50 ${
                          radialMenuPlayer.specialStatus === 'resting' ? 'ring-4 ring-amber-300 animate-pulse' : ''
                        }`}
                      >
                        <Coffee className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <span className="text-[11px] font-black text-amber-300 drop-shadow-md bg-slate-950/95 px-2 py-0.5 rounded-full border border-amber-400/50 whitespace-nowrap">
                        {radialMenuPlayer.specialStatus === 'resting' ? '휴식 해제' : '휴식'}
                      </span>
                    </button>
                  </div>

                  {/* 2. 레슨 (Lesson) */}
                  <div
                    className="absolute z-10 flex flex-col items-center"
                    style={{ left: '122px', top: '48px', transform: 'translate(-50%, -50%)' }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetPlayerSpecialStatus?.(radialMenuPlayer.id, 'lesson');
                        soundEffects.playWhistle();
                        setRadialMenuPlayer(null);
                      }}
                      className="flex flex-col items-center gap-1 group/btn cursor-pointer transition-all transform -rotate-6 hover:scale-110 active:scale-95"
                    >
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 border-2 border-indigo-200 text-white flex items-center justify-center shadow-xl shadow-indigo-500/40 group-hover/btn:ring-4 group-hover/btn:ring-indigo-400/50 ${
                          radialMenuPlayer.specialStatus === 'lesson' ? 'ring-4 ring-indigo-300 animate-pulse' : ''
                        }`}
                      >
                        <GraduationCap className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <span className="text-[11px] font-black text-indigo-300 drop-shadow-md bg-slate-950/95 px-2 py-0.5 rounded-full border border-indigo-400/50 whitespace-nowrap">
                        {radialMenuPlayer.specialStatus === 'lesson' ? '레슨 해제' : '레슨'}
                      </span>
                    </button>
                  </div>

                  {/* 3. 마지막판 (Last Match / 막판) */}
                  <div
                    className="absolute z-10 flex flex-col items-center"
                    style={{ left: '198px', top: '48px', transform: 'translate(-50%, -50%)' }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetPlayerSpecialStatus?.(radialMenuPlayer.id, 'last_match');
                        soundEffects.playWhistle();
                        setRadialMenuPlayer(null);
                      }}
                      className="flex flex-col items-center gap-1 group/btn cursor-pointer transition-all transform rotate-6 hover:scale-110 active:scale-95"
                    >
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-br from-rose-500 via-rose-600 to-red-600 border-2 border-rose-200 text-white flex items-center justify-center shadow-xl shadow-rose-500/50 group-hover/btn:ring-4 group-hover/btn:ring-rose-400/50 animate-pulse ${
                          radialMenuPlayer.specialStatus === 'last_match' && !isPlayerLastMatchCompleted(radialMenuPlayer)
                            ? 'ring-4 ring-rose-300'
                            : ''
                        }`}
                      >
                        <Flag className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <span className="text-[11px] font-black text-rose-300 drop-shadow-md bg-slate-950/95 px-2 py-0.5 rounded-full border border-rose-400/50 whitespace-nowrap">
                        {radialMenuPlayer.specialStatus === 'last_match' && !isPlayerLastMatchCompleted(radialMenuPlayer)
                          ? '막판 해제'
                          : '마지막판'}
                      </span>
                    </button>
                  </div>

                  {/* 4. 퇴장 (Exit / 퇴장!) */}
                  <div
                    className="absolute z-10 flex flex-col items-center"
                    style={{ left: '268px', top: '94px', transform: 'translate(-50%, -50%)' }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetPlayerSpecialStatus?.(radialMenuPlayer.id, 'exited');
                        soundEffects.playWhistle();
                        setRadialMenuPlayer(null);
                      }}
                      className="flex flex-col items-center gap-1 group/btn cursor-pointer transition-all transform rotate-18 hover:scale-110 active:scale-95"
                    >
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800 border-2 border-slate-300 text-slate-100 flex items-center justify-center shadow-[0_0_16px_rgba(148,163,184,0.55)] group-hover/btn:ring-4 group-hover/btn:ring-slate-300/50 ${
                          isPlayerLastMatchCompleted(radialMenuPlayer) ? 'ring-4 ring-slate-200' : ''
                        }`}
                      >
                        <DoorOpen className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <span className="text-[11px] font-black text-slate-200 drop-shadow-md bg-slate-950/95 px-2 py-0.5 rounded-full border border-slate-400/70 whitespace-nowrap shadow-[0_0_8px_rgba(148,163,184,0.35)]">
                        {isPlayerLastMatchCompleted(radialMenuPlayer) ? '퇴장 해제' : '퇴장'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Base Anchor: Player Name Badge & Close Button */}
                <div className="relative z-20 -mt-2 flex items-center gap-1.5">
                  <div className="px-3.5 py-1 rounded-full bg-slate-900/95 border border-slate-700/80 text-xs font-bold text-slate-200 shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                    <span className={radialMenuPlayer.gender === 'M' ? 'text-blue-400 font-extrabold' : 'text-pink-400 font-extrabold'}>
                      {radialMenuPlayer.name}
                    </span>
                    <span className="text-slate-400 text-[11px] font-normal">선수</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRadialMenuPlayer(null);
                    }}
                    className="w-7 h-7 rounded-full bg-slate-800/95 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center border border-slate-700 shadow-md cursor-pointer transition-transform hover:scale-110 active:scale-95"
                    title="닫기"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* STATUS CANCEL CONFIRMATION MODAL ("휴식을 끝내겠습니까?" / "레슨을 끝내겠습니까?" / "마지막판 설정을 해제하겠습니까?" / "퇴장 상태를 해제하겠습니까?") */}
      {statusConfirmPlayer && (() => {
        const isLastDone = isPlayerLastMatchCompleted(statusConfirmPlayer);
        const isLastActive = statusConfirmPlayer.specialStatus === 'last_match' && !isLastDone;
        const isAlreadyInMatch =
          activeMatches.some(
            (m) =>
              m.teamA.player1Id === statusConfirmPlayer.id ||
              m.teamA.player2Id === statusConfirmPlayer.id ||
              m.teamB.player1Id === statusConfirmPlayer.id ||
              m.teamB.player2Id === statusConfirmPlayer.id
          ) ||
          queuedMatches.some(
            (m) =>
              m.teamA.player1Id === statusConfirmPlayer.id ||
              m.teamA.player2Id === statusConfirmPlayer.id ||
              m.teamB.player1Id === statusConfirmPlayer.id ||
              m.teamB.player2Id === statusConfirmPlayer.id
          );

        return (
          <div data-court-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    statusConfirmPlayer.specialStatus === 'resting'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : statusConfirmPlayer.specialStatus === 'lesson'
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                      : isLastDone
                      ? 'bg-slate-800 text-slate-300 border border-slate-500 shadow-[0_0_10px_rgba(148,163,184,0.35)]'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  }`}
                >
                  {statusConfirmPlayer.specialStatus === 'resting' ? (
                    <Coffee className="w-5 h-5" />
                  ) : statusConfirmPlayer.specialStatus === 'lesson' ? (
                    <GraduationCap className="w-5 h-5" />
                  ) : isLastDone ? (
                    <DoorOpen className="w-5 h-5 text-slate-200" />
                  ) : (
                    <Flag className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {statusConfirmPlayer.specialStatus === 'resting'
                      ? '휴식 상태 해제'
                      : statusConfirmPlayer.specialStatus === 'lesson'
                      ? '레슨 상태 해제'
                      : isLastDone
                      ? '퇴장 상태 해제'
                      : '마지막판 상태 해제'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {statusConfirmPlayer.name} 선수 ({TIER_LABELS[statusConfirmPlayer.tier]?.short || statusConfirmPlayer.tier})
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <p className="text-sm font-black text-white">
                  {statusConfirmPlayer.specialStatus === 'resting'
                    ? '휴식을 끝내겠습니까?'
                    : statusConfirmPlayer.specialStatus === 'lesson'
                    ? '레슨을 끝내겠습니까?'
                    : isLastDone
                    ? '퇴장 상태를 해제하겠습니까?'
                    : '마지막판 설정을 해제하겠습니까?'}
                </p>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {statusConfirmPlayer.specialStatus === 'lesson'
                    ? '확인 시 일반 대기 상태로 복귀하며, 오프셋 페널티나 연속 경기 제한 없이 다음 게임에 최우선 배정됩니다.'
                    : '확인 시 일반 대기 상태로 복귀하여 다음 코트 및 대기열 배정이 정상적으로 가능해집니다.'}
                </p>
              </div>

              {isLastActive && !isAlreadyInMatch && (
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playRacketHit();
                    onToggleSelectBenchPlayer(statusConfirmPlayer.id);
                    setStatusConfirmPlayer(null);
                  }}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 transition-colors cursor-pointer"
                >
                  {selectedBenchPlayerIds.includes(statusConfirmPlayer.id)
                    ? '코트/대기열 배정 선택 해제하기'
                    : '마지막판 유지한 채 배정/교체 선수로 선택하기'}
                </button>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setStatusConfirmPlayer(null)}
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSetPlayerSpecialStatus?.(statusConfirmPlayer.id, null);
                    soundEffects.playWhistle();
                    setStatusConfirmPlayer(null);
                  }}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                    statusConfirmPlayer.specialStatus === 'resting'
                      ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-500/25'
                      : statusConfirmPlayer.specialStatus === 'lesson'
                      ? 'bg-indigo-400 hover:bg-indigo-300 text-white shadow-indigo-500/25'
                      : isLastDone
                      ? 'bg-slate-600 hover:bg-slate-500 text-white shadow-slate-700/25'
                      : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25'
                  }`}
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

