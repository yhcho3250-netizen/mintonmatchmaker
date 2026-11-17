import {
  Player,
  CourtInfo,
  CourtMatch,
  MatchRound,
  MatchOptions,
} from '../types';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
  removeDeviceStorageItem,
} from './deviceStorage';

/**
 * 일별 운동 기록 스냅샷 (코트현황 / 게임목록 / 참가자명단 / 대진기록 통합 저장)
 */
export interface DailyWorkoutRecord {
  date: string; // 'YYYY-MM-DD'
  updatedAt: number;
  meetupName: string;
  players: Player[];
  courts: CourtInfo[];
  activeMatches: CourtMatch[];
  queuedMatches: CourtMatch[];
  roundHistory: MatchRound[];
  archivedPlayers: Record<string, Player>;
  options: MatchOptions;
}

/**
 * AM 04:00 자동 저장 및 전체 초기화 상태
 */
export interface FourAmResetState {
  lastCompletedBoundaryKey: string; // 가장 마지막으로 처리 완료된 04:00 기준일 ('YYYY-MM-DD')
  snoozeUntil?: number | null; // 취소 클릭 시 30분 뒤 재알림 시각 (timestamp)
  modalExpiresAt?: number | null; // 알림 모달 3분 카운트다운 종료 시각 (timestamp)
  pendingBoundaryKey?: string | null; // 현재 대기 중인 04:00 경계 키
  pendingArchiveDate?: string | null; // 저장 대상 전날 날짜 ('YYYY-MM-DD')
  earlyMorningBypassBoundaryKey?: string | null; // 당일 00:00~04:00 사이 첫 운동 진행/배정 시작으로 인해 전체 초기화 및 알림이 면제된 날짜 ('YYYY-MM-DD')
}

export const THREE_MINUTES_MS = 3 * 60 * 1000; // 3분 (180초)
export const THIRTY_MINUTES_MS = 30 * 60 * 1000; // 30분 (1800초)

/**
 * 로컬 Date를 'YYYY-MM-DD' 문자열로 변환
 */
export function formatDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 'YYYY-MM-DD' 문자열을 로컬 Date 객체로 변환
 */
export function parseDateKey(dateKey: string): Date {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return new Date();
  }
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}

/**
 * 'YYYY-MM-DD' 문자열을 한국어 날짜 표기(예: '2026년 11월 12일 (목)')로 변환
 */
export function formatKoreanDateLabel(dateKey: string, includeWeekday = true): string {
  const date = parseDateKey(dateKey);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (!includeWeekday) {
    return `${y}년 ${m}월 ${d}일`;
  }
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const w = weekdays[date.getDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}

/**
 * 기준 시각으로부터 전날 날짜('YYYY-MM-DD') 반환
 */
export function getYesterdayDateKey(now: Date = new Date()): string {
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    0,
    0,
    0,
    0
  );
  return formatDateKey(yesterday);
}

/**
 * 1개월 보관 기준일 반환 (오늘로부터 1개월 전 'YYYY-MM-DD', 이 날짜보다 이전 기록은 자동 삭제)
 */
export function getOneMonthCutoffDateKey(now: Date = new Date()): string {
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    now.getDate(),
    0,
    0,
    0,
    0
  );
  return formatDateKey(cutoff);
}

/**
 * 특정 날짜('YYYY-MM-DD')가 최근 1개월 보관 범위(cutoff ~ today) 내인지 확인
 */
export function isDateWithinOneMonthWindow(
  dateKey: string,
  now: Date = new Date()
): boolean {
  const cutoffKey = getOneMonthCutoffDateKey(now);
  const todayKey = formatDateKey(now);
  return dateKey >= cutoffKey && dateKey <= todayKey;
}

/**
 * 가장 최근에 도달한 오전 04:00 경계 시각의 날짜 키('YYYY-MM-DD') 반환
 * - 현재 시각이 04:00 이상이면 오늘 날짜('YYYY-MM-DD')
 * - 현재 시각이 00:00 ~ 03:59이면 어제 날짜('YYYY-MM-DD')
 */
export function getLatestFourAmBoundaryKey(now: Date = new Date()): string {
  const boundary = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    4,
    0,
    0,
    0
  );
  if (now.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return formatDateKey(boundary);
}

/**
 * 오전 04:00 경계 키에 해당하는 '전날 날짜'('YYYY-MM-DD') 반환
 * 예: 2026-11-13 04:00 경계 도달 시 -> '2026-11-12' (전날 날짜)
 */
export function getArchiveDateForBoundaryKey(boundaryKey: string): string {
  const boundaryDate = parseDateKey(boundaryKey);
  return getYesterdayDateKey(boundaryDate);
}

/**
 * 특정 04:00 경계 키('YYYY-MM-DD')의 실제 오전 04:00:00.000 타임스탬프 반환
 */
export function getFourAmTimestampForBoundaryKey(boundaryKey: string): number {
  const d = parseDateKey(boundaryKey);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0).getTime();
}

/**
 * 현재 화면의 운동 데이터가 특정 04:00 경계 시각(예: 오늘 오전 04:00) 이후에 새로 시작된 당일 운동인지 판별
 */
