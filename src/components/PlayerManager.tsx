import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player, Gender, Tier, TIER_LABELS, CourtMatch, MasterMember, isPlayerLastMatchCompleted } from '../types';
import {
  generateId,
  computeLateArrivalOffset,
  recalculateRelativeLateOffsets,
  reconcileManualPlayerIntervention,
  getFirstFourAssignmentStartTime,
  FIRST_ASSIGN_LATE_OFFSET_START_MS,
} from '../utils/matchmaker';
import { soundEffects } from '../utils/audio';
import { INITIAL_SAMPLE_PLAYERS } from '../utils/sampleData';
import {
  UserPlus,
  Trash2,
  Users,
  RotateCcw,
  Check,
  AlertCircle,
  X,
  Search,
  ChevronDown,
  Edit2,
  GripVertical,
  ListPlus,
  FlaskConical,
  Coffee,
  GraduationCap,
  Flag,
  DoorOpen,
} from 'lucide-react';
import { PartnerModal } from './PartnerModal';
import { PartnerDot } from './PartnerDot';
import { CrossedRacketsIcon } from './CrossedRacketsIcon';
import { MasterMemberModal } from './MasterMemberModal';
import { MemberSelectModal } from './MemberSelectModal';
import { ConeNumberPromptModal } from './ConeNumberPromptModal';
import {
  BulkRegisterModal,
  BulkAddPlayerEntry,
  BulkAddBatchResult,
} from './BulkRegisterModal';
import { getUniquePartnerPairs } from '../utils/partnerUtils';
import {
  findMatchingArchivedPlayer,
  saveArchivedPlayersToStorage,
  mergePlayersIntoArchive,
} from '../utils/playerArchive';
import {
  loadMasterMembersFromStorage,
  saveMasterMembersToStorage,
  syncPlayersAndMasterMembers,
  searchMasterMembersBySpelling,
  isTestPlayer,
} from '../utils/masterMemberStorage';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
  subscribeDeviceStorageHydration,
} from '../utils/deviceStorage';

interface PlayerManagerProps {
  players: Player[];
  onUpdatePlayers: (players: Player[]) => void;
  activeMatches?: CourtMatch[];
  queuedMatches?: CourtMatch[];
  archivedPlayers?: Record<string, Player>;
  onArchivePlayer?: (player: Player) => void;
  onSetPlayerSpecialStatus?: (playerId: string, status: 'resting' | 'lesson' | 'last_match' | 'exited' | null) => void;
  masterMembers?: MasterMember[];
  onUpdateMasterMembers?: (members: MasterMember[]) => void;
  onSyncMemberEdit?: (oldMember: MasterMember, updatedMember: MasterMember) => void;
  onGenerateTestPlayers?: () => void;
}

