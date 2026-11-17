import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Player,
  CourtMatch,
  MatchRound,
  MatchOptions,
  CourtInfo,
  ConeItem,
  SwapSelection,
  MasterMember,
  extractCourtNumberLabel,
  formatCourtName,
  getNormalizedTurnQueue,
  advanceConeTurnQueue,
  revertConeTurnQueue,
  revertConeToTarget,
  rotateQueueToFirstRedCone,
  isPlayerLastMatchCompleted,
  keepSpecialMatchesAtBottom,
} from './types';
import { INITIAL_SAMPLE_PLAYERS } from './utils/sampleData';
import {
  generateDoublesMatches,
  generateNextQueuedMatches,
  generateSingleCourtMatch,
  createDoublesMatchFromSelected,
  recordCompletedMatch,
  createQueuedMatchesFromSelectedPlayers,
  createSpecialMatchFromSelectedPlayers,
  isSpecialMatchTurnReady,
  orderQueuedMatchesWithSpecial,
  generateSpecificTypeQueuedMatch,
  generateQueueMatchesByArrivalOrder,
  computePartnerHistoryFromHistory,
  getEarliestRegistrationTime,
  computeRestReturnOffset,
  reconcileManualPlayerIntervention,
  recalculateRelativeLateOffsets,
  recordFormedMatchTierPattern,
} from './utils/matchmaker';
import { soundEffects } from './utils/audio';
import { generateRandom24Players } from './utils/sampleData';
import { AlertCircle, AlertTriangle, Check, Calendar, RotateCcw } from 'lucide-react';
import { Header, ActiveTab } from './components/Header';
import { CourtBoardView } from './components/CourtBoardView';
import { GameListView } from './components/GameListView';
import { PlayerManager } from './components/PlayerManager';
import { HistoryBoard } from './components/HistoryBoard';
import { GenerateModal } from './components/GenerateModal';
import { ResetModal, ResetType } from './components/ResetModal';
import { CreateCourtConfirmModal } from './components/CreateCourtConfirmModal';
import { AssignQueueModal } from './components/AssignQueueModal';
import { WorkoutCalendarModal } from './components/WorkoutCalendarModal';
import { FourAmResetModal } from './components/FourAmResetModal';
import {
  DailyWorkoutRecord,
  FourAmResetState,
  formatDateKey,
  parseDateKey,
  formatKoreanDateLabel,
  getYesterdayDateKey,
  getLatestFourAmBoundaryKey,
  getArchiveDateForBoundaryKey,
  getFourAmTimestampForBoundaryKey,
  didWorkoutStartAfterFourAmBoundary,
  loadWorkoutRecords,
  saveWorkoutRecords,
  upsertDailyWorkoutRecord,
  deleteDailyWorkoutRecord,
  isWorkoutSnapshotNonEmpty,
  saveTodayLiveStash,
  loadTodayLiveStash,
  clearTodayLiveStash,
  saveViewingWorkoutDate,
  loadViewingWorkoutDate,
  loadFourAmState,
  saveFourAmState,
  loadPreMidnightRecords,
  savePreMidnightRecord,
  deletePreMidnightRecord,
  extractPreMidnightSnapshot,
  didFirstWorkoutStartInEarlyMorningWindow,
  sanitizeWorkoutSnapshotForStorage,
} from './utils/workoutHistoryStorage';
import {
  loadArchivedPlayers,
  saveArchivedPlayersToStorage,
  mergePlayersIntoArchive,
  buildPlayerSnapshots,
  LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
} from './utils/playerArchive';
import {
  loadMasterMembersFromStorage,
  saveMasterMembersToStorage,
  syncPlayersAndMasterMembers,
  reconcilePlayersWithMasterMembers,
  isTestPlayer,
} from './utils/masterMemberStorage';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
  removeDeviceStorageItem,
  markKeysAsExplicitlyReset,
  initializeDeviceStorage,
  subscribeDeviceStorageHydration,
  isDeviceStorageHydrated,
} from './utils/deviceStorage';