export function didWorkoutStartAfterFourAmBoundary(
  snapshot: Partial<DailyWorkoutRecord> | null | undefined,
  boundaryKey: string
): boolean {
  if (!snapshot || !isWorkoutSnapshotNonEmpty(snapshot)) return false;
  const boundaryFourAmMs = getFourAmTimestampForBoundaryKey(boundaryKey);
  const timestamps: number[] = [];

  (snapshot.players || []).forEach((p) => {
    if (typeof p.registeredAt === 'number' && p.registeredAt > 0) timestamps.push(p.registeredAt);
    else if (typeof p.createdAt === 'number' && p.createdAt > 0) timestamps.push(p.createdAt);
  });

  (snapshot.courts || []).forEach((c) => {
    const idMatch = typeof c?.id === 'string' ? c.id.match(/^court[_-](\d+)$/) : null;
    if (idMatch) {
      const ts = Number(idMatch[1]);
      if (Number.isFinite(ts) && ts > 0) timestamps.push(ts);
    }
  });

  const collectMatchTs = (m?: CourtMatch | null) => {
    if (!m) return;
    if (typeof m.startedAt === 'number' && m.startedAt > 0) timestamps.push(m.startedAt);
    if (typeof m.completedAt === 'number' && m.completedAt > 0) timestamps.push(m.completedAt);
    if (m.playerAssignedAt && typeof m.playerAssignedAt === 'object') {
      Object.values(m.playerAssignedAt).forEach((t) => {
        if (typeof t === 'number' && t > 0) timestamps.push(t);
      });
    }
  };

  (snapshot.activeMatches || []).forEach(collectMatchTs);
  (snapshot.queuedMatches || []).forEach(collectMatchTs);
  (snapshot.roundHistory || []).forEach((r) => {
    if (typeof r?.timestamp === 'number' && r.timestamp > 0) timestamps.push(r.timestamp);
    (r?.matches || []).forEach(collectMatchTs);
  });

  if (timestamps.length === 0) return false;
  return Math.min(...timestamps) >= boundaryFourAmMs;
}

/**
 * 테스트(선수 24명 생성)로 만들어진 선수인지 판별
 */
export function isTestPlayerRecord(
  player?: { id?: string; isTest?: boolean } | null
): boolean {
  if (!player) return false;
  return Boolean(
    player.isTest || (typeof player.id === 'string' && player.id.startsWith('p_test_'))
  );
}

/**
 * 스냅샷에 테스트 선수 또는 테스트 선수가 포함된 경기가 있는지 확인하고,
 * 운동 기록에 테스트 선수 및 테스트로 짜여진 대진/코트 데이터가 절대 남지 않도록 제거한 순수 운동 기록 반환
 */
export function sanitizeWorkoutSnapshotForStorage<
  T extends Partial<DailyWorkoutRecord>
