import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CourtMatch,
  Player,
  TIER_LABELS,
  CourtInfo,
  ConeItem,
  MatchOptions,
  isPlayerLastMatchCompleted,
  extractCourtNumberLabel,
  formatCourtName,
  formatPlayerDisplayName,
  getNormalizedTurnQueue,
  advanceConeTurnQueue,
  formatConeTurnSequence,
} from '../types';
import { soundEffects } from '../utils/audio';
import {
  getPlayerWaitingMinutes,
  computeEffectiveAssignedMap,
  isLateRegisteredPlayer,
  getPlayerRegistrationTime,
} from '../utils/matchmaker';
import {
  Sparkles,
  Play,
  Trash2,
  Clock,
  Layers,
  ExternalLink,
  CheckCircle,
  ArrowLeftRight,
  X,
  Coffee,
  GraduationCap,
  Flag,
  Check,
  Users,
  GripVertical,
  DoorOpen,
  Search,
  AlertTriangle,
  Scale,
  Shuffle,
  Users2,
  SlidersHorizontal,
  RotateCw,
} from 'lucide-react';
import { PartnerDot } from './PartnerDot';
import { DragScrollContainer } from './DragScrollContainer';
import { ConeIcon } from './ConeIcon';

interface GameListViewProps {
  queuedMatches: CourtMatch[];
  activeMatches: CourtMatch[];
  completedMatches: CourtMatch[];
  playersMap: Map<string, Player>;
  courts?: CourtInfo[];
  activeCourtCount: number;
  restingPlayers?: Player[];
  allPlayers?: Player[];
  options?: MatchOptions;
  onOpenGenerateModal?: () => void;
  onPreGenerateQuick: (count: number) => void;
  onGenerateByArrivalOrder?: () => void;
  onGenerateSpecificQueueMatch?: (type: 'MD' | 'WD' | 'XD') => void;
  onSendToCourt: (
    matchId: string,
    courtNumber: number
  ) => 'assigned' | 'failed_other_club' | 'failed_duplicate_player' | 'invalid' | void;
  onDeleteQueuedMatch: (matchId: string) => void;
  onMoveQueueOrder?: (index: number, direction: 'up' | 'down') => void;
  onUpdateQueuedMatches?: (matches: CourtMatch[]) => void;
  onGoToCourtsTab: () => void;
  onClearAllQueue: () => void;
  onSwapPlayersBetweenMatches?: (
    activeMatchId: string,
    activePlayerId: string,
    queuedMatchId: string,
    queuedPlayerId: string
  ) => void;
  onSwapQueuedAndBench?: (
    queuedMatchId: string,
    queuedPlayerId: string,
    benchPlayerId: string
  ) => void;
  onSwapQueuedPlayers?: (
    matchId1: string,
    playerId1: string,
    matchId2: string,
    playerId2: string
  ) => void;
  onGenerateQueueWithSelected?: (selectedPlayerIds: string[]) => void;
  onSetPlayerSpecialStatus?: (playerId: string, status: 'resting' | 'lesson' | 'last_match' | 'exited' | null) => void;
  onAdvanceCourtCone?: (courtNumber: number) => ConeItem | null;
  conflictPlayerIds?: string[];
  conflictMatchPlayers?: Record<string, string[]>;
  conflictMatchTargetCourts?: Record<string, number>;
  onClearConflictHighlight?: (matchId?: string) => void;
  onSwapActiveCourtPlayer?: (
    playerId: string,
    matchId?: string,
    team?: 'teamA' | 'teamB',
    slot?: 1 | 2
  ) => void;
  onSwapActiveAndBench?: (
    activeMatchId: string,
    activePlayerId: string,
    benchPlayerId: string
  ) => void;
  onSwapActivePlayers?: (
    matchId1: string,
    playerId1: string,
    matchId2: string,
    playerId2: string
  ) => void;
  swapSelection?: {
    matchId: string;
    playerId: string;
    type: 'active' | 'queued' | 'bench';
    team?: 'teamA' | 'teamB';
    slot?: 1 | 2;
  } | null;
  onSwapSelectionChange?: React.Dispatch<
    React.SetStateAction<{
      matchId: string;
      playerId: string;
      type: 'active' | 'queued' | 'bench';
      team?: 'teamA' | 'teamB';
      slot?: 1 | 2;
    } | null>
  >;
}