const LOCAL_STORAGE_KEY_PLAYERS = DEVICE_STORAGE_KEYS.PLAYERS;
const LOCAL_STORAGE_KEY_MATCHES = DEVICE_STORAGE_KEYS.MATCHES;
const LOCAL_STORAGE_KEY_QUEUED = DEVICE_STORAGE_KEYS.QUEUED;
const LOCAL_STORAGE_KEY_HISTORY = DEVICE_STORAGE_KEYS.HISTORY;
const LOCAL_STORAGE_KEY_OPTIONS = DEVICE_STORAGE_KEYS.OPTIONS;
const LOCAL_STORAGE_KEY_NAME = DEVICE_STORAGE_KEYS.MEETUP_NAME;
const LOCAL_STORAGE_KEY_COURTS = DEVICE_STORAGE_KEYS.COURTS;

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveTab>('courts');
  const [appAlertMessage, setAppAlertMessage] = useState<string | null>(null);

  // Master Members State (기기 내부 로컬 저장소 영구 보존 & 전 메뉴 실시간 연동)
  const [masterMembers, setMasterMembers] = useState<MasterMember[]>(() =>
    loadMasterMembersFromStorage()
  );

  const handleUpdateMasterMembers = useCallback((updated: MasterMember[]) => {
    setMasterMembers(updated);
    saveMasterMembersToStorage(updated);
  }, []);

  // Meetup & Session State
  const [meetupName, setMeetupName] = useState<string>(() => {
    return getDeviceStorageItem(LOCAL_STORAGE_KEY_NAME) || '🏸 배드민턴 클럽 정기 모임';
  });

  // Players State: 초기에 샘플 데이터 없이 완전 빈 백지 상태로 시작
  const [players, setPlayers] = useState<Player[]>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // If stored data matches the legacy sample players, start blank
          const isInitialSample =
            parsed.length === INITIAL_SAMPLE_PLAYERS.length &&
            parsed.every((p: Player, idx: number) => p.id === INITIAL_SAMPLE_PLAYERS[idx]?.id);
          if (isInitialSample) {
            return [];
          }
          return parsed;
        }
      } catch {
        return [];
      }
    }
    return [];
  });

  // Courts with Cone System (Red = Our Club, Gray = Other Club) - 초기에 완전 빈 백지 상태
  const [courts, setCourts] = useState<CourtInfo[]>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          return parsed.map((c: CourtInfo) => ({
            ...c,
            name: formatCourtName(extractCourtNumberLabel(c.name, c.courtNumber)),
            cones: getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0),
            currentConeIndex: 0,
            turnStartedAt: c.turnStartedAt || now,
          }));
        }
      } catch {
        return [];
      }
    }
    return [];
  });

  // Matchmaking Options (Points to win removed)
  const [options, setOptions] = useState<MatchOptions>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          mode: parsed.mode || 'balanced',
          courtCount: typeof parsed.courtCount === 'number' ? parsed.courtCount : 2,
          avoidConsecutiveRests: parsed.avoidConsecutiveRests ?? true,
          avoidDuplicatePartners: parsed.avoidDuplicatePartners ?? true,
        };
      } catch {
        // default
      }
    }
    return {
      mode: 'balanced',
      courtCount: 2,
      avoidConsecutiveRests: true,
      avoidDuplicatePartners: true,
    };
  });

  // Active Matches currently playing on courts
  const [activeMatches, setActiveMatches] = useState<CourtMatch[]>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          return parsed.map((m: CourtMatch) => ({
            ...m,
            startedAt: m.startedAt || now,
          }));
        }
        return [];
      } catch {
        return [];
      }
    }
    return [];
  });

  // Queued upcoming matches (게임 목록 대기열)
  const [queuedMatches, setQueuedMatches] = useState<CourtMatch[]>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED);
    if (saved) {
      try {
        const parsed: CourtMatch[] = JSON.parse(saved);
        return parsed.map((m) => ({
          ...m,
          title: m.title ? m.title.replace(/\s*\(대기\s*\d+경기\)/g, '') : m.title,
        }));
      } catch {
        return [];
      }
    }
    return [];
  });

  // Past Round History
  const [roundHistory, setRoundHistory] = useState<MatchRound[]>(() => {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });

  // Modals & Swapping
  const [resetEpoch, setResetEpoch] = useState(0);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showCreateCourtConfirmModal, setShowCreateCourtConfirmModal] = useState(false);
  const [showWorkoutCalendarModal, setShowWorkoutCalendarModal] = useState(false);
  const [assignQueueModalCourt, setAssignQueueModalCourt] = useState<number | null>(null);
  const [selectedSwap, setSelectedSwap] = useState<SwapSelection | null>(null);
  const [selectedBenchPlayerIds, setSelectedBenchPlayerIds] = useState<string[]>([]);
  const [conflictMatchTargetCourts, setConflictMatchTargetCourts] = useState<Record<string, number>>({});
  const [gameListSwapSelection, setGameListSwapSelection] = useState<{
    matchId: string;
    playerId: string;
    type: 'active' | 'queued' | 'bench';
    team?: 'teamA' | 'teamB';
    slot?: 1 | 2;
  } | null>(null);

  // Workout Records (1달간 운동 기록 저장 & 과거 운동 기록 열람 상태)
  const [workoutRecords, setWorkoutRecords] = useState<Record<string, DailyWorkoutRecord>>(() =>
    loadWorkoutRecords()
  );
  const [viewingWorkoutDate, setViewingWorkoutDate] = useState<string | null>(() =>
    loadViewingWorkoutDate()
  );

  // AM 04:00 자동 저장 및 전체 완전 초기화 알림 상태 (3분 카운트다운 / 취소 시 30분 뒤 재알림)
  const [fourAmState, setFourAmState] = useState<FourAmResetState>(() => loadFourAmState());
  const [isFourAmModalOpen, setIsFourAmModalOpen] = useState<boolean>(() => {
    const loaded = loadFourAmState();
    return Boolean(loaded.modalExpiresAt && loaded.modalExpiresAt > Date.now());
  });
  const [fourAmRemainingSeconds, setFourAmRemainingSeconds] = useState<number>(180);
  const lastObservedBoundaryKeyRef = useRef<string>(getLatestFourAmBoundaryKey(new Date()));

  // Sync to Device Internal Local Storage
  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify(courts));
  }, [courts]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES, JSON.stringify(activeMatches));
  }, [activeMatches]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED, JSON.stringify(queuedMatches));
  }, [queuedMatches]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify(roundHistory));

    // Synchronize and backfill partnerHistory and lastPartnerId from past roundHistory
    if (roundHistory.length > 0) {
      const historyStats = computePartnerHistoryFromHistory(roundHistory);
      let changed = false;
      const updatedPlayers = players.map((p) => {
        const stats = historyStats[p.id];
        if (!stats) return p;
        const currentCount = Object.keys(p.partnerHistory || {}).length;
        const newCount = Object.keys(stats.partnerHistory || {}).length;
        const oppDiff =
          stats.lastOpponentIds &&
          stats.lastOpponentIds.length > 0 &&
          (p.lastOpponentIds || []).join(',') !== stats.lastOpponentIds.join(',');
        const partnerDiff =
          (stats.lastPartnerId && p.lastPartnerId !== stats.lastPartnerId) ||
          oppDiff ||
          newCount !== currentCount;
        if (partnerDiff) {
          changed = true;
          return {
            ...p,
            partnerHistory: { ...(p.partnerHistory || {}), ...(stats.partnerHistory || {}) },
            lastPartnerId: stats.lastPartnerId || p.lastPartnerId,
            lastOpponentIds: stats.lastOpponentIds || p.lastOpponentIds,
            opponentHistory: { ...(p.opponentHistory || {}), ...(stats.opponentHistory || {}) },
          };
        }
        return p;
      });

      if (changed) {
        setPlayers(updatedPlayers);
        setArchivedPlayers((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((pid) => {
            const stats = historyStats[pid];
            if (stats) {
              const currentArchivedCount = Object.keys(updated[pid].partnerHistory || {}).length;
              const newArchivedCount = Object.keys(stats.partnerHistory || {}).length;
              const oppDiff =
                stats.lastOpponentIds &&
                stats.lastOpponentIds.length > 0 &&
                (updated[pid].lastOpponentIds || []).join(',') !== stats.lastOpponentIds.join(',');
              if (
                (stats.lastPartnerId && updated[pid].lastPartnerId !== stats.lastPartnerId) ||
                oppDiff ||
                newArchivedCount !== currentArchivedCount
              ) {
                updated[pid] = {
                  ...updated[pid],
                  partnerHistory: { ...(updated[pid].partnerHistory || {}), ...(stats.partnerHistory || {}) },
                  lastPartnerId: stats.lastPartnerId || updated[pid].lastPartnerId,
                  lastOpponentIds: stats.lastOpponentIds || updated[pid].lastOpponentIds,
                  opponentHistory: { ...(updated[pid].opponentHistory || {}), ...(stats.opponentHistory || {}) },
                };
              }
            }
          });
          saveArchivedPlayersToStorage(updated);
          return updated;
        });
      }
    }
  }, [roundHistory]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS, JSON.stringify(options));
  }, [options]);

  useEffect(() => {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_NAME, meetupName);
  }, [meetupName]);

  const currentRound: number = useMemo(() => {
    if (activeMatches.length > 0 && activeMatches[0].round !== undefined) {
      return activeMatches[0].round;
    }
    return roundHistory.length;
  }, [activeMatches, roundHistory]);

  // Archived Players State (참가자명단에서 삭제되어도 대진기록 보존 및 재추가 시 배정/진행 기록 복원용)
  const [archivedPlayers, setArchivedPlayers] = useState<Record<string, Player>>(() => {
    return loadArchivedPlayers();
  });

  const justRestoredBackupRef = useRef<boolean>(false);

  // 기기 내부 로컬 저장소(IndexedDB + OPFS 파일 시스템) 초기화 및 자동 복원 구독
  useEffect(() => {
    const applyRestoredData = (restoredKeys: Record<string, string>) => {
      justRestoredBackupRef.current = true;

      let restoredMembersList: MasterMember[] | null = null;
      if (DEVICE_STORAGE_KEYS.MASTER_MEMBERS in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[DEVICE_STORAGE_KEYS.MASTER_MEMBERS]);
          if (Array.isArray(parsed)) {
            restoredMembersList = parsed;
            setMasterMembers(parsed);
          }
        } catch {
          // ignore
        }
      }

      if (LOCAL_STORAGE_KEY_PLAYERS in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_PLAYERS]);
          if (Array.isArray(parsed)) {
            const finalPlayers =
              restoredMembersList && restoredMembersList.length > 0
                ? reconcilePlayersWithMasterMembers(parsed, restoredMembersList).updatedPlayers
                : parsed;
            setPlayers(finalPlayers);
            if (finalPlayers !== parsed) {
              setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify(finalPlayers));
            }
          }
        } catch {
          // ignore
        }
      } else if (restoredMembersList && restoredMembersList.length > 0) {
        const membersToSync = restoredMembersList;
        setPlayers((prev) => {
          const { updatedPlayers, hasChanges } = reconcilePlayersWithMasterMembers(
            prev,
            membersToSync
          );
          return hasChanges ? updatedPlayers : prev;
        });
      }

      if (LOCAL_STORAGE_KEY_COURTS in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_COURTS]);
          if (Array.isArray(parsed)) {
            const now = Date.now();
            setCourts(
              parsed.map((c: CourtInfo) => ({
                ...c,
                name: formatCourtName(extractCourtNumberLabel(c.name, c.courtNumber)),
                cones: getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0),
                currentConeIndex: 0,
                turnStartedAt: c.turnStartedAt || now,
              }))
            );
          }
        } catch {
          // ignore
        }
      }
      if (LOCAL_STORAGE_KEY_MATCHES in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_MATCHES]);
          if (Array.isArray(parsed)) setActiveMatches(parsed);
        } catch {
          // ignore
        }
      }
      if (LOCAL_STORAGE_KEY_QUEUED in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_QUEUED]);
          if (Array.isArray(parsed)) setQueuedMatches(parsed);
        } catch {
          // ignore
        }
      }
      if (LOCAL_STORAGE_KEY_HISTORY in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_HISTORY]);
          if (Array.isArray(parsed)) setRoundHistory(parsed);
        } catch {
          // ignore
        }
      }
      if (LOCAL_STORAGE_KEY_OPTIONS in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_OPTIONS]);
          if (parsed && typeof parsed === 'object') {
            setOptions((prev) => ({
              ...prev,
              ...parsed,
            }));
          }
        } catch {
          // ignore
        }
      }
      if (LOCAL_STORAGE_KEY_NAME in restoredKeys && restoredKeys[LOCAL_STORAGE_KEY_NAME]) {
        setMeetupName(restoredKeys[LOCAL_STORAGE_KEY_NAME]);
      }
      if (LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS in restoredKeys) {
        try {
          const parsed = JSON.parse(restoredKeys[LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (restoredMembersList && restoredMembersList.length > 0) {
              const archiveList = Object.values(parsed as Record<string, Player>);
              const { updatedPlayers, hasChanges } = reconcilePlayersWithMasterMembers(
                archiveList,
                restoredMembersList
              );
              if (hasChanges) {
                const nextArchive: Record<string, Player> = {};
                updatedPlayers.forEach((p) => {
                  nextArchive[p.id] = p;
                });
                saveArchivedPlayersToStorage(nextArchive);
                setArchivedPlayers(nextArchive);
              } else {
                setArchivedPlayers(parsed);
              }
            } else {
              setArchivedPlayers(parsed);
            }
          }
        } catch {
          // ignore
        }
      } else if (restoredMembersList && restoredMembersList.length > 0) {
        const membersToSync = restoredMembersList;
        setArchivedPlayers((prev) => {
          const archiveList = Object.values(prev);
          const { updatedPlayers, hasChanges } = reconcilePlayersWithMasterMembers(
            archiveList,
            membersToSync
          );
          if (!hasChanges) return prev;
          const nextArchive: Record<string, Player> = {};
          updatedPlayers.forEach((p) => {
            nextArchive[p.id] = p;
          });
          saveArchivedPlayersToStorage(nextArchive);
          return nextArchive;
        });
      }

      if (DEVICE_STORAGE_KEYS.WORKOUT_RECORDS in restoredKeys) {
        setWorkoutRecords(loadWorkoutRecords());
      }
      if (DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE in restoredKeys) {
        setViewingWorkoutDate(loadViewingWorkoutDate());
      }
      if (DEVICE_STORAGE_KEYS.FOUR_AM_STATE in restoredKeys) {
        const loadedFourAm = loadFourAmState();
        setFourAmState(loadedFourAm);
        setIsFourAmModalOpen(
          Boolean(loadedFourAm.modalExpiresAt && loadedFourAm.modalExpiresAt > Date.now())
        );
      }

      if (
        LOCAL_STORAGE_KEY_PLAYERS in restoredKeys ||
        LOCAL_STORAGE_KEY_MATCHES in restoredKeys ||
        LOCAL_STORAGE_KEY_QUEUED in restoredKeys
      ) {
        setSelectedSwap(null);
        setSelectedBenchPlayerIds([]);
        setGameListSwapSelection(null);
        setConflictMatchTargetCourts({});
      }
    };

    const unsubscribe = subscribeDeviceStorageHydration(applyRestoredData);
    void initializeDeviceStorage();
    return () => {
      unsubscribe();
    };
  }, []);

  // 실시간 운동 기록 동기화 저장 (당일 날짜 또는 현재 캘린더에서 켜둔 날짜의 코트현황/게임목록/참가자명단/대진기록 실시간 저장 + 1달 이전 기록 자동 삭제)
  useEffect(() => {
    const now = new Date();
    const todayDateKey = formatDateKey(now);
    const yesterdayDateKey = getYesterdayDateKey(now);
    const isZeroToFourWindow = now.getHours() >= 0 && now.getHours() < 4;
    const targetDateKey = viewingWorkoutDate || todayDateKey;
    const hydrated = isDeviceStorageHydrated();
    const preserveRestoredRecord = !hydrated || justRestoredBackupRef.current;
    justRestoredBackupRef.current = false;

    const currentSnapshot: DailyWorkoutRecord = {
      date: targetDateKey,
      updatedAt: now.getTime(),
      meetupName,
      players,
      courts,
      activeMatches,
      queuedMatches,
      roundHistory,
      archivedPlayers,
      options,
    };

    if (viewingWorkoutDate) {
      // 과거 날짜 운동 기록을 켜둔 상태에서 수정이 일어나면 해당 날짜의 운동 기록에 즉시 반영하여 모든 메뉴에서 정상 작동 보장
      const updated = upsertDailyWorkoutRecord(viewingWorkoutDate, currentSnapshot, {
        preserveExistingIfEmpty: false,
        removeIfEmpty: true,
        now,
      });
      savePreMidnightRecord(viewingWorkoutDate, currentSnapshot, now, {
        skipTimestampFilter: true,
      });
      setWorkoutRecords(updated);
      return;
    }

    // 당일 실시간 운동 모드: 당일 00:00 ~ 04:00 시간 사이에 첫 운동이 진행/배정이 시작되었는지 판별
    const startedInEarlyMorning = didFirstWorkoutStartInEarlyMorningWindow({
      now,
      targetDateKey: todayDateKey,
      players,
      activeMatches,
      queuedMatches,
      roundHistory,
      fourAmState,
    });

    if (startedInEarlyMorning) {
      // 1) 당일 00:00 ~ 04:00 사이에 첫 운동 진행/배정이 시작된 경우:
      //    오전 04:00 전체 완전 초기화와 알림이 실행되지 않도록 면제(bypass) 처리
      const isFirstBypassTransition =
        fourAmState.earlyMorningBypassBoundaryKey !== todayDateKey ||
        fourAmState.lastCompletedBoundaryKey !== todayDateKey ||
        fourAmState.modalExpiresAt !== null ||
        fourAmState.snoozeUntil !== null;

      if (isFirstBypassTransition) {
        const bypassedState: FourAmResetState = {
          lastCompletedBoundaryKey: todayDateKey,
          pendingBoundaryKey: null,
          pendingArchiveDate: null,
          snoozeUntil: null,
          modalExpiresAt: null,
          earlyMorningBypassBoundaryKey: todayDateKey,
        };
        setFourAmState(bypassedState);
        saveFourAmState(bypassedState);
        if (isFourAmModalOpen) {
          setIsFourAmModalOpen(false);
        }
      }

      // 2) 전날(00:00시 이전 날짜)의 운동 기록에는 오직 00:00시 전까지의 기록만 저장
      //    현재 화면에 00:00시 이전 기록이 함께 남아있어 수정되는 경우에는 실시간 반영하고,
      //    전날 캘린더를 별도로 수정한 경우에는 그 기록이 덮어써지지 않도록 보호
      const livePreMidnightYesterday = extractPreMidnightSnapshot(
        currentSnapshot,
        yesterdayDateKey
      );
      const hasLivePreMidnightOnScreen = isWorkoutSnapshotNonEmpty(livePreMidnightYesterday);
      const preMidnightMap = loadPreMidnightRecords(now);

      let updated = loadWorkoutRecords(now);
      if (hasLivePreMidnightOnScreen) {
        savePreMidnightRecord(yesterdayDateKey, livePreMidnightYesterday, now);
        updated = upsertDailyWorkoutRecord(yesterdayDateKey, livePreMidnightYesterday, {
          preserveExistingIfEmpty: false,
          removeIfEmpty: true,
          now,
        });
      } else if (isFirstBypassTransition) {
        const storedPreMidnight = preMidnightMap[yesterdayDateKey];
        if (storedPreMidnight && isWorkoutSnapshotNonEmpty(storedPreMidnight)) {
          const strictStored = extractPreMidnightSnapshot(storedPreMidnight, yesterdayDateKey);
          if (isWorkoutSnapshotNonEmpty(strictStored)) {
            updated = upsertDailyWorkoutRecord(yesterdayDateKey, strictStored, {
              preserveExistingIfEmpty: false,
              removeIfEmpty: true,
              now,
            });
          } else {
            updated = deleteDailyWorkoutRecord(yesterdayDateKey, now);
          }
        } else {
          updated = deleteDailyWorkoutRecord(yesterdayDateKey, now);
        }
      }

      // 3) 현재 운동 기록은 당일(todayDateKey) 운동 기록에 실시간 동기화 저장
      updated = upsertDailyWorkoutRecord(todayDateKey, currentSnapshot, {
        preserveExistingIfEmpty: preserveRestoredRecord,
        removeIfEmpty: !preserveRestoredRecord,
        now,
      });
      savePreMidnightRecord(todayDateKey, currentSnapshot, now);
      setWorkoutRecords(updated);
      return;
    }

    // 아직 오전 04:00 경계 전환(전날 기록 분리 및 초기화)이 처리되지 않은 상태에서 앱을 켠 경우,
    // 전날 잔여 데이터가 오늘(todayDateKey) 운동 기록으로 잘못 저장되지 않도록 보호
    const currentBoundaryKey = getLatestFourAmBoundaryKey(now);
    if (
      fourAmState.lastCompletedBoundaryKey !== currentBoundaryKey &&
      !didWorkoutStartAfterFourAmBoundary(currentSnapshot, currentBoundaryKey)
    ) {
      return;
    }

    if (isZeroToFourWindow) {
      // 현재 00:00 ~ 04:00 사이이고 아직 당일 첫 운동 진행/배정이 시작되지 않은 상태:
      // 전날(yesterdayDateKey)에는 00:00시 전까지의 기록만 보존하며,
      // 모든 메뉴에서 00:00 이전 기록을 수정하면 전날 기록에도 즉시 반영
      const livePreMidnightYesterday = extractPreMidnightSnapshot(
        currentSnapshot,
        yesterdayDateKey
      );
      const hasLivePreMidnightOnScreen = isWorkoutSnapshotNonEmpty(livePreMidnightYesterday);
      const preMidnightMap = loadPreMidnightRecords(now);
      const existingPreMidnight = preMidnightMap[yesterdayDateKey];

      let updated = loadWorkoutRecords(now);
      if (hasLivePreMidnightOnScreen) {
        savePreMidnightRecord(yesterdayDateKey, livePreMidnightYesterday, now);
        updated = upsertDailyWorkoutRecord(yesterdayDateKey, livePreMidnightYesterday, {
          preserveExistingIfEmpty: false,
          removeIfEmpty: true,
          now,
        });
      } else if (existingPreMidnight && isWorkoutSnapshotNonEmpty(existingPreMidnight)) {
        const strictExisting = extractPreMidnightSnapshot(existingPreMidnight, yesterdayDateKey);
        if (isWorkoutSnapshotNonEmpty(strictExisting)) {
          updated = upsertDailyWorkoutRecord(yesterdayDateKey, strictExisting, {
            preserveExistingIfEmpty: true,
            now,
          });
        }
      }

      // 만약 00:00 이후에 새로 등록된 참가자만 있는 경우(전날 잔여 기록이 아닌 경우)에만 당일 날짜에 임시 반영
      const todayMidnightMs = parseDateKey(todayDateKey).getTime();
      const hasPostMidnightPlayers = players.some(
        (p) => typeof p.registeredAt === 'number' && p.registeredAt >= todayMidnightMs
      );

      if (!hasLivePreMidnightOnScreen && hasPostMidnightPlayers && isWorkoutSnapshotNonEmpty(currentSnapshot)) {
        updated = upsertDailyWorkoutRecord(todayDateKey, currentSnapshot, {
          preserveExistingIfEmpty: !hydrated,
          removeIfEmpty: true,
          now,
        });
        savePreMidnightRecord(todayDateKey, currentSnapshot, now);
      }
      setWorkoutRecords(updated);
      return;
    }

    // 일반 시간대 (04:00 ~ 23:59:59): 당일 운동 기록으로 모든 메뉴의 수정사항 실시간 동기화 저장
    const updated = upsertDailyWorkoutRecord(todayDateKey, currentSnapshot, {
      preserveExistingIfEmpty: preserveRestoredRecord,
      removeIfEmpty: !preserveRestoredRecord,
      now,
    });
    if (isWorkoutSnapshotNonEmpty(currentSnapshot) || !preserveRestoredRecord) {
      savePreMidnightRecord(todayDateKey, currentSnapshot, now);
    }
    setWorkoutRecords(updated);
  }, [
    players,
    courts,
    activeMatches,
    queuedMatches,
    roundHistory,
    archivedPlayers,
    options,
    meetupName,
    viewingWorkoutDate,
    fourAmState,
    isFourAmModalOpen,
  ]);

  // 어떤 메뉴에 있든 당일 참가자(players)와 전체 회원(masterMembers) 간 1:1 동기화 및
  // 맨처음 등록된 4명의 첫 배정/진행 여부에 따른 지각 오프셋 실시간 동기화 보장
  useEffect(() => {
    if (players.length > 0) {
      const { updatedMembers, updatedPlayers, hasMemberChanges, hasPlayerChanges } =
        syncPlayersAndMasterMembers(players, masterMembers);
      if (hasMemberChanges) {
        handleUpdateMasterMembers(updatedMembers);
      }

      const basePlayers = hasPlayerChanges ? updatedPlayers : players;
      const recalculated = recalculateRelativeLateOffsets(
        basePlayers,
        activeMatches,
        queuedMatches
      );
      const hasOffsetOrFlagChanges = recalculated.some(
        (p, idx) =>
          (p.initialAssignedOffset ?? 0) !== (basePlayers[idx]?.initialAssignedOffset ?? 0) ||
          p.registeredBeforeFirstAssign !== basePlayers[idx]?.registeredBeforeFirstAssign ||
          p.firstFourAssignedAt !== basePlayers[idx]?.firstFourAssignedAt
      );

      if (hasPlayerChanges || hasOffsetOrFlagChanges) {
        setPlayers(recalculated);
      }
    }
  }, [players, activeMatches, queuedMatches]);

  // 전체 회원 또는 참가자 정보(이름/성별/급수)가 변경되었을 때 모든 메뉴(코트현황, 게임목록, 대진기록, 보관선수, 당일 Stash)에 즉시 반영
  const handleSyncMemberEdit = useCallback(
    (oldMember: MasterMember, updatedMember: MasterMember) => {
      const matchesTargetMember = (p: {
        name: string;
        gender: string;
        tier: string;
        masterMemberId?: string;
        isTest?: boolean;
      }) =>
        !p.isTest &&
        ((p.masterMemberId && p.masterMemberId === updatedMember.id) ||
          (!p.masterMemberId &&
            p.name.trim().toLowerCase() === oldMember.name.trim().toLowerCase() &&
            p.gender === oldMember.gender &&
            p.tier === oldMember.tier));

      // 1. 보관된 선수(archivedPlayers) 정보 동기화
      setArchivedPlayers((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.keys(next).forEach((pid) => {
          const p = next[pid];
          if (!isTestPlayer(p) && matchesTargetMember(p)) {
            next[pid] = {
              ...p,
              name: updatedMember.name,
              gender: updatedMember.gender,
              tier: updatedMember.tier,
              masterMemberId: updatedMember.id,
            };
            changed = true;
          }
        });
        if (changed) {
          saveArchivedPlayersToStorage(next);
          return next;
        }
        return prev;
      });

      // 2. 완료된 대진 기록(roundHistory) 스냅샷 동기화
      setRoundHistory((prevHistory) => {
        let historyChanged = false;
        const nextHistory = prevHistory.map((round) => {
          let roundChanged = false;
          const nextMatches = round.matches.map((match) => {
            if (!match.playerSnapshots) return match;
            let snapChanged = false;
            const nextSnaps = { ...match.playerSnapshots };
            Object.keys(nextSnaps).forEach((pid) => {
              const snap = nextSnaps[pid];
              if (
                snap.name.trim().toLowerCase() === oldMember.name.trim().toLowerCase() &&
                snap.gender === oldMember.gender &&
                snap.tier === oldMember.tier
              ) {
                nextSnaps[pid] = {
                  ...snap,
                  name: updatedMember.name,
                  gender: updatedMember.gender,
                  tier: updatedMember.tier,
                };
                snapChanged = true;
              }
            });
            if (snapChanged) {
              roundChanged = true;
              return { ...match, playerSnapshots: nextSnaps };
            }
            return match;
          });
          if (roundChanged) {
            historyChanged = true;
            return { ...round, matches: nextMatches };
          }
          return round;
        });
        return historyChanged ? nextHistory : prevHistory;
      });

      // 3. 과거 운동 기록 열람 중일 때 보관된 당일 운동 Stash도 함께 동기화
      const stashed = loadTodayLiveStash();
      if (stashed) {
        let stashChanged = false;
        const nextStashPlayers = (stashed.players || []).map((p) => {
          if (!isTestPlayer(p) && matchesTargetMember(p)) {
            stashChanged = true;
            return {
              ...p,
              name: updatedMember.name,
              gender: updatedMember.gender,
              tier: updatedMember.tier,
              masterMemberId: updatedMember.id,
            };
          }
          return p;
        });
        const nextStashArchived = { ...(stashed.archivedPlayers || {}) };
        Object.keys(nextStashArchived).forEach((pid) => {
          const p = nextStashArchived[pid];
          if (p && !isTestPlayer(p) && matchesTargetMember(p)) {
            nextStashArchived[pid] = {
              ...p,
              name: updatedMember.name,
              gender: updatedMember.gender,
              tier: updatedMember.tier,
              masterMemberId: updatedMember.id,
            };
            stashChanged = true;
          }
        });
        if (stashChanged) {
          saveTodayLiveStash({
            ...stashed,
            players: nextStashPlayers,
            archivedPlayers: nextStashArchived,
          });
        }
      }

      // 4. 최근 1개월 운동 기록(workoutRecords) 내부 선수 및 대진 기록 스냅샷도 함께 동기화
      const currentWorkoutMap = loadWorkoutRecords();
      let workoutMapChanged = false;
      const nextWorkoutMap: Record<string, DailyWorkoutRecord> = { ...currentWorkoutMap };

      Object.keys(nextWorkoutMap).forEach((dateKey) => {
        const rec = nextWorkoutMap[dateKey];
        if (!rec) return;
        let recChanged = false;

        const nextRecPlayers = (rec.players || []).map((p) => {
          if (!isTestPlayer(p) && matchesTargetMember(p)) {
            recChanged = true;
            return {
              ...p,
              name: updatedMember.name,
              gender: updatedMember.gender,
              tier: updatedMember.tier,
              masterMemberId: updatedMember.id,
            };
          }
          return p;
        });

        const nextRecArchived = { ...(rec.archivedPlayers || {}) };
        Object.keys(nextRecArchived).forEach((pid) => {
          const p = nextRecArchived[pid];
          if (p && !isTestPlayer(p) && matchesTargetMember(p)) {
            nextRecArchived[pid] = {
              ...p,
              name: updatedMember.name,
              gender: updatedMember.gender,
              tier: updatedMember.tier,
              masterMemberId: updatedMember.id,
            };
            recChanged = true;
          }
        });

        const nextRecHistory = (rec.roundHistory || []).map((round) => {
          let roundChanged = false;
          const nextMatches = round.matches.map((match) => {
            if (!match.playerSnapshots) return match;
            let snapChanged = false;
            const nextSnaps = { ...match.playerSnapshots };
            Object.keys(nextSnaps).forEach((pid) => {
              const snap = nextSnaps[pid];
              if (
                snap.name.trim().toLowerCase() === oldMember.name.trim().toLowerCase() &&
                snap.gender === oldMember.gender &&
                snap.tier === oldMember.tier
              ) {
                nextSnaps[pid] = {
                  ...snap,
                  name: updatedMember.name,
                  gender: updatedMember.gender,
                  tier: updatedMember.tier,
                };
                snapChanged = true;
              }
            });
            if (snapChanged) {
              roundChanged = true;
              return { ...match, playerSnapshots: nextSnaps };
            }
            return match;
          });
          if (roundChanged) {
            recChanged = true;
            return { ...round, matches: nextMatches };
          }
          return round;
        });

        if (recChanged) {
          workoutMapChanged = true;
          nextWorkoutMap[dateKey] = {
            ...rec,
            players: nextRecPlayers,
            archivedPlayers: nextRecArchived,
            roundHistory: nextRecHistory,
          };
        }
      });

      if (workoutMapChanged) {
        const savedMap = saveWorkoutRecords(nextWorkoutMap);
        setWorkoutRecords(savedMap);
      }
    },
    []
  );

  // Whenever players change, merge active players into archivedPlayers
  useEffect(() => {
    if (players.length > 0) {
      setArchivedPlayers((prev) => {
        const updated = mergePlayersIntoArchive(players, prev);
        saveArchivedPlayersToStorage(updated);
        return updated;
      });
    }
  }, [players]);

  const handleArchivePlayer = (player: Player) => {
    setArchivedPlayers((prev) => {
      const updated = mergePlayersIntoArchive([player], prev);
      saveArchivedPlayersToStorage(updated);
      return updated;
    });
  };

  // allKnownPlayersMap: Contains all active players as well as all archived/deleted players, ensuring match history never loses player info
  const allKnownPlayersMap = useMemo(() => {
    const map = new Map<string, Player>();
    // 1. Add all archived players first
    Object.values(archivedPlayers).forEach((p) => {
      map.set(p.id, p);
    });
    // 2. Scan roundHistory matches for playerSnapshots if missing
    roundHistory.forEach((r) => {
      r.matches.forEach((m) => {
        if (m.playerSnapshots) {
          Object.values(m.playerSnapshots).forEach((snap) => {
            if (!map.has(snap.id)) {
              map.set(snap.id, {
                id: snap.id,
                name: snap.name,
                gender: snap.gender,
                tier: snap.tier,
                isActive: false,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                totalPointsWon: 0,
                totalPointsLost: 0,
                consecutiveRestRounds: 0,
                partnerHistory: {},
                opponentHistory: {},
                createdAt: 0,
              });
            }
          });
        }
      });
    });
    // 3. Active players take highest priority
    players.forEach((p) => {
      map.set(p.id, p);
    });
    return map;
  }, [archivedPlayers, players, roundHistory]);

  const playersMap = allKnownPlayersMap;

  // Identify currently playing player IDs
  const activePlayingIds = useMemo(() => {
    const ids = new Set<string>();
    activeMatches.forEach((m) => {
      if (m.status !== 'completed') {
        ids.add(m.teamA.player1Id);
        ids.add(m.teamA.player2Id);
        ids.add(m.teamB.player1Id);
        ids.add(m.teamB.player2Id);
      }
    });
    return ids;
  }, [activeMatches]);

  // Helper: Find players in a match who are currently playing on ANOTHER court (courtNumber !== targetCourtNumber)
  const getDuplicatePlayersOnOtherCourts = useCallback(
    (match: CourtMatch, targetCourtNumber: number): string[] => {
      const cNum = Number(targetCourtNumber);
      const otherCourtPlayingIds = new Set<string>();
      activeMatches.forEach((m) => {
        if (Number(m.courtNumber) !== cNum && m.status !== 'completed') {
          [
            m.teamA.player1Id,
            m.teamA.player2Id,
            m.teamB.player1Id,
            m.teamB.player2Id,
          ].forEach((id) => {
            if (id) otherCourtPlayingIds.add(id);
          });
        }
      });

      const matchPlayerIds = [
        match.teamA.player1Id,
        match.teamA.player2Id,
        match.teamB.player1Id,
        match.teamB.player2Id,
      ].filter(Boolean);

      return matchPlayerIds.filter((id) => otherCourtPlayingIds.has(id));
    },
    [activeMatches]
  );

  // Clean up conflictMatchTargetCourts if the queued match was deleted, if no other courts have active matches, or if the duplicate player was resolved/swapped
  useEffect(() => {
    setConflictMatchTargetCourts((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      const next: Record<string, number> = {};
      let changed = false;

      for (const [mId, targetCourt] of entries) {
        const qMatch = queuedMatches.find((m) => m.id === mId);
        const hasOtherActiveCourt = activeMatches.some(
          (am) =>
            am.status !== 'completed' &&
            Number(am.courtNumber) !== Number(targetCourt)
        );
        const stillHasDuplicate = qMatch
          ? getDuplicatePlayersOnOtherCourts(qMatch, targetCourt).length > 0
          : false;
        if (qMatch && hasOtherActiveCourt && stillHasDuplicate) {
          next[mId] = targetCourt;
        } else {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [queuedMatches, activeMatches, getDuplicatePlayersOnOtherCourts]);

  // Real-time computation of duplicate players per conflicted queued match across all menus
  const conflictMatchPlayers = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const [mId, targetCourt] of Object.entries(conflictMatchTargetCourts)) {
      const qMatch = queuedMatches.find((m) => m.id === mId);
      if (!qMatch) continue;
      result[mId] = getDuplicatePlayersOnOtherCourts(qMatch, targetCourt);
    }
    return result;
  }, [conflictMatchTargetCourts, queuedMatches, getDuplicatePlayersOnOtherCourts]);

  // Clear gameListSwapSelection automatically if the selected match or selected player slot was swapped/removed
  useEffect(() => {
    if (!gameListSwapSelection) return;

    const isPlayerStillActive = players.some(
      (p) => p.id === gameListSwapSelection.playerId && p.isActive && !p.attendancePending
    );
    if (!isPlayerStillActive) {
      setGameListSwapSelection(null);
      return;
    }

    if (gameListSwapSelection.type === 'bench') return;

    const targetMatch =
      gameListSwapSelection.type === 'queued'
        ? queuedMatches.find((m) => m.id === gameListSwapSelection.matchId)
        : activeMatches.find(
            (m) => m.id === gameListSwapSelection.matchId && m.status !== 'completed'
          );

    if (!targetMatch) {
      setGameListSwapSelection(null);
      return;
    }

    if (gameListSwapSelection.team && gameListSwapSelection.slot) {
      const teamObj =
        gameListSwapSelection.team === 'teamA' ? targetMatch.teamA : targetMatch.teamB;
      const currentSlotPlayerId =
        gameListSwapSelection.slot === 1 ? teamObj.player1Id : teamObj.player2Id;
      if (!currentSlotPlayerId || currentSlotPlayerId !== gameListSwapSelection.playerId) {
        setGameListSwapSelection(null);
      }
    } else {
      const matchPlayerIds = [
        targetMatch.teamA.player1Id,
        targetMatch.teamA.player2Id,
        targetMatch.teamB.player1Id,
        targetMatch.teamB.player2Id,
      ];
      if (!matchPlayerIds.includes(gameListSwapSelection.playerId)) {
        setGameListSwapSelection(null);
      }
    }
  }, [queuedMatches, activeMatches, players, gameListSwapSelection]);

  // Keep CourtBoardView swap/bench selections synchronized if players are swapped or deployed from other menus
  useEffect(() => {
    const activePlayerSet = new Set(
      players.filter((p) => p.isActive && !p.attendancePending).map((p) => p.id)
    );
    setSelectedBenchPlayerIds((prev) => {
      if (prev.length === 0) return prev;
      const filtered = prev.filter(
        (id) => activePlayerSet.has(id) && !activePlayingIds.has(id)
      );
      return filtered.length === prev.length ? prev : filtered;
    });

    setSelectedSwap((prev) => {
      if (!prev) return null;
      if (prev.source === 'bench') {
        if (!activePlayerSet.has(prev.playerId) || activePlayingIds.has(prev.playerId)) {
          return null;
        }
        return prev;
      }
      if (prev.source === 'court' && prev.matchId && prev.team && prev.slot) {
        const m = activeMatches.find(
          (am) => am.id === prev.matchId && am.status !== 'completed'
        );
        if (!m) return null;
        const currentId = m[prev.team][prev.slot === 1 ? 'player1Id' : 'player2Id'];
        if (!currentId || currentId !== prev.playerId) return null;
      }
      return prev;
    });
  }, [activeMatches, activePlayingIds, players]);

  // Recompute match title (남복 / 여복 / 혼복) in real time when players are swapped
  const computeUpdatedMatchTitle = useCallback(
    (
      teamA: { player1Id: string; player2Id: string },
      teamB: { player1Id: string; player2Id: string },
      currentTitle?: string
    ): string | undefined => {
      const ids = [
        teamA.player1Id,
        teamA.player2Id,
        teamB.player1Id,
        teamB.player2Id,
      ].filter(Boolean);
      if (ids.length !== 4) return currentTitle;
      const pObjs = ids.map((id) => allKnownPlayersMap.get(id)).filter(Boolean) as Player[];
      if (pObjs.length !== 4) return currentTitle;

      const maleCount = pObjs.filter((p) => p.gender === 'M').length;
      const femaleCount = pObjs.filter((p) => p.gender === 'F').length;
      if (maleCount === 4) return '남복';
      if (femaleCount === 4) return '여복';
      if (maleCount > 0 && femaleCount > 0) return '혼복';
      return currentTitle;
    },
    [allKnownPlayersMap]
  );

  // 참가자 명단이나 전체 회원 관리에서 선수 정보(이름/성별/급수/꼬깔번호)가 수정되면
  // 테스트 선수·실제 회원 모두 코트 현황, 게임 목록(남복/여복/혼복 타이틀), 대진 기록 스냅샷에 즉시 반영
  useEffect(() => {
    if (players.length === 0) return;

    setActiveMatches((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((m) => {
        if (m.status === 'completed') return m;
        const nextTitle = computeUpdatedMatchTitle(m.teamA, m.teamB, m.title);
        if (nextTitle !== m.title) {
          changed = true;
          return { ...m, title: nextTitle };
        }
        return m;
      });
      return changed ? next : prev;
    });

    setQueuedMatches((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((m) => {
        const nextTitle = computeUpdatedMatchTitle(m.teamA, m.teamB, m.title);
        const finalTitle = m.isSpecialMatch && nextTitle && !nextTitle.startsWith('스페셜')
          ? `스페셜 ${nextTitle}`
          : nextTitle;
        if (finalTitle !== m.title) {
          changed = true;
          return { ...m, title: finalTitle };
        }
        return m;
      });
      return changed ? next : prev;
    });

    setRoundHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const playerById = new Map(players.map((p) => [p.id, p]));
      let historyChanged = false;
      const nextHistory = prevHistory.map((round) => {
        let roundChanged = false;
        const nextMatches = round.matches.map((match) => {
          if (!match.playerSnapshots) return match;
          let snapChanged = false;
          const nextSnaps = { ...match.playerSnapshots };
          Object.keys(nextSnaps).forEach((pid) => {
            const p = playerById.get(pid);
            const snap = nextSnaps[pid];
            if (
              p &&
              snap &&
              (snap.name !== p.name ||
                snap.gender !== p.gender ||
                snap.tier !== p.tier ||
                snap.coneNumber !== p.coneNumber)
            ) {
              nextSnaps[pid] = {
                ...snap,
                name: p.name,
                gender: p.gender,
                tier: p.tier,
                coneNumber: p.coneNumber,
              };
              snapChanged = true;
            }
          });
          if (snapChanged) {
            roundChanged = true;
            return { ...match, playerSnapshots: nextSnaps };
          }
          return match;
        });
        if (roundChanged) {
          historyChanged = true;
          return { ...round, matches: nextMatches };
        }
        return round;
      });
      return historyChanged ? nextHistory : prevHistory;
    });
  }, [players, computeUpdatedMatchTitle]);

  const conflictPlayerIds = useMemo(() => {
    return Array.from(new Set(Object.values(conflictMatchPlayers).flat()));
  }, [conflictMatchPlayers]);

  const handleClearConflictHighlight = useCallback((matchId?: string) => {
    if (!matchId) {
      setConflictMatchTargetCourts({});
      return;
    }
    setConflictMatchTargetCourts({});
  }, []);

  // 다른 메뉴로 이동 시 코트현황의 대기 선수 선택 상태 초기화
  useEffect(() => {
    if (activeTab !== 'courts') {
      if (selectedBenchPlayerIds.length > 0) {
        setSelectedBenchPlayerIds([]);
      }
      if (selectedSwap !== null) {
        setSelectedSwap(null);
      }
    }
  }, [activeTab, selectedBenchPlayerIds.length, selectedSwap]);



  // 다른 메뉴(코트 현황 등)에서도 타 코트 중복 선수 표시 중일 때 중복 선수 교체 외의 다른 영역 클릭(터치) 시 취소
  useEffect(() => {
    if (activeTab === 'games') return;
    if (Object.keys(conflictMatchTargetCourts).length === 0) return;

    const handleGlobalConflictOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('[data-court-modal="true"]')) return;
      if (target.closest('[data-keep-conflict-nav="true"]')) return;
      if (target.closest('[data-conflict-duplicate-player="true"]')) return;
      if (selectedSwap !== null && target.closest('[data-player-swap-item="true"]')) return;

      setConflictMatchTargetCourts({});
    };

    document.addEventListener('pointerdown', handleGlobalConflictOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleGlobalConflictOutsidePointerDown);
    };
  }, [activeTab, conflictMatchTargetCourts, selectedSwap]);

  // Attended players (excludes players waiting for attendance check with strikethrough)
  const attendedPlayers = useMemo(() => {
    return players.filter((p) => !p.attendancePending);
  }, [players]);

  // Resting players are those active, attended, and not currently on court
  const restingPlayers = useMemo(() => {
    return players.filter(
      (p) => p.isActive && !p.attendancePending && !activePlayingIds.has(p.id)
    );
  }, [players, activePlayingIds]);

  const activePlayersCount = useMemo(() => {
    return players.filter((p) => {
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
        const inActive = activePlayingIds.has(p.id);
        const inQueue = queuedMatches.some(
          (m) =>
            !m.isSpecialMatch &&
            (m.teamA.player1Id === p.id ||
              m.teamA.player2Id === p.id ||
              m.teamB.player1Id === p.id ||
              m.teamB.player2Id === p.id)
        );
        if (inActive || inQueue) return false;
      }
      return true;
    }).length;
  }, [players, activePlayingIds, queuedMatches]);

  // All completed court matches from history
  const allCompletedMatches = useMemo(() => {
    const fromHistory = roundHistory.flatMap((r) => r.matches);
    const map = new Map<string, CourtMatch>();
    fromHistory.forEach((m) => map.set(m.id, m));
    return Array.from(map.values()).sort(
      (a, b) => (b.completedAt || 0) - (a.completedAt || 0)
    );
  }, [roundHistory]);


  // -------------------------------------------------------------
  // Court & Cone Management Handlers
  // -------------------------------------------------------------

  // Advance Court Turn (Rotates Cones in Queue: (1→2→3) => (2→3→1))
  // If autoDeploy is true and next is Red cone, automatically assigns next queued match.
  const handleAdvanceCourtTurn = (courtNumber: number, autoDeploy: boolean = true): ConeItem | null => {
    const targetCourt = courts.find((c) => c.courtNumber === courtNumber);
    if (!targetCourt) return null;
    const cones = targetCourt.cones || [];
    if (cones.length === 0) return null;

    const {
      cones: rotatedCones,
      currentConeIndex: nextIndex,
      activeCone: nextCone,
      prevCone: currentCone,
    } = advanceConeTurnQueue(cones, targetCourt.currentConeIndex || 0);

    if (!nextCone) return null;
    const isCurrentOtherClub = currentCone?.color === 'gray';

    // Update court cone queue, record completed turn in turnHistory, and reset turnStartedAt timer
    const turnNow = Date.now();
    setCourts((prevCourts) =>
      prevCourts.map((c) => {
        if (c.courtNumber !== courtNumber) return c;
        const nextHistory = currentCone
          ? [
              ...(c.turnHistory || []),
              { prevConeId: currentCone.id, prevTurnColor: currentCone.color },
            ]
          : c.turnHistory || [];
        return {
          ...c,
          cones: rotatedCones,
          currentConeIndex: nextIndex,
          turnStartedAt: turnNow,
          turnHistory: nextHistory,
        };
      })
    );

    if (isCurrentOtherClub) {
      // 다른클럽 꼬깔일 때 턴넘기기를 실행했을 때:
      // 다음 꼬깔이 다른클럽이 아니면(우리클럽으로 전환될 때), 배정선수관리 메뉴를 즉시 실행!
      if (nextCone.color !== 'gray') {
        soundEffects.playWhistle();
        setAssignQueueModalCourt(courtNumber);
      } else {
        setActiveMatches((prev) => prev.filter((m) => m.courtNumber !== courtNumber));
        soundEffects.playScorePoint();
      }
      return nextCone;
    }

    if (nextCone.color === 'gray') {
      // Switched to Other Club: Our club cannot enter, remove active match on this court
      setActiveMatches((prev) => prev.filter((m) => m.courtNumber !== courtNumber));
      soundEffects.playScorePoint();
    } else if (nextCone.color === 'red' && autoDeploy) {
      // Switched to Our Club: If queue has matches, automatically pull the next queued team!
      setQueuedMatches((prevQueue) => {
        const deployableIdx = prevQueue.findIndex(
          (m) =>
            !m.isSpecialMatch ||
            isSpecialMatchTurnReady(m, players, activeMatches, prevQueue, getEnrichedOptions(options))
        );
        if (deployableIdx >= 0) {
          const matchToDeploy = prevQueue[deployableIdx];
          const remainingQueue = prevQueue.filter((_, i) => i !== deployableIdx);
          const now = Date.now();
          const assignedMatch: CourtMatch = {
            ...matchToDeploy,
            courtNumber,
            courtName: formatCourtName(extractCourtNumberLabel(targetCourt?.name, courtNumber)),
            status: 'in_progress',
            startedAt: now,
            playerAssignedAt: {
              [matchToDeploy.teamA.player1Id]: now,
              [matchToDeploy.teamA.player2Id]: now,
              [matchToDeploy.teamB.player1Id]: now,
              [matchToDeploy.teamB.player2Id]: now,
            },
          };

          setActiveMatches((prevActive) => {
            const filtered = prevActive.filter((m) => m.courtNumber !== courtNumber);
            return [...filtered, assignedMatch].sort((a, b) => a.courtNumber - b.courtNumber);
          });

          setConflictMatchTargetCourts({});
          soundEffects.playWhistle();
          return orderQueuedMatchesWithSpecial(
            remainingQueue,
            players,
            activeMatches,
            getEnrichedOptions(options)
          );
        }
        return prevQueue;
      });
    }

    return nextCone;
  };

  // Advance Court Cone from GameListView Queue (rotates cone in courts state without auto-opening modal)
  const handleAdvanceCourtCone = (courtNumber: number): ConeItem | null => {
    const cNum = Number(courtNumber);
    const targetCourt = courts.find((c) => Number(c.courtNumber) === cNum);
    if (!targetCourt) return null;
    const cones = targetCourt.cones || [];
    if (cones.length === 0) return null;

    const {
      cones: rotatedCones,
      currentConeIndex: nextIndex,
      activeCone: nextCone,
      prevCone: currentCone,
    } = advanceConeTurnQueue(cones, targetCourt.currentConeIndex || 0);
    if (!nextCone) return null;

    const turnNow = Date.now();
    const existing = activeMatches.find(
      (m) => Number(m.courtNumber) === cNum && m.status !== 'completed'
    );

    if (existing) {
      const displayCourtName = formatCourtName(extractCourtNumberLabel(targetCourt.name, cNum));
      const matchSnapshots = buildPlayerSnapshots(
        [
          existing.teamA.player1Id,
          existing.teamA.player2Id,
          existing.teamB.player1Id,
          existing.teamB.player2Id,
        ],
        allKnownPlayersMap
      );

      const completedMatch: CourtMatch = {
        ...existing,
        courtName: displayCourtName,
        status: 'completed',
        completedAt: turnNow,
        elapsedSeconds: existing.startedAt
          ? Math.max(0, Math.floor((turnNow - existing.startedAt) / 1000))
          : undefined,
        playerSnapshots: matchSnapshots,
      };

      applyMatchCompletionToPlayers(existing, existing.id);

      setRoundHistory((prevHistory) => {
        const roundNum = completedMatch.round || 1;
        const existingRoundIndex = prevHistory.findIndex((r) => r.roundNumber === roundNum);

        if (existingRoundIndex >= 0) {
          const existingRound = prevHistory[existingRoundIndex];
          const matchExists = existingRound.matches.some((m) => m.id === completedMatch.id);
          const updatedMatches = matchExists
            ? existingRound.matches.map((m) =>
                m.id === completedMatch.id ? completedMatch : m
              )
            : [...existingRound.matches, completedMatch];

          const newHistory = [...prevHistory];
          newHistory[existingRoundIndex] = {
            ...existingRound,
            matches: updatedMatches,
            timestamp: turnNow,
          };
          return newHistory;
        } else {
          return [
            ...prevHistory,
            {
              roundNumber: roundNum,
              matches: [completedMatch],
              restingPlayerIds: restingPlayers.map((p) => p.id),
              timestamp: turnNow,
            },
          ];
        }
      });

      setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
    }

    setCourts((prevCourts) =>
      prevCourts.map((c) => {
        if (Number(c.courtNumber) !== cNum) return c;
        const nextHistory = currentCone
          ? [
              ...(c.turnHistory || []),
              {
                prevConeId: currentCone.id,
                prevTurnColor: currentCone.color,
                completedMatchId: existing?.id,
              },
            ]
          : c.turnHistory || [];
        return {
          ...c,
          cones: rotatedCones,
          currentConeIndex: nextIndex,
          turnStartedAt: turnNow,
          turnHistory: nextHistory,
        };
      })
    );

    if (nextCone.color === 'gray') {
      if (!existing) {
        setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
      }
      soundEffects.playScorePoint();
    } else {
      soundEffects.playWhistle();
    }

    return nextCone;
  };

  // Add a new court
  const handleAddCourt = (name?: string) => {
    const nextNum =
      courts.length > 0 ? Math.max(...courts.map((c) => c.courtNumber)) + 1 : 1;
    const now = Date.now();
    const formattedName = formatCourtName(extractCourtNumberLabel(name, nextNum));
    const newCourt: CourtInfo = {
      id: 'court_' + now,
      courtNumber: nextNum,
      name: formattedName,
      cones: [
        { id: 'c_' + now + '_1', color: 'red', label: '우리클럽', orderNumber: 1 },
      ],
      currentConeIndex: 0,
      turnStartedAt: now,
    };
    setCourts((prev) => [...prev, newCourt]);
    setOptions((prev) => ({ ...prev, courtCount: courts.length + 1 }));
  };

  // Real-time synchronization between courts.length and options.courtCount
  useEffect(() => {
    setOptions((prev) =>
      prev.courtCount === courts.length ? prev : { ...prev, courtCount: courts.length }
    );
  }, [courts.length]);

  // Helper to record match outcome & partner/opponent history on players
  const applyMatchCompletionToPlayers = (
    targetMatch: CourtMatch,
    matchIdToExclude: string
  ) => {
    const pA1 = targetMatch.teamA.player1Id;
    const pA2 = targetMatch.teamA.player2Id;
    const pB1 = targetMatch.teamB.player1Id;
    const pB2 = targetMatch.teamB.player2Id;
    const teamAIds = new Set([pA1, pA2]);
    const teamBIds = new Set([pB1, pB2]);
    const courtPlayerIds = new Set([pA1, pA2, pB1, pB2].filter(Boolean));

    const otherCourtsPlayingIds = new Set<string>();
    activeMatches.forEach((m) => {
      if (m.id !== matchIdToExclude) {
        [m.teamA.player1Id, m.teamA.player2Id, m.teamB.player1Id, m.teamB.player2Id].forEach((id) => {
          if (id) otherCourtsPlayingIds.add(id);
        });
      }
    });

    const updatePlayer = (p: Player): Player => {
      if (courtPlayerIds.has(p.id)) {
        const isTeamA = teamAIds.has(p.id);
        const partnerId = isTeamA
          ? (p.id === pA1 ? pA2 : pA1)
          : (p.id === pB1 ? pB2 : pB1);
        const opponents = isTeamA ? [pB1, pB2].filter(Boolean) : [pA1, pA2].filter(Boolean);

        const newPartnerHistory = { ...(p.partnerHistory || {}) };
        if (partnerId) {
          newPartnerHistory[partnerId] = (newPartnerHistory[partnerId] || 0) + 1;
        }

        const newOpponentHistory = { ...(p.opponentHistory || {}) };
        opponents.forEach((oppId) => {
          newOpponentHistory[oppId] = (newOpponentHistory[oppId] || 0) + 1;
        });

        const isWin = isTeamA ? targetMatch.winner === 'teamA' : targetMatch.winner === 'teamB';
        const isLoss = isTeamA ? targetMatch.winner === 'teamB' : targetMatch.winner === 'teamA';
        const pointsWon = isTeamA ? (targetMatch.teamA.score || 0) : (targetMatch.teamB.score || 0);
        const pointsLost = isTeamA ? (targetMatch.teamB.score || 0) : (targetMatch.teamA.score || 0);

        const prevGamesPlayed = p.gamesPlayed || 0;
        const ensuredInitialGamesPlayed =
          p.specialStatus === 'last_match' && p.lastMatchInitialGamesPlayed === undefined
            ? prevGamesPlayed
            : p.lastMatchInitialGamesPlayed;

        return {
          ...p,
          gamesPlayed: prevGamesPlayed + 1,
          lastMatchInitialGamesPlayed: ensuredInitialGamesPlayed,
          consecutiveRestRounds: 0,
          partnerHistory: newPartnerHistory,
          opponentHistory: newOpponentHistory,
          lastPartnerId: partnerId || p.lastPartnerId,
          lastOpponentIds: opponents.filter(Boolean).length > 0 ? opponents.filter(Boolean) : p.lastOpponentIds,
          wins: (p.wins || 0) + (isWin ? 1 : 0),
          losses: (p.losses || 0) + (isLoss ? 1 : 0),
          totalPointsWon: (p.totalPointsWon || 0) + pointsWon,
          totalPointsLost: (p.totalPointsLost || 0) + pointsLost,
        };
      } else if (otherCourtsPlayingIds.has(p.id)) {
        return { ...p, consecutiveRestRounds: 0 };
      } else if (
        p.isActive &&
        p.specialStatus !== 'resting' &&
        p.specialStatus !== 'lesson' &&
        p.specialStatus !== 'exited'
      ) {
        return { ...p, consecutiveRestRounds: (p.consecutiveRestRounds || 0) + 1 };
      }
      return p;
    };

    setPlayers((prev) => prev.map(updatePlayer));

    setArchivedPlayers((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((pid) => {
        updated[pid] = updatePlayer(updated[pid]);
      });
      saveArchivedPlayersToStorage(updated);
      return updated;
    });
  };

  // Remove a court: if active match with participants exists, complete it and record in match history!
  const handleRemoveCourt = (courtNumber: number) => {
    const cNum = Number(courtNumber);
    const targetMatch = activeMatches.find((m) => Number(m.courtNumber) === cNum);
    const targetCourt = courts.find((c) => Number(c.courtNumber) === cNum);
    const courtName = formatCourtName(extractCourtNumberLabel(targetCourt?.name, cNum));

    if (targetMatch) {
      const matchSnapshots = buildPlayerSnapshots(
        [
          targetMatch.teamA.player1Id,
          targetMatch.teamA.player2Id,
          targetMatch.teamB.player1Id,
          targetMatch.teamB.player2Id,
        ],
        allKnownPlayersMap
      );

      const now = Date.now();
      const completedMatch: CourtMatch = {
        ...targetMatch,
        courtName,
        status: 'completed',
        completedAt: now,
        elapsedSeconds: targetMatch.startedAt
          ? Math.max(0, Math.floor((now - targetMatch.startedAt) / 1000))
          : undefined,
        playerSnapshots: matchSnapshots,
      };

      // Increment gamesPlayed, update partnerHistory/opponentHistory and consecutive rests
      applyMatchCompletionToPlayers(targetMatch, targetMatch.id);

      // Immediately archive this completed court match and its participants into history
      setRoundHistory((prevHistory) => {
        const roundNum = completedMatch.round || 1;
        const existingRoundIndex = prevHistory.findIndex((r) => r.roundNumber === roundNum);

        if (existingRoundIndex >= 0) {
          const existingRound = prevHistory[existingRoundIndex];
          const matchExists = existingRound.matches.some((m) => m.id === completedMatch.id);
          const updatedMatches = matchExists
            ? existingRound.matches.map((m) =>
                m.id === completedMatch.id ? completedMatch : m
              )
            : [...existingRound.matches, completedMatch];

          const newHistory = [...prevHistory];
          newHistory[existingRoundIndex] = {
            ...existingRound,
            matches: updatedMatches,
            timestamp: Date.now(),
          };
          return newHistory;
        } else {
          return [
            ...prevHistory,
            {
              roundNumber: roundNum,
              matches: [completedMatch],
              restingPlayerIds: restingPlayers.map((p) => p.id),
              timestamp: Date.now(),
            },
          ];
        }
      });
    }

    // Remove from active matches and courts
    setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
    setCourts((prev) => prev.filter((c) => Number(c.courtNumber) !== cNum));
    setOptions((prev) => ({ ...prev, courtCount: Math.max(0, courts.length - 1) }));
    soundEffects.playWhistle();
  };

  // Rename a court (제n코트에서 n 변경 시 코트현황, 대기열, 배정선수관리, 대진기록 등 모든 메뉴에 즉시 반영)
  const handleRenameCourt = (courtNumber: number, newName: string) => {
    const formattedName = formatCourtName(extractCourtNumberLabel(newName, courtNumber));
    setCourts((prev) =>
      prev.map((c) => (c.courtNumber === courtNumber ? { ...c, name: formattedName } : c))
    );
    setActiveMatches((prev) =>
      prev.map((m) =>
        Number(m.courtNumber) === Number(courtNumber) ? { ...m, courtName: formattedName } : m
      )
    );
    setRoundHistory((prev) =>
      prev.map((round) => ({
        ...round,
        matches: round.matches.map((m) =>
          Number(m.courtNumber) === Number(courtNumber) ? { ...m, courtName: formattedName } : m
        ),
      }))
    );
  };

  // Update Cones and Index for a Court
  const handleUpdateCourtCones = (
    courtNumber: number,
    newCones: ConeItem[],
    currentConeIndex: number
  ) => {
    const cNum = Number(courtNumber);
    const normalizedCones = getNormalizedTurnQueue(newCones, currentConeIndex);
    const nextActiveCone = normalizedCones[0];

    setCourts((prev) =>
      prev.map((c) => {
        if (Number(c.courtNumber) !== cNum) return c;
        const prevCones = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
        const prevActive = prevCones[0] || null;
        const didActiveConeChange = prevActive?.id !== nextActiveCone?.id;
        const validConeIds = new Set(normalizedCones.map((cone) => cone.id));
        const filteredHistory = (c.turnHistory || []).filter((entry) =>
          validConeIds.has(entry.prevConeId)
        );
        return {
          ...c,
          cones: normalizedCones,
          currentConeIndex: 0,
          turnStartedAt: didActiveConeChange ? Date.now() : c.turnStartedAt,
          turnHistory: filteredHistory,
        };
      })
    );

    if (nextActiveCone?.color === 'gray') {
      const existingActive = activeMatches.find(
        (m) => Number(m.courtNumber) === cNum && m.status !== 'completed'
      );
      if (existingActive) {
        const returnedToQueue: CourtMatch = {
          ...existingActive,
          id: existingActive.id.startsWith('queued-')
            ? existingActive.id
            : `queued-${Date.now()}`,
          courtNumber: 0,
          courtName: undefined,
          status: 'queued',
          startedAt: existingActive.startedAt || Date.now(),
          completedAt: undefined,
          winner: undefined,
        };
        setQueuedMatches((prev) =>
          orderQueuedMatchesWithSpecial(
            [returnedToQueue, ...prev],
            players,
            activeMatches.filter((m) => Number(m.courtNumber) !== cNum),
            getEnrichedOptions(options)
          )
        );
        setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
      }
    }
  };

  // Quick preset for court counts (e.g. 2, 3, 4 courts)
  const handleSetCourtsPreset = (count: number) => {
    soundEffects.playRacketHit();
    const now = Date.now();
    const newCourts: CourtInfo[] = Array.from({ length: count }, (_, i) => ({
      id: `court_${i + 1}`,
      courtNumber: i + 1,
      name: formatCourtName(i + 1),
      cones: [
        { id: `c_${i + 1}_1`, color: 'red', label: '우리클럽', orderNumber: 1 },
      ],
      currentConeIndex: 0,
      turnStartedAt: now,
    }));
    setCourts(newCourts);
    setOptions((prev) => ({ ...prev, courtCount: count }));
  };

  // Helper to enrich MatchOptions with current session match counts and live court count
  const getEnrichedOptions = (baseOptions: MatchOptions): MatchOptions => {
    const allSessionMatches = [...allCompletedMatches, ...activeMatches, ...queuedMatches];
    const totalSessionMatches = allSessionMatches.length;
    const mixedSessionMatches = allSessionMatches.filter(
      (m) => m.title?.includes('혼복')
    ).length;
    const liveCourtCount =
      courts.length > 0 ? courts.length : Math.max(1, baseOptions.courtCount || 1);

    return {
      ...baseOptions,
      courtCount: liveCourtCount,
      totalSessionMatches,
      mixedSessionMatches,
    };
  };

  // 스페셜 게임이 대기열에 있을 때, 출전 차례 도래(오로라 표시) 시 대기열 젤 첫번째 순서(1순위)로 자동 이동시키고,
  // 아직 차례가 되지 않은 스페셜 게임은 항상 대기열 최하단에 위치하도록 모든 상태 변화에 반응하여 정렬 유지
  useEffect(() => {
    if (!queuedMatches.some((m) => Boolean(m.isSpecialMatch))) return;
    const ordered = orderQueuedMatchesWithSpecial(
      queuedMatches,
      players,
      activeMatches,
      getEnrichedOptions(options)
    );
    if (ordered !== queuedMatches) {
      setQueuedMatches(ordered);
    }
  }, [queuedMatches, players, activeMatches, options, courts.length, allCompletedMatches.length]);

  // Generate Match for a Single Empty Court from Resting Players
  const handleGenerateForCourt = (courtNumber: number, pregeneratedMatch?: CourtMatch) => {
    try {
      const nextRoundNum = currentRound + 1;
      let match: CourtMatch;
      let assignedPlayerIds: string[];

      if (pregeneratedMatch) {
        match = pregeneratedMatch;
        assignedPlayerIds = [
          pregeneratedMatch.teamA.player1Id,
          pregeneratedMatch.teamA.player2Id,
          pregeneratedMatch.teamB.player1Id,
          pregeneratedMatch.teamB.player2Id,
        ].filter(Boolean);
        const formedPlayers = assignedPlayerIds
          .map((id) => players.find((p) => p.id === id))
          .filter((p): p is Player => Boolean(p));
        if (formedPlayers.length === 4) {
          recordFormedMatchTierPattern(formedPlayers);
        }
      } else {
        const generated = generateSingleCourtMatch(
          players,
          getEnrichedOptions(options),
          nextRoundNum,
          courtNumber,
          activePlayingIds,
          queuedMatches,
          activeMatches
        );
        match = generated.match;
        assignedPlayerIds = generated.assignedPlayerIds;
      }

      const now = Date.now();
      const targetCourt = courts.find((c) => Number(c.courtNumber) === Number(courtNumber));
      const matchWithTime: CourtMatch = {
        ...match,
        courtNumber,
        courtName: formatCourtName(extractCourtNumberLabel(targetCourt?.name, courtNumber)),
        startedAt: now,
        playerAssignedAt: {
          [match.teamA.player1Id]: now,
          [match.teamA.player2Id]: now,
          [match.teamB.player1Id]: now,
          [match.teamB.player2Id]: now,
        },
      };

      setActiveMatches((prev) => {
        const filtered = prev.filter((m) => m.courtNumber !== courtNumber);
        return [...filtered, matchWithTime].sort((a, b) => a.courtNumber - b.courtNumber);
      });

      // If the court cone was gray (other club), switch cone queue to first red (our club) and update turnStartedAt
      setCourts((prevCourts) =>
        prevCourts.map((c) => {
          if (c.courtNumber !== courtNumber) return c;
          const currentQueue = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
          const currentActiveCone = currentQueue[0] || null;
          const { cones: rotated, currentConeIndex: nextIdx } = rotateQueueToFirstRedCone(
            c.cones || [],
            c.currentConeIndex || 0
          );
          const nextHistory =
            currentActiveCone?.color === 'gray'
              ? [
                  ...(c.turnHistory || []),
                  { prevConeId: currentActiveCone.id, prevTurnColor: 'gray' as const },
                ]
              : c.turnHistory || [];
          return {
            ...c,
            cones: rotated,
            currentConeIndex: nextIdx,
            turnStartedAt: now,
            turnHistory: nextHistory,
          };
        })
      );

      const assignedSet = new Set(assignedPlayerIds);
      setPlayers((prev) =>
        prev.map((p) =>
          assignedSet.has(p.id) ? { ...p, consecutiveRestRounds: 0 } : p
        )
      );

      setConflictMatchTargetCourts({});
      soundEffects.playWhistle();
      setAssignQueueModalCourt(null);
    } catch (err: unknown) {
      soundEffects.playRacketHit();
      const message = err instanceof Error ? err.message : '경기 생성에 실패했습니다.';
      setAppAlertMessage(message);
    }
  };

  // Clear match from court back to empty state
  const handleClearCourtMatch = (courtNumber: number) => {
    setActiveMatches((prev) => prev.filter((m) => m.courtNumber !== courtNumber));
  };

  // Revert court to previous match team (전 경기 팀으로 되돌리기)
  // 1. 전경기의 꼬깔이 다른클럽(회색) 꼬깔인 경우:
  //    - 꼬깔을 직전 다른클럽 꼬깔로 되돌리고, 현재 코트의 진행 중 경기를 대기열로 복귀시킨 뒤 다른클럽 카드(OtherClubCourtCard)로 복원
  // 2. 전경기의 꼬깔이 우리클럽(빨간색) 꼬깔이고 대진기록에 전 경기가 있는 경우:
  //    - 꼬깔을 직전 빨간색 꼬깔로 되돌리고, 직전 완료 경기를 다시 코트의 in_progress로 복귀
  //    - 대진 기록에서 해당 경기 삭제 및 투입 선수 4명의 gamesPlayed/전적 차감
  // 3. 대진기록에 해당 코트의 전 경기가 없고 직전 다른클럽 꼬깔 턴도 없는 경우:
  //    - 코트에 선수가 배정되어 있다면 해당 팀을 게임목록 대기열 맨 앞으로 보내고 코트는 빈 코트로 만들며 꼬깔 이동은 하지 않음
  //    - 코트에 배정된 팀도 없다면 아무 동작도 하지 않음
  const handleRevertPreviousMatch = (courtNumber: number) => {
    const cNum = Number(courtNumber);
    const targetCourt = courts.find((c) => Number(c.courtNumber) === cNum);
    if (!targetCourt) return;

    const prevMatch = allCompletedMatches.find(
      (m) => Number(m.courtNumber) === cNum
    );

    const currentActive = activeMatches.find(
      (m) => Number(m.courtNumber) === cNum
    );

    const turnHistory = targetCourt.turnHistory || [];
    const lastTurn = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : undefined;
    const hasPrevGrayTurn =
      lastTurn?.prevTurnColor === 'gray' &&
      (targetCourt.cones || []).some((c) => c.color === 'gray');

    // 1. 직전 턴이 다른클럽(회색) 꼬깔이었던 경우:
    //    현재 코트에 배정된 팀이 있다면 대기열 맨 앞으로 복귀시키고,
    //    코트를 비운 뒤 꼬깔을 직전 다른클럽(회색) 꼬깔로 복원 (대진 기록은 유지)
    if (hasPrevGrayTurn && lastTurn) {
      if (currentActive) {
        const returnedToQueue: CourtMatch = {
          ...currentActive,
          id: currentActive.id.startsWith('queued-') ? currentActive.id : `queued-${Date.now()}`,
          courtNumber: 0,
          courtName: undefined,
          status: 'queued',
          title: currentActive.title || `대기 복귀 경기`,
          startedAt: currentActive.startedAt || Date.now(),
          completedAt: undefined,
          winner: undefined,
        };
        setQueuedMatches((prev) =>
          orderQueuedMatchesWithSpecial(
            [returnedToQueue, ...prev],
            players,
            activeMatches.filter((m) => Number(m.courtNumber) !== cNum),
            getEnrichedOptions(options)
          )
        );
        setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
        if (selectedSwap?.matchId === currentActive.id) {
          setSelectedSwap(null);
        }
        if (gameListSwapSelection?.matchId === currentActive.id) {
          setGameListSwapSelection(null);
        }
      }

      const { cones: revertedCones, currentConeIndex: revertedIdx } = revertConeToTarget(
        targetCourt.cones || [],
        targetCourt.currentConeIndex || 0,
        lastTurn.prevConeId,
        'gray'
      );

      const restoreNow = Date.now();
      setCourts((prevCourts) =>
        prevCourts.map((c) => {
          if (Number(c.courtNumber) !== cNum) return c;
          const nextHistory = (c.turnHistory || []).slice(0, -1);
          return {
            ...c,
            cones: revertedCones,
            currentConeIndex: revertedIdx,
            turnStartedAt: restoreNow,
            turnHistory: nextHistory,
          };
        })
      );

      setConflictMatchTargetCourts({});
      soundEffects.playWhistle();
      return;
    }

    // 2. 대진기록에 해당 코트의 전 경기가 없는 경우 (직전 회색 꼬깔 턴도 없음):
    //    - 코트에 선수가 배정되어 있다면 해당 팀을 게임목록 대기열 맨 앞으로 보내고 코트는 빈 코트로 만들며 꼬깔 이동은 하지 않음
    //    - 코트에 배정된 팀도 없다면 아무 동작도 하지 않음
    if (!prevMatch) {
      if (currentActive) {
        const returnedToQueue: CourtMatch = {
          ...currentActive,
          id: currentActive.id.startsWith('queued-') ? currentActive.id : `queued-${Date.now()}`,
          courtNumber: 0,
          courtName: undefined,
          status: 'queued',
          title: currentActive.title || `대기 복귀 경기`,
          startedAt: currentActive.startedAt || Date.now(),
          completedAt: undefined,
          winner: undefined,
        };
        setQueuedMatches((prev) =>
          orderQueuedMatchesWithSpecial(
            [returnedToQueue, ...prev],
            players,
            activeMatches.filter((m) => Number(m.courtNumber) !== cNum),
            getEnrichedOptions(options)
          )
        );
        setActiveMatches((prev) =>
          prev.filter((m) => Number(m.courtNumber) !== cNum)
        );
        if (selectedSwap?.matchId === currentActive.id) {
          setSelectedSwap(null);
        }
        if (gameListSwapSelection?.matchId === currentActive.id) {
          setGameListSwapSelection(null);
        }
        setConflictMatchTargetCourts({});
        soundEffects.playWhistle();
      }
      return;
    }

    // 3. 직전 우리클럽 완료 경기(prevMatch)가 존재하는 경우:
    // (1) 현재 코트에 진행 중/배정된 팀이 있다면 다음 경기 대기열(queuedMatches) 맨 앞으로 복귀
    if (currentActive) {
      const returnedToQueue: CourtMatch = {
        ...currentActive,
        id: currentActive.id.startsWith('queued-') ? currentActive.id : `queued-${Date.now()}`,
        courtNumber: 0,
        courtName: undefined,
        status: 'queued',
        title: currentActive.title || `대기 복귀 경기`,
        startedAt: currentActive.startedAt || Date.now(),
        completedAt: undefined,
        winner: undefined,
      };
      setQueuedMatches((prev) =>
        orderQueuedMatchesWithSpecial(
          [returnedToQueue, ...prev],
          players,
          activeMatches,
          getEnrichedOptions(options)
        )
      );
      if (selectedSwap?.matchId === currentActive.id) {
        setSelectedSwap(null);
      }
      if (gameListSwapSelection?.matchId === currentActive.id) {
        setGameListSwapSelection(null);
      }
    }

    // (2) 꼬깔을 직전 우리클럽(빨간) 꼬깔로 되돌리기 (복원된 우리클럽 경기가 화면에 바로 표시되도록 회색 꼬깔이면 빨간 꼬깔로 회전)
    const {
      cones: revertedCones,
      currentConeIndex: revertedIdx,
      activeCone: prevCone,
    } = revertConeToTarget(
      targetCourt.cones || [],
      targetCourt.currentConeIndex || 0,
      lastTurn?.prevConeId,
      'red'
    );

    const finalConeState =
      prevCone?.color === 'gray'
        ? rotateQueueToFirstRedCone(revertedCones, revertedIdx)
        : { cones: revertedCones, currentConeIndex: revertedIdx };

    const restoreNow = Date.now();
    if (finalConeState.cones.length > 0) {
      setCourts((prevCourts) =>
        prevCourts.map((c) => {
          if (Number(c.courtNumber) !== cNum) return c;
          const nextHistory =
            c.turnHistory && c.turnHistory.length > 0
              ? c.turnHistory.slice(0, -1)
              : [];
          return {
            ...c,
            cones: finalConeState.cones,
            currentConeIndex: finalConeState.currentConeIndex,
            turnStartedAt: restoreNow,
            turnHistory: nextHistory,
          };
        })
      );
    }

    // (3) 직전 경기 팀을 해당 코트에 다시 투입 (진행 중)
    const restoredMatch: CourtMatch = {
      ...prevMatch,
      status: 'in_progress',
      startedAt: restoreNow,
      completedAt: undefined,
      winner: undefined,
    };

    setActiveMatches((prev) => {
      const remaining = prev.filter((m) => Number(m.courtNumber) !== cNum);
      return [...remaining, restoredMatch].sort((a, b) => a.courtNumber - b.courtNumber);
    });

    // (4) 대진 기록(roundHistory)에서 해당 경기 제거
    setRoundHistory((prevHistory) =>
      prevHistory
        .map((round) => ({
          ...round,
          matches: round.matches.filter((m) => m.id !== prevMatch.id),
        }))
        .filter((round) => round.matches.length > 0)
    );

    // (5) 다시 투입된 선수 4명의 gamesPlayed 1 차감 (진행 수 복구) 및 파트너/상대/승패 이력 롤백
    const pA1 = prevMatch.teamA.player1Id;
    const pA2 = prevMatch.teamA.player2Id;
    const pB1 = prevMatch.teamB.player1Id;
    const pB2 = prevMatch.teamB.player2Id;
    const teamAIds = new Set([pA1, pA2]);
    const restoredPlayerIds = new Set([pA1, pA2, pB1, pB2].filter(Boolean));

    const revertPlayer = (p: Player): Player => {
      if (restoredPlayerIds.has(p.id)) {
        const isTeamA = teamAIds.has(p.id);
        const partnerId = isTeamA
          ? (p.id === pA1 ? pA2 : pA1)
          : (p.id === pB1 ? pB2 : pB1);
        const opponents = isTeamA ? [pB1, pB2].filter(Boolean) : [pA1, pA2].filter(Boolean);

        const newPartnerHistory = { ...(p.partnerHistory || {}) };
        if (partnerId && newPartnerHistory[partnerId]) {
          newPartnerHistory[partnerId] = Math.max(0, newPartnerHistory[partnerId] - 1);
          if (newPartnerHistory[partnerId] === 0) {
            delete newPartnerHistory[partnerId];
          }
        }

        const newOpponentHistory = { ...(p.opponentHistory || {}) };
        opponents.forEach((oppId) => {
          if (oppId && newOpponentHistory[oppId]) {
            newOpponentHistory[oppId] = Math.max(0, newOpponentHistory[oppId] - 1);
            if (newOpponentHistory[oppId] === 0) {
              delete newOpponentHistory[oppId];
            }
          }
        });

        const wasWin = isTeamA ? prevMatch.winner === 'teamA' : prevMatch.winner === 'teamB';
        const wasLoss = isTeamA ? prevMatch.winner === 'teamB' : prevMatch.winner === 'teamA';
        const pointsWon = isTeamA ? (prevMatch.teamA.score || 0) : (prevMatch.teamB.score || 0);
        const pointsLost = isTeamA ? (prevMatch.teamB.score || 0) : (prevMatch.teamA.score || 0);

        return {
          ...p,
          gamesPlayed: Math.max(0, p.gamesPlayed - 1),
          consecutiveRestRounds: 0,
          partnerHistory: newPartnerHistory,
          opponentHistory: newOpponentHistory,
          lastPartnerId: p.lastPartnerId === partnerId ? undefined : p.lastPartnerId,
          lastOpponentIds:
            p.lastOpponentIds &&
            opponents.some((oppId) => oppId && p.lastOpponentIds?.includes(oppId))
              ? undefined
              : p.lastOpponentIds,
          wins: Math.max(0, (p.wins || 0) - (wasWin ? 1 : 0)),
          losses: Math.max(0, (p.losses || 0) - (wasLoss ? 1 : 0)),
          totalPointsWon: Math.max(0, (p.totalPointsWon || 0) - pointsWon),
          totalPointsLost: Math.max(0, (p.totalPointsLost || 0) - pointsLost),
        };
      } else if (p.isActive) {
        return { ...p, consecutiveRestRounds: Math.max(0, (p.consecutiveRestRounds || 1) - 1) };
      }
      return p;
    };

    setPlayers((prev) => prev.map(revertPlayer));
    setArchivedPlayers((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((pid) => {
        updated[pid] = revertPlayer(updated[pid]);
      });
      saveArchivedPlayersToStorage(updated);
      return updated;
    });

    setConflictMatchTargetCourts({});
    soundEffects.playWhistle();
  };

  // -------------------------------------------------------------
  // Full Matchmaking Handlers
  // -------------------------------------------------------------

  // Generate Matches Directly for Active Courts (targets courts where active cone is RED)
  const handleConfirmGenerateActive = () => {
    try {
      // Find courts where active cone is Red (our turn)
      const ourAvailableCourts = courts.filter((c) => {
        const queue = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
        return queue[0]?.color === 'red';
      });

      const effectiveCourtCount =
        ourAvailableCourts.length > 0 ? ourAvailableCourts.length : courts.length;

      const nextRoundNum = currentRound + 1;
      const matchmakerOptions = getEnrichedOptions({
        ...options,
        courtCount: effectiveCourtCount,
      });

      const result = generateDoublesMatches(
        players,
        matchmakerOptions,
        nextRoundNum,
        queuedMatches,
        activeMatches
      );

      // Map generated matches to the actual court numbers of available red courts
      const baseNow = Date.now();
      const mappedMatches = result.matches.map((m, idx) => {
        const assignedCourt = ourAvailableCourts[idx] || courts[idx];
        const matchNow = baseNow + idx;
        return {
          ...m,
          courtNumber: assignedCourt ? assignedCourt.courtNumber : idx + 1,
          startedAt: matchNow,
          playerAssignedAt: {
            [m.teamA.player1Id]: matchNow,
            [m.teamA.player2Id]: matchNow,
            [m.teamB.player1Id]: matchNow,
            [m.teamB.player2Id]: matchNow,
          },
        };
      });

      setActiveMatches(mappedMatches);
      setPlayers(result.updatedPlayers);
      setSelectedSwap(null);
      setSelectedBenchPlayerIds([]);
      setActiveTab('courts');
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '경기 생성에 실패했습니다.';
      setAppAlertMessage(message);
    }
  };

  // Pre-generate upcoming matches into the Queue (게임 목록 대기열)
  const handleConfirmGenerateQueue = (count: number) => {
    handlePreGenerateQueueMatches(count, false);
  };

  // Quick 1 or N game pre-generation from GameListView
  const handlePreGenerateQuick = (count: number) => {
    handlePreGenerateQueueMatches(count, true);
  };

  // Generate matches for queue prioritized strictly by arrival order (참가순 게임 생성)
  const handleGenerateByArrivalOrder = () => {
    try {
      const newMatches = generateQueueMatchesByArrivalOrder(
        players,
        activePlayingIds,
        queuedMatches,
        getEnrichedOptions(options),
        undefined,
        activeMatches
      );

      setQueuedMatches((prev) =>
        orderQueuedMatchesWithSpecial(
          [...prev, ...newMatches],
          players,
          activeMatches,
          getEnrichedOptions(options)
        )
      );
      setActiveTab('games');
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '참가순 게임 생성에 실패했습니다.';
      setAppAlertMessage(message);
    }
  };

  // Send a Queued Match onto a specific court (if court has an active match, completes it first and assigns the queued match)
  const handleSendToCourt = (
    matchId: string,
    courtNumber: number,
    allowDuplicatePlayer: boolean = false
  ): 'assigned' | 'failed_other_club' | 'failed_duplicate_player' | 'invalid' => {
    const cNum = Number(courtNumber);
    const targetCourt = courts.find((c) => Number(c.courtNumber) === cNum);
    const cones = getNormalizedTurnQueue(
      targetCourt?.cones || [],
      targetCourt?.currentConeIndex || 0
    );
    const activeCone = cones[0] || null;

    // 다른클럽 꼬깔(회색)일 때는 코트 투입 금지
    if (activeCone?.color === 'gray') {
      soundEffects.playScorePoint();
      return 'failed_other_club';
    }

    const matchToSend = queuedMatches.find((m) => m.id === matchId);
    if (!matchToSend) return 'invalid';

    if (
      matchToSend.isSpecialMatch &&
      !isSpecialMatchTurnReady(
        matchToSend,
        players,
        activeMatches,
        queuedMatches,
        getEnrichedOptions(options)
      )
    ) {
      soundEffects.playScorePoint();
      return 'invalid';
    }

    const sendNow = Date.now();
    const displayCourtName = formatCourtName(extractCourtNumberLabel(targetCourt?.name, cNum));

    // Check if court already has an existing active match
    const existing = activeMatches.find(
      (m) => Number(m.courtNumber) === cNum && m.status !== 'completed'
    );

    // 게임목록 대기열에서 코트배정 버튼을 눌렀을 때만 타 코트 동일 선수 운동 중 여부 차단
    // (코트현황에서는 타코트 배정자가 있어도 코트에 정상 투입되며 코트 카드에서 주황색 교체 안내 표시)
    const isNextConeOtherClubOnOccupied =
      Boolean(existing) &&
      Boolean(targetCourt) &&
      cones.length > 0 &&
      cones[1 % cones.length]?.color === 'gray';

    if (!allowDuplicatePlayer && !isNextConeOtherClubOnOccupied) {
      const duplicateIds = getDuplicatePlayersOnOtherCourts(matchToSend, cNum);
      if (duplicateIds.length > 0) {
        setConflictMatchTargetCourts({
          [matchToSend.id]: cNum,
        });
        soundEffects.playScorePoint();
        return 'failed_duplicate_player';
      }
    }

    if (existing) {
      const matchSnapshots = buildPlayerSnapshots(
        [
          existing.teamA.player1Id,
          existing.teamA.player2Id,
          existing.teamB.player1Id,
          existing.teamB.player2Id,
        ],
        allKnownPlayersMap
      );

      const completedMatch: CourtMatch = {
        ...existing,
        courtName: displayCourtName,
        status: 'completed',
        completedAt: sendNow,
        elapsedSeconds: existing.startedAt
          ? Math.max(0, Math.floor((sendNow - existing.startedAt) / 1000))
          : undefined,
        playerSnapshots: matchSnapshots,
      };

      // 1. Increment gamesPlayed, update partnerHistory/opponentHistory and consecutive rests for completed match
      applyMatchCompletionToPlayers(existing, existing.id);

      // 2. Archive completed match into roundHistory (대진 기록 반영)
      setRoundHistory((prevHistory) => {
        const roundNum = completedMatch.round || 1;
        const existingRoundIndex = prevHistory.findIndex((r) => r.roundNumber === roundNum);

        if (existingRoundIndex >= 0) {
          const existingRound = prevHistory[existingRoundIndex];
          const matchExists = existingRound.matches.some((m) => m.id === completedMatch.id);
          const updatedMatches = matchExists
            ? existingRound.matches.map((m) =>
                m.id === completedMatch.id ? completedMatch : m
              )
            : [...existingRound.matches, completedMatch];

          const newHistory = [...prevHistory];
          newHistory[existingRoundIndex] = {
            ...existingRound,
            matches: updatedMatches,
            timestamp: sendNow,
          };
          return newHistory;
        } else {
          return [
            ...prevHistory,
            {
              roundNumber: roundNum,
              matches: [completedMatch],
              restingPlayerIds: restingPlayers.map((p) => p.id),
              timestamp: sendNow,
            },
          ];
        }
      });

      // 3. 코트현황의 코트의 다음 꼬깔이 회색꼬깔(다른클럽꼬깔)일 때:
      //    꼬깔을 회색(다른클럽)으로 순환 이동시키고, 진행중 경기는 비우며 대기 경기는 배정하지 않음!
      if (targetCourt && cones.length > 0) {
        const {
          cones: rotatedCones,
          currentConeIndex: nextIdx,
          activeCone: nextCone,
          prevCone: completedCone,
        } = advanceConeTurnQueue(targetCourt.cones || [], targetCourt.currentConeIndex || 0);
        if (nextCone?.color === 'gray') {
          setCourts((prevCourts) =>
            prevCourts.map((c) => {
              if (Number(c.courtNumber) !== cNum) return c;
              const nextHistory = completedCone
                ? [
                    ...(c.turnHistory || []),
                    {
                      prevConeId: completedCone.id,
                      prevTurnColor: completedCone.color,
                      completedMatchId: existing.id,
                    },
                  ]
                : c.turnHistory || [];
              return {
                ...c,
                cones: rotatedCones,
                currentConeIndex: nextIdx,
                turnStartedAt: sendNow,
                turnHistory: nextHistory,
              };
            })
          );
          setActiveMatches((prev) => prev.filter((m) => Number(m.courtNumber) !== cNum));
          soundEffects.playScorePoint();
          return 'failed_other_club';
        }
      }
    }

    // Ensure court's active cone is rotated / set to RED (우리클럽) and timer resets so the deployed match is immediately visible
    setCourts((prevCourts) =>
      prevCourts.map((c) => {
        if (Number(c.courtNumber) !== cNum) return c;
        const courtCones = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
        if (courtCones.length === 0) return { ...c, turnStartedAt: sendNow };
        const completedCone = existing ? courtCones[0] : null;
        const nextHistory = completedCone
          ? [
              ...(c.turnHistory || []),
              {
                prevConeId: completedCone.id,
                prevTurnColor: completedCone.color,
                completedMatchId: existing?.id,
              },
            ]
          : c.turnHistory || [];
        if (existing && courtCones.length > 1) {
          const {
            cones: rotatedCones,
            currentConeIndex: nextIdx,
            activeCone: nextCone,
          } = advanceConeTurnQueue(courtCones, 0);
          if (nextCone?.color === 'red') {
            return {
              ...c,
              cones: rotatedCones,
              currentConeIndex: nextIdx,
              turnStartedAt: sendNow,
              turnHistory: nextHistory,
            };
          }
        }
        const { cones: redQueue, currentConeIndex: redIdx } = rotateQueueToFirstRedCone(
          courtCones,
          0
        );
        return {
          ...c,
          cones: redQueue,
          currentConeIndex: redIdx,
          turnStartedAt: sendNow,
          turnHistory: nextHistory,
        };
      })
    );

    const readyMatch: CourtMatch = {
      ...matchToSend,
      courtNumber: cNum,
      courtName: displayCourtName,
      status: 'in_progress',
      startedAt: sendNow,
      playerAssignedAt: {
        [matchToSend.teamA.player1Id]: sendNow,
        [matchToSend.teamA.player2Id]: sendNow,
        [matchToSend.teamB.player1Id]: sendNow,
        [matchToSend.teamB.player2Id]: sendNow,
      },
    };

    // Update active matches: replace or append
    setActiveMatches((prev) => {
      const filtered = prev.filter((m) => Number(m.courtNumber) !== cNum);
      return [...filtered, readyMatch].sort((a, b) => a.courtNumber - b.courtNumber);
    });

    // Reset consecutive rests for the 4 deployed players
    const deployedIds = new Set(
      [
        matchToSend.teamA.player1Id,
        matchToSend.teamA.player2Id,
        matchToSend.teamB.player1Id,
        matchToSend.teamB.player2Id,
      ].filter(Boolean)
    );

    setPlayers((prev) =>
      prev.map((p) =>
        deployedIds.has(p.id) ? { ...p, consecutiveRestRounds: 0 } : p
      )
    );

    setArchivedPlayers((prev) => {
      const updated = { ...prev };
      let changed = false;
      deployedIds.forEach((pid) => {
        if (updated[pid]) {
          updated[pid] = { ...updated[pid], consecutiveRestRounds: 0 };
          changed = true;
        }
      });
      if (changed) {
        saveArchivedPlayersToStorage(updated);
      }
      return changed ? updated : prev;
    });

    // Remove from queue and clear all conflict highlights when any queued match is deployed
    setConflictMatchTargetCourts({});
    setQueuedMatches((prev) => prev.filter((m) => m.id !== matchId));

    soundEffects.playWhistle();
    return 'assigned';
  };

  // Delete match from queue
  const handleDeleteQueuedMatch = (matchId: string) => {
    setConflictMatchTargetCourts((prev) => {
      if (prev[matchId] === undefined) return prev;
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
    setQueuedMatches((prev) => prev.filter((m) => m.id !== matchId));
  };

  // Move queue order
  const handleMoveQueueOrder = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= queuedMatches.length) return;

    const list = [...queuedMatches];
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);
    setQueuedMatches(
      orderQueuedMatchesWithSpecial(list, players, activeMatches, getEnrichedOptions(options))
    );
  };

  // Helper to reconcile player offsets and consecutive rest states after manual interventions
  // (선수교체, 대기열배정, 코트에배정 등 임의 관여 시 해당 선수 및 교체 선수의 배정/진행 밀림 현상 방지)
  const applyManualInterventionReconciliation = (
    intervenedPlayerIds: Iterable<string>,
    nextActiveMatches: CourtMatch[] = activeMatches,
    nextQueuedMatches: CourtMatch[] = queuedMatches,
    swappedOutToBenchIds: Iterable<string> = []
  ) => {
    setPlayers((prev) => {
      const nextPlayers = reconcileManualPlayerIntervention(
        prev,
        intervenedPlayerIds,
        nextActiveMatches,
        nextQueuedMatches,
        swappedOutToBenchIds
      );
      setArchivedPlayers((prevArch) => {
        const updatedArch = { ...prevArch };
        let changed = false;
        nextPlayers.forEach((np) => {
          if (updatedArch[np.id]) {
            updatedArch[np.id] = {
              ...updatedArch[np.id],
              manualInterventionExempt: np.manualInterventionExempt,
              initialAssignedOffset: np.initialAssignedOffset,
              consecutiveRestRounds: np.consecutiveRestRounds,
              restStartGamesPlayed: np.restStartGamesPlayed,
            };
            changed = true;
          }
        });
        if (changed) {
          saveArchivedPlayersToStorage(updatedArch);
        }
        return changed ? updatedArch : prevArch;
      });
      return nextPlayers;
    });
  };

  // Swap a player between an active court match and a queued match (진행 중인 코트 ↔ 대기열 선수 맞교체)
  const handleSwapActiveAndQueued = (
    activeMatchId: string,
    activePlayerId: string,
    queuedMatchId: string,
    queuedPlayerId: string
  ) => {
    const activeMatch = activeMatches.find((m) => m.id === activeMatchId);
    const queuedMatch = queuedMatches.find((m) => m.id === queuedMatchId);
    if (!activeMatch || !queuedMatch) return;

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
      alert('같은 선수가 있습니다');
      return;
    }

    const swapNow = Date.now();
    const nextActive = activeMatches.map((m) => {
      if (m.id !== activeMatchId) return m;
      const teamA = { ...m.teamA };
      const teamB = { ...m.teamB };
      if (teamA.player1Id === activePlayerId) teamA.player1Id = queuedPlayerId;
      else if (teamA.player2Id === activePlayerId) teamA.player2Id = queuedPlayerId;
      else if (teamB.player1Id === activePlayerId) teamB.player1Id = queuedPlayerId;
      else if (teamB.player2Id === activePlayerId) teamB.player2Id = queuedPlayerId;
      return {
        ...m,
        teamA,
        teamB,
        title: computeUpdatedMatchTitle(teamA, teamB, m.title),
        playerAssignedAt: {
          ...(m.playerAssignedAt || {}),
          [queuedPlayerId]: swapNow,
        },
      };
    });

    const nextQueued = queuedMatches.map((m) => {
      if (m.id !== queuedMatchId) return m;
      const teamA = { ...m.teamA };
      const teamB = { ...m.teamB };
      if (teamA.player1Id === queuedPlayerId) teamA.player1Id = activePlayerId;
      else if (teamA.player2Id === queuedPlayerId) teamA.player2Id = activePlayerId;
      else if (teamB.player1Id === queuedPlayerId) teamB.player1Id = activePlayerId;
      else if (teamB.player2Id === queuedPlayerId) teamB.player2Id = activePlayerId;
      return {
        ...m,
        teamA,
        teamB,
        title: computeUpdatedMatchTitle(teamA, teamB, m.title),
      };
    });

    setActiveMatches(nextActive);
    setQueuedMatches(nextQueued);
    applyManualInterventionReconciliation(
      [activePlayerId, queuedPlayerId],
      nextActive,
      nextQueued,
      []
    );

    soundEffects.playWhistle();
  };

  // Swap a player in an active court match with a resting/bench participant (진행 중인 코트 선수 ↔ 참가자/휴식자 맞교체)
  const handleSwapActiveAndBench = (
    activeMatchId: string,
    activePlayerId: string,
    benchPlayerId: string
  ) => {
    const activeMatch = activeMatches.find((m) => m.id === activeMatchId);
    if (!activeMatch) return;

    const benchPlayer = players.find((p) => p.id === benchPlayerId);
    if (benchPlayer) {
      if (
        benchPlayer.specialStatus === 'resting' ||
        benchPlayer.specialStatus === 'lesson' ||
        isPlayerLastMatchCompleted(benchPlayer)
      ) {
        alert(
          benchPlayer.specialStatus === 'resting'
            ? `${benchPlayer.name} 선수는 현재 휴식중입니다. (교체 불가)`
            : benchPlayer.specialStatus === 'lesson'
            ? `${benchPlayer.name} 선수는 현재 레슨중입니다. (교체 불가)`
            : `${benchPlayer.name} 선수는 마지막판 완료(퇴장!) 상태입니다. (교체 불가)`
        );
        return;
      }
      if (
        benchPlayer.specialStatus === 'last_match' &&
        (activePlayingIds.has(benchPlayerId) ||
          queuedMatches.some(
            (m) =>
              m.teamA.player1Id === benchPlayerId ||
              m.teamA.player2Id === benchPlayerId ||
              m.teamB.player1Id === benchPlayerId ||
              m.teamB.player2Id === benchPlayerId
          ))
      ) {
        alert(`${benchPlayer.name} 선수는 마지막판 상태로 이미 다른 경기(코트/대기열)에 배정되어 있습니다. (중복 배정 불가)`);
        return;
      }
    }

    const otherCourtIds = [
      activeMatch.teamA.player1Id,
      activeMatch.teamA.player2Id,
      activeMatch.teamB.player1Id,
      activeMatch.teamB.player2Id,
    ].filter((id) => id !== activePlayerId);

    if (otherCourtIds.includes(benchPlayerId)) {
      alert('같은 선수가 있습니다');
      return;
    }

    const now = Date.now();
    const nextActive = activeMatches.map((m) => {
      if (m.id !== activeMatchId) return m;
      const teamA = { ...m.teamA };
      const teamB = { ...m.teamB };
      if (teamA.player1Id === activePlayerId) teamA.player1Id = benchPlayerId;
      else if (teamA.player2Id === activePlayerId) teamA.player2Id = benchPlayerId;
      else if (teamB.player1Id === activePlayerId) teamB.player1Id = benchPlayerId;
      else if (teamB.player2Id === activePlayerId) teamB.player2Id = benchPlayerId;
      return {
        ...m,
        teamA,
        teamB,
        title: computeUpdatedMatchTitle(teamA, teamB, m.title),
        playerAssignedAt: {
          ...(m.playerAssignedAt || {}),
          [benchPlayerId]: now,
        },
      };
    });

    setActiveMatches(nextActive);
    applyManualInterventionReconciliation(
      [activePlayerId, benchPlayerId],
      nextActive,
      queuedMatches,
      [activePlayerId]
    );

    soundEffects.playWhistle();
  };

  // Swap players between active court matches (진행 중인 코트 선수 ↔ 진행 중인 코트 선수 맞교체)
  const handleSwapActivePlayers = (
    matchId1: string,
    playerId1: string,
    matchId2: string,
    playerId2: string
  ) => {
    if (matchId1 === matchId2) {
      if (playerId1 === playerId2) return;
    } else {
      const m1 = activeMatches.find((m) => m.id === matchId1);
      const m2 = activeMatches.find((m) => m.id === matchId2);
      if (m1 && m2) {
        const m1OtherIds = [
          m1.teamA.player1Id,
          m1.teamA.player2Id,
          m1.teamB.player1Id,
          m1.teamB.player2Id,
        ].filter((id) => id !== playerId1);
        const m2OtherIds = [
          m2.teamA.player1Id,
          m2.teamA.player2Id,
          m2.teamB.player1Id,
          m2.teamB.player2Id,
        ].filter((id) => id !== playerId2);

        if (m1OtherIds.includes(playerId2) || m2OtherIds.includes(playerId1)) {
          alert('같은 선수가 있습니다');
          return;
        }
      }
    }

    const now = Date.now();
    const nextActive = activeMatches.map((m) => {
      if (matchId1 === matchId2) {
        if (m.id !== matchId1) return m;
        const swapId = (id: string) => {
          if (id === playerId1) return playerId2;
          if (id === playerId2) return playerId1;
          return id;
        };
        const teamA = {
          ...m.teamA,
          player1Id: swapId(m.teamA.player1Id),
          player2Id: swapId(m.teamA.player2Id),
        };
        const teamB = {
          ...m.teamB,
          player1Id: swapId(m.teamB.player1Id),
          player2Id: swapId(m.teamB.player2Id),
        };
        return {
          ...m,
          teamA,
          teamB,
          title: computeUpdatedMatchTitle(teamA, teamB, m.title),
        };
      }

      if (m.id === matchId1) {
        const replaceId = (id: string) => (id === playerId1 ? playerId2 : id);
        const teamA = {
          ...m.teamA,
          player1Id: replaceId(m.teamA.player1Id),
          player2Id: replaceId(m.teamA.player2Id),
        };
        const teamB = {
          ...m.teamB,
          player1Id: replaceId(m.teamB.player1Id),
          player2Id: replaceId(m.teamB.player2Id),
        };
        return {
          ...m,
          teamA,
          teamB,
          title: computeUpdatedMatchTitle(teamA, teamB, m.title),
          playerAssignedAt: {
            ...(m.playerAssignedAt || {}),
            [playerId2]: now,
          },
        };
      }
      if (m.id === matchId2) {
        const replaceId = (id: string) => (id === playerId2 ? playerId1 : id);
        const teamA = {
          ...m.teamA,
          player1Id: replaceId(m.teamA.player1Id),
          player2Id: replaceId(m.teamA.player2Id),
        };
        const teamB = {
          ...m.teamB,
          player1Id: replaceId(m.teamB.player1Id),
          player2Id: replaceId(m.teamB.player2Id),
        };
        return {
          ...m,
          teamA,
          teamB,
          title: computeUpdatedMatchTitle(teamA, teamB, m.title),
          playerAssignedAt: {
            ...(m.playerAssignedAt || {}),
            [playerId1]: now,
          },
        };
      }
      return m;
    });

    setActiveMatches(nextActive);
    applyManualInterventionReconciliation(
      [playerId1, playerId2],
      nextActive,
      queuedMatches,
      []
    );

    soundEffects.playWhistle();
  };

  // Swap a player in a queued match with a resting/bench player (대기열 선수 ↔ 대기/휴식자 맞교체)
  const handleSwapQueuedAndBench = (
    queuedMatchId: string,
    queuedPlayerId: string,
    benchPlayerId: string
  ) => {
    const benchPlayer = players.find((p) => p.id === benchPlayerId);
    if (benchPlayer) {
      if (
        benchPlayer.specialStatus === 'resting' ||
        benchPlayer.specialStatus === 'lesson' ||
        isPlayerLastMatchCompleted(benchPlayer)
      ) {
        alert(
          benchPlayer.specialStatus === 'resting'
            ? `${benchPlayer.name} 선수는 현재 휴식중입니다. (교체 불가)`
            : benchPlayer.specialStatus === 'lesson'
            ? `${benchPlayer.name} 선수는 현재 레슨중입니다. (교체 불가)`
            : `${benchPlayer.name} 선수는 마지막판 완료(퇴장!) 상태입니다. (교체 불가)`
        );
        return;
      }
      if (
        benchPlayer.specialStatus === 'last_match' &&
        (activePlayingIds.has(benchPlayerId) ||
          queuedMatches.some(
            (m) =>
              m.teamA.player1Id === benchPlayerId ||
              m.teamA.player2Id === benchPlayerId ||
              m.teamB.player1Id === benchPlayerId ||
              m.teamB.player2Id === benchPlayerId
          ))
      ) {
        alert(`${benchPlayer.name} 선수는 마지막판 상태로 이미 다른 경기(코트/대기열)에 배정되어 있습니다. (중복 배정 불가)`);
        return;
      }
    }

    const qMatch = queuedMatches.find((m) => m.id === queuedMatchId);
    if (qMatch) {
      const otherIds = [
        qMatch.teamA.player1Id,
        qMatch.teamA.player2Id,
        qMatch.teamB.player1Id,
        qMatch.teamB.player2Id,
      ].filter((id) => id !== queuedPlayerId);

      if (otherIds.includes(benchPlayerId)) {
        alert('같은 선수가 있습니다');
        return;
      }
    }

    const nextQueued = queuedMatches.map((m) => {
      if (m.id !== queuedMatchId) return m;
      const teamA = { ...m.teamA };
      const teamB = { ...m.teamB };
      if (teamA.player1Id === queuedPlayerId) teamA.player1Id = benchPlayerId;
      else if (teamA.player2Id === queuedPlayerId) teamA.player2Id = benchPlayerId;
      else if (teamB.player1Id === queuedPlayerId) teamB.player1Id = benchPlayerId;
      else if (teamB.player2Id === queuedPlayerId) teamB.player2Id = benchPlayerId;
      return {
        ...m,
        teamA,
        teamB,
        title: computeUpdatedMatchTitle(teamA, teamB, m.title),
      };
    });

    setQueuedMatches(nextQueued);
    applyManualInterventionReconciliation(
      [queuedPlayerId, benchPlayerId],
      activeMatches,
      nextQueued,
      [queuedPlayerId]
    );

    soundEffects.playWhistle();
  };

  // Swap players within queue (either in the same queued match or across different queued matches)
  const handleSwapQueuedPlayers = (
    matchId1: string,
    playerId1: string,
    matchId2: string,
    playerId2: string
  ) => {
    if (matchId1 === matchId2) {
      if (playerId1 === playerId2) {
        alert('같은 선수가 있습니다');
        return;
      }
    } else {
      const m1 = queuedMatches.find((m) => m.id === matchId1);
      const m2 = queuedMatches.find((m) => m.id === matchId2);
      if (m1 && m2) {
        const m1OtherIds = [
          m1.teamA.player1Id,
          m1.teamA.player2Id,
          m1.teamB.player1Id,
          m1.teamB.player2Id,
        ].filter((id) => id !== playerId1);

        const m2OtherIds = [
          m2.teamA.player1Id,
          m2.teamA.player2Id,
          m2.teamB.player1Id,
          m2.teamB.player2Id,
        ].filter((id) => id !== playerId2);

        if (m1OtherIds.includes(playerId2) || m2OtherIds.includes(playerId1)) {
          alert('같은 선수가 있습니다');
          return;
        }
      }
    }

    const nextQueued =
      matchId1 === matchId2
        ? queuedMatches.map((m) => {
            if (m.id !== matchId1) return m;
            const swapId = (id: string) => {
              if (id === playerId1) return playerId2;
              if (id === playerId2) return playerId1;
              return id;
            };
            const teamA = {
              ...m.teamA,
              player1Id: swapId(m.teamA.player1Id),
              player2Id: swapId(m.teamA.player2Id),
            };
            const teamB = {
              ...m.teamB,
              player1Id: swapId(m.teamB.player1Id),
              player2Id: swapId(m.teamB.player2Id),
            };
            return {
              ...m,
              teamA,
              teamB,
              title: computeUpdatedMatchTitle(teamA, teamB, m.title),
            };
          })
        : queuedMatches.map((m) => {
            if (m.id === matchId1) {
              const replaceId = (id: string) => (id === playerId1 ? playerId2 : id);
              const teamA = {
                ...m.teamA,
                player1Id: replaceId(m.teamA.player1Id),
                player2Id: replaceId(m.teamA.player2Id),
              };
              const teamB = {
                ...m.teamB,
                player1Id: replaceId(m.teamB.player1Id),
                player2Id: replaceId(m.teamB.player2Id),
              };
              return {
                ...m,
                teamA,
                teamB,
                title: computeUpdatedMatchTitle(teamA, teamB, m.title),
              };
            }
            if (m.id === matchId2) {
              const replaceId = (id: string) => (id === playerId2 ? playerId1 : id);
              const teamA = {
                ...m.teamA,
                player1Id: replaceId(m.teamA.player1Id),
                player2Id: replaceId(m.teamA.player2Id),
              };
              const teamB = {
                ...m.teamB,
                player1Id: replaceId(m.teamB.player1Id),
                player2Id: replaceId(m.teamB.player2Id),
              };
              return {
                ...m,
                teamA,
                teamB,
                title: computeUpdatedMatchTitle(teamA, teamB, m.title),
              };
            }
            return m;
          });

    setQueuedMatches(nextQueued);
    applyManualInterventionReconciliation(
      [playerId1, playerId2],
      activeMatches,
      nextQueued,
      []
    );
    soundEffects.playWhistle();
  };

  // Generate queued match with 1 or more specifically selected players
  const handleGenerateQueueWithSelected = (selectedPlayerIds: string[]) => {
    try {
      const newMatches = createQueuedMatchesFromSelectedPlayers(
        selectedPlayerIds,
        players,
        queuedMatches,
        activePlayingIds,
        getEnrichedOptions(options),
        activeMatches
      );
      if (newMatches.length > 0) {
        const nextQueued = orderQueuedMatchesWithSpecial(
          [...queuedMatches, ...newMatches],
          players,
          activeMatches,
          getEnrichedOptions(options)
        );
        const assignedIds = new Set<string>(selectedPlayerIds);
        newMatches.forEach((m) => {
          assignedIds.add(m.teamA.player1Id);
          assignedIds.add(m.teamA.player2Id);
          assignedIds.add(m.teamB.player1Id);
          assignedIds.add(m.teamB.player2Id);
        });
        setQueuedMatches(nextQueued);
        applyManualInterventionReconciliation(assignedIds, activeMatches, nextQueued, []);
        soundEffects.playWhistle();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '대기 경기 생성에 실패했습니다.';
      setAppAlertMessage(message);
    }
  };

  // Generate a Special Game with 4 specifically selected players (대기열 가장 아래 고정, 배정 순서 도달 시 오로라 활성화)
  const handleGenerateSpecialGameWithSelected = (selectedPlayerIds: string[]) => {
    try {
      const specialMatch = createSpecialMatchFromSelectedPlayers(
        selectedPlayerIds,
        players,
        getEnrichedOptions(options),
        activeMatches,
        queuedMatches
      );
      setQueuedMatches((prev) =>
        orderQueuedMatchesWithSpecial(
          [...prev, specialMatch],
          players,
          activeMatches,
          getEnrichedOptions(options)
        )
      );
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '스페셜 게임 생성에 실패했습니다.';
      setAppAlertMessage(message);
    }
  };

  // Complete Individual Match (Marks court game done, archives to history, increments stats, vacates court, and rotates turn)
  const handleCompleteMatch = (matchId: string) => {
    const targetMatch = activeMatches.find((m) => m.id === matchId);
    if (!targetMatch) return;

    const courtNumber = targetMatch.courtNumber;
    const targetCourt = courts.find((c) => Number(c.courtNumber) === Number(courtNumber));
    const matchSnapshots = buildPlayerSnapshots(
      [
        targetMatch.teamA.player1Id,
        targetMatch.teamA.player2Id,
        targetMatch.teamB.player1Id,
        targetMatch.teamB.player2Id,
      ],
      allKnownPlayersMap
    );
    const doneNow = Date.now();
    const completedMatch: CourtMatch = {
      ...targetMatch,
      courtName: formatCourtName(extractCourtNumberLabel(targetCourt?.name, courtNumber)),
      status: 'completed',
      completedAt: doneNow,
      elapsedSeconds: targetMatch.startedAt
        ? Math.max(0, Math.floor((doneNow - targetMatch.startedAt) / 1000))
        : undefined,
      playerSnapshots: matchSnapshots,
    };

    // 1. Remove from active matches (vacate this court)
    setActiveMatches((prev) => prev.filter((m) => m.id !== matchId));

    // 2. Increment gamesPlayed, update partnerHistory/opponentHistory and consecutive rests
    applyMatchCompletionToPlayers(targetMatch, matchId);

    // 3. Immediately archive this completed court match and its participants into round history
    setRoundHistory((prevHistory) => {
      const roundNum = completedMatch.round || 1;
      const existingRoundIndex = prevHistory.findIndex((r) => r.roundNumber === roundNum);

      if (existingRoundIndex >= 0) {
        const existingRound = prevHistory[existingRoundIndex];
        const matchExists = existingRound.matches.some((m) => m.id === completedMatch.id);
        const updatedMatches = matchExists
          ? existingRound.matches.map((m) =>
              m.id === completedMatch.id ? completedMatch : m
            )
          : [...existingRound.matches, completedMatch];

        const updatedRound: MatchRound = {
          ...existingRound,
          matches: updatedMatches,
          timestamp: Date.now(),
        };

        const newHistory = [...prevHistory];
        newHistory[existingRoundIndex] = updatedRound;
        return newHistory;
      } else {
        const newRound: MatchRound = {
          roundNumber: roundNum,
          matches: [completedMatch],
          restingPlayerIds: restingPlayers.map((p) => p.id),
          timestamp: Date.now(),
        };
        return [...prevHistory, newRound];
      }
    });

    // 4. Advance court turn (rotate cones) without forced auto-deploy
    const nextCone = handleAdvanceCourtTurn(courtNumber, false);
    soundEffects.playWhistle();

    // 5. Open 배정선수관리 modal ONLY if the next cone is not 'gray' (다른클럽 꼬깔로 넘어가는 상황에선 창 미실행)
    if (!nextCone || nextCone.color !== 'gray') {
      setAssignQueueModalCourt(courtNumber);
    }
  };

  // Assign a specific queued match to a court from AssignQueueModal (배정선수관리)
  const handleAssignQueueMatchToCourt = (matchId: string, courtNumber: number) => {
    const targetMatch = queuedMatches.find((m) => m.id === matchId);
    if (!targetMatch) return;

    const now = Date.now();
    const targetCourt = courts.find((c) => Number(c.courtNumber) === Number(courtNumber));
    const assignedMatch: CourtMatch = {
      ...targetMatch,
      courtNumber,
      courtName: formatCourtName(extractCourtNumberLabel(targetCourt?.name, courtNumber)),
      status: 'in_progress',
      startedAt: now,
      playerAssignedAt: {
        [targetMatch.teamA.player1Id]: now,
        [targetMatch.teamA.player2Id]: now,
        [targetMatch.teamB.player1Id]: now,
        [targetMatch.teamB.player2Id]: now,
      },
    };

    const existingOnCourt = activeMatches.find((m) => m.courtNumber === courtNumber);
    const deployedIds = [
      targetMatch.teamA.player1Id,
      targetMatch.teamA.player2Id,
      targetMatch.teamB.player1Id,
      targetMatch.teamB.player2Id,
    ].filter(Boolean);
    const deployedSet = new Set(deployedIds);
    const displacedIds = existingOnCourt
      ? [
          existingOnCourt.teamA.player1Id,
          existingOnCourt.teamA.player2Id,
          existingOnCourt.teamB.player1Id,
          existingOnCourt.teamB.player2Id,
        ].filter((id) => id && !deployedSet.has(id))
      : [];

    // Clear all conflict highlights when any queued match is deployed to a court
    setConflictMatchTargetCourts({});

    const nextQueued = queuedMatches.filter((m) => m.id !== matchId);
    const nextActive = [
      ...activeMatches.filter((m) => m.courtNumber !== courtNumber),
      assignedMatch,
    ].sort((a, b) => a.courtNumber - b.courtNumber);

    setQueuedMatches(nextQueued);
    setActiveMatches(nextActive);

    // Ensure deployed players have consecutiveRestRounds reset to 0 and displaced players restored
    setPlayers((prev) =>
      prev.map((p) => {
        if (deployedSet.has(p.id)) {
          return { ...p, consecutiveRestRounds: 0 };
        }
        if (displacedIds.includes(p.id)) {
          return { ...p, consecutiveRestRounds: Math.max(1, (p.consecutiveRestRounds || 0) + 1) };
        }
        return p;
      })
    );

    // If the court cone was gray (other club), rotate cone queue to red (our club) and update turnStartedAt
    setCourts((prevCourts) =>
      prevCourts.map((c) => {
        if (c.courtNumber !== courtNumber) return c;
        const currentQueue = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
        const currentActiveCone = currentQueue[0] || null;
        const { cones: rotated, currentConeIndex: nextIdx } = rotateQueueToFirstRedCone(
          c.cones || [],
          c.currentConeIndex || 0
        );
        const nextHistory =
          currentActiveCone?.color === 'gray'
            ? [
                ...(c.turnHistory || []),
                { prevConeId: currentActiveCone.id, prevTurnColor: 'gray' as const },
              ]
            : c.turnHistory || [];
        return {
          ...c,
          cones: rotated,
          currentConeIndex: nextIdx,
          turnStartedAt: now,
          turnHistory: nextHistory,
        };
      })
    );

    soundEffects.playWhistle();
    setAssignQueueModalCourt(null);
  };

  // Reset Match
  const handleResetMatch = (matchId: string) => {
    setActiveMatches((prev) =>
      prev.map((m) => {
        if (m.id !== matchId) return m;
        return {
          ...m,
          status: 'in_progress',
          winner: undefined,
        };
      })
    );
  };

  // Complete All Matches
  const handleCompleteAllMatches = () => {
    activeMatches.forEach((m) => {
      if (m.status !== 'completed') {
        handleCompleteMatch(m.id);
      }
    });
  };

  // Cancel Swap / Selection
  const handleCancelSwap = () => {
    setSelectedSwap(null);
    setSelectedBenchPlayerIds([]);
  };

  // Toggle single bench player selection
  const handleToggleSelectBenchPlayer = (playerId: string) => {
    const targetBenchPlayer = players.find((p) => p.id === playerId);
    const isAlreadyInQueueOrCourt =
      activePlayingIds.has(playerId) ||
      queuedMatches.some(
        (m) =>
          m.teamA.player1Id === playerId ||
          m.teamA.player2Id === playerId ||
          m.teamB.player1Id === playerId ||
          m.teamB.player2Id === playerId
      );

    // If a court slot was selected, swap immediately!
    if (selectedSwap?.source === 'court') {
      const { matchId, team, slot } = selectedSwap;
      if (!matchId || !team || !slot) return;

      if (targetBenchPlayer) {
        if (
          targetBenchPlayer.specialStatus === 'resting' ||
          targetBenchPlayer.specialStatus === 'lesson' ||
          isPlayerLastMatchCompleted(targetBenchPlayer)
        ) {
          alert(
            targetBenchPlayer.specialStatus === 'resting'
              ? `${targetBenchPlayer.name} 선수는 현재 휴식중입니다. (교체 불가)`
              : targetBenchPlayer.specialStatus === 'lesson'
              ? `${targetBenchPlayer.name} 선수는 현재 레슨중입니다. (교체 불가)`
              : `${targetBenchPlayer.name} 선수는 마지막판 완료(퇴장!) 상태입니다. (교체 불가)`
          );
          return;
        }
        if (targetBenchPlayer.specialStatus === 'last_match' && isAlreadyInQueueOrCourt) {
          alert(
            `${targetBenchPlayer.name} 선수는 마지막판 상태로 이미 다른 경기(코트/대기열)에 배정되어 있습니다. (중복 배정 불가)`
          );
          return;
        }
      }

      const targetMatch = activeMatches.find((m) => m.id === matchId);
      const currentSlotId = targetMatch
        ? targetMatch[team][slot === 1 ? 'player1Id' : 'player2Id']
        : undefined;
      if (targetMatch) {
        const otherCourtIds = [
          targetMatch.teamA.player1Id,
          targetMatch.teamA.player2Id,
          targetMatch.teamB.player1Id,
          targetMatch.teamB.player2Id,
        ].filter((id) => id !== currentSlotId);

        if (otherCourtIds.includes(playerId)) {
          alert('같은 선수가 있습니다');
          return;
        }
      }

      const now = Date.now();
      const nextActive = activeMatches.map((m) => {
        if (m.id !== matchId) return m;
        const updatedTeam = { ...m[team] };
        if (slot === 1) updatedTeam.player1Id = playerId;
        else updatedTeam.player2Id = playerId;
        const nextTeamA = team === 'teamA' ? updatedTeam : m.teamA;
        const nextTeamB = team === 'teamB' ? updatedTeam : m.teamB;
        return {
          ...m,
          [team]: updatedTeam,
          title: computeUpdatedMatchTitle(nextTeamA, nextTeamB, m.title),
          playerAssignedAt: {
            ...(m.playerAssignedAt || {}),
            [playerId]: now,
          },
        };
      });

      setActiveMatches(nextActive);
      applyManualInterventionReconciliation(
        currentSlotId ? [currentSlotId, playerId] : [playerId],
        nextActive,
        queuedMatches,
        currentSlotId ? [currentSlotId] : []
      );

      setSelectedSwap(null);
      setSelectedBenchPlayerIds([]);
      soundEffects.playWhistle();
      return;
    }

    // Prevent adding ineligible bench player to selection
    if (
      targetBenchPlayer &&
      !selectedBenchPlayerIds.includes(playerId) &&
      (targetBenchPlayer.specialStatus === 'resting' ||
        targetBenchPlayer.specialStatus === 'lesson' ||
        isPlayerLastMatchCompleted(targetBenchPlayer) ||
        (targetBenchPlayer.specialStatus === 'last_match' && isAlreadyInQueueOrCourt))
    ) {
      return;
    }

    // Otherwise, toggle in selectedBenchPlayerIds (최대 4명까지 제한)
    setSelectedBenchPlayerIds((prev) => {
      if (!prev.includes(playerId) && prev.length >= 4) {
        return prev;
      }
      const next = prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId];

      if (next.length === 1) {
        setSelectedSwap({ source: 'bench', playerId: next[0] });
      } else {
        setSelectedSwap(null);
      }
      return next;
    });
    soundEffects.playScorePoint();
  };

  // Clear Bench Selection
  const handleClearBenchSelection = () => {
    setSelectedBenchPlayerIds([]);
    setSelectedSwap(null);
  };

  // Slot-Specific Swap Player Logic (Court Slot or Bench Player)
  const handleSelectPlayerForSwap = (
    playerId: string,
    matchId?: string,
    team?: 'teamA' | 'teamB',
    slot?: 1 | 2
  ) => {
    // 1. If this is a court slot click:
    if (matchId && team && slot) {
      // Case A: A bench player was selected
      const benchPlayerId =
        selectedSwap?.source === 'bench'
          ? selectedSwap.playerId
          : selectedBenchPlayerIds.length === 1
          ? selectedBenchPlayerIds[0]
          : null;

      if (benchPlayerId) {
        const benchPlayer = players.find((p) => p.id === benchPlayerId);
        if (benchPlayer) {
          if (
            benchPlayer.specialStatus === 'resting' ||
            benchPlayer.specialStatus === 'lesson' ||
            isPlayerLastMatchCompleted(benchPlayer)
          ) {
            alert(
              benchPlayer.specialStatus === 'resting'
                ? `${benchPlayer.name} 선수는 현재 휴식중입니다. (교체 불가)`
                : benchPlayer.specialStatus === 'lesson'
                ? `${benchPlayer.name} 선수는 현재 레슨중입니다. (교체 불가)`
                : `${benchPlayer.name} 선수는 마지막판 완료(퇴장!) 상태입니다. (교체 불가)`
            );
            setSelectedSwap(null);
            setSelectedBenchPlayerIds([]);
            return;
          }
          const isAlreadyInQueueOrCourt =
            activePlayingIds.has(benchPlayerId) ||
            queuedMatches.some(
              (m) =>
                m.teamA.player1Id === benchPlayerId ||
                m.teamA.player2Id === benchPlayerId ||
                m.teamB.player1Id === benchPlayerId ||
                m.teamB.player2Id === benchPlayerId
            );
          if (benchPlayer.specialStatus === 'last_match' && isAlreadyInQueueOrCourt) {
            alert(
              `${benchPlayer.name} 선수는 마지막판 상태로 이미 다른 경기(코트/대기열)에 배정되어 있습니다. (중복 배정 불가)`
            );
            setSelectedSwap(null);
            setSelectedBenchPlayerIds([]);
            return;
          }
        }

        const targetMatch = activeMatches.find((m) => m.id === matchId);
        const currentSlotId = targetMatch
          ? targetMatch[team][slot === 1 ? 'player1Id' : 'player2Id']
          : undefined;
        if (targetMatch) {
          const otherCourtIds = [
            targetMatch.teamA.player1Id,
            targetMatch.teamA.player2Id,
            targetMatch.teamB.player1Id,
            targetMatch.teamB.player2Id,
          ].filter((id) => id !== currentSlotId);

          if (otherCourtIds.includes(benchPlayerId)) {
            alert('같은 선수가 있습니다');
            return;
          }
        }

        // Swap court slot with this single bench player!
        const now = Date.now();
        const nextActive = activeMatches.map((m) => {
          if (m.id !== matchId) return m;
          const updatedTeam = { ...m[team] };
          if (slot === 1) updatedTeam.player1Id = benchPlayerId;
          else updatedTeam.player2Id = benchPlayerId;
          const nextTeamA = team === 'teamA' ? updatedTeam : m.teamA;
          const nextTeamB = team === 'teamB' ? updatedTeam : m.teamB;
          return {
            ...m,
            [team]: updatedTeam,
            title: computeUpdatedMatchTitle(nextTeamA, nextTeamB, m.title),
            playerAssignedAt: {
              ...(m.playerAssignedAt || {}),
              [benchPlayerId]: now,
            },
          };
        });

        setActiveMatches(nextActive);
        applyManualInterventionReconciliation(
          currentSlotId ? [currentSlotId, benchPlayerId] : [benchPlayerId],
          nextActive,
          queuedMatches,
          currentSlotId ? [currentSlotId] : []
        );

        setSelectedSwap(null);
        setSelectedBenchPlayerIds([]);
        soundEffects.playWhistle();
        return;
      }

      // Case B: Another court slot was already selected
      if (selectedSwap?.source === 'court') {
        // If clicking the same player or slot, deselect
        if (
          (selectedSwap.matchId === matchId &&
            selectedSwap.team === team &&
            selectedSwap.slot === slot) ||
          selectedSwap.playerId === playerId
        ) {
          setSelectedSwap(null);
          soundEffects.playRacketHit();
          return;
        }

        const slot1 = {
          matchId: selectedSwap.matchId!,
          team: selectedSwap.team!,
          slot: selectedSwap.slot!,
          playerId: selectedSwap.playerId,
        };
        const slot2 = {
          matchId,
          team,
          slot,
          playerId,
        };

        if (slot1.matchId !== slot2.matchId) {
          const m1 = activeMatches.find((m) => m.id === slot1.matchId);
          const m2 = activeMatches.find((m) => m.id === slot2.matchId);
          if (m1 && m2) {
            const m1OtherIds = [
              m1.teamA.player1Id,
              m1.teamA.player2Id,
              m1.teamB.player1Id,
              m1.teamB.player2Id,
            ].filter((id) => id !== slot1.playerId);
            const m2OtherIds = [
              m2.teamA.player1Id,
              m2.teamA.player2Id,
              m2.teamB.player1Id,
              m2.teamB.player2Id,
            ].filter((id) => id !== slot2.playerId);

            if (m1OtherIds.includes(slot2.playerId) || m2OtherIds.includes(slot1.playerId)) {
              alert('같은 선수가 있습니다');
              return;
            }
          }
        }

        const now = Date.now();
        const nextActive = activeMatches.map((m) => {
          let updated = { ...m };
          if (m.id === slot1.matchId) {
            const updatedTeam = { ...updated[slot1.team] };
            if (slot1.slot === 1) updatedTeam.player1Id = slot2.playerId;
            else updatedTeam.player2Id = slot2.playerId;
            const nextTeamA = slot1.team === 'teamA' ? updatedTeam : updated.teamA;
            const nextTeamB = slot1.team === 'teamB' ? updatedTeam : updated.teamB;
            updated = {
              ...updated,
              [slot1.team]: updatedTeam,
              title: computeUpdatedMatchTitle(nextTeamA, nextTeamB, updated.title),
              playerAssignedAt: {
                ...(updated.playerAssignedAt || {}),
                [slot2.playerId]: now,
              },
            };
          }
          if (m.id === slot2.matchId) {
            const updatedTeam = { ...updated[slot2.team] };
            if (slot2.slot === 1) updatedTeam.player1Id = slot1.playerId;
            else updatedTeam.player2Id = slot1.playerId;
            const nextTeamA = slot2.team === 'teamA' ? updatedTeam : updated.teamA;
            const nextTeamB = slot2.team === 'teamB' ? updatedTeam : updated.teamB;
            updated = {
              ...updated,
              [slot2.team]: updatedTeam,
              title: computeUpdatedMatchTitle(nextTeamA, nextTeamB, updated.title),
              playerAssignedAt: {
                ...(updated.playerAssignedAt || {}),
                [slot1.playerId]: now,
              },
            };
          }
          return updated;
        });

        setActiveMatches(nextActive);
        applyManualInterventionReconciliation(
          [slot1.playerId, slot2.playerId],
          nextActive,
          queuedMatches,
          []
        );

        setSelectedSwap(null);
        setSelectedBenchPlayerIds([]);
        soundEffects.playWhistle();
        return;
      }

      // Case C: Nothing was selected, select this court slot
      setSelectedSwap({
        source: 'court',
        matchId,
        team,
        slot,
        playerId,
      });
      setSelectedBenchPlayerIds([]);
      soundEffects.playScorePoint();
      return;
    }

    // 2. If this is a bench player click (playerId only):
    handleToggleSelectBenchPlayer(playerId);
  };

  // Helper to execute assignment of selected bench players to a target court
  const executeAssignBenchToCourt = (courtNum: number, existingCourtInfo?: CourtInfo) => {
    const assignNow = Date.now();
    // Ensure court's active cone is set to RED so our club match is immediately active
    setCourts((prev) =>
      prev.map((c) => {
        if (c.courtNumber !== courtNum) return c;
        const currentQueue = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
        const currentActiveCone = currentQueue[0] || null;
        const { cones: rotated, currentConeIndex: nextIdx } = rotateQueueToFirstRedCone(
          c.cones || [],
          c.currentConeIndex || 0
        );
        const nextHistory =
          currentActiveCone?.color === 'gray'
            ? [
                ...(c.turnHistory || []),
                { prevConeId: currentActiveCone.id, prevTurnColor: 'gray' as const },
              ]
            : c.turnHistory || [];
        return {
          ...c,
          cones: rotated,
          currentConeIndex: nextIdx,
          turnStartedAt: assignNow,
          turnHistory: nextHistory,
        };
      })
    );

    try {
      const selectedPlayerObjs = players.filter((p) => selectedBenchPlayerIds.includes(p.id));
      const nextRound = currentRound + 1;
      const { match, assignedPlayerIds } = createDoublesMatchFromSelected(
        selectedPlayerObjs,
        restingPlayers,
        courtNum,
        nextRound,
        getEnrichedOptions(options),
        queuedMatches,
        activeMatches
      );

      const now = Date.now();
      const targetCourt = existingCourtInfo || courts.find((c) => c.courtNumber === courtNum);
      const matchWithCourtName: CourtMatch = {
        ...match,
        startedAt: now,
        courtName: formatCourtName(extractCourtNumberLabel(targetCourt?.name, courtNum)),
        playerAssignedAt: {
          [match.teamA.player1Id]: now,
          [match.teamA.player2Id]: now,
          [match.teamB.player1Id]: now,
          [match.teamB.player2Id]: now,
        },
      };

      const existingOnCourt = activeMatches.find((m) => m.courtNumber === courtNum);
      const assignedSet = new Set(assignedPlayerIds);
      const displacedIds = existingOnCourt
        ? [
            existingOnCourt.teamA.player1Id,
            existingOnCourt.teamA.player2Id,
            existingOnCourt.teamB.player1Id,
            existingOnCourt.teamB.player2Id,
          ].filter((id) => id && !assignedSet.has(id))
        : [];

      const nextActive = [
        ...activeMatches.filter((m) => m.courtNumber !== courtNum),
        matchWithCourtName,
      ].sort((a, b) => a.courtNumber - b.courtNumber);

      setActiveMatches(nextActive);
      applyManualInterventionReconciliation(
        [...selectedBenchPlayerIds, ...assignedPlayerIds],
        nextActive,
        queuedMatches,
        displacedIds
      );

      setConflictMatchTargetCourts({});
      setSelectedBenchPlayerIds([]);
      setSelectedSwap(null);
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '코트 배정에 실패했습니다.';
      setAppAlertMessage(msg);
    }
  };

  // Assign Selected Bench Players to a Court (1 or more players)
  const handleAssignSelectedBenchToCourt = (targetCourtNumber?: number) => {
    if (selectedBenchPlayerIds.length === 0) {
      setAppAlertMessage('코트에 배정할 선수를 대기 명단에서 먼저 선택해주세요.');
      return;
    }

    // 1. If target court specified:
    if (targetCourtNumber) {
      executeAssignBenchToCourt(targetCourtNumber);
      return;
    }

    // 2. Otherwise find an empty court where cone is red
    const emptyOurTurnCourt = courts.find((c) => {
      const cones = getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0);
      const activeCone = cones[0] || null;
      const isOurTurn = activeCone?.color === 'red';
      const hasMatch = activeMatches.some((m) => m.courtNumber === c.courtNumber);
      return isOurTurn && !hasMatch;
    });

    if (emptyOurTurnCourt) {
      executeAssignBenchToCourt(emptyOurTurnCourt.courtNumber, emptyOurTurnCourt);
      return;
    }

    // Fallback to ANY empty court without a match
    const anyEmptyCourt = courts.find((c) => !activeMatches.some((m) => m.courtNumber === c.courtNumber));
    if (anyEmptyCourt) {
      executeAssignBenchToCourt(anyEmptyCourt.courtNumber, anyEmptyCourt);
      return;
    }

    // All courts are assigned and there is no empty court!
    // Show prompt modal: "현재코트가없습니다 코트를 생성하시겠습니까" (확인 / 취소)
    setShowCreateCourtConfirmModal(true);
  };

  // Called when user clicks "확인" on the modal
  const handleConfirmCreateCourtAndAssign = () => {
    const nextNum = courts.length > 0 ? Math.max(...courts.map((c) => c.courtNumber)) + 1 : 1;
    const newCourt: CourtInfo = {
      id: `court_${Date.now()}`,
      courtNumber: nextNum,
      name: formatCourtName(nextNum),
      cones: [
        { id: `c_${Date.now()}_1`, color: 'red', label: '우리클럽', orderNumber: 1 },
      ],
      currentConeIndex: 0,
    };
    setCourts((prev) => [...prev, newCourt]);
    executeAssignBenchToCourt(nextNum, newCourt);
    setShowCreateCourtConfirmModal(false);
  };

  // Assign Selected Bench Players to Queue (대기열에 배정)
  const handleAssignSelectedBenchToQueue = () => {
    if (selectedBenchPlayerIds.length === 0) {
      setAppAlertMessage('대기열에 배정할 선수를 대기 명단에서 먼저 선택해주세요.');
      return;
    }

    try {
      const createdMatches = createQueuedMatchesFromSelectedPlayers(
        selectedBenchPlayerIds,
        players,
        queuedMatches,
        activePlayingIds,
        getEnrichedOptions(options),
        activeMatches
      );

      if (createdMatches.length === 0) {
        setAppAlertMessage('대기열 경기를 생성하기 위한 인원이 부족합니다. (최소 4명 필요)');
        return;
      }

      const nextQueued = orderQueuedMatchesWithSpecial(
        [...queuedMatches, ...createdMatches],
        players,
        activeMatches,
        getEnrichedOptions(options)
      );
      const intervenedIds = new Set<string>(selectedBenchPlayerIds);
      createdMatches.forEach((m) => {
        intervenedIds.add(m.teamA.player1Id);
        intervenedIds.add(m.teamA.player2Id);
        intervenedIds.add(m.teamB.player1Id);
        intervenedIds.add(m.teamB.player2Id);
      });

      setQueuedMatches(nextQueued);
      applyManualInterventionReconciliation(intervenedIds, activeMatches, nextQueued, []);
      setSelectedBenchPlayerIds([]);
      setSelectedSwap(null);
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '대기열 배정에 실패했습니다.';
      setAppAlertMessage(msg);
    }
  };

  // Pre-generate N matches for queue (대기 경기 연속 생성: +1, +4, +N경기)
  const handlePreGenerateQueueMatches = (count: number = 1, stayOnCurrentTab?: boolean) => {
    try {
      const nextRoundNum = currentRound + 1;
      const result = generateNextQueuedMatches(
        players,
        getEnrichedOptions(options),
        nextRoundNum,
        count,
        activePlayingIds,
        queuedMatches,
        activeMatches
      );

      const added = result.queuedMatches;
      setQueuedMatches((prev) =>
        orderQueuedMatchesWithSpecial(
          [...prev, ...added],
          players,
          activeMatches,
          getEnrichedOptions(options)
        )
      );
      soundEffects.playWhistle();

      if (!stayOnCurrentTab) {
        setActiveTab('games');
      }
      return added.length;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${count}경기 대기열 생성에 실패했습니다.`;
      setAppAlertMessage(message);
      return 0;
    }
  };

  const handlePreGenerateOneMatch = () => {
    handlePreGenerateQueueMatches(1, true);
  };

  const handlePreGenerateFourMatches = () => {
    if (courts.length === 0) {
      soundEffects.playScorePoint();
      setAppAlertMessage('운영 중인 코트가 없습니다. 먼저 [코트 생성하기]로 코트를 추가해주세요.');
      return;
    }
    handlePreGenerateQueueMatches(courts.length, true);
  };

  const handlePreGenerateNMatches = (count: number) => {
    handlePreGenerateQueueMatches(count, true);
  };

  // Generate specific match type (남복, 여복, 혼복) into queue
  const handleGenerateSpecificQueueMatch = (type: 'MD' | 'WD' | 'XD') => {
    try {
      const newMatch = generateSpecificTypeQueuedMatch(
        type,
        players,
        queuedMatches,
        activePlayingIds,
        getEnrichedOptions(options),
        activeMatches
      );

      setQueuedMatches((prev) =>
        orderQueuedMatchesWithSpecial(
          [...prev, newMatch],
          players,
          activeMatches,
          getEnrichedOptions(options)
        )
      );
      soundEffects.playWhistle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `${type} 경기 생성에 실패했습니다.`;
      setAppAlertMessage(msg);
    }
  };

  // Toggle single player active
  const handleTogglePlayerActive = (playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isActive: !p.isActive } : p))
    );
  };

  // Set player special status (휴식 / 레슨 / 마지막판 / 퇴장)
  const handleSetPlayerSpecialStatus = (
    playerId: string,
    status: 'resting' | 'lesson' | 'last_match' | 'exited' | null
  ) => {
    const now = Date.now();
    const currentTarget = players.find((p) => p.id === playerId);
    let computedRestOffset: number | undefined =
      currentTarget && currentTarget.specialStatus === 'resting'
        ? computeRestReturnOffset(currentTarget, players, activeMatches, queuedMatches)
        : undefined;

    const checkIsClearingStatus = (p: Player) => {
      const isLastDone = isPlayerLastMatchCompleted(p);
      return (
        !status ||
        (status === 'resting' && p.specialStatus === 'resting') ||
        (status === 'lesson' && p.specialStatus === 'lesson') ||
        (status === 'last_match' && p.specialStatus === 'last_match' && !isLastDone) ||
        (status === 'exited' && isLastDone)
      );
    };

    setPlayers((prev) => {
      const targetPlayer = prev.find((p) => p.id === playerId);
      const isLeavingRest = targetPlayer?.specialStatus === 'resting';

      if (targetPlayer && isLeavingRest && computedRestOffset === undefined) {
        computedRestOffset = computeRestReturnOffset(
          targetPlayer,
          prev,
          activeMatches,
          queuedMatches
        );
      }

      return prev.map((p) => {
        if (p.id !== playerId) return p;
        const isClearing = checkIsClearingStatus(p);
        const wasResting = p.specialStatus === 'resting';
        const wasLesson = p.specialStatus === 'lesson';

        if (isClearing) {
          const { specialStatus, lastMatchInitialGamesPlayed, ...rest } = p;
          if (wasResting) {
            const newOffset =
              computedRestOffset ??
              computeRestReturnOffset(p, prev, activeMatches, queuedMatches);
            if (newOffset > 0) {
              return {
                ...rest,
                hasRested: true,
                manualInterventionExempt: false,
                restEndedAt: now,
                restStartGamesPlayed: p.gamesPlayed || 0,
                consecutiveRestRounds: 0,
                initialAssignedOffset: newOffset,
              };
            }
            return {
              ...rest,
              restEndedAt: now,
              restStartGamesPlayed: p.gamesPlayed || 0,
              initialAssignedOffset: 0,
            };
          }
          if (wasLesson) {
            // 레슨 복귀: 공정 오프셋 산출 및 연속 게임 투입 방지 없음 (적은 경기 수를 빠르게 메울 수 있도록 연속 투입 및 최우선 배정 허용)
            return {
              ...rest,
              hasRested: undefined,
              manualInterventionExempt: true,
              restEndedAt: now,
              restStartedAt: undefined,
              restStartGamesPlayed: p.gamesPlayed || 0,
              consecutiveRestRounds: Math.max(1, p.consecutiveRestRounds || 1),
              initialAssignedOffset: 0,
            };
          }
          return rest;
        }

        if (status === 'resting') {
          return {
            ...p,
            specialStatus: 'resting',
            lastMatchInitialGamesPlayed: undefined,
            manualInterventionExempt: false,
            restStartedAt: now,
            restStartGamesPlayed: p.gamesPlayed || 0,
            consecutiveRestRounds: 0,
          };
        }

        if (status === 'lesson') {
          return {
            ...p,
            specialStatus: 'lesson',
            lastMatchInitialGamesPlayed: undefined,
            manualInterventionExempt: true,
            restStartedAt: now,
            restStartGamesPlayed: p.gamesPlayed || 0,
            consecutiveRestRounds: 0,
          };
        }

        if (wasResting) {
          const newOffset =
            computedRestOffset ??
            computeRestReturnOffset(p, prev, activeMatches, queuedMatches);
          return {
            ...p,
            specialStatus: status || undefined,
            lastMatchInitialGamesPlayed: status === 'last_match' ? p.gamesPlayed : undefined,
            ...(newOffset > 0
              ? {
                  hasRested: true,
                  manualInterventionExempt: false,
                  restEndedAt: now,
                  restStartGamesPlayed: p.gamesPlayed || 0,
                  consecutiveRestRounds: 0,
                  initialAssignedOffset: newOffset,
                }
              : {
                  restEndedAt: now,
                  restStartGamesPlayed: p.gamesPlayed || 0,
                  initialAssignedOffset: 0,
                }),
          };
        }

        if (wasLesson) {
          return {
            ...p,
            specialStatus: status || undefined,
            lastMatchInitialGamesPlayed: status === 'last_match' ? p.gamesPlayed : undefined,
            hasRested: undefined,
            manualInterventionExempt: true,
            restEndedAt: now,
            restStartedAt: undefined,
            restStartGamesPlayed: p.gamesPlayed || 0,
            consecutiveRestRounds: Math.max(1, p.consecutiveRestRounds || 1),
            initialAssignedOffset: 0,
          };
        }

        return {
          ...p,
          specialStatus: status || undefined,
          lastMatchInitialGamesPlayed: status === 'last_match' ? p.gamesPlayed : undefined,
        };
      });
    });

    setArchivedPlayers((prev) => {
      if (!prev[playerId]) return prev;
      const target = prev[playerId];
      const isClearing = checkIsClearingStatus(target);
      const wasResting = target.specialStatus === 'resting';
      const wasLesson = target.specialStatus === 'lesson';

      let updated: Player;
      if (isClearing) {
        const { specialStatus, lastMatchInitialGamesPlayed, ...rest } = target;
        if (wasResting) {
          const newOffset = computedRestOffset ?? (target.initialAssignedOffset || 0);
          updated =
            newOffset > 0
              ? {
                  ...rest,
                  hasRested: true,
                  manualInterventionExempt: false,
                  restEndedAt: now,
                  restStartGamesPlayed: target.gamesPlayed || 0,
                  consecutiveRestRounds: 0,
                  initialAssignedOffset: newOffset,
                }
              : {
                  ...rest,
                  restEndedAt: now,
                  restStartGamesPlayed: target.gamesPlayed || 0,
                  initialAssignedOffset: 0,
                };
        } else if (wasLesson) {
          updated = {
            ...rest,
            hasRested: undefined,
            manualInterventionExempt: true,
            restEndedAt: now,
            restStartedAt: undefined,
            restStartGamesPlayed: target.gamesPlayed || 0,
            consecutiveRestRounds: Math.max(1, target.consecutiveRestRounds || 1),
            initialAssignedOffset: 0,
          };
        } else {
          updated = rest;
        }
      } else if (status === 'resting') {
        updated = {
          ...target,
          specialStatus: 'resting',
          lastMatchInitialGamesPlayed: undefined,
          manualInterventionExempt: false,
          restStartedAt: now,
          restStartGamesPlayed: target.gamesPlayed || 0,
          consecutiveRestRounds: 0,
        };
      } else if (status === 'lesson') {
        updated = {
          ...target,
          specialStatus: 'lesson',
          lastMatchInitialGamesPlayed: undefined,
          manualInterventionExempt: true,
          restStartedAt: now,
          restStartGamesPlayed: target.gamesPlayed || 0,
          consecutiveRestRounds: 0,
        };
      } else {
        const newOffset = computedRestOffset ?? (target.initialAssignedOffset || 0);
        updated = {
          ...target,
          specialStatus: status || undefined,
          lastMatchInitialGamesPlayed: status === 'last_match' ? target.gamesPlayed : undefined,
          ...(wasResting
            ? newOffset > 0
              ? {
                  hasRested: true,
                  manualInterventionExempt: false,
                  restEndedAt: now,
                  restStartGamesPlayed: target.gamesPlayed || 0,
                  consecutiveRestRounds: 0,
                  initialAssignedOffset: newOffset,
                }
              : {
                  restEndedAt: now,
                  restStartGamesPlayed: target.gamesPlayed || 0,
                  initialAssignedOffset: 0,
                }
            : wasLesson
            ? {
                hasRested: undefined,
                manualInterventionExempt: true,
                restEndedAt: now,
                restStartedAt: undefined,
                restStartGamesPlayed: target.gamesPlayed || 0,
                consecutiveRestRounds: Math.max(1, target.consecutiveRestRounds || 1),
                initialAssignedOffset: 0,
              }
            : {}),
        };
      }
      const next = { ...prev, [playerId]: updated };
      saveArchivedPlayersToStorage(next);
      return next;
    });

    if (status) {
      const isAlreadyInQueueOrCourt =
        activePlayingIds.has(playerId) ||
        queuedMatches.some(
          (m) =>
            m.teamA.player1Id === playerId ||
            m.teamA.player2Id === playerId ||
            m.teamB.player1Id === playerId ||
            m.teamB.player2Id === playerId
        );
      const shouldDeselectFromBench =
        status === 'resting' ||
        status === 'lesson' ||
        status === 'exited' ||
        (status === 'last_match' && isAlreadyInQueueOrCourt);

      if (shouldDeselectFromBench) {
        setSelectedBenchPlayerIds((prev) => {
          const next = prev.filter((id) => id !== playerId);
          if (next.length === 1) {
            setSelectedSwap((currSwap) =>
              currSwap?.source === 'bench' ? { source: 'bench', playerId: next[0] } : currSwap
            );
          } else {
            setSelectedSwap((currSwap) =>
              currSwap?.source === 'bench' && currSwap.playerId === playerId ? null : currSwap
            );
          }
          return next;
        });
        setGameListSwapSelection((curr) =>
          curr?.type === 'bench' && curr.playerId === playerId ? null : curr
        );
      }
    }
    soundEffects.playWhistle();
  };


  const handleSaveOptions = (newOptions: MatchOptions) => {
    const syncedOptions: MatchOptions = {
      ...newOptions,
      courtCount: courts.length,
    };
    setOptions(syncedOptions);
    setDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS, JSON.stringify(syncedOptions));
  };

  // Generate 24 Random Test Players for Options Modal & Master Member Modal Test Feature (테스트 선수 24명 생성)
  // 테스트 선수를 생성해 운동이 짜여진 데이터는 운동 기록(캘린더)에 남지 않도록 처리
  const handleGenerateTestPlayers = () => {
    const now = new Date();
    const todayDateKey = formatDateKey(now);

    // 만약 과거 날짜 운동 기록을 열람 중이었다면 과거 기록을 덮어쓰지 않도록 당일 모드로 먼저 전환
    if (viewingWorkoutDate !== null) {
      setViewingWorkoutDate(null);
      saveViewingWorkoutDate(null);
    }
    clearTodayLiveStash();

    const testPlayers = generateRandom24Players().map((p) => ({
      ...p,
      isTest: true,
      registeredBeforeFirstAssign: true,
      firstFourAssignedAt: undefined,
      initialAssignedOffset: 0,
    }));
    const nextArchivedMap: Record<string, Player> = {};
    testPlayers.forEach((p) => {
      nextArchivedMap[p.id] = { ...p, isTest: true };
    });
    setPlayers(testPlayers);
    setArchivedPlayers(nextArchivedMap);
    setActiveMatches([]);
    setQueuedMatches([]);
    setRoundHistory([]);
    setSelectedSwap(null);
    setGameListSwapSelection(null);
    setConflictMatchTargetCourts({});
    setSelectedBenchPlayerIds([]);
    saveArchivedPlayersToStorage(nextArchivedMap);

    // 당일 운동 기록에서 테스트 운동 데이터가 남지 않도록 정리
    const cleanedRecords = deleteDailyWorkoutRecord(todayDateKey, now);
    deletePreMidnightRecord(todayDateKey, now);
    setWorkoutRecords(cleanedRecords);

    soundEffects.playWhistle();
  };

  // App Data Reset Handler
  const handleResetApp = (type: ResetType) => {
    setSelectedSwap(null);
    setGameListSwapSelection(null);
    setConflictMatchTargetCourts({});
    setSelectedBenchPlayerIds([]);
    setAssignQueueModalCourt(null);
    setShowCreateCourtConfirmModal(false);
    setShowGenerateModal(false);
    setResetEpoch((prev) => prev + 1);

    if (type === 'matches_only') {
      const resetNow = Date.now();
      const resetPlayers: Player[] = players.map((p, idx) => {
        const isCurrentlyBreak = p.specialStatus === 'resting' || p.specialStatus === 'lesson';
        return {
          ...p,
          gamesPlayed: 0,
          registeredAt: resetNow + idx,
          registeredBeforeFirstAssign: p.attendancePending ? undefined : true,
          firstFourAssignedAt: undefined,
          initialAssignedOffset: 0,
          hasRested: undefined,
          manualInterventionExempt: undefined,
          restStartedAt: isCurrentlyBreak ? resetNow : undefined,
          restEndedAt: undefined,
          restStartGamesPlayed: isCurrentlyBreak ? 0 : undefined,
          lastMatchInitialGamesPlayed: p.specialStatus === 'last_match' ? 0 : undefined,
          wins: 0,
          losses: 0,
          totalPointsWon: 0,
          totalPointsLost: 0,
          consecutiveRestRounds: 0,
          partnerHistory: {},
          opponentHistory: {},
          lastPartnerId: undefined,
          lastOpponentIds: undefined,
        };
      });

      const resetArchivedMap: Record<string, Player> = {};
      resetPlayers.forEach((p) => {
        resetArchivedMap[p.id] = { ...p };
      });

      const resetCourts: CourtInfo[] = courts.map((c) => ({
        ...c,
        cones: getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0)
          .slice()
          .sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0)),
        currentConeIndex: 0,
        turnStartedAt: resetNow,
        turnHistory: [],
      }));

      setActiveMatches([]);
      setQueuedMatches([]);
      setRoundHistory([]);
      setPlayers(resetPlayers);
      setArchivedPlayers(resetArchivedMap);
      setCourts(resetCourts);

      setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify(resetPlayers));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify(resetCourts));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify([]));
      saveArchivedPlayersToStorage(resetArchivedMap);
      saveMasterMembersToStorage(masterMembers);

      markKeysAsExplicitlyReset([
        LOCAL_STORAGE_KEY_PLAYERS,
        LOCAL_STORAGE_KEY_COURTS,
        LOCAL_STORAGE_KEY_MATCHES,
        LOCAL_STORAGE_KEY_QUEUED,
        LOCAL_STORAGE_KEY_HISTORY,
        LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
      ]);
    } else {
      // Full reset back to clean empty state (전체 완전 초기화: 모든 참가자 명단, 코트 설정, 대진기록 다 지움, 샘플 데이터도 안남김 / 단 기기 내부 전체 회원은 안전하게 보존)
      const resetOptions: MatchOptions = {
        mode: 'balanced',
        courtCount: 0,
        avoidConsecutiveRests: true,
        avoidDuplicatePartners: true,
      };
      const defaultMeetupName = '🏸 배드민턴 클럽 정기 모임';

      setPlayers([]);
      setCourts([]);
      setActiveMatches([]);
      setQueuedMatches([]);
      setRoundHistory([]);
      setArchivedPlayers({});
      setOptions(resetOptions);
      setMeetupName(defaultMeetupName);

      setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify([]));
      saveArchivedPlayersToStorage({});
      setDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS, JSON.stringify(resetOptions));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_NAME, defaultMeetupName);

      // 기기 내부 로컬 저장소에 보관된 [전체 회원] 명부는 사라지지 않고 안전하게 유지
      saveMasterMembersToStorage(masterMembers);

      // 현재 열람 중인 날짜(과거 날짜 또는 당일 날짜)의 운동 기록도 함께 초기화 (다른 날짜의 한달간 운동 기록은 그대로 보존)
      const now = new Date();
      const targetKeyToClear = viewingWorkoutDate || formatDateKey(now);
      const nextRecords = deleteDailyWorkoutRecord(targetKeyToClear, now);
      deletePreMidnightRecord(targetKeyToClear, now);
      setWorkoutRecords(nextRecords);

      markKeysAsExplicitlyReset([
        LOCAL_STORAGE_KEY_PLAYERS,
        LOCAL_STORAGE_KEY_COURTS,
        LOCAL_STORAGE_KEY_MATCHES,
        LOCAL_STORAGE_KEY_QUEUED,
        LOCAL_STORAGE_KEY_HISTORY,
        LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
        LOCAL_STORAGE_KEY_OPTIONS,
        LOCAL_STORAGE_KEY_NAME,
      ]);
    }
  };

  // 스냅샷을 현재 앱 상태(코트현황/게임목록/참가자명단/대진기록)에 적용하는 헬퍼
  const applyWorkoutSnapshotToApp = useCallback((snapshot: DailyWorkoutRecord | null) => {
    setSelectedSwap(null);
    setGameListSwapSelection(null);
    setConflictMatchTargetCourts({});
    setSelectedBenchPlayerIds([]);
    setAssignQueueModalCourt(null);
    setShowCreateCourtConfirmModal(false);
    setShowGenerateModal(false);
    setResetEpoch((prev) => prev + 1);

    const now = Date.now();
    const defaultOptions: MatchOptions = {
      mode: 'balanced',
      courtCount: 0,
      avoidConsecutiveRests: true,
      avoidDuplicatePartners: true,
    };
    const defaultMeetupName = '🏸 배드민턴 클럽 정기 모임';

    const nextPlayers = snapshot?.players ? [...snapshot.players] : [];
    const nextCourts = snapshot?.courts
      ? snapshot.courts.map((c: CourtInfo) => ({
          ...c,
          name: formatCourtName(extractCourtNumberLabel(c.name, c.courtNumber)),
          cones: getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0),
          currentConeIndex: 0,
          turnStartedAt: c.turnStartedAt || now,
        }))
      : [];
    const nextActiveMatches = snapshot?.activeMatches ? [...snapshot.activeMatches] : [];
    const nextQueuedMatches = snapshot?.queuedMatches ? [...snapshot.queuedMatches] : [];
    const nextRoundHistory = snapshot?.roundHistory ? [...snapshot.roundHistory] : [];
    const nextArchivedPlayers = snapshot?.archivedPlayers ? { ...snapshot.archivedPlayers } : {};
    const nextOptions = snapshot?.options
      ? { ...defaultOptions, ...snapshot.options }
      : defaultOptions;
    const nextMeetupName = snapshot?.meetupName || defaultMeetupName;

    setPlayers(nextPlayers);
    setCourts(nextCourts);
    setActiveMatches(nextActiveMatches);
    setQueuedMatches(nextQueuedMatches);
    setRoundHistory(nextRoundHistory);
    setArchivedPlayers(nextArchivedPlayers);
    setOptions(nextOptions);
    setMeetupName(nextMeetupName);

    setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify(nextPlayers));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify(nextCourts));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES, JSON.stringify(nextActiveMatches));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED, JSON.stringify(nextQueuedMatches));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify(nextRoundHistory));
    saveArchivedPlayersToStorage(nextArchivedPlayers);
    setDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS, JSON.stringify(nextOptions));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_NAME, nextMeetupName);

    markKeysAsExplicitlyReset([
      LOCAL_STORAGE_KEY_PLAYERS,
      LOCAL_STORAGE_KEY_COURTS,
      LOCAL_STORAGE_KEY_MATCHES,
      LOCAL_STORAGE_KEY_QUEUED,
      LOCAL_STORAGE_KEY_HISTORY,
      LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
      LOCAL_STORAGE_KEY_OPTIONS,
      LOCAL_STORAGE_KEY_NAME,
    ]);
  }, []);

  // [오늘 운동으로 이동]: 캘린더로 켜졌던 전 운동 기록을 집어넣고 당일 운동 기록으로 복귀
  const handleReturnToTodayWorkout = useCallback(() => {
    const todayDateKey = formatDateKey(new Date());
    const stashedToday = loadTodayLiveStash();
    const latestRecords = loadWorkoutRecords();
    const todaySnapshot = stashedToday || latestRecords[todayDateKey] || null;

    setViewingWorkoutDate(null);
    saveViewingWorkoutDate(null);
    clearTodayLiveStash();

    applyWorkoutSnapshotToApp(todaySnapshot);
    setShowWorkoutCalendarModal(false);
  }, [applyWorkoutSnapshotToApp]);

  // 캘린더에서 특정 날짜 클릭(터치) 시 해당 날짜로 저장된 운동 기록 켜기
  const handleSelectWorkoutDate = useCallback(
    (targetDateKey: string) => {
      const todayDateKey = formatDateKey(new Date());
      if (targetDateKey === todayDateKey) {
        if (viewingWorkoutDate !== null) {
          handleReturnToTodayWorkout();
        } else {
          setShowWorkoutCalendarModal(false);
        }
        return;
      }

      // 현재 당일 운동 중이었다면 당일 운동 상태를 안전하게 Stash에 보관
      if (viewingWorkoutDate === null) {
        const now = new Date();
        const isZeroToFour = now.getHours() >= 0 && now.getHours() < 4;
        const startedEarly = didFirstWorkoutStartInEarlyMorningWindow({
          now,
          targetDateKey: todayDateKey,
          players,
          activeMatches,
          queuedMatches,
          roundHistory,
          fourAmState,
        });
        const liveSnapshot: DailyWorkoutRecord = {
          date: todayDateKey,
          updatedAt: now.getTime(),
          meetupName,
          players,
          courts,
          activeMatches,
          queuedMatches,
          roundHistory,
          archivedPlayers,
          options,
        };
        saveTodayLiveStash(liveSnapshot);
        if (isWorkoutSnapshotNonEmpty(liveSnapshot) && (!isZeroToFour || startedEarly)) {
          const updated = upsertDailyWorkoutRecord(todayDateKey, liveSnapshot, {
            preserveExistingIfEmpty: true,
            now,
          });
          setWorkoutRecords(updated);
        }
      }

      const latestRecords = loadWorkoutRecords();
      const targetRecord = latestRecords[targetDateKey] || null;

      setViewingWorkoutDate(targetDateKey);
      saveViewingWorkoutDate(targetDateKey);
      applyWorkoutSnapshotToApp(targetRecord);
      setShowWorkoutCalendarModal(false);
    },
    [
      viewingWorkoutDate,
      handleReturnToTodayWorkout,
      meetupName,
      players,
      courts,
      activeMatches,
      queuedMatches,
      roundHistory,
      archivedPlayers,
      options,
      applyWorkoutSnapshotToApp,
    ]
  );

  // AM 04:00 전체 완전 초기화 실행 및 전날 날짜로 00:00시 전까지의 운동 기록 저장
  const executeFourAmArchiveAndFullReset = useCallback(
    (archiveDateKey: string, boundaryKey: string) => {
      const now = new Date();
      const todayDateKey = formatDateKey(now);
      // 만약 과거 기록을 보고 있었다면 보관된 당일 운동 Stash를 기준으로 전날 기록 확인
      const stashedToday = viewingWorkoutDate !== null ? loadTodayLiveStash() : null;
      const sourceSnapshot: DailyWorkoutRecord = stashedToday || {
        date: archiveDateKey,
        updatedAt: now.getTime(),
        meetupName,
        players,
        courts,
        activeMatches,
        queuedMatches,
        roundHistory,
        archivedPlayers,
        options,
      };

      // 1. 전날 날짜(archiveDateKey)에는 00:00시 전까지의 기록만 저장
      const preMidnightMap = loadPreMidnightRecords(now);
      const preMidnightCandidate =
        preMidnightMap[archiveDateKey] ||
        extractPreMidnightSnapshot(sourceSnapshot, archiveDateKey);
      const strictPreMidnightRecord = extractPreMidnightSnapshot(
        preMidnightCandidate,
        archiveDateKey
      );

      let nextRecords = loadWorkoutRecords(now);
      if (isWorkoutSnapshotNonEmpty(strictPreMidnightRecord)) {
        nextRecords = upsertDailyWorkoutRecord(archiveDateKey, strictPreMidnightRecord, {
          preserveExistingIfEmpty: true,
          now,
        });
      }

      // 당일 날짜(새벽 4시 이후 오늘 날짜)로 남아있던 임시 기록은 정리하여 깨끗한 당일 시작 보장
      if (todayDateKey !== archiveDateKey && nextRecords[todayDateKey]) {
        delete nextRecords[todayDateKey];
        saveWorkoutRecords(nextRecords, now);
      }
      deletePreMidnightRecord(todayDateKey, now);
      setWorkoutRecords({ ...nextRecords });

      // 2. 과거 기록 열람 상태 및 임시 Stash 초기화
      setViewingWorkoutDate(null);
      saveViewingWorkoutDate(null);
      clearTodayLiveStash();

      // 3. AM 04:00 알림 상태 완료 처리
      const nextFourAmState: FourAmResetState = {
        lastCompletedBoundaryKey: boundaryKey,
        pendingBoundaryKey: null,
        pendingArchiveDate: null,
        snoozeUntil: null,
        modalExpiresAt: null,
        earlyMorningBypassBoundaryKey: null,
      };
      setFourAmState(nextFourAmState);
      saveFourAmState(nextFourAmState);
      setIsFourAmModalOpen(false);
      setFourAmRemainingSeconds(180);

      // 4. 전체 완전 초기화 실행
      const resetOptions: MatchOptions = {
        mode: 'balanced',
        courtCount: 0,
        avoidConsecutiveRests: true,
        avoidDuplicatePartners: true,
      };
      const defaultMeetupName = '🏸 배드민턴 클럽 정기 모임';

      setSelectedSwap(null);
      setGameListSwapSelection(null);
      setConflictMatchTargetCourts({});
      setSelectedBenchPlayerIds([]);
      setAssignQueueModalCourt(null);
      setShowCreateCourtConfirmModal(false);
      setShowGenerateModal(false);
      setResetEpoch((prev) => prev + 1);

      setPlayers([]);
      setCourts([]);
      setActiveMatches([]);
      setQueuedMatches([]);
      setRoundHistory([]);
      setArchivedPlayers({});
      setOptions(resetOptions);
      setMeetupName(defaultMeetupName);

      setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_MATCHES, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_QUEUED, JSON.stringify([]));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify([]));
      saveArchivedPlayersToStorage({});
      setDeviceStorageItem(LOCAL_STORAGE_KEY_OPTIONS, JSON.stringify(resetOptions));
      setDeviceStorageItem(LOCAL_STORAGE_KEY_NAME, defaultMeetupName);
      saveMasterMembersToStorage(masterMembers);

      markKeysAsExplicitlyReset([
        LOCAL_STORAGE_KEY_PLAYERS,
        LOCAL_STORAGE_KEY_COURTS,
        LOCAL_STORAGE_KEY_MATCHES,
        LOCAL_STORAGE_KEY_QUEUED,
        LOCAL_STORAGE_KEY_HISTORY,
        LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
        LOCAL_STORAGE_KEY_OPTIONS,
        LOCAL_STORAGE_KEY_NAME,
      ]);
    },
    [
      viewingWorkoutDate,
      meetupName,
      players,
      courts,
      activeMatches,
      queuedMatches,
      roundHistory,
      archivedPlayers,
      options,
      masterMembers,
    ]
  );

  // AM 04:00 알림에서 [확인] 버튼 클릭 시: 전날 날짜로 00:00시 전까지의 기록 저장 후 즉시 전체 완전 초기화
  const handleConfirmFourAmReset = useCallback(() => {
    const now = new Date();
    const boundaryKey =
      fourAmState.pendingBoundaryKey ||
      fourAmState.lastCompletedBoundaryKey ||
      getLatestFourAmBoundaryKey(now);
    const archiveDateKey =
      fourAmState.pendingArchiveDate || getArchiveDateForBoundaryKey(boundaryKey);
    executeFourAmArchiveAndFullReset(archiveDateKey, boundaryKey);
  }, [fourAmState, executeFourAmArchiveAndFullReset]);

  // AM 04:00 알림에서 [취소] 버튼 클릭 시: 전체 완전 초기화는 실행하지 않고 알림만 끄며 30분 뒤에 다시 알림 표시
  const handleCancelFourAmResetSnooze = useCallback(() => {
    const now = new Date();
    const boundaryKey =
      fourAmState.pendingBoundaryKey ||
      fourAmState.lastCompletedBoundaryKey ||
      getLatestFourAmBoundaryKey(now);
    const archiveDateKey =
      fourAmState.pendingArchiveDate || getArchiveDateForBoundaryKey(boundaryKey);
    const snoozeUntil = Date.now() + 30 * 60 * 1000; // 30분 뒤 재알림

    const nextFourAmState: FourAmResetState = {
      lastCompletedBoundaryKey: boundaryKey,
      pendingBoundaryKey: boundaryKey,
      pendingArchiveDate: archiveDateKey,
      snoozeUntil,
      modalExpiresAt: null,
      earlyMorningBypassBoundaryKey: fourAmState.earlyMorningBypassBoundaryKey ?? null,
    };
    setFourAmState(nextFourAmState);
    saveFourAmState(nextFourAmState);
    setIsFourAmModalOpen(false);
    setFourAmRemainingSeconds(180);
  }, [fourAmState]);

  // 30분 유예 중 수동으로 즉시 초기화 알림 띄우기
  const handleTriggerFourAmPromptNow = useCallback(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const boundaryKey =
      fourAmState.pendingBoundaryKey ||
      fourAmState.lastCompletedBoundaryKey ||
      getLatestFourAmBoundaryKey(now);
    const archiveDateKey =
      fourAmState.pendingArchiveDate || getArchiveDateForBoundaryKey(boundaryKey);

    const nextFourAmState: FourAmResetState = {
      lastCompletedBoundaryKey: boundaryKey,
      pendingBoundaryKey: boundaryKey,
      pendingArchiveDate: archiveDateKey,
      snoozeUntil: null,
      modalExpiresAt: nowMs + 3 * 60 * 1000,
      earlyMorningBypassBoundaryKey: null,
    };
    setFourAmState(nextFourAmState);
    saveFourAmState(nextFourAmState);
    setFourAmRemainingSeconds(180);
    setShowWorkoutCalendarModal(false);
    setIsFourAmModalOpen(true);
    soundEffects.playWhistle();
  }, [fourAmState]);

  // 매 1초마다 AM 04:00 도달 여부, 당일 00:00~04:00 첫 운동 시작 시 면제 처리, 3분 카운트다운 만료 및 30분 재알림 체크
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const currentBoundaryKey = getLatestFourAmBoundaryKey(now);
      const didCrossBoundaryLive = lastObservedBoundaryKeyRef.current !== currentBoundaryKey;
      lastObservedBoundaryKeyRef.current = currentBoundaryKey;

      const boundaryFourAmMs = getFourAmTimestampForBoundaryKey(currentBoundaryKey);
      const isAtFourAmMinute =
        nowMs >= boundaryFourAmMs && nowMs < boundaryFourAmMs + 60 * 1000;
      const isLiveFourAmMoment = didCrossBoundaryLive || isAtFourAmMinute;

      const stashedToday = viewingWorkoutDate !== null ? loadTodayLiveStash() : null;
      const livePlayers = stashedToday ? stashedToday.players : players;
      const liveActiveMatches = stashedToday ? stashedToday.activeMatches : activeMatches;
      const liveQueuedMatches = stashedToday ? stashedToday.queuedMatches : queuedMatches;
      const liveRoundHistory = stashedToday ? stashedToday.roundHistory : roundHistory;

      // 0) 당일 00:00 ~ 04:00 사이에 첫 운동이 진행/배정이 시작되었는지 확인
      const startedInEarlyMorningForBoundary = didFirstWorkoutStartInEarlyMorningWindow({
        now,
        targetDateKey: currentBoundaryKey,
        players: livePlayers,
        activeMatches: liveActiveMatches,
        queuedMatches: liveQueuedMatches,
        roundHistory: liveRoundHistory,
        fourAmState,
      });

      if (startedInEarlyMorningForBoundary) {
        // 당일 00:00 ~ 04:00 사이에 첫 운동 진행/배정이 시작된 경우:
        // 전체 완전 초기화와 알림을 실행하지 않고, 전날 날짜에는 00:00시 전까지의 기록만 저장
        if (
          fourAmState.lastCompletedBoundaryKey !== currentBoundaryKey ||
          fourAmState.earlyMorningBypassBoundaryKey !== currentBoundaryKey ||
          fourAmState.modalExpiresAt !== null ||
          fourAmState.snoozeUntil !== null
        ) {
          const archiveDateKey = getArchiveDateForBoundaryKey(currentBoundaryKey);
          const sourceSnapshot: DailyWorkoutRecord = stashedToday || {
            date: archiveDateKey,
            updatedAt: nowMs,
            meetupName,
            players,
            courts,
            activeMatches,
            queuedMatches,
            roundHistory,
            archivedPlayers,
            options,
          };
          const preMidnightMap = loadPreMidnightRecords(now);
          const preMidnightCandidate =
            preMidnightMap[archiveDateKey] ||
            extractPreMidnightSnapshot(sourceSnapshot, archiveDateKey);
          const strictPreMidnightRecord = extractPreMidnightSnapshot(
            preMidnightCandidate,
            archiveDateKey
          );

          let updated = loadWorkoutRecords(now);
          if (isWorkoutSnapshotNonEmpty(strictPreMidnightRecord)) {
            updated = upsertDailyWorkoutRecord(archiveDateKey, strictPreMidnightRecord, {
              preserveExistingIfEmpty: false,
              now,
            });
          } else if (!preMidnightMap[archiveDateKey]) {
            updated = deleteDailyWorkoutRecord(archiveDateKey, now);
          }
          setWorkoutRecords(updated);

          const bypassedState: FourAmResetState = {
            lastCompletedBoundaryKey: currentBoundaryKey,
            pendingBoundaryKey: null,
            pendingArchiveDate: null,
            snoozeUntil: null,
            modalExpiresAt: null,
            earlyMorningBypassBoundaryKey: currentBoundaryKey,
          };
          setFourAmState(bypassedState);
          saveFourAmState(bypassedState);
          if (isFourAmModalOpen) {
            setIsFourAmModalOpen(false);
          }
        }
        return;
      }

      // 1) 현재 "전체 초기화 됩니다" 알림 모달이 켜져 있는 경우 (3분 카운트다운 진행 중)
      if (fourAmState.modalExpiresAt !== null && fourAmState.modalExpiresAt !== undefined) {
        const remaining = Math.max(0, Math.ceil((fourAmState.modalExpiresAt - nowMs) / 1000));
        setFourAmRemainingSeconds(remaining);

        // 3분(180초)이 지나면 알림을 자동으로 끄고 전날 날짜(00:00시 전까지의 기록) 저장 및 전체 완전 초기화 동작
        if (remaining <= 0) {
          const boundaryKey = fourAmState.pendingBoundaryKey || currentBoundaryKey;
          const archiveDateKey =
            fourAmState.pendingArchiveDate || getArchiveDateForBoundaryKey(boundaryKey);
          executeFourAmArchiveAndFullReset(archiveDateKey, boundaryKey);
          return;
        }

        if (!isFourAmModalOpen) {
          setIsFourAmModalOpen(true);
        }
        return;
      }

      // 2) [취소]를 눌러 30분 뒤 재알림 대기 중인 경우
      if (
        fourAmState.snoozeUntil !== null &&
        fourAmState.snoozeUntil !== undefined &&
        fourAmState.pendingArchiveDate
      ) {
        if (nowMs >= fourAmState.snoozeUntil) {
          const retriggeredState: FourAmResetState = {
            ...fourAmState,
            snoozeUntil: null,
            modalExpiresAt: nowMs + 3 * 60 * 1000,
          };
          setFourAmState(retriggeredState);
          saveFourAmState(retriggeredState);
          setFourAmRemainingSeconds(180);
          setIsFourAmModalOpen(true);
          soundEffects.playWhistle();
        }
        return;
      }

      // 3) 새로운 AM 04:00 경계 시각에 도달한 경우 (당일 00:00~04:00 첫 운동 시작이 없는 경우)
      if (fourAmState.lastCompletedBoundaryKey !== currentBoundaryKey) {
        const archiveDateKey = getArchiveDateForBoundaryKey(currentBoundaryKey);
        const sourceSnapshot: DailyWorkoutRecord = stashedToday || {
          date: archiveDateKey,
          updatedAt: nowMs,
          meetupName,
          players,
          courts,
          activeMatches,
          queuedMatches,
          roundHistory,
          archivedPlayers,
          options,
        };

        // 전날 날짜(archiveDateKey)에는 00:00시 전까지의 기록만 저장
        const preMidnightMap = loadPreMidnightRecords(now);
        const preMidnightCandidate =
          preMidnightMap[archiveDateKey] ||
          extractPreMidnightSnapshot(sourceSnapshot, archiveDateKey);
        const strictPreMidnightRecord = extractPreMidnightSnapshot(
          preMidnightCandidate,
          archiveDateKey
        );

        if (isWorkoutSnapshotNonEmpty(strictPreMidnightRecord)) {
          const updated = upsertDailyWorkoutRecord(archiveDateKey, strictPreMidnightRecord, {
            preserveExistingIfEmpty: true,
            now,
          });
          setWorkoutRecords(updated);
        }

        const hasBoardData = isWorkoutSnapshotNonEmpty(sourceSnapshot);
        const startedAfterFourAmToday = didWorkoutStartAfterFourAmBoundary(
          sourceSnapshot,
          currentBoundaryKey
        );

        // (A) 오전 04:00 시각이 아닌 일반 시간에 앱을 초기에 켠 경우:
        //     알림 모달을 띄우지 않고, 전날 잔여 데이터가 남아있다면 즉시 자동 아카이브 및 전체 초기화를 조용히 완료
        if (!isLiveFourAmMoment) {
          if (hasBoardData && !startedAfterFourAmToday) {
            executeFourAmArchiveAndFullReset(archiveDateKey, currentBoundaryKey);
          } else {
            const completedSilently: FourAmResetState = {
              lastCompletedBoundaryKey: currentBoundaryKey,
              pendingBoundaryKey: null,
              pendingArchiveDate: null,
              snoozeUntil: null,
              modalExpiresAt: null,
              earlyMorningBypassBoundaryKey: null,
            };
            setFourAmState(completedSilently);
            saveFourAmState(completedSilently);
            if (isFourAmModalOpen) {
              setIsFourAmModalOpen(false);
            }
          }
          return;
        }

        // (B) 오전 04:00 시각이 되었으나 초기화할 운동 데이터가 아예 없는 빈 상태이거나 이미 04:00 이후 데이터인 경우:
        //     불필요한 알림 없이 경계 상태만 완료 처리
        if (!hasBoardData || startedAfterFourAmToday) {
          const completedEmpty: FourAmResetState = {
            lastCompletedBoundaryKey: currentBoundaryKey,
            pendingBoundaryKey: null,
            pendingArchiveDate: null,
            snoozeUntil: null,
            modalExpiresAt: null,
            earlyMorningBypassBoundaryKey: null,
          };
          setFourAmState(completedEmpty);
          saveFourAmState(completedEmpty);
          if (isFourAmModalOpen) {
            setIsFourAmModalOpen(false);
          }
          return;
        }

        // (C) 앱을 켜둔 상태에서 실제로 오전 04:00 정각에 도달했고 진행/잔여 운동 기록이 있는 경우에만
        //     3분간 "전체 초기화 됩니다" 확인/취소 알림 표시
        const triggeredState: FourAmResetState = {
          lastCompletedBoundaryKey: currentBoundaryKey,
          pendingBoundaryKey: currentBoundaryKey,
          pendingArchiveDate: archiveDateKey,
          snoozeUntil: null,
          modalExpiresAt: nowMs + 3 * 60 * 1000,
          earlyMorningBypassBoundaryKey: null,
        };
        setFourAmState(triggeredState);
        saveFourAmState(triggeredState);
        setFourAmRemainingSeconds(180);
        setIsFourAmModalOpen(true);
        soundEffects.playWhistle();
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [
    fourAmState,
    isFourAmModalOpen,
    viewingWorkoutDate,
    meetupName,
    players,
    courts,
    activeMatches,
    queuedMatches,
    roundHistory,
    archivedPlayers,
    options,
    executeFourAmArchiveAndFullReset,
  ]);

  // Reset Match History Only (대진 기록 초기화)
  const handleResetHistory = () => {
    const resetNow = Date.now();
    const hasOngoingOrQueued = activeMatches.length > 0 || queuedMatches.length > 0;
    const resetPlayers: Player[] = players.map((p, idx) => {
      const isCurrentlyBreak = p.specialStatus === 'resting' || p.specialStatus === 'lesson';
      return {
        ...p,
        gamesPlayed: 0,
        registeredAt: hasOngoingOrQueued ? p.registeredAt : resetNow + idx,
        registeredBeforeFirstAssign: p.attendancePending
          ? undefined
          : hasOngoingOrQueued
            ? p.registeredBeforeFirstAssign
            : true,
        firstFourAssignedAt: p.attendancePending
          ? undefined
          : hasOngoingOrQueued
            ? p.firstFourAssignedAt
            : undefined,
        initialAssignedOffset: 0,
        hasRested: undefined,
        manualInterventionExempt: undefined,
        restStartedAt: isCurrentlyBreak ? resetNow : undefined,
        restEndedAt: undefined,
        restStartGamesPlayed: isCurrentlyBreak ? 0 : undefined,
        lastMatchInitialGamesPlayed: p.specialStatus === 'last_match' ? 0 : undefined,
        wins: 0,
        losses: 0,
        totalPointsWon: 0,
        totalPointsLost: 0,
        consecutiveRestRounds: 0,
        partnerHistory: {},
        opponentHistory: {},
        lastPartnerId: undefined,
        lastOpponentIds: undefined,
      };
    });

    const resetArchivedMap: Record<string, Player> = {};
    resetPlayers.forEach((p) => {
      resetArchivedMap[p.id] = { ...p };
    });

    const resetCourts: CourtInfo[] = courts.map((c) => ({
      ...c,
      cones: getNormalizedTurnQueue(c.cones || [], c.currentConeIndex || 0)
        .slice()
        .sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0)),
      currentConeIndex: 0,
      turnStartedAt: resetNow,
      turnHistory: [],
    }));

    setRoundHistory([]);
    setPlayers(resetPlayers);
    setArchivedPlayers(resetArchivedMap);
    setCourts(resetCourts);

    setDeviceStorageItem(LOCAL_STORAGE_KEY_PLAYERS, JSON.stringify(resetPlayers));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_COURTS, JSON.stringify(resetCourts));
    setDeviceStorageItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify([]));
    saveArchivedPlayersToStorage(resetArchivedMap);
    markKeysAsExplicitlyReset([
      LOCAL_STORAGE_KEY_PLAYERS,
      LOCAL_STORAGE_KEY_COURTS,
      LOCAL_STORAGE_KEY_HISTORY,
      LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS,
    ]);
    soundEffects.playWhistle();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
        }}
        onOpenGenerateModal={() => {
          setShowGenerateModal(true);
        }}
        onOpenResetModal={() => setShowResetModal(true)}
        onOpenWorkoutCalendar={() => setShowWorkoutCalendarModal(true)}
        viewingWorkoutDate={viewingWorkoutDate}
        activeMatchCount={activeMatches.length}
        queuedMatchCount={queuedMatches.length}
        totalPlayersCount={players.length}
        options={options}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-24 xl:pb-10">
        {viewingWorkoutDate && (
          <div className="mb-4 px-3.5 py-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 shadow-lg shadow-emerald-950/30">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs sm:text-sm font-black text-emerald-300">
                  {formatKoreanDateLabel(viewingWorkoutDate)} 운동 기록 열람·수정 중
                </span>
                <p className="text-[11px] text-slate-300 truncate">
                  코트현황 · 게임목록 · 참가자명단 · 대진기록에 해당 날짜의 기록이 켜져 있습니다.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowWorkoutCalendarModal(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                캘린더 열기
              </button>
              <button
                type="button"
                onClick={handleReturnToTodayWorkout}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                오늘 운동으로 이동
              </button>
            </div>
          </div>
        )}
        {activeTab === 'courts' && (
          <CourtBoardView
            key={`courts-${resetEpoch}`}
            currentRound={currentRound}
            courts={courts}
            activeMatches={activeMatches}
            queuedMatches={queuedMatches}
            completedMatches={allCompletedMatches}
            restingPlayers={restingPlayers}
            playersMap={playersMap}
            allPlayers={attendedPlayers}
            options={getEnrichedOptions(options)}
            meetupName={meetupName}
            onUpdateMeetupName={setMeetupName}
            onOpenGenerateModal={() => {
              setShowGenerateModal(true);
            }}
            onPreGenerateOneMatch={handlePreGenerateOneMatch}
            onPreGenerateFourMatches={handlePreGenerateFourMatches}
            onPreGenerateNMatches={handlePreGenerateNMatches}
            onCompleteMatch={handleCompleteMatch}
            onResetMatch={handleResetMatch}
            onCompleteAllMatches={handleCompleteAllMatches}
            selectedSwap={selectedSwap}
            onSelectPlayerForSwap={handleSelectPlayerForSwap}
            onCancelSwap={handleCancelSwap}
            onTogglePlayerActive={handleTogglePlayerActive}
            selectedBenchPlayerIds={selectedBenchPlayerIds}
            onToggleSelectBenchPlayer={handleToggleSelectBenchPlayer}
            onClearBenchSelection={handleClearBenchSelection}
            onAssignSelectedToCourt={handleAssignSelectedBenchToCourt}
            onAssignSelectedToQueue={handleAssignSelectedBenchToQueue}
            onAddCourt={handleAddCourt}
            onRemoveCourt={handleRemoveCourt}
            onRenameCourt={handleRenameCourt}
            onReorderCourts={setCourts}
            onAdvanceCourtTurn={handleAdvanceCourtTurn}
            onUpdateCourtCones={handleUpdateCourtCones}
            onGenerateForCourt={handleGenerateForCourt}
            onAssignQueueToCourt={(matchId, courtNum) => handleSendToCourt(matchId, courtNum, true)}
            onClearCourtMatch={handleClearCourtMatch}
            onRevertPreviousMatch={handleRevertPreviousMatch}
            onOpenAssignQueueModal={(courtNum) => setAssignQueueModalCourt(courtNum)}
            allCompletedMatches={allCompletedMatches}
            onSetPlayerSpecialStatus={handleSetPlayerSpecialStatus}
            conflictPlayerIds={conflictPlayerIds}
          />
        )}

        {activeTab === 'games' && (
          <GameListView
            key={`games-${resetEpoch}`}
            queuedMatches={queuedMatches}
            activeMatches={activeMatches}
            completedMatches={allCompletedMatches}
            playersMap={playersMap}
            courts={courts}
            activeCourtCount={courts.length || options.courtCount}
            options={getEnrichedOptions(options)}
            onOpenGenerateModal={() => setShowGenerateModal(true)}
            onPreGenerateQuick={handlePreGenerateQuick}
            onGenerateByArrivalOrder={handleGenerateByArrivalOrder}
            onGenerateSpecificQueueMatch={handleGenerateSpecificQueueMatch}
            onSendToCourt={handleSendToCourt}
            onDeleteQueuedMatch={handleDeleteQueuedMatch}
            onMoveQueueOrder={handleMoveQueueOrder}
            onUpdateQueuedMatches={(next) =>
              setQueuedMatches(
                orderQueuedMatchesWithSpecial(
                  next,
                  players,
                  activeMatches,
                  getEnrichedOptions(options)
                )
              )
            }
            onGoToCourtsTab={() => setActiveTab('courts')}
            onClearAllQueue={() => {
              setQueuedMatches([]);
              setConflictMatchTargetCourts({});
              setGameListSwapSelection(null);
            }}
            onSwapPlayersBetweenMatches={handleSwapActiveAndQueued}
            restingPlayers={restingPlayers}
            allPlayers={attendedPlayers}
            onSwapQueuedAndBench={handleSwapQueuedAndBench}
            onSwapQueuedPlayers={handleSwapQueuedPlayers}
            onGenerateQueueWithSelected={handleGenerateQueueWithSelected}
            onGenerateSpecialGameWithSelected={handleGenerateSpecialGameWithSelected}
            onSetPlayerSpecialStatus={handleSetPlayerSpecialStatus}
            onAdvanceCourtCone={handleAdvanceCourtCone}
            conflictPlayerIds={conflictPlayerIds}
            conflictMatchPlayers={conflictMatchPlayers}
            conflictMatchTargetCourts={conflictMatchTargetCourts}
            onClearConflictHighlight={handleClearConflictHighlight}
            onSwapActiveCourtPlayer={handleSelectPlayerForSwap}
            onSwapActiveAndBench={handleSwapActiveAndBench}
            onSwapActivePlayers={handleSwapActivePlayers}
            swapSelection={gameListSwapSelection}
            onSwapSelectionChange={setGameListSwapSelection}
          />
        )}

        {activeTab === 'players' && (
          <PlayerManager
            key={`players-${resetEpoch}`}
            players={players}
            onUpdatePlayers={setPlayers}
            activeMatches={activeMatches}
            queuedMatches={queuedMatches}
            archivedPlayers={archivedPlayers}
            onArchivePlayer={handleArchivePlayer}
            onSetPlayerSpecialStatus={handleSetPlayerSpecialStatus}
            masterMembers={masterMembers}
            onUpdateMasterMembers={handleUpdateMasterMembers}
            onSyncMemberEdit={handleSyncMemberEdit}
            onGenerateTestPlayers={handleGenerateTestPlayers}
          />
        )}

        {activeTab === 'history' && (
          <HistoryBoard
            key={`history-${resetEpoch}`}
            completedMatches={allCompletedMatches}
            roundHistory={roundHistory}
            playersMap={playersMap}
            meetupName={meetupName}
            onResetHistory={handleResetHistory}
          />
        )}
      </main>

      {/* Options Settings Modal */}
      <GenerateModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        options={options}
        onOptionsChange={handleSaveOptions}
        activePlayersCount={activePlayersCount}
        onGenerateTestPlayers={handleGenerateTestPlayers}
        onOpenResetModal={() => setShowResetModal(true)}
        masterMembers={masterMembers}
        onUpdateMasterMembers={handleUpdateMasterMembers}
        currentPlayers={players}
        onUpdatePlayers={setPlayers}
      />

      {/* App Data Reset Modal */}
      <ResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        onConfirmReset={handleResetApp}
        activeMatchCount={activeMatches.length}
        queuedMatchCount={queuedMatches.length}
        completedMatchCount={allCompletedMatches.length}
        totalPlayersCount={players.length}
      />

      {/* Create Court Confirmation Modal */}
      <CreateCourtConfirmModal
        isOpen={showCreateCourtConfirmModal}
        onClose={() => {
          setShowCreateCourtConfirmModal(false);
          setSelectedBenchPlayerIds([]);
          setSelectedSwap(null);
        }}
        onConfirm={handleConfirmCreateCourtAndAssign}
        selectedPlayerCount={selectedBenchPlayerIds.length}
      />

      {/* Assign Queue Match Modal (배정선수관리 창) */}
      {assignQueueModalCourt !== null && (
        <AssignQueueModal
          isOpen={assignQueueModalCourt !== null}
          onClose={() => setAssignQueueModalCourt(null)}
          courtNumber={assignQueueModalCourt}
          courtName={
            courts.find((c) => Number(c.courtNumber) === Number(assignQueueModalCourt))?.name
          }
          queuedMatches={queuedMatches}
          activeMatches={activeMatches}
          playersMap={playersMap}
          allPlayers={attendedPlayers}
          options={getEnrichedOptions(options)}
          currentRound={currentRound}
          onOpenGenerateModal={() => setShowGenerateModal(true)}
          onSelectMatch={handleAssignQueueMatchToCourt}
          onAutoGenerateForCourt={handleGenerateForCourt}
        />
      )}

      {/* 운동 기록 캘린더 모달 (최근 1달간의 운동 기록 조회·열람 및 오늘 운동으로 이동) */}
      <WorkoutCalendarModal
        isOpen={showWorkoutCalendarModal}
        onClose={() => setShowWorkoutCalendarModal(false)}
        workoutRecords={workoutRecords}
        todayLiveRecord={(() => {
          const todayKey = formatDateKey(new Date());
          const rawToday =
            (viewingWorkoutDate !== null ? loadTodayLiveStash() : null) ||
            workoutRecords[todayKey] || {
              date: todayKey,
              updatedAt: Date.now(),
              meetupName,
              players: [],
              courts: [],
              activeMatches: [],
              queuedMatches: [],
              roundHistory: [],
              archivedPlayers: {},
              options,
            };
          const sanitizedToday = sanitizeWorkoutSnapshotForStorage(rawToday);
          return {
            ...sanitizedToday,
            date: rawToday.date || todayKey,
            updatedAt: rawToday.updatedAt || Date.now(),
          };
        })()}
        viewingWorkoutDate={viewingWorkoutDate}
        onSelectDate={handleSelectWorkoutDate}
        onReturnToToday={handleReturnToTodayWorkout}
        snoozeUntil={fourAmState.snoozeUntil}
        onTriggerFourAmPromptNow={handleTriggerFourAmPromptNow}
      />

      {/* AM 04:00 전체 완전 초기화 알림 모달 (3분 카운트다운 / 확인 시 전날 저장 후 초기화 / 취소 시 30분 뒤 재알림) */}
      <FourAmResetModal
        isOpen={isFourAmModalOpen}
        remainingSeconds={fourAmRemainingSeconds}
        archiveDateKey={
          fourAmState.pendingArchiveDate ||
          getArchiveDateForBoundaryKey(getLatestFourAmBoundaryKey(new Date()))
        }
        onConfirmReset={handleConfirmFourAmReset}
        onCancelSnooze={handleCancelFourAmResetSnooze}
      />

      {/* In-App Alert Modal (replaces window.alert across all menus) */}
      {appAlertMessage && (
        <div
          data-court-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setAppAlertMessage(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-fit max-w-sm shadow-2xl text-center space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-200 leading-relaxed whitespace-pre-line">
              {appAlertMessage}
            </p>
            <div className="flex items-center justify-center pt-1">
              <button
                type="button"
                onClick={() => setAppAlertMessage(null)}
                className="px-6 py-2 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quiet Footer (Hidden on mobile where bottom nav bar is active) */}
      <footer className="hidden md:block border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img
              src="/assets/aistudio/logo_398f6a86.png"
              alt="MintonMatchMaker"
              className="h-5 w-auto object-contain opacity-80"
            />
            <span>민턴매치메이커 (MintonMatchMaker) · 배드민턴 클럽 자동 복식 매치메이커</span>
          </div>
          <div className="text-[11px] text-slate-600">
            실시간 코트 꼬깔(턴) 회전 · 빨간 꼬깔(우리클럽) & 회색 꼬깔(타클럽) · 자동 대기팀 투입
          </div>
        </div>
      </footer>
    </div>
  );
}