>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;

  const testPlayerIds = new Set<string>();
  let hadTestData = false;

  const rawPlayers = Array.isArray(snapshot.players) ? snapshot.players : [];
  rawPlayers.forEach((p) => {
    if (isTestPlayerRecord(p)) {
      if (p?.id) testPlayerIds.add(p.id);
      hadTestData = true;
    }
  });

  if (snapshot.archivedPlayers && typeof snapshot.archivedPlayers === 'object') {
    Object.entries(snapshot.archivedPlayers).forEach(([pid, p]) => {
      if (isTestPlayerRecord(p) || pid.startsWith('p_test_')) {
        testPlayerIds.add(pid);
        if (p?.id) testPlayerIds.add(p.id);
        hadTestData = true;
      }
    });
  }

  const isTestId = (id?: string | null): boolean => {
    if (!id || typeof id !== 'string') return false;
    return id.startsWith('p_test_') || testPlayerIds.has(id);
  };

  const isMatchWithTestPlayers = (m?: CourtMatch | null): boolean => {
    if (!m) return false;
    const ids = [
      m.teamA?.player1Id,
      m.teamA?.player2Id,
      m.teamB?.player1Id,
      m.teamB?.player2Id,
    ];
    if (ids.some((id) => isTestId(id))) {
      return true;
    }
    if (m.playerSnapshots && typeof m.playerSnapshots === 'object') {
      if (Object.keys(m.playerSnapshots).some((id) => isTestId(id))) {
        return true;
      }
    }
    return false;
  };

  const rawActiveMatches = Array.isArray(snapshot.activeMatches)
    ? snapshot.activeMatches
    : [];
  const rawQueuedMatches = Array.isArray(snapshot.queuedMatches)
    ? snapshot.queuedMatches
    : [];
  const rawRounds = Array.isArray(snapshot.roundHistory) ? snapshot.roundHistory : [];

  const filteredActiveMatches = rawActiveMatches.filter((m) => {
    const isTest = isMatchWithTestPlayers(m);
    if (isTest) hadTestData = true;
    return !isTest;
  });

  const filteredQueuedMatches = rawQueuedMatches.filter((m) => {
    const isTest = isMatchWithTestPlayers(m);
    if (isTest) hadTestData = true;
    return !isTest;
  });

  let hadTestRoundFiltered = false;
  const filteredRounds: MatchRound[] = [];
  for (const r of rawRounds) {
    if (!r || !Array.isArray(r.matches)) continue;
    const realMatches = r.matches.filter((m) => {
      const isTest = isMatchWithTestPlayers(m);
      if (isTest) {
        hadTestData = true;
        hadTestRoundFiltered = true;
      }
      return !isTest;
    });
    const realRestingIds = Array.isArray(r.restingPlayerIds)
      ? r.restingPlayerIds.filter((id) => !isTestId(id))
      : [];
    if (realMatches.length > 0) {
      filteredRounds.push({
        ...r,
        matches: realMatches,
        restingPlayerIds: realRestingIds,
      });
    } else if (r.matches.length > 0) {
      hadTestData = true;
      hadTestRoundFiltered = true;
    }
  }

  if (!hadTestData) {
    return snapshot;
  }

  const cleanPlayerStatsAndRefs = (p: Player): Player => {
    const nextP: Player = { ...p };
    if (nextP.partnerId && isTestId(nextP.partnerId)) {
      nextP.partnerId = undefined;
    }
    if (nextP.lastPartnerId && isTestId(nextP.lastPartnerId)) {
      nextP.lastPartnerId = undefined;
    }
    if (Array.isArray(nextP.lastOpponentIds)) {
      const cleanedOpp = nextP.lastOpponentIds.filter((id) => !isTestId(id));
      nextP.lastOpponentIds = cleanedOpp.length > 0 ? cleanedOpp : undefined;
    }
    if (nextP.partnerHistory && typeof nextP.partnerHistory === 'object') {
      const cleanedPH: Record<string, number> = {};
      Object.entries(nextP.partnerHistory).forEach(([pid, cnt]) => {
        if (!isTestId(pid)) cleanedPH[pid] = cnt;
      });
      nextP.partnerHistory = cleanedPH;
    }
    if (nextP.opponentHistory && typeof nextP.opponentHistory === 'object') {
      const cleanedOH: Record<string, number> = {};
      Object.entries(nextP.opponentHistory).forEach(([pid, cnt]) => {
        if (!isTestId(pid)) cleanedOH[pid] = cnt;
      });
      nextP.opponentHistory = cleanedOH;
    }

    if (hadTestRoundFiltered) {
      let games = 0;
      let wins = 0;
      let losses = 0;
      let ptsWon = 0;
      let ptsLost = 0;
      const partnerHist: Record<string, number> = {};
      const opponentHist: Record<string, number> = {};
      let lastPartnerId: string | undefined = undefined;
      let lastOpponentIds: string[] | undefined = undefined;

      filteredRounds.forEach((round) => {
        round.matches.forEach((m) => {
          if (m.status !== 'completed') return;
          const teamAIds = [m.teamA?.player1Id, m.teamA?.player2Id].filter(Boolean);
          const teamBIds = [m.teamB?.player1Id, m.teamB?.player2Id].filter(Boolean);
          const inA = teamAIds.includes(nextP.id);
          const inB = teamBIds.includes(nextP.id);
          if (!inA && !inB) return;

          games += 1;
          const myTeamIds = inA ? teamAIds : teamBIds;
          const oppTeamIds = inA ? teamBIds : teamAIds;
          const partnerId = myTeamIds.find((id) => id !== nextP.id);
          if (partnerId && !isTestId(partnerId)) {
            partnerHist[partnerId] = (partnerHist[partnerId] || 0) + 1;
            lastPartnerId = partnerId;
          }
          oppTeamIds.forEach((oid) => {
            if (!isTestId(oid)) {
              opponentHist[oid] = (opponentHist[oid] || 0) + 1;
            }
          });
          lastOpponentIds = oppTeamIds.filter((oid) => !isTestId(oid));

          const sA = m.teamA?.score ?? 0;
          const sB = m.teamB?.score ?? 0;
          if (inA) {
            ptsWon += sA;
            ptsLost += sB;
            if (sA > sB) wins += 1;
            else if (sB > sA) losses += 1;
          } else {
            ptsWon += sB;
            ptsLost += sA;
            if (sB > sA) wins += 1;
            else if (sA > sB) losses += 1;
          }
        });
      });

      nextP.gamesPlayed = games;
      nextP.wins = wins;
      nextP.losses = losses;
      nextP.totalPointsWon = ptsWon;
      nextP.totalPointsLost = ptsLost;
      nextP.partnerHistory = partnerHist;
      nextP.opponentHistory = opponentHist;
      nextP.lastPartnerId = lastPartnerId;
      nextP.lastOpponentIds = lastOpponentIds;
    }

    return nextP;
  };

  const filteredPlayers = rawPlayers
    .filter((p) => !isTestPlayerRecord(p))
    .map(cleanPlayerStatsAndRefs);

  const filteredArchivedPlayers: Record<string, Player> = {};
  if (snapshot.archivedPlayers && typeof snapshot.archivedPlayers === 'object') {
    Object.entries(snapshot.archivedPlayers).forEach(([pid, p]) => {
      if (!p || isTestPlayerRecord(p) || isTestId(pid)) return;
      filteredArchivedPlayers[pid] = cleanPlayerStatsAndRefs(p);
    });
  }

  const hasAnyRealActivity =
    filteredPlayers.length > 0 ||
    filteredActiveMatches.length > 0 ||
    filteredQueuedMatches.length > 0 ||
    filteredRounds.length > 0;

  // 테스트 선수만으로 짜여진 운동인 경우 코트 정보도 테스트 세션 데이터이므로 함께 비움
  const filteredCourts = hasAnyRealActivity && Array.isArray(snapshot.courts)
    ? [...snapshot.courts]
    : [];

  return {
    ...snapshot,
    players: filteredPlayers,
    courts: filteredCourts,
    activeMatches: filteredActiveMatches,
    queuedMatches: filteredQueuedMatches,
    roundHistory: filteredRounds,
    archivedPlayers: filteredArchivedPlayers,
    options: snapshot.options
      ? {
          ...snapshot.options,
          courtCount: filteredCourts.length,
        }
      : snapshot.options,
  };
}