export const PlayerManager: React.FC<PlayerManagerProps> = ({
  players,
  onUpdatePlayers,
  activeMatches = [],
  queuedMatches = [],
  archivedPlayers = {},
  onArchivePlayer,
  onSetPlayerSpecialStatus,
  masterMembers: propMasterMembers,
  onUpdateMasterMembers: propOnUpdateMasterMembers,
  onSyncMemberEdit,
  onGenerateTestPlayers,
}) => {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);
  const newPlayerNameInputRef = useRef<HTMLInputElement | null>(null);

  // Master Members State (전체 회원 기기 내부 로컬 저장소 영구 보존 & 전 메뉴 동기화)
  const [localMasterMembers, setLocalMasterMembers] = useState<MasterMember[]>(() =>
    loadMasterMembersFromStorage()
  );
  const masterMembers = propMasterMembers ?? localMasterMembers;
  const masterMembersRef = useRef<MasterMember[]>(masterMembers);
  masterMembersRef.current = masterMembers;

  const [showMasterMemberModal, setShowMasterMemberModal] = useState(false);
  const [showBulkRegisterModal, setShowBulkRegisterModal] = useState(false);
  const [showTestConfirmModal, setShowTestConfirmModal] = useState(false);
  const [statusConfirmPlayer, setStatusConfirmPlayer] = useState<Player | null>(null);

  // Cone Number Prompt State for Adding Participant
  const [pendingAddPlayer, setPendingAddPlayer] = useState<{
    name: string;
    gender: Gender;
    tier: Tier;
    masterMemberId?: string;
    coneNumber?: number | string;
    fromMasterModal?: boolean;
  } | null>(null);
  const [showConePromptModal, setShowConePromptModal] = useState(false);

  // Cone Number Prompt State for Attendance Check (출석 버튼 클릭 시 꼬깔확인 연동용)
  const [pendingAttendanceConePlayer, setPendingAttendanceConePlayer] = useState<{
    id: string;
    name: string;
    gender: Gender;
    tier: Tier;
    coneNumber?: number | string;
  } | null>(null);

  // 꼬깔확인 체크박스 상태 (기본값: 체크 상태 true, 기기 내부 로컬 저장소 보존)
  const [isConePromptEnabled, setIsConePromptEnabled] = useState<boolean>(() => {
    const saved = getDeviceStorageItem(DEVICE_STORAGE_KEYS.CONE_CHECK_ENABLED);
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    return subscribeDeviceStorageHydration((restored) => {
      if (DEVICE_STORAGE_KEYS.CONE_CHECK_ENABLED in restored) {
        setIsConePromptEnabled(restored[DEVICE_STORAGE_KEYS.CONE_CHECK_ENABLED] === 'true');
      }
      if (DEVICE_STORAGE_KEYS.MASTER_MEMBERS in restored) {
        try {
          const parsed = JSON.parse(restored[DEVICE_STORAGE_KEYS.MASTER_MEMBERS]);
          if (Array.isArray(parsed)) {
            setLocalMasterMembers(parsed);
          }
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const handleToggleConePrompt = (checked: boolean) => {
    setIsConePromptEnabled(checked);
    setDeviceStorageItem(DEVICE_STORAGE_KEYS.CONE_CHECK_ENABLED, String(checked));
  };

  // Matching Member Selection Modal State
  const [showMemberSelectModal, setShowMemberSelectModal] = useState(false);
  const [selectSearchName, setSelectSearchName] = useState('');
  const [selectMatchedMembers, setSelectMatchedMembers] = useState<MasterMember[]>([]);

  // In-app Alert Modal & Form Feedback (iFrame 및 브라우저에서 확실하게 동작)
  const [alertModalMessage, setAlertModalMessage] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const showAlert = (message: string) => {
    soundEffects.playScorePoint();
    setAlertModalMessage(message);
    setFormNotice(message);
  };

  useEffect(() => {
    if (!alertModalMessage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        setAlertModalMessage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [alertModalMessage]);

  const handleUpdateMasterMembers = useCallback(
    (updated: MasterMember[]) => {
      setLocalMasterMembers(updated);
      saveMasterMembersToStorage(updated);
      if (propOnUpdateMasterMembers) {
        propOnUpdateMasterMembers(updated);
      }
    },
    [propOnUpdateMasterMembers]
  );

  // 당일 참가자 명단과 전체 회원의 1:1 ID 연동 및 상대평가 지각 오프셋 보정
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
      const hasOffsetChanges = recalculated.some(
        (p, idx) =>
          (p.initialAssignedOffset ?? 0) !== (basePlayers[idx]?.initialAssignedOffset ?? 0) ||
          p.registeredBeforeFirstAssign !== basePlayers[idx]?.registeredBeforeFirstAssign ||
          p.firstFourAssignedAt !== basePlayers[idx]?.firstFourAssignedAt
      );

      if (hasPlayerChanges || hasOffsetChanges) {
        onUpdatePlayers(recalculated);
      }
    }
  }, [players.length, activeMatches, queuedMatches]);

  // Execute Adding Single Player
  const executeAddPlayer = (
    playerName: string,
    playerGender: Gender,
    playerTier: Tier,
    masterMemberId?: string,
    coneNumber?: number | string,
    options?: { shouldFocusNameInput?: boolean }
  ) => {
    const trimmed = playerName.trim();
    if (!trimmed) return;

    soundEffects.playRacketHit();

    const finalCone =
      coneNumber !== undefined && coneNumber !== null && String(coneNumber).trim() !== ''
        ? String(coneNumber).trim()
        : undefined;

    // 전체 회원(masterMembers)과의 1:1 연동 ID 결정 (꼬깔 번호는 당일 참가자 전용이므로 전체 회원에는 저장하지 않음)
    let targetMasterId = masterMemberId;
    if (!targetMasterId) {
      // 기존 전체 회원 중 이름, 성별, 급수가 모두 일치하는 기존 회원 탐색
      const matchingMaster = masterMembers.find(
        (m) =>
          m.name.trim().toLowerCase() === trimmed.toLowerCase() &&
          m.gender === playerGender &&
          m.tier === playerTier
      );
      if (matchingMaster) {
        targetMasterId = matchingMaster.id;
      } else {
        // 일치하는 회원이 없으면(새 참가자 또는 동명이인이지만 성별/급수가 다른 신규 회원) 신규 전체 회원 생성
        targetMasterId = `master_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newMember: MasterMember = {
          id: targetMasterId,
          name: trimmed,
          gender: playerGender,
          tier: playerTier,
          registeredAt: Date.now(),
        };
        const updated = [...masterMembers, newMember].sort((a, b) => {
          const nameDiff = a.name.localeCompare(b.name, 'ko');
          if (nameDiff !== 0) return nameDiff;
          const genderDiff = a.gender.localeCompare(b.gender);
          if (genderDiff !== 0) return genderDiff;
          return a.tier.localeCompare(b.tier);
        });
        handleUpdateMasterMembers(updated);
      }
    }

    // Check for matching archived player (same name, tier & gender)
    const matchingArchived = findMatchingArchivedPlayer(
      trimmed,
      playerTier,
      archivedPlayers,
      players,
      playerGender
    );

    const attendedExisting = players.filter((p) => !p.attendancePending);
    const maxAttendedRegTime = attendedExisting.reduce(
      (maxT, p) => Math.max(maxT, p.registeredAt ?? p.createdAt ?? 0),
      0
    );
    const now = Math.max(Date.now(), maxAttendedRegTime + 1);
    const firstFourStartedAt = getFirstFourAssignmentStartTime(
      attendedExisting,
      activeMatches,
      queuedMatches
    );
    const isBeforeLateOffsetStart =
      firstFourStartedAt === null ||
      now - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS;
    const lateOffset = computeLateArrivalOffset(
      attendedExisting,
      activeMatches,
      queuedMatches,
      playerGender,
      now
    );

    let newPlayer: Player;
    if (matchingArchived) {
      const validPartnerId =
        matchingArchived.partnerId &&
        players.some((p) => p.id === matchingArchived.partnerId)
          ? matchingArchived.partnerId
          : undefined;
      const hasPriorGames = (matchingArchived.gamesPlayed || 0) > 0;
      const wasBeforeFirstAssign = hasPriorGames
        ? (matchingArchived.registeredBeforeFirstAssign ?? false)
        : isBeforeLateOffsetStart;
      newPlayer = {
        ...matchingArchived,
        id: matchingArchived.id, // 기존 대진기록과 동일한 ID 유지
        name: trimmed,
        gender: playerGender,
        tier: playerTier,
        coneNumber: finalCone ?? matchingArchived.coneNumber,
        isActive: true,
        attendancePending: false,
        masterMemberId: targetMasterId,
        partnerId: validPartnerId,
        registeredAt: hasPriorGames
          ? matchingArchived.registeredAt ?? matchingArchived.createdAt ?? now
          : now,
        registeredBeforeFirstAssign: wasBeforeFirstAssign,
        firstFourAssignedAt: firstFourStartedAt ?? undefined,
        initialAssignedOffset: hasPriorGames
          ? matchingArchived.initialAssignedOffset ?? 0
          : wasBeforeFirstAssign
            ? 0
            : Math.max(matchingArchived.initialAssignedOffset ?? 0, lateOffset),
      };
      if (hasPriorGames) {
        setRestoredNotice(
          `'${newPlayer.name}' (${TIER_LABELS[newPlayer.tier]?.short || newPlayer.tier}) 선수의 이전 배정/진행 기록(${newPlayer.gamesPlayed}경기)이 정상 적용되었습니다.`
        );
        setTimeout(() => setRestoredNotice(null), 4500);
      }
    } else {
      newPlayer = {
        id: generateId(),
        name: trimmed,
        gender: playerGender,
        tier: playerTier,
        coneNumber: finalCone,
        isActive: true,
        attendancePending: false,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalPointsWon: 0,
        totalPointsLost: 0,
        consecutiveRestRounds: 0,
        partnerHistory: {},
        opponentHistory: {},
        createdAt: now,
        registeredAt: now,
        registeredBeforeFirstAssign: isBeforeLateOffsetStart,
        firstFourAssignedAt: firstFourStartedAt ?? undefined,
        initialAssignedOffset: isBeforeLateOffsetStart ? 0 : lateOffset,
        masterMemberId: targetMasterId,
      };
    }

    const pendingExisting = players.filter((p) => p.attendancePending);
    const orderedWithNew = [...attendedExisting, newPlayer, ...pendingExisting].map((p) => {
      if (newPlayer.partnerId && p.id === newPlayer.partnerId && !p.partnerId) {
        return { ...p, partnerId: newPlayer.id };
      }
      return p;
    });

    const nextPlayers = recalculateRelativeLateOffsets(
      orderedWithNew,
      activeMatches,
      queuedMatches
    );
    onUpdatePlayers(nextPlayers);

    const shouldFocusNameInput =
      options?.shouldFocusNameInput !== undefined
        ? options.shouldFocusNameInput
        : !showMasterMemberModal;

    if (shouldFocusNameInput) {
      // 직접 입력창에서 새 참가자 등록 완료 시: 성별/급수를 초기화하고 이름 입력창 포커스 유지 (연속 등록 지원)
      setName('');
      setGender(null);
      setTier(null);
      setFormNotice(null);
      requestAnimationFrame(() => {
        try {
          newPlayerNameInputRef.current?.focus({ preventScroll: true });
        } catch {
          newPlayerNameInputRef.current?.focus();
        }
      });
    } else {
      // 전체회원관리 모달 등에서 [오늘 참가] 버튼으로 등록한 경우: 배경 입력창 포커스로 인해 가상 키보드가 올라오지 않도록 차단
      newPlayerNameInputRef.current?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  };

  // 일괄 등록 처리 (전체회원관리 실시간 동기화, 동명이인 선택, 신규회원 성별/급수 등록, 꼬깔번호 반영)
  const handleExecuteBatchRegister = useCallback(
    (entries: BulkAddPlayerEntry[]): BulkAddBatchResult => {
      if (!entries || entries.length === 0) {
        return { addedCount: 0, skippedDuplicates: [], restoredNames: [] };
      }

      const workingPlayers: Player[] = [...playersRef.current];
      const workingMasterMembers: MasterMember[] = [...masterMembersRef.current];
      let hasMasterChanges = false;
      let addedCount = 0;
      let updatedConeCount = 0;
      const skippedDuplicates: string[] = [];
      const restoredNames: string[] = [];
      const baseNow = Date.now();

      entries.forEach((entry, idx) => {
        const trimmed = entry.name.trim();
        if (!trimmed) return;

        const finalCone =
          entry.coneNumber !== undefined &&
          entry.coneNumber !== null &&
          String(entry.coneNumber).trim() !== ''
            ? String(entry.coneNumber).trim()
            : undefined;

        // 1. 전체 회원(masterMembers)과의 1:1 연동 ID 결정 (신규 회원이면 전체회원관리에 신규 등록)
        let targetMasterId = entry.masterMemberId;
        if (!targetMasterId || !workingMasterMembers.some((m) => m.id === targetMasterId)) {
          const matchingMaster = workingMasterMembers.find(
            (m) =>
              m.name.trim().toLowerCase() === trimmed.toLowerCase() &&
              m.gender === entry.gender &&
              m.tier === entry.tier
          );
          if (matchingMaster) {
            targetMasterId = matchingMaster.id;
          } else {
            targetMasterId = `master_${baseNow}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
            const newMember: MasterMember = {
              id: targetMasterId,
              name: trimmed,
              gender: entry.gender,
              tier: entry.tier,
              registeredAt: baseNow + idx,
            };
            workingMasterMembers.push(newMember);
            hasMasterChanges = true;
          }
        }

        // 2. 이미 당일 참가자 명단에 등록되어 있는지 확인
        const existingPlayerIdx = workingPlayers.findIndex(
          (p) =>
            (targetMasterId && p.masterMemberId === targetMasterId) ||
            (p.name.trim().toLowerCase() === trimmed.toLowerCase() &&
              p.gender === entry.gender &&
              p.tier === entry.tier)
        );

        const isPendingEntry = Boolean(entry.attendancePending);

        if (existingPlayerIdx !== -1) {
          const existingP = workingPlayers[existingPlayerIdx];
          if (existingP.attendancePending && !isPendingEntry) {
            // 출석 대기 중이던 선수가 출석체크 비체크 일괄등록으로 들어온 경우 즉시 출석 전환
            const attendedInWorking = workingPlayers.filter((p) => !p.attendancePending);
            const maxAttendedTime = attendedInWorking.reduce(
              (maxT, p) => Math.max(maxT, p.registeredAt ?? p.createdAt ?? 0),
              0
            );
            const attendNow = Math.max(baseNow + idx, maxAttendedTime + 1);
            const firstFourStartedAt = getFirstFourAssignmentStartTime(
              attendedInWorking,
              activeMatches,
              queuedMatches
            );
            const isBeforeLateOffsetStart =
              firstFourStartedAt === null ||
              attendNow - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS;
            const lateOffset = computeLateArrivalOffset(
              attendedInWorking,
              activeMatches,
              queuedMatches,
              existingP.gender,
              attendNow
            );
            const updatedExisting: Player = {
              ...existingP,
              attendancePending: false,
              coneNumber: finalCone ?? existingP.coneNumber,
              registeredAt: attendNow,
              registeredBeforeFirstAssign: isBeforeLateOffsetStart,
              firstFourAssignedAt: firstFourStartedAt ?? undefined,
              initialAssignedOffset: isBeforeLateOffsetStart ? 0 : lateOffset,
            };
            workingPlayers.splice(existingPlayerIdx, 1);
            const firstPendingIdx = workingPlayers.findIndex((p) => p.attendancePending);
            if (firstPendingIdx === -1) {
              workingPlayers.push(updatedExisting);
            } else {
              workingPlayers.splice(firstPendingIdx, 0, updatedExisting);
            }
            addedCount++;
          } else if (
            finalCone !== undefined &&
            workingPlayers[existingPlayerIdx].coneNumber !== finalCone
          ) {
            workingPlayers[existingPlayerIdx] = {
              ...workingPlayers[existingPlayerIdx],
              coneNumber: finalCone,
            };
            updatedConeCount++;
          } else {
            skippedDuplicates.push(trimmed);
          }
          return;
        }

        // 3. 당일 이전 경기 기록(아카이브) 존재 여부 확인
        const matchingArchived = findMatchingArchivedPlayer(
          trimmed,
          entry.tier,
          archivedPlayers,
          workingPlayers,
          entry.gender
        );

        const attendedInWorking = workingPlayers.filter((p) => !p.attendancePending);
        const maxAttendedTime = attendedInWorking.reduce(
          (maxT, p) => Math.max(maxT, p.registeredAt ?? p.createdAt ?? 0),
          0
        );
        const itemNow = isPendingEntry
          ? baseNow + idx
          : Math.max(baseNow + idx, maxAttendedTime + 1);
        const firstFourStartedAt = getFirstFourAssignmentStartTime(
          attendedInWorking,
          activeMatches,
          queuedMatches
        );
        const isBeforeLateOffsetStart =
          firstFourStartedAt === null ||
          itemNow - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS;
        const lateOffset = isPendingEntry
          ? 0
          : computeLateArrivalOffset(
              attendedInWorking,
              activeMatches,
              queuedMatches,
              entry.gender,
              itemNow
            );

        let newPlayer: Player;
        if (matchingArchived) {
          const validPartnerId =
            matchingArchived.partnerId &&
            workingPlayers.some((p) => p.id === matchingArchived.partnerId)
              ? matchingArchived.partnerId
              : undefined;
          const hasPriorGames = (matchingArchived.gamesPlayed || 0) > 0;
          const wasBeforeFirstAssign = hasPriorGames
            ? (matchingArchived.registeredBeforeFirstAssign ?? false)
            : isBeforeLateOffsetStart;

          newPlayer = {
            ...matchingArchived,
            id: matchingArchived.id,
            name: trimmed,
            gender: entry.gender,
            tier: entry.tier,
            coneNumber: finalCone ?? matchingArchived.coneNumber,
            isActive: true,
            attendancePending: isPendingEntry,
            masterMemberId: targetMasterId,
            partnerId: validPartnerId,
            registeredAt: hasPriorGames
              ? matchingArchived.registeredAt ?? matchingArchived.createdAt ?? itemNow
              : itemNow,
            registeredBeforeFirstAssign: isPendingEntry ? undefined : wasBeforeFirstAssign,
            firstFourAssignedAt: isPendingEntry ? undefined : (firstFourStartedAt ?? undefined),
            initialAssignedOffset: isPendingEntry
              ? 0
              : hasPriorGames
                ? matchingArchived.initialAssignedOffset ?? 0
                : wasBeforeFirstAssign
                  ? 0
                  : Math.max(matchingArchived.initialAssignedOffset ?? 0, lateOffset),
          };

          if (hasPriorGames) {
            restoredNames.push(`${newPlayer.name}(${newPlayer.gamesPlayed}경기)`);
          }
        } else {
          newPlayer = {
            id: generateId(),
            name: trimmed,
            gender: entry.gender,
            tier: entry.tier,
            coneNumber: finalCone,
            isActive: true,
            attendancePending: isPendingEntry,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            totalPointsWon: 0,
            totalPointsLost: 0,
            consecutiveRestRounds: 0,
            partnerHistory: {},
            opponentHistory: {},
            createdAt: itemNow,
            registeredAt: itemNow,
            registeredBeforeFirstAssign: isPendingEntry ? undefined : isBeforeLateOffsetStart,
            firstFourAssignedAt: isPendingEntry ? undefined : (firstFourStartedAt ?? undefined),
            initialAssignedOffset: isPendingEntry
              ? 0
              : isBeforeLateOffsetStart
                ? 0
                : lateOffset,
            masterMemberId: targetMasterId,
          };
        }

        if (isPendingEntry) {
          workingPlayers.push(newPlayer);
        } else {
          const firstPendingIdx = workingPlayers.findIndex((p) => p.attendancePending);
          if (firstPendingIdx === -1) {
            workingPlayers.push(newPlayer);
          } else {
            workingPlayers.splice(firstPendingIdx, 0, newPlayer);
          }
        }

        if (newPlayer.partnerId) {
          const partnerIdx = workingPlayers.findIndex((p) => p.id === newPlayer.partnerId);
          if (partnerIdx !== -1 && !workingPlayers[partnerIdx].partnerId) {
            workingPlayers[partnerIdx] = {
              ...workingPlayers[partnerIdx],
              partnerId: newPlayer.id,
            };
          }
        }
        addedCount++;
      });

      if (hasMasterChanges) {
        const sortedMasters = [...workingMasterMembers].sort((a, b) => {
          const nameDiff = a.name.localeCompare(b.name, 'ko');
          if (nameDiff !== 0) return nameDiff;
          const genderDiff = a.gender.localeCompare(b.gender);
          if (genderDiff !== 0) return genderDiff;
          return a.tier.localeCompare(b.tier);
        });
        masterMembersRef.current = sortedMasters;
        handleUpdateMasterMembers(sortedMasters);
      }

      if (addedCount > 0 || updatedConeCount > 0) {
        const nextPlayers = recalculateRelativeLateOffsets(
          workingPlayers,
          activeMatches,
          queuedMatches
        );
        playersRef.current = nextPlayers;
        onUpdatePlayers(nextPlayers);
      }

      return {
        addedCount,
        skippedDuplicates,
        restoredNames,
      };
    },
    [activeMatches, archivedPlayers, handleUpdateMasterMembers, onUpdatePlayers, queuedMatches]
  );

  // Add Single Player Form Submit
  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert('참가자 이름을 입력해 주세요.');
      return;
    }

    // 성별 또는 급수가 선택되지 않은 상태에서 이름만 써서 추가 시도한 경우
    if (!gender || !tier) {
      const matched = searchMasterMembersBySpelling(trimmed, masterMembers);

      if (matched.length > 0) {
        // 전체 회원에서 같은 철자의 회원을 찾은 경우 -> 선택 모달 오픈
        soundEffects.playWhistle();
        setSelectSearchName(trimmed);
        setSelectMatchedMembers(matched);
        setShowMemberSelectModal(true);
        return;
      } else {
        // 전체 회원에 같은 철자의 선수가 없는 경우 -> 알림 띄우고 추가 방지
        showAlert('성별과 급수를 선택해 주세요');
        return;
      }
    }

    // 성별과 급수가 모두 선택된 경우: 당일 참가자 중 이름, 성별, 급수가 모두 동일한 선수만 중복으로 차단
    const exactAlreadyInToday = players.some(
      (p) =>
        p.name.trim().toLowerCase() === trimmed.toLowerCase() &&
        p.gender === gender &&
        p.tier === tier
    );

    if (exactAlreadyInToday) {
      showAlert(
        `'${trimmed}' (${gender === 'M' ? '남성' : '여성'}, ${
          TIER_LABELS[tier]?.short || tier
        }) 선수는 이미 당일 참가자 명단에 등록되어 있습니다.`
      );
      return;
    }

    // 이름이 같아도 성별 또는 급수가 다르면 새로운 참가자로 정상 추가
    if (isConePromptEnabled) {
      soundEffects.playRacketHit();
      setPendingAddPlayer({
        name: trimmed,
        gender,
        tier,
        fromMasterModal: false,
      });
      setShowConePromptModal(true);
    } else {
      executeAddPlayer(trimmed, gender, tier, undefined, undefined, {
        shouldFocusNameInput: true,
      });
    }
  };

  const handleConfirmConePrompt = (coneNumberInput: string) => {
    if (!pendingAddPlayer) return;
    const trimmedCone = coneNumberInput.trim();
    const shouldFocus = !pendingAddPlayer.fromMasterModal && !showMasterMemberModal;
    executeAddPlayer(
      pendingAddPlayer.name,
      pendingAddPlayer.gender,
      pendingAddPlayer.tier,
      pendingAddPlayer.masterMemberId,
      trimmedCone ? trimmedCone : undefined,
      { shouldFocusNameInput: shouldFocus }
    );
    setPendingAddPlayer(null);
    setShowConePromptModal(false);
  };

  const handleSkipConePrompt = () => {
    if (!pendingAddPlayer) return;
    const shouldFocus = !pendingAddPlayer.fromMasterModal && !showMasterMemberModal;
    executeAddPlayer(
      pendingAddPlayer.name,
      pendingAddPlayer.gender,
      pendingAddPlayer.tier,
      pendingAddPlayer.masterMemberId,
      pendingAddPlayer.coneNumber,
      { shouldFocusNameInput: shouldFocus }
    );
    setPendingAddPlayer(null);
    setShowConePromptModal(false);
  };

  // Toggle Player Active
  const handleToggleActive = (id: string) => {
    soundEffects.playScorePoint();
    onUpdatePlayers(
      players.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p))
    );
  };

  // Delete Player (참가자 삭제 시에도 대진기록에서 사라지지 않도록 아카이브에 영구 보관)
  const handleDeletePlayer = (id: string) => {
    const target = players.find((p) => p.id === id);
    if (target) {
      if (onArchivePlayer) {
        onArchivePlayer(target);
      } else {
        const updated = mergePlayersIntoArchive([target], archivedPlayers);
        saveArchivedPlayersToStorage(updated);
      }
    }
    const remainingPlayers = players
      .filter((p) => p.id !== id)
      .map((p) => (p.partnerId === id ? { ...p, partnerId: undefined } : p));
    onUpdatePlayers(
      recalculateRelativeLateOffsets(remainingPlayers, activeMatches, queuedMatches)
    );
  };

  // Update Player Tier (급수 변경 시, 전체 회원 관리와 1:1 동기화하여 해당 회원의 급수도 변경)
  const handleUpdateTier = (id: string, newTier: Tier) => {
    soundEffects.playScorePoint();
    const targetPlayer = players.find((p) => p.id === id);
    if (!targetPlayer) return;

    let updatedPlayer: Player = { ...targetPlayer, tier: newTier };

    const isInActiveOrQueuedMatch =
      activeMatches.some(
        (m) =>
          m.teamA.player1Id === id ||
          m.teamA.player2Id === id ||
          m.teamB.player1Id === id ||
          m.teamB.player2Id === id
      ) ||
      queuedMatches.some(
        (m) =>
          m.teamA.player1Id === id ||
          m.teamA.player2Id === id ||
          m.teamB.player1Id === id ||
          m.teamB.player2Id === id
      );

    if (!isTestPlayer(targetPlayer) && (targetPlayer.gamesPlayed ?? 0) === 0) {
      const matchingArchived = findMatchingArchivedPlayer(
        targetPlayer.name,
        newTier,
        archivedPlayers,
        players.filter((x) => x.id !== id),
        targetPlayer.gender
      );
      if (matchingArchived && (matchingArchived.gamesPlayed ?? 0) > 0) {
        setRestoredNotice(
          `'${targetPlayer.name}' (${TIER_LABELS[newTier]?.short || newTier}) 선수의 이전 배정/진행 기록(${matchingArchived.gamesPlayed}경기)이 정상 적용되었습니다.`
        );
        setTimeout(() => setRestoredNotice(null), 4500);
        const nextId = isInActiveOrQueuedMatch ? targetPlayer.id : matchingArchived.id;
        updatedPlayer = {
          ...matchingArchived,
          id: nextId,
          name: targetPlayer.name,
          gender: targetPlayer.gender,
          tier: newTier,
          isActive: targetPlayer.isActive,
          isTest: targetPlayer.isTest,
          masterMemberId: targetPlayer.masterMemberId,
          partnerId: targetPlayer.partnerId ?? matchingArchived.partnerId,
        };
      }
    }

    const updatedPlayers = players.map((p) => {
      if (p.id === id) return updatedPlayer;
      if (p.partnerId === id && updatedPlayer.id !== id) {
        return { ...p, partnerId: updatedPlayer.id };
      }
      return p;
    });
    onUpdatePlayers(updatedPlayers);

    // 전체 회원 관리(masterMembers)에 등록된 해당 선수의 급수도 즉시 1:1 동기화 (신규 생성 X, 테스트 선수는 제외)
    if (!isTestPlayer(targetPlayer)) {
      let oldMemberForSync: MasterMember | undefined;
      let newMemberForSync: MasterMember | undefined;
      const updatedMasterList = masterMembers.map((m) => {
        const isTarget =
          (targetPlayer.masterMemberId && m.id === targetPlayer.masterMemberId) ||
          (!targetPlayer.masterMemberId &&
            m.name.trim().toLowerCase() === targetPlayer.name.trim().toLowerCase() &&
            m.gender === targetPlayer.gender &&
            m.tier === targetPlayer.tier);
        if (isTarget) {
          oldMemberForSync = m;
          newMemberForSync = { ...m, tier: newTier };
          return newMemberForSync;
        }
        return m;
      });
      handleUpdateMasterMembers(updatedMasterList);
      if (onSyncMemberEdit && oldMemberForSync && newMemberForSync) {
        onSyncMemberEdit(oldMemberForSync, newMemberForSync);
      }
    }
  };

  // Toggle Player Gender on Double-Click (더블 클릭 시 성별 변경: 남 ↔ 여, 전체회원관리와 1:1 동기화)
  const handleToggleGender = (id: string) => {
    soundEffects.playRacketHit();
    const targetPlayer = players.find((p) => p.id === id);
    if (!targetPlayer) return;
    const newGender: Gender = targetPlayer.gender === 'M' ? 'F' : 'M';

    const updatedPlayers = players.map((p) =>
      p.id === id ? { ...p, gender: newGender } : p
    );
    onUpdatePlayers(updatedPlayers);

    // 전체 회원 관리(masterMembers)에 등록된 해당 선수의 성별도 즉시 1:1 동기화 (신규 생성 X, 테스트 선수는 제외)
    if (!isTestPlayer(targetPlayer)) {
      let oldMemberForSync: MasterMember | undefined;
      let newMemberForSync: MasterMember | undefined;
      const updatedMasterList = masterMembers.map((m) => {
        const isTarget =
          (targetPlayer.masterMemberId && m.id === targetPlayer.masterMemberId) ||
          (!targetPlayer.masterMemberId &&
            m.name.trim().toLowerCase() === targetPlayer.name.trim().toLowerCase() &&
            m.gender === targetPlayer.gender &&
            m.tier === targetPlayer.tier);
        if (isTarget) {
          oldMemberForSync = m;
          newMemberForSync = { ...m, gender: newGender };
          return newMemberForSync;
        }
        return m;
      });
      handleUpdateMasterMembers(updatedMasterList);
      if (onSyncMemberEdit && oldMemberForSync && newMemberForSync) {
        onSyncMemberEdit(oldMemberForSync, newMemberForSync);
      }
    }
  };

  // Participant Name & Cone Editing (이름 및 꼬깔 번호 수정 시 아카이브 및 전체 회원 관리 1:1 연동)
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [editingConeNumber, setEditingConeNumber] = useState<string>('');
  const [keyboardOffset, setKeyboardOffset] = useState<number>(0);
  const playerCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editNameInputRef = useRef<HTMLInputElement | null>(null);
  const editRankInputRef = useRef<HTMLInputElement | null>(null);
  const maxViewportHeightRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  const editStartInfoRef = useRef<{
    playerId: string;
    initialScrollY: number;
    initialVisualTop: number;
    initialVisualBottom: number;
    startedAt: number;
  } | null>(null);

  const getPageScrollY = () => {
    if (typeof window === 'undefined') return 0;
    return (
      window.scrollY ||
      window.pageYOffset ||
      document.scrollingElement?.scrollTop ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      (document.fullscreenElement as HTMLElement)?.scrollTop ||
      0
    );
  };

  const applyScrollDelta = (deltaY: number) => {
    if (Math.abs(deltaY) <= 3) return;
    const currentScrollY = getPageScrollY();
    const targetScrollY = Math.max(0, currentScrollY + deltaY);

    window.scrollTo({ top: targetScrollY, behavior: 'auto' });
    if (document.documentElement) document.documentElement.scrollTop = targetScrollY;
    if (document.body) document.body.scrollTop = targetScrollY;
    if (document.scrollingElement) document.scrollingElement.scrollTop = targetScrollY;
    if (document.fullscreenElement) {
      (document.fullscreenElement as HTMLElement).scrollTop = targetScrollY;
    }
  };

  const recordEditStartPosition = (playerId: string) => {
    const cardEl = playerCardRefs.current[playerId];
    const vv = window.visualViewport;
    const vvOffsetTop = vv ? vv.offsetTop : 0;
    const rect = cardEl?.getBoundingClientRect();
    editStartInfoRef.current = {
      playerId,
      initialScrollY: getPageScrollY(),
      initialVisualTop: rect ? rect.top - vvOffsetTop : 0,
      initialVisualBottom: rect ? rect.bottom - vvOffsetTop : 0,
      startedAt: Date.now(),
    };
  };

  // 모바일/태블릿 및 풀스크린 화면에서 키보드가 열릴 때 수정 박스가 키보드 바로 위쪽까지만 최소 거리로 이동하도록 정밀 보정
  const scrollCardAboveKeyboard = useCallback((playerId: string) => {
    const cardEl = playerCardRefs.current[playerId];
    if (!cardEl) return;

    const vv = window.visualViewport;
    const vvOffsetTop = vv ? vv.offsetTop : 0;
    const visibleHeight = vv ? vv.height : window.innerHeight;

    const isTouchDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

    const isFullscreen =
      typeof document !== 'undefined' &&
      Boolean(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
      );

    // 1) 뷰포트 높이 감소량 측정 (브라우저가 visualViewport를 줄이는 경우)
    const measuredHeightDrop = Math.max(
      0,
      window.innerHeight - visibleHeight,
      maxViewportHeightRef.current - visibleHeight
    );

    // 2) 가상 키보드 높이 판별:
    // 측정된 높이 감소량이 80px 초과이면 브라우저가 측정한 정확한 키보드 높이 사용
    // 풀스크린(fullscreen) 모드이거나 모바일 브라우저에서 뷰포트 크기를 줄이지 않고 오버레이하는 경우, 화면의 약 40~44%를 가상 키보드 높이로 계산
    let keyboardHeight = measuredHeightDrop;
    let isKeyboardOpen = measuredHeightDrop > 80;

    if (!isKeyboardOpen && (isTouchDevice || isFullscreen)) {
      keyboardHeight = Math.min(420, Math.max(280, Math.round(visibleHeight * 0.42)));
      isKeyboardOpen = true;
    }

    // 상단 고정 헤더 하단 위치 측정 (헤더 밑으로 안전 마진)
    const headerEl = document.querySelector('header');
    const headerRectBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 60;
    const topLimit = Math.max(64, Math.min(headerRectBottom - vvOffsetTop + 8, 96));

    // 키보드 상단 위치
    const keyboardTop = visibleHeight - (isKeyboardOpen ? keyboardHeight : 0);

    // 하단 고정 네비게이션 바가 가시 영역 내에 떠 있는지 확인하여 여백 확보
    const bottomNavEl = document.querySelector('nav.fixed.bottom-0');
    let bottomNavReserved = 0;
    if (bottomNavEl) {
      const navRect = bottomNavEl.getBoundingClientRect();
      const navTop = navRect.top - vvOffsetTop;
      if (navTop < keyboardTop && navTop > topLimit) {
        bottomNavReserved = Math.max(0, keyboardTop - navTop);
      } else if (!isKeyboardOpen) {
        bottomNavReserved = navRect.height || 68;
      }
    }

    // 실제 화면에서 안전하게 볼 수 있는 하단 경계선
    const bottomLimit = Math.max(topLimit + 70, keyboardTop - bottomNavReserved);
    const targetVisualBottom = bottomLimit - 12; // 키보드 바로 위 12px 마진

    const rect = cardEl.getBoundingClientRect();
    const visualTop = rect.top - vvOffsetTop;
    const visualBottom = rect.bottom - vvOffsetTop;

    // 1. 수정 박스 하단이 키보드(또는 하단 바)에 가려져 있는 경우
    // -> 키보드 바로 위(targetVisualBottom)까지만 필요한 최소 거리만큼 이동
    if (visualBottom > targetVisualBottom) {
      let deltaY = visualBottom - targetVisualBottom;
      if (visualTop - deltaY < topLimit) {
        deltaY = visualTop - (topLimit + 6);
      }
      applyScrollDelta(deltaY);
      return;
    }

    // 2. 브라우저 기본 포커스 스크롤 등으로 인해 화면 상단 헤더 위로 너무 올라간 경우
    // -> 상단 헤더 바로 아래(topLimit + 8)로 복귀
    if (visualTop < topLimit) {
      const deltaY = visualTop - (topLimit + 8);
      applyScrollDelta(deltaY);
    }
  }, []);

  const handleStartEditName = (player: Player) => {
    recordEditStartPosition(player.id);
    setEditingPlayerId(player.id);
    setEditingName(player.name);
    setEditingConeNumber(
      player.coneNumber !== undefined && player.coneNumber !== null
        ? String(player.coneNumber)
        : ''
    );
  };

  const handleSavePlayerName = (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingPlayerId(null);
      return;
    }
    soundEffects.playRacketHit();

    const targetPlayer = players.find((p) => p.id === id);
    if (!targetPlayer) {
      setEditingPlayerId(null);
      return;
    }

    const trimmedCone = editingConeNumber.trim();
    const finalCone = trimmedCone ? trimmedCone : undefined;

    let updatedPlayer: Player = { ...targetPlayer, name: trimmed, coneNumber: finalCone };

    const isInActiveOrQueuedMatch =
      activeMatches.some(
        (m) =>
          m.teamA.player1Id === id ||
          m.teamA.player2Id === id ||
          m.teamB.player1Id === id ||
          m.teamB.player2Id === id
      ) ||
      queuedMatches.some(
        (m) =>
          m.teamA.player1Id === id ||
          m.teamA.player2Id === id ||
          m.teamB.player1Id === id ||
          m.teamB.player2Id === id
      );

    if (!isTestPlayer(targetPlayer) && (targetPlayer.gamesPlayed ?? 0) === 0) {
      const matchingArchived = findMatchingArchivedPlayer(
        trimmed,
        targetPlayer.tier,
        archivedPlayers,
        players.filter((x) => x.id !== id),
        targetPlayer.gender
      );
      if (matchingArchived && (matchingArchived.gamesPlayed ?? 0) > 0) {
        setRestoredNotice(
          `'${trimmed}' (${TIER_LABELS[targetPlayer.tier]?.short || targetPlayer.tier}) 선수의 이전 배정/진행 기록(${matchingArchived.gamesPlayed}경기)이 정상 적용되었습니다.`
        );
        setTimeout(() => setRestoredNotice(null), 4500);
        const nextId = isInActiveOrQueuedMatch ? targetPlayer.id : matchingArchived.id;
        updatedPlayer = {
          ...matchingArchived,
          // 코트 현황이나 대기열에 이미 배정된 선수인 경우 기존 ID를 유지하여 모든 메뉴에서 끊김 없이 연동
          id: nextId,
          name: trimmed,
          gender: targetPlayer.gender,
          tier: targetPlayer.tier,
          coneNumber: finalCone,
          isActive: targetPlayer.isActive,
          isTest: targetPlayer.isTest,
          masterMemberId: targetPlayer.masterMemberId,
          partnerId: targetPlayer.partnerId ?? matchingArchived.partnerId,
        };
      }
    }

    const updatedPlayers = players.map((p) => {
      if (p.id === id) return updatedPlayer;
      if (p.partnerId === id && updatedPlayer.id !== id) {
        return { ...p, partnerId: updatedPlayer.id };
      }
      return p;
    });
    onUpdatePlayers(updatedPlayers);
    if (onArchivePlayer) {
      onArchivePlayer(updatedPlayer);
    }

    // 전체 회원 관리(masterMembers)에 등록된 해당 선수의 이름도 즉시 1:1 동기화 (꼬깔 번호는 당일 참가자 전용이므로 제외, 테스트 선수는 제외)
    if (!isTestPlayer(targetPlayer)) {
      let oldMemberForSync: MasterMember | undefined;
      let newMemberForSync: MasterMember | undefined;
      const updatedMasterList = masterMembers.map((m) => {
        const isTarget =
          (targetPlayer.masterMemberId && m.id === targetPlayer.masterMemberId) ||
          (!targetPlayer.masterMemberId &&
            m.name.trim().toLowerCase() === targetPlayer.name.trim().toLowerCase() &&
            m.gender === targetPlayer.gender &&
            m.tier === targetPlayer.tier);
        if (isTarget) {
          oldMemberForSync = m;
          newMemberForSync = { ...m, name: trimmed };
          return newMemberForSync;
        }
        return m;
      });
      handleUpdateMasterMembers(updatedMasterList);
      if (onSyncMemberEdit && oldMemberForSync && newMemberForSync) {
        onSyncMemberEdit(oldMemberForSync, newMemberForSync);
      }
    }

    setEditingPlayerId(null);
  };

  // Drag and drop reordering (PC 마우스 드래그 + 모바일 드래그 핸들 및 길게터치 드래그 순서 변경 지원)
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [dragOverPlayerId, setDragOverPlayerId] = useState<string | null>(null);
  const [dragHandleActivePlayerId, setDragHandleActivePlayerId] = useState<string | null>(null);

  const playersRef = useRef(players);
  playersRef.current = players;
  const activeMatchesRef = useRef(activeMatches);
  activeMatchesRef.current = activeMatches;
  const queuedMatchesRef = useRef(queuedMatches);
  queuedMatchesRef.current = queuedMatches;
  const onUpdatePlayersRef = useRef(onUpdatePlayers);
  onUpdatePlayersRef.current = onUpdatePlayers;

  const touchPendingIdRef = useRef<string | null>(null);
  const touchFromHandleRef = useRef<boolean>(false);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchLongPressTimerRef = useRef<number | null>(null);
  const touchDragActiveIdRef = useRef<string | null>(null);
  const touchDragOverIdRef = useRef<string | null>(null);
  const lastLiveSwapTimeRef = useRef<number>(0);
  const didTouchReorderRef = useRef<boolean>(false);
  const suppressClickAfterDragRef = useRef<boolean>(false);

  const findPlayerCardIdAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const directCard = el?.closest('[data-player-card-id]') as HTMLElement | null;
    if (directCard) {
      const id = directCard.getAttribute('data-player-card-id');
      if (id) return id;
    }
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [id, cardEl] of Object.entries(playerCardRefs.current)) {
      if (!cardEl) continue;
      const rect = cardEl.getBoundingClientRect();
      if (
        clientX >= rect.left - 12 &&
        clientX <= rect.right + 12 &&
        clientY >= rect.top - 12 &&
        clientY <= rect.bottom + 12
      ) {
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const d = Math.hypot(clientX - cx, clientY - cy);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
    }
    return bestId;
  }, []);

  const executePlayerReorder = useCallback((sourceId: string, targetId: string): boolean => {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const currentList = playersRef.current;
    const sourceIndex = currentList.findIndex((p) => p.id === sourceId);
    const targetIndex = currentList.findIndex((p) => p.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;

    const updated = [...currentList];
    const [movedPlayer] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, movedPlayer);
    const reconciled = reconcileManualPlayerIntervention(
      updated,
      [sourceId],
      activeMatchesRef.current,
      queuedMatchesRef.current
    );
    playersRef.current = reconciled;
    onUpdatePlayersRef.current(reconciled);
    return true;
  }, []);

  const activateTouchOrLongPressDrag = useCallback((playerId: string) => {
    if (touchLongPressTimerRef.current) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
    touchPendingIdRef.current = null;
    touchDragActiveIdRef.current = playerId;
    touchDragOverIdRef.current = playerId;
    didTouchReorderRef.current = false;
    suppressClickAfterDragRef.current = true;
    document.body.dataset.cardReorderDragging = 'true';
    setDragHandleActivePlayerId(playerId);
    setDraggedPlayerId(playerId);
    setDragOverPlayerId(playerId);
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
    soundEffects.playRacketHit();
  }, []);

  const handleCardTouchStart = (
    e: React.TouchEvent<HTMLDivElement>,
    playerId: string,
    fromHandle: boolean
  ) => {
    if (editingPlayerId || editingRankId || searchQuery) return;
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (!fromHandle && target.closest('input, select')) return;

    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (touchLongPressTimerRef.current) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }

    if (fromHandle) {
      activateTouchOrLongPressDrag(playerId);
      return;
    }

    touchPendingIdRef.current = playerId;
    touchFromHandleRef.current = false;
    touchLongPressTimerRef.current = window.setTimeout(() => {
      if (touchPendingIdRef.current === playerId) {
        activateTouchOrLongPressDrag(playerId);
      }
    }, 220);
  };

  const handleCardMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    playerId: string,
    fromHandle: boolean
  ) => {
    if (e.button !== 0 || editingPlayerId || editingRankId || searchQuery) return;
    const target = e.target as HTMLElement;
    if (!fromHandle && target.closest('input, select')) return;

    if (fromHandle) {
      setDragHandleActivePlayerId(playerId);
    }
    touchPendingIdRef.current = playerId;
    touchFromHandleRef.current = fromHandle;
    touchStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (touchLongPressTimerRef.current) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
    if (!fromHandle) {
      touchLongPressTimerRef.current = window.setTimeout(() => {
        if (touchPendingIdRef.current === playerId) {
          activateTouchOrLongPressDrag(playerId);
        }
      }, 220);
    }
  };

  useEffect(() => {
    const handlePointerMoveCoord = (clientX: number, clientY: number, preventDefaultFn?: () => void) => {
      if (touchDragActiveIdRef.current) {
        if (preventDefaultFn) preventDefaultFn();

        if (clientY < 85) {
          window.scrollBy(0, -10);
        } else if (clientY > window.innerHeight - 85) {
          window.scrollBy(0, 10);
        }

        const activeId = touchDragActiveIdRef.current;
        const targetId = findPlayerCardIdAtPoint(clientX, clientY);
        if (targetId) {
          if (targetId !== activeId && Date.now() - lastLiveSwapTimeRef.current > 110) {
            if (executePlayerReorder(activeId, targetId)) {
              lastLiveSwapTimeRef.current = Date.now();
              didTouchReorderRef.current = true;
              touchDragOverIdRef.current = activeId;
              setDragOverPlayerId(activeId);
            } else {
              touchDragOverIdRef.current = targetId;
              setDragOverPlayerId(targetId);
            }
          } else if (targetId === activeId) {
            touchDragOverIdRef.current = activeId;
            setDragOverPlayerId(activeId);
          }
        }
        return;
      }

      if (touchPendingIdRef.current) {
        const dist = Math.hypot(
          clientX - touchStartPosRef.current.x,
          clientY - touchStartPosRef.current.y
        );
        if (touchFromHandleRef.current && dist > 3) {
          if (preventDefaultFn) preventDefaultFn();
          activateTouchOrLongPressDrag(touchPendingIdRef.current);
        } else if (!touchFromHandleRef.current && dist > 16) {
          if (touchLongPressTimerRef.current) {
            window.clearTimeout(touchLongPressTimerRef.current);
            touchLongPressTimerRef.current = null;
          }
          touchPendingIdRef.current = null;
        }
      }
    };

    const finishTouchOrPointerDrag = () => {
      if (touchLongPressTimerRef.current) {
        window.clearTimeout(touchLongPressTimerRef.current);
        touchLongPressTimerRef.current = null;
      }
      touchPendingIdRef.current = null;

      if (touchDragActiveIdRef.current) {
        const srcId = touchDragActiveIdRef.current;
        const tgtId = touchDragOverIdRef.current;
        if (!didTouchReorderRef.current && srcId && tgtId && srcId !== tgtId) {
          if (executePlayerReorder(srcId, tgtId)) {
            didTouchReorderRef.current = true;
          }
        }
        if (didTouchReorderRef.current) {
          soundEffects.playRacketHit();
        }
        touchDragActiveIdRef.current = null;
        touchDragOverIdRef.current = null;
        delete document.body.dataset.cardReorderDragging;
        setDraggedPlayerId(null);
        setDragOverPlayerId(null);
        setDragHandleActivePlayerId(null);
        window.setTimeout(() => {
          suppressClickAfterDragRef.current = false;
        }, 320);
      }
    };

    const onWindowTouchMove = (e: TouchEvent) => {
      if (!touchDragActiveIdRef.current && !touchPendingIdRef.current) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handlePointerMoveCoord(touch.clientX, touch.clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!touchDragActiveIdRef.current && !touchPendingIdRef.current) return;
      handlePointerMoveCoord(e.clientX, e.clientY, () => {
        e.preventDefault();
      });
    };

    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', finishTouchOrPointerDrag);
    window.addEventListener('touchcancel', finishTouchOrPointerDrag);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', finishTouchOrPointerDrag);

    return () => {
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', finishTouchOrPointerDrag);
      window.removeEventListener('touchcancel', finishTouchOrPointerDrag);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', finishTouchOrPointerDrag);
    };
  }, [activateTouchOrLongPressDrag, executePlayerReorder, findPlayerCardIdAtPoint]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, playerId: string) => {
    if (touchDragActiveIdRef.current) {
      e.preventDefault();
      return;
    }
    if (dragHandleActivePlayerId !== playerId) {
      e.preventDefault();
      return;
    }
    if (touchLongPressTimerRef.current) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
    touchPendingIdRef.current = null;
    e.dataTransfer.setData('text/plain', playerId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedPlayerId(playerId);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, playerId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPlayerId !== playerId) {
      setDragOverPlayerId(playerId);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetPlayerId: string) => {
    e.preventDefault();
    const sourcePlayerId = draggedPlayerId || e.dataTransfer.getData('text/plain');
    if (!sourcePlayerId || sourcePlayerId === targetPlayerId) {
      setDraggedPlayerId(null);
      setDragOverPlayerId(null);
      return;
    }

    if (executePlayerReorder(sourcePlayerId, targetPlayerId)) {
      soundEffects.playRacketHit();
    }

    setDraggedPlayerId(null);
    setDragOverPlayerId(null);
    setDragHandleActivePlayerId(null);
  };

  const handleDragEnd = () => {
    setDraggedPlayerId(null);
    setDragOverPlayerId(null);
    setDragHandleActivePlayerId(null);
  };

  // Rank / Order Number Direct Editing (순서번호 직접 변경으로 이동)
  const [editingRankId, setEditingRankId] = useState<string | null>(null);
  const [tempRankValue, setTempRankValue] = useState<string>('');

  const handleStartEditRank = (playerId: string, currentRank: number) => {
    recordEditStartPosition(playerId);
    setEditingRankId(playerId);
    setTempRankValue(String(currentRank));
  };

  const handleCommitRankChange = (playerId: string) => {
    const targetRank = parseInt(tempRankValue, 10);
    setEditingRankId(null);
    if (isNaN(targetRank)) return;

    const sourceIndex = players.findIndex((p) => p.id === playerId);
    if (sourceIndex === -1) return;

    const attendedCount = players.filter((p) => !p.attendancePending).length;
    const maxIndex = Math.max(0, (attendedCount > 0 ? attendedCount : players.length) - 1);
    const targetIndex = Math.max(0, Math.min(maxIndex, targetRank - 1));
    if (sourceIndex === targetIndex) return;

    const updated = [...players];
    const [movedPlayer] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, movedPlayer);
    onUpdatePlayers(
      reconcileManualPlayerIntervention(updated, [playerId], activeMatches, queuedMatches)
    );
    soundEffects.playRacketHit();
  };

  // Reset to Sample Members
  const handleResetSample = () => {
    if (confirm('참가자 명단을 기본 샘플 16명으로 초기화하시겠습니까?')) {
      onUpdatePlayers(INITIAL_SAMPLE_PLAYERS);
    }
  };

  // Clear All
  const handleClearAll = () => {
    if (confirm('모든 참가자 명단을 삭제하시겠습니까?')) {
      onUpdatePlayers([]);
    }
  };

  // 출석 버튼 클릭 처리:
  // 1) 이름 빗금 해제 및 참가 순서를 클릭한 순서(오름차순)대로 등록
  // 2) 첫 게임 배정 후 20분 이상 경과 시 지각 보정 적용
  // 3) 꼬깔확인 체크박스가 체크되어 있으면 '꼬깔 번호를 입력해 주세요' 모달 표시
  const handleConfirmAttendance = (playerId: string) => {
    const currentList = playersRef.current;
    const targetPlayer = currentList.find((p) => p.id === playerId);
    if (!targetPlayer || !targetPlayer.attendancePending) return;

    soundEffects.playRacketHit();

    const attendedSoFar = currentList.filter(
      (p) => p.id !== playerId && !p.attendancePending
    );
    const remainingPending = currentList.filter(
      (p) => p.id !== playerId && p.attendancePending
    );

    const maxAttendedRegTime = attendedSoFar.reduce(
      (maxT, p) => Math.max(maxT, p.registeredAt ?? p.createdAt ?? 0),
      0
    );
    const now = Math.max(Date.now(), maxAttendedRegTime + 1);

    const firstFourStartedAt = getFirstFourAssignmentStartTime(
      attendedSoFar,
      activeMatches,
      queuedMatches
    );
    const isBeforeLateOffsetStart =
      firstFourStartedAt === null ||
      now - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS;
    const lateOffset = computeLateArrivalOffset(
      attendedSoFar,
      activeMatches,
      queuedMatches,
      targetPlayer.gender,
      now
    );

    const hasPriorGames = (targetPlayer.gamesPlayed || 0) > 0;
    const wasBeforeFirstAssign = hasPriorGames
      ? (targetPlayer.registeredBeforeFirstAssign ?? false)
      : isBeforeLateOffsetStart;

    const attendedPlayer: Player = {
      ...targetPlayer,
      attendancePending: false,
      registeredAt: hasPriorGames
        ? targetPlayer.registeredAt ?? targetPlayer.createdAt ?? now
        : now,
      registeredBeforeFirstAssign: wasBeforeFirstAssign,
      firstFourAssignedAt: firstFourStartedAt ?? undefined,
      initialAssignedOffset: hasPriorGames
        ? targetPlayer.initialAssignedOffset ?? 0
        : wasBeforeFirstAssign
          ? 0
          : Math.max(targetPlayer.initialAssignedOffset ?? 0, lateOffset),
    };

    const orderedPlayers = [...attendedSoFar, attendedPlayer, ...remainingPending];
    const nextPlayers = recalculateRelativeLateOffsets(
      orderedPlayers,
      activeMatches,
      queuedMatches
    );
    playersRef.current = nextPlayers;
    onUpdatePlayers(nextPlayers);

    if (isConePromptEnabled) {
      setPendingAttendanceConePlayer({
        id: attendedPlayer.id,
        name: attendedPlayer.name,
        gender: attendedPlayer.gender,
        tier: attendedPlayer.tier,
        coneNumber: attendedPlayer.coneNumber,
      });
    }
  };

  const handleConfirmAttendanceConePrompt = (coneNumberInput: string) => {
    if (!pendingAttendanceConePlayer) return;
    const trimmedCone = coneNumberInput.trim();
    const targetId = pendingAttendanceConePlayer.id;
    const finalCone =
      trimmedCone !== ''
        ? trimmedCone
        : pendingAttendanceConePlayer.coneNumber !== undefined &&
          String(pendingAttendanceConePlayer.coneNumber).trim() !== ''
        ? String(pendingAttendanceConePlayer.coneNumber).trim()
        : undefined;

    const updatedPlayers = playersRef.current.map((p) =>
      p.id === targetId ? { ...p, coneNumber: finalCone } : p
    );
    playersRef.current = updatedPlayers;
    onUpdatePlayers(updatedPlayers);

    const updatedTarget = updatedPlayers.find((p) => p.id === targetId);
    if (updatedTarget && onArchivePlayer) {
      onArchivePlayer(updatedTarget);
    }

    setPendingAttendanceConePlayer(null);
  };

  const handleSkipAttendanceConePrompt = () => {
    setPendingAttendanceConePlayer(null);
  };

  // Toggle shuttlecock submission (콕제출 완료/미완료)
  const handleToggleShuttlecock = (id: string) => {
    onUpdatePlayers(
      players.map((p) =>
        p.id === id
          ? { ...p, shuttlecockSubmitted: !p.shuttlecockSubmitted }
          : p
      )
    );
  };

  const attendedRankMap = React.useMemo(() => {
    const map = new Map<string, number>();
    let orderNum = 1;
    players.forEach((p) => {
      if (!p.attendancePending) {
        map.set(p.id, orderNum++);
      }
    });
    return map;
  }, [players]);

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const maleCount = players.filter((p) => p.gender === 'M').length;
  const femaleCount = players.filter((p) => p.gender === 'F').length;
  const submittedShuttleCount = players.filter((p) => p.shuttlecockSubmitted).length;

  const activeEditTargetId = editingPlayerId || editingRankId;

  // 비편집 상태에서 최대 뷰포트 높이 기록 (풀스크린 모드에서 키보드 오픈 시 높이 감소량 측정용)
  useEffect(() => {
    const updateMaxViewport = () => {
      if (!editingPlayerId && !editingRankId) {
        const vvH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        maxViewportHeightRef.current = Math.max(window.innerHeight, vvH);
      }
    };
    updateMaxViewport();
    window.addEventListener('resize', updateMaxViewport);
    document.addEventListener('fullscreenchange', updateMaxViewport);
    return () => {
      window.removeEventListener('resize', updateMaxViewport);
      document.removeEventListener('fullscreenchange', updateMaxViewport);
    };
  }, [editingPlayerId, editingRankId]);

  // 모바일/태블릿/풀스크린 키보드 열림 감지 및 수정 중인 선수 박스 최소 이동 보정 + 외부 터치 시 닫기
  useEffect(() => {
    if (!activeEditTargetId) {
      setKeyboardOffset(0);
      return;
    }

    // 브라우저 기본 autoFocus 스크롤 점프를 방지하기 위해 preventScroll 옵션으로 포커스 부여
    const focusInputWithoutJump = () => {
      const targetInput = editingPlayerId
        ? editNameInputRef.current
        : editRankInputRef.current;
      if (targetInput && document.activeElement !== targetInput) {
        try {
          targetInput.focus({ preventScroll: true });
        } catch {
          targetInput.focus();
        }
      }
    };

    focusInputWithoutJump();

    const updateViewportAndScroll = () => {
      const vvH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const isTouch =
        window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isFull = Boolean(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
      );
      const measuredDrop = Math.max(
        0,
        window.innerHeight - vvH,
        maxViewportHeightRef.current - vvH
      );
      const effectiveOffset = measuredDrop > 80 ? measuredDrop : isTouch || isFull ? 340 : 0;
      setKeyboardOffset(effectiveOffset);
      scrollCardAboveKeyboard(activeEditTargetId);
    };

    const handleViewportScroll = () => {
      const startInfo = editStartInfoRef.current;
      if (startInfo && Date.now() - startInfo.startedAt < 650) {
        scrollCardAboveKeyboard(activeEditTargetId);
      }
    };

    const rafId = requestAnimationFrame(updateViewportAndScroll);
    const t1 = window.setTimeout(updateViewportAndScroll, 60);
    const t2 = window.setTimeout(updateViewportAndScroll, 160);
    const t3 = window.setTimeout(updateViewportAndScroll, 280);
    const t4 = window.setTimeout(updateViewportAndScroll, 450);
    const t5 = window.setTimeout(updateViewportAndScroll, 700);

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', updateViewportAndScroll);
      vv.addEventListener('scroll', handleViewportScroll);
    }
    window.addEventListener('resize', updateViewportAndScroll);

    const handlePointerDownOutside = (e: PointerEvent) => {
      const cardEl = playerCardRefs.current[activeEditTargetId];
      if (cardEl && !cardEl.contains(e.target as Node)) {
        if (editingPlayerId) {
          handleSavePlayerName(editingPlayerId);
        } else if (editingRankId) {
          handleCommitRankChange(editingRankId);
        }
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      if (vv) {
        vv.removeEventListener('resize', updateViewportAndScroll);
        vv.removeEventListener('scroll', handleViewportScroll);
      }
      window.removeEventListener('resize', updateViewportAndScroll);
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [activeEditTargetId, editingPlayerId, scrollCardAboveKeyboard]);

  return (
    <div
      className="space-y-6"
      style={{
        paddingBottom: activeEditTargetId
          ? `${Math.max(450, keyboardOffset + 140)}px`
          : undefined,
      }}
    >
      {/* Top Action & Stat Row */}
      <div className="space-y-3">
        <div className="flex items-center flex-wrap gap-2">
          <h1 className="text-lg font-bold text-white flex flex-wrap items-center gap-2 shrink-0">
            <Users className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>참가자 명단</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {players.length}명
            </span>
            <span className="text-xs flex items-center gap-1.5 font-normal">
              <span className="text-blue-400 font-semibold">남 {maleCount}명</span>
              <span className="text-slate-500">/</span>
              <span className="text-pink-400 font-semibold">여 {femaleCount}명</span>
            </span>
          </h1>
        </div>

        {/* Second Row: 일괄 등록 & 전체 회원 버튼 */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              soundEffects.playRacketHit();
              newPlayerNameInputRef.current?.blur();
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              setShowBulkRegisterModal(true);
            }}
            className="flex-1 min-w-[120px] px-3 py-2 text-xs sm:text-sm font-bold rounded-xl bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 hover:text-white border border-emerald-500/40 hover:border-emerald-400/80 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-emerald-500/20 active:scale-98 whitespace-nowrap min-h-[38px]"
            title="참가자 명단 일괄 등록 (전체 회원 실시간 동기화)"
          >
            <ListPlus className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>일괄 등록</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEffects.playRacketHit();
              setShowMasterMemberModal(true);
            }}
            className="flex-1 min-w-[140px] px-3 py-2 text-xs sm:text-sm font-bold rounded-xl bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 hover:text-white border border-purple-500/40 hover:border-purple-400/80 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-purple-500/20 active:scale-98 whitespace-nowrap min-h-[38px]"
            title="클럽 전체 회원 명부 관리 (기기 내부 로컬 저장소 영구 보존)"
          >
            <Users className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>전체 회원</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-purple-500/30 text-purple-200 font-bold border border-purple-400/30">
              {masterMembers.length}
            </span>
          </button>
        </div>
      </div>

      {/* Restored Player Record Notice */}
      {restoredNotice && (
        <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl flex items-center justify-between gap-2 text-xs text-emerald-300 animate-fadeIn shadow-sm">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{restoredNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRestoredNotice(null)}
            className="p-1 hover:text-white text-emerald-400 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Add Single Player Bar */}
      <div className="flex flex-col gap-2">
        <form
          onSubmit={handleAddPlayer}
          className={`p-4 bg-slate-900/60 rounded-2xl border transition-all flex flex-col md:flex-row items-stretch md:items-center gap-3 ${
            formNotice ? 'border-amber-500/60 shadow-sm shadow-amber-500/10' : 'border-slate-800'
          }`}
        >
          <div className="flex-1">
            <input
              ref={newPlayerNameInputRef}
              type="text"
              placeholder="참가자 이름"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (formNotice) setFormNotice(null);
              }}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Gender Toggle: 아무것도 선택되지 않은 초기 상태(null) 지원 */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-700 shrink-0">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setGender(gender === 'M' ? null : 'M');
                if (formNotice) setFormNotice(null);
              }}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                gender === 'M'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              남성
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setGender(gender === 'F' ? null : 'F');
                if (formNotice) setFormNotice(null);
              }}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                gender === 'F'
                  ? 'bg-pink-500/20 text-pink-400 border border-pink-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              여성
            </button>
          </div>

          {/* Tier Selector: 아무것도 선택되지 않은 초기 상태(null) 지원 */}
          <div className="flex items-center gap-1 shrink-0 overflow-x-auto py-0.5">
            {(['S', 'A', 'B', 'C', 'D', 'Beginner'] as Tier[]).map((t) => {
              const isSelected = tier === t;
              const meta = TIER_LABELS[t];
              return (
                <button
                  key={t}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTier(tier === t ? null : t);
                    if (formNotice) setFormNotice(null);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    isSelected
                      ? `${meta.bg} ${meta.color} ring-2 ring-emerald-400 shadow-sm`
                      : 'border-slate-800 text-slate-500 bg-slate-950 hover:text-slate-300'
                  }`}
                >
                  {meta.short}
                </button>
              );
            })}
          </div>

          {/* Add Submit Button */}
          <button
            type="submit"
            onMouseDown={(e) => e.preventDefault()}
            className="px-4 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>선수 추가</span>
          </button>

          {/* Partner Button (파트너 버튼) */}
          <button
            type="button"
            onClick={() => {
              soundEffects.playScorePoint();
              setShowPartnerModal(true);
            }}
            className="px-4 py-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 text-purple-200 border border-purple-500/40 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-sm shadow-purple-500/15 active:scale-95"
            title="두 선수를 파트너로 설정 (더 높은 확률로 같은 코트에 배정)"
          >
            <CrossedRacketsIcon className="w-3.5 h-3.5 text-pink-400" />
            <span>파트너</span>
            {getUniquePartnerPairs(players).length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-purple-500/30 text-purple-200 text-[10px] font-mono font-bold">
                {getUniquePartnerPairs(players).length}쌍
              </span>
            )}
          </button>
        </form>

        {/* Inline Warning Notice */}
        {formNotice && (
          <div className="px-3.5 py-2 bg-amber-500/15 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-center justify-between gap-2 animate-fadeIn shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-medium">{formNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setFormNotice(null)}
              className="p-1 hover:text-white text-amber-400 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Shuttlecock Submission & Cone Check Controls (참가자 등록 배너 아래쪽) */}
        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2 px-1">
          <span className="text-amber-400 font-semibold flex items-center gap-1">
            <span>🏸 콕제출</span>
            <span className="font-mono tabular-nums">{submittedShuttleCount}/{players.length}명</span>
            {submittedShuttleCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onUpdatePlayers(players.map((p) => ({ ...p, shuttlecockSubmitted: false })));
                }}
                className="ml-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer transition-all shadow-sm active:scale-95"
                title="모든 선수의 콕제출 상태 초기화"
              >
                초기화
              </button>
            )}
          </span>
          <span>·</span>
          <label
            className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold cursor-pointer select-none px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-400/50 transition-colors"
            title="체크 시 새 참가자 등록 시 꼬깔 번호 입력 메뉴가 표시되며, 체크 해제 시 바로 등록됩니다"
          >
            <input
              type="checkbox"
              checked={isConePromptEnabled}
              onChange={(e) => handleToggleConePrompt(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-600 text-amber-400 focus:ring-amber-400 focus:ring-offset-slate-900 accent-amber-400 cursor-pointer"
            />
            <span className={isConePromptEnabled ? 'text-amber-300 font-bold' : 'text-slate-400 font-medium'}>
              꼬깔확인
            </span>
          </label>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="이름으로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Player Card Grid */}
      {filteredPlayers.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30">
          <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-400">
            등록된 참가자가 없습니다
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {filteredPlayers.map((player, idx) => {
            const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;
            const isDragging = draggedPlayerId === player.id;
            const isDragOver = dragOverPlayerId === player.id;
            const canDrag = !editingPlayerId && !searchQuery;

            const isEditingCard = editingPlayerId === player.id || editingRankId === player.id;

            return (
              <div
                key={player.id}
                data-player-card-id={player.id}
                ref={(el) => {
                  playerCardRefs.current[player.id] = el;
                }}
                draggable={canDrag && dragHandleActivePlayerId === player.id && !touchDragActiveIdRef.current}
                onDragStart={(e) => handleDragStart(e, player.id)}
                onDragOver={(e) => handleDragOver(e, player.id)}
                onDrop={(e) => handleDrop(e, player.id)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => handleCardTouchStart(e, player.id, false)}
                onMouseDown={(e) => handleCardMouseDown(e, player.id, false)}
                onContextMenu={(e) => {
                  if (canDrag) {
                    e.preventDefault();
                  }
                }}
                onClickCapture={(e) => {
                  if (suppressClickAfterDragRef.current) {
                    e.stopPropagation();
                    e.preventDefault();
                  }
                }}
                className={`px-3 sm:px-3.5 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 min-h-[46px] select-none touch-manipulation ${
                  isEditingCard
                    ? 'border-emerald-400 ring-2 ring-emerald-500/50 bg-slate-900 shadow-xl shadow-emerald-950/60 relative z-30'
                    : isDragging
                    ? 'border-emerald-400 ring-2 ring-emerald-400 bg-emerald-950/60 shadow-xl scale-[1.02] z-20'
                    : isDragOver
                    ? 'border-emerald-400 ring-2 ring-emerald-400 bg-slate-900 shadow-lg scale-[1.01]'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
                style={{
                  WebkitTouchCallout: 'none',
                  userSelect: 'none',
                  ...(isEditingCard
                    ? {
                        scrollMarginBottom: `${keyboardOffset > 0 ? keyboardOffset + 20 : 340}px`,
                      }
                    : {}),
                }}
              >
                {/* Left: Drag Handle + Index & Name (수정 가능) */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {canDrag && (
                    <div
                      title="길게 터치하거나 드래그하여 선수 순서 변경"
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        handleCardTouchStart(e, player.id, true);
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleCardMouseDown(e, player.id, true);
                      }}
                      onMouseUp={() => setDragHandleActivePlayerId(null)}
                      style={{ touchAction: 'none', WebkitTouchCallout: 'none', userSelect: 'none' }}
                      className="cursor-grab active:cursor-grabbing p-1.5 -ml-1.5 text-slate-500 hover:text-emerald-400 active:text-emerald-300 transition-colors shrink-0"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  )}
                  {player.attendancePending ? (
                    <span
                      title="출석 전 (출석 버튼 클릭 시 참가 순서 부여)"
                      className="w-7 h-6 flex items-center justify-center text-xs font-mono font-bold text-slate-600 select-none shrink-0"
                    >
                      -
                    </span>
                  ) : editingRankId === player.id ? (
                    <input
                      ref={editRankInputRef}
                      type="text"
                      value={tempRankValue}
                      onChange={(e) => setTempRankValue(e.target.value.replace(/[^0-9]/g, ''))}
                      onFocus={() => {
                        if (editStartInfoRef.current) {
                          editStartInfoRef.current.startedAt = Date.now();
                        }
                        scrollCardAboveKeyboard(player.id);
                      }}
                      onBlur={() => handleCommitRankChange(player.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCommitRankChange(player.id);
                        }
                        if (e.key === 'Escape') {
                          setEditingRankId(null);
                        }
                      }}
                      className="w-9 text-center text-xs font-mono font-bold bg-slate-950 border border-emerald-400 rounded px-1 py-0.5 text-emerald-300 focus:outline-none shrink-0"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleStartEditRank(
                          player.id,
                          attendedRankMap.get(player.id) ?? idx + 1
                        )
                      }
                      title={`순서 번호 변경 (현재 ${attendedRankMap.get(player.id) ?? idx + 1}번 / 클릭하여 번호 수정 시 해당 위치로 이동)`}
                      className="w-7 h-6 flex items-center justify-center text-xs font-mono font-bold text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/40 border border-transparent rounded transition-all shrink-0 cursor-pointer"
                    >
                      {attendedRankMap.get(player.id) ?? idx + 1}
                    </button>
                  )}
                  {editingPlayerId === player.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSavePlayerName(player.id);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        ref={editNameInputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onFocus={() => {
                          if (editStartInfoRef.current) {
                            editStartInfoRef.current.startedAt = Date.now();
                          }
                          scrollCardAboveKeyboard(player.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSavePlayerName(player.id);
                          }
                          if (e.key === 'Escape') setEditingPlayerId(null);
                        }}
                        enterKeyHint="done"
                        className="text-xs sm:text-sm font-bold bg-slate-950 border border-emerald-500 px-2 py-0.5 rounded text-white focus:outline-none w-20 sm:w-24"
                        placeholder="이름"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editingConeNumber}
                        onChange={(e) => setEditingConeNumber(e.target.value)}
                        onFocus={() => {
                          if (editStartInfoRef.current) {
                            editStartInfoRef.current.startedAt = Date.now();
                          }
                          scrollCardAboveKeyboard(player.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSavePlayerName(player.id);
                          }
                          if (e.key === 'Escape') setEditingPlayerId(null);
                        }}
                        enterKeyHint="done"
                        placeholder="꼬깔"
                        title="꼬깔 번호"
                        className="text-xs sm:text-sm font-bold font-mono bg-slate-950 border border-amber-400 px-1 py-0.5 rounded text-amber-300 focus:outline-none w-11 text-center"
                      />
                    </form>
                  ) : (
                    <div className="flex items-center gap-1.5 group/name min-w-0">
                      {/* Player Name & Cone Number (더블 클릭 시 성별 변경: 남 ↔ 여, 미출석 시 이름에 빗금 표시) */}
                      <span
                        onDoubleClick={() => handleToggleGender(player.id)}
                        className={`font-bold text-sm truncate cursor-pointer select-none transition-colors ${
                          player.attendancePending
                            ? player.gender === 'M'
                              ? 'text-blue-400/90 line-through decoration-2 decoration-slate-200/40'
                              : 'text-pink-400/90 line-through decoration-2 decoration-slate-200/40'
                            : player.gender === 'M'
                            ? 'text-blue-400 hover:text-blue-300'
                            : 'text-pink-400 hover:text-pink-300'
                        }`}
                        title={
                          player.attendancePending
                            ? `${player.name} (미출석 - 우측 출석 버튼을 눌러주세요)`
                            : '더블클릭하여 성별 변경 (남 ↔ 여)'
                        }
                      >
                        {player.name}{player.coneNumber ? ` ${player.coneNumber}` : ''}
                      </span>
                      <PartnerDot player={player} allPlayers={players} size="md" />
                      {player.specialStatus && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            soundEffects.playRacketHit();
                            setStatusConfirmPlayer(player);
                          }}
                          title="클릭하여 상태 해제"
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black border shrink-0 cursor-pointer transition-all ${
                            isPlayerLastMatchCompleted(player)
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-500/80'
                              : player.specialStatus === 'resting'
                              ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/70 animate-pulse'
                              : player.specialStatus === 'lesson'
                              ? 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border-indigo-400/70 animate-pulse'
                              : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-400/70 animate-pulse'
                          }`}
                        >
                          {isPlayerLastMatchCompleted(player) ? (
                            <>
                              <DoorOpen className="w-2.5 h-2.5 text-slate-300" />
                              <span>퇴장!</span>
                            </>
                          ) : player.specialStatus === 'resting' ? (
                            <>
                              <Coffee className="w-2.5 h-2.5 text-amber-300" />
                              <span>휴식중</span>
                            </>
                          ) : player.specialStatus === 'lesson' ? (
                            <>
                              <GraduationCap className="w-2.5 h-2.5 text-indigo-300" />
                              <span>레슨중</span>
                            </>
                          ) : (
                            <>
                              <Flag className="w-2.5 h-2.5 text-rose-300" />
                              <span>막판!</span>
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEditName(player)}
                        className="opacity-60 group-hover/name:opacity-100 p-0.5 text-slate-400 hover:text-emerald-400 transition-opacity cursor-pointer shrink-0"
                        title={`${player.name} 이름 수정`}
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Right: 출석 버튼 (미출석 시 먼저 표시) -> 콕제출 버튼 -> 완료 버튼 + Tier Selector + Delete */}
                <div className="flex items-center gap-2 shrink-0">
                  {player.attendancePending ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfirmAttendance(player.id);
                      }}
                      title={`${player.name} 출석 확인 (클릭 시 오름차순 참가 순서로 등록)`}
                      className="px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-bold bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-300 border border-cyan-400/70 transition-all cursor-pointer flex items-center gap-1 shadow-sm shadow-cyan-500/20 shrink-0 active:scale-95"
                    >
                      <Check className="w-3 h-3 text-cyan-300 stroke-[2.5]" />
                      <span>출석</span>
                    </button>
                  ) : !player.shuttlecockSubmitted ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        soundEffects.playRacketHit();
                        handleToggleShuttlecock(player.id);
                      }}
                      title={`${player.name} 콕제출 확인 (클릭 시 완료로 전환)`}
                      className="px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/70 animate-pulse transition-all cursor-pointer flex items-center gap-1 shadow-sm shadow-amber-500/20 shrink-0"
                    >
                      <span className="text-[11px]">🏸</span>
                      <span>콕제출</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        soundEffects.playScorePoint();
                        handleToggleShuttlecock(player.id);
                      }}
                      title="콕제출 완료 (실수로 누른 경우 다시 눌러 되돌리기)"
                      className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 transition-all cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>완료</span>
                    </button>
                  )}

                  {/* Interactive Tier / Rank Selector (급수 수정) */}
                  <div className="relative shrink-0">
                    <select
                      value={player.tier}
                      onChange={(e) => handleUpdateTier(player.id, e.target.value as Tier)}
                      title={`${player.name} 급수(조) 변경`}
                      className={`text-[11px] font-bold pl-2 pr-5 py-0.5 rounded-lg border appearance-none cursor-pointer focus:outline-none transition-all ${tierMeta.bg} ${tierMeta.color} hover:brightness-125 focus:ring-1 focus:ring-emerald-400`}
                    >
                      <option value="S" className="bg-slate-900 text-rose-400 font-bold">S조</option>
                      <option value="A" className="bg-slate-900 text-amber-400">A조</option>
                      <option value="B" className="bg-slate-900 text-emerald-400">B조</option>
                      <option value="C" className="bg-slate-900 text-sky-400">C조</option>
                      <option value="D" className="bg-slate-900 text-indigo-400">D조</option>
                      <option value="Beginner" className="bg-slate-900 text-purple-400">E조</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60 text-slate-300" />
                  </div>

                  {/* Delete Player Button */}

                  <button
                    type="button"
                    onClick={() => handleDeletePlayer(player.id)}
                    title="참가자 삭제"
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}



      {/* Partner Configuration Modal */}
      <PartnerModal
        isOpen={showPartnerModal}
        onClose={() => setShowPartnerModal(false)}
        players={players}
        onUpdatePlayers={onUpdatePlayers}
      />

      {/* Master Members Management Modal */}
      <MasterMemberModal
        isOpen={showMasterMemberModal}
        onClose={() => setShowMasterMemberModal(false)}
        masterMembers={masterMembers}
        onUpdateMasterMembers={handleUpdateMasterMembers}
        currentPlayers={players}
        onUpdatePlayers={onUpdatePlayers}
        onSyncMemberEdit={onSyncMemberEdit}
        onOpenTestConfirm={
          onGenerateTestPlayers
            ? () => {
                soundEffects.playRacketHit();
                setShowTestConfirmModal(true);
              }
            : undefined
        }
        onAddPlayerToToday={(mName, mGender, mTier, mId) => {
          newPlayerNameInputRef.current?.blur();
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          const already = players.some(
            (p) =>
              (mId && p.masterMemberId === mId) ||
              (p.name.trim().toLowerCase() === mName.trim().toLowerCase() &&
                p.gender === mGender &&
                p.tier === mTier)
          );
          if (already) {
            showAlert(
              `'${mName}' (${mGender === 'M' ? '남성' : '여성'}, ${
                TIER_LABELS[mTier]?.short || mTier
              }) 선수는 이미 당일 참가자 명단에 등록되어 있습니다.`
            );
            return;
          }
          if (isConePromptEnabled) {
            soundEffects.playRacketHit();
            setPendingAddPlayer({
              name: mName,
              gender: mGender,
              tier: mTier,
              masterMemberId: mId,
              fromMasterModal: true,
            });
            setShowConePromptModal(true);
          } else {
            executeAddPlayer(mName, mGender, mTier, mId, undefined, {
              shouldFocusNameInput: false,
            });
          }
        }}
      />

      {/* Bulk Registration Modal (전체 회원 실시간 동기화 일괄등록) */}
      <BulkRegisterModal
        isOpen={showBulkRegisterModal}
        onClose={() => setShowBulkRegisterModal(false)}
        masterMembers={masterMembers}
        currentPlayers={players}
        onExecuteBatchRegister={handleExecuteBatchRegister}
        onCompleteNotice={(msg) => {
          setRestoredNotice(msg);
          setTimeout(() => setRestoredNotice(null), 5000);
        }}
      />

      {/* Matching Member Selection Modal */}
      <MemberSelectModal
        isOpen={showMemberSelectModal}
        onClose={() => {
          setShowMemberSelectModal(false);
          requestAnimationFrame(() => {
            newPlayerNameInputRef.current?.focus({ preventScroll: true });
          });
        }}
        searchName={selectSearchName}
        matchedMembers={selectMatchedMembers}
        currentPlayers={players}
        onSelectMember={(member) => {
          const already = players.some(
            (p) =>
              (p.masterMemberId && p.masterMemberId === member.id) ||
              (p.name.trim().toLowerCase() === member.name.trim().toLowerCase() &&
                p.gender === member.gender &&
                p.tier === member.tier)
          );
          if (already) {
            showAlert(
              `'${member.name}' (${member.gender === 'M' ? '남성' : '여성'}, ${
                TIER_LABELS[member.tier]?.short || member.tier
              }) 선수는 이미 당일 참가자 명단에 등록되어 있습니다.`
            );
            return;
          }
          setShowMemberSelectModal(false);
          if (isConePromptEnabled) {
            soundEffects.playRacketHit();
            setPendingAddPlayer({
              name: member.name,
              gender: member.gender,
              tier: member.tier,
              masterMemberId: member.id,
              fromMasterModal: false,
            });
            setShowConePromptModal(true);
          } else {
            executeAddPlayer(member.name, member.gender, member.tier, member.id, undefined, {
              shouldFocusNameInput: true,
            });
          }
        }}
      />

      {/* Cone Number Prompt Modal for Adding Participant */}
      {showConePromptModal && pendingAddPlayer && (
        <ConeNumberPromptModal
          isOpen={showConePromptModal}
          onClose={() => {
            const shouldFocus = !pendingAddPlayer.fromMasterModal && !showMasterMemberModal;
            setShowConePromptModal(false);
            setPendingAddPlayer(null);
            if (shouldFocus) {
              requestAnimationFrame(() => {
                newPlayerNameInputRef.current?.focus({ preventScroll: true });
              });
            } else {
              newPlayerNameInputRef.current?.blur();
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
            }
          }}
          targetName={pendingAddPlayer.name}
          targetGender={pendingAddPlayer.gender}
          targetTier={pendingAddPlayer.tier}
          initialConeNumber={pendingAddPlayer.coneNumber}
          onConfirm={handleConfirmConePrompt}
          onSkip={handleSkipConePrompt}
        />
      )}

      {/* Cone Number Prompt Modal for Attendance Check (출석 버튼 클릭 시 꼬깔확인 연동) */}
      {pendingAttendanceConePlayer && (
        <ConeNumberPromptModal
          isOpen={Boolean(pendingAttendanceConePlayer)}
          onClose={handleSkipAttendanceConePrompt}
          targetName={pendingAttendanceConePlayer.name}
          targetGender={pendingAttendanceConePlayer.gender}
          targetTier={pendingAttendanceConePlayer.tier}
          initialConeNumber={pendingAttendanceConePlayer.coneNumber}
          onConfirm={handleConfirmAttendanceConePrompt}
          onSkip={handleSkipAttendanceConePrompt}
        />
      )}

      {/* Reliable In-App Alert Modal */}
      {alertModalMessage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setAlertModalMessage(null)}
        >
          <div
            className="relative w-full max-w-sm bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3.5 shadow-sm shadow-amber-500/20">
              <AlertCircle className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-white mb-2">알림</h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-5 whitespace-pre-line font-medium">
              {alertModalMessage}
            </p>

            <button
              type="button"
              autoFocus
              onClick={() => setAlertModalMessage(null)}
              className="w-full py-2.5 px-4 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] text-slate-950 font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* Test Players 24 Generation Confirmation Modal (테스트 선수 24명 생성 확인/취소 안내 메뉴) */}
      {showTestConfirmModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => {
            soundEffects.playRacketHit();
            setShowTestConfirmModal(false);
          }}
        >
          <div
            className="relative w-full max-w-sm bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto shadow-sm shadow-amber-500/20">
              <FlaskConical className="w-6 h-6 text-amber-400" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-black text-white">
                테스트 선수 24명을 생성 하겠습니까?
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                임의의 이름과 급수를 가진 선수 24명이 참가자 명단에 추가됩니다. (전체 회원 명부에는 등록되지 않습니다)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  setShowTestConfirmModal(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  soundEffects.playWhistle();
                  onGenerateTestPlayers?.();
                  setShowTestConfirmModal(false);
                  setShowMasterMemberModal(false);
                  setRestoredNotice(
                    '참가자 명단에 임의의 이름과 급수를 가진 선수 24명이 생성되었습니다 (전체 회원 등록 제외)'
                  );
                }}
                className="py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-[0.98] text-slate-950 font-black text-xs transition-all shadow-md shadow-amber-500/20 cursor-pointer flex items-center justify-center gap-1"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>확인</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Special Status Release Confirmation Modal (휴식중/레슨중/막판!/퇴장! 상태 해제 확인 안내창) */}
      {statusConfirmPlayer && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => {
            soundEffects.playRacketHit();
            setStatusConfirmPlayer(null);
          }}
        >
          <div
            className="relative w-full max-w-xs bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl p-5 text-center animate-in zoom-in-95 duration-150 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-1.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto border ${
                  isPlayerLastMatchCompleted(statusConfirmPlayer)
                    ? 'bg-slate-600/25 border-slate-500/50 text-slate-300'
                    : statusConfirmPlayer.specialStatus === 'resting'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                    : statusConfirmPlayer.specialStatus === 'lesson'
                    ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                }`}
              >
                {isPlayerLastMatchCompleted(statusConfirmPlayer) ? (
                  <DoorOpen className="w-5 h-5" />
                ) : statusConfirmPlayer.specialStatus === 'resting' ? (
                  <Coffee className="w-5 h-5" />
                ) : statusConfirmPlayer.specialStatus === 'lesson' ? (
                  <GraduationCap className="w-5 h-5" />
                ) : (
                  <Flag className="w-5 h-5" />
                )}
              </div>
              <h4 className="text-sm font-black text-white">
                {statusConfirmPlayer.name} 선수 상태 해제
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                {isPlayerLastMatchCompleted(statusConfirmPlayer)
                  ? '퇴장 상태를 해제하시겠습니까?'
                  : statusConfirmPlayer.specialStatus === 'resting'
                  ? '휴식 상태를 해제하시겠습니까?'
                  : statusConfirmPlayer.specialStatus === 'lesson'
                  ? '레슨 상태를 해제하시겠습니까?'
                  : '마지막판 상태를 해제하시겠습니까?'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  setStatusConfirmPlayer(null);
                }}
                className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  onSetPlayerSpecialStatus?.(statusConfirmPlayer.id, null);
                  setStatusConfirmPlayer(null);
                }}
                className="py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors cursor-pointer"
              >
                해제 확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