export const GameListView: React.FC<GameListViewProps> = ({
  queuedMatches,
  activeMatches,
  completedMatches,
  playersMap,
  courts = [],
  activeCourtCount,
  restingPlayers = [],
  allPlayers = [],
  options,
  onOpenGenerateModal,
  onPreGenerateQuick,
  onGenerateByArrivalOrder,
  onGenerateSpecificQueueMatch,
  onSendToCourt,
  onDeleteQueuedMatch,
  onMoveQueueOrder,
  onUpdateQueuedMatches,
  onGoToCourtsTab,
  onClearAllQueue,
  onSwapPlayersBetweenMatches,
  onSwapQueuedAndBench,
  onSwapQueuedPlayers,
  onGenerateQueueWithSelected,
  onSetPlayerSpecialStatus,
  onAdvanceCourtCone,
  conflictPlayerIds = [],
  conflictMatchPlayers,
  conflictMatchTargetCourts,
  onClearConflictHighlight,
  onSwapActiveAndBench,
  onSwapActivePlayers,
  swapSelection: externalSwapSelection,
  onSwapSelectionChange,
}) => {
  const [now, setNow] = useState(Date.now());
  const [activeAssignCourtNumber, setActiveAssignCourtNumber] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const getPlayer = (id: string) => playersMap.get(id);

  // Check if any player in a queued match is currently playing on ANOTHER court (courtNumber !== targetCourtNumber)
  const hasDuplicatePlayerOnOtherCourt = (match: CourtMatch, targetCourtNumber: number): boolean => {
    const cNum = Number(targetCourtNumber);
    const matchPlayerIds = [
      match.teamA.player1Id,
      match.teamA.player2Id,
      match.teamB.player1Id,
      match.teamB.player2Id,
    ].filter(Boolean);

    return activeMatches.some(
      (m) =>
        Number(m.courtNumber) !== cNum &&
        m.status !== 'completed' &&
        [m.teamA.player1Id, m.teamA.player2Id, m.teamB.player1Id, m.teamB.player2Id].some((pid) =>
          matchPlayerIds.includes(pid)
        )
    );
  };

  // Radial / Fan-shaped Menu State for Participant List (참가자 명단 길게 누르기 부채꼴 메뉴)
  const [radialMenuPlayer, setRadialMenuPlayer] = useState<Player | null>(null);
  const [radialMenuPos, setRadialMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [statusConfirmPlayer, setStatusConfirmPlayer] = useState<Player | null>(null);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressTriggeredRef = useRef<boolean>(false);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

  // Queued Match Drag and Drop Reordering (대기 경기 드래그 순서 변경)
  const [draggedMatchId, setDraggedMatchId] = useState<string | null>(null);
  const [dragOverMatchId, setDragOverMatchId] = useState<string | null>(null);

  // Player Search in Queue (대기열 선수 검색)
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');

  const cleanQuery = playerSearchQuery.trim().toLowerCase();
  const matchedQueuedPlayerCount = useMemo(() => {
    if (!cleanQuery) return 0;
    let count = 0;
    queuedMatches.forEach((m) => {
      [m.teamA.player1Id, m.teamA.player2Id, m.teamB.player1Id, m.teamB.player2Id].forEach((id) => {
        const p = getPlayer(id);
        if (p) {
          const tierMeta = TIER_LABELS[p.tier] || TIER_LABELS.Beginner;
          if (
            p.name.toLowerCase().includes(cleanQuery) ||
            tierMeta.label.toLowerCase().includes(cleanQuery) ||
            tierMeta.short.toLowerCase().includes(cleanQuery)
          ) {
            count++;
          }
        }
      });
    });
    return count;
  }, [cleanQuery, queuedMatches, playersMap]);

  // Match card reordering drag handle & mobile long-touch state (PC 드래그 및 모바일 핸들/길게터치 드래그 순서 변경 지원)
  const [dragHandleActiveMatchId, setDragHandleActiveMatchId] = useState<string | null>(null);
  const queuedMatchCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queuedMatchesRef = useRef(queuedMatches);
  queuedMatchesRef.current = queuedMatches;
  const onUpdateQueuedMatchesRef = useRef(onUpdateQueuedMatches);
  onUpdateQueuedMatchesRef.current = onUpdateQueuedMatches;

  const matchTouchPendingIdRef = useRef<string | null>(null);
  const matchTouchFromHandleRef = useRef<boolean>(false);
  const matchTouchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const matchTouchLongPressTimerRef = useRef<number | null>(null);
  const matchTouchDragActiveIdRef = useRef<string | null>(null);
  const matchTouchDragOverIdRef = useRef<string | null>(null);
  const matchLastLiveSwapTimeRef = useRef<number>(0);
  const didMatchTouchReorderRef = useRef<boolean>(false);
  const suppressMatchClickAfterDragRef = useRef<boolean>(false);

  const findQueuedMatchCardIdAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const directCard = el?.closest('[data-queued-match-id]') as HTMLElement | null;
    if (directCard) {
      const id = directCard.getAttribute('data-queued-match-id');
      if (id) return id;
    }
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [id, cardEl] of Object.entries(queuedMatchCardRefs.current)) {
      if (!cardEl) continue;
      const rect = cardEl.getBoundingClientRect();
      if (
        clientX >= rect.left - 16 &&
        clientX <= rect.right + 16 &&
        clientY >= rect.top - 16 &&
        clientY <= rect.bottom + 16
      ) {
        const cy = (rect.top + rect.bottom) / 2;
        const d = Math.abs(clientY - cy);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
    }
    return bestId;
  }, []);

  const executeQueuedMatchReorder = useCallback((sourceId: string, targetId: string): boolean => {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const currentList = queuedMatchesRef.current;
    const sourceIndex = currentList.findIndex((m) => m.id === sourceId);
    const targetIndex = currentList.findIndex((m) => m.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;

    const updated = [...currentList];
    const [movedMatch] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, movedMatch);
    queuedMatchesRef.current = updated;
    if (onUpdateQueuedMatchesRef.current) {
      onUpdateQueuedMatchesRef.current(updated);
    }
    return true;
  }, []);

  const activateMatchTouchOrLongPressDrag = useCallback((matchId: string) => {
    if (matchTouchLongPressTimerRef.current) {
      window.clearTimeout(matchTouchLongPressTimerRef.current);
      matchTouchLongPressTimerRef.current = null;
    }
    matchTouchPendingIdRef.current = null;
    matchTouchDragActiveIdRef.current = matchId;
    matchTouchDragOverIdRef.current = matchId;
    didMatchTouchReorderRef.current = false;
    suppressMatchClickAfterDragRef.current = true;
    document.body.dataset.cardReorderDragging = 'true';
    setDragHandleActiveMatchId(matchId);
    setDraggedMatchId(matchId);
    setDragOverMatchId(matchId);
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
    soundEffects.playRacketHit();
  }, []);

  const handleMatchTouchStart = (
    e: React.TouchEvent<HTMLDivElement>,
    matchId: string,
    fromHandle: boolean
  ) => {
    if (editingMatchRankId) return;
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (!fromHandle && target.closest('input, select')) return;

    const touch = e.touches[0];
    matchTouchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (matchTouchLongPressTimerRef.current) {
      window.clearTimeout(matchTouchLongPressTimerRef.current);
      matchTouchLongPressTimerRef.current = null;
    }

    if (fromHandle) {
      activateMatchTouchOrLongPressDrag(matchId);
      return;
    }

    matchTouchPendingIdRef.current = matchId;
    matchTouchFromHandleRef.current = false;
    matchTouchLongPressTimerRef.current = window.setTimeout(() => {
      if (matchTouchPendingIdRef.current === matchId) {
        activateMatchTouchOrLongPressDrag(matchId);
      }
    }, 220);
  };

  const handleMatchMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    matchId: string,
    fromHandle: boolean
  ) => {
    if (e.button !== 0 || editingMatchRankId) return;
    const target = e.target as HTMLElement;
    if (!fromHandle && target.closest('input, select')) return;

    if (fromHandle) {
      setDragHandleActiveMatchId(matchId);
    }
    matchTouchPendingIdRef.current = matchId;
    matchTouchFromHandleRef.current = fromHandle;
    matchTouchStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (matchTouchLongPressTimerRef.current) {
      window.clearTimeout(matchTouchLongPressTimerRef.current);
      matchTouchLongPressTimerRef.current = null;
    }
    if (!fromHandle) {
      matchTouchLongPressTimerRef.current = window.setTimeout(() => {
        if (matchTouchPendingIdRef.current === matchId) {
          activateMatchTouchOrLongPressDrag(matchId);
        }
      }, 220);
    }
  };

  useEffect(() => {
    const handleMatchPointerMoveCoord = (
      clientX: number,
      clientY: number,
      preventDefaultFn?: () => void
    ) => {
      if (matchTouchDragActiveIdRef.current) {
        if (preventDefaultFn) preventDefaultFn();

        if (clientY < 85) {
          window.scrollBy(0, -10);
        } else if (clientY > window.innerHeight - 85) {
          window.scrollBy(0, 10);
        }

        const activeId = matchTouchDragActiveIdRef.current;
        const targetId = findQueuedMatchCardIdAtPoint(clientX, clientY);
        if (targetId) {
          if (targetId !== activeId && Date.now() - matchLastLiveSwapTimeRef.current > 110) {
            if (executeQueuedMatchReorder(activeId, targetId)) {
              matchLastLiveSwapTimeRef.current = Date.now();
              didMatchTouchReorderRef.current = true;
              matchTouchDragOverIdRef.current = activeId;
              setDragOverMatchId(activeId);
            } else {
              matchTouchDragOverIdRef.current = targetId;
              setDragOverMatchId(targetId);
            }
          } else if (targetId === activeId) {
            matchTouchDragOverIdRef.current = activeId;
            setDragOverMatchId(activeId);
          }
        }
        return;
      }

      if (matchTouchPendingIdRef.current) {
        const dist = Math.hypot(
          clientX - matchTouchStartPosRef.current.x,
          clientY - matchTouchStartPosRef.current.y
        );
        if (matchTouchFromHandleRef.current && dist > 3) {
          if (preventDefaultFn) preventDefaultFn();
          activateMatchTouchOrLongPressDrag(matchTouchPendingIdRef.current);
        } else if (!matchTouchFromHandleRef.current && dist > 16) {
          if (matchTouchLongPressTimerRef.current) {
            window.clearTimeout(matchTouchLongPressTimerRef.current);
            matchTouchLongPressTimerRef.current = null;
          }
          matchTouchPendingIdRef.current = null;
        }
      }
    };

    const finishMatchTouchOrPointerDrag = () => {
      if (matchTouchLongPressTimerRef.current) {
        window.clearTimeout(matchTouchLongPressTimerRef.current);
        matchTouchLongPressTimerRef.current = null;
      }
      matchTouchPendingIdRef.current = null;

      if (matchTouchDragActiveIdRef.current) {
        const srcId = matchTouchDragActiveIdRef.current;
        const tgtId = matchTouchDragOverIdRef.current;
        if (!didMatchTouchReorderRef.current && srcId && tgtId && srcId !== tgtId) {
          if (executeQueuedMatchReorder(srcId, tgtId)) {
            didMatchTouchReorderRef.current = true;
          }
        }
        if (didMatchTouchReorderRef.current) {
          soundEffects.playRacketHit();
        }
        matchTouchDragActiveIdRef.current = null;
        matchTouchDragOverIdRef.current = null;
        delete document.body.dataset.cardReorderDragging;
        setDraggedMatchId(null);
        setDragOverMatchId(null);
        setDragHandleActiveMatchId(null);
        window.setTimeout(() => {
          suppressMatchClickAfterDragRef.current = false;
        }, 320);
      }
    };

    const onWindowTouchMove = (e: TouchEvent) => {
      if (!matchTouchDragActiveIdRef.current && !matchTouchPendingIdRef.current) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleMatchPointerMoveCoord(touch.clientX, touch.clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!matchTouchDragActiveIdRef.current && !matchTouchPendingIdRef.current) return;
      handleMatchPointerMoveCoord(e.clientX, e.clientY, () => {
        e.preventDefault();
      });
    };

    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', finishMatchTouchOrPointerDrag);
    window.addEventListener('touchcancel', finishMatchTouchOrPointerDrag);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', finishMatchTouchOrPointerDrag);

    return () => {
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', finishMatchTouchOrPointerDrag);
      window.removeEventListener('touchcancel', finishMatchTouchOrPointerDrag);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', finishMatchTouchOrPointerDrag);
    };
  }, [
    activateMatchTouchOrLongPressDrag,
    executeQueuedMatchReorder,
    findQueuedMatchCardIdAtPoint,
  ]);

  const handleMatchDragStart = (e: React.DragEvent<HTMLDivElement>, matchId: string) => {
    if (matchTouchDragActiveIdRef.current) {
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-card-drag]') || dragHandleActiveMatchId !== matchId) {
      e.preventDefault();
      return;
    }
    if (matchTouchLongPressTimerRef.current) {
      window.clearTimeout(matchTouchLongPressTimerRef.current);
      matchTouchLongPressTimerRef.current = null;
    }
    matchTouchPendingIdRef.current = null;
    e.dataTransfer.setData('text/plain', matchId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedMatchId(matchId);
  };

  const handleMatchDragOver = (e: React.DragEvent<HTMLDivElement>, matchId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverMatchId !== matchId) {
      setDragOverMatchId(matchId);
    }
  };

  const handleMatchDrop = (e: React.DragEvent<HTMLDivElement>, targetMatchId: string) => {
    e.preventDefault();
    const sourceMatchId = draggedMatchId || e.dataTransfer.getData('text/plain');
    if (!sourceMatchId || sourceMatchId === targetMatchId) {
      setDraggedMatchId(null);
      setDragOverMatchId(null);
      setDragHandleActiveMatchId(null);
      return;
    }

    if (executeQueuedMatchReorder(sourceMatchId, targetMatchId)) {
      soundEffects.playRacketHit();
    }

    setDraggedMatchId(null);
    setDragOverMatchId(null);
    setDragHandleActiveMatchId(null);
  };

  const handleMatchDragEnd = () => {
    setDraggedMatchId(null);
    setDragOverMatchId(null);
    setDragHandleActiveMatchId(null);
  };

  // Notification state for alerts and Cone Movement (꼬깔 이동 알림 - 확인 버튼만 제공)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastPlayerNames, setToastPlayerNames] = useState<string[] | null>(null);
  const showToast = (message: string, playerNames?: string[]) => {
    setToastMessage(message);
    setToastPlayerNames(playerNames && playerNames.length > 0 ? playerNames : null);
  };

  const [coneMoveToast, setConeMoveToast] = useState<{
    courtNumber: number;
    courtLabel: string;
    cones: ConeItem[];
    nextIndex: number;
    isOurTurn: boolean;
  } | null>(null);
  const showConeMoveNotification = (
    courtNumber: number,
    courtLabel: string,
    cones: ConeItem[],
    nextIndex: number,
    isOurTurn: boolean
  ) => {
    setConeMoveToast({ courtNumber, courtLabel, cones, nextIndex, isOurTurn });
  };

  // Match Rank / Sequence Number Direct Editing (대기 순서 번호 직접 변경)
  const [editingMatchRankId, setEditingMatchRankId] = useState<string | null>(null);
  const [tempMatchRankValue, setTempMatchRankValue] = useState<string>('');

  // Local conflict target courts state when duplicate player warning occurs
  const [localConflictTargetCourts, setLocalConflictTargetCourts] = useState<Record<string, number>>({});

  useEffect(() => {
    setLocalConflictTargetCourts((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      const next: Record<string, number> = {};
      let changed = false;
      for (const [mId, targetCourt] of entries) {
        const qMatch = queuedMatches.find((m) => m.id === mId);
        const hasOtherActiveCourt = activeMatches.some(
          (am) => am.status !== 'completed' && Number(am.courtNumber) !== Number(targetCourt)
        );
        const stillHasDuplicate = qMatch
          ? hasDuplicatePlayerOnOtherCourt(qMatch, targetCourt)
          : false;
        if (qMatch && hasOtherActiveCourt && stillHasDuplicate) {
          next[mId] = targetCourt;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [queuedMatches, activeMatches]);

  const mergedConflictMatchTargetCourts = useMemo(() => {
    return { ...conflictMatchTargetCourts, ...localConflictTargetCourts };
  }, [conflictMatchTargetCourts, localConflictTargetCourts]);

  // Warning alert modal state with [확인] button (배정 실패: 우리클럽 꼬깔이 아닙니다 / 타코트에 동일한 선수가 운동중 입니다)
  const [warningAlertModal, setWarningAlertModal] = useState<{
    title: string;
    message: string;
    courtNumber?: number;
  } | null>(null);

  // Confirmation modal state when clicking an occupied our club (red cone) n코트 button in queue ([확인] / [취소] 알림)
  const [confirmCompleteAndAssignModal, setConfirmCompleteAndAssignModal] = useState<{
    courtNumber: number;
    courtLabel: string;
    currentPlayersNames: string;
  } | null>(null);

  // Clean up activeAssignCourtNumber if court is removed or its active cone becomes gray (other club)
  useEffect(() => {
    if (activeAssignCourtNumber === null) return;
    const target = (courts || []).find(
      (c) => Number(c.courtNumber) === Number(activeAssignCourtNumber)
    );
    if (!target) {
      setActiveAssignCourtNumber(null);
      return;
    }
    const cones = getNormalizedTurnQueue(target.cones || [], target.currentConeIndex || 0);
    if (cones[0]?.color === 'gray') {
      setActiveAssignCourtNumber(null);
    }
  }, [activeAssignCourtNumber, courts]);

  const [localSwapSelection, setLocalSwapSelection] = useState<{
    matchId: string;
    playerId: string;
    type: 'active' | 'queued' | 'bench';
    team?: 'teamA' | 'teamB';
    slot?: 1 | 2;
  } | null>(null);

  const swapSelection =
    externalSwapSelection !== undefined ? externalSwapSelection : localSwapSelection;
  const setSwapSelection = onSwapSelectionChange || setLocalSwapSelection;

  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);

  const suppressClickAfterConflictCancelRef = useRef<boolean>(false);

  // n코트 버튼 외의 다른 영역 클릭(터치) 시 코트 배정 선택 해제 (대기열 경기 카드 클릭 시에는 배정 실행 유지)
  useEffect(() => {
    if (activeAssignCourtNumber === null) return;

    const handleOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // n코트 버튼 자체 클릭/터치는 handleCourtButtonClick에서 처리
      if (target.closest('[data-court-assign-btn="true"]')) return;

      // 코트 관련 알림/확인 모달 내부 클릭/터치는 모달 핸들러에서 처리
      if (target.closest('[data-court-modal="true"]')) return;

      // 대기열 경기 카드 클릭/터치 시에는 해당 경기를 코트에 배정해야 하므로 유지 (단, 삭제 버튼 클릭 시에는 취소)
      if (
        target.closest('[data-queued-match-id]') &&
        !target.closest('[data-queued-delete-btn="true"]')
      ) {
        return;
      }

      setActiveAssignCourtNumber(null);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
    };
  }, [activeAssignCourtNumber]);

  // 타 코트 중복 선수 표시 중일 때 투입취소 버튼 외의 다른 영역 클릭(터치) 시에도 취소 처리
  // (단, 경고 모달 확인 버튼 클릭, 중복 선수 직접 클릭하여 교체, 또는 코트 현황 탭 이동 시에는 유지)
  const hasActiveConflictDisplay =
    Object.keys(mergedConflictMatchTargetCourts).length > 0 ||
    Boolean(conflictMatchPlayers && Object.keys(conflictMatchPlayers).length > 0);

  useEffect(() => {
    if (!hasActiveConflictDisplay || warningAlertModal !== null) return;

    const handleConflictOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 모달 내부 클릭/터치는 무시
      if (target.closest('[data-court-modal="true"]')) return;

      // n코트 버튼 클릭/터치는 handleCourtButtonClick에서 처리
      if (target.closest('[data-court-assign-btn="true"]')) return;

      // 코트 현황 탭 / 코트 현황으로 이동 버튼 클릭 시에는 코트 현황에서도 중복 선수를 확인/교체할 수 있도록 유지
      if (target.closest('[data-keep-conflict-nav="true"]')) return;

      // 중복 배정된 선수(주황색 테두리 발광)를 클릭/터치하여 교체하려는 경우 유지
      if (target.closest('[data-conflict-duplicate-player="true"]')) return;

      // 이미 교체할 선수가 선택된 상태에서 교체 대상 선수를 클릭/터치하는 경우 유지
      if (
        (swapSelection !== null || selectedParticipantIds.length === 1) &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        return;
      }

      // 만약 일반 선수 카드/버튼 영역을 터치하여 중복 표시를 취소하는 경우, 의도치 않게 해당 선수가 선택되지 않도록 클릭 이벤트 소비
      if (
        !target.closest('[data-conflict-cancel-btn="true"]') &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        suppressClickAfterConflictCancelRef.current = true;
      }

      setActiveAssignCourtNumber(null);
      setLocalConflictTargetCourts({});
      onClearConflictHighlight?.();
    };

    const handleCaptureClick = (e: MouseEvent) => {
      if (suppressClickAfterConflictCancelRef.current) {
        suppressClickAfterConflictCancelRef.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    };

    document.addEventListener('pointerdown', handleConflictOutsidePointerDown);
    document.addEventListener('click', handleCaptureClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleConflictOutsidePointerDown);
      document.removeEventListener('click', handleCaptureClick, true);
    };
  }, [
    hasActiveConflictDisplay,
    warningAlertModal,
    swapSelection,
    selectedParticipantIds.length,
    onClearConflictHighlight,
  ]);

  const suppressClickAfterParticipantCancelRef = useRef<boolean>(false);

  // 참가자 명단에서 선수를 1명 이상 선택(터치)했을 때 대기열 생성 버튼 및 선수 선택/교체 외의 다른 곳을 클릭(터치)하면 선택 해제 처리
  useEffect(() => {
    if (selectedParticipantIds.length === 0) return;

    const handleParticipantOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 모달 내부 클릭/터치는 모달에서 처리
      if (target.closest('[data-court-modal="true"]')) return;

      // '선택한 n명으로 대기열 생성' 버튼 클릭/터치 시에는 대기열 생성 실행 유지
      if (target.closest('[data-participant-generate-btn="true"]')) return;

      // 참가자 명단의 선수 카드 클릭/터치 시에는 선수 추가 선택 또는 선택 해제 토글 유지
      if (target.closest('[data-participant-card="true"]')) return;

      // 참가자 1명 선택 상태에서 대기열/코트 현황 선수를 클릭/터치하는 경우 1:1 맞교체 실행 유지
      if (
        selectedParticipantIds.length === 1 &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        return;
      }

      // 2명 이상 선택 상태에서 대기열/코트 선수를 클릭/터치하여 선택을 해제할 때 해당 선수가 교체 선택되지 않도록 클릭 소비
      if (target.closest('[data-player-swap-item="true"]')) {
        suppressClickAfterParticipantCancelRef.current = true;
      }

      setSelectedParticipantIds([]);
      if (hasActiveConflictDisplay) {
        setLocalConflictTargetCourts({});
        onClearConflictHighlight?.();
      }
    };

    const handleParticipantOutsideClick = (e: MouseEvent) => {
      if (suppressClickAfterParticipantCancelRef.current) {
        suppressClickAfterParticipantCancelRef.current = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-court-modal="true"]')) return;
      if (target.closest('[data-participant-generate-btn="true"]')) return;
      if (target.closest('[data-participant-card="true"]')) return;
      if (
        selectedParticipantIds.length === 1 &&
        target.closest('[data-player-swap-item="true"]')
      ) {
        return;
      }

      setSelectedParticipantIds([]);
      if (hasActiveConflictDisplay) {
        setLocalConflictTargetCourts({});
        onClearConflictHighlight?.();
      }
    };

    document.addEventListener('pointerdown', handleParticipantOutsidePointerDown);
    document.addEventListener('click', handleParticipantOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleParticipantOutsidePointerDown);
      document.removeEventListener('click', handleParticipantOutsideClick, true);
    };
  }, [selectedParticipantIds.length, hasActiveConflictDisplay, onClearConflictHighlight]);

  // n코트 버튼 클릭 핸들러 (코트현황 실시간 동기화 상태 및 꼬깔 상태 연동)
  const handleCourtButtonClick = (c: (typeof courtList)[0]) => {
    const isConflictOnSameCourt =
      hasActiveConflictDisplay &&
      Object.values(mergedConflictMatchTargetCourts).some(
        (tCourt) => Number(tCourt) === Number(c.courtNumber)
      );

    if (activeAssignCourtNumber === c.courtNumber || isConflictOnSameCourt) {
      setActiveAssignCourtNumber(null);
      setLocalConflictTargetCourts({});
      onClearConflictHighlight?.();
      return;
    }

    // 다른 코트에 대한 중복 선수 표시 중일 때 새로운 코트를 선택하면 기존 중복 표시 초기화
    if (hasActiveConflictDisplay) {
      setLocalConflictTargetCourts({});
      onClearConflictHighlight?.();
    }

    // 1. 코트의 꼬깔이 다른클럽의 꼬깔(회색) 일 때 -> 선택(터치) 시 코트현황 코트의 꼬깔이 회전하고 다음 꼬깔이 우리클럽꼬깔(빨강)이면 빈코트(초록) 버튼으로 변경되며 n코트 꼬깔 회전 알림 메세지와 확인 버튼 제공
    if (c.isOtherClub) {
      soundEffects.playWhistle();
      setActiveAssignCourtNumber(null);
      const { cones: rotatedCones, activeCone: nextCone } = advanceConeTurnQueue(c.cones, c.currentConeIndex);
      const isNextOurTurn = nextCone?.color === 'red';
      onAdvanceCourtCone?.(c.courtNumber);

      showConeMoveNotification(c.courtNumber, c.label, rotatedCones, 0, isNextOurTurn);
      return;
    }

    // 2. 코트의 꼬깔이 우리클럽의 꼬깔(빨간색)이고 경기가 진행 중 일 때
    if (c.isOccupied) {
      // 코트현황 코트의 다음 꼬깔이 다른클럽꼬깔(회색) 일 때 -> 현재 경기 완료 후 회색 꼬깔로 회전(n코트 버튼 회색 변경) 및 배정 실패 알림창 출력
      if (c.isNextConeOtherClub) {
        soundEffects.playScorePoint();
        onAdvanceCourtCone?.(c.courtNumber);
        setActiveAssignCourtNumber(null);
        setWarningAlertModal({
          title: '배정 실패',
          message: '우리클럽 꼬깔이 아닙니다',
        });
        return;
      }

      const currentCourtMatch = activeMatches.find(
        (m) => Number(m.courtNumber) === Number(c.courtNumber) && m.status !== 'completed'
      );

      const p1 = currentCourtMatch ? getPlayer(currentCourtMatch.teamA.player1Id) : null;
      const p2 = currentCourtMatch ? getPlayer(currentCourtMatch.teamA.player2Id) : null;
      const p3 = currentCourtMatch ? getPlayer(currentCourtMatch.teamB.player1Id) : null;
      const p4 = currentCourtMatch ? getPlayer(currentCourtMatch.teamB.player2Id) : null;

      const currentPlayersNames = [
        formatPlayerDisplayName(p1),
        formatPlayerDisplayName(p2),
        formatPlayerDisplayName(p3),
        formatPlayerDisplayName(p4),
      ]
        .filter(Boolean)
        .join(' • ');

      soundEffects.playRacketHit();
      setActiveAssignCourtNumber(null);
      setConfirmCompleteAndAssignModal({
        courtNumber: c.courtNumber,
        courtLabel: c.label,
        currentPlayersNames: currentPlayersNames || '진행 중 선수 4명',
      });
      return;
    }

    // 3. 코트가 빈 코트(초록색) 일 때 -> 곧바로 배정 모드 진입
    soundEffects.playRacketHit();
    setActiveAssignCourtNumber(c.courtNumber);
  };

  const handleConfirmCompleteCourtForAssign = useCallback(
    (courtNumber: number) => {
      const nextCone = onAdvanceCourtCone?.(courtNumber);
      if (nextCone && nextCone.color === 'gray') {
        setActiveAssignCourtNumber(null);
        setWarningAlertModal({
          title: '배정 실패',
          message: '우리클럽 꼬깔이 아닙니다',
        });
        return;
      }
      if (queuedMatches.length > 0) {
        setActiveAssignCourtNumber(courtNumber);
      } else {
        setActiveAssignCourtNumber(null);
      }
    },
    [onAdvanceCourtCone, queuedMatches.length]
  );

  const executeAssignMatchToCourt = (matchId: string, courtNumber: number) => {
    const c = courtList.find((item) => Number(item.courtNumber) === Number(courtNumber));
    if (!c) return;

    const match = queuedMatches.find((m) => m.id === matchId);
    if (!match) return;

    // 다른클럽 꼬깔(회색)일 때 투입 금지
    if (c.isOtherClub) {
      soundEffects.playScorePoint();
      setActiveAssignCourtNumber(null);
      setWarningAlertModal({
        title: '배정 실패',
        message: '우리클럽 꼬깔이 아닙니다',
      });
      return;
    }

    // 진행 중 코트인데 다음 꼬깔이 다른클럽(회색)일 때 -> 경기 완료 및 꼬깔 회전(회색 버튼 전환) 후 배정 실패 알림
    if (c.isOccupied && c.isNextConeOtherClub) {
      soundEffects.playScorePoint();
      onSendToCourt(match.id, c.courtNumber);
      setActiveAssignCourtNumber(null);
      setWarningAlertModal({
        title: '배정 실패',
        message: '우리클럽 꼬깔이 아닙니다',
      });
      return;
    }

    // 투입할 때 선택한 대기열에 타 코트 배정자(다른 코트에서 운동 중인 선수)가 있다면 투입 안 되게 차단 및 경고창
    if (hasDuplicatePlayerOnOtherCourt(match, courtNumber)) {
      onSendToCourt(match.id, c.courtNumber);
      setLocalConflictTargetCourts({ [match.id]: c.courtNumber });
      setActiveAssignCourtNumber(null);
      setWarningAlertModal({
        title: '배정 실패',
        message: '타코트에 동일한 선수가 운동중 입니다',
        courtNumber: c.courtNumber,
      });
      return;
    }

    const res = onSendToCourt(match.id, c.courtNumber);
    if (res === 'failed_other_club') {
      setActiveAssignCourtNumber(null);
      setWarningAlertModal({
        title: '배정 실패',
        message: '우리클럽 꼬깔이 아닙니다',
      });
    } else if (res === 'failed_duplicate_player') {
      setLocalConflictTargetCourts({ [match.id]: c.courtNumber });
      setActiveAssignCourtNumber(null);
      setWarningAlertModal({
        title: '배정 실패',
        message: '타코트에 동일한 선수가 운동중 입니다',
        courtNumber: c.courtNumber,
      });
    } else {
      const assignedPlayers = [
        formatPlayerDisplayName(getPlayer(match.teamA.player1Id) || match.playerSnapshots?.[match.teamA.player1Id]),
        formatPlayerDisplayName(getPlayer(match.teamA.player2Id) || match.playerSnapshots?.[match.teamA.player2Id]),
        formatPlayerDisplayName(getPlayer(match.teamB.player1Id) || match.playerSnapshots?.[match.teamB.player1Id]),
        formatPlayerDisplayName(getPlayer(match.teamB.player2Id) || match.playerSnapshots?.[match.teamB.player2Id]),
      ].filter(Boolean);
      showToast(
        `${formatCourtName(extractCourtNumberLabel(c.label, c.courtNumber))}에 대기 경기를 즉시 투입하였습니다!`,
        assignedPlayers
      );
      setActiveAssignCourtNumber(null);
      setLocalConflictTargetCourts({});
      if (onClearConflictHighlight) {
        onClearConflictHighlight();
      }
    }
  };

  useEffect(() => {
    if (!confirmCompleteAndAssignModal && !warningAlertModal && !coneMoveToast && !toastMessage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmCompleteAndAssignModal) setConfirmCompleteAndAssignModal(null);
        if (warningAlertModal) setWarningAlertModal(null);
        if (coneMoveToast) {
          const targetCourtNum =
            coneMoveToast.isOurTurn && queuedMatches.length > 0 ? coneMoveToast.courtNumber : null;
          setConeMoveToast(null);
          if (targetCourtNum !== null) {
            setActiveAssignCourtNumber(targetCourtNum);
          }
        }
        if (toastMessage) {
          setToastMessage(null);
          setToastPlayerNames(null);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (confirmCompleteAndAssignModal) {
          const cNum = confirmCompleteAndAssignModal.courtNumber;
          setConfirmCompleteAndAssignModal(null);
          handleConfirmCompleteCourtForAssign(cNum);
        }
        if (warningAlertModal) setWarningAlertModal(null);
        if (coneMoveToast) {
          const targetCourtNum =
            coneMoveToast.isOurTurn && queuedMatches.length > 0 ? coneMoveToast.courtNumber : null;
          setConeMoveToast(null);
          if (targetCourtNum !== null) {
            setActiveAssignCourtNumber(targetCourtNum);
          }
        }
        if (toastMessage) {
          setToastMessage(null);
          setToastPlayerNames(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    confirmCompleteAndAssignModal,
    warningAlertModal,
    coneMoveToast,
    toastMessage,
    queuedMatches.length,
    handleConfirmCompleteCourtForAssign,
  ]);

  const handleStartEditMatchRank = (matchId: string, currentRank: number) => {
    setEditingMatchRankId(matchId);
    setTempMatchRankValue(String(currentRank));
  };

  const handleCommitMatchRankChange = (matchId: string) => {
    const targetRank = parseInt(tempMatchRankValue, 10);
    setEditingMatchRankId(null);
    if (isNaN(targetRank)) return;

    const sourceIndex = queuedMatches.findIndex((m) => m.id === matchId);
    if (sourceIndex === -1) return;

    const targetIndex = Math.max(0, Math.min(queuedMatches.length - 1, targetRank - 1));
    if (sourceIndex === targetIndex) return;

    const updated = [...queuedMatches];
    const [movedMatch] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, movedMatch);
    if (onUpdateQueuedMatches) {
      onUpdateQueuedMatches(updated);
    }
    soundEffects.playRacketHit();
  };

  // Clean up selectedParticipantIds if a participant was removed or became unavailable
  useEffect(() => {
    const participantList = (allPlayers && allPlayers.length > 0 ? allPlayers : restingPlayers).filter(
      (p) => !p.attendancePending
    );
    const validIds = new Set(
      participantList
        .filter((p) => {
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
        })
        .map((p) => p.id)
    );
    setSelectedParticipantIds((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [allPlayers, restingPlayers, activeMatches, queuedMatches]);

  // Set of player IDs assigned to the same match as the currently selected player
  // 선수가 교체되면 swapSelection이 즉시 해제되어 테두리 없는 주황색이 남지 않으며,
  // 선택 중 같은 배정의 선수가 실시간으로 수정되면 즉시 재계산되어 반영됨
  const sameCourtPlayerIds = useMemo(() => {
    if (!swapSelection || swapSelection.type === 'bench') return new Set<string>();

    const targetMatch =
      swapSelection.type === 'queued'
        ? queuedMatches.find((m) => m.id === swapSelection.matchId)
        : activeMatches.find(
            (m) => m.id === swapSelection.matchId && m.status !== 'completed'
          );

    if (!targetMatch) return new Set<string>();

    return new Set<string>(
      [
        targetMatch.teamA.player1Id,
        targetMatch.teamA.player2Id,
        targetMatch.teamB.player1Id,
        targetMatch.teamB.player2Id,
      ].filter((id): id is string => Boolean(id) && id !== swapSelection.playerId)
    );
  }, [swapSelection, queuedMatches, activeMatches]);

  const handlePlayerClick = (
    matchId: string,
    playerId: string,
    type: 'active' | 'queued' | 'bench',
    team?: 'teamA' | 'teamB',
    slot?: 1 | 2
  ) => {
    // 0. If 1 participant was selected from the bottom participant list, clicking a queued or active player swaps them immediately
    if (!swapSelection && selectedParticipantIds.length === 1 && (type === 'queued' || type === 'active')) {
      const benchPlayerId = selectedParticipantIds[0];
      if (benchPlayerId === playerId) {
        setSelectedParticipantIds([]);
        return;
      }
      if (type === 'queued') {
        const qMatch = queuedMatches.find((m) => m.id === matchId);
        if (qMatch) {
          const otherIds = [
            qMatch.teamA.player1Id,
            qMatch.teamA.player2Id,
            qMatch.teamB.player1Id,
            qMatch.teamB.player2Id,
          ].filter((id) => id !== playerId);

          if (otherIds.includes(benchPlayerId)) {
            showToast('같은 선수가 있습니다');
            return;
          }
        }
        soundEffects.playWhistle();
        onSwapQueuedAndBench?.(matchId, playerId, benchPlayerId);
      } else {
        const aMatch = activeMatches.find((m) => m.id === matchId);
        if (aMatch) {
          const otherIds = [
            aMatch.teamA.player1Id,
            aMatch.teamA.player2Id,
            aMatch.teamB.player1Id,
            aMatch.teamB.player2Id,
          ].filter((id) => id !== playerId);

          if (otherIds.includes(benchPlayerId)) {
            showToast('같은 선수가 있습니다');
            return;
          }
        }
        soundEffects.playWhistle();
        onSwapActiveAndBench?.(matchId, playerId, benchPlayerId);
      }
      setSelectedParticipantIds([]);
      setSwapSelection(null);
      return;
    }

    // 1. If nothing selected, select this player
    if (!swapSelection) {
      soundEffects.playRacketHit();
      if (selectedParticipantIds.length > 0) {
        setSelectedParticipantIds([]);
      }
      setSwapSelection({ matchId, playerId, type, team, slot });
      return;
    }

    // 2. If clicking same player in the same match, cancel selection; if in a different match, switch selection to that match
    if (swapSelection.playerId === playerId) {
      if (swapSelection.matchId === matchId && swapSelection.type === type) {
        setSwapSelection(null);
        if (hasActiveConflictDisplay) {
          setLocalConflictTargetCourts({});
          onClearConflictHighlight?.();
        }
      } else {
        soundEffects.playRacketHit();
        if (selectedParticipantIds.length > 0) {
          setSelectedParticipantIds([]);
        }
        setSwapSelection({ matchId, playerId, type, team, slot });
      }
      return;
    }

    // 3. Queued ↔ Queued swap! (대기열 선수 ↔ 대기열 선수 맞교체 지원)
    if (swapSelection.type === 'queued' && type === 'queued') {
      if (swapSelection.matchId !== matchId) {
        const m1 = queuedMatches.find((m) => m.id === swapSelection.matchId);
        const m2 = queuedMatches.find((m) => m.id === matchId);
        if (m1 && m2) {
          const m1OtherIds = [
            m1.teamA.player1Id,
            m1.teamA.player2Id,
            m1.teamB.player1Id,
            m1.teamB.player2Id,
          ].filter((id) => id !== swapSelection.playerId);
          const m2OtherIds = [
            m2.teamA.player1Id,
            m2.teamA.player2Id,
            m2.teamB.player1Id,
            m2.teamB.player2Id,
          ].filter((id) => id !== playerId);

          if (m1OtherIds.includes(playerId) || m2OtherIds.includes(swapSelection.playerId)) {
            showToast('같은 선수가 있습니다');
            return;
          }
        }
      }

      soundEffects.playWhistle();
      onSwapQueuedPlayers?.(
        swapSelection.matchId,
        swapSelection.playerId,
        matchId,
        playerId
      );
      setSwapSelection(null);
      setSelectedParticipantIds([]);
      return;
    }

    // 3b. Active ↔ Active swap! (진행 중인 코트 선수 ↔ 진행 중인 코트 선수 맞교체 지원)
    if (swapSelection.type === 'active' && type === 'active') {
      if (swapSelection.matchId !== matchId) {
        const m1 = activeMatches.find((m) => m.id === swapSelection.matchId);
        const m2 = activeMatches.find((m) => m.id === matchId);
        if (m1 && m2) {
          const m1OtherIds = [
            m1.teamA.player1Id,
            m1.teamA.player2Id,
            m1.teamB.player1Id,
            m1.teamB.player2Id,
          ].filter((id) => id !== swapSelection.playerId);
          const m2OtherIds = [
            m2.teamA.player1Id,
            m2.teamA.player2Id,
            m2.teamB.player1Id,
            m2.teamB.player2Id,
          ].filter((id) => id !== playerId);

          if (m1OtherIds.includes(playerId) || m2OtherIds.includes(swapSelection.playerId)) {
            showToast('같은 선수가 있습니다');
            return;
          }
        }
      }

      soundEffects.playWhistle();
      onSwapActivePlayers?.(
        swapSelection.matchId,
        swapSelection.playerId,
        matchId,
        playerId
      );
      setSwapSelection(null);
      setSelectedParticipantIds([]);
      return;
    }

    // 4. Bench / Participant ↔ Queued swap!
    if (
      (swapSelection.type === 'bench' && type === 'queued') ||
      (swapSelection.type === 'queued' && type === 'bench')
    ) {
      const qMatchId = type === 'queued' ? matchId : swapSelection.matchId;
      const qPlayerId = type === 'queued' ? playerId : swapSelection.playerId;
      const bPlayerId = type === 'bench' ? playerId : swapSelection.playerId;

      const qMatch = queuedMatches.find((m) => m.id === qMatchId);
      if (qMatch) {
        const otherIds = [
          qMatch.teamA.player1Id,
          qMatch.teamA.player2Id,
          qMatch.teamB.player1Id,
          qMatch.teamB.player2Id,
        ].filter((id) => id !== qPlayerId);

        if (otherIds.includes(bPlayerId)) {
          showToast('같은 선수가 있습니다');
          return;
        }
      }

      soundEffects.playWhistle();
      onSwapQueuedAndBench?.(qMatchId, qPlayerId, bPlayerId);
      setSwapSelection(null);
      setSelectedParticipantIds([]);
      return;
    }

    // 4b. Bench / Participant ↔ Active swap!
    if (
      (swapSelection.type === 'bench' && type === 'active') ||
      (swapSelection.type === 'active' && type === 'bench')
    ) {
      const aMatchId = type === 'active' ? matchId : swapSelection.matchId;
      const aPlayerId = type === 'active' ? playerId : swapSelection.playerId;
      const bPlayerId = type === 'bench' ? playerId : swapSelection.playerId;

      const aMatch = activeMatches.find((m) => m.id === aMatchId);
      if (aMatch) {
        const otherIds = [
          aMatch.teamA.player1Id,
          aMatch.teamA.player2Id,
          aMatch.teamB.player1Id,
          aMatch.teamB.player2Id,
        ].filter((id) => id !== aPlayerId);

        if (otherIds.includes(bPlayerId)) {
          showToast('같은 선수가 있습니다');
          return;
        }
      }

      soundEffects.playWhistle();
      onSwapActiveAndBench?.(aMatchId, aPlayerId, bPlayerId);
      setSwapSelection(null);
      setSelectedParticipantIds([]);
      return;
    }

    // 5. Active ↔ Queued swap!
    if (
      (swapSelection.type === 'active' && type === 'queued') ||
      (swapSelection.type === 'queued' && type === 'active')
    ) {
      const activeMatchId = type === 'active' ? matchId : swapSelection.matchId;
      const activePlayerId = type === 'active' ? playerId : swapSelection.playerId;
      const queuedMatchId = type === 'queued' ? matchId : swapSelection.matchId;
      const queuedPlayerId = type === 'queued' ? playerId : swapSelection.playerId;

      const activeMatch = activeMatches.find((m) => m.id === activeMatchId);
      const queuedMatch = queuedMatches.find((m) => m.id === queuedMatchId);
      if (activeMatch && queuedMatch) {
        const activeOtherIds = [
          activeMatch.teamA.player1Id,
          activeMatch.teamA.player2Id,
          activeMatch.teamB.player1Id,
          activeMatch.teamB.player2Id,
        ].filter((id) => id !== activePlayerId);
        const queuedOtherIds = [
          queuedMatch.teamA.player1Id,
          queuedMatch.teamA.player2Id,
          queuedMatch.teamB.player1Id,
          queuedMatch.teamB.player2Id,
        ].filter((id) => id !== queuedPlayerId);

        if (activeOtherIds.includes(queuedPlayerId) || queuedOtherIds.includes(activePlayerId)) {
          showToast('같은 선수가 있습니다');
          return;
        }
      }

      soundEffects.playWhistle();
      onSwapPlayersBetweenMatches?.(
        activeMatchId,
        activePlayerId,
        queuedMatchId,
        queuedPlayerId
      );
      setSwapSelection(null);
      setSelectedParticipantIds([]);
      return;
    }

    // Default: switch selection to newly clicked
    soundEffects.playRacketHit();
    if (selectedParticipantIds.length > 0) {
      setSelectedParticipantIds([]);
    }
    setSwapSelection({ matchId, playerId, type, team, slot });
  };

  // 게임목록 대기열에서 코트투입버튼을 눌렀을 때 다른 코트에 동일 선수가 있어 주황색 표시가 활성화된 경우,
  // 현재 다른 코트에 진행중인 경기의 선수들을 대기열에만 테두리 없는 주황색으로 표시하기 위한 ID 집합
  const conflictOtherCourtPlayingIds = useMemo(() => {
    const ids = new Set<string>();
    const targetCourtEntries = Object.entries(mergedConflictMatchTargetCourts);

    if (targetCourtEntries.length > 0) {
      const validTargetCourts: number[] = [];
      for (const [mId, targetCourt] of targetCourtEntries) {
        const qMatch = queuedMatches.find((m) => m.id === mId);
        if (!qMatch) continue;
        validTargetCourts.push(Number(targetCourt));
      }

      if (validTargetCourts.length === 0) return ids;

      activeMatches.forEach((am) => {
        if (am.status === 'completed') return;
        const isOtherCourt = validTargetCourts.some(
          (tCourt) => Number(am.courtNumber) !== Number(tCourt)
        );
        if (isOtherCourt) {
          [
            am.teamA.player1Id,
            am.teamA.player2Id,
            am.teamB.player1Id,
            am.teamB.player2Id,
          ].forEach((pid) => {
            if (pid) ids.add(pid);
          });
        }
      });

      return ids;
    }

    if (!conflictMatchPlayers) return ids;
    const entries = Object.entries(conflictMatchPlayers);
    if (entries.length === 0) return ids;

    activeMatches.forEach((am) => {
      if (am.status === 'completed') return;
      [
        am.teamA.player1Id,
        am.teamA.player2Id,
        am.teamB.player1Id,
        am.teamB.player2Id,
      ].forEach((pid) => {
        if (pid) ids.add(pid);
      });
    });

    return ids;
  }, [mergedConflictMatchTargetCourts, conflictMatchPlayers, queuedMatches, activeMatches]);

  // n코트 클릭(터치)로 대기열 라인에 초록색 배정 표시(activeAssignCourtNumber !== null)가 떴을 때,
  // 선택한 코트 외의 다른 코트에서 현재 경기를 진행 중인 타 코트 배정자 ID 집합
  const assignModeOtherCourtPlayingIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAssignCourtNumber === null) return ids;
    activeMatches.forEach((am) => {
      if (am.status === 'completed') return;
      if (Number(am.courtNumber) !== Number(activeAssignCourtNumber)) {
        [
          am.teamA.player1Id,
          am.teamA.player2Id,
          am.teamB.player1Id,
          am.teamB.player2Id,
        ].forEach((pid) => {
          if (pid) ids.add(pid);
        });
      }
    });
    return ids;
  }, [activeAssignCourtNumber, activeMatches]);

  // 타 코트 배정자(대기열에 포함되어 있으면서 동시에 다른 코트에서 진행 중인 선수) 통합 ID 집합
  const effectiveDuplicatePlayerIds = useMemo(() => {
    const ids = new Set<string>(conflictPlayerIds);

    for (const [mId, targetCourt] of Object.entries(mergedConflictMatchTargetCourts)) {
      const qMatch = queuedMatches.find((m) => m.id === mId);
      if (!qMatch) continue;
      const cNum = Number(targetCourt);
      const otherPlaying = new Set<string>();
      activeMatches.forEach((am) => {
        if (am.status !== 'completed' && Number(am.courtNumber) !== cNum) {
          [
            am.teamA.player1Id,
            am.teamA.player2Id,
            am.teamB.player1Id,
            am.teamB.player2Id,
          ].forEach((pid) => {
            if (pid) otherPlaying.add(pid);
          });
        }
      });
      [
        qMatch.teamA.player1Id,
        qMatch.teamA.player2Id,
        qMatch.teamB.player1Id,
        qMatch.teamB.player2Id,
      ].forEach((pid) => {
        if (pid && otherPlaying.has(pid)) {
          ids.add(pid);
        }
      });
    }

    if (activeAssignCourtNumber !== null && assignModeOtherCourtPlayingIds.size > 0) {
      queuedMatches.forEach((qm) => {
        [
          qm.teamA.player1Id,
          qm.teamA.player2Id,
          qm.teamB.player1Id,
          qm.teamB.player2Id,
        ].forEach((pid) => {
          if (pid && assignModeOtherCourtPlayingIds.has(pid)) {
            ids.add(pid);
          }
        });
      });
    }

    return ids;
  }, [
    conflictPlayerIds,
    mergedConflictMatchTargetCourts,
    queuedMatches,
    activeMatches,
    activeAssignCourtNumber,
    assignModeOtherCourtPlayingIds,
  ]);

  const effectiveOtherCourtPlayingIds = useMemo(() => {
    const ids = new Set<string>(conflictOtherCourtPlayingIds);
    assignModeOtherCourtPlayingIds.forEach((id) => ids.add(id));
    return ids;
  }, [conflictOtherCourtPlayingIds, assignModeOtherCourtPlayingIds]);

  const renderPlayerPill = (
    player: Player | undefined,
    matchId?: string,
    matchType?: 'active' | 'queued',
    team?: 'teamA' | 'teamB',
    slot?: 1 | 2
  ) => {
    if (!player) return <span className="text-slate-500 text-xs">미배정</span>;
    const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;

    const isExactSelected = Boolean(
      swapSelection &&
        swapSelection.playerId === player.id &&
        (!matchId ||
          !swapSelection.matchId ||
          (swapSelection.matchId === matchId && swapSelection.type === matchType))
    );

    // 대기열(또는 진행 경기/참가자 명단)에서 선수를 선택했을 때,
    // 선택한 선수 본인 및 다른 대기열·진행 코트에 배정된 '선택한 동일선수' 모두 굵은 테두리에 은은하게 빛나도록 표시
    const isSameSelectedPlayer = Boolean(
      (swapSelection && swapSelection.playerId === player.id) ||
        (!swapSelection &&
          selectedParticipantIds.length === 1 &&
          selectedParticipantIds[0] === player.id)
    );

    const isSameCourt = Boolean(
      swapSelection &&
        swapSelection.type !== 'bench' &&
        !isSameSelectedPlayer &&
        sameCourtPlayerIds.has(player.id)
    );

    const isEligibleTarget =
      !isSameSelectedPlayer &&
      !isSameCourt &&
      ((swapSelection && swapSelection.type !== matchType && swapSelection.playerId !== player.id) ||
        (swapSelection && swapSelection.type === 'queued' && matchType === 'queued' && swapSelection.playerId !== player.id) ||
        (swapSelection && swapSelection.type === 'active' && matchType === 'active' && swapSelection.playerId !== player.id) ||
        (selectedParticipantIds.length === 1 && (matchType === 'queued' || matchType === 'active') && selectedParticipantIds[0] !== player.id));

    const isSearchMatched =
      Boolean(cleanQuery) &&
      matchType === 'queued' &&
      (player.name.toLowerCase().includes(cleanQuery) ||
        tierMeta.label.toLowerCase().includes(cleanQuery) ||
        tierMeta.short.toLowerCase().includes(cleanQuery));

    const isConflictDuplicate =
      effectiveDuplicatePlayerIds.has(player.id) &&
      effectiveOtherCourtPlayingIds.has(player.id);

    // 코트투입버튼 클릭 또는 n코트 배정 선택 시,
    // 현재 다른 코트에 진행중인 경기의 선수들을 테두리 없는 주황색으로 표시
    const isConflictOtherCourtPlaying =
      !isConflictDuplicate &&
      effectiveOtherCourtPlayingIds.has(player.id);

    return (
      <button
        type="button"
        draggable={false}
        data-no-card-drag="true"
        data-player-swap-item="true"
        data-conflict-duplicate-player={isConflictDuplicate ? 'true' : undefined}
        onClick={() => {
          if (activeAssignCourtNumber !== null && matchType === 'queued') {
            return;
          }
          if (matchId && matchType) {
            handlePlayerClick(matchId, player.id, matchType, team, slot);
          }
        }}
        className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 rounded-lg text-xs text-slate-200 transition-all cursor-pointer shrink-0 touch-manipulation ${
          isSameSelectedPlayer
            ? 'bg-orange-500/25 border-2 border-orange-400 ring-1 ring-orange-400/50 shadow-[0_0_12px_rgba(249,115,22,0.45)] animate-pulse z-10'
            : isSearchMatched
            ? 'bg-amber-500/25 border-2 border-amber-400 ring-2 ring-amber-400 scale-105 shadow-[0_0_14px_rgba(251,191,36,0.55)] animate-pulse z-10'
            : isSameCourt
            ? 'bg-orange-500/20 border-2 border-transparent shadow-[0_0_10px_rgba(249,115,22,0.3)] animate-pulse z-10'
            : isConflictDuplicate
            ? 'bg-orange-950/70 border-2 border-orange-500 ring-2 ring-orange-400/90 shadow-[0_0_12px_rgba(249,115,22,0.55)] animate-pulse z-10'
            : isConflictOtherCourtPlaying
            ? 'bg-orange-500/20 border-2 border-transparent shadow-[0_0_10px_rgba(249,115,22,0.3)] animate-pulse z-10'
            : isEligibleTarget
            ? 'bg-slate-900 border border-amber-500/50 hover:border-amber-400 hover:bg-amber-500/10'
            : isPlayerLastMatchCompleted(player)
            ? 'bg-slate-900/90 border border-slate-400/60 ring-1 ring-slate-400/30 animate-subtle-gray-glow'
            : 'bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800'
        }`}
        title={
          isExactSelected
            ? `${player.name} (교체 선택됨 - 다시 클릭하면 취소)`
            : isSameSelectedPlayer
            ? `${player.name} (선택한 동일선수 - 클릭 시 이 경기로 선택 전환)`
            : isSameCourt
            ? `${player.name} (같은 배정에 있는 선수)`
            : isConflictDuplicate
            ? `${player.name} (현재 다른 코트에서 운동 중 - 코트현황 또는 대기열에서 수정해주세요)`
            : isConflictOtherCourtPlaying
            ? `${player.name} (현재 다른 코트에 진행중인 경기의 선수)`
            : isEligibleTarget
            ? `클릭하여 ${swapSelection ? getPlayer(swapSelection.playerId)?.name : getPlayer(selectedParticipantIds[0])?.name} 선수와 맞교체`
            : `${player.name} (클릭하여 다른 대기열/참가자/코트 선수와 맞교체)`
        }
      >
        <span
          className={`font-bold whitespace-nowrap ${
            isPlayerLastMatchCompleted(player)
              ? 'text-slate-300'
              : player.gender === 'M'
              ? 'text-blue-400'
              : 'text-pink-400'
          }`}
        >
          {player.name}
        </span>
        <PartnerDot player={player} allPlayers={allPlayers || Array.from(playersMap.values())} size="xs" />
        <span
          className={`text-[10px] font-bold shrink-0 ${tierMeta.color}`}
        >
          {tierMeta.short.replace(/조$/, '')}
        </span>
        {player.specialStatus === 'resting' && (
          <span
            title="휴식중"
            className="inline-flex items-center justify-center p-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-400/60 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)] shrink-0"
          >
            <Coffee className="w-2.5 h-2.5 text-amber-300" />
          </span>
        )}
        {player.specialStatus === 'lesson' && (
          <span
            title="레슨중"
            className="inline-flex items-center justify-center p-0.5 rounded bg-indigo-500/25 text-indigo-300 border border-indigo-400/60 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.5)] shrink-0"
          >
            <GraduationCap className="w-2.5 h-2.5 text-indigo-300" />
          </span>
        )}
        {player.specialStatus === 'last_match' && !isPlayerLastMatchCompleted(player) && (
          <span
            title="마지막판!"
            className="inline-flex items-center justify-center p-0.5 rounded bg-rose-500/25 text-rose-300 border border-rose-400/60 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)] shrink-0"
          >
            <Flag className="w-2.5 h-2.5 text-rose-300" />
          </span>
        )}
        {isPlayerLastMatchCompleted(player) && (
          <span
            title="퇴장(마지막판 완료)"
            className="inline-flex items-center justify-center p-0.5 rounded bg-slate-800/90 text-slate-200 border border-slate-400/70 shadow-[0_0_8px_rgba(148,163,184,0.4)] shrink-0"
          >
            <DoorOpen className="w-2.5 h-2.5 text-slate-200" />
          </span>
        )}
      </button>
    );
  };

  // Determine available courts strictly from actual courts list in 코트현황 (코트가 없으면 빈 목록)
  const occupiedCourts = new Set(activeMatches.map((m) => m.courtNumber));
  const courtList = (courts || []).map((c) => {
    const cones = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
    const currentConeIndex = 0;
    const activeCone = cones.length > 0 ? cones[0] : null;
    const nextConeIndex = cones.length > 0 ? 1 % cones.length : 0;
    const nextCone = cones.length > 0 ? cones[nextConeIndex] : null;
    const isOtherClub = activeCone?.color === 'gray';
    const isNextConeOtherClub = cones.length > 0 && nextCone?.color === 'gray';
    const isOccupied = occupiedCourts.has(c.courtNumber);
    const nLabel = extractCourtNumberLabel(c.name, c.courtNumber);
    return {
      courtNumber: c.courtNumber,
      label: formatCourtName(nLabel),
      shortLabel: `${nLabel}코트`,
      isOtherClub,
      isNextConeOtherClub,
      isOccupied,
      cones,
      currentConeIndex,
    };
  });

  return (
    <div className="space-y-6 relative">
      {/* Cone Movement Notification Modal (꼬깔 이동 알림 - 확인 버튼만 제공) */}
      {coneMoveToast && (
        <div
          data-court-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => {
            const targetCourtNum =
              coneMoveToast.isOurTurn && queuedMatches.length > 0 ? coneMoveToast.courtNumber : null;
            setConeMoveToast(null);
            if (targetCourtNum !== null) {
              setActiveAssignCourtNumber(targetCourtNum);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-fit max-w-full rounded-2xl bg-slate-900 border-2 shadow-2xl shadow-black/90 p-5 space-y-4 animate-in zoom-in-95 duration-150 ${
              coneMoveToast.isOurTurn
                ? 'border-emerald-400/80 text-emerald-200'
                : 'border-slate-500 text-slate-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  coneMoveToast.isOurTurn
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400'
                    : 'bg-slate-800 border-slate-600 text-slate-300'
                }`}
              >
                <RotateCw className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2 flex-wrap whitespace-nowrap">
                  <span>{coneMoveToast.courtLabel} 꼬깔 회전</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                      coneMoveToast.isOurTurn
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                        : 'bg-slate-800 border-slate-600 text-slate-300'
                    }`}
                  >
                    {coneMoveToast.isOurTurn ? '우리클럽 차례 (배정 가능)' : '다른클럽 차례'}
                  </span>
                </div>
                <p className="text-xs text-slate-200 mt-1 font-semibold leading-relaxed whitespace-nowrap">
                  {coneMoveToast.isOurTurn
                    ? `${coneMoveToast.courtLabel}에 대기자 를 배정해 주세요.`
                    : `${coneMoveToast.courtLabel}의 꼬깔이 회전하였습니다.`}
                </p>
                {coneMoveToast.cones.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-2">
                    {coneMoveToast.cones.map((cone, idx) => (
                      <div
                        key={cone.id || idx}
                        className={`p-0.5 rounded transition-all ${
                          idx === coneMoveToast.nextIndex
                            ? 'bg-slate-800 ring-1 ring-amber-400 scale-110'
                            : 'opacity-45 scale-90'
                        }`}
                      >
                        <ConeIcon
                          color={cone.color}
                          size="sm"
                          isActive={idx === coneMoveToast.nextIndex}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  const targetCourtNum =
                    coneMoveToast.isOurTurn && queuedMatches.length > 0
                      ? coneMoveToast.courtNumber
                      : null;
                  setConeMoveToast(null);
                  if (targetCourtNum !== null) {
                    setActiveAssignCourtNumber(targetCourtNum);
                  }
                }}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-extrabold shadow-lg transition-all cursor-pointer ${
                  coneMoveToast.isOurTurn
                    ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-emerald-500/20'
                    : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-500/20'
                }`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Notification Modal for Court Assignment & Status Situations (확인 버튼만 제공) */}
      {toastMessage && (
        <div
          data-court-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => {
            setToastMessage(null);
            setToastPlayerNames(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-fit max-w-full rounded-2xl bg-slate-900 border-2 border-amber-400/80 shadow-2xl shadow-black/90 p-5 space-y-3.5 animate-in zoom-in-95 duration-150 flex flex-col items-center text-center"
          >
            <div className="flex items-center justify-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-200 leading-relaxed break-keep">
                  {toastMessage}
                </p>
              </div>
            </div>

            {toastPlayerNames && toastPlayerNames.length > 0 && (
              <div className="w-full px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center flex flex-col items-center justify-center">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-200 whitespace-nowrap">
                  {toastPlayerNames.map((name, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span className="text-slate-500 text-[10px]">•</span>}
                      <span>{name}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            <div className="w-full flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  setToastMessage(null);
                  setToastPlayerNames(null);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning Alert Modal with [확인] button */}
      {warningAlertModal && (
        <div
          data-court-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setWarningAlertModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-fit max-w-full rounded-2xl bg-slate-900 border-2 border-rose-500/80 text-white shadow-2xl shadow-black/90 p-5 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="font-bold text-base text-rose-300">
                  {warningAlertModal.title}
                </h3>
                <p className="text-xs text-slate-200 leading-relaxed font-semibold whitespace-nowrap">
                  {warningAlertModal.message}
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setWarningAlertModal(null)}
                className="w-full py-2.5 px-4 text-xs font-extrabold rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all cursor-pointer shadow-md shadow-rose-900/30"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal when clicking an occupied Our Club court button ([확인] / [취소] 알림) */}
      {confirmCompleteAndAssignModal && (() => {
        const liveCourtMatch = activeMatches.find(
          (m) =>
            Number(m.courtNumber) === Number(confirmCompleteAndAssignModal.courtNumber) &&
            m.status !== 'completed'
        );
        const livePlayerNames = liveCourtMatch
          ? [
              formatPlayerDisplayName(getPlayer(liveCourtMatch.teamA.player1Id)),
              formatPlayerDisplayName(getPlayer(liveCourtMatch.teamA.player2Id)),
              formatPlayerDisplayName(getPlayer(liveCourtMatch.teamB.player1Id)),
              formatPlayerDisplayName(getPlayer(liveCourtMatch.teamB.player2Id)),
            ].filter(Boolean)
          : confirmCompleteAndAssignModal.currentPlayersNames
              .split(/\s*•\s*|\s*,\s*/)
              .filter(Boolean);

        return (
          <div
            data-court-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
            onClick={() => setConfirmCompleteAndAssignModal(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-fit max-w-full rounded-2xl bg-slate-900 border-2 border-amber-400/80 text-white shadow-2xl shadow-black/90 p-5 space-y-3.5 animate-in zoom-in-95 duration-150 flex flex-col items-center text-center"
            >
              <div className="flex items-center justify-center gap-2">
                <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/30 shrink-0">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-amber-300 whitespace-nowrap">
                  {confirmCompleteAndAssignModal.courtLabel} 다음 대기열 배정
                </h3>
              </div>

              <div className="w-fit max-w-full mx-auto px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1 text-center flex flex-col items-center justify-center">
                <div className="text-[11px] font-bold text-slate-400 whitespace-nowrap text-center">
                  완료된 경기
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-200 whitespace-nowrap">
                  {livePlayerNames.map((name, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span className="text-slate-500 text-[10px]">•</span>}
                      <span>{name}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="w-full flex items-center justify-center gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setConfirmCompleteAndAssignModal(null)}
                  className="flex-1 min-w-[100px] px-8 py-2.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer text-center"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cNum = confirmCompleteAndAssignModal.courtNumber;
                    setConfirmCompleteAndAssignModal(null);
                    handleConfirmCompleteCourtForAssign(cNum);
                  }}
                  className="flex-1 min-w-[100px] px-8 py-2.5 text-xs font-bold rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 transition-all cursor-pointer shadow-md shadow-amber-500/20 text-center"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Swap In-Progress Alert Banner */}
      {swapSelection && (
        <div className="p-3.5 rounded-xl bg-amber-500/20 border border-amber-400/60 text-white flex flex-wrap items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-2 text-xs">
            <ArrowLeftRight className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              교체 대기 중:{' '}
              <strong className="text-amber-300 font-bold underline">
                {getPlayer(swapSelection.playerId)?.name}
              </strong>
              ({swapSelection.type === 'bench'
                ? '참가자'
                : swapSelection.type === 'active'
                ? '코트 진행 중'
                : '다음 대기열'}) ↔{' '}
              {swapSelection.type === 'queued'
                ? '대기열, [참가자 명단], 선수를 클릭하면 즉시 맞교체됩니다.'
                : '위 [다음 경기 대기열]에서 맞바꿀 선수를 클릭하세요.'}
            </span>
          </div>
          <button
            onClick={() => setSwapSelection(null)}
            className="px-2.5 py-1 text-xs font-semibold bg-slate-900/80 hover:bg-slate-900 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer shrink-0"
          >
            <X className="w-3 h-3" />
            <span>교체 취소</span>
          </button>
        </div>
      )}

      {/* Top Banner & Quick Generation Controls */}
      <div className="space-y-3">
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap w-full overflow-x-auto no-scrollbar">
            <h1 className="text-lg font-bold text-white flex items-center gap-2 shrink-0 whitespace-nowrap">
              <Layers className="w-5 h-5 text-amber-400 shrink-0" />
              <span>게임 목록</span>
            </h1>

            {options && onOpenGenerateModal && (
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onOpenGenerateModal();
                }}
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
            )}

            <button
              type="button"
              onClick={() => {
                if (queuedMatches.length === 0) return;
                soundEffects.playRacketHit();
                onClearAllQueue();
              }}
              disabled={queuedMatches.length === 0}
              title="대기열 전체 비우기 (미리 생성된 다음 경기 대기열 초기화)"
              className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                queuedMatches.length > 0
                  ? 'text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 cursor-pointer'
                  : 'text-slate-500 bg-slate-800/40 border border-slate-800 opacity-50 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>대기열 전체 비우기</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:gap-2 w-full">
            {/* Quick Match Generation Buttons: 좌측 50% (남복/여복/혼복 3등분), 우측 50% (연속 생성) */}
            <div className="col-span-1 grid grid-cols-3 gap-1.5 sm:gap-2 w-full">
              <button
                onClick={() => {
                  onGenerateSpecificQueueMatch?.('MD');
                }}
                title="대기 인원 중 남성 4명으로 남복 경기 생성하여 대기열에 추가"
                className="w-full px-1.5 sm:px-3 py-2 text-xs sm:text-sm font-bold text-blue-300 hover:text-white bg-blue-500/15 hover:bg-blue-500/30 border border-blue-500/40 rounded-xl transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap min-h-[38px] shadow-md shadow-blue-500/20 active:scale-98"
              >
                <span>
                  남복<span className="hidden sm:inline"> 생성</span>
                </span>
              </button>

              <button
                onClick={() => {
                  onGenerateSpecificQueueMatch?.('WD');
                }}
                title="대기 인원 중 여성 4명으로 여복 경기 생성하여 대기열에 추가"
                className="w-full px-1.5 sm:px-3 py-2 text-xs sm:text-sm font-bold text-pink-300 hover:text-white bg-pink-500/15 hover:bg-pink-500/30 border border-pink-500/40 rounded-xl transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap min-h-[38px] shadow-md shadow-pink-500/20 active:scale-98"
              >
                <span>
                  여복<span className="hidden sm:inline"> 생성</span>
                </span>
              </button>

              <button
                onClick={() => {
                  onGenerateSpecificQueueMatch?.('XD');
                }}
                title="대기 인원 중 혼합복식(남2+여2 또는 3:1) 경기 생성하여 대기열에 추가"
                className="w-full px-1.5 sm:px-3 py-2 text-xs sm:text-sm font-bold text-emerald-300 hover:text-white bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-xl transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap min-h-[38px] shadow-md shadow-emerald-500/20 active:scale-98"
              >
                <span>
                  혼복<span className="hidden sm:inline"> 생성</span>
                </span>
              </button>
            </div>

            <button
              onClick={() => {
                const targetCount =
                  courts.length > 0 ? courts.length : Math.max(1, activeCourtCount || 1);
                onPreGenerateQuick(targetCount);
              }}
              title={
                courts.length > 0
                  ? `현재 운영 코트(${courts.length}개)에 비례하여 ${courts.length}경기(${courts.length * 4}명)를 대기열에 연속 생성`
                  : '대기 인원 중 다음 경기를 대기열에 연속 생성'
              }
              className="col-span-1 w-full px-2 sm:px-3 py-2 text-xs sm:text-sm font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 border border-amber-400 rounded-xl transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap min-h-[38px] shadow-md shadow-amber-500/20 active:scale-98"
            >
              <Clock className="w-3.5 h-3.5 text-slate-950 shrink-0" />
              <span>연속 생성</span>
            </button>
          </div>
        </div>
      </div>

      {/* 1. Upcoming Pre-generated Queue Section with Player Search Bar */}
      <div className="space-y-3">
        {/* Player Search Bar with N-court assign buttons on the same line stretching to the right end */}
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
            <div className="relative w-full sm:w-64 md:w-80 lg:w-96 sm:shrink-0">
              <Search className="w-4 h-4 text-amber-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={playerSearchQuery}
                onChange={(e) => setPlayerSearchQuery(e.target.value)}
                placeholder="대기열 선수 검색"
                className="w-full pl-9 pr-9 py-2 bg-slate-900 border border-slate-700/80 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/40 rounded-xl text-xs text-white placeholder-slate-500 outline-none transition-all shadow-inner"
              />
              {playerSearchQuery && (
                <button
                  type="button"
                  onClick={() => setPlayerSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
                  title="검색어 지우기"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* N코트 버튼들 (모바일 및 일반 화면 모두 해당 라인 끝까지 채우며 코트 수에 맞춰 좌우 길이 실시간 균등 분배) */}
            <div className="flex flex-nowrap items-center gap-1.5 w-full sm:flex-1 min-w-0">
              {courtList.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playRacketHit();
                    onGoToCourtsTab?.();
                  }}
                  title="코트 현황으로 이동하여 코트를 추가합니다"
                  className="flex-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all cursor-pointer flex items-center justify-center whitespace-nowrap active:scale-95"
                >
                  <span>코트 추가 필요</span>
                </button>
              ) : (
                courtList.map((c) => {
                  const isConflictTargetCourt =
                    conflictOtherCourtPlayingIds.size > 0 &&
                    Object.values(mergedConflictMatchTargetCourts).some(
                      (tCourt) => Number(tCourt) === Number(c.courtNumber)
                    );
                  const isActive =
                    activeAssignCourtNumber === c.courtNumber ||
                    confirmCompleteAndAssignModal?.courtNumber === c.courtNumber ||
                    warningAlertModal?.courtNumber === c.courtNumber ||
                    coneMoveToast?.courtNumber === c.courtNumber ||
                    isConflictTargetCourt;
                  const courtLabel = formatCourtName(extractCourtNumberLabel(c.label, c.courtNumber));

                  // 실시간 코트 상태별 버튼 색상 (선택 시 해당 버튼의 색으로 발광):
                  // 1. 코트의 꼬깔이 다른클럽(회색) 일 때 -> 회색 (Gray)
                  // 2. 빈 코트 (!c.isOccupied) -> 초록색 (Green)
                  // 3. 우리클럽 꼬깔 진행 중 -> 빨강색 (Red)
                  const buttonColorClasses = c.isOtherClub
                    ? isActive
                      ? 'bg-slate-700 text-white border border-slate-300 ring-2 ring-slate-300/90 shadow-[0_0_16px_rgba(148,163,184,0.85)] animate-pulse'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                    : !c.isOccupied
                    ? isActive
                      ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400 ring-2 ring-emerald-400/90 shadow-[0_0_16px_rgba(16,185,129,0.85)] animate-pulse'
                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'
                    : isActive
                    ? 'bg-rose-500/30 text-rose-200 border border-rose-400 ring-2 ring-rose-400/90 shadow-[0_0_16px_rgba(244,63,94,0.85)] animate-pulse'
                    : 'bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 hover:text-white border border-rose-500/30';

                  return (
                    <button
                      key={c.courtNumber}
                      type="button"
                      data-court-assign-btn="true"
                      onClick={() => handleCourtButtonClick(c)}
                      title={
                        activeAssignCourtNumber === c.courtNumber
                          ? `${courtLabel} 선택 해제 (터치 시 선택 해제)`
                          : c.isOtherClub
                          ? `${courtLabel} (다른클럽 꼬깔) - 선택 시 다음 꼬깔로 회전`
                          : !c.isOccupied
                          ? `${courtLabel} (빈 코트) - 선택 시 대기열 경기를 배정합니다`
                          : `${courtLabel} (우리클럽 꼬깔 진행 중) - 선택 시 경기를 완료하고 대기열 경기를 배정합니다`
                      }
                      className={`flex-1 basis-0 min-w-0 px-1.5 sm:px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap truncate active:scale-95 ${buttonColorClasses}`}
                    >
                      <ConeIcon
                        color={c.isOtherClub ? 'gray' : 'red'}
                        size="xs"
                        isActive={true}
                        className="shrink-0"
                      />
                      <span className="truncate">{courtLabel}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {(conflictOtherCourtPlayingIds.size > 0 || cleanQuery) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {conflictOtherCourtPlayingIds.size > 0 && (
                <div className="flex items-center gap-2 bg-orange-500/15 border border-orange-500/40 px-2.5 py-1 rounded-xl shrink-0">
                  <span className="text-xs font-bold text-orange-300 whitespace-nowrap">
                    타 코트 중복 선수 표시 중
                  </span>
                  <button
                    type="button"
                    data-conflict-cancel-btn="true"
                    onClick={() => {
                      soundEffects.playRacketHit();
                      setActiveAssignCourtNumber(null);
                      setLocalConflictTargetCourts({});
                      onClearConflictHighlight?.();
                    }}
                    title="코트 투입 취소 및 주황색 선수 표시 해제"
                    className="px-2.5 py-1 text-xs font-extrabold rounded-lg bg-orange-500 hover:bg-orange-400 active:scale-95 text-slate-950 border border-orange-300 shadow-[0_0_10px_rgba(249,115,22,0.4)] transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>투입취소</span>
                  </button>
                </div>
              )}

              {cleanQuery && (
                <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>
                    '{playerSearchQuery}' 대기열 일치: {matchedQueuedPlayerCount}명
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {queuedMatches.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30">
            <Clock className="w-7 h-7 text-slate-600 mx-auto mb-2" />
            <div className="text-sm font-semibold text-slate-400">
              대기열에 경기가 없습니다
            </div>
            <div className="inline-flex flex-wrap items-center justify-center gap-2 mt-4">
              <button
                onClick={() => {
                  if (onGenerateByArrivalOrder) {
                    onGenerateByArrivalOrder();
                  } else {
                    const totalCount = Math.floor(
                      (allPlayers && allPlayers.length > 0 ? allPlayers : restingPlayers).filter((p) => p.isActive).length / 4
                    );
                    onPreGenerateQuick(Math.max(1, totalCount));
                  }
                }}
                className="px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 active:scale-95 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-emerald-500/20 transition-all cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <Users className="w-3.5 h-3.5" />
                <span>참가순으로 게임 생성</span>
              </button>

              {completedMatches && completedMatches.length > 0 && (
                <button
                  onClick={() => {
                    const targetCount =
                      courts.length > 0 ? courts.length : Math.max(1, activeCourtCount || 1);
                    onPreGenerateQuick(targetCount);
                  }}
                  title={
                    courts.length > 0
                      ? `현재 운영 코트(${courts.length}개)에 비례하여 ${courts.length}경기(${courts.length * 4}명)를 대기열에 연속 생성`
                      : '대기 인원 중 다음 경기를 대기열에 연속 생성'
                  }
                  className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer inline-flex items-center justify-center gap-1.5"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>연속 생성</span>
                </button>
              )}

              <button
                data-keep-conflict-nav="true"
                onClick={onGoToCourtsTab}
                className="justify-center px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white font-bold text-xs rounded-xl border border-slate-700/80 transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>코트 현황으로 이동</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {queuedMatches.map((match, idx) => {
              const p1 = getPlayer(match.teamA.player1Id);
              const p2 = getPlayer(match.teamA.player2Id);
              const p3 = getPlayer(match.teamB.player1Id);
              const p4 = getPlayer(match.teamB.player2Id);

              const isDragging = draggedMatchId === match.id;
              const isDragOver = dragOverMatchId === match.id;
              const canDrag = !editingMatchRankId;

              const matchHasSearchMatch = Boolean(
                cleanQuery &&
                  [p1, p2, p3, p4].some((p) => {
                    if (!p) return false;
                    const tierMeta = TIER_LABELS[p.tier] || TIER_LABELS.Beginner;
                    return (
                      p.name.toLowerCase().includes(cleanQuery) ||
                      tierMeta.label.toLowerCase().includes(cleanQuery) ||
                      tierMeta.short.toLowerCase().includes(cleanQuery)
                    );
                  })
              );

              const hasMatchConflict =
                (mergedConflictMatchTargetCourts[match.id] !== undefined ||
                  Boolean(conflictMatchPlayers?.[match.id]?.length)) &&
                conflictOtherCourtPlayingIds.size > 0;

              return (
                <div
                  key={match.id}
                  data-queued-match-id={match.id}
                  ref={(el) => {
                    queuedMatchCardRefs.current[match.id] = el;
                  }}
                  draggable={canDrag && dragHandleActiveMatchId === match.id && !matchTouchDragActiveIdRef.current}
                  onDragStart={(e) => handleMatchDragStart(e, match.id)}
                  onDragOver={(e) => handleMatchDragOver(e, match.id)}
                  onDrop={(e) => handleMatchDrop(e, match.id)}
                  onDragEnd={handleMatchDragEnd}
                  onTouchStart={(e) => handleMatchTouchStart(e, match.id, false)}
                  onMouseDown={(e) => handleMatchMouseDown(e, match.id, false)}
                  onContextMenu={(e) => {
                    if (canDrag) {
                      e.preventDefault();
                    }
                  }}
                  onClick={() => {
                    if (suppressMatchClickAfterDragRef.current) {
                      return;
                    }
                    if (activeAssignCourtNumber !== null) {
                      executeAssignMatchToCourt(match.id, activeAssignCourtNumber);
                    }
                  }}
                  onClickCapture={(e) => {
                    if (suppressMatchClickAfterDragRef.current) {
                      e.stopPropagation();
                      e.preventDefault();
                    }
                  }}
                  style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
                  className={`px-2.5 py-2 sm:p-3 rounded-xl border transition-all flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2.5 select-none touch-manipulation cursor-pointer ${
                    activeAssignCourtNumber !== null
                      ? 'border border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse'
                      : isDragging
                      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-950/60 shadow-xl scale-[1.01] z-20'
                      : isDragOver
                      ? 'border-amber-400 ring-2 ring-amber-400 bg-slate-900 shadow-xl scale-[1.01]'
                      : matchHasSearchMatch
                      ? 'border-amber-400/90 ring-1 ring-amber-400/60 bg-slate-900/95 shadow-[0_0_15px_rgba(251,191,36,0.15)]'
                      : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                  title={
                    activeAssignCourtNumber !== null
                      ? `클릭(터치) 시 이 대기 경기를 ${
                          courtList.find(
                            (c) => Number(c.courtNumber) === Number(activeAssignCourtNumber)
                          )?.label || formatCourtName(activeAssignCourtNumber)
                        }에 바로 배정합니다`
                      : '터치하거나 길게 드래그하여 순서 변경'
                  }
                >
                  {/* Left: Drag Handle */}
                  <div className="flex items-center gap-1 shrink-0">
                    {canDrag && (
                      <div
                        title="길게 터치하거나 드래그하여 대기 경기 순서 변경"
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleMatchTouchStart(e, match.id, true);
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMatchMouseDown(e, match.id, true);
                        }}
                        onMouseUp={() => setDragHandleActiveMatchId(null)}
                        style={{ touchAction: 'none', WebkitTouchCallout: 'none', userSelect: 'none' }}
                        className="cursor-grab active:cursor-grabbing p-1 sm:p-1.5 -ml-1 text-slate-500 hover:text-amber-400 active:text-amber-300 transition-colors shrink-0"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  {/* Middle: 4 Players in 1 single line right next to the Drag Handle */}
                  <DragScrollContainer
                    data-no-card-drag="true"
                    className="flex-1 min-w-0 flex items-center gap-1 sm:gap-1.5 py-0.5 px-0.5 max-w-full"
                  >
                    {renderPlayerPill(p1, match.id, 'queued', 'teamA', 1)}
                    {renderPlayerPill(p2, match.id, 'queued', 'teamA', 2)}
                    {renderPlayerPill(p3, match.id, 'queued', 'teamB', 1)}
                    {renderPlayerPill(p4, match.id, 'queued', 'teamB', 2)}
                  </DragScrollContainer>

                  {/* Right: 삭제 버튼 */}
                  <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">

                    {/* Delete Button */}
                    <button
                      type="button"
                      draggable={false}
                      data-no-card-drag="true"
                      data-queued-delete-btn="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteQueuedMatch(match.id);
                      }}
                      title="이 대기 경기 삭제"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Participants Section (참가자 명단: 모든 참가 선수 표시 및 1명 이상 선택 시 대기열 생성) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Users className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>참가자 명단</span>
                <span className="text-xs font-mono tabular-nums text-emerald-400 font-semibold px-1.5 py-0.2 rounded bg-emerald-400/10">
                  {(allPlayers && allPlayers.length > 0 ? allPlayers : restingPlayers).filter((p) => !p.attendancePending).length}명
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                선수를 <strong className="text-emerald-400 font-semibold underline decoration-dotted">길게 누르면(터치)</strong> 휴식/레슨/마지막판/퇴장 선택
              </div>
            </div>
          </div>
        </div>

        {/* Selected Participants Generation Action Bar (1명 이상 선택 시 대기열 생성) */}
        {selectedParticipantIds.length > 0 && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 flex flex-col gap-2.5 animate-fadeIn shadow-md">
            <div className="flex items-center gap-2.5 text-xs">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold shrink-0">
                {selectedParticipantIds.length}
              </div>
              <div>
                <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                  <span>선택된 선수:</span>
                  <span className="text-emerald-300 font-bold">
                    {selectedParticipantIds
                      .map((id) => getPlayer(id)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  선택한 선수의 다음 경기 대기열이 즉시 생성됩니다.
                </div>
              </div>
            </div>

            <div className="w-full flex items-center">
              <button
                type="button"
                data-participant-generate-btn="true"
                onClick={() => {
                  soundEffects.playWhistle();
                  onGenerateQueueWithSelected?.(selectedParticipantIds);
                  setSelectedParticipantIds([]);
                }}
                className="w-full px-3.5 py-1 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-98 rounded-lg shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>선택한 {selectedParticipantIds.length}명으로 대기열 생성</span>
              </button>
            </div>
          </div>
        )}

        {(() => {
          const participantList = (allPlayers && allPlayers.length > 0 ? allPlayers : restingPlayers).filter(
            (p) => !p.attendancePending
          );
          if (participantList.length === 0) {
            return (
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-center text-xs text-slate-400">
                참가자 명단 메뉴에서 선수를 등록해주세요.
              </div>
            );
          }

          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
              {participantList.map((player) => {
                const isSelectedInList = selectedParticipantIds.includes(player.id);
                const isSelectedForSwap = swapSelection?.playerId === player.id;
                const isSelected = isSelectedInList || isSelectedForSwap;
                const isSameCourt = Boolean(
                  swapSelection &&
                    swapSelection.type !== 'bench' &&
                    !isSelected &&
                    sameCourtPlayerIds.has(player.id)
                );

                const isConflictDuplicate =
                  effectiveDuplicatePlayerIds.has(player.id) &&
                  effectiveOtherCourtPlayingIds.has(player.id);

                const isConflictOtherCourtPlaying =
                  !isConflictDuplicate &&
                  effectiveOtherCourtPlayingIds.has(player.id);

                const conflictedQueuedMatchId = isConflictDuplicate
                  ? Object.keys(conflictMatchPlayers || {}).find((mId) =>
                      conflictMatchPlayers?.[mId]?.includes(player.id)
                    ) ||
                    queuedMatches.find(
                      (qm) =>
                        mergedConflictMatchTargetCourts?.[qm.id] !== undefined &&
                        [
                          qm.teamA.player1Id,
                          qm.teamA.player2Id,
                          qm.teamB.player1Id,
                          qm.teamB.player2Id,
                        ].includes(player.id)
                    )?.id ||
                    queuedMatches.find((qm) =>
                      [
                        qm.teamA.player1Id,
                        qm.teamA.player2Id,
                        qm.teamB.player1Id,
                        qm.teamB.player2Id,
                      ].includes(player.id)
                    )?.id
                  : undefined;

                const isEligibleTarget = Boolean(
                  swapSelection &&
                    (swapSelection.type === 'queued' || swapSelection.type === 'active') &&
                    !isSelected &&
                    !isSameCourt
                );

                const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;

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

                const isPlayingInCourt = activeCount > 0;
                const isQueued = queuedCount > 0;
                const isLastMatchDone = isPlayerLastMatchCompleted(player);
                const isLastMatchActive = player.specialStatus === 'last_match' && !isLastMatchDone;

                const handleCardClick = () => {
                  if (isLongPressTriggeredRef.current) {
                    isLongPressTriggeredRef.current = false;
                    return;
                  }

                  if (swapSelection?.type === 'queued' || swapSelection?.type === 'active') {
                    if (swapSelection.playerId === player.id) {
                      setSwapSelection(null);
                      if (hasActiveConflictDisplay) {
                        setLocalConflictTargetCourts({});
                        onClearConflictHighlight?.();
                      }
                      return;
                    }
                    if (player.specialStatus === 'resting' || player.specialStatus === 'lesson' || isLastMatchDone) {
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
                    if (isLastMatchActive && (isPlayingInCourt || isQueued)) {
                      soundEffects.playScorePoint();
                      showToast(
                        `${player.name} 선수는 마지막판 상태로 이미 다른 경기(코트/대기열)에 배정되어 있습니다. (중복 배정 불가)`
                      );
                      return;
                    }
                    if (swapSelection.type === 'queued') {
                      const qMatch = queuedMatches.find((m) => m.id === swapSelection.matchId);
                      if (qMatch) {
                        const otherIds = [
                          qMatch.teamA.player1Id,
                          qMatch.teamA.player2Id,
                          qMatch.teamB.player1Id,
                          qMatch.teamB.player2Id,
                        ].filter((id) => id !== swapSelection.playerId);

                        if (otherIds.includes(player.id)) {
                          showToast('같은 선수가 있습니다');
                          return;
                        }
                      }

                      soundEffects.playWhistle();
                      onSwapQueuedAndBench?.(swapSelection.matchId, swapSelection.playerId, player.id);
                      setSwapSelection(null);
                      setSelectedParticipantIds([]);
                    } else {
                      // swapSelection.type === 'active'
                      const aMatch = activeMatches.find((m) => m.id === swapSelection.matchId);
                      if (aMatch) {
                        const otherIds = [
                          aMatch.teamA.player1Id,
                          aMatch.teamA.player2Id,
                          aMatch.teamB.player1Id,
                          aMatch.teamB.player2Id,
                        ].filter((id) => id !== swapSelection.playerId);

                        if (otherIds.includes(player.id)) {
                          showToast('같은 선수가 있습니다');
                          return;
                        }
                      }

                      soundEffects.playWhistle();
                      onSwapActiveAndBench?.(swapSelection.matchId, swapSelection.playerId, player.id);
                      setSwapSelection(null);
                      setSelectedParticipantIds([]);
                    }
                  } else {
                    if (player.specialStatus) {
                      soundEffects.playScorePoint();
                      setStatusConfirmPlayer(player);
                      return;
                    }

                    // 중복 배정 주황색 발광 선수를 참가자 명단에서 클릭한 경우:
                    // 1) 이미 참가자 명단에서 교체할 선수 1명이 선택되어 있다면 즉시 대기열의 해당 중복 선수와 맞교체
                    if (
                      isConflictDuplicate &&
                      conflictedQueuedMatchId &&
                      selectedParticipantIds.length === 1 &&
                      selectedParticipantIds[0] !== player.id
                    ) {
                      const benchPlayerId = selectedParticipantIds[0];
                      const qMatch = queuedMatches.find((m) => m.id === conflictedQueuedMatchId);
                      if (qMatch) {
                        const otherIds = [
                          qMatch.teamA.player1Id,
                          qMatch.teamA.player2Id,
                          qMatch.teamB.player1Id,
                          qMatch.teamB.player2Id,
                        ].filter((id) => id !== player.id);

                        if (otherIds.includes(benchPlayerId)) {
                          showToast('같은 선수가 있습니다');
                          return;
                        }
                      }
                      soundEffects.playWhistle();
                      onSwapQueuedAndBench?.(conflictedQueuedMatchId, player.id, benchPlayerId);
                      setSelectedParticipantIds([]);
                      setSwapSelection(null);
                      return;
                    }

                    // 2) 아무도 선택되지 않은 상태에서 참가자 명단의 중복 배정 주황색 발광 선수를 클릭하면 즉시 교체 대상으로 선택
                    if (
                      isConflictDuplicate &&
                      conflictedQueuedMatchId &&
                      selectedParticipantIds.length === 0
                    ) {
                      soundEffects.playRacketHit();
                      setSwapSelection({
                        matchId: conflictedQueuedMatchId,
                        playerId: player.id,
                        type: 'queued',
                      });
                      return;
                    }

                    // Toggle participant selection for queue generation
                    soundEffects.playRacketHit();
                    setSelectedParticipantIds((prev) =>
                      prev.includes(player.id)
                        ? prev.filter((id) => id !== player.id)
                        : [...prev, player.id]
                    );
                  }
                };

                return (
                  <div
                    key={player.id}
                    data-player-swap-item="true"
                    data-participant-card="true"
                    data-conflict-duplicate-player={isConflictDuplicate ? 'true' : undefined}
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
                    onClick={handleCardClick}
                    className={`p-2.5 rounded-lg transition-all cursor-pointer relative group select-none touch-manipulation ${
                      isSelectedForSwap
                        ? 'bg-orange-500/25 border-2 border-orange-400 ring-1 ring-orange-400/50 shadow-[0_0_12px_rgba(249,115,22,0.45)] animate-pulse z-10'
                        : isSelectedInList
                        ? 'bg-amber-500/25 border-2 border-amber-400 ring-1 ring-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.45)] animate-pulse z-10'
                        : isSameCourt
                        ? 'bg-orange-500/20 border-2 border-transparent shadow-[0_0_10px_rgba(249,115,22,0.3)] animate-pulse z-10'
                        : isConflictDuplicate
                        ? 'bg-orange-950/70 border-2 border-orange-500 ring-2 ring-orange-400/90 shadow-[0_0_12px_rgba(249,115,22,0.55)] animate-pulse z-10'
                        : isConflictOtherCourtPlaying
                        ? 'bg-orange-500/20 border-2 border-transparent shadow-[0_0_10px_rgba(249,115,22,0.3)] animate-pulse z-10'
                        : isEligibleTarget
                        ? 'bg-slate-950/70 border border-slate-700/80 hover:border-amber-400/60 hover:bg-slate-900 shadow-sm'
                        : player.specialStatus === 'resting'
                        ? 'bg-amber-950/20 border border-amber-500/40 hover:border-amber-400/70'
                        : player.specialStatus === 'lesson'
                        ? 'bg-indigo-950/20 border border-indigo-500/40 hover:border-indigo-400/70'
                        : isLastMatchDone
                        ? 'bg-slate-900/80 border border-slate-400/60 ring-1 ring-slate-400/30 animate-subtle-gray-glow'
                        : isLastMatchActive
                        ? 'bg-rose-950/20 border border-rose-500/40 hover:border-rose-400/70'
                        : 'bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700'
                    }`}
                    title={
                      isSelectedForSwap
                        ? `${player.name} (선택한 동일선수 - 다시 클릭하면 선택 해제)`
                        : isSelectedInList
                        ? `${player.name} (선택됨 - 다시 클릭하면 선택 해제)`
                        : isSameCourt
                        ? `${player.name} (같은 배정에 있는 선수)`
                        : isConflictDuplicate
                        ? `${player.name} (현재 다른 코트에서 운동 중 - 클릭하여 다른 선수와 맞교체)`
                        : isConflictOtherCourtPlaying
                        ? `${player.name} (현재 다른 코트에 진행중인 경기의 선수)`
                        : isEligibleTarget && swapSelection
                        ? `클릭하여 대기열 선수(${getPlayer(swapSelection.playerId)?.name})와 맞교체`
                        : player.specialStatus === 'resting'
                        ? `${player.name} (휴식중 - 클릭 시 해제 / 길게 눌러 상태 변경)`
                        : player.specialStatus === 'lesson'
                        ? `${player.name} (레슨중 - 클릭 시 해제 / 길게 눌러 상태 변경)`
                        : isLastMatchDone
                        ? `${player.name} 퇴장! (클릭 시 해제 / 길게 눌러 상태 변경)`
                        : isLastMatchActive
                        ? `${player.name} (마지막판 - 클릭 시 해제 또는 선택 / 길게 눌러 상태 변경)`
                        : `${player.name} (클릭하여 선택 / 길게 눌러 휴식·레슨·마지막판·퇴장 설정)`
                    }
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span
                          className={`text-xs font-bold truncate ${
                            isLastMatchDone
                              ? 'text-slate-300'
                              : player.gender === 'M'
                              ? 'text-blue-400'
                              : 'text-pink-400'
                          }`}
                        >
                          {player.name}
                        </span>
                        <PartnerDot player={player} allPlayers={allPlayers || Array.from(playersMap.values())} size="xs" />
                        {player.specialStatus === 'resting' && (
                          <span
                            title="휴식중 (클릭 시 해제)"
                            className="px-1 py-0.2 rounded bg-amber-500/25 text-amber-300 border border-amber-400/60 animate-pulse flex items-center gap-0.5 text-[9px] font-bold shrink-0"
                          >
                            <Coffee className="w-2.5 h-2.5" />
                            <span>휴식중</span>
                          </span>
                        )}
                        {player.specialStatus === 'lesson' && (
                          <span
                            title="레슨중 (클릭 시 해제)"
                            className="px-1 py-0.2 rounded bg-indigo-500/25 text-indigo-300 border border-indigo-400/60 animate-pulse flex items-center gap-0.5 text-[9px] font-bold shrink-0"
                          >
                            <GraduationCap className="w-2.5 h-2.5" />
                            <span>레슨중</span>
                          </span>
                        )}
                        {isLastMatchActive && (
                          <span
                            title="마지막판! (클릭 시 해제)"
                            className="px-1 py-0.2 rounded bg-rose-500/25 text-rose-300 border border-rose-400/60 animate-pulse flex items-center gap-0.5 text-[9px] font-bold shrink-0"
                          >
                            <Flag className="w-2.5 h-2.5" />
                            <span>막판!</span>
                          </span>
                        )}
                        {isLastMatchDone && (
                          <span
                            title="퇴장(마지막판 완료 - 클릭 시 해제)"
                            className="px-1 py-0.2 rounded bg-slate-800/90 text-slate-200 border border-slate-400/70 shadow-[0_0_8px_rgba(148,163,184,0.4)] flex items-center gap-0.5 text-[9px] font-bold shrink-0"
                          >
                            <DoorOpen className="w-2.5 h-2.5 text-slate-200" />
                            <span>퇴장!</span>
                          </span>
                        )}
                        {isPlayingInCourt ? (
                          <span className="text-[9px] text-emerald-300 font-semibold shrink-0">
                            코트
                          </span>
                        ) : isQueued ? (
                          <span className="text-[9px] text-amber-300 font-semibold shrink-0">
                            대기 {queuedCount}
                          </span>
                        ) : null}
                      </div>

                      <span
                        className={`text-[10px] font-semibold shrink-0 ${tierMeta.color}`}
                      >
                        {tierMeta.short}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-300 font-mono tabular-nums">
                      <span className="font-medium text-slate-300 whitespace-nowrap">
                        배정 {assignedCount} / 진행 {progressCount}
                      </span>
                      {isSameCourt ? (
                        <span className="text-orange-300 font-semibold flex items-center gap-0.5 font-sans">
                          같은배정
                        </span>
                      ) : isConflictDuplicate ? (
                        <span className="text-orange-300 font-semibold flex items-center gap-0.5 font-sans">
                          중복배정
                        </span>
                      ) : isConflictOtherCourtPlaying ? (
                        <span className="text-orange-300 font-semibold flex items-center gap-0.5 font-sans">
                          운동중
                        </span>
                      ) : isEligibleTarget ? (
                        <span className="text-slate-400 group-hover:text-amber-400 font-medium flex items-center gap-0.5 transition-colors">
                          <ArrowLeftRight className="w-2.5 h-2.5" />
                          교체
                        </span>
                      ) : !isPlayingInCourt ? (
                        <span className="text-rose-500 font-bold font-mono tabular-nums">
                          {getPlayerWaitingMinutes(player, completedMatches, now)}분
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* 3. Currently Active Court Matches (No VS, No Score, clean participants list) */}
      <div className="space-y-3 pt-4 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-400" />
            <span>코트 현황</span>
          </h2>
          <button
            data-keep-conflict-nav="true"
            onClick={onGoToCourtsTab}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>코트 현황으로 이동</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {activeMatches.length === 0 ? (
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400 text-center">
            현재 코트에서 진행 중인 경기가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[...activeMatches]
              .sort((a, b) => {
                const idxA = (courts || []).findIndex((c) => Number(c.courtNumber) === Number(a.courtNumber));
                const idxB = (courts || []).findIndex((c) => Number(c.courtNumber) === Number(b.courtNumber));
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.courtNumber - b.courtNumber;
              })
              .map((m) => {
              const p1 = getPlayer(m.teamA.player1Id);
              const p2 = getPlayer(m.teamA.player2Id);
              const p3 = getPlayer(m.teamB.player1Id);
              const p4 = getPlayer(m.teamB.player2Id);
              const matchedCourt = (courts || []).find((c) => c.courtNumber === m.courtNumber);
              const activeCourtLabel = formatCourtName(
                extractCourtNumberLabel(matchedCourt?.name || m.courtName, m.courtNumber)
              );

              return (
                <div
                  key={m.id}
                  className="p-2.5 sm:p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-row items-center justify-between gap-2 sm:gap-3"
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    <span className="text-xs sm:text-sm font-bold text-white whitespace-nowrap">
                      {activeCourtLabel}
                    </span>
                  </div>

                  {/* Clean 4 participants list (한줄로 나열, vs 제거, 마우스 드래그 스크롤 지원) */}
                  <DragScrollContainer className="flex items-center gap-1 sm:gap-1.5 max-w-full min-w-0 py-0.5 sm:py-1 px-0.5">
                    {renderPlayerPill(p1, m.id, 'active', 'teamA', 1)}
                    {renderPlayerPill(p2, m.id, 'active', 'teamA', 2)}
                    {renderPlayerPill(p3, m.id, 'active', 'teamB', 1)}
                    {renderPlayerPill(p4, m.id, 'active', 'teamB', 2)}
                  </DragScrollContainer>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* FAN-SHAPED (부채꼴) RADIAL MENU MODAL for Participant List (휴식 / 레슨 / 마지막판 / 퇴장) */}
      {radialMenuPlayer && radialMenuPos && (
        <div data-court-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity animate-fadeIn cursor-pointer"
            onClick={() => setRadialMenuPlayer(null)}
          />

          {/* Fan Arc Menu Container positioned relative to the long-pressed card */}
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
                      <radialGradient id="gameListFanSemicircleBg" cx="50%" cy="100%" r="100%">
                        <stop offset="0%" stopColor="#1e293b" stopOpacity="0.98" />
                        <stop offset="55%" stopColor="#0f172a" stopOpacity="0.98" />
                        <stop offset="100%" stopColor="#020617" stopOpacity="0.99" />
                      </radialGradient>
                    </defs>

                    {/* Semicircle Solid Sector: Center (160, 156), Radius 152 */}
                    <path
                      d="M 8 156 A 152 152 0 0 1 312 156 Z"
                      fill="url(#gameListFanSemicircleBg)"
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
                        setSelectedParticipantIds((prev) =>
                          prev.filter((id) => id !== radialMenuPlayer.id)
                        );
                        if (swapSelection?.type === 'bench' && swapSelection.playerId === radialMenuPlayer.id) {
                          setSwapSelection(null);
                        }
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
                        setSelectedParticipantIds((prev) =>
                          prev.filter((id) => id !== radialMenuPlayer.id)
                        );
                        if (swapSelection?.type === 'bench' && swapSelection.playerId === radialMenuPlayer.id) {
                          setSwapSelection(null);
                        }
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
                        const isAlreadyAssigned =
                          activeMatches.some(
                            (m) =>
                              m.teamA.player1Id === radialMenuPlayer.id ||
                              m.teamA.player2Id === radialMenuPlayer.id ||
                              m.teamB.player1Id === radialMenuPlayer.id ||
                              m.teamB.player2Id === radialMenuPlayer.id
                          ) ||
                          queuedMatches.some(
                            (m) =>
                              m.teamA.player1Id === radialMenuPlayer.id ||
                              m.teamA.player2Id === radialMenuPlayer.id ||
                              m.teamB.player1Id === radialMenuPlayer.id ||
                              m.teamB.player2Id === radialMenuPlayer.id
                          );
                        if (isAlreadyAssigned) {
                          setSelectedParticipantIds((prev) =>
                            prev.filter((id) => id !== radialMenuPlayer.id)
                          );
                          if (swapSelection?.type === 'bench' && swapSelection.playerId === radialMenuPlayer.id) {
                            setSwapSelection(null);
                          }
                        }
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
                        setSelectedParticipantIds((prev) =>
                          prev.filter((id) => id !== radialMenuPlayer.id)
                        );
                        if (swapSelection?.type === 'bench' && swapSelection.playerId === radialMenuPlayer.id) {
                          setSwapSelection(null);
                        }
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

      {/* STATUS CANCEL CONFIRMATION MODAL for Participant List */}
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
                    setSelectedParticipantIds((prev) =>
                      prev.includes(statusConfirmPlayer.id)
                        ? prev.filter((id) => id !== statusConfirmPlayer.id)
                        : [...prev, statusConfirmPlayer.id]
                    );
                    setStatusConfirmPlayer(null);
                  }}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 transition-colors cursor-pointer"
                >
                  {selectedParticipantIds.includes(statusConfirmPlayer.id)
                    ? '대기열 생성 선택 해제하기'
                    : '마지막판 유지한 채 대기열 생성 선수로 선택하기'}
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