/**
 * 운동 기록 스냅샷에 유의미한(테스트 데이터가 아닌 실제) 데이터가 있는지 확인
 */
export function isWorkoutSnapshotNonEmpty(
  snapshot: Partial<DailyWorkoutRecord> | null | undefined
): boolean {
  if (!snapshot) return false;
  const sanitized = sanitizeWorkoutSnapshotForStorage(snapshot);
  return (
    (Array.isArray(sanitized.players) && sanitized.players.length > 0) ||
    (Array.isArray(sanitized.courts) && sanitized.courts.length > 0) ||
    (Array.isArray(sanitized.activeMatches) && sanitized.activeMatches.length > 0) ||
    (Array.isArray(sanitized.queuedMatches) && sanitized.queuedMatches.length > 0) ||
    (Array.isArray(sanitized.roundHistory) && sanitized.roundHistory.length > 0)
  );
}

/**
 * 1개월 이전의 오래된 운동 기록 및 테스트 선수로 짜여진 운동 기록 자동 삭제 정리
 */
export function pruneOldWorkoutRecords(
  records: Record<string, DailyWorkoutRecord>,
  now: Date = new Date()
): { pruned: Record<string, DailyWorkoutRecord>; didPrune: boolean } {
  const cutoffKey = getOneMonthCutoffDateKey(now);
  const pruned: Record<string, DailyWorkoutRecord> = {};
  let didPrune = false;

  for (const [dateKey, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object') {
      didPrune = true;
      continue;
    }
    // 1개월 이전 날짜 기록은 자동 삭제
    if (dateKey < cutoffKey) {
      didPrune = true;
      continue;
    }
    const sanitized = sanitizeWorkoutSnapshotForStorage(record);
    if (!isWorkoutSnapshotNonEmpty(sanitized)) {
      didPrune = true;
      continue;
    }
    if (sanitized !== record) {
      didPrune = true;
    }
    pruned[dateKey] = sanitized;
  }

  return { pruned, didPrune };
}

/**
 * 기기 내부 저장소에서 전체 운동 기록 맵(최근 1개월) 불러오기
 */
export function loadWorkoutRecords(
  now: Date = new Date()
): Record<string, DailyWorkoutRecord> {
  const raw = getDeviceStorageItem(DEVICE_STORAGE_KEYS.WORKOUT_RECORDS);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const { pruned, didPrune } = pruneOldWorkoutRecords(
      parsed as Record<string, DailyWorkoutRecord>,
      now
    );
    if (didPrune) {
      setDeviceStorageItem(
        DEVICE_STORAGE_KEYS.WORKOUT_RECORDS,
        JSON.stringify(pruned)
      );
    }
    return pruned;
  } catch {
    return {};
  }
}

/**
 * 기기 내부 저장소에 전체 운동 기록 맵(최근 1개월) 저장
 */
export function saveWorkoutRecords(
  records: Record<string, DailyWorkoutRecord>,
  now: Date = new Date()
): Record<string, DailyWorkoutRecord> {
  const { pruned } = pruneOldWorkoutRecords(records, now);
  setDeviceStorageItem(
    DEVICE_STORAGE_KEYS.WORKOUT_RECORDS,
    JSON.stringify(pruned)
  );
  return pruned;
}

/**
 * 특정 날짜의 운동 기록 저장/업데이트 (테스트 선수 운동 기록 제외 및 1개월 초과 기록 자동 정리 포함)
 */
export function upsertDailyWorkoutRecord(
  dateKey: string,
  snapshot: Omit<DailyWorkoutRecord, 'date' | 'updatedAt'>,
  options?: {
    removeIfEmpty?: boolean;
    preserveExistingIfEmpty?: boolean;
    now?: Date;
  }
): Record<string, DailyWorkoutRecord> {
  const now = options?.now || new Date();
  const records = loadWorkoutRecords(now);
  const sanitized = sanitizeWorkoutSnapshotForStorage(snapshot);
  const nonEmpty = isWorkoutSnapshotNonEmpty(sanitized);
  const hadTestDataOnly =
    !nonEmpty &&
    Array.isArray(snapshot.players) &&
    snapshot.players.some((p) => isTestPlayerRecord(p));

  if (nonEmpty) {
    records[dateKey] = {
      ...sanitized,
      date: dateKey,
      updatedAt: now.getTime(),
    };
  } else {
    if (!hadTestDataOnly && options?.preserveExistingIfEmpty && records[dateKey]) {
      // 기존에 저장된 실제 운동 기록이 있으면 앱 초기 마운트 빈 상태로 덮어쓰지 않고 보존
      return saveWorkoutRecords(records, now);
    }
    if (hadTestDataOnly || options?.removeIfEmpty !== false) {
      delete records[dateKey];
    }
  }

  return saveWorkoutRecords(records, now);
}

/**
 * 특정 날짜의 운동 기록 삭제
 */
export function deleteDailyWorkoutRecord(
  dateKey: string,
  now: Date = new Date()
): Record<string, DailyWorkoutRecord> {
  const records = loadWorkoutRecords(now);
  if (records[dateKey]) {
    delete records[dateKey];
    return saveWorkoutRecords(records, now);
  }
  return records;
}

/**
 * 과거 운동 기록을 캘린더에서 열람할 때 당일 실시간 운동 데이터를 임시 보관(Stash)
 */
export function saveTodayLiveStash(record: DailyWorkoutRecord): void {
  setDeviceStorageItem(
    DEVICE_STORAGE_KEYS.TODAY_LIVE_STASH,
    JSON.stringify(record)
  );
}

export function loadTodayLiveStash(): DailyWorkoutRecord | null {
  const raw = getDeviceStorageItem(DEVICE_STORAGE_KEYS.TODAY_LIVE_STASH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string') {
      return parsed as DailyWorkoutRecord;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearTodayLiveStash(): void {
  removeDeviceStorageItem(DEVICE_STORAGE_KEYS.TODAY_LIVE_STASH);
}

/**
 * 현재 캘린더를 통해 열람 중인 과거 운동 기록 날짜 ('YYYY-MM-DD' 또는 null)
 */
export function saveViewingWorkoutDate(dateKey: string | null): void {
  if (!dateKey) {
    removeDeviceStorageItem(DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE);
  } else {
    setDeviceStorageItem(DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE, dateKey);
  }
}

export function loadViewingWorkoutDate(now: Date = new Date()): string | null {
  const val = getDeviceStorageItem(DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE);
  if (!val) return null;
  const trimmed = val.trim();
  const todayKey = formatDateKey(now);
  if (!trimmed || trimmed === todayKey || !isDateWithinOneMonthWindow(trimmed, now)) {
    removeDeviceStorageItem(DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE);
    return null;
  }
  return trimmed;
}

/**
 * AM 04:00 자동 초기화 상태 로드 및 저장
 */
export function loadFourAmState(now: Date = new Date()): FourAmResetState {
  const raw = getDeviceStorageItem(DEVICE_STORAGE_KEYS.FOUR_AM_STATE);
  const currentBoundaryKey = getLatestFourAmBoundaryKey(now);

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.lastCompletedBoundaryKey === 'string') {
        const boundaryFourAmMs = getFourAmTimestampForBoundaryKey(currentBoundaryKey);
        const nowMs = now.getTime();
        // 오전 04:00 정각 구간이 아닌 일반 시간에 앱을 초기에 켰을 때,
        // 이전에 잘못 남아있던 modalExpiresAt / snoozeUntil로 인해 초기화 알림이 뜨지 않도록 정리
        const isInFourAmTriggerWindow =
          nowMs >= boundaryFourAmMs && nowMs <= boundaryFourAmMs + THREE_MINUTES_MS;
        const isInFourAmSnoozeWindow =
          nowMs >= boundaryFourAmMs && nowMs <= boundaryFourAmMs + 2 * 60 * 60 * 1000;

        const validModalExpiresAt =
          isInFourAmTriggerWindow &&
          typeof parsed.modalExpiresAt === 'number' &&
          parsed.modalExpiresAt > nowMs
            ? parsed.modalExpiresAt
            : null;
        const validSnoozeUntil =
          isInFourAmSnoozeWindow &&
          typeof parsed.snoozeUntil === 'number' &&
          parsed.snoozeUntil > nowMs
            ? parsed.snoozeUntil
            : null;

        const hadStalePendingReset =
          !validModalExpiresAt &&
          !validSnoozeUntil &&
          Boolean(parsed.modalExpiresAt || parsed.snoozeUntil) &&
          typeof parsed.pendingArchiveDate === 'string';

        const cleanedState: FourAmResetState = {
          lastCompletedBoundaryKey: hadStalePendingReset
            ? parsed.pendingArchiveDate
            : parsed.lastCompletedBoundaryKey,
          snoozeUntil: validSnoozeUntil,
          modalExpiresAt: validModalExpiresAt,
          pendingBoundaryKey:
            validModalExpiresAt || validSnoozeUntil ? (parsed.pendingBoundaryKey ?? null) : null,
          pendingArchiveDate:
            validModalExpiresAt || validSnoozeUntil ? (parsed.pendingArchiveDate ?? null) : null,
          earlyMorningBypassBoundaryKey: parsed.earlyMorningBypassBoundaryKey ?? null,
        };

        if (
          cleanedState.modalExpiresAt !== (parsed.modalExpiresAt ?? null) ||
          cleanedState.snoozeUntil !== (parsed.snoozeUntil ?? null)
        ) {
          setDeviceStorageItem(
            DEVICE_STORAGE_KEYS.FOUR_AM_STATE,
            JSON.stringify(cleanedState)
          );
        }

        return cleanedState;
      }
    } catch {
      // fallback below
    }
  }

  const initialState: FourAmResetState = {
    lastCompletedBoundaryKey: currentBoundaryKey,
    snoozeUntil: null,
    modalExpiresAt: null,
    pendingBoundaryKey: null,
    pendingArchiveDate: null,
    earlyMorningBypassBoundaryKey: null,
  };
  setDeviceStorageItem(
    DEVICE_STORAGE_KEYS.FOUR_AM_STATE,
    JSON.stringify(initialState)
  );
  return initialState;
}

export function saveFourAmState(state: FourAmResetState): void {
  setDeviceStorageItem(
    DEVICE_STORAGE_KEYS.FOUR_AM_STATE,
    JSON.stringify(state)
  );
}

/**
 * 특정 날짜('YYYY-MM-DD')의 자정 종료 시각(즉, 다음날 00:00:00.000) 타임스탬프 반환
 */
export function getEndOfDateMidnightMs(dateKey: string): number {
  const d = parseDateKey(dateKey);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/**
 * 각 날짜의 00:00시 전까지의 운동 기록 스냅샷 불러오기 및 저장 (최근 1개월 유지)
 */
export function loadPreMidnightRecords(
  now: Date = new Date()
): Record<string, DailyWorkoutRecord> {
  const raw = getDeviceStorageItem(DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const { pruned, didPrune } = pruneOldWorkoutRecords(
      parsed as Record<string, DailyWorkoutRecord>,
      now
    );
    if (didPrune) {
      setDeviceStorageItem(
        DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS,
        JSON.stringify(pruned)
      );
    }
    return pruned;
  } catch {
    return {};
  }
}

export function savePreMidnightRecord(
  dateKey: string,
  snapshot: Omit<DailyWorkoutRecord, 'date' | 'updatedAt'>,
  now: Date = new Date(),
  options?: { skipTimestampFilter?: boolean }
): Record<string, DailyWorkoutRecord> {
  const records = loadPreMidnightRecords(now);
  const sanitizedInput = sanitizeWorkoutSnapshotForStorage(snapshot);
  const targetSnapshot = options?.skipTimestampFilter
    ? sanitizedInput
    : extractPreMidnightSnapshot(sanitizedInput, dateKey);

  if (isWorkoutSnapshotNonEmpty(targetSnapshot)) {
    records[dateKey] = {
      ...targetSnapshot,
      date: dateKey,
      updatedAt: now.getTime(),
    };
  } else {
    delete records[dateKey];
  }
  const { pruned } = pruneOldWorkoutRecords(records, now);
  setDeviceStorageItem(
    DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS,
    JSON.stringify(pruned)
  );
  return pruned;
}

export function deletePreMidnightRecord(
  dateKey: string,
  now: Date = new Date()
): Record<string, DailyWorkoutRecord> {
  const records = loadPreMidnightRecords(now);
  if (records[dateKey]) {
    delete records[dateKey];
    const { pruned } = pruneOldWorkoutRecords(records, now);
    setDeviceStorageItem(
      DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS,
      JSON.stringify(pruned)
    );
    return pruned;
  }
  return records;
}

/**
 * 스냅샷에서 특정 날짜(dateKey)의 00:00시(다음날 자정) 전까지의 기록만 추출
 * - 테스트 선수로 짜여진 운동 데이터는 먼저 제외하며,
 * - 00:00시 이후에 등록된 선수, 00:00시 이후에 생성된 코트, 00:00시 이후에 배정/시작/완료된 경기 및 대진기록을 제외하고
 *   00:00시 전까지의 상태만 정확히 보존합니다.
 */
export function extractPreMidnightSnapshot(
  snapshot: Omit<DailyWorkoutRecord, 'date' | 'updatedAt'>,
  dateKey: string
): Omit<DailyWorkoutRecord, 'date' | 'updatedAt'> {
  const cleanSnapshot = sanitizeWorkoutSnapshotForStorage(snapshot);
  const cutoffMs = getEndOfDateMidnightMs(dateKey);

  const isLiveMatchBeforeMidnight = (m: CourtMatch): boolean => {
    if (typeof m.startedAt === 'number' && m.startedAt >= cutoffMs) {
      return false;
    }
    if (typeof m.completedAt === 'number' && m.completedAt >= cutoffMs) {
      return false;
    }
    if (m.playerAssignedAt && typeof m.playerAssignedAt === 'object') {
      const assignedTimes = Object.values(m.playerAssignedAt).filter(
        (t): t is number => typeof t === 'number' && t > 0
      );
      if (assignedTimes.length > 0 && Math.min(...assignedTimes) >= cutoffMs) {
        return false;
      }
    }
    return true;
  };

  // 1. 대진기록(roundHistory) 중 00:00시 전까지 완료된 경기만 필터링
  const originalRounds = Array.isArray(cleanSnapshot.roundHistory) ? cleanSnapshot.roundHistory : [];
  let hadPostMidnightRoundFiltered = false;
  const filteredRounds: MatchRound[] = [];

  for (const r of originalRounds) {
    if (!r || !Array.isArray(r.matches)) continue;
    const preMatches = r.matches.filter((m) => {
      const completedTime =
        (typeof m.completedAt === 'number' && m.completedAt > 0 ? m.completedAt : 0) ||
        (typeof r.timestamp === 'number' && r.timestamp > 0 ? r.timestamp : 0) ||
        (typeof m.startedAt === 'number' && m.startedAt > 0 ? m.startedAt : 0);
      const keep = completedTime === 0 || completedTime < cutoffMs;
      if (!keep) hadPostMidnightRoundFiltered = true;
      return keep;
    });
    if (preMatches.length > 0) {
      filteredRounds.push({
        ...r,
        matches: preMatches,
      });
    } else if (r.matches.length > 0) {
      hadPostMidnightRoundFiltered = true;
    }
  }

  // 2. 진행 중 코트(activeMatches) 및 대기열(queuedMatches) 중 00:00시 전까지의 경기만 필터링
  const filteredActiveMatches = (cleanSnapshot.activeMatches || []).filter(isLiveMatchBeforeMidnight);
  const filteredQueuedMatches = (cleanSnapshot.queuedMatches || []).filter(isLiveMatchBeforeMidnight);

  // 3. 코트(courts) 중 00:00시 전에 생성된 코트만 유지
  const filteredCourts = (cleanSnapshot.courts || []).filter((c) => {
    if (!c) return false;
    const idMatch = typeof c.id === 'string' ? c.id.match(/^court[_-](\d+)$/) : null;
    if (idMatch) {
      const createdTs = Number(idMatch[1]);
      if (Number.isFinite(createdTs) && createdTs >= cutoffMs) {
        return false;
      }
    }
    return true;
  });

  // 4. 참가자 명단(players) 중 00:00시 전에 등록된 참가자만 필터링
  const filteredPlayers = (cleanSnapshot.players || [])
    .filter((p) => {
      if (typeof p.registeredAt === 'number' && p.registeredAt > 0) {
        return p.registeredAt < cutoffMs;
      }
      if (typeof p.createdAt === 'number' && p.createdAt > 0) {
        return p.createdAt < cutoffMs;
      }
      return true;
    })
    .map((p) => {
      const nextP: Player = { ...p };
      if (typeof nextP.firstFourAssignedAt === 'number' && nextP.firstFourAssignedAt >= cutoffMs) {
        nextP.firstFourAssignedAt = undefined;
      }
      // 만약 00:00시 이후 완료된 경기가 제외되었다면 00:00시 전까지의 대진기록 기준으로 전적/게임수 재계산
      if (hadPostMidnightRoundFiltered) {
        let games = 0;
        let wins = 0;
        let losses = 0;
        let ptsWon = 0;
        let ptsLost = 0;
        const partnerHist: Record<string, number> = {};
        const opponentHist: Record<string, number> = {};
        let lastPartnerId: string | undefined = undefined;
        let lastOpponentIds: string[] | undefined = undefined;

        filteredRounds.forEach((round) => {
          round.matches.forEach((m) => {
            if (m.status !== 'completed') return;
            const teamAIds = [m.teamA?.player1Id, m.teamA?.player2Id].filter(Boolean);
            const teamBIds = [m.teamB?.player1Id, m.teamB?.player2Id].filter(Boolean);
            const inA = teamAIds.includes(nextP.id);
            const inB = teamBIds.includes(nextP.id);
            if (!inA && !inB) return;

            games += 1;
            const myTeamIds = inA ? teamAIds : teamBIds;
            const oppTeamIds = inA ? teamBIds : teamAIds;
            const partnerId = myTeamIds.find((id) => id !== nextP.id);
            if (partnerId) {
              partnerHist[partnerId] = (partnerHist[partnerId] || 0) + 1;
              lastPartnerId = partnerId;
            }
            oppTeamIds.forEach((oid) => {
              opponentHist[oid] = (opponentHist[oid] || 0) + 1;
            });
            lastOpponentIds = [...oppTeamIds];

            const sA = m.teamA?.score ?? 0;
            const sB = m.teamB?.score ?? 0;
            if (inA) {
              ptsWon += sA;
              ptsLost += sB;
              if (sA > sB) wins += 1;
              else if (sB > sA) losses += 1;
            } else {
              ptsWon += sB;
              ptsLost += sA;
              if (sB > sA) wins += 1;
              else if (sA > sB) losses += 1;
            }
          });
        });

        nextP.gamesPlayed = games;
        nextP.wins = wins;
        nextP.losses = losses;
        nextP.totalPointsWon = ptsWon;
        nextP.totalPointsLost = ptsLost;
        nextP.partnerHistory = partnerHist;
        nextP.opponentHistory = opponentHist;
        nextP.lastPartnerId = lastPartnerId;
        nextP.lastOpponentIds = lastOpponentIds;
      }
      return nextP;
    });

  // 5. 보관된 선수(archivedPlayers)도 00:00시 이전 등록 선수만 유지
  const filteredArchivedPlayers: Record<string, Player> = {};
  if (cleanSnapshot.archivedPlayers && typeof cleanSnapshot.archivedPlayers === 'object') {
    for (const [pid, p] of Object.entries(cleanSnapshot.archivedPlayers)) {
      if (!p) continue;
      if (typeof p.registeredAt === 'number' && p.registeredAt >= cutoffMs) {
        continue;
      }
      if (typeof p.createdAt === 'number' && p.createdAt >= cutoffMs) {
        continue;
      }
      filteredArchivedPlayers[pid] = { ...p };
    }
  }

  return sanitizeWorkoutSnapshotForStorage({
    meetupName: cleanSnapshot.meetupName,
    players: filteredPlayers,
    courts: filteredCourts,
    activeMatches: filteredActiveMatches,
    queuedMatches: filteredQueuedMatches,
    roundHistory: filteredRounds,
    archivedPlayers: filteredArchivedPlayers,
    options: {
      ...cleanSnapshot.options,
      courtCount: filteredCourts.length,
    },
  });
}

/**
 * 당일 00:00 ~ 04:00 시간 사이에 첫 운동이 진행 또는 배정이 시작되었는지 판별
 * - 당일 00:00:00 이상 ~ 04:00:00 미만 시간대에 첫 운동의 배정(게임목록) 또는 진행(코트현황)이 시작된 경우 true 반환
 * - 테스트 선수로 짜여진 운동 데이터는 운동 기록 대상이 아니므로 제외하고 판별합니다.
 */
export function didFirstWorkoutStartInEarlyMorningWindow(params: {
  now?: Date;
  targetDateKey?: string;
  players: Player[];
  activeMatches: CourtMatch[];
  queuedMatches: CourtMatch[];
  roundHistory: MatchRound[];
  fourAmState?: FourAmResetState;
}): boolean {
  const now = params.now || new Date();
  const targetDateKey = params.targetDateKey || formatDateKey(now);
  const midnightMs = parseDateKey(targetDateKey).getTime(); // 당일 00:00:00.000
  const fourAmMs = midnightMs + 4 * 60 * 60 * 1000; // 당일 04:00:00.000

  const sanitized = sanitizeWorkoutSnapshotForStorage({
    meetupName: '',
    players: params.players,
    courts: [],
    activeMatches: params.activeMatches,
    queuedMatches: params.queuedMatches,
    roundHistory: params.roundHistory,
    archivedPlayers: {},
    options: {
      mode: 'balanced',
      courtCount: 0,
      avoidConsecutiveRests: true,
      avoidDuplicatePartners: true,
    },
  });

  const { players, activeMatches, queuedMatches, roundHistory } = sanitized;
  const { fourAmState } = params;
  const hasAnyMatchesOrHistory =
    activeMatches.length > 0 || queuedMatches.length > 0 || roundHistory.length > 0;

  if (!hasAnyMatchesOrHistory) {
    return false;
  }

  // 이미 당일 00:00~04:00 사이 첫 운동 진행/배정 시작이 확인되어 면제 상태로 기록된 경우
  if (fourAmState?.earlyMorningBypassBoundaryKey === targetDateKey) {
    return true;
  }

  const collectMatchTimestamps = (m: CourtMatch): number[] => {
    const times: number[] = [];
    if (typeof m.startedAt === 'number' && m.startedAt > 0) {
      times.push(m.startedAt);
    }
    if (typeof m.completedAt === 'number' && m.completedAt > 0) {
      times.push(m.completedAt);
    }
    if (m.playerAssignedAt && typeof m.playerAssignedAt === 'object') {
      Object.values(m.playerAssignedAt).forEach((t) => {
        if (typeof t === 'number' && t > 0) times.push(t);
      });
    }
    return times;
  };

  // 1) 진행 중 코트(activeMatches) 또는 대기열(queuedMatches) 중 00:00 이전에 시작되어 넘어온 경기가 있는지 확인
  let hasActiveOrQueuedBeforeMidnight = false;
  let hasMatchAssignedOrStartedInEarlyWindow = false;

  const checkLiveMatch = (m: CourtMatch) => {
    const times = collectMatchTimestamps(m);
    if (times.length === 0) return;
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    if (minT < midnightMs) {
      hasActiveOrQueuedBeforeMidnight = true;
    }
    if (
      (minT >= midnightMs && minT < fourAmMs) ||
      (maxT >= midnightMs && maxT < fourAmMs)
    ) {
      hasMatchAssignedOrStartedInEarlyWindow = true;
    }
  };

  activeMatches.forEach((m) => {
    if (m.status !== 'completed') checkLiveMatch(m);
  });
  queuedMatches.forEach(checkLiveMatch);

  // 2) 대진기록(roundHistory) 확인
  let hasHistoryBeforeMidnight = false;
  roundHistory.forEach((r) => {
    (r.matches || []).forEach((m) => {
      const times = collectMatchTimestamps(m);
      if (times.length === 0) return;
      const minT = Math.min(...times);
      if (minT < midnightMs) {
        hasHistoryBeforeMidnight = true;
      }
      if (minT >= midnightMs && minT < fourAmMs) {
        hasMatchAssignedOrStartedInEarlyWindow = true;
      }
    });
  });

  // 3) 선수들의 첫 4명 배정 시작 시각(firstFourAssignedAt) 확인
  const firstFourTimes = players
    .map((p) => p.firstFourAssignedAt)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0);
  if (firstFourTimes.length > 0) {
    const earliestFirstFour = Math.min(...firstFourTimes);
    if (earliestFirstFour < midnightMs) {
      hasActiveOrQueuedBeforeMidnight = true;
    } else if (earliestFirstFour >= midnightMs && earliestFirstFour < fourAmMs) {
      hasMatchAssignedOrStartedInEarlyWindow = true;
    }
  }

  // 4) 현재 시각이 당일 00:00 ~ 04:00 사이이고, 00:00 이전부터 진행/대기/완료된 경기가 없는데
  //    새로 배정(queuedMatches) 또는 진행(activeMatches)이 시작된 경우
  const nowMs = now.getTime();
  const isNowInEarlyWindow = nowMs >= midnightMs && nowMs < fourAmMs;
  if (
    isNowInEarlyWindow &&
    !hasActiveOrQueuedBeforeMidnight &&
    !hasHistoryBeforeMidnight &&
    (activeMatches.length > 0 || queuedMatches.length > 0)
  ) {
    return true;
  }

  // 00:00 이전에 진행/대기/완료된 경기가 없는 상태에서 당일 00:00 ~ 04:00 사이에 첫 경기 배정/진행이 시작된 경우
  if (
    !hasActiveOrQueuedBeforeMidnight &&
    !hasHistoryBeforeMidnight &&
    hasMatchAssignedOrStartedInEarlyWindow
  ) {
    return true;
  }

  return false;
}

