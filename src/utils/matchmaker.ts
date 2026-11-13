import { Player, CourtMatch, MatchRound, MatchOptions, MatchmakingMode, Gender, Tier, TIER_SCORES, isPlayerLastMatchCompleted } from '../types';

/**
 * 선수의 참가자 명단 최초 등록 시각(밀리초 타임스탬프) 반환
 */
export function getPlayerBaseRegistrationTime(player: Player): number {
  return player.registeredAt ?? player.createdAt ?? 0;
}

/**
 * 선수의 참가자 명단 실시간 등록 시각(또는 휴식 해제 시각) 반환
 */
export function getPlayerRegistrationTime(player: Player): number {
  const baseTime = getPlayerBaseRegistrationTime(player);
  if (player.manualInterventionExempt) {
    return baseTime;
  }
  if (player.hasRested) {
    return Math.max(baseTime, player.restEndedAt ?? player.restStartedAt ?? baseTime);
  }
  return baseTime;
}

/**
 * 선수가 대기한 시각(마지막 완료 경기 종료 시각, 휴식 해제 시각, 또는 참가 등록 시각)으로부터
 * 현재(now)까지 몇 분 동안 대기했는지 계산하여 분 단위(숫자)로 반환
 */
export function getPlayerWaitingMinutes(
  player: Player,
  completedMatches: CourtMatch[] = [],
  now: number = Date.now()
): number {
  let lastActiveTime = 0;

  if (completedMatches && completedMatches.length > 0) {
    for (const m of completedMatches) {
      if (m.completedAt) {
        const isParticipant =
          m.teamA?.player1Id === player.id ||
          m.teamA?.player2Id === player.id ||
          m.teamB?.player1Id === player.id ||
          m.teamB?.player2Id === player.id;
        if (isParticipant && m.completedAt > lastActiveTime) {
          lastActiveTime = m.completedAt;
        }
      }
    }
  }

  if (player.restEndedAt && player.restEndedAt > lastActiveTime) {
    lastActiveTime = player.restEndedAt;
  }

  if (lastActiveTime === 0) {
    lastActiveTime = player.registeredAt || player.createdAt || now;
  }

  const diffMs = Math.max(0, now - lastActiveTime);
  return Math.floor(diffMs / 60000);
}

function getTimelineAnchorPlayers(players: Player[]): Player[] {
  return players.filter(
    (p) =>
      !p.attendancePending &&
      (p.specialStatus !== 'exited' ||
        (p.gamesPlayed || 0) > 0 ||
        (typeof p.firstFourAssignedAt === 'number' && p.firstFourAssignedAt > 0))
  );
}

/**
 * 활성 참가자 명단 중 가장 일찍 등록된 선수의 등록 시각 반환
 */
export function getEarliestRegistrationTime(players: Player[]): number {
  const valid = getTimelineAnchorPlayers(players);
  if (valid.length === 0) return Date.now();
  const nonRested = valid.filter((p) => !p.hasRested || p.manualInterventionExempt);
  const targetPool = nonRested.length > 0 ? nonRested : valid;
  return Math.min(...targetPool.map((p) => getPlayerBaseRegistrationTime(p)));
}

/**
 * 맨처음 등록된 4명의 선수들의 첫번째 배정/진행 시작 이후 지각 오프셋 산정이 시작되는 기준 경과 시간 (20분 = 1,200,000ms)
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작되기 전, 또는 시작 이후 20분 미만(< 20분)에 등록된 참가자는 지각 오프셋 0
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작된 이후 20분 경과 시점(>= 20분)부터 등록된 참가자는 지각 오프셋 시작 (최소 1 이상)
 */
export const FIRST_ASSIGN_LATE_OFFSET_START_MS = 20 * 60 * 1000;

/**
 * 지각 등록 선수 간 상대평가 단계 산정 기준 시간 간격 (30분 = 1,800,000ms)
 * - 첫 4명의 첫 배정/진행 시작 이후 20분 경과 시점부터 지각 오프셋(최소 1)이 시작되며,
 *   앞선 선수 대비 30분 간격 및 진행 단계 상대평가에 따라 오프셋 단계(+1, +2, ...) 누적 산정
 */
export const LATE_REGISTRATION_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 맨처음 등록된 4명의 선수들의 첫번째 배정(대기열/코트) 또는 진행(코트/완료)이 시작되었는지 판별합니다.
 * - 활성(미퇴장) 참가자가 최소 4명 이상이어야 하며,
 * - 등록 시간순 상위 4명(맨처음 등록된 4명의 선수들) 중 최소 1명 이상(일반적으로 첫 경기 4명)이
 *   진행 중 코트(activeMatches), 대기열(queuedMatches), 또는 완료 경기(gamesPlayed > 0)에 배정/진행된 경우 true를 반환합니다.
 */
export function hasFirstFourStartedAssignment(
  players: Player[],
  activeMatches: CourtMatch[] = [],
  queuedMatches: CourtMatch[] = []
): boolean {
  const valid = getTimelineAnchorPlayers(players);
  if (valid.length < 4) return false;

  const sortedByReg = [...valid]
    .map((p, idx) => ({ player: p, idx, regTime: getPlayerBaseRegistrationTime(p) }))
    .sort((a, b) => (a.regTime !== b.regTime ? a.regTime - b.regTime : a.idx - b.idx));

  const firstFour = sortedByReg.slice(0, 4).map((x) => x.player);

  const assignedOrPlayingIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) assignedOrPlayingIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) assignedOrPlayingIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) assignedOrPlayingIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) assignedOrPlayingIds.add(m.teamB.player2Id);
    }
  });
  queuedMatches.forEach((m) => {
    if (m.teamA?.player1Id) assignedOrPlayingIds.add(m.teamA.player1Id);
    if (m.teamA?.player2Id) assignedOrPlayingIds.add(m.teamA.player2Id);
    if (m.teamB?.player1Id) assignedOrPlayingIds.add(m.teamB.player1Id);
    if (m.teamB?.player2Id) assignedOrPlayingIds.add(m.teamB.player2Id);
  });

  return (
    firstFour.some(
      (p) => (p.gamesPlayed || 0) > 0 || assignedOrPlayingIds.has(p.id)
    ) ||
    valid.some(
      (p) =>
        (p.gamesPlayed || 0) > 0 ||
        assignedOrPlayingIds.has(p.id) ||
        (typeof p.firstFourAssignedAt === 'number' && p.firstFourAssignedAt > 0)
    )
  );
}

/**
 * 맨처음 등록된 4명의 선수들 중 첫 배정(대기열/코트) 또는 경기 진행이 시작된 기준 시각(타임스탬프)을 반환합니다.
 * 아직 첫 4명의 배정/진행이 시작되지 않았다면 null을 반환합니다.
 */
export function getFirstFourAssignmentStartTime(
  players: Player[],
  activeMatches: CourtMatch[] = [],
  queuedMatches: CourtMatch[] = [],
  hasFirstFourStartedOverride?: boolean
): number | null {
  const valid = getTimelineAnchorPlayers(players);
  if (valid.length < 4) return null;

  const sortedByReg = [...valid]
    .map((p, idx) => ({ player: p, idx, regTime: getPlayerBaseRegistrationTime(p) }))
    .sort((a, b) => (a.regTime !== b.regTime ? a.regTime - b.regTime : a.idx - b.idx));

  const firstFour = sortedByReg.slice(0, 4);
  const firstFourIds = new Set(firstFour.map((x) => x.player.id));
  const validIds = new Set(valid.map((p) => p.id));
  const firstFourMaxRegTime = Math.max(...firstFour.map((x) => x.regTime));

  const started =
    hasFirstFourStartedOverride !== undefined
      ? hasFirstFourStartedOverride
      : hasFirstFourStartedAssignment(valid, activeMatches, queuedMatches);

  if (!started) return null;

  // 1) 선수 데이터에 이미 기록된 첫 4명 배정 시작 시각(firstFourAssignedAt)이 있으면 최우선 사용
  const persistedTimes = valid
    .map((p) => p.firstFourAssignedAt)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0);
  if (persistedTimes.length > 0) {
    return Math.min(...persistedTimes);
  }

  // 2) 진행 중인 코트 경기 또는 대기열 경기 중 첫 4명(또는 출석 참가자)이 포함된 경기의 시작/배정 시각 확인
  const matchTimes: number[] = [];
  const anyValidMatchTimes: number[] = [];
  const collectMatchTime = (m: CourtMatch) => {
    const mPlayerIds = [
      m.teamA?.player1Id,
      m.teamA?.player2Id,
      m.teamB?.player1Id,
      m.teamB?.player2Id,
    ].filter(Boolean);
    const hasFirstFour = mPlayerIds.some((id) => firstFourIds.has(id));
    const hasAnyValid = mPlayerIds.some((id) => validIds.has(id));
    if (!hasFirstFour && !hasAnyValid) return;

    if (typeof m.startedAt === 'number' && m.startedAt > 0) {
      if (hasFirstFour) matchTimes.push(m.startedAt);
      if (hasAnyValid) anyValidMatchTimes.push(m.startedAt);
    }
    if (m.playerAssignedAt) {
      mPlayerIds.forEach((id) => {
        const t = m.playerAssignedAt?.[id];
        if (typeof t === 'number' && t > 0) {
          if (firstFourIds.has(id)) matchTimes.push(t);
          if (validIds.has(id)) anyValidMatchTimes.push(t);
        }
      });
    }
  };

  activeMatches.forEach((m) => {
    if (m.status !== 'completed') collectMatchTime(m);
  });
  queuedMatches.forEach((m) => collectMatchTime(m));

  if (matchTimes.length > 0) {
    return Math.max(firstFourMaxRegTime, Math.min(...matchTimes));
  }
  if (anyValidMatchTimes.length > 0) {
    return Math.min(...anyValidMatchTimes);
  }

  // 3) 첫 배정 시작 이전에 등록된 선수(registeredBeforeFirstAssign === true, 오프셋 0)가 명시되어 있는 경우,
  //    첫 배정 시작 시각은 최소한 그 선수들의 등록 시각 이후임
  const explicitPreAssignMaxTime = sortedByReg.reduce((maxT, item) => {
    if (
      item.player.registeredBeforeFirstAssign === true &&
      (item.player.gamesPlayed || 0) === 0 &&
      (item.player.initialAssignedOffset || 0) === 0
    ) {
      return Math.max(maxT, item.regTime);
    }
    return maxT;
  }, firstFourMaxRegTime);

  return explicitPreAssignMaxTime;
}

/**
 * 참가자 명단 내 모든 활성 선수들의 등록 순서/시각 및 맨처음 4명의 첫번째 배정/진행 시작 시각을 비교하여
 * 각 선수의 상대평가 지각 기준 오프셋(pureLateOffset 및 effectiveOffset)을 산출합니다.
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작되기 전, 또는 첫 배정/진행 시작 이후 20분 미만(< 20분)에 등록된 선수들은 지각 오프셋 0
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작된 이후 20분 경과 시점(>= 20분)부터 등록된 참가자는 지각 오프셋이 시작됨 (최소 1 이상)
 * - 앞선 선수보다 30분 이상 늦거나 앞선 오프셋 단계 선수의 배정/진행이 시작된 이후 등록된 선수는 상대평가 단계(+1, +2, ...)를 누적 산정
 */
export function computeRelativeLateOffsetMap(
  players: Player[],
  options?: {
    ignoreStoredWhenWithin30Min?: boolean;
    recalculatePureSteps?: boolean;
    hasFirstFourStarted?: boolean;
    firstFourStartedAt?: number | null;
    activeMatches?: CourtMatch[];
    queuedMatches?: CourtMatch[];
    rawAssignedMap?: Record<string, number>;
  }
): Record<string, number> {
  const valid = getTimelineAnchorPlayers(players);
  if (valid.length === 0) return {};

  const indexed = valid
    .map((p, idx) => ({
      player: p,
      idx,
      regTime: getPlayerBaseRegistrationTime(p),
    }))
    .sort((a, b) => {
      if (a.regTime !== b.regTime) return a.regTime - b.regTime;
      return a.idx - b.idx;
    });

  const pureLateOffsetMap: Record<string, number> = {};
  const effectiveOffsetMap: Record<string, number> = {};

  let firstFourStarted = false;
  if (options?.hasFirstFourStarted !== undefined) {
    firstFourStarted = options.hasFirstFourStarted;
  } else if (options?.activeMatches !== undefined || options?.queuedMatches !== undefined) {
    firstFourStarted = hasFirstFourStartedAssignment(
      valid,
      options?.activeMatches || [],
      options?.queuedMatches || []
    );
  } else if (indexed.length >= 4) {
    const firstFour = indexed.slice(0, 4).map((x) => x.player);
    firstFourStarted =
      firstFour.some(
        (p) => (options?.rawAssignedMap?.[p.id] ?? p.gamesPlayed ?? 0) > 0
      ) ||
      valid.some(
        (p) => typeof p.firstFourAssignedAt === 'number' && p.firstFourAssignedAt > 0
      ) ||
      indexed.some((x) => x.player.registeredBeforeFirstAssign === false) ||
      indexed
        .slice(4)
        .some(
          (x) =>
            x.player.registeredBeforeFirstAssign !== true &&
            !x.player.hasRested &&
            (x.player.initialAssignedOffset || 0) > 0
        );
  }

  const firstFourStartedAt = firstFourStarted
    ? (options?.firstFourStartedAt ??
        getFirstFourAssignmentStartTime(
          valid,
          options?.activeMatches || [],
          options?.queuedMatches || [],
          true
        ) ??
        Math.max(...indexed.slice(0, Math.min(4, indexed.length)).map((x) => x.regTime)))
    : null;

  for (let k = 0; k < indexed.length; k++) {
    const { player: p, regTime: tk } = indexed[k];
    const rawStoredOffset = Math.max(0, p.initialAssignedOffset || 0);

    // 맨처음 등록된 4명의 선수들의 첫번째 배정/진행 시작 이전이거나,
    // 첫 배정/진행 시작 시각(firstFourStartedAt)으로부터 20분 미만(< 20분) 이내에 등록된 선수인지 판별
    let isPreLateStartPlayer = false;
    if (!firstFourStarted || firstFourStartedAt === null) {
      isPreLateStartPlayer = true;
    } else if (k < 4) {
      // 맨처음 등록된 4명의 선수들은 지각 오프셋 0 고정
      isPreLateStartPlayer = true;
    } else if (tk - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS) {
      // 첫 4명의 첫 배정/진행 시작 이전이거나 시작 이후 20분이 아직 경과하지 않은 시점(< 20분)에 등록된 참가자는 지각 오프셋 0
      isPreLateStartPlayer = true;
    }

    if (isPreLateStartPlayer) {
      pureLateOffsetMap[p.id] = 0;
      if (p.manualInterventionExempt) {
        effectiveOffsetMap[p.id] = rawStoredOffset;
      } else if (p.hasRested) {
        effectiveOffsetMap[p.id] = Math.max(1, rawStoredOffset);
      } else {
        effectiveOffsetMap[p.id] = 0;
      }
      continue;
    }

    // 맨처음 등록된 4명의 첫번째 배정/진행 시작 이후 20분 이상(>= 20분) 경과 후 등록된 참가자:
    // 지각 기준 오프셋이 최소 1부터 시작하며, 첫 배정 시작 시각 및 앞선 모든 등록 선수(0 <= i < k)와의 30분 간격을 상대평가하여 누적 산정
    let relativeStepOffset = Math.max(
      1,
      Math.floor((tk - firstFourStartedAt!) / LATE_REGISTRATION_INTERVAL_MS)
    );
    for (let i = 0; i < k; i++) {
      const prev = indexed[i];
      if (prev.player.manualInterventionExempt) continue;
      const prevBaseOffset = pureLateOffsetMap[prev.player.id] ?? 0;
      const prevRefTime =
        prevBaseOffset === 0
          ? Math.max(prev.regTime, firstFourStartedAt!)
          : prev.regTime;
      const diffMs = tk - prevRefTime;
      if (diffMs >= LATE_REGISTRATION_INTERVAL_MS) {
        const steps = Math.max(1, Math.floor(diffMs / LATE_REGISTRATION_INTERVAL_MS));
        relativeStepOffset = Math.max(relativeStepOffset, prevBaseOffset + steps);
      }
    }

    let storedLateOffset = 1;
    if (!p.hasRested) {
      if (options?.recalculatePureSteps) {
        // 선수 삭제 등으로 재산정할 때: 앞선 남은 선수들의 진행/배정 단계가 지지할 수 있는 최대 오프셋 범위 내로 보정
        let maxSupportedOffset = relativeStepOffset;
        for (let i = 0; i < k; i++) {
          const prev = indexed[i];
          if (prev.player.manualInterventionExempt) continue;
          const prevOffset = pureLateOffsetMap[prev.player.id] ?? 0;
          const prevRaw =
            options?.rawAssignedMap?.[prev.player.id] ?? (prev.player.gamesPlayed || 0);
          if (prevRaw > 0) {
            maxSupportedOffset = Math.max(
              maxSupportedOffset,
              prevOffset + 1,
              prevRaw + prevOffset - 1
            );
          }
        }
        storedLateOffset =
          (p.gamesPlayed || 0) > 0
            ? Math.max(1, rawStoredOffset)
            : Math.min(Math.max(1, rawStoredOffset), maxSupportedOffset);
      } else {
        storedLateOffset = Math.max(1, rawStoredOffset);
      }
    }

    const pureLateOffset = Math.max(1, relativeStepOffset, storedLateOffset);
    pureLateOffsetMap[p.id] = pureLateOffset;

    if (p.manualInterventionExempt) {
      effectiveOffsetMap[p.id] = rawStoredOffset;
    } else if (p.hasRested) {
      effectiveOffsetMap[p.id] = Math.max(1, rawStoredOffset, pureLateOffset);
    } else {
      effectiveOffsetMap[p.id] = pureLateOffset;
    }
  }

  return effectiveOffsetMap;
}

/**
 * 해당 선수가 맨처음 등록된 4명의 첫번째 배정/진행 시작 이후 20분 경과 후 등록된(지각 등록) 선수이거나 휴식(부채꼴 메뉴) 후 복귀한 선수인지 판별.
 * 단, 사용자가 선수교체·대기열배정·코트에배정 등으로 배정/진행에 임의 관여한 선수(manualInterventionExempt)는
 * 동등 도달 방지 및 연속 투입 차단 기능으로 인해 배정/진행이 밀리지 않도록 제외합니다.
 */
export function isLateRegisteredPlayer(
  player: Player,
  earliestTimeOrRoster?: number | Player[]
): boolean {
  if (player.manualInterventionExempt) return false;
  if (player.hasRested) return true;
  if (Array.isArray(earliestTimeOrRoster)) {
    const offsetMap = computeRelativeLateOffsetMap(earliestTimeOrRoster);
    if (offsetMap[player.id] !== undefined) {
      return offsetMap[player.id] > 0;
    }
  }
  if (player.registeredBeforeFirstAssign === true) return false;
  if (player.registeredBeforeFirstAssign === false) return true;
  return (player.initialAssignedOffset || 0) > 0;
}

/**
 * 선수의 상대평가 지각 등록 또는 휴식 복귀 보정 오프셋(initialAssignedOffset) 반환
 */
export function getPlayerEffectiveOffset(
  player: Player,
  earliestTimeOrRoster?: number | Player[]
): number {
  if (player.manualInterventionExempt) {
    return Math.max(0, player.initialAssignedOffset || 0);
  }
  if (Array.isArray(earliestTimeOrRoster)) {
    const offsetMap = computeRelativeLateOffsetMap(earliestTimeOrRoster);
    if (offsetMap[player.id] !== undefined) {
      return offsetMap[player.id];
    }
  }
  if (player.hasRested) {
    return Math.max(1, player.initialAssignedOffset || 0);
  }
  if (player.registeredBeforeFirstAssign === true) {
    return 0;
  }
  if (player.registeredBeforeFirstAssign === false) {
    return Math.max(1, player.initialAssignedOffset || 1);
  }
  if ((player.initialAssignedOffset || 0) > 0) {
    return player.initialAssignedOffset!;
  }
  return 0;
}

/**
 * 참가자 명단에 신규 선수가 등록될 때,
 * 맨처음 등록된 4명의 선수들의 첫번째 배정/진행 시작 시각으로부터 20분 경과 여부 및 기존 선수들과의 상대평가(30분 간격 및 진행 단계)를 통해
 * 지각 등록 선수의 기준 오프셋(initialAssignedOffset)을 자동 산출합니다.
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작되기 전, 또는 시작 이후 20분 미만(< 20분)에 등록되는 참가자는 지각 오프셋 0
 * - 맨처음 등록된 4명의 선수들의 첫번째 배정/진행이 시작된 이후 20분 경과 시점(>= 20분)부터 등록되는 참가자는 지각 오프셋 시작 (최소 1 이상)
 * - 앞선 선수들 대비 30분 이상 늦거나 앞선 오프셋 그룹의 배정/진행이 시작된 이후 등록되면 상대평가로 기준 오프셋 자동 산정 (+1, +2, ...)
 */
export function computeLateArrivalOffset(
  existingPlayers: Player[],
  activeMatches: CourtMatch[] = [],
  queuedMatches: CourtMatch[] = [],
  newPlayerGender?: Gender,
  now: number = Date.now()
): number {
  const activeExisting = getTimelineAnchorPlayers(existingPlayers);
  if (activeExisting.length < 4) return 0;

  // 맨처음 등록된 4명의 선수들의 첫번째 배정/진행 시작 시각 확인
  const firstFourStartedAt = getFirstFourAssignmentStartTime(
    activeExisting,
    activeMatches,
    queuedMatches
  );

  // 첫 4명의 첫 배정/진행이 아직 시작되지 않았거나, 시작된 지 20분 미만(< 20분)이면 지각 오프셋 0 반환
  if (
    firstFourStartedAt === null ||
    now - firstFourStartedAt < FIRST_ASSIGN_LATE_OFFSET_START_MS
  ) {
    return 0;
  }

  const activeCourtIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });

  const rawAssignedMap: Record<string, number> = {};
  activeExisting.forEach((p) => {
    const inCourt = activeCourtIds.has(p.id) ? 1 : 0;
    const inQueue = queuedMatches.filter(
      (m) =>
        m.teamA?.player1Id === p.id ||
        m.teamA?.player2Id === p.id ||
        m.teamB?.player1Id === p.id ||
        m.teamB?.player2Id === p.id
    ).length;
    rawAssignedMap[p.id] = (p.gamesPlayed || 0) + inCourt + inQueue;
  });

  const relativeOffsetMap = computeRelativeLateOffsetMap(activeExisting, {
    hasFirstFourStarted: true,
    firstFourStartedAt,
    rawAssignedMap,
  });

  // 시간순 정렬된 기존 선수 목록
  const sortedExisting = [...activeExisting].sort(
    (a, b) => getPlayerBaseRegistrationTime(a) - getPlayerBaseRegistrationTime(b)
  );

  // 1) 맨처음 4명의 첫번째 배정/진행 시작 이후 20분 이상 경과 후 등록이므로 기본 지각 오프셋은 최소 1부터 시작하며,
  //    첫 배정 시작 시각 및 30분(LATE_REGISTRATION_INTERVAL_MS) 이상 앞선 선행 선수들과의 상대 시간 단계 오프셋 산정
  let maxRelativeStepOffset = Math.max(
    1,
    Math.floor((now - firstFourStartedAt) / LATE_REGISTRATION_INTERVAL_MS)
  );
  for (const prev of sortedExisting) {
    if (prev.manualInterventionExempt) continue;
    const prevBaseOffset = prev.hasRested ? 0 : (relativeOffsetMap[prev.id] ?? 0);
    const prevRefTime =
      prevBaseOffset === 0
        ? Math.max(getPlayerBaseRegistrationTime(prev), firstFourStartedAt)
        : getPlayerBaseRegistrationTime(prev);
    const diffMs = now - prevRefTime;
    if (diffMs >= LATE_REGISTRATION_INTERVAL_MS) {
      const steps = Math.max(1, Math.floor(diffMs / LATE_REGISTRATION_INTERVAL_MS));
      maxRelativeStepOffset = Math.max(maxRelativeStepOffset, prevBaseOffset + steps);
    }
  }

  // 2) 선행 선수 그룹들의 실제 배정/진행 단계와 상대 비교하여 기준 오프셋 산정
  const predStats = sortedExisting
    .filter((p) => !p.manualInterventionExempt)
    .map((p) => {
      const rawAssigned = rawAssignedMap[p.id] ?? 0;
      const offset = prevOffsetForStats(p, relativeOffsetMap);
      const effAssigned = rawAssigned + offset;
      const refTime =
        offset === 0
          ? Math.max(getPlayerBaseRegistrationTime(p), firstFourStartedAt)
          : getPlayerBaseRegistrationTime(p);
      const diffMs = now - refTime;
      const stepsFromPrev =
        diffMs >= LATE_REGISTRATION_INTERVAL_MS
          ? Math.max(1, Math.floor(diffMs / LATE_REGISTRATION_INTERVAL_MS))
          : 0;
      return { player: p, rawAssigned, offset, effAssigned, stepsFromPrev };
    });

  let progressOffset = 1;
  const distinctTiers = Array.from(new Set(predStats.map((s) => s.offset))).sort((a, b) => a - b);
  for (const tierVal of distinctTiers) {
    const tierAll = predStats.filter((s) => s.offset === tierVal);
    const tierHasStarted = tierAll.some((s) => s.rawAssigned > 0);
    const maxStepsFromTier = Math.max(0, ...tierAll.map((s) => s.stepsFromPrev));

    if (tierHasStarted) {
      const tierSameGender = newPlayerGender
        ? tierAll.filter((s) => s.player.gender === newPlayerGender && s.rawAssigned > 0)
        : [];
      const refGroup =
        tierSameGender.length > 0
          ? tierSameGender
          : tierAll.filter((s) => s.rawAssigned > 0);

      const minEff = Math.min(...refGroup.map((s) => s.effAssigned));
      const avgEff = refGroup.reduce((sum, s) => sum + s.effAssigned, 0) / refGroup.length;
      const refLevel = Math.max(minEff, Math.floor(avgEff));

      // 해당 선행 단계(tierVal)의 배정/진행이 이미 시작된 이후 30분 경과 후 등록된 선수이므로 최소 tierVal + 1 보장
      const tierProgressOffset = Math.max(
        tierVal + Math.max(1, maxStepsFromTier),
        refLevel >= 2 ? refLevel - 1 : tierVal + 1
      );
      progressOffset = Math.max(progressOffset, tierProgressOffset);
    } else if (maxStepsFromTier >= 1) {
      progressOffset = Math.max(progressOffset, tierVal + maxStepsFromTier);
    }
  }

  return Math.max(1, maxRelativeStepOffset, progressOffset);
}

function prevOffsetForStats(player: Player, relativeOffsetMap: Record<string, number>): number {
  if (player.hasRested) return 0;
  return relativeOffsetMap[player.id] ?? 0;
}

/**
 * 참가자 명단 추가/삭제/동기화 및 경기 배정/진행 상태 변경 시 전체 참가자의 지각 등록 기준 오프셋을
 * 맨처음 4명의 첫번째 배정/진행 시작 이후 20분 경과 기준 및 상대평가 기준에 맞춰 일괄 재산정하여 반환합니다.
 */
export function recalculateRelativeLateOffsets(
  players: Player[],
  activeMatches: CourtMatch[] = [],
  queuedMatches: CourtMatch[] = []
): Player[] {
  if (players.length === 0) return players;

  const firstFourStarted = hasFirstFourStartedAssignment(players, activeMatches, queuedMatches);

  // 아직 맨처음 등록된 4명의 첫번째 배정/진행이 시작되지 않은 경우:
  // 현재까지 등록된 모든 참가자는 초기 참가자(registeredBeforeFirstAssign = true, 지각 오프셋 0, firstFourAssignedAt 초기화)로 설정
  if (!firstFourStarted) {
    return players.map((p) => {
      if (p.attendancePending || p.specialStatus === 'exited') {
        return p;
      }
      if (p.manualInterventionExempt || p.hasRested) {
        if (p.firstFourAssignedAt === undefined) return p;
        return { ...p, firstFourAssignedAt: undefined };
      }
      if (
        (p.initialAssignedOffset ?? 0) === 0 &&
        p.registeredBeforeFirstAssign === true &&
        p.firstFourAssignedAt === undefined
      ) {
        return p;
      }
      return {
        ...p,
        initialAssignedOffset: 0,
        registeredBeforeFirstAssign: true,
        firstFourAssignedAt: undefined,
      };
    });
  }

  const firstFourStartedAt =
    getFirstFourAssignmentStartTime(players, activeMatches, queuedMatches, true) ?? Date.now();

  const activeCourtIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });

  const rawAssignedMap: Record<string, number> = {};
  players.forEach((p) => {
    if (p.attendancePending) return;
    const inCourt = activeCourtIds.has(p.id) ? 1 : 0;
    const inQueue = queuedMatches.filter(
      (m) =>
        m.teamA?.player1Id === p.id ||
        m.teamA?.player2Id === p.id ||
        m.teamB?.player1Id === p.id ||
        m.teamB?.player2Id === p.id
    ).length;
    rawAssignedMap[p.id] = (p.gamesPlayed || 0) + inCourt + inQueue;
  });

  const relativeMap = computeRelativeLateOffsetMap(players, {
    hasFirstFourStarted: true,
    firstFourStartedAt,
    rawAssignedMap,
    recalculatePureSteps: true,
  });

  return players.map((p) => {
    if (p.attendancePending || p.specialStatus === 'exited') {
      return p;
    }
    if (p.manualInterventionExempt || p.hasRested) {
      if (p.firstFourAssignedAt === firstFourStartedAt) return p;
      return {
        ...p,
        firstFourAssignedAt: firstFourStartedAt,
      };
    }
    const nextOffset = relativeMap[p.id] ?? 0;
    const nextBeforeFirstAssign = nextOffset === 0;
    if (
      (p.initialAssignedOffset ?? 0) === nextOffset &&
      p.registeredBeforeFirstAssign === nextBeforeFirstAssign &&
      p.firstFourAssignedAt === firstFourStartedAt
    ) {
      return p;
    }
    return {
      ...p,
      initialAssignedOffset: nextOffset,
      registeredBeforeFirstAssign: nextBeforeFirstAssign,
      firstFourAssignedAt: firstFourStartedAt,
    };
  });
}

/**
 * 부채꼴 메뉴에서 선수에게 [휴식]이 선택되거나 해제될 때,
 * 휴식 없이 정상 참여 중인 선수들과 동일한 진행/배정 수에 도달하지 않고
 * 휴식 해제 후 격차를 메우기 위해 연속 경기에 투입되는 현상을 차단하기 위한 보정 오프셋을 산출합니다.
 */
export function computeRestReturnOffset(
  targetPlayer: Player,
  allPlayers: Player[],
  activeMatches: CourtMatch[] = [],
  queuedMatches: CourtMatch[] = []
): number {
  const activeCourtIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });

  const getRawAssigned = (p: Player): number => {
    const inCourt = activeCourtIds.has(p.id) ? 1 : 0;
    const inQueue = queuedMatches.filter(
      (m) =>
        m.teamA?.player1Id === p.id ||
        m.teamA?.player2Id === p.id ||
        m.teamB?.player1Id === p.id ||
        m.teamB?.player2Id === p.id
    ).length;
    return (p.gamesPlayed || 0) + inCourt + inQueue;
  };

  const myRaw = getRawAssigned(targetPlayer);
  const peers = allPlayers.filter(
    (p) =>
      p.id !== targetPlayer.id &&
      p.isActive !== false &&
      !p.attendancePending &&
      !isPlayerLastMatchCompleted(p) &&
      p.specialStatus !== 'resting' &&
      p.specialStatus !== 'lesson'
  );

  if (peers.length === 0) {
    return Math.max(0, targetPlayer.initialAssignedOffset || 0);
  }

  const contEarlyPeers = peers.filter(
    (p) => !p.hasRested && !isLateRegisteredPlayer(p, allPlayers)
  );
  const sameGenderContEarly = contEarlyPeers.filter((p) => p.gender === targetPlayer.gender);
  const sameGenderPeers = peers.filter((p) => p.gender === targetPlayer.gender);

  const refGroup =
    sameGenderContEarly.length > 0
      ? sameGenderContEarly
      : contEarlyPeers.length > 0
      ? contEarlyPeers
      : sameGenderPeers.length > 0
      ? sameGenderPeers
      : peers;

  const peerRaws = refGroup.map((p) => getRawAssigned(p));
  const maxPeerRaw = Math.max(...peerRaws);

  // 휴식 중 동료 선수들과 배정/진행 격차가 전혀 발생하지 않은 경우(실수로 휴식 클릭 후 즉시 해제 등) 불필요한 오프셋 부과 방지
  if (maxPeerRaw <= myRaw) {
    return Math.max(0, targetPlayer.initialAssignedOffset || 0);
  }

  const minPeerRaw = Math.min(...peerRaws);
  const avgPeerRaw = peerRaws.reduce((sum, r) => sum + r, 0) / peerRaws.length;
  const refLevel = Math.max(minPeerRaw, Math.floor(avgPeerRaw));

  const gap = Math.max(0, refLevel - myRaw);
  const gapOffset = gap >= 2 ? gap - 1 : 1;

  return Math.max(1, targetPlayer.initialAssignedOffset || 0, gapOffset);
}

/**
 * 사용자가 임의로 선수교체, 대기열배정, 코트에배정 등으로 특정 선수의 배정/진행에 관여했을 때,
 * "동등한 진행/배정 수 도달 방지 및 연속 경기 투입 차단 기능" 때문에 해당 선수(또는 교체된 선수)의
 * 이후 배정/진행이 밀리지 않도록 오프셋 및 상태를 정밀 보정하는 헬퍼 함수.
 */
export function reconcileManualPlayerIntervention(
  allPlayers: Player[],
  intervenedPlayerIds: Iterable<string>,
  nextActiveMatches: CourtMatch[] = [],
  nextQueuedMatches: CourtMatch[] = [],
  swappedOutToBenchIds: Iterable<string> = []
): Player[] {
  const intervenedSet = new Set(Array.from(intervenedPlayerIds).filter(Boolean));
  const swappedOutSet = new Set(Array.from(swappedOutToBenchIds).filter(Boolean));
  swappedOutSet.forEach((id) => intervenedSet.add(id));

  if (intervenedSet.size === 0) return allPlayers;

  const activeCourtIds = new Set<string>();
  nextActiveMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });

  const queuedCountMap: Record<string, number> = {};
  nextQueuedMatches.forEach((m) => {
    [m.teamA?.player1Id, m.teamA?.player2Id, m.teamB?.player1Id, m.teamB?.player2Id].forEach(
      (id) => {
        if (id) queuedCountMap[id] = (queuedCountMap[id] || 0) + 1;
      }
    );
  });

  const getRawAssigned = (p: Player): number => {
    const inCourt = activeCourtIds.has(p.id) ? 1 : 0;
    const inQueue = queuedCountMap[p.id] || 0;
    return (p.gamesPlayed || 0) + inCourt + inQueue;
  };

  const eligibleActive = allPlayers.filter(
    (p) =>
      p.isActive &&
      !p.attendancePending &&
      p.specialStatus !== 'exited' &&
      p.specialStatus !== 'resting' &&
      p.specialStatus !== 'lesson'
  );

  return allPlayers.map((p) => {
    // 현재 휴식중·레슨중·퇴장·미출석 상태인 선수가 코트/대기열에서 벤치로 빠진 경우 수동 관여 면제(manualInterventionExempt)로 처리하지 않음
    if (
      p.attendancePending ||
      p.specialStatus === 'resting' ||
      p.specialStatus === 'lesson' ||
      p.specialStatus === 'exited' ||
      isPlayerLastMatchCompleted(p)
    ) {
      return p;
    }

    const isIntervened = intervenedSet.has(p.id);
    if (!isIntervened && !p.manualInterventionExempt) {
      return p;
    }

    const myRaw = getRawAssigned(p);
    const sameGenderPeers = eligibleActive.filter(
      (other) => other.id !== p.id && other.gender === p.gender && !swappedOutSet.has(other.id)
    );
    const allPeers = eligibleActive.filter(
      (other) => other.id !== p.id && !swappedOutSet.has(other.id)
    );
    const peerPool = sameGenderPeers.length > 0 ? sameGenderPeers : allPeers;

    let refPeerRaw = myRaw;
    if (peerPool.length > 0) {
      const sortedPeerRaws = peerPool.map((peer) => getRawAssigned(peer)).sort((a, b) => a - b);
      const q25Idx = Math.floor((sortedPeerRaws.length - 1) * 0.25);
      const q25Raw = sortedPeerRaws[q25Idx];
      const minPeerRaw = sortedPeerRaws[0];
      refPeerRaw = Math.min(q25Raw, minPeerRaw + 1);
    }

    const targetOffsetCap = Math.max(0, refPeerRaw - myRaw);
    const prevOffset = p.initialAssignedOffset || 0;

    if (!isIntervened && p.manualInterventionExempt) {
      const cappedOffset = Math.max(0, Math.min(prevOffset, targetOffsetCap));
      if (cappedOffset === prevOffset) return p;
      return {
        ...p,
        initialAssignedOffset: cappedOffset,
      };
    }

    // 수동 관여 대상 선수:
    // 1) 기존 지각/휴식 오프셋을 최소 1 차감하고, (myRaw + nextOffset)이 동료 기준치(refPeerRaw)를 절대 넘지 않도록 캡핑
    const nextOffset = Math.max(0, Math.min(Math.max(0, prevOffset - 1), targetOffsetCap));

    // 2) 코트에 투입된 선수는 연속 휴식 라운드를 0으로, 코트/대기열에서 벤치로 빠진 선수는 휴식 라운드를 최소 1 이상으로 보장하여
    //    다음 자동 배정 시 방금 경기를 마친 선수로 오인되어 순번이 밀리는 현상 방지
    let nextConsecutiveRests = p.consecutiveRestRounds || 0;
    if (activeCourtIds.has(p.id)) {
      nextConsecutiveRests = 0;
    } else if (swappedOutSet.has(p.id)) {
      nextConsecutiveRests = Math.max(1, (p.consecutiveRestRounds || 0) + 1);
    }

    return {
      ...p,
      manualInterventionExempt: true,
      initialAssignedOffset: nextOffset,
      consecutiveRestRounds: nextConsecutiveRests,
      restStartGamesPlayed: p.gamesPlayed || 0,
    };
  });
}

/**
 * 매치메이킹 우선순위 산출용 실효 배정 수(Effective Assigned Count) 계산 (다단계 상대평가 반영):
 * - 앞선 단계에 등록된 선수(offset T)가 30분 이상 늦게 등록된 후발 선수(offset > T)보다 항상 우선 배정되고 더 많은 총 게임 수를 유지하도록 보정
 * - 1번째 선수 대비 30분 지각자(offset 1), 2번째 선수 대비 30분 지각자(offset 2) 등 각 단계별 지각자가
 *   자신보다 일찍 온 모든 선행 단계 선수들과 동등한 배정/진행 수에 도달하려 하거나 연속 배정되는 현상을 엄격히 차단
 * - 단, 사용자가 선수교체·대기열배정·코트에배정 등으로 임의 관여한 선수(manualInterventionExempt)는 밀림 없이 정상 순환
 */
export function computeEffectiveAssignedMap(
  candidates: Player[],
  rawAssignedMap: Record<string, number> = {},
  recentOrActivePlayerIds: Set<string> = new Set(),
  allRosterPlayers?: Player[]
): Record<string, number> {
  const roster = allRosterPlayers && allRosterPlayers.length > 0 ? allRosterPlayers : candidates;
  const relativeOffsetMap = computeRelativeLateOffsetMap(roster, { rawAssignedMap });

  // 등록 시간 오름차순 순번 (동점 시 일찍 등록된 선수 우선 배정용 미세 가중치)
  const sortedByReg = [...roster].sort(
    (a, b) => getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b)
  );
  const regOrderMap: Record<string, number> = {};
  sortedByReg.forEach((p, idx) => {
    regOrderMap[p.id] = idx * 0.0001;
  });

  // 오프셋 단계(tier) 및 성별별 활성 선수 분류 (다단계 상대평가용)
  const eligibleRoster = roster.filter(
    (p) => isPlayerEligibleForMatchmaking(p) && !p.manualInterventionExempt
  );
  const distinctOffsets = Array.from(
    new Set(eligibleRoster.map((p) => relativeOffsetMap[p.id] ?? getPlayerEffectiveOffset(p, roster)))
  ).sort((a, b) => a - b);

  const result: Record<string, number> = {};

  candidates.forEach((p) => {
    const raw = rawAssignedMap[p.id] ?? p.gamesPlayed ?? 0;
    const offset = relativeOffsetMap[p.id] ?? getPlayerEffectiveOffset(p, roster);
    const regTieBreaker = regOrderMap[p.id] ?? 0;

    if (p.manualInterventionExempt || offset === 0) {
      // 초기 등록 선수(offset === 0) 또는 사용자가 수동으로 배정/교체에 관여한 선수:
      // 동등 도달 방지/연속 투입 차단 페널티 없이 정상 회전 보장
      const totalAssigned = raw + offset;
      const baseEff = p.tier === 'S' ? totalAssigned * 0.65 : totalAssigned;
      result[p.id] = baseEff + regTieBreaker;
    } else {
      // 맨처음 4명의 첫 배정/진행 시작 이후에 지각 등록되었거나 휴식 후 복귀한 선수 (수동 관여 없음):
      // 1) 기본 실효 배정 수 = 실제 배정 수 + 상대평가 오프셋 + 단계별 미세 가중치 (동일 실효 수에서도 앞선 단계 선수가 우선)
      let eff = raw + offset + Math.min(offset, 6) * 0.15 + regTieBreaker;

      // 2) 자신보다 앞선 모든 등록 단계(tierOffset < offset) 선수들과 상대 비교하여
      //    선행 단계 선수들과 동일한 진행/배정 수에 도달하거나 역전하는 현상을 단계별로 차단
      for (const tierOffset of distinctOffsets) {
        if (tierOffset >= offset) break;

        const tierAll = eligibleRoster.filter(
          (e) => (relativeOffsetMap[e.id] ?? getPlayerEffectiveOffset(e, roster)) === tierOffset
        );
        const tierSameGender = tierAll.filter((e) => e.gender === p.gender);
        const refPeers = tierSameGender.length > 0 ? tierSameGender : tierAll;

        if (refPeers.length > 0) {
          const peerRaws = refPeers.map((e) => rawAssignedMap[e.id] ?? e.gamesPlayed ?? 0);
          const maxTierRaw = Math.max(...peerRaws);
          const minTierRaw = Math.min(...peerRaws);
          const tierGap = Math.max(1, offset - tierOffset);

          const peersAtOrBelowNext = refPeers.filter(
            (e) => (rawAssignedMap[e.id] ?? e.gamesPlayed ?? 0) <= raw + 1
          );
          const busyPeersAtMin = peersAtOrBelowNext.filter((e) => recentOrActivePlayerIds.has(e.id));

          if (maxTierRaw > 0 && raw + 1 > maxTierRaw) {
            // 후발 선수가 선행 단계 그룹의 최고 배정 수를 초과하려는 경우 강력 지연
            eff = Math.max(eff, maxTierRaw + offset + 1.15 + regTieBreaker);
          } else if (
            maxTierRaw > 0 &&
            raw + tierGap > maxTierRaw &&
            (peersAtOrBelowNext.length >= 2 || busyPeersAtMin.length > 0)
          ) {
            // 선행 단계 그룹 대비 상대 오프셋 격차(tierGap)를 무너뜨리며 동률/추격하려는 경우 지연
            eff = Math.max(eff, maxTierRaw + tierOffset + 1.15 + regTieBreaker);
          } else if (minTierRaw === 0 && raw + 1 > minTierRaw && peersAtOrBelowNext.length >= 4) {
            // 선행 단계에 아직 1경기가 안 된 대기자가 4명 이상 남아 있을 때 지연
            eff = Math.max(eff, minTierRaw + offset + 1.15 + regTieBreaker);
          }
        }
      }

      // 3) 지각 등록 선수의 연속 게임 투입 방지:
      //    직전 경기(또는 현재 코트/웨이브)에 방금 포함된 지각 선수는 연속 배정되지 않도록 페널티 부여
      if (recentOrActivePlayerIds.has(p.id)) {
        eff += 1.5;
      }

      result[p.id] = eff;
    }
  });

  return result;
}

/**
 * 후보 4명 조합 내에 지각 등록 선수가 포함되어 있을 때,
 * 이번 경기 배정 결과로 인해 지각 등록 선수의 총 배정/진행 수가
 * 자신보다 앞선 등록 단계(맨처음 4명의 첫 배정/진행 전 그룹, 1차 지각 그룹 등) 선수의 배정/진행 수와 같아지거나 많아지는지(상대평가 역전/동률 위반) 검사하여 페널티 점수를 반환합니다.
 * 단, 사용자가 임의로 선수교체·대기열배정·코트에배정 등으로 관여한 선수(manualInterventionExempt)는 페널티에서 제외됩니다.
 */
export function getLatePlayerEqualizationPenalty(
  fourPlayers: Player[],
  allGenderOrActivePlayers: Player[],
  rawAssignedMap: Record<string, number> = {},
  _earliestTime?: number,
  recentPlayerIds?: Set<string>
): number {
  const relativeOffsetMap = computeRelativeLateOffsetMap(allGenderOrActivePlayers, {
    rawAssignedMap,
  });

  let violationCount = 0;
  const fourIds = new Set(fourPlayers.map((p) => p.id));

  const eligiblePool = allGenderOrActivePlayers.filter(
    (e) => isPlayerEligibleForMatchmaking(e) && !e.manualInterventionExempt
  );
  const distinctTiers = Array.from(
    new Set(
      eligiblePool.map(
        (e) => relativeOffsetMap[e.id] ?? getPlayerEffectiveOffset(e, allGenderOrActivePlayers)
      )
    )
  ).sort((a, b) => a - b);

  for (const p of fourPlayers) {
    if (p.manualInterventionExempt) continue;
    const pOffset =
      relativeOffsetMap[p.id] ?? getPlayerEffectiveOffset(p, allGenderOrActivePlayers);
    if (pOffset <= 0 && !isLateRegisteredPlayer(p, allGenderOrActivePlayers)) continue;

    // 직전 경기/웨이브에 방금 투입되었거나 방금 코트 경기를 마친 지각/휴식복귀 선수의 연속 경기 배정 차단
    if (recentPlayerIds && recentPlayerIds.has(p.id)) {
      violationCount += 2;
    }

    const pCurRaw = rawAssignedMap[p.id] ?? p.gamesPlayed ?? 0;
    const pNewRaw = pCurRaw + 1;

    // 자신보다 앞선 모든 오프셋 단계(tierOffset < pOffset)의 활성 선수들과 다단계 상대 비교
    for (const tierOffset of distinctTiers) {
      if (tierOffset >= pOffset) break;

      const sameGenderTierPeers = eligiblePool.filter(
        (e) =>
          e.gender === p.gender &&
          !e.hasRested &&
          (relativeOffsetMap[e.id] ?? getPlayerEffectiveOffset(e, allGenderOrActivePlayers)) ===
            tierOffset
      );
      const targetTierPeers =
        sameGenderTierPeers.length > 0
          ? sameGenderTierPeers
          : eligiblePool.filter(
              (e) =>
                !e.hasRested &&
                (relativeOffsetMap[e.id] ??
                  getPlayerEffectiveOffset(e, allGenderOrActivePlayers)) === tierOffset
            );

      if (targetTierPeers.length > 0) {
        const tierNewRaws = targetTierPeers.map(
          (e) => (rawAssignedMap[e.id] ?? e.gamesPlayed ?? 0) + (fourIds.has(e.id) ? 1 : 0)
        );
        const maxTierNewRaw = Math.max(...tierNewRaws);
        const tierGap = Math.max(1, pOffset - tierOffset);

        // 1) 앞선 단계(tierOffset) 선수 그룹 대비 상대 오프셋 격차(tierGap)를 무너뜨리며 같아지거나 역전하는 경우 위반
        if (pNewRaw + tierGap - 1 >= maxTierNewRaw) {
          violationCount += 2;
        }

        // 2) 이번 매치 밖에서 대기 중인 앞선 단계 선수들 중 아직 pCurRaw 이하인 가용 선수가 남아 있는데
        //    후발 단계 선수가 먼저 앞서 나가려는 경우 위반
        const unpickedAvailableTierBehind = targetTierPeers.filter((e) => {
          if (fourIds.has(e.id)) return false;
          if (recentPlayerIds && recentPlayerIds.has(e.id)) return false;
          const eCurRaw = rawAssignedMap[e.id] ?? e.gamesPlayed ?? 0;
          return eCurRaw <= pCurRaw;
        });

        if (unpickedAvailableTierBehind.length >= 2) {
          violationCount += unpickedAvailableTierBehind.length;
        }
      }
    }
  }

  return violationCount * 250000;
}

/**
 * Fisher-Yates array shuffle with random seed
 */
export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

/**
 * 두 선수가 클럽 지정 파트너(상호 또는 단방향)인지 확인
 */
export function areDesignatedPartners(p1?: Player | null, p2?: Player | null): boolean {
  if (!p1 || !p2 || p1.id === p2.id) return false;
  return Boolean(
    (p1.partnerId && p1.partnerId === p2.id) ||
      (p2.partnerId && p2.partnerId === p1.id)
  );
}

/**
 * 4명(또는 후보 그룹) 내에 지정 파트너 쌍이 함께 포함되어 있는지 계산하여
 * 같은 코트 배정 보너스 점수(양수 값)를 반환합니다. (기존 대비 같은 코트 배정률 약 20% 이상 상향)
 */
export function getSameCourtPartnerBonus(players: Player[]): number {
  let pairCount = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (areDesignatedPartners(players[i], players[j])) {
        pairCount++;
      }
    }
  }
  return pairCount * 40000;
}

/**
 * Evaluates pairing penalty based on partner and opponent history.
 * When avoidDuplicatePartners is enabled, enforces strict penalties to avoid repeated partnerships.
 */
export function getPairPenalty(
  p1: Player,
  p2: Player,
  avoidDuplicatePartners: boolean
): number {
  // 클럽 파트너로 지정된 경우: 같은 팀 및 같은 코트 우선 배정을 위해 강력한 보너스 부여 (기존 -50000에서 30% 상향된 -65000)
  if (areDesignatedPartners(p1, p2)) {
    return -65000;
  }
  if (!avoidDuplicatePartners) return 0;

  const count1 = p1.partnerHistory?.[p2.id] || 0;
  const count2 = p2.partnerHistory?.[p1.id] || 0;
  const timesPartnered = Math.max(count1, count2);

  let penalty = 0;
  if (timesPartnered > 0) {
    // 이미 파트너를 했던 횟수당 강력한 페널티 부여 (급수 차이 1000~5000점을 압도하여 다른 조합 우선 선택)
    penalty += 50000 + (timesPartnered - 1) * 30000;
  }
  // 직전 배정 경기 파트너인 경우 절대적으로 중복 배제하기 위한 최고 강도 가산 페널티
  if (
    (p1.lastPartnerId && p1.lastPartnerId === p2.id) ||
    (p2.lastPartnerId && p2.lastPartnerId === p1.id)
  ) {
    penalty += 110000;
  }
  return penalty;
}

/**
 * Evaluates opponent duplication penalty between two teams (teamA vs teamB).
 * When avoidDuplicatePartners ("이전 배정 경기와 중복 방지") is enabled, penalizes repeating the same
 * opponent matchups and especially repeating the exact 2v2 matchup from the immediately preceding assigned match.
 */
export function getOpponentPenalty(
  teamA: [Player, Player],
  teamB: [Player, Player],
  avoidDuplicatePartners: boolean
): number {
  if (!avoidDuplicatePartners) return 0;

  let penalty = 0;
  let lastOpponentPairCount = 0;

  for (const a of teamA) {
    for (const b of teamB) {
      if (!a || !b || a.id === b.id) continue;
      const opp1 = a.opponentHistory?.[b.id] || 0;
      const opp2 = b.opponentHistory?.[a.id] || 0;
      const timesOpposed = Math.max(opp1, opp2);
      if (timesOpposed > 0) {
        penalty += 12000 + (timesOpposed - 1) * 8000;
      }

      const wasLastOpponent =
        (a.lastOpponentIds && a.lastOpponentIds.includes(b.id)) ||
        (b.lastOpponentIds && b.lastOpponentIds.includes(a.id));
      if (wasLastOpponent) {
        lastOpponentPairCount++;
        penalty += 30000;
      }
    }
  }

  // 직전 배정 경기와 상대팀 대진(2:2 매치업)까지 완전히 동일한 경우 추가 강력 페널티 부여
  if (lastOpponentPairCount >= 4) {
    penalty += 90000;
  } else if (lastOpponentPairCount >= 2) {
    penalty += 35000;
  }

  return penalty;
}

/**
 * Evaluates 4-player (or N-player) match composition overlap with previously assigned matches.
 * When avoidDuplicatePartners ("이전 배정 경기와 중복 방지") is enabled, penalizes selecting players
 * who were already assigned together in the immediately preceding match (as partner or opponent)
 * or have repeatedly been assigned to the same match.
 */
export function getMatchOverlapPenalty(
  players: Player[],
  avoidDuplicatePartners: boolean
): number {
  if (!avoidDuplicatePartners || players.length < 2) return 0;

  let penalty = 0;
  let lastMatchTogetherPairs = 0;

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a || !b || a.id === b.id) continue;
      // 클럽 지정 파트너는 같은 경기에 배정되어야 하므로 중복 페널티에서 제외
      if (areDesignatedPartners(a, b)) continue;

      const wasLastPartner =
        (a.lastPartnerId && a.lastPartnerId === b.id) ||
        (b.lastPartnerId && b.lastPartnerId === a.id);
      const wasLastOpponent =
        Boolean(a.lastOpponentIds && a.lastOpponentIds.includes(b.id)) ||
        Boolean(b.lastOpponentIds && b.lastOpponentIds.includes(a.id));

      if (wasLastPartner || wasLastOpponent) {
        lastMatchTogetherPairs++;
        penalty += wasLastPartner ? 55000 : 38000;
      }

      const timesPartnered = Math.max(
        a.partnerHistory?.[b.id] || 0,
        b.partnerHistory?.[a.id] || 0
      );
      const timesOpposed = Math.max(
        a.opponentHistory?.[b.id] || 0,
        b.opponentHistory?.[a.id] || 0
      );

      if (timesPartnered > 0) {
        penalty += timesPartnered * 16000;
      }
      if (timesOpposed > 0) {
        penalty += timesOpposed * 10000;
      }
    }
  }

  // 직전 배정 경기의 4명 중 3명 이상(쌍 3개 이상) 또는 4명 전원(쌍 5~6개)이 다시 한 경기에 묶이는 것을 강력 방지
  if (lastMatchTogetherPairs >= 5) {
    penalty += 350000;
  } else if (lastMatchTogetherPairs >= 3) {
    penalty += 150000;
  }

  return penalty;
}

/**
 * Updates in-memory partnerHistory, lastPartnerId, opponentHistory, and lastOpponentIds
 * for the 4 players assigned to a newly generated match within a batch loop.
 */
export function updateInMemoryMatchHistory(
  playersList: Player[],
  teamA: [Player, Player],
  teamB: [Player, Player]
): void {
  const tA0 = playersList.find((p) => p.id === teamA[0]?.id);
  const tA1 = playersList.find((p) => p.id === teamA[1]?.id);
  const tB0 = playersList.find((p) => p.id === teamB[0]?.id);
  const tB1 = playersList.find((p) => p.id === teamB[1]?.id);

  const teamBOppIds = [teamB[0]?.id, teamB[1]?.id].filter(Boolean);
  const teamAOppIds = [teamA[0]?.id, teamA[1]?.id].filter(Boolean);

  if (tA0 && tA1) {
    tA0.lastPartnerId = tA1.id;
    tA1.lastPartnerId = tA0.id;
    tA0.partnerHistory = {
      ...(tA0.partnerHistory || {}),
      [tA1.id]: ((tA0.partnerHistory || {})[tA1.id] || 0) + 1,
    };
    tA1.partnerHistory = {
      ...(tA1.partnerHistory || {}),
      [tA0.id]: ((tA1.partnerHistory || {})[tA0.id] || 0) + 1,
    };
  }
  if (tB0 && tB1) {
    tB0.lastPartnerId = tB1.id;
    tB1.lastPartnerId = tB0.id;
    tB0.partnerHistory = {
      ...(tB0.partnerHistory || {}),
      [tB1.id]: ((tB0.partnerHistory || {})[tB1.id] || 0) + 1,
    };
    tB1.partnerHistory = {
      ...(tB1.partnerHistory || {}),
      [tB0.id]: ((tB1.partnerHistory || {})[tB0.id] || 0) + 1,
    };
  }

  [tA0, tA1].forEach((pA) => {
    if (!pA) return;
    pA.lastOpponentIds = [...teamBOppIds];
    const nextOpp = { ...(pA.opponentHistory || {}) };
    teamBOppIds.forEach((bId) => {
      nextOpp[bId] = (nextOpp[bId] || 0) + 1;
    });
    pA.opponentHistory = nextOpp;
  });

  [tB0, tB1].forEach((pB) => {
    if (!pB) return;
    pB.lastOpponentIds = [...teamAOppIds];
    const nextOpp = { ...(pB.opponentHistory || {}) };
    teamAOppIds.forEach((aId) => {
      nextOpp[aId] = (nextOpp[aId] || 0) + 1;
    });
    pB.opponentHistory = nextOpp;
  });
}

/**
 * 대진 기록(roundHistory)으로부터 모든 참가 선수의 파트너 횟수, 직전 파트너, 상대 횟수, 직전 상대 계산
 */
export function computePartnerHistoryFromHistory(
  roundHistory: MatchRound[]
): Record<
  string,
  {
    partnerHistory: Record<string, number>;
    lastPartnerId?: string;
    opponentHistory: Record<string, number>;
    lastOpponentIds?: string[];
  }
> {
  const result: Record<
    string,
    {
      partnerHistory: Record<string, number>;
      lastPartnerId?: string;
      opponentHistory: Record<string, number>;
      lastOpponentIds?: string[];
    }
  > = {};

  const ensure = (id: string) => {
    if (!result[id]) {
      result[id] = {
        partnerHistory: {},
        lastPartnerId: undefined,
        opponentHistory: {},
        lastOpponentIds: undefined,
      };
    }
    return result[id];
  };

  const sortedRounds = [...roundHistory].sort((a, b) => a.roundNumber - b.roundNumber);
  sortedRounds.forEach((r) => {
    const sortedMatches = [...r.matches].sort(
      (a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0)
    );
    sortedMatches.forEach((m) => {
      const pA1 = m.teamA?.player1Id;
      const pA2 = m.teamA?.player2Id;
      const pB1 = m.teamB?.player1Id;
      const pB2 = m.teamB?.player2Id;

      if (pA1 && pA2) {
        const d1 = ensure(pA1);
        const d2 = ensure(pA2);
        d1.partnerHistory[pA2] = (d1.partnerHistory[pA2] || 0) + 1;
        d2.partnerHistory[pA1] = (d2.partnerHistory[pA1] || 0) + 1;
        d1.lastPartnerId = pA2;
        d2.lastPartnerId = pA1;
      }
      if (pB1 && pB2) {
        const d1 = ensure(pB1);
        const d2 = ensure(pB2);
        d1.partnerHistory[pB2] = (d1.partnerHistory[pB2] || 0) + 1;
        d2.partnerHistory[pB1] = (d2.partnerHistory[pB1] || 0) + 1;
        d1.lastPartnerId = pB2;
        d2.lastPartnerId = pB1;
      }

      // Opponents
      const teamA = [pA1, pA2].filter(Boolean);
      const teamB = [pB1, pB2].filter(Boolean);
      teamA.forEach((aId) => {
        const data = ensure(aId);
        data.lastOpponentIds = [...teamB];
        teamB.forEach((bId) => {
          data.opponentHistory[bId] = (data.opponentHistory[bId] || 0) + 1;
        });
      });
      teamB.forEach((bId) => {
        const data = ensure(bId);
        data.lastOpponentIds = [...teamA];
        teamA.forEach((aId) => {
          data.opponentHistory[aId] = (data.opponentHistory[aId] || 0) + 1;
        });
      });
    });
  });

  return result;
}

/**
 * 파트너로 지정된 두 선수가 같은 경기(4명 조)에 들어갈 수 있도록 인접하게 묶어주는 헬퍼
 */
export function clusterPartners(players: Player[]): Player[] {
  const result: Player[] = [];
  const added = new Set<string>();

  for (const p of players) {
    if (added.has(p.id)) continue;
    result.push(p);
    added.add(p.id);

    const partner = players.find((x) => !added.has(x.id) && areDesignatedPartners(p, x));
    if (partner) {
      result.push(partner);
      added.add(partner.id);
    }
  }

  return result;
}

/**
 * 상위 필요 인원(neededCount) 안에 파트너 둘 중 한 명이 포함될 경우 다른 한 명도 함께 우선 선발
 */
export function prioritizePartnersForSelection(
  candidates: Player[],
  neededCount: number,
  effectiveAssignedMap?: Record<string, number>
): Player[] {
  if (candidates.length <= neededCount) return clusterPartners([...candidates]);

  const relativeOffsetMap = computeRelativeLateOffsetMap(candidates);
  const result = [...candidates];
  const inTop = new Set(result.slice(0, neededCount).map((p) => p.id));

  for (let i = 0; i < neededCount; i++) {
    const p = result[i];
    const hasPartnerInTop = result
      .slice(0, neededCount)
      .some((other) => areDesignatedPartners(p, other));
    if (hasPartnerInTop) continue;

    const partnerIdx = result.findIndex(
      (x, idx) => idx >= neededCount && areDesignatedPartners(p, x)
    );
    if (partnerIdx !== -1) {
      const candPartner = result[partnerIdx];
      const slotPlayer = result[neededCount - 1];
      const candOffset = relativeOffsetMap[candPartner.id] ?? getPlayerEffectiveOffset(candPartner, candidates);
      const slotOffset = relativeOffsetMap[slotPlayer.id] ?? getPlayerEffectiveOffset(slotPlayer, candidates);
      // 후발 지각 등록 파트너가 자신보다 앞선 등록 단계 선수를 밀어내고 선발군으로 올라오는 현상 방지
      if (!candPartner.manualInterventionExempt && candOffset > slotOffset) {
        continue;
      }
      if (effectiveAssignedMap) {
        const candEff = effectiveAssignedMap[candPartner.id] ?? 0;
        const slotEff = effectiveAssignedMap[slotPlayer.id] ?? 0;
        if (candEff - slotEff >= 1.0 && candOffset > 0) {
          continue;
        }
      }

      // neededCount 내의 뒤쪽 비파트너 슬롯과 교체하여 파트너가 함께 선발군에 포함되도록 보장
      let replaceIdx = neededCount - 1;
      while (
        replaceIdx > i + 1 &&
        result
          .slice(0, neededCount)
          .some((other) => other.id !== result[replaceIdx].id && areDesignatedPartners(result[replaceIdx], other))
      ) {
        replaceIdx--;
      }
      const [partnerPlayer] = result.splice(partnerIdx, 1);
      result.splice(replaceIdx, 0, partnerPlayer);
      inTop.add(partnerPlayer.id);
    }
  }

  return clusterPartners(result);
}


/**
 * Optimally balance 4 players into 2 doubles teams.
 * In 'balanced' mode: minimizes tier difference (급수 밸런스 우선) while avoiding duplicate partners.
 * In 'random' mode: forms pairs completely randomly among non-duplicate pairings (급수 차이에 구애받지 않고 무작위 추첨).
 */
export function balanceDoublesFour(
  p0: Player,
  p1: Player,
  p2: Player,
  p3: Player,
  avoidDuplicatePartners: boolean,
  mode: MatchmakingMode = 'balanced'
): { teamA: [Player, Player]; teamB: [Player, Player] } {
  const configs = [
    { teamA: [p0, p1] as [Player, Player], teamB: [p2, p3] as [Player, Player] },
    { teamA: [p0, p2] as [Player, Player], teamB: [p1, p3] as [Player, Player] },
    { teamA: [p0, p3] as [Player, Player], teamB: [p1, p2] as [Player, Player] },
  ];

  if (mode === 'random') {
    // 완전 랜덤: 급수 차이(tierDiff)에 구애받지 않고 무작위로 팀을 구성
    // 단, 지정 파트너가 있거나 avoidDuplicatePartners(이전 배정 경기와 중복 방지)가 켜져 있다면 페널티가 가장 낮은 조합 우선 선택
    const scoredConfigs = configs.map((cfg) => {
      const penalty =
        getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
        getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
        getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
      return { ...cfg, penalty };
    });

    const minPenalty = Math.min(...scoredConfigs.map((c) => c.penalty));
    const bestConfigs = scoredConfigs.filter((c) => c.penalty <= minPenalty);
    const chosen = bestConfigs[Math.floor(Math.random() * bestConfigs.length)];
    return Math.random() < 0.5
      ? { teamA: chosen.teamA, teamB: chosen.teamB }
      : { teamA: chosen.teamB, teamB: chosen.teamA };
  }

  const scoredConfigs = configs.map((cfg) => {
    const tierA = (TIER_SCORES[cfg.teamA[0].tier] || 1) + (TIER_SCORES[cfg.teamA[1].tier] || 1);
    const tierB = (TIER_SCORES[cfg.teamB[0].tier] || 1) + (TIER_SCORES[cfg.teamB[1].tier] || 1);
    const tierDiff = Math.abs(tierA - tierB);
    const penalty =
      getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
      getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
      getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
    return { ...cfg, totalScore: tierDiff * 1000 + penalty };
  });

  scoredConfigs.sort((a, b) => a.totalScore - b.totalScore);
  return { teamA: scoredConfigs[0].teamA, teamB: scoredConfigs[0].teamB };
}

/**
 * Optimally balance 2 males and 2 females into mixed doubles.
 * In 'balanced' mode: minimizes tier difference.
 * In 'random' mode: forms pairs completely randomly among non-duplicate pairings.
 */
export function balanceMixedDoublesFour(
  m0: Player,
  m1: Player,
  f0: Player,
  f1: Player,
  avoidDuplicatePartners: boolean,
  mode: MatchmakingMode = 'balanced'
): { teamA: [Player, Player]; teamB: [Player, Player] } {
  const configs = [
    { teamA: [m0, f1] as [Player, Player], teamB: [m1, f0] as [Player, Player] },
    { teamA: [m0, f0] as [Player, Player], teamB: [m1, f1] as [Player, Player] },
  ];

  if (mode === 'random') {
    // 완전 랜덤: 급수 차이에 구애받지 않고 무작위로 팀 구성 (지정 파트너 보너스 및 이전 배정 경기 중복 방지 반영)
    const scoredConfigs = configs.map((cfg) => {
      const penalty =
        getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
        getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
        getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
      return { ...cfg, penalty };
    });

    const minPenalty = Math.min(...scoredConfigs.map((c) => c.penalty));
    const bestConfigs = scoredConfigs.filter((c) => c.penalty <= minPenalty);
    const chosen = bestConfigs[Math.floor(Math.random() * bestConfigs.length)];
    return Math.random() < 0.5
      ? { teamA: chosen.teamA, teamB: chosen.teamB }
      : { teamA: chosen.teamB, teamB: chosen.teamA };
  }

  const scoredConfigs = configs.map((cfg) => {
    const tierA = (TIER_SCORES[cfg.teamA[0].tier] || 1) + (TIER_SCORES[cfg.teamA[1].tier] || 1);
    const tierB = (TIER_SCORES[cfg.teamB[0].tier] || 1) + (TIER_SCORES[cfg.teamB[1].tier] || 1);
    const tierDiff = Math.abs(tierA - tierB);
    const penalty =
      getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
      getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
      getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
    return { ...cfg, totalScore: tierDiff * 1000 + penalty };
  });

  scoredConfigs.sort((a, b) => a.totalScore - b.totalScore);
  return { teamA: scoredConfigs[0].teamA, teamB: scoredConfigs[0].teamB };
}

/**
 * Optimally balance 3 players of one gender and 1 of another (3:1 비율) into 2 doubles teams.
 * Pairs the solo player with one of the trio players.
 * In 'balanced' mode: minimizes tier difference and partner duplication.
 * In 'random' mode: pairs the solo player randomly among lowest penalty partner options.
 */
export function balanceThreeAndOne(
  soloPlayer: Player,
  trioPlayers: [Player, Player, Player],
  avoidDuplicatePartners: boolean = true,
  mode: MatchmakingMode = 'balanced'
): { teamA: [Player, Player]; teamB: [Player, Player] } {
  const [p0, p1, p2] = trioPlayers;
  const configs = [
    { teamA: [soloPlayer, p0] as [Player, Player], teamB: [p1, p2] as [Player, Player] },
    { teamA: [soloPlayer, p1] as [Player, Player], teamB: [p0, p2] as [Player, Player] },
    { teamA: [soloPlayer, p2] as [Player, Player], teamB: [p0, p1] as [Player, Player] },
  ];

  if (mode === 'random') {
    const scoredConfigs = configs.map((cfg) => {
      const penalty =
        getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
        getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
        getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
      return { ...cfg, penalty };
    });

    const minPenalty = Math.min(...scoredConfigs.map((c) => c.penalty));
    const bestConfigs = scoredConfigs.filter((c) => c.penalty <= minPenalty);
    const chosen = bestConfigs[Math.floor(Math.random() * bestConfigs.length)];
    return Math.random() < 0.5
      ? { teamA: chosen.teamA, teamB: chosen.teamB }
      : { teamA: chosen.teamB, teamB: chosen.teamA };
  }

  const scoredConfigs = configs.map((cfg) => {
    const tierA = (TIER_SCORES[cfg.teamA[0].tier] || 1) + (TIER_SCORES[cfg.teamA[1].tier] || 1);
    const tierB = (TIER_SCORES[cfg.teamB[0].tier] || 1) + (TIER_SCORES[cfg.teamB[1].tier] || 1);
    const tierDiff = Math.abs(tierA - tierB);
    const penalty =
      getPairPenalty(cfg.teamA[0], cfg.teamA[1], avoidDuplicatePartners) +
      getPairPenalty(cfg.teamB[0], cfg.teamB[1], avoidDuplicatePartners) +
      getOpponentPenalty(cfg.teamA, cfg.teamB, avoidDuplicatePartners);
    return { ...cfg, totalScore: tierDiff * 1000 + penalty };
  });

  scoredConfigs.sort((a, b) => a.totalScore - b.totalScore);
  return { teamA: scoredConfigs[0].teamA, teamB: scoredConfigs[0].teamB };
}

const TARGET_SAME_TIERS: Tier[] = ['A', 'B', 'C', 'D', 'Beginner', 'S'];

const sameTierUsageCounts: Record<Tier, number> = {
  S: 0,
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  Beginner: 0,
};
let lastFormedMatchWasSameTier = false;
let consecutiveSameTierCount = 0;
let consecutiveMixedTierCount = 0;

export function resetSameTierUsageTracker(): void {
  sameTierUsageCounts.S = 0;
  sameTierUsageCounts.A = 0;
  sameTierUsageCounts.B = 0;
  sameTierUsageCounts.C = 0;
  sameTierUsageCounts.D = 0;
  sameTierUsageCounts.Beginner = 0;
  lastFormedMatchWasSameTier = false;
  consecutiveSameTierCount = 0;
  consecutiveMixedTierCount = 0;
}

export function isSameTierFour(players: Player[]): boolean {
  return players.length === 4 && players.every((p) => p.tier === players[0].tier);
}

export function recordFormedMatchTierPattern(players: Player[]): void {
  if (players.length !== 4) return;
  if (isSameTierFour(players)) {
    const t = players[0].tier;
    sameTierUsageCounts[t] = (sameTierUsageCounts[t] || 0) + 1;
    lastFormedMatchWasSameTier = true;
    consecutiveSameTierCount++;
    consecutiveMixedTierCount = 0;
  } else {
    lastFormedMatchWasSameTier = false;
    consecutiveMixedTierCount++;
    consecutiveSameTierCount = 0;
  }
}

export function getSameTierUsageCount(tier: Tier): number {
  return sameTierUsageCounts[tier] || 0;
}

export function getMinTargetSameTierUsage(): number {
  return Math.min(
    sameTierUsageCounts.A || 0,
    sameTierUsageCounts.B || 0,
    sameTierUsageCounts.C || 0,
    sameTierUsageCounts.D || 0,
    sameTierUsageCounts.Beginner || 0
  );
}

export function shouldPreferSameTierMatch(candidateTier?: Tier): boolean {
  const minUsage = getMinTargetSameTierUsage();
  if (
    candidateTier &&
    candidateTier !== 'S' &&
    (sameTierUsageCounts[candidateTier] || 0) > minUsage
  ) {
    return false;
  }
  if (!lastFormedMatchWasSameTier) {
    return true;
  }
  if (
    candidateTier &&
    candidateTier !== 'S' &&
    (sameTierUsageCounts[candidateTier] || 0) === 0 &&
    consecutiveSameTierCount < 2
  ) {
    return true;
  }
  return false;
}

export function getUnplayedSameTierBreakPenalty(
  player: Player,
  rosterForCheck: Player[],
  rawAssignedMap: Record<string, number> = {}
): number {
  if (player.tier === 'S') return 0;
  const usage = sameTierUsageCounts[player.tier] || 0;
  if (usage > 0) return 0;

  const pRaw = rawAssignedMap[player.id] ?? player.gamesPlayed ?? 0;
  const sameTierPeers = rosterForCheck.filter(
    (other) =>
      other.tier === player.tier &&
      other.isActive !== false &&
      !other.attendancePending &&
      other.specialStatus !== 'resting' &&
      other.specialStatus !== 'lesson' &&
      other.specialStatus !== 'exited' &&
      Math.abs((rawAssignedMap[other.id] ?? other.gamesPlayed ?? 0) - pRaw) === 0
  );

  const mCount = sameTierPeers.filter((o) => o.gender === 'M').length;
  const fCount = sameTierPeers.filter((o) => o.gender === 'F').length;

  const unplayedTargetTiersCount = (['A', 'B', 'C', 'D', 'Beginner'] as Tier[]).filter(
    (t) => (sameTierUsageCounts[t] || 0) === 0
  ).length;

  const canForm4SameGender =
    (player.gender === 'M' && mCount >= 4) || (player.gender === 'F' && fCount >= 4);
  if (canForm4SameGender) {
    return unplayedTargetTiersCount <= 2 ? 35000 : 22000;
  }

  const canForm4MixedGender = mCount >= 2 && fCount >= 2 && mCount < 4 && fCount < 4;
  if (canForm4MixedGender) {
    if (unplayedTargetTiersCount <= 2) return 35000;
    if (player.tier === 'A') return 20000;
    if (player.tier === 'Beginner') return 18000;
    return 12000;
  }

  return 0;
}

function inferRequiredRestedCount(
  topSlice: Player[],
  allCandidates: Player[],
  localEffMap: Record<string, number>,
  avoidConsecutiveRests?: boolean
): number {
  if (avoidConsecutiveRests === false) return 0;
  const topRested = topSlice.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
  if (avoidConsecutiveRests === true) return topRested;
  if (topRested === 0) return 0;
  // Infer if candidates were sorted with avoidConsecutiveRests=true
  const hasUnrestedBeforeRested = allCandidates.some(
    (p, idx) =>
      idx > 0 &&
      (p.consecutiveRestRounds || 0) > 0 &&
      (allCandidates[idx - 1].consecutiveRestRounds || 0) === 0 &&
      (localEffMap[p.id] ?? 0) <= (localEffMap[allCandidates[idx - 1].id] ?? 0) + 0.05
  );
  return hasUnrestedBeforeRested ? 0 : topRested;
}

export function findFairSameTierSameGender(
  candidates: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean,
  mode: MatchOptions['mode'] = 'balanced'
): {
  tier: Tier;
  chosen: Player[];
  teamA: [Player, Player];
  teamB: [Player, Player];
  usageCount: number;
  rankSum: number;
} | null {
  if (candidates.length < 4) return null;

  const rosterForCheck =
    allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : candidates;
  const earliestTime = getEarliestRegistrationTime(rosterForCheck);
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    candidates.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap ||
    computeEffectiveAssignedMap(candidates, localRawMap, new Set(), rosterForCheck);

  const nonSCandidates = candidates.filter((p) => p.tier !== 'S');
  const baseSlotEffs = [0, 1, 2, 3].map((idx) => localEffMap[candidates[idx]?.id] ?? 0);
  const baseSlotEffsNonS = [0, 1, 2, 3].map(
    (idx) => localEffMap[(nonSCandidates[idx] || candidates[idx])?.id] ?? 0
  );
  const requiredRested = inferRequiredRestedCount(
    candidates.slice(0, 4),
    candidates,
    localEffMap,
    avoidConsecutiveRests
  );

  const windowPool = candidates.slice(0, Math.min(14, candidates.length));
  const validGroups: {
    tier: Tier;
    chosen: Player[];
    teamA: [Player, Player];
    teamB: [Player, Player];
    usageCount: number;
    rankSum: number;
  }[] = [];

  for (const tier of TARGET_SAME_TIERS) {
    const tierCands = windowPool.filter((p) => p.tier === tier);
    if (tierCands.length < 4) continue;

    const four = tierCands.slice(0, 4);
    const restedCount = four.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    if (restedCount < requiredRested) continue;

    let excess = 0;
    const excessLimit = (sameTierUsageCounts[tier] || 0) === 0 ? 1.2 : 0.15;
    for (let idx = 0; idx < 4; idx++) {
      const pEff = localEffMap[four[idx].id] ?? 0;
      const baseEff = tier === 'S' ? (baseSlotEffs[idx] ?? 0) : (baseSlotEffsNonS[idx] ?? 0);
      if (pEff - baseEff > 0.15) {
        excess += pEff - baseEff;
      }
    }
    if (excess > excessLimit) continue;

    const latePenalty = getLatePlayerEqualizationPenalty(
      four,
      rosterForCheck,
      localRawMap,
      earliestTime
    );
    if (latePenalty > 0) continue;

    const bal = balanceDoublesFour(
      four[0],
      four[1],
      four[2],
      four[3],
      avoidDuplicatePartners,
      mode
    );
    const rankSum = four.reduce(
      (sum, p) => sum + Math.max(0, candidates.findIndex((c) => c.id === p.id)),
      0
    );
    validGroups.push({
      tier,
      chosen: four,
      teamA: bal.teamA,
      teamB: bal.teamB,
      usageCount: sameTierUsageCounts[tier] || 0,
      rankSum,
    });
  }

  if (validGroups.length === 0) return null;

  validGroups.sort((a, b) => {
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    return a.rankSum - b.rankSum;
  });

  return validGroups[0];
}

export function findFairSameTierMixedGender(
  males: Player[],
  females: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean,
  mode: MatchOptions['mode'] = 'balanced'
): {
  tier: Tier;
  chosen: Player[];
  teamA: [Player, Player];
  teamB: [Player, Player];
  usageCount: number;
  rankSum: number;
} | null {
  if (males.length < 2 || females.length < 2) return null;

  const combinedCandidates = [...males, ...females];
  const rosterForCheck =
    allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : combinedCandidates;
  const earliestTime = getEarliestRegistrationTime(rosterForCheck);
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    combinedCandidates.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap ||
    computeEffectiveAssignedMap(combinedCandidates, localRawMap, new Set(), rosterForCheck);

  const nonSMales = males.filter((p) => p.tier !== 'S');
  const nonSFemales = females.filter((p) => p.tier !== 'S');

  const baseEffM0 = localEffMap[males[0]?.id] ?? 0;
  const baseEffM1 = localEffMap[males[1]?.id] ?? 0;
  const baseEffF0 = localEffMap[females[0]?.id] ?? 0;
  const baseEffF1 = localEffMap[females[1]?.id] ?? 0;

  const baseEffM0NonS = localEffMap[(nonSMales[0] || males[0])?.id] ?? 0;
  const baseEffM1NonS = localEffMap[(nonSMales[1] || males[1])?.id] ?? 0;
  const baseEffF0NonS = localEffMap[(nonSFemales[0] || females[0])?.id] ?? 0;
  const baseEffF1NonS = localEffMap[(nonSFemales[1] || females[1])?.id] ?? 0;

  const requiredRestedM = inferRequiredRestedCount(
    males.slice(0, 2),
    males,
    localEffMap,
    avoidConsecutiveRests
  );
  const requiredRestedF = inferRequiredRestedCount(
    females.slice(0, 2),
    females,
    localEffMap,
    avoidConsecutiveRests
  );

  const windowM = males.slice(0, Math.min(12, males.length));
  const windowF = females.slice(0, Math.min(12, females.length));

  const validGroups: {
    tier: Tier;
    chosen: Player[];
    teamA: [Player, Player];
    teamB: [Player, Player];
    usageCount: number;
    rankSum: number;
  }[] = [];

  for (const tier of TARGET_SAME_TIERS) {
    const tierM = windowM.filter((p) => p.tier === tier);
    const tierF = windowF.filter((p) => p.tier === tier);
    if (tierM.length < 2 || tierF.length < 2) continue;

    const mPair = tierM.slice(0, 2);
    const fPair = tierF.slice(0, 2);
    const four = [mPair[0], mPair[1], fPair[0], fPair[1]];

    const restedM = mPair.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    const restedF = fPair.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    if (restedM < requiredRestedM || restedF < requiredRestedF) continue;

    const refM0 = tier === 'S' ? baseEffM0 : baseEffM0NonS;
    const refM1 = tier === 'S' ? baseEffM1 : baseEffM1NonS;
    const refF0 = tier === 'S' ? baseEffF0 : baseEffF0NonS;
    const refF1 = tier === 'S' ? baseEffF1 : baseEffF1NonS;

    const excessM0 = (localEffMap[mPair[0].id] ?? 0) - refM0;
    const excessM1 = (localEffMap[mPair[1].id] ?? 0) - refM1;
    const excessF0 = (localEffMap[fPair[0].id] ?? 0) - refF0;
    const excessF1 = (localEffMap[fPair[1].id] ?? 0) - refF1;
    const excessThreshold = (sameTierUsageCounts[tier] || 0) === 0 ? 1.2 : 0.15;
    if (excessM0 > excessThreshold || excessM1 > excessThreshold || excessF0 > excessThreshold || excessF1 > excessThreshold) continue;

    const latePenalty = getLatePlayerEqualizationPenalty(
      four,
      rosterForCheck,
      localRawMap,
      earliestTime
    );
    if (latePenalty > 0) continue;

    const bal = balanceMixedDoublesFour(
      mPair[0],
      mPair[1],
      fPair[0],
      fPair[1],
      avoidDuplicatePartners,
      mode
    );
    const rankSum =
      Math.max(0, males.findIndex((m) => m.id === mPair[0].id)) +
      Math.max(0, males.findIndex((m) => m.id === mPair[1].id)) +
      Math.max(0, females.findIndex((f) => f.id === fPair[0].id)) +
      Math.max(0, females.findIndex((f) => f.id === fPair[1].id));

    validGroups.push({
      tier,
      chosen: four,
      teamA: bal.teamA,
      teamB: bal.teamB,
      usageCount: sameTierUsageCounts[tier] || 0,
      rankSum,
    });
  }

  if (validGroups.length === 0) return null;

  validGroups.sort((a, b) => {
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    return a.rankSum - b.rankSum;
  });

  return validGroups[0];
}

export function selectRandomFourSameGender(
  candidates: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean
): { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] } {
  const rosterForCheck =
    allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : candidates;
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    rosterForCheck.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap ||
    computeEffectiveAssignedMap(candidates, localRawMap, new Set(), rosterForCheck);

  const pool = selectFairRandomPool(
    candidates,
    4,
    localEffMap,
    localRawMap,
    avoidConsecutiveRests ?? false
  );

  const drawFourFromPool = (): Player[] => {
    if (avoidConsecutiveRests && pool.length > 4) {
      const cutoffRest = pool[3]?.consecutiveRestRounds || 0;
      const locked = pool.filter((p) => (p.consecutiveRestRounds || 0) > cutoffRest).slice(0, 4);
      const lockedIds = new Set(locked.map((p) => p.id));
      const boundaryPool = pool.filter(
        (p) => !lockedIds.has(p.id) && (p.consecutiveRestRounds || 0) >= cutoffRest
      );
      const shuffledBoundary = clusterPartners(shuffleArray(boundaryPool));
      return [...locked, ...shuffledBoundary.slice(0, 4 - locked.length)];
    }
    const shuffled = shuffleArray(pool);
    return clusterPartners(shuffled).slice(0, 4);
  };

  const evaluateDrawDupCost = (draw: Player[]) => {
    const bal = balanceDoublesFour(draw[0], draw[1], draw[2], draw[3], true, 'random');
    const totalDup =
      getMatchOverlapPenalty(draw, true) +
      getPairPenalty(bal.teamA[0], bal.teamA[1], true) +
      getPairPenalty(bal.teamB[0], bal.teamB[1], true) +
      getOpponentPenalty(bal.teamA, bal.teamB, true) -
      getSameCourtPartnerBonus(draw);
    return { bal, totalDup };
  };

  if (!avoidDuplicatePartners || pool.length <= 4) {
    const chosen = drawFourFromPool();
    const balanced = balanceDoublesFour(
      chosen[0],
      chosen[1],
      chosen[2],
      chosen[3],
      avoidDuplicatePartners,
      'random'
    );
    return { chosen, teamA: balanced.teamA, teamB: balanced.teamB };
  }

  // avoidDuplicatePartners("이전 배정 경기와 중복 방지") 활성화 시:
  // 공정 후보 풀(pool) 내에서 무작위 추출하되 파트너/상대/4인 구성 중복도가 가장 낮은 조합을 선택
  let bestDraw = drawFourFromPool();
  let bestEval = evaluateDrawDupCost(bestDraw);
  const trials = Math.min(24, pool.length * 4);
  for (let t = 0; t < trials; t++) {
    if (bestEval.totalDup <= 0) break;
    const draw = drawFourFromPool();
    const curEval = evaluateDrawDupCost(draw);
    if (curEval.totalDup < bestEval.totalDup) {
      bestEval = curEval;
      bestDraw = draw;
    }
  }

  return { chosen: bestDraw, teamA: bestEval.bal.teamA, teamB: bestEval.bal.teamB };
}

export function selectRandomFourMixedGender(
  males: Player[],
  females: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean
): { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] } {
  const combined = [...males, ...females];
  const rosterForCheck =
    allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : combined;
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    rosterForCheck.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap ||
    computeEffectiveAssignedMap(combined, localRawMap, new Set(), rosterForCheck);

  const fairPoolM = selectFairRandomPool(
    males,
    2,
    localEffMap,
    localRawMap,
    avoidConsecutiveRests ?? false
  );
  const fairPoolF = selectFairRandomPool(
    females,
    2,
    localEffMap,
    localRawMap,
    avoidConsecutiveRests ?? false
  );

  const drawTwoGender = (genderPool: Player[]): Player[] => {
    if (avoidConsecutiveRests && genderPool.length > 2) {
      const cutoffRest = genderPool[1]?.consecutiveRestRounds || 0;
      const locked = genderPool
        .filter((p) => (p.consecutiveRestRounds || 0) > cutoffRest)
        .slice(0, 2);
      const lockedIds = new Set(locked.map((p) => p.id));
      const boundaryPool = genderPool.filter(
        (p) => !lockedIds.has(p.id) && (p.consecutiveRestRounds || 0) >= cutoffRest
      );
      return [...locked, ...shuffleArray(boundaryPool).slice(0, 2 - locked.length)];
    }
    return shuffleArray(genderPool).slice(0, 2);
  };

  const drawMixedFour = (): { topM: Player[]; topF: Player[] } => {
    let mPick = drawTwoGender(fairPoolM);
    let fPick = drawTwoGender(fairPoolF);

    const mixedMale = fairPoolM.find((m) => fairPoolF.some((f) => areDesignatedPartners(m, f)));
    if (mixedMale) {
      const mixedFemale = fairPoolF.find((f) => areDesignatedPartners(mixedMale, f));
      if (mixedFemale) {
        const otherM = drawTwoGender(fairPoolM.filter((m) => m.id !== mixedMale.id));
        mPick = [mixedMale, ...otherM.slice(0, 1)];
        if (mPick.length < 2) {
          mPick = [mixedMale, ...males.filter((m) => m.id !== mixedMale.id).slice(0, 1)];
        }
        const otherF = drawTwoGender(fairPoolF.filter((f) => f.id !== mixedFemale.id));
        fPick = [mixedFemale, ...otherF.slice(0, 1)];
        if (fPick.length < 2) {
          fPick = [mixedFemale, ...females.filter((f) => f.id !== mixedFemale.id).slice(0, 1)];
        }
      }
    }
    return { topM: mPick, topF: fPick };
  };

  const evaluateMixedDrawDupCost = (mPick: Player[], fPick: Player[]) => {
    const draw = [...mPick, ...fPick];
    const bal = balanceMixedDoublesFour(mPick[0], mPick[1], fPick[0], fPick[1], true, 'random');
    const totalDup =
      getMatchOverlapPenalty(draw, true) +
      getPairPenalty(bal.teamA[0], bal.teamA[1], true) +
      getPairPenalty(bal.teamB[0], bal.teamB[1], true) +
      getOpponentPenalty(bal.teamA, bal.teamB, true) -
      getSameCourtPartnerBonus(draw);
    return { bal, totalDup };
  };

  let { topM, topF } = drawMixedFour();
  if (!avoidDuplicatePartners || (fairPoolM.length <= 2 && fairPoolF.length <= 2)) {
    const chosen = [...topM, ...topF];
    const balanced = balanceMixedDoublesFour(
      topM[0],
      topM[1],
      topF[0],
      topF[1],
      avoidDuplicatePartners,
      'random'
    );
    return { chosen, teamA: balanced.teamA, teamB: balanced.teamB };
  }

  let bestEval = evaluateMixedDrawDupCost(topM, topF);
  const trials = Math.min(24, (fairPoolM.length + fairPoolF.length) * 4);
  for (let t = 0; t < trials; t++) {
    if (bestEval.totalDup <= 0) break;
    const cand = drawMixedFour();
    const curEval = evaluateMixedDrawDupCost(cand.topM, cand.topF);
    if (curEval.totalDup < bestEval.totalDup) {
      bestEval = curEval;
      topM = cand.topM;
      topF = cand.topF;
    }
  }

  const chosen = [...topM, ...topF];
  return { chosen, teamA: bestEval.bal.teamA, teamB: bestEval.bal.teamB };
}

/**
 * 실력 밸런스(balanced) 모드에서 대기 우선순위가 가장 높은 선수를 포함하면서,
 * 초심~S 혼합 밸런스 경기와 동일 급수 4명(A 4명, B 4명, C 4명, D 4명, 초심 4명) 경기가 모두 공정하게 배정되도록 최적의 4명을 선발합니다.
 * 단, 늦게 등록된 선수가 일찍 온 선수보다 우선 배정되거나 일찍 온 선수와 동일한 배정/진행 수가 되는 조합은 엄격히 배제합니다.
 */
export function selectBalancedFourCandidates(
  candidates: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean
): { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] } {
  if (candidates.length <= 4) {
    const p = candidates.slice(0, 4);
    const balanced = balanceDoublesFour(p[0], p[1], p[2], p[3], avoidDuplicatePartners, 'balanced');
    return { chosen: p, teamA: balanced.teamA, teamB: balanced.teamB };
  }

  const rosterForCheck = allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : candidates;
  const earliestTime = getEarliestRegistrationTime(rosterForCheck);
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    rosterForCheck.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap || computeEffectiveAssignedMap(candidates, localRawMap, new Set(), rosterForCheck);

  // 동일 급수 4명(A 4명, B 4명, C 4명, D 4명, 초심 4명) 공정 후보 확인
  const sameTierOption = findFairSameTierSameGender(
    candidates,
    avoidDuplicatePartners,
    localEffMap,
    localRawMap,
    rosterForCheck,
    avoidConsecutiveRests,
    'balanced'
  );
  const preferSameTier = shouldPreferSameTierMatch(sameTierOption?.tier);
  if (preferSameTier && sameTierOption) {
    const sameTierOverlap = getMatchOverlapPenalty(
      sameTierOption.chosen,
      avoidDuplicatePartners
    );
    // 이전 배정 경기와 중복 방지가 켜져 있을 때 직전 경기 3~4명이 그대로 다시 묶이는 경우가 아니면 동일 급수 우선 채택
    if (!avoidDuplicatePartners || sameTierOverlap < 200000) {
      return {
        chosen: sameTierOption.chosen,
        teamA: sameTierOption.teamA,
        teamB: sameTierOption.teamB,
      };
    }
  }

  // 상위 후보군에 파트너가 있는 선수가 있다면 파트너도 후보 풀(top 10) 안으로 끌어올려 같은 코트 배정률을 높임
  const prioritizedCandidates = prioritizePartnersForSelection(
    candidates,
    Math.min(6, candidates.length)
  );
  const pool = prioritizedCandidates.slice(0, Math.min(10, prioritizedCandidates.length));
  const mustInclude = candidates[0];

  // mustInclude가 pool에 반드시 첫 번째로 위치하도록 정렬 보장
  const orderedPool = [
    mustInclude,
    ...pool.filter((p) => p.id !== mustInclude.id),
  ].slice(0, Math.min(10, candidates.length));

  const nonSPool = orderedPool.filter((p) => p.tier !== 'S');
  const baseSlotEffs = [0, 1, 2, 3].map((idx) => localEffMap[orderedPool[idx]?.id] ?? 0);
  const baseSlotEffsNonS = [0, 1, 2, 3].map(
    (idx) => localEffMap[(nonSPool[idx] || orderedPool[idx])?.id] ?? 0
  );
  const requiredRested = inferRequiredRestedCount(
    orderedPool.slice(0, 4),
    candidates,
    localEffMap,
    avoidConsecutiveRests
  );
  const topRestSum = avoidConsecutiveRests
    ? orderedPool.slice(0, 4).reduce((sum, p) => sum + (p.consecutiveRestRounds || 0), 0)
    : 0;

  const scoreFour = (four: Player[], rankSum: number, hasMust: boolean) => {
    const bal = balanceDoublesFour(four[0], four[1], four[2], four[3], avoidDuplicatePartners, 'balanced');
    const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
    const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
    const diff = Math.abs(sA - sB);
    const pairPenalty =
      getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
      getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
      getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
      getMatchOverlapPenalty(four, avoidDuplicatePartners) -
      getSameCourtPartnerBonus(four);

    // 실효 배정 수 초과 페널티 (하위 순번/지각 선수가 상위 대기자를 제치고 들어오는 현상 방지)
    let effExcess = 0;
    for (let idx = 0; idx < 4; idx++) {
      const pEff = localEffMap[four[idx].id] ?? 0;
      const baseEff =
        four[idx].tier === 'S' ? (baseSlotEffs[idx] ?? 0) : (baseSlotEffsNonS[idx] ?? 0);
      if (pEff - baseEff > 0.05) {
        effExcess += pEff - baseEff;
      }
    }
    const effPenalty = effExcess * 400000;

    // 직전 경기 휴식자 우선 출전 보장 (체크 시 휴식자 수 및 누적 연속 휴식 라운드 합계 모두 보장)
    const restedInFour = four.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    const fourRestSum = four.reduce((sum, p) => sum + (p.consecutiveRestRounds || 0), 0);
    const restDeficitPenalty = avoidConsecutiveRests
      ? Math.max(0, requiredRested - restedInFour) * 300000 +
        Math.max(0, topRestSum - fourRestSum) * 150000
      : 0;

    // 늦게 등록된 선수가 일찍 등록된 선수와 동일한 배정/진행 수에 도달하는 위반 페널티
    const lateEqualPenalty = getLatePlayerEqualizationPenalty(
      four,
      rosterForCheck,
      localRawMap,
      earliestTime
    );

    const allSame = isSameTierFour(four);
    let tierPatternAdjustment = 0;
    if (!preferSameTier && allSame) {
      // 혼합 급수(초심~S) 차례일 때는 여러 급수가 섞인 조합을 우선
      tierPatternAdjustment += 95000;
    } else if (!allSame) {
      // 혼합 급수 조합을 짤 때, 아직 동일 급수 경기를 치르지 않은 4인 급수 그룹을 깨뜨리지 않도록 보호
      for (const p of four) {
        tierPatternAdjustment += getUnplayedSameTierBreakPenalty(p, rosterForCheck, localRawMap);
      }
    }

    const mustPenalty = hasMust
      ? 0
      : avoidConsecutiveRests ||
        (localEffMap[four[0].id] ?? 0) - (localEffMap[mustInclude.id] ?? 0) > 0.05
      ? 8000
      : 0;

    return {
      bal,
      totalScore:
        diff * 1000 +
        rankSum * 25 +
        mustPenalty +
        pairPenalty +
        effPenalty +
        restDeficitPenalty +
        lateEqualPenalty +
        tierPatternAdjustment,
    };
  };

  let bestFour = orderedPool.slice(0, 4);
  const initEval = scoreFour(bestFour, 6, true);
  let bestBalanced = initEval.bal;
  let bestScore = initEval.totalScore;

  for (let i = 0; i < orderedPool.length - 3; i++) {
    for (let j = i + 1; j < orderedPool.length - 2; j++) {
      for (let k = j + 1; k < orderedPool.length - 1; k++) {
        for (let l = k + 1; l < orderedPool.length; l++) {
          const four = [orderedPool[i], orderedPool[j], orderedPool[k], orderedPool[l]];
          const hasMust = i === 0;
          const evaluated = scoreFour(four, i + j + k + l, hasMust);
          if (evaluated.totalScore < bestScore) {
            bestScore = evaluated.totalScore;
            bestFour = four;
            bestBalanced = evaluated.bal;
          }
        }
      }
    }
  }

  return { chosen: bestFour, teamA: bestBalanced.teamA, teamB: bestBalanced.teamB };
}

/**
 * 실력 밸런스(balanced) 모드에서 대기 우선순위가 가장 높은 남성/여성을 포함하면서,
 * 초심~S 혼합 밸런스 경기와 동일 급수 4명(A 4명, B 4명, C 4명, D 4명, 초심 4명) 혼복 경기가 모두 공정하게 배정되도록 최적의 혼복 4명(2M + 2F)을 선발합니다.
 */
export function selectBalancedMixedCandidates(
  males: Player[],
  females: Player[],
  avoidDuplicatePartners: boolean,
  effAssignedMap?: Record<string, number>,
  rawAssignedMap?: Record<string, number>,
  allActivePlayers?: Player[],
  avoidConsecutiveRests?: boolean
): { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] } {
  if (males.length < 2 || females.length < 2) {
    const chosen = [...males.slice(0, 2), ...females.slice(0, 2)];
    const p = chosen;
    return {
      chosen,
      teamA: [p[0], p[1] || p[0]],
      teamB: [p[2] || p[0], p[3] || p[1] || p[0]],
    };
  }

  if (males.length <= 2 && females.length <= 2) {
    const balanced = balanceMixedDoublesFour(males[0], males[1], females[0], females[1], avoidDuplicatePartners, 'balanced');
    return { chosen: [males[0], males[1], females[0], females[1]], teamA: balanced.teamA, teamB: balanced.teamB };
  }

  const combinedCandidates = [...males, ...females];
  const rosterForCheck =
    allActivePlayers && allActivePlayers.length > 0 ? allActivePlayers : combinedCandidates;
  const earliestTime = getEarliestRegistrationTime(rosterForCheck);
  const localRawMap: Record<string, number> = rawAssignedMap || {};
  if (!rawAssignedMap) {
    rosterForCheck.forEach((p) => {
      localRawMap[p.id] = p.gamesPlayed || 0;
    });
  }
  const localEffMap =
    effAssignedMap ||
    computeEffectiveAssignedMap(combinedCandidates, localRawMap, new Set(), rosterForCheck);

  // 동일 급수 4명(2M + 2F: A 4명, B 4명, C 4명, D 4명, 초심 4명) 공정 후보 확인
  const sameTierOption = findFairSameTierMixedGender(
    males,
    females,
    avoidDuplicatePartners,
    localEffMap,
    localRawMap,
    rosterForCheck,
    avoidConsecutiveRests,
    'balanced'
  );
  const preferSameTier = shouldPreferSameTierMatch(sameTierOption?.tier);
  if (preferSameTier && sameTierOption) {
    const sameTierOverlap = getMatchOverlapPenalty(
      sameTierOption.chosen,
      avoidDuplicatePartners
    );
    if (!avoidDuplicatePartners || sameTierOverlap < 200000) {
      return {
        chosen: sameTierOption.chosen,
        teamA: sameTierOption.teamA,
        teamB: sameTierOption.teamB,
      };
    }
  }

  // 상위 대기자와 파트너 관계인 이성/동성 선수가 후보 풀 밖에 있다면 풀 안으로 우선 승격 (단, 후발 지각 등록자는 선행 등록 선수를 밀어내지 않음)
  const relativeOffsetMap = computeRelativeLateOffsetMap(rosterForCheck);
  const topMaleIds = new Set(males.slice(0, 4).map((p) => p.id));
  const topFemaleIds = new Set(females.slice(0, 4).map((p) => p.id));
  const maxTopMaleOffset = Math.max(
    0,
    ...males.slice(0, 4).map((m) => relativeOffsetMap[m.id] ?? getPlayerEffectiveOffset(m, rosterForCheck))
  );
  const maxTopFemaleOffset = Math.max(
    0,
    ...females.slice(0, 4).map((f) => relativeOffsetMap[f.id] ?? getPlayerEffectiveOffset(f, rosterForCheck))
  );

  const promotedMales = [...prioritizePartnersForSelection(males, Math.min(4, males.length))];
  males.forEach((m) => {
    const mOffset = relativeOffsetMap[m.id] ?? getPlayerEffectiveOffset(m, rosterForCheck);
    if (
      females.slice(0, 4).some((f) => areDesignatedPartners(m, f)) &&
      !topMaleIds.has(m.id) &&
      mOffset <= maxTopMaleOffset
    ) {
      const idx = promotedMales.findIndex((x) => x.id === m.id);
      if (idx >= 4) {
        const [moved] = promotedMales.splice(idx, 1);
        promotedMales.splice(Math.min(2, promotedMales.length), 0, moved);
      }
    }
  });

  const promotedFemales = [...prioritizePartnersForSelection(females, Math.min(4, females.length))];
  females.forEach((f) => {
    const fOffset = relativeOffsetMap[f.id] ?? getPlayerEffectiveOffset(f, rosterForCheck);
    if (
      males.slice(0, 4).some((m) => areDesignatedPartners(f, m)) &&
      !topFemaleIds.has(f.id) &&
      fOffset <= maxTopFemaleOffset
    ) {
      const idx = promotedFemales.findIndex((x) => x.id === f.id);
      if (idx >= 4) {
        const [moved] = promotedFemales.splice(idx, 1);
        promotedFemales.splice(Math.min(2, promotedFemales.length), 0, moved);
      }
    }
  });

  const poolM = promotedMales.slice(0, Math.min(8, promotedMales.length));
  const poolF = promotedFemales.slice(0, Math.min(8, promotedFemales.length));
  const mustM = males[0];
  const mustF = females[0];

  const nonSMales = poolM.filter((p) => p.tier !== 'S');
  const nonSFemales = poolF.filter((p) => p.tier !== 'S');

  const baseEffM0 = localEffMap[poolM[0]?.id] ?? 0;
  const baseEffM1 = localEffMap[poolM[1]?.id] ?? 0;
  const baseEffF0 = localEffMap[poolF[0]?.id] ?? 0;
  const baseEffF1 = localEffMap[poolF[1]?.id] ?? 0;

  const baseEffM0NonS = localEffMap[(nonSMales[0] || poolM[0])?.id] ?? 0;
  const baseEffM1NonS = localEffMap[(nonSMales[1] || poolM[1])?.id] ?? 0;
  const baseEffF0NonS = localEffMap[(nonSFemales[0] || poolF[0])?.id] ?? 0;
  const baseEffF1NonS = localEffMap[(nonSFemales[1] || poolF[1])?.id] ?? 0;

  const requiredRestedM = inferRequiredRestedCount(
    poolM.slice(0, 2),
    males,
    localEffMap,
    avoidConsecutiveRests
  );
  const requiredRestedF = inferRequiredRestedCount(
    poolF.slice(0, 2),
    females,
    localEffMap,
    avoidConsecutiveRests
  );
  const topRestSumM = avoidConsecutiveRests
    ? poolM.slice(0, 2).reduce((sum, p) => sum + (p.consecutiveRestRounds || 0), 0)
    : 0;
  const topRestSumF = avoidConsecutiveRests
    ? poolF.slice(0, 2).reduce((sum, p) => sum + (p.consecutiveRestRounds || 0), 0)
    : 0;

  const evalMixedFour = (curM0: Player, curM1: Player, curF0: Player, curF1: Player, rankSum: number, mustPenalty: number) => {
    const four = [curM0, curM1, curF0, curF1];
    const bal = balanceMixedDoublesFour(curM0, curM1, curF0, curF1, avoidDuplicatePartners, 'balanced');
    const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
    const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
    const diff = Math.abs(sA - sB);
    const pairPenalty =
      getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
      getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
      getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
      getMatchOverlapPenalty(four, avoidDuplicatePartners) -
      getSameCourtPartnerBonus(four);

    const refM0 = curM0.tier === 'S' ? baseEffM0 : baseEffM0NonS;
    const refM1 = curM1.tier === 'S' ? baseEffM1 : baseEffM1NonS;
    const refF0 = curF0.tier === 'S' ? baseEffF0 : baseEffF0NonS;
    const refF1 = curF1.tier === 'S' ? baseEffF1 : baseEffF1NonS;

    const excessM0 = Math.max(0, (localEffMap[curM0.id] ?? 0) - refM0);
    const excessM1 = Math.max(0, (localEffMap[curM1.id] ?? 0) - refM1);
    const excessF0 = Math.max(0, (localEffMap[curF0.id] ?? 0) - refF0);
    const excessF1 = Math.max(0, (localEffMap[curF1.id] ?? 0) - refF1);
    const totalExcess =
      (excessM0 > 0.05 ? excessM0 : 0) +
      (excessM1 > 0.05 ? excessM1 : 0) +
      (excessF0 > 0.05 ? excessF0 : 0) +
      (excessF1 > 0.05 ? excessF1 : 0);
    const effPenalty = totalExcess * 400000;

    const restedM = [curM0, curM1].filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    const restedF = [curF0, curF1].filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    const restSumM = (curM0.consecutiveRestRounds || 0) + (curM1.consecutiveRestRounds || 0);
    const restSumF = (curF0.consecutiveRestRounds || 0) + (curF1.consecutiveRestRounds || 0);
    const restDeficitPenalty = avoidConsecutiveRests
      ? (Math.max(0, requiredRestedM - restedM) + Math.max(0, requiredRestedF - restedF)) * 300000 +
        (Math.max(0, topRestSumM - restSumM) + Math.max(0, topRestSumF - restSumF)) * 150000
      : 0;

    const lateEqualPenalty = getLatePlayerEqualizationPenalty(
      four,
      rosterForCheck,
      localRawMap,
      earliestTime
    );

    const allSame = isSameTierFour(four);
    let tierPatternAdjustment = 0;
    if (!preferSameTier && allSame) {
      tierPatternAdjustment += 95000;
    } else if (!allSame) {
      for (const p of four) {
        tierPatternAdjustment += getUnplayedSameTierBreakPenalty(p, rosterForCheck, localRawMap);
      }
    }

    return {
      bal,
      score:
        diff * 1000 +
        rankSum * 25 +
        mustPenalty +
        pairPenalty +
        effPenalty +
        restDeficitPenalty +
        lateEqualPenalty +
        tierPatternAdjustment,
    };
  };

  let bestM = [poolM[0], poolM[1]];
  let bestF = [poolF[0], poolF[1]];
  const initEvalM = evalMixedFour(bestM[0], bestM[1], bestF[0], bestF[1], 2, 0);
  let bestBalanced = initEvalM.bal;
  let bestScore = initEvalM.score;

  for (let mIdx0 = 0; mIdx0 < poolM.length - 1; mIdx0++) {
    for (let mIdx1 = mIdx0 + 1; mIdx1 < poolM.length; mIdx1++) {
      for (let fIdx0 = 0; fIdx0 < poolF.length - 1; fIdx0++) {
        for (let fIdx1 = fIdx0 + 1; fIdx1 < poolF.length; fIdx1++) {
          const curM0 = poolM[mIdx0];
          const curM1 = poolM[mIdx1];
          const curF0 = poolF[fIdx0];
          const curF1 = poolF[fIdx1];

          const hasMustM = curM0.id === mustM.id || curM1.id === mustM.id;
          const hasMustF = curF0.id === mustF.id || curF1.id === mustF.id;
          const enforceMustM =
            avoidConsecutiveRests ||
            (localEffMap[curM0.id] ?? 0) - (localEffMap[mustM.id] ?? 0) > 0.05;
          const enforceMustF =
            avoidConsecutiveRests ||
            (localEffMap[curF0.id] ?? 0) - (localEffMap[mustF.id] ?? 0) > 0.05;

          const mustPenalty =
            (hasMustM || !enforceMustM ? 0 : 7500) + (hasMustF || !enforceMustF ? 0 : 7500);
          const evaluated = evalMixedFour(curM0, curM1, curF0, curF1, mIdx0 + mIdx1 + fIdx0 + fIdx1, mustPenalty);
          if (evaluated.score < bestScore) {
            bestScore = evaluated.score;
            bestM = [curM0, curM1];
            bestF = [curF0, curF1];
            bestBalanced = evaluated.bal;
          }
        }
      }
    }
  }

  return {
    chosen: [...bestM, ...bestF],
    teamA: bestBalanced.teamA,
    teamB: bestBalanced.teamB,
  };
}

export function buildStrictDoublesMatches(
  candidates: Player[],
  maxMatchesToForm: number,
  options: MatchOptions,
  currentRoundNumber: number,
  startCourtNumber: number = 1
): {
  matches: CourtMatch[];
  assignedPlayerIds: string[];
} {
  if (
    currentRoundNumber <= 1 &&
    candidates.every((p) => (p.gamesPlayed || 0) === 0)
  ) {
    resetSameTierUsageTracker();
  }
  const males = candidates.filter((p) => p.gender === 'M');
  const females = candidates.filter((p) => p.gender === 'F');

  // Check if same-tier groups exist in MD (4M), WD (4F), or XD (2M+2F)
  const sameTierMD = findFairSameTierSameGender(
    males,
    options.avoidDuplicatePartners,
    undefined,
    undefined,
    candidates,
    options.avoidConsecutiveRests,
    options.mode
  );
  const sameTierWD = findFairSameTierSameGender(
    females,
    options.avoidDuplicatePartners,
    undefined,
    undefined,
    candidates,
    options.avoidConsecutiveRests,
    options.mode
  );
  const sameTierXD = findFairSameTierMixedGender(
    males,
    females,
    options.avoidDuplicatePartners,
    undefined,
    undefined,
    candidates,
    options.avoidConsecutiveRests,
    options.mode
  );

  // Search optimal combination of:
  // m = 남복 (4M), w = 여복 (4F), x = 정규 혼복 (2M+2F),
  // x3m = 3:1 혼복 (3M+1F), x3f = 3:1 혼복 (3F+1M)
  let bestM = 0;
  let bestW = 0;
  let bestX = 0;
  let bestX3M = 0;
  let bestX3F = 0;
  let bestTotal = 0;
  let bestScore = -Infinity;

  const maxX =
    options.mode === 'doubles_only'
      ? 0
      : Math.min(
          Math.floor(males.length / 2),
          Math.floor(females.length / 2),
          maxMatchesToForm
        );

  // 후보군 상위권 내 지정 파트너 쌍(남+남, 여+여, 남+여) 파악하여 종목 조합 점수에 반영
  const topCandidateLimit = Math.min(candidates.length, maxMatchesToForm * 4 + 4);
  const topPool = candidates.slice(0, topCandidateLimit);
  const topPoolIds = new Set(topPool.map((p) => p.id));
  let mixedPartnerPairsCount = 0;
  let malePartnerPairsCount = 0;
  let femalePartnerPairsCount = 0;
  const countedPartnerIds = new Set<string>();
  for (const p of topPool) {
    if (p.partnerId && topPoolIds.has(p.partnerId) && !countedPartnerIds.has(p.id)) {
      const partner = topPool.find((c) => c.id === p.partnerId);
      if (partner) {
        countedPartnerIds.add(p.id);
        countedPartnerIds.add(partner.id);
        if (p.gender !== partner.gender) {
          mixedPartnerPairsCount++;
        } else if (p.gender === 'M') {
          malePartnerPairsCount++;
        } else {
          femalePartnerPairsCount++;
        }
      }
    }
  }

  const minSameUsage = getMinTargetSameTierUsage();

  for (let x = 0; x <= maxX; x++) {
    const remM1 = males.length - 2 * x;
    const remF1 = females.length - 2 * x;
    const maxM = Math.min(Math.floor(remM1 / 4), maxMatchesToForm - x);

    for (let m = 0; m <= maxM; m++) {
      const remM2 = remM1 - 4 * m;
      const maxW = Math.min(Math.floor(remF1 / 4), maxMatchesToForm - x - m);

      for (let w = 0; w <= maxW; w++) {
        const remF2 = remF1 - 4 * w;

        // Can we form 3M + 1F (3:1)?
        // 옵션설정 복식조편성방식(알고리즘)의 '완전 랜덤'을 선택했을 때만 3:1 편성 허용
        const allow3to1 = options.mode === 'random';
        const maxX3M = allow3to1
          ? Math.min(Math.floor(remM2 / 3), remF2, maxMatchesToForm - x - m - w)
          : 0;

        for (let x3m = 0; x3m <= maxX3M; x3m++) {
          const remM3 = remM2 - 3 * x3m;
          const remF3 = remF2 - x3m;

          // Can we form 3F + 1M (3:1)?
          const maxX3F = allow3to1
            ? Math.min(
                Math.floor(remF3 / 3),
                remM3,
                maxMatchesToForm - x - m - w - x3m
              )
            : 0;

          for (let x3f = 0; x3f <= maxX3F; x3f++) {
            const total = m + w + x + x3m + x3f;
            if (total === 0) continue;

            const remMales = remM3 - x3f;
            const remFemales = remF3 - 3 * x3f;
            const balancePenalty = Math.abs(remMales - remFemales);

            let score = total * 100000;

            // 지정 파트너 쌍이 같은 코트에서 뛸 수 있는 종목 구성에 가산점 부여 (배정률 약 20% 이상 향상)
            if (options.mode !== 'doubles_only' && mixedPartnerPairsCount > 0 && x > 0) {
              score += Math.min(x, mixedPartnerPairsCount) * 32000;
            }
            if (malePartnerPairsCount > 0 && m > 0) {
              score += Math.min(m, malePartnerPairsCount) * 20000;
            }
            if (femalePartnerPairsCount > 0 && w > 0) {
              score += Math.min(w, femalePartnerPairsCount) * 20000;
            }

            // 동일 급수 4명 경기가 가능한 종목 포함 시 가산점 (완전 랜덤 모드 제외)
            if (options.mode !== 'random') {
              if (options.mode !== 'mixed_preference' && sameTierMD && sameTierMD.usageCount <= minSameUsage && m > 0) {
                score += 45000;
              }
              if (options.mode !== 'mixed_preference' && sameTierWD && sameTierWD.usageCount <= minSameUsage && w > 0) {
                score += 45000;
              }
              if (options.mode !== 'doubles_only' && sameTierXD && sameTierXD.usageCount <= minSameUsage && x > 0) {
                score += 45000;
              }
            }

            // Gender parity: measure participation rates between male and female
            const malesUsed = 4 * m + 2 * x + 3 * x3m + x3f;
            const femalesUsed = 4 * w + 2 * x + x3m + 3 * x3f;
            const mRate = males.length > 0 ? malesUsed / males.length : 0;
            const fRate = females.length > 0 ? femalesUsed / females.length : 0;
            const genderDisparity = Math.abs(mRate - fRate);
            if (options.mode !== 'mixed_preference' && options.mode !== 'doubles_only') {
              score -= genderDisparity * 60000;
            }

            if (options.mode === 'doubles_only') {
              // 복식 우선: 남복(4M) 및 여복(4F) 전용 (혼복 배제)
              score += (m + w) * 80000 - genderDisparity * 40000;
            } else if (options.mode === 'mixed_preference') {
              // 혼복 우선: 2남 2녀가 가능한 한 정규 혼복(XD)을 최우선 편성
              score += x * 350000 + (m + w) * 1000;
            } else if (options.mode === 'balanced') {
              // 실력 밸런스: 급수 밸런스 중심
              score += (m + w) * 40000 + x * 5000;
            } else {
              // 완전 랜덤: 복식(남복·여복) 위주 적절한 혼복 배정 (15게임당 3~4.5게임, 약 25%) (성비 불균형 시 3:1 허용)
              const prevTotal = options.totalSessionMatches ?? 0;
              const prevMixed = options.mixedSessionMatches ?? 0;
              const projectedTotal = prevTotal + total;
              const currentMixedFormed = x + x3m + x3f;
              const projectedMixed = prevMixed + currentMixedFormed;

              // 15게임당 3~4.5게임 목표치 (평균 3.75 / 15 = 0.25)
              const targetMixed = projectedTotal * (3.75 / 15);
              const minMixed = projectedTotal * (3.0 / 15);
              const maxMixed = projectedTotal * (4.5 / 15);

              // 남복·여복 기본 보너스
              score += (m + w) * 35000;

              // 혼복 목표치와의 편차에 따른 점수 부여
              const mixedDiff = Math.abs(projectedMixed - targetMixed);
              score -= mixedDiff * 30000;

              // 상한(4.5게임/15게임) 초과 시 페널티 부여
              if (projectedMixed > maxMixed + 0.5) {
                score -= (projectedMixed - maxMixed) * 50000;
              } else if (projectedMixed < minMixed - 0.5 && currentMixedFormed === 0 && (maxX > 0 || maxX3M > 0 || maxX3F > 0)) {
                // 혼복이 비율에 미달하는 상황에서 혼복을 편성하지 않았을 경우 페널티
                score -= (minMixed - projectedMixed) * 35000;
              } else {
                // 적정 혼복 할당 시 균형 보너스
                score += currentMixedFormed * 22000;
              }
            }
            score -= balancePenalty * 10;

            // Prefer regular MD/WD/XD if same match count is reachable
            if (x3m + x3f > 0) {
              score -= (x3m + x3f) * 12000;
            }

            if (total > bestTotal || (total === bestTotal && score > bestScore)) {
              bestTotal = total;
              bestScore = score;
              bestM = m;
              bestW = w;
              bestX = x;
              bestX3M = x3m;
              bestX3F = x3f;
            }
          }
        }
      }
    }
  }

  if (bestTotal === 0) {
    return { matches: [], assignedPlayerIds: [] };
  }

  // 파트너 우선 선발을 반영한 전체 공정 대기자 풀 유지 (중간 슬라이스로 인해 동일 급수 4번째 선수가 잘리는 현상 방지)
  const malesNeeded = 4 * bestM + 2 * bestX + 3 * bestX3M + 1 * bestX3F;
  const femalesNeeded = 4 * bestW + 2 * bestX + 1 * bestX3M + 3 * bestX3F;

  let remainingMales = [...prioritizePartnersForSelection(males, malesNeeded)];
  let remainingFemales = [...prioritizePartnersForSelection(females, femalesNeeded)];

  const matches: CourtMatch[] = [];
  let currentCourt = startCourtNumber;

  let remMMatches = bestM;
  let remWMatches = bestW;
  let remXMatches = bestX;

  // 남복(MD), 여복(WD), 혼복(XD) 슬롯을 번갈아 생성하여 동일 급수 4명 그룹(B 4명, C 4명, A/D/초심 4명)과 초심~S 혼합 경기가 서로의 후보를 잠식하지 않고 고르게 생성되도록 처리
  while (remMMatches + remWMatches + remXMatches > 0) {
    let nextType: 'MD' | 'WD' | 'XD' | null = null;

    const availSameM =
      remMMatches > 0
        ? findFairSameTierSameGender(
            remainingMales,
            options.avoidDuplicatePartners,
            undefined,
            undefined,
            candidates,
            options.avoidConsecutiveRests,
            options.mode
          )
        : null;
    const availSameW =
      remWMatches > 0
        ? findFairSameTierSameGender(
            remainingFemales,
            options.avoidDuplicatePartners,
            undefined,
            undefined,
            candidates,
            options.avoidConsecutiveRests,
            options.mode
          )
        : null;
    const availSameX =
      remXMatches > 0
        ? findFairSameTierMixedGender(
            remainingMales,
            remainingFemales,
            options.avoidDuplicatePartners,
            undefined,
            undefined,
            candidates,
            options.avoidConsecutiveRests,
            options.mode
          )
        : null;

    if (options.mode === 'mixed_preference' && remXMatches > 0) {
      nextType = 'XD';
    } else if (options.mode !== 'random' && shouldPreferSameTierMatch()) {
      const sameCandidates: { type: 'MD' | 'WD' | 'XD'; usage: number }[] = [];
      if (availSameM) sameCandidates.push({ type: 'MD', usage: availSameM.usageCount });
      if (availSameW) sameCandidates.push({ type: 'WD', usage: availSameW.usageCount });
      if (availSameX && options.mode !== 'doubles_only') {
        sameCandidates.push({ type: 'XD', usage: availSameX.usageCount });
      }
      if (sameCandidates.length > 0) {
        sameCandidates.sort((a, b) => a.usage - b.usage);
        nextType = sameCandidates[0].type;
      }
    }

    if (!nextType) {
      if (remMMatches > 0 && remMMatches >= remWMatches && remMMatches >= remXMatches) {
        nextType = 'MD';
      } else if (remWMatches > 0 && remWMatches >= remXMatches) {
        nextType = 'WD';
      } else if (remXMatches > 0) {
        nextType = 'XD';
      } else if (remMMatches > 0) {
        nextType = 'MD';
      } else if (remWMatches > 0) {
        nextType = 'WD';
      }
    }

    if (nextType === 'MD') {
      remMMatches--;
      let balanced: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'random') {
        balanced = selectRandomFourSameGender(
          remainingMales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      } else {
        balanced = selectBalancedFourCandidates(
          remainingMales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      }
      recordFormedMatchTierPattern(balanced.chosen);
      const chosenIds = new Set(balanced.chosen.map((p) => p.id));
      remainingMales = remainingMales.filter((p) => !chosenIds.has(p.id));

      matches.push({
        id: generateId(),
        courtNumber: currentCourt > 0 ? currentCourt++ : 0,
        round: currentRoundNumber,
        teamA: {
          player1Id: balanced.teamA[0].id,
          player2Id: balanced.teamA[1].id,
          score: 0,
        },
        teamB: {
          player1Id: balanced.teamB[0].id,
          player2Id: balanced.teamB[1].id,
          score: 0,
        },
        status: currentCourt > 0 ? 'waiting' : 'queued',
        title: '남복',
      });
    } else if (nextType === 'WD') {
      remWMatches--;
      let balanced: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'random') {
        balanced = selectRandomFourSameGender(
          remainingFemales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      } else {
        balanced = selectBalancedFourCandidates(
          remainingFemales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      }
      recordFormedMatchTierPattern(balanced.chosen);
      const chosenIds = new Set(balanced.chosen.map((p) => p.id));
      remainingFemales = remainingFemales.filter((p) => !chosenIds.has(p.id));

      matches.push({
        id: generateId(),
        courtNumber: currentCourt > 0 ? currentCourt++ : 0,
        round: currentRoundNumber,
        teamA: {
          player1Id: balanced.teamA[0].id,
          player2Id: balanced.teamA[1].id,
          score: 0,
        },
        teamB: {
          player1Id: balanced.teamB[0].id,
          player2Id: balanced.teamB[1].id,
          score: 0,
        },
        status: currentCourt > 0 ? 'waiting' : 'queued',
        title: '여복',
      });
    } else if (nextType === 'XD') {
      remXMatches--;
      let balanced: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'random') {
        balanced = selectRandomFourMixedGender(
          remainingMales,
          remainingFemales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      } else {
        balanced = selectBalancedMixedCandidates(
          remainingMales,
          remainingFemales,
          options.avoidDuplicatePartners,
          undefined,
          undefined,
          candidates,
          options.avoidConsecutiveRests
        );
      }
      recordFormedMatchTierPattern(balanced.chosen);
      const chosenIds = new Set(balanced.chosen.map((p) => p.id));
      remainingMales = remainingMales.filter((p) => !chosenIds.has(p.id));
      remainingFemales = remainingFemales.filter((p) => !chosenIds.has(p.id));

      matches.push({
        id: generateId(),
        courtNumber: currentCourt > 0 ? currentCourt++ : 0,
        round: currentRoundNumber,
        teamA: {
          player1Id: balanced.teamA[0].id,
          player2Id: balanced.teamA[1].id,
          score: 0,
        },
        teamB: {
          player1Id: balanced.teamB[0].id,
          player2Id: balanced.teamB[1].id,
          score: 0,
        },
        status: currentCourt > 0 ? 'waiting' : 'queued',
        title: '혼복',
      });
    }
  }


  // 4. Form 3:1 혼복 (3M + 1F) - 성비 불균형으로 정규 혼복/남복/여복 불가 시
  for (let i = 0; i < bestX3M; i++) {
    const m0 = remainingMales.shift()!;
    const m1 = remainingMales.shift()!;
    const m2 = remainingMales.shift()!;
    const f0 = remainingFemales.shift()!;

    const balanced = balanceThreeAndOne(
      f0,
      [m0, m1, m2],
      options.avoidDuplicatePartners,
      options.mode
    );

    matches.push({
      id: generateId(),
      courtNumber: currentCourt > 0 ? currentCourt++ : 0,
      round: currentRoundNumber,
      teamA: {
        player1Id: balanced.teamA[0].id,
        player2Id: balanced.teamA[1].id,
        score: 0,
      },
      teamB: {
        player1Id: balanced.teamB[0].id,
        player2Id: balanced.teamB[1].id,
        score: 0,
      },
      status: currentCourt > 0 ? 'waiting' : 'queued',
      title: '혼복(3:1)',
    });
  }

  // 5. Form 3:1 혼복 (3F + 1M) - 성비 불균형으로 정규 혼복/남복/여복 불가 시
  for (let i = 0; i < bestX3F; i++) {
    const f0 = remainingFemales.shift()!;
    const f1 = remainingFemales.shift()!;
    const f2 = remainingFemales.shift()!;
    const m0 = remainingMales.shift()!;

    const balanced = balanceThreeAndOne(
      m0,
      [f0, f1, f2],
      options.avoidDuplicatePartners,
      options.mode
    );

    matches.push({
      id: generateId(),
      courtNumber: currentCourt > 0 ? currentCourt++ : 0,
      round: currentRoundNumber,
      teamA: {
        player1Id: balanced.teamA[0].id,
        player2Id: balanced.teamA[1].id,
        score: 0,
      },
      teamB: {
        player1Id: balanced.teamB[0].id,
        player2Id: balanced.teamB[1].id,
        score: 0,
      },
      status: currentCourt > 0 ? 'waiting' : 'queued',
      title: '혼복(3:1)',
    });
  }

  const assignedPlayerIds = matches.flatMap((m) => [
    m.teamA.player1Id,
    m.teamA.player2Id,
    m.teamB.player1Id,
    m.teamB.player2Id,
  ]);

  return {
    matches,
    assignedPlayerIds,
  };
}

/**
 * Helper to check whether a player is eligible for matchmaking:
 * - Must be active (isActive === true)
 * - Must not be resting or in lesson (specialStatus !== 'resting' && specialStatus !== 'lesson')
 * - If last_match:
 *   - Must not have completed their game since last_match was set
 *   - Must not already be playing on an active court
 *   - Must not already have a match in existing queued matches
 */
export function isPlayerEligibleForMatchmaking(
  player: Player,
  activeCourtPlayerIds?: Set<string>,
  existingQueuedMatches?: CourtMatch[]
): boolean {
  if (!player.isActive) return false;
  if (player.attendancePending) return false;
  if (
    player.specialStatus === 'resting' ||
    player.specialStatus === 'lesson' ||
    player.specialStatus === 'exited'
  ) {
    return false;
  }

  if (player.specialStatus === 'last_match') {
    const initialGames = player.lastMatchInitialGamesPlayed ?? player.gamesPlayed;
    const completedSince = Math.max(0, player.gamesPlayed - initialGames);
    if (completedSince > 0) return false;

    if (activeCourtPlayerIds && activeCourtPlayerIds.has(player.id)) return false;

    if (existingQueuedMatches) {
      const inQueue = existingQueuedMatches.some(
        (m) =>
          m.teamA.player1Id === player.id ||
          m.teamA.player2Id === player.id ||
          m.teamB.player1Id === player.id ||
          m.teamB.player2Id === player.id
      );
      if (inQueue) return false;
    }
  }

  return true;
}

/**
 * Core doubles matchmaking engine
 */
export function generateDoublesMatches(
  allPlayers: Player[],
  options: MatchOptions,
  currentRoundNumber: number,
  existingQueuedMatches: CourtMatch[] = [],
  activeMatches: CourtMatch[] = []
): {
  matches: CourtMatch[];
  restingPlayerIds: string[];
  updatedPlayers: Player[];
} {
  const playersWithHistory = mergeQueuedPartnerHistory(
    allPlayers,
    existingQueuedMatches,
    activeMatches
  );
  const activeCourtIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });
  const activePlayers = playersWithHistory.filter((p) =>
    isPlayerEligibleForMatchmaking(p, activeCourtIds, existingQueuedMatches)
  );

  if (activePlayers.length < 4) {
    throw new Error('최소 4명의 참가자가 활성화되어 있어야 복식 경기를 생성할 수 있습니다. (휴식중/레슨중/마지막판완료 제외)');
  }

  // Sort candidates by selection priority:
  // 1. If avoidConsecutiveRests is on, players with higher consecutiveRestRounds get higher priority
  // 2. Players with fewer games played get priority
  // 3. Random shuffle for ties
  const effectiveMap = computeEffectiveAssignedMap(activePlayers);
  const randomizedCandidates = shuffleArray(activePlayers);

  randomizedCandidates.sort((a, b) => {
    const aAssigned = effectiveMap[a.id] ?? a.gamesPlayed;
    const bAssigned = effectiveMap[b.id] ?? b.gamesPlayed;
    // S조는 다른 조(A,B,C,D,E조)보다 더 많은 비율의 배정/진행을 받을 수 있도록 실효 게임 수에 가중치 0.65 적용
    const aEff = a.tier === 'S' ? aAssigned * 0.65 : aAssigned;
    const bEff = b.tier === 'S' ? bAssigned * 0.65 : bAssigned;

    const aIsLate = isLateRegisteredPlayer(a, activePlayers);
    const bIsLate = isLateRegisteredPlayer(b, activePlayers);
    if ((aIsLate || bIsLate) && Math.abs(aEff - bEff) >= 0.5) {
      return aEff - bEff;
    }

    if (options.avoidConsecutiveRests) {
      const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
      const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
      if (bRested !== aRested) {
        return bRested - aRested;
      }
      if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
        return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
      }
    }
    if (aEff !== bEff) {
      return aEff - bEff;
    }
    if (a.tier === 'S' && b.tier !== 'S') return -1;
    if (b.tier === 'S' && a.tier !== 'S') return 1;
    const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
    if (regDiff !== 0) return regDiff;
    return 0;
  });

  const { matches, assignedPlayerIds } = buildStrictDoublesMatches(
    randomizedCandidates,
    options.courtCount,
    options,
    currentRoundNumber,
    1
  );

  if (matches.length === 0) {
    const malesCount = activePlayers.filter((p) => p.gender === 'M').length;
    const femalesCount = activePlayers.filter((p) => p.gender === 'F').length;
    if (options.mode === 'doubles_only') {
      throw new Error(
        `복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. (현재 활성: 남 ${malesCount}명, 여 ${femalesCount}명)`
      );
    }
    throw new Error(
      `복식 경기를 편성하기 위한 대기 인원이 부족합니다. (현재 활성: 남 ${malesCount}명, 여 ${femalesCount}명)`
    );
  }

  const playingIds = new Set(assignedPlayerIds);
  const restingPlayerIds = allPlayers
    .filter((p) => !p.attendancePending && !playingIds.has(p.id))
    .map((p) => p.id);

  // Update consecutive rest counters for all players
  const updatedPlayers = allPlayers.map((player) => {
    if (player.attendancePending) {
      return player;
    }
    if (playingIds.has(player.id)) {
      return {
        ...player,
        consecutiveRestRounds: 0,
      };
    } else {
      return {
        ...player,
        consecutiveRestRounds: player.isActive
          ? player.consecutiveRestRounds + 1
          : player.consecutiveRestRounds,
      };
    }
  });

  return {
    matches,
    restingPlayerIds,
    updatedPlayers,
  };
}

/**
 * Updates player history and win/loss records upon match completion
 */
export function recordCompletedMatch(
  match: CourtMatch,
  players: Player[]
): Player[] {
  const { teamA, teamB, winner } = match;
  const pA1 = teamA.player1Id;
  const pA2 = teamA.player2Id;
  const pB1 = teamB.player1Id;
  const pB2 = teamB.player2Id;

  const scoreA = teamA.score || 0;
  const scoreB = teamB.score || 0;

  const teamAIds = new Set([pA1, pA2]);
  const teamBIds = new Set([pB1, pB2]);

  return players.map((player) => {
    const isTeamA = teamAIds.has(player.id);
    const isTeamB = teamBIds.has(player.id);

    if (!isTeamA && !isTeamB) return player;

    const partnerId = isTeamA
      ? player.id === pA1 ? pA2 : pA1
      : player.id === pB1 ? pB2 : pB1;

    const opponents = (isTeamA ? [pB1, pB2] : [pA1, pA2]).filter(Boolean);

    const isWin = isTeamA ? winner === 'teamA' : winner === 'teamB';
    const isLoss = isTeamA ? winner === 'teamB' : winner === 'teamA';

    const pointsWon = isTeamA ? scoreA : scoreB;
    const pointsLost = isTeamA ? scoreB : scoreA;

    const newPartnerHistory = { ...player.partnerHistory };
    if (partnerId) {
      newPartnerHistory[partnerId] = (newPartnerHistory[partnerId] || 0) + 1;
    }

    const newOpponentHistory = { ...player.opponentHistory };
    for (const oppId of opponents) {
      if (oppId) {
        newOpponentHistory[oppId] = (newOpponentHistory[oppId] || 0) + 1;
      }
    }

    return {
      ...player,
      gamesPlayed: player.gamesPlayed + 1,
      wins: player.wins + (isWin ? 1 : 0),
      losses: player.losses + (isLoss ? 1 : 0),
      totalPointsWon: player.totalPointsWon + pointsWon,
      totalPointsLost: player.totalPointsLost + pointsLost,
      partnerHistory: newPartnerHistory,
      opponentHistory: newOpponentHistory,
      lastPartnerId: partnerId || player.lastPartnerId,
      lastOpponentIds: opponents.length > 0 ? opponents : player.lastOpponentIds,
    };
  });
}

/**
 * Merges partner history, lastPartnerId, opponentHistory, lastOpponentIds,
 * and simulated consecutiveRestRounds across activeMatches and existingQueuedMatches
 * into cloned player objects so that avoidDuplicatePartners and avoidConsecutiveRests
 * work accurately across queued and active court matches without mutating React state players.
 */
export function mergeQueuedPartnerHistory(
  players: Player[],
  existingQueuedMatches: CourtMatch[] = [],
  activeMatches: CourtMatch[] = [],
  courtCount: number = 1
): Player[] {
  const queuedMatchDataMap: Record<
    string,
    {
      partnerId?: string;
      partnerCounts: Record<string, number>;
      opponentIds?: string[];
      opponentCounts: Record<string, number>;
    }
  > = {};

  const ensureEntry = (id: string) => {
    if (!queuedMatchDataMap[id]) {
      queuedMatchDataMap[id] = {
        partnerCounts: {},
        opponentCounts: {},
      };
    }
    return queuedMatchDataMap[id];
  };

  const nonCompletedActive = (activeMatches || []).filter((m) => m && m.status !== 'completed');
  const queueList = existingQueuedMatches || [];
  const allPriorMatches = [...nonCompletedActive, ...queueList];

  allPriorMatches.forEach((m) => {
    const pA1 = m.teamA?.player1Id;
    const pA2 = m.teamA?.player2Id;
    const pB1 = m.teamB?.player1Id;
    const pB2 = m.teamB?.player2Id;

    if (pA1 && pA2) {
      const e1 = ensureEntry(pA1);
      const e2 = ensureEntry(pA2);
      e1.partnerCounts[pA2] = (e1.partnerCounts[pA2] || 0) + 1;
      e2.partnerCounts[pA1] = (e2.partnerCounts[pA1] || 0) + 1;
      e1.partnerId = pA2;
      e2.partnerId = pB1 ? pA1 : pA1;
    }
    if (pB1 && pB2) {
      const e1 = ensureEntry(pB1);
      const e2 = ensureEntry(pB2);
      e1.partnerCounts[pB2] = (e1.partnerCounts[pB2] || 0) + 1;
      e2.partnerCounts[pB1] = (e2.partnerCounts[pB1] || 0) + 1;
      e1.partnerId = pB2;
      e2.partnerId = pB1;
    }

    const teamA = [pA1, pA2].filter(Boolean);
    const teamB = [pB1, pB2].filter(Boolean);
    teamA.forEach((aId) => {
      const entry = ensureEntry(aId);
      entry.opponentIds = [...teamB];
      teamB.forEach((bId) => {
        entry.opponentCounts[bId] = (entry.opponentCounts[bId] || 0) + 1;
      });
    });
    teamB.forEach((bId) => {
      const entry = ensureEntry(bId);
      entry.opponentIds = [...teamA];
      teamA.forEach((aId) => {
        entry.opponentCounts[aId] = (entry.opponentCounts[aId] || 0) + 1;
      });
    });
  });

  // Simulate consecutiveRestRounds across active courts and existing queued match waves
  const simRestRounds: Record<string, number> = {};
  players.forEach((p) => {
    simRestRounds[p.id] = p.consecutiveRestRounds || 0;
  });

  nonCompletedActive.forEach((m) => {
    [m.teamA?.player1Id, m.teamA?.player2Id, m.teamB?.player1Id, m.teamB?.player2Id]
      .filter(Boolean)
      .forEach((id) => {
        simRestRounds[id] = 0;
      });
  });

  if (queueList.length > 0) {
    const effectiveCourtCount = Math.max(1, courtCount || 1);
    const fullWaves = Math.floor(queueList.length / effectiveCourtCount);
    for (let w = 0; w < fullWaves; w++) {
      const waveSlice = queueList.slice(w * effectiveCourtCount, (w + 1) * effectiveCourtCount);
      const waveIds = new Set<string>();
      waveSlice.forEach((m) => {
        [m.teamA?.player1Id, m.teamA?.player2Id, m.teamB?.player1Id, m.teamB?.player2Id]
          .filter(Boolean)
          .forEach((id) => waveIds.add(id));
      });
      players.forEach((p) => {
        if (waveIds.has(p.id)) {
          simRestRounds[p.id] = 0;
        } else if (isPlayerEligibleForMatchmaking(p)) {
          simRestRounds[p.id] = (simRestRounds[p.id] || 0) + 1;
        }
      });
    }
    const partialSlice = queueList.slice(fullWaves * effectiveCourtCount);
    partialSlice.forEach((m) => {
      [m.teamA?.player1Id, m.teamA?.player2Id, m.teamB?.player1Id, m.teamB?.player2Id]
        .filter(Boolean)
        .forEach((id) => {
          simRestRounds[id] = 0;
        });
    });
  }

  return players.map((p) => {
    const queuedData = queuedMatchDataMap[p.id];
    const mergedPartnerHistory = { ...(p.partnerHistory || {}) };
    const mergedOpponentHistory = { ...(p.opponentHistory || {}) };
    if (queuedData) {
      Object.entries(queuedData.partnerCounts).forEach(([pid, cnt]) => {
        mergedPartnerHistory[pid] = (mergedPartnerHistory[pid] || 0) + cnt;
      });
      Object.entries(queuedData.opponentCounts).forEach(([oid, cnt]) => {
        mergedOpponentHistory[oid] = (mergedOpponentHistory[oid] || 0) + cnt;
      });
    }
    return {
      ...p,
      consecutiveRestRounds: simRestRounds[p.id] ?? (p.consecutiveRestRounds || 0),
      partnerHistory: mergedPartnerHistory,
      opponentHistory: mergedOpponentHistory,
      lastPartnerId: queuedData?.partnerId || p.lastPartnerId,
      lastOpponentIds: queuedData?.opponentIds || p.lastOpponentIds,
    };
  });
}

/**
 * Selects a fair candidate pool for 'random' mode so that only players within the same
 * lowest effective assignment band (and rest priority band when avoidConsecutiveRests is active)
 * are randomly drawn, preventing players with more games from jumping ahead.
 */
function selectFairRandomPool(
  sortedGenderCandidates: Player[],
  minRequired: number,
  effectiveAssignedMap: Record<string, number>,
  rawAssignedMap: Record<string, number>,
  avoidConsecutiveRests: boolean
): Player[] {
  if (sortedGenderCandidates.length <= minRequired) {
    return [...sortedGenderCandidates];
  }

  const getEff = (p: Player) => {
    const raw = effectiveAssignedMap[p.id] ?? (rawAssignedMap[p.id] || 0);
    return p.tier === 'S' ? raw * 0.65 : raw;
  };

  const refCandidate = sortedGenderCandidates[minRequired - 1];
  const refEff = getEff(refCandidate);
  const requireRested =
    avoidConsecutiveRests &&
    sortedGenderCandidates
      .slice(0, minRequired)
      .every((p) => (p.consecutiveRestRounds || 0) > 0);

  const fairPool = sortedGenderCandidates.filter((p, idx) => {
    if (idx < minRequired) return true;
    if (requireRested && (p.consecutiveRestRounds || 0) === 0) return false;
    return getEff(p) <= refEff + 0.45;
  });

  return prioritizePartnersForSelection(
    fairPool.length >= minRequired ? fairPool : sortedGenderCandidates.slice(0, minRequired),
    Math.max(minRequired, fairPool.length),
    effectiveAssignedMap
  );
}

/**
 * Pre-generates upcoming matches for the Game Queue (게임 목록 대기열)
 * without immediately placing them on active courts.
 */
export function generateNextQueuedMatches(
  allPlayers: Player[],
  options: MatchOptions,
  currentRoundNumber: number,
  matchCountToGenerate: number = 1,
  activeCourtPlayerIds: Set<string> = new Set(),
  existingQueuedMatches: CourtMatch[] = [],
  activeMatches: CourtMatch[] = []
): {
  queuedMatches: CourtMatch[];
  assignedPlayerIds: string[];
} {
  const rawActivePlayers = allPlayers.filter((p) =>
    isPlayerEligibleForMatchmaking(p, activeCourtPlayerIds, existingQueuedMatches)
  );

  if (rawActivePlayers.length < 4) {
    throw new Error('최소 4명의 활성 참가자가 필요합니다. (휴식중/레슨중/마지막판완료 제외)');
  }

  if (
    existingQueuedMatches.length === 0 &&
    activeMatches.length === 0 &&
    activeCourtPlayerIds.size === 0 &&
    rawActivePlayers.every((p) => (p.gamesPlayed || 0) === 0)
  ) {
    resetSameTierUsageTracker();
  }

  // Clone active players and merge partner history and simulated rest rounds from existingQueuedMatches and activeMatches
  const activePlayers = mergeQueuedPartnerHistory(
    rawActivePlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );

  // Track each player's total current assigned count:
  // gamesPlayed + active court (if playing) + queue count
  const playerAssignedCount: Record<string, number> = {};
  activePlayers.forEach((p) => {
    const activeCourtCount = activeCourtPlayerIds.has(p.id) ? 1 : 0;
    const inQueueCount = existingQueuedMatches.filter(
      (m) =>
        m.teamA.player1Id === p.id ||
        m.teamA.player2Id === p.id ||
        m.teamB.player1Id === p.id ||
        m.teamB.player2Id === p.id
    ).length;
    playerAssignedCount[p.id] = p.gamesPlayed + activeCourtCount + inQueueCount;
  });

  const queuedMatches: CourtMatch[] = [];
  const assignedPlayerIdsSet = new Set<string>();

  // 15게임당 3~4.5게임(약 25%) 혼복 배정 비율 유지를 위한 세션 경기 수 카운트
  let sessionTotalCount = options.totalSessionMatches ?? existingQueuedMatches.length;
  let sessionMixedCount =
    options.mixedSessionMatches ??
    existingQueuedMatches.filter((m) => m.title?.includes('혼복')).length;

  const effectiveCourtCount = Math.max(1, options.courtCount || 1);

  for (let matchIdx = 0; matchIdx < matchCountToGenerate; matchIdx++) {
    // 현재 대기열 전체 (기존 대기열 + 이번 연속 생성 중 추가된 대기열)
    const allCurrentQueue = [...existingQueuedMatches, ...queuedMatches];

    // 현재 코트 개수(effectiveCourtCount)에 비례한 동시 코트 회전 묶음(Wave) 및 최근 (코트수 - 1)개 경기 내 선수 파악:
    // 코트가 C개일 때 연속된 C개의 대기열 경기는 동시에 C개 코트에 투입되므로 동일 선수가 중복 배정되지 않도록 함
    const waveStartIdx =
      Math.floor(allCurrentQueue.length / effectiveCourtCount) * effectiveCourtCount;
    const currentWaveMatches = allCurrentQueue.slice(waveStartIdx);
    const recentWindowMatches =
      effectiveCourtCount > 1 ? allCurrentQueue.slice(-(effectiveCourtCount - 1)) : [];

    const currentCourtWavePlayerIds = new Set<string>();
    [...currentWaveMatches, ...recentWindowMatches].forEach((m) => {
      currentCourtWavePlayerIds.add(m.teamA.player1Id);
      currentCourtWavePlayerIds.add(m.teamA.player2Id);
      currentCourtWavePlayerIds.add(m.teamB.player1Id);
      currentCourtWavePlayerIds.add(m.teamB.player2Id);
    });

    // 직전 코트 웨이브(또는 직전 경기)에 배정되었거나 방금 코트 경기를 마친 선수 파악 (지각/휴식복귀 선수의 연속 게임 배정 방지용)
    const recentQueueWaveMatches = allCurrentQueue.slice(-effectiveCourtCount);
    const lastMatchPlayerIds = new Set<string>();
    recentQueueWaveMatches.forEach((m) => {
      lastMatchPlayerIds.add(m.teamA.player1Id);
      lastMatchPlayerIds.add(m.teamA.player2Id);
      lastMatchPlayerIds.add(m.teamB.player1Id);
      lastMatchPlayerIds.add(m.teamB.player2Id);
    });
    if (allCurrentQueue.length === 0) {
      activePlayers.forEach((p) => {
        if (
          activeCourtPlayerIds.has(p.id) ||
          ((p.consecutiveRestRounds || 0) === 0 &&
            (p.gamesPlayed || 0) > (p.restStartGamesPlayed ?? 0))
        ) {
          lastMatchPlayerIds.add(p.id);
        }
      });
    }

    const recentOrActivePlayerIds = new Set<string>([
      ...activeCourtPlayerIds,
      ...currentCourtWavePlayerIds,
      ...lastMatchPlayerIds,
    ]);
    const effectiveAssignedCount = computeEffectiveAssignedMap(
      activePlayers,
      playerAssignedCount,
      recentOrActivePlayerIds,
      allPlayers
    );

    // Sort candidates for this match:
    // 1. Players not already assigned in the current C-court wave get highest priority
    // 2. Late-registered players never get consecutive games or equalize game counts with early arrivals
    // 3. Resting players (not on active courts) get preference for the immediate court wave
    // 4. Players with fewer total effective assigned matches & higher consecutive rests get preference
    const sortedAllCandidates = activePlayers
      .filter((p) => !(p.specialStatus === 'last_match' && assignedPlayerIdsSet.has(p.id)))
      .sort((a, b) => {
        const aInWave = currentCourtWavePlayerIds.has(a.id) ? 1 : 0;
        const bInWave = currentCourtWavePlayerIds.has(b.id) ? 1 : 0;
        if (aInWave !== bInWave) {
          return aInWave - bInWave;
        }

        // 늦게 등록된 선수가 직전 경기에 이미 배정된 경우 연속 게임 배정 원천 차단
        const aIsLate = isLateRegisteredPlayer(a, allPlayers);
        const bIsLate = isLateRegisteredPlayer(b, allPlayers);
        const aLateConsecutive = aIsLate && lastMatchPlayerIds.has(a.id) ? 1 : 0;
        const bLateConsecutive = bIsLate && lastMatchPlayerIds.has(b.id) ? 1 : 0;
        if (aLateConsecutive !== bLateConsecutive) {
          return aLateConsecutive - bLateConsecutive;
        }

        const aEff = effectiveAssignedCount[a.id] ?? (playerAssignedCount[a.id] || 0);
        const bEff = effectiveAssignedCount[b.id] ?? (playerAssignedCount[b.id] || 0);

        // 코트 수 비례 첫 코트 회전 묶음(Wave)에서는 현재 코트에서 뛰고 있지 않은 대기/휴식자를 우선 배정
        if (allCurrentQueue.length < effectiveCourtCount) {
          const aPlaying = activeCourtPlayerIds.has(a.id) ? 1 : 0;
          const bPlaying = activeCourtPlayerIds.has(b.id) ? 1 : 0;
          if (aPlaying !== bPlaying) {
            return aPlaying - bPlaying;
          }
        }

        // 늦게 온 선수와 일찍 온 선수 간 실효 배정 수가 다를 때는 휴식 라운드보다 실효 배정 수를 우선 적용하여 동률 추격 방지
        if ((aIsLate || bIsLate) && Math.abs(aEff - bEff) >= 0.5) {
          return aEff - bEff;
        }

        // 직전 경기 휴식자 우선 출전 (연속 대기 방지) 활성화 시:
        if (options.avoidConsecutiveRests) {
          const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
          const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
          if (bRested !== aRested) {
            return bRested - aRested;
          }
          if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
            return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
          }
        }

        if (aEff !== bEff) {
          return aEff - bEff;
        }
        if (a.tier === 'S' && b.tier !== 'S') return -1;
        if (b.tier === 'S' && a.tier !== 'S') return 1;
        const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
        if (Math.abs(regDiff) >= 60000) return regDiff;
        if (!options.avoidConsecutiveRests || options.mode === 'random') {
          return Math.random() - 0.5;
        }
        if (regDiff !== 0) return regDiff;
        return Math.random() - 0.5;
      });

    // 동일 코트 회전 묶음(C개 코트) 내 중복 배정을 방지하기 위해 가능한 경우 비중복 후보군을 우선 사용
    const nonWaveCandidates = sortedAllCandidates.filter(
      (p) => !currentCourtWavePlayerIds.has(p.id)
    );
    const nonWaveMales = nonWaveCandidates.filter((p) => p.gender === 'M');
    const nonWaveFemales = nonWaveCandidates.filter((p) => p.gender === 'F');
    const canFormMatchWithoutWaveDuplicates =
      nonWaveMales.length >= 4 ||
      nonWaveFemales.length >= 4 ||
      (options.mode !== 'doubles_only' && nonWaveMales.length >= 2 && nonWaveFemales.length >= 2) ||
      (options.mode === 'random' &&
        nonWaveCandidates.length >= 4 &&
        nonWaveMales.length >= 1 &&
        nonWaveFemales.length >= 1);

    const candidates = canFormMatchWithoutWaveDuplicates
      ? nonWaveCandidates
      : sortedAllCandidates;

    const activeMales = candidates.filter((p) => p.gender === 'M');
    const activeFemales = candidates.filter((p) => p.gender === 'F');

    const sameTierWD = findFairSameTierSameGender(
      activeFemales,
      options.avoidDuplicatePartners,
      effectiveAssignedCount,
      playerAssignedCount,
      allPlayers,
      options.avoidConsecutiveRests,
      options.mode
    );
    const sameTierMD = findFairSameTierSameGender(
      activeMales,
      options.avoidDuplicatePartners,
      effectiveAssignedCount,
      playerAssignedCount,
      allPlayers,
      options.avoidConsecutiveRests,
      options.mode
    );
    const sameTierXD =
      options.mode === 'doubles_only'
        ? null
        : findFairSameTierMixedGender(
            activeMales,
            activeFemales,
            options.avoidDuplicatePartners,
            effectiveAssignedCount,
            playerAssignedCount,
            allPlayers,
            options.avoidConsecutiveRests,
            options.mode
          );
    const minSameUsage = getMinTargetSameTierUsage();
    const availSameTierList = [sameTierWD, sameTierMD, sameTierXD]
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.usageCount - b.usageCount);
    const lowestAvailableSameTier = availSameTierList[0]?.tier;
    const minAvailSameUsage = availSameTierList[0]?.usageCount ?? Infinity;
    const preferSameTierNow =
      options.mode !== 'random' && shouldPreferSameTierMatch(lowestAvailableSameTier);

    const assignmentWeight = 15000;

    // 모드별 보너스 산출 (실력 밸런스/완전 랜덤 모드에서는 15게임당 3~4.5게임 약 25% 비율 적용)
    let wdBaseBonus = 35000;
    let mdBaseBonus = 35000;
    let xdBonus = 10000;

    if (options.mode === 'doubles_only') {
      wdBaseBonus = 60000;
      mdBaseBonus = 60000;
      xdBonus = -1000000;
    } else if (options.mode === 'mixed_preference') {
      // 혼복 우선 모드: 2남 2녀가 가능한 상황이면 정규 혼복(XD)을 최우선 편성
      wdBaseBonus = 5000;
      mdBaseBonus = 5000;
      xdBonus = 800000;
    } else {
      // 실력 밸런스 및 완전 랜덤: 복식(남복·여복) 약 75% : 혼복 약 25% (15게임당 3~4.5게임)
      wdBaseBonus = 35000;
      mdBaseBonus = 35000;

      if (activeFemales.length < 4 && activeMales.length < 4) {
        // 남복과 여복 모두 형성이 불가능한 성비(예: 남 2~3명, 여 2~3명)일 때는 혼복 우선
        xdBonus = 50000;
      } else {
        // 남복 또는 여복이 가능한 상태: 15게임당 3~4.5게임 (약 25%) 비율 관리
        const targetMixed = (sessionTotalCount + 1) * (3.75 / 15);
        const minMixed = (sessionTotalCount + 1) * (3.0 / 15);
        const maxMixed = (sessionTotalCount + 1) * (4.5 / 15);

        const deficit = targetMixed - sessionMixedCount;

        if (sessionMixedCount < minMixed || deficit >= 0.5) {
          // 혼복이 할당 비율(15게임당 3~4.5게임)보다 부족한 상황 -> 혼복 우선 편성
          xdBonus = 45000;
        } else if (sessionMixedCount >= maxMixed || deficit <= -0.5) {
          // 혼복이 이미 4.5게임 상한에 도달/초과된 상황 -> 남복/여복 강력 우선
          xdBonus = -30000;
        } else {
          // 정상 비율 범위: 남복/여복 75%가 우세하도록 기본 보너스 유지
          xdBonus = 15000 + deficit * 15000;
        }
      }
    }

    type MatchType = 'MD' | 'WD' | 'XD' | 'X3M' | 'X3F';
    const possibleTypes: {
      type: MatchType;
      score: number;
      preEval?: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
    }[] = [];

    // 1. Can we form 여복 (4 females)?
    if (activeFemales.length >= 4) {
      let tierBonus = 0;
      let wdEval: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'balanced' || options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
        wdEval = selectBalancedFourCandidates(
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        const tA = (TIER_SCORES[wdEval.teamA[0].tier] || 1) + (TIER_SCORES[wdEval.teamA[1].tier] || 1);
        const tB = (TIER_SCORES[wdEval.teamB[0].tier] || 1) + (TIER_SCORES[wdEval.teamB[1].tier] || 1);
        const diff = Math.abs(tA - tB);
        tierBonus = (3 - diff) * 3500;
      } else {
        wdEval = selectRandomFourSameGender(
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        tierBonus = (Math.random() - 0.5) * 8000;
      }
      const wdChosen = wdEval.chosen;
      const avgAssigned =
        wdChosen.reduce(
          (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
          0
        ) / 4;
      const restBonus = options.avoidConsecutiveRests
        ? wdChosen.filter((p) => (p.consecutiveRestRounds || 0) > 0).length * 40000 +
          wdChosen.reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0) * 15000
        : 0;
      let sameTierTypeBonus = 0;
      if (
        options.mode !== 'random' &&
        options.mode !== 'mixed_preference' &&
        preferSameTierNow &&
        sameTierWD &&
        sameTierWD.usageCount === minAvailSameUsage
      ) {
        sameTierTypeBonus = sameTierWD.usageCount <= minSameUsage ? 150000 : 40000;
      } else if (options.mode !== 'random' && !isSameTierFour(wdChosen)) {
        const breakPen = wdChosen.reduce(
          (sum, p) => sum + getUnplayedSameTierBreakPenalty(p, allPlayers, playerAssignedCount),
          0
        );
        sameTierTypeBonus -= breakPen;
      }
      const top6Females = activeFemales.slice(0, 6);
      const hasFemalePartnerPair = top6Females.some((f) =>
        activeFemales.some((other) => other.id !== f.id && areDesignatedPartners(f, other))
      );
      const partnerBonus = hasFemalePartnerPair ? 28000 : 0;
      const genderPoolDiffBonus = (activeFemales.length - activeMales.length) * 5000;
      const latePenalty = getLatePlayerEqualizationPenalty(wdChosen, allPlayers, playerAssignedCount) * 0.5;
      const matchDupPenalty =
        (getMatchOverlapPenalty(wdChosen, options.avoidDuplicatePartners) +
          getPairPenalty(wdEval.teamA[0], wdEval.teamA[1], options.avoidDuplicatePartners) +
          getPairPenalty(wdEval.teamB[0], wdEval.teamB[1], options.avoidDuplicatePartners) +
          getOpponentPenalty(wdEval.teamA, wdEval.teamB, options.avoidDuplicatePartners)) *
        0.25;
      possibleTypes.push({
        type: 'WD',
        preEval: wdEval,
        score:
          -avgAssigned * assignmentWeight +
          wdBaseBonus +
          restBonus +
          tierBonus +
          sameTierTypeBonus +
          partnerBonus +
          genderPoolDiffBonus -
          latePenalty -
          matchDupPenalty,
      });
    }

    // 2. Can we form 남복 (4 males)?
    if (activeMales.length >= 4) {
      let tierBonus = 0;
      let mdEval: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'balanced' || options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
        mdEval = selectBalancedFourCandidates(
          activeMales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        const tA = (TIER_SCORES[mdEval.teamA[0].tier] || 1) + (TIER_SCORES[mdEval.teamA[1].tier] || 1);
        const tB = (TIER_SCORES[mdEval.teamB[0].tier] || 1) + (TIER_SCORES[mdEval.teamB[1].tier] || 1);
        const diff = Math.abs(tA - tB);
        tierBonus = (3 - diff) * 3500;
      } else {
        mdEval = selectRandomFourSameGender(
          activeMales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        tierBonus = (Math.random() - 0.5) * 8000;
      }
      const mdChosen = mdEval.chosen;
      const avgAssigned =
        mdChosen.reduce(
          (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
          0
        ) / 4;
      const restBonus = options.avoidConsecutiveRests
        ? mdChosen.filter((p) => (p.consecutiveRestRounds || 0) > 0).length * 40000 +
          mdChosen.reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0) * 15000
        : 0;
      let sameTierTypeBonus = 0;
      if (
        options.mode !== 'random' &&
        options.mode !== 'mixed_preference' &&
        preferSameTierNow &&
        sameTierMD &&
        sameTierMD.usageCount === minAvailSameUsage
      ) {
        sameTierTypeBonus = sameTierMD.usageCount <= minSameUsage ? 150000 : 40000;
      } else if (options.mode !== 'random' && !isSameTierFour(mdChosen)) {
        const breakPen = mdChosen.reduce(
          (sum, p) => sum + getUnplayedSameTierBreakPenalty(p, allPlayers, playerAssignedCount),
          0
        );
        sameTierTypeBonus -= breakPen;
      }
      const top6Males = activeMales.slice(0, 6);
      const hasMalePartnerPair = top6Males.some((m) =>
        activeMales.some((other) => other.id !== m.id && areDesignatedPartners(m, other))
      );
      const partnerBonus = hasMalePartnerPair ? 28000 : 0;
      const genderPoolDiffBonus = (activeMales.length - activeFemales.length) * 5000;
      const latePenalty = getLatePlayerEqualizationPenalty(mdChosen, allPlayers, playerAssignedCount) * 0.5;
      const matchDupPenalty =
        (getMatchOverlapPenalty(mdChosen, options.avoidDuplicatePartners) +
          getPairPenalty(mdEval.teamA[0], mdEval.teamA[1], options.avoidDuplicatePartners) +
          getPairPenalty(mdEval.teamB[0], mdEval.teamB[1], options.avoidDuplicatePartners) +
          getOpponentPenalty(mdEval.teamA, mdEval.teamB, options.avoidDuplicatePartners)) *
        0.25;
      possibleTypes.push({
        type: 'MD',
        preEval: mdEval,
        score:
          -avgAssigned * assignmentWeight +
          mdBaseBonus +
          restBonus +
          tierBonus +
          sameTierTypeBonus +
          partnerBonus +
          genderPoolDiffBonus -
          latePenalty -
          matchDupPenalty,
      });
    }

    // 3. Can we form 혼복 (2 males + 2 females)?
    if (
      options.mode !== 'doubles_only' &&
      activeMales.length >= 2 &&
      activeFemales.length >= 2
    ) {
      let tierBonus = 0;
      let xdEval: { chosen: Player[]; teamA: [Player, Player]; teamB: [Player, Player] };
      if (options.mode === 'balanced' || options.mode === 'mixed_preference') {
        xdEval = selectBalancedMixedCandidates(
          activeMales,
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        const tA = (TIER_SCORES[xdEval.teamA[0].tier] || 1) + (TIER_SCORES[xdEval.teamA[1].tier] || 1);
        const tB = (TIER_SCORES[xdEval.teamB[0].tier] || 1) + (TIER_SCORES[xdEval.teamB[1].tier] || 1);
        const diff = Math.abs(tA - tB);
        tierBonus = (3 - diff) * 3500;
      } else {
        xdEval = selectRandomFourMixedGender(
          activeMales,
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        tierBonus = (Math.random() - 0.5) * 8000;
      }
      const xdChosen = xdEval.chosen;
      const avgAssigned =
        xdChosen.reduce(
          (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
          0
        ) / 4;
      const restBonus = options.avoidConsecutiveRests
        ? xdChosen.filter((p) => (p.consecutiveRestRounds || 0) > 0).length * 40000 +
          xdChosen.reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0) * 15000
        : 0;
      let sameTierTypeBonus = 0;
      if (options.mode !== 'random' && preferSameTierNow && sameTierXD && sameTierXD.usageCount === minAvailSameUsage) {
        sameTierTypeBonus = sameTierXD.usageCount <= minSameUsage ? 160000 : 45000;
      } else if (options.mode !== 'random' && !isSameTierFour(xdChosen)) {
        const breakPen = xdChosen.reduce(
          (sum, p) => sum + getUnplayedSameTierBreakPenalty(p, allPlayers, playerAssignedCount),
          0
        );
        sameTierTypeBonus -= breakPen;
      }
      const top4MalesForXD = activeMales.slice(0, 4);
      const top4FemalesForXD = activeFemales.slice(0, 4);
      const hasMixedPartnerPair =
        top4MalesForXD.some((m) => activeFemales.some((f) => areDesignatedPartners(m, f))) ||
        top4FemalesForXD.some((f) => activeMales.some((m) => areDesignatedPartners(f, m)));
      const partnerBonus = hasMixedPartnerPair ? 35000 : 0;
      const latePenalty =
        getLatePlayerEqualizationPenalty(xdChosen, allPlayers, playerAssignedCount) * 0.5;
      const matchDupPenalty =
        (getMatchOverlapPenalty(xdChosen, options.avoidDuplicatePartners) +
          getPairPenalty(xdEval.teamA[0], xdEval.teamA[1], options.avoidDuplicatePartners) +
          getPairPenalty(xdEval.teamB[0], xdEval.teamB[1], options.avoidDuplicatePartners) +
          getOpponentPenalty(xdEval.teamA, xdEval.teamB, options.avoidDuplicatePartners)) *
        0.25;

      possibleTypes.push({
        type: 'XD',
        preEval: xdEval,
        score:
          -avgAssigned * assignmentWeight +
          xdBonus +
          restBonus +
          tierBonus +
          sameTierTypeBonus +
          partnerBonus -
          latePenalty -
          matchDupPenalty,
      });
    }

    // 4. Can we form 3:1 혼복 (3 males + 1 female)?
    // 완전 랜덤 모드에서 정규 복식(4M/4F/2M2F) 형성이 불가능한 성비 불균형일 때만 허용
    if (
      options.mode === 'random' &&
      activeMales.length >= 3 &&
      activeFemales.length >= 1 &&
      activeMales.length < 4 &&
      activeFemales.length < 2
    ) {
      const top3Males = activeMales.slice(0, 3);
      const top1Female = activeFemales.slice(0, 1);
      const avgAssigned =
        (top3Males.reduce(
          (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
          0
        ) +
          top1Female.reduce(
            (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
            0
          )) /
        4;
      possibleTypes.push({ type: 'X3M', score: -avgAssigned * 10000 + 30000 });
    }

    // 5. Can we form 3:1 혼복 (3 females + 1 male)?
    // 완전 랜덤 모드에서 정규 복식(4M/4F/2M2F) 형성이 불가능한 성비 불균형일 때만 허용
    if (
      options.mode === 'random' &&
      activeFemales.length >= 3 &&
      activeMales.length >= 1 &&
      activeFemales.length < 4 &&
      activeMales.length < 2
    ) {
      const top3Females = activeFemales.slice(0, 3);
      const top1Male = activeMales.slice(0, 1);
      const avgAssigned =
        (top3Females.reduce(
          (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
          0
        ) +
          top1Male.reduce(
            (s, p) => s + (effectiveAssignedCount[p.id] ?? (playerAssignedCount[p.id] || 0)),
            0
          )) /
        4;
      possibleTypes.push({ type: 'X3F', score: -avgAssigned * 10000 + 30000 });
    }

    if (possibleTypes.length === 0) {
      break;
    }

    possibleTypes.sort((a, b) => b.score - a.score);
    const chosenEntry = possibleTypes[0];
    const chosenType = chosenEntry.type;

    let chosenPlayers: Player[] = [];
    let matchTitle = '경기';
    let teamA: [Player, Player];
    let teamB: [Player, Player];

    if (chosenType === 'MD') {
      matchTitle = '남복';
      const mdRes =
        chosenEntry.preEval ||
        selectBalancedFourCandidates(
          activeMales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
      chosenPlayers = mdRes.chosen;
      teamA = mdRes.teamA;
      teamB = mdRes.teamB;
    } else if (chosenType === 'WD') {
      matchTitle = '여복';
      const wdRes =
        chosenEntry.preEval ||
        selectBalancedFourCandidates(
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
      chosenPlayers = wdRes.chosen;
      teamA = wdRes.teamA;
      teamB = wdRes.teamB;
    } else if (chosenType === 'XD') {
      matchTitle = '혼복';
      const xdRes =
        chosenEntry.preEval ||
        selectBalancedMixedCandidates(
          activeMales,
          activeFemales,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
      chosenPlayers = xdRes.chosen;
      teamA = xdRes.teamA;
      teamB = xdRes.teamB;
    } else if (chosenType === 'X3M') {
      const topM = activeMales.slice(0, 3);
      const topF = activeFemales.slice(0, 1);
      chosenPlayers = [...topM, ...topF];
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(
        topF[0],
        [topM[0], topM[1], topM[2]],
        options.avoidDuplicatePartners,
        options.mode
      );
      teamA = balanced.teamA;
      teamB = balanced.teamB;
    } else {
      const topF = activeFemales.slice(0, 3);
      const topM = activeMales.slice(0, 1);
      chosenPlayers = [...topF, ...topM];
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(
        topM[0],
        [topF[0], topF[1], topF[2]],
        options.avoidDuplicatePartners,
        options.mode
      );
      teamA = balanced.teamA;
      teamB = balanced.teamB;
    }

    recordFormedMatchTierPattern(chosenPlayers);

    if (chosenType === 'XD' || chosenType === 'X3M' || chosenType === 'X3F') {
      sessionMixedCount++;
    }
    sessionTotalCount++;

    const newMatch: CourtMatch = {
      id: generateId(),
      courtNumber: 0,
      round: currentRoundNumber,
      teamA: {
        player1Id: teamA[0].id,
        player2Id: teamA[1].id,
        score: 0,
      },
      teamB: {
        player1Id: teamB[0].id,
        player2Id: teamB[1].id,
        score: 0,
      },
      status: 'queued',
      title: matchTitle,
      startedAt: Date.now(),
    };

    queuedMatches.push(newMatch);

    chosenPlayers.forEach((p) => {
      assignedPlayerIdsSet.add(p.id);
      playerAssignedCount[p.id] = (playerAssignedCount[p.id] || 0) + 1;
      p.consecutiveRestRounds = 0;
    });

    // Update in-memory consecutiveRestRounds when a full court wave completes in the queue
    const totalQueueNow = existingQueuedMatches.length + queuedMatches.length;
    if (totalQueueNow % effectiveCourtCount === 0) {
      const completedWave = [...existingQueuedMatches, ...queuedMatches].slice(-effectiveCourtCount);
      const wavePlayerIds = new Set<string>();
      completedWave.forEach((m) => {
        wavePlayerIds.add(m.teamA.player1Id);
        wavePlayerIds.add(m.teamA.player2Id);
        wavePlayerIds.add(m.teamB.player1Id);
        wavePlayerIds.add(m.teamB.player2Id);
      });
      activePlayers.forEach((ap) => {
        if (wavePlayerIds.has(ap.id)) {
          ap.consecutiveRestRounds = 0;
        } else {
          ap.consecutiveRestRounds = (ap.consecutiveRestRounds || 0) + 1;
        }
      });
    }

    // Update in-memory partner and opponent history for cloned candidate players so subsequent matches in this batch avoid duplicate assigned matches
    updateInMemoryMatchHistory(activePlayers, teamA, teamB);
  }

  if (queuedMatches.length === 0) {
    const malesCount = activePlayers.filter((p) => p.gender === 'M').length;
    const femalesCount = activePlayers.filter((p) => p.gender === 'F').length;
    if (options.mode === 'doubles_only') {
      throw new Error(
        `복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. (현재 출전 가능: 남 ${malesCount}명, 여 ${femalesCount}명)`
      );
    }
    throw new Error(
      `복식 경기를 편성하기 위한 대기 인원이 부족합니다. (현재 출전 가능: 남 ${malesCount}명, 여 ${femalesCount}명)`
    );
  }

  return {
    queuedMatches,
    assignedPlayerIds: Array.from(assignedPlayerIdsSet),
  };
}

/**
 * Automatically draws 4 available players and creates a doubles match for a single court slot.
 */
export function generateSingleCourtMatch(
  allPlayers: Player[],
  options: MatchOptions,
  currentRoundNumber: number,
  courtNumber: number,
  alreadyPlayingPlayerIds: Set<string> = new Set(),
  existingQueuedMatches: CourtMatch[] = [],
  activeMatches: CourtMatch[] = [],
  dryRun: boolean = false
): {
  match: CourtMatch;
  assignedPlayerIds: string[];
} {
  const activePlayers = allPlayers.filter(
    (p) =>
      !alreadyPlayingPlayerIds.has(p.id) &&
      isPlayerEligibleForMatchmaking(p, alreadyPlayingPlayerIds, existingQueuedMatches)
  );

  if (activePlayers.length < 4) {
    throw new Error('현재 코트에 배정 가능한 대기 선수가 4명 미만입니다. (휴식중/레슨중/마지막판완료 제외)');
  }

  // Calculate each player's queued occurrence count and merge queued/active partner history
  const playerQueuedCount: Record<string, number> = {};
  existingQueuedMatches.forEach((m) => {
    const pA1 = m.teamA?.player1Id;
    const pA2 = m.teamA?.player2Id;
    const pB1 = m.teamB?.player1Id;
    const pB2 = m.teamB?.player2Id;

    [pA1, pA2, pB1, pB2].forEach((id) => {
      if (id) playerQueuedCount[id] = (playerQueuedCount[id] || 0) + 1;
    });
  });

  const candidatesWithHistory = mergeQueuedPartnerHistory(
    activePlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );

  const rawAssignedMap: Record<string, number> = {};
  candidatesWithHistory.forEach((p) => {
    rawAssignedMap[p.id] = p.gamesPlayed + (playerQueuedCount[p.id] || 0);
  });

  const effectiveCourtCount = Math.max(1, options.courtCount || 1);
  const recentPlayedOrQueuedIds = new Set<string>([...alreadyPlayingPlayerIds]);
  existingQueuedMatches.slice(-effectiveCourtCount).forEach((m) => {
    recentPlayedOrQueuedIds.add(m.teamA.player1Id);
    recentPlayedOrQueuedIds.add(m.teamA.player2Id);
    recentPlayedOrQueuedIds.add(m.teamB.player1Id);
    recentPlayedOrQueuedIds.add(m.teamB.player2Id);
  });
  candidatesWithHistory.forEach((p) => {
    if (
      (p.consecutiveRestRounds || 0) === 0 &&
      (p.gamesPlayed || 0) > (p.restStartGamesPlayed ?? 0)
    ) {
      recentPlayedOrQueuedIds.add(p.id);
    }
  });

  const effectiveAssignedMap = computeEffectiveAssignedMap(
    candidatesWithHistory,
    rawAssignedMap,
    recentPlayedOrQueuedIds,
    allPlayers
  );

  // Prioritize resting players fairly:
  // 1. Lowest effective assignment count (gamesPlayed + in queue + latecomer/rest offset)
  // 2. Highest consecutive rest rounds (unless comparing early vs latecomer/rested with different effective counts)
  // 3. Lowest gamesPlayed & earlier registration timestamp
  const sortedCandidates = [...candidatesWithHistory].sort((a, b) => {
    const aIsLate = isLateRegisteredPlayer(a, allPlayers);
    const bIsLate = isLateRegisteredPlayer(b, allPlayers);
    const aLateConsecutive = aIsLate && recentPlayedOrQueuedIds.has(a.id) ? 1 : 0;
    const bLateConsecutive = bIsLate && recentPlayedOrQueuedIds.has(b.id) ? 1 : 0;
    if (aLateConsecutive !== bLateConsecutive) {
      return aLateConsecutive - bLateConsecutive;
    }

    const aTotalAssigned = effectiveAssignedMap[a.id] ?? rawAssignedMap[a.id];
    const bTotalAssigned = effectiveAssignedMap[b.id] ?? rawAssignedMap[b.id];
    // S조 가중치(0.65배) 적용
    const aEffAssigned = a.tier === 'S' ? aTotalAssigned * 0.65 : aTotalAssigned;
    const bEffAssigned = b.tier === 'S' ? bTotalAssigned * 0.65 : bTotalAssigned;

    if ((aIsLate || bIsLate) && Math.abs(aEffAssigned - bEffAssigned) >= 0.5) {
      return aEffAssigned - bEffAssigned;
    }

    // 직전 경기 휴식자 우선 출전 (연속 대기 방지) 활성화 시:
    if (options.avoidConsecutiveRests) {
      // 1. 직전 경기 휴식자(consecutiveRestRounds > 0)를 방금 경기를 마친 선수(consecutiveRestRounds === 0)보다 최우선 선발
      const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
      const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
      if (bRested !== aRested) {
        return bRested - aRested;
      }
      // 2. 휴식 라운드가 더 많은 선수를 우선 출전 (연속 대기 방지)
      if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
        return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
      }
    }

    if (aEffAssigned !== bEffAssigned) {
      return aEffAssigned - bEffAssigned;
    }
    const aGames = a.tier === 'S' ? a.gamesPlayed * 0.65 : a.gamesPlayed;
    const bGames = b.tier === 'S' ? b.gamesPlayed * 0.65 : b.gamesPlayed;
    if (aGames !== bGames) {
      return aGames - bGames;
    }
    if (a.tier === 'S' && b.tier !== 'S') return -1;
    if (b.tier === 'S' && a.tier !== 'S') return 1;
    const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
    if (Math.abs(regDiff) >= 60000) return regDiff;
    if (!dryRun && (!options.avoidConsecutiveRests || options.mode === 'random')) {
      return Math.random() - 0.5;
    }
    if (regDiff !== 0) return regDiff;
    return 0;
  });

  const males = sortedCandidates.filter((p) => p.gender === 'M');
  const females = sortedCandidates.filter((p) => p.gender === 'F');

  // Candidate pool size to evaluate combinations (take top candidates of each gender and promote designated partners of top candidates into the pool)
  const POOL_LIMIT = 12;
  const poolMales = prioritizePartnersForSelection(males, POOL_LIMIT, effectiveAssignedMap).slice(
    0,
    Math.min(POOL_LIMIT, males.length)
  );
  const poolFemales = prioritizePartnersForSelection(females, POOL_LIMIT, effectiveAssignedMap).slice(
    0,
    Math.min(POOL_LIMIT, females.length)
  );

  // 상위 대기자의 혼복 지정 파트너가 후보 풀 바깥에 있다면 풀 내부로 합류시켜 같은 코트 배정 기회 보장
  for (const m of males.slice(0, 4)) {
    if (m.partnerId && !poolFemales.some((f) => f.id === m.partnerId)) {
      const fPartner = females.find((f) => f.id === m.partnerId);
      if (fPartner) {
        if (poolFemales.length < POOL_LIMIT) poolFemales.push(fPartner);
        else poolFemales[poolFemales.length - 1] = fPartner;
      }
    }
  }
  for (const f of females.slice(0, 4)) {
    if (f.partnerId && !poolMales.some((m) => m.id === f.partnerId)) {
      const mPartner = males.find((m) => m.id === f.partnerId);
      if (mPartner) {
        if (poolMales.length < POOL_LIMIT) poolMales.push(mPartner);
        else poolMales[poolMales.length - 1] = mPartner;
      }
    }
  }

  // Minimum assigned count within each gender to evaluate fairness without cross-gender distortion
  const nonSMales = males.filter((p) => p.tier !== 'S');
  const nonSFemales = females.filter((p) => p.tier !== 'S');

  const minMaleAssigned =
    males.length > 0
      ? Math.min(...males.map((p) => effectiveAssignedMap[p.id] ?? rawAssignedMap[p.id]))
      : 0;
  const minMaleNonSAssigned =
    nonSMales.length > 0
      ? Math.min(...nonSMales.map((p) => effectiveAssignedMap[p.id] ?? rawAssignedMap[p.id]))
      : minMaleAssigned;

  const minFemaleAssigned =
    females.length > 0
      ? Math.min(...females.map((p) => effectiveAssignedMap[p.id] ?? rawAssignedMap[p.id]))
      : 0;
  const minFemaleNonSAssigned =
    nonSFemales.length > 0
      ? Math.min(...nonSFemales.map((p) => effectiveAssignedMap[p.id] ?? rawAssignedMap[p.id]))
      : minFemaleAssigned;

  // Track session matches for precise Doubles (~75%) vs Mixed (~25%) ratio control (15게임당 3~4.5게임 기준)
  const sessionTotalCount = options.totalSessionMatches ?? existingQueuedMatches.length;
  const sessionMixedCount =
    options.mixedSessionMatches ??
    existingQueuedMatches.filter((m) => m.title?.includes('혼복')).length;

  const sameTierWD = findFairSameTierSameGender(
    females,
    options.avoidDuplicatePartners,
    effectiveAssignedMap,
    rawAssignedMap,
    allPlayers,
    options.avoidConsecutiveRests,
    options.mode
  );
  const sameTierMD = findFairSameTierSameGender(
    males,
    options.avoidDuplicatePartners,
    effectiveAssignedMap,
    rawAssignedMap,
    allPlayers,
    options.avoidConsecutiveRests,
    options.mode
  );
  const sameTierXD =
    options.mode === 'doubles_only'
      ? null
      : findFairSameTierMixedGender(
          males,
          females,
          options.avoidDuplicatePartners,
          effectiveAssignedMap,
          rawAssignedMap,
          allPlayers,
          options.avoidConsecutiveRests,
          options.mode
        );
  const minSameUsage = getMinTargetSameTierUsage();
  const availSameList = [sameTierWD, sameTierMD, sameTierXD]
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.usageCount - b.usageCount);
  const lowestAvailableSameTier = availSameList[0]?.tier;
  const minAvailSameUsage = availSameList[0]?.usageCount ?? Infinity;
  const preferSameTierNow =
    options.mode !== 'random' && shouldPreferSameTierMatch(lowestAvailableSameTier);

  // Determine base bonuses for MD, WD, and XD based on mode and session ratio
  let mdBaseBonus = 45000;
  let wdBaseBonus = 45000;
  let xdBaseBonus = 10000;

  if (options.mode === 'doubles_only') {
    // 복식 우선 모드: 남복(4M) 및 여복(4F) 전용 (혼복 배제)
    mdBaseBonus = 60000;
    wdBaseBonus = 60000;
    xdBaseBonus = -1000000;
  } else if (options.mode === 'mixed_preference') {
    // 혼복 우선 모드: 2남 2녀가 가능한 상황이면 코트 단일 매칭 시 혼복 최우선 배정
    mdBaseBonus = 5000;
    wdBaseBonus = 5000;
    xdBaseBonus = 800000;
  } else {
    // 실력 밸런스 및 완전 랜덤: 복식(남복·여복) 약 75% : 혼복 약 25% (15게임당 3~4.5게임)
    // 남복 또는 여복 형성이 불가능한 성비 (예: 남 2~3명, 여 2~3명)일 때는 정규 혼복(2M+2F) 우선 편성
    if (males.length < 4 && females.length < 4) {
      xdBaseBonus = 50000;
    } else {
      // 15게임당 3~4.5게임 (평균 3.75/15 = 약 25%) 목표치
      const targetMixed = (sessionTotalCount + 1) * (3.75 / 15);
      const minMixed = (sessionTotalCount + 1) * (3.0 / 15);
      const maxMixed = (sessionTotalCount + 1) * (4.5 / 15);
      const deficit = targetMixed - sessionMixedCount;

      if (sessionMixedCount < minMixed || deficit >= 0.5) {
        // 혼복이 할당 목표치보다 부족함 -> 혼복 우선 보충
        xdBaseBonus = 42000;
      } else if (sessionMixedCount >= maxMixed || deficit <= -0.5) {
        // 혼복이 이미 상한선(4.5게임/15)에 도달/초과됨 -> 남복/여복 강력 우선
        xdBaseBonus = -30000;
      } else {
        // 정상 비율 범위: 남복/여복 75%가 우세하도록 XD는 기본 10,000점 유지
        xdBaseBonus = 10000 + deficit * 15000;
      }
    }

    // 상위 대기자 중 지정 파트너 쌍이 존재할 때 해당 종목 가산점 부여 (같은 코트 배정률 +20% 향상)
    const hasTopMixedPartner =
      males.slice(0, 4).some((m) => poolFemales.some((f) => areDesignatedPartners(m, f))) ||
      females.slice(0, 4).some((f) => poolMales.some((m) => areDesignatedPartners(f, m)));
    if (hasTopMixedPartner) {
      xdBaseBonus += 35000;
    }
    const hasTopMalePartner = males
      .slice(0, 4)
      .some((m) => poolMales.some((other) => other.id !== m.id && areDesignatedPartners(m, other)));
    if (hasTopMalePartner) {
      mdBaseBonus += 20000;
    }
    const hasTopFemalePartner = females
      .slice(0, 4)
      .some((f) => poolFemales.some((other) => other.id !== f.id && areDesignatedPartners(f, other)));
    if (hasTopFemalePartner) {
      wdBaseBonus += 20000;
    }
  }

  // 남복과 여복 간 우선순위: 직전 경기 휴식자 우선 출전(avoidConsecutiveRests) 활성화 시 더 오래 대기했거나 휴식 라운드가 많은 성별에 가산점
  if (options.avoidConsecutiveRests) {
    const avgMaleRests =
      males.slice(0, 4).reduce((sum, p) => sum + p.consecutiveRestRounds, 0) /
      Math.max(1, Math.min(4, males.length));
    const avgFemaleRests =
      females.slice(0, 4).reduce((sum, p) => sum + p.consecutiveRestRounds, 0) /
      Math.max(1, Math.min(4, females.length));
    if (avgMaleRests > avgFemaleRests) {
      mdBaseBonus += (avgMaleRests - avgFemaleRests) * 3000;
    } else if (avgFemaleRests > avgMaleRests) {
      wdBaseBonus += (avgFemaleRests - avgMaleRests) * 3000;
    }
  }

  type EvaluatedOption = {
    type: 'MD' | 'WD' | 'XD' | 'X3M' | 'X3F';
    title: string;
    players: Player[];
    teamA: [Player, Player];
    teamB: [Player, Player];
    tierDiff: number;
    score: number;
  };

  const candidateOptions: EvaluatedOption[] = [];
  const mdRandomTypeJitter = !dryRun && options.mode === 'random' ? (Math.random() - 0.5) * 18000 : 0;
  const wdRandomTypeJitter = !dryRun && options.mode === 'random' ? (Math.random() - 0.5) * 18000 : 0;
  const xdRandomTypeJitter = !dryRun && options.mode === 'random' ? (Math.random() - 0.5) * 18000 : 0;

  const evaluateCandidateFour = (fourPlayers: Player[], type: 'MD' | 'WD' | 'XD', title: string) => {
    let balancedResult: { teamA: [Player, Player]; teamB: [Player, Player] };
    if (type === 'XD') {
      const m = fourPlayers.filter((p) => p.gender === 'M');
      const f = fourPlayers.filter((p) => p.gender === 'F');
      if (m.length !== 2 || f.length !== 2) return;
      balancedResult = balanceMixedDoublesFour(
        m[0],
        m[1],
        f[0],
        f[1],
        options.avoidDuplicatePartners,
        options.mode
      );
    } else {
      balancedResult = balanceDoublesFour(
        fourPlayers[0],
        fourPlayers[1],
        fourPlayers[2],
        fourPlayers[3],
        options.avoidDuplicatePartners,
        options.mode
      );
    }

    const { teamA, teamB } = balancedResult;
    const scoreA = (TIER_SCORES[teamA[0].tier] || 1) + (TIER_SCORES[teamA[1].tier] || 1);
    const scoreB = (TIER_SCORES[teamB[0].tier] || 1) + (TIER_SCORES[teamB[1].tier] || 1);
    const tierDiff = Math.abs(scoreA - scoreB);

    // 1. 성별 내 공정성 평가 (Gender-relative fairness ranking)
    // 지정 파트너와 함께 같은 코트에 배정되는 경우에는 순번 페널티를 완화하여 동반 배정률 향상
    let rankPenalty = 0;
    if (type === 'MD') {
      rankPenalty = fourPlayers.reduce((sum, p) => {
        const hasPartnerInFour = fourPlayers.some((other) => other.id !== p.id && areDesignatedPartners(p, other));
        const rawRank = Math.max(0, males.indexOf(p) - 3);
        return sum + (hasPartnerInFour ? rawRank * 0.3 : rawRank);
      }, 0);
    } else if (type === 'WD') {
      rankPenalty = fourPlayers.reduce((sum, p) => {
        const hasPartnerInFour = fourPlayers.some((other) => other.id !== p.id && areDesignatedPartners(p, other));
        const rawRank = Math.max(0, females.indexOf(p) - 3);
        return sum + (hasPartnerInFour ? rawRank * 0.3 : rawRank);
      }, 0);
    } else if (type === 'XD') {
      rankPenalty = fourPlayers.reduce((sum, p) => {
        const hasPartnerInFour = fourPlayers.some((other) => other.id !== p.id && areDesignatedPartners(p, other));
        const idx = p.gender === 'M' ? males.indexOf(p) : females.indexOf(p);
        const rawRank = Math.max(0, idx - 1);
        return sum + (hasPartnerInFour ? rawRank * 0.3 : rawRank);
      }, 0);
    }

    // 2. 성별 내 초과 배정 게임 수 (Slot-by-slot excess over top available players of that gender)
    // 파트너와 함께 코트에 들어가는 경우 1게임 내외의 소폭 차이는 감점을 대폭 완화
    const getEff = (p: Player) => {
      const e = effectiveAssignedMap[p.id] ?? rawAssignedMap[p.id] ?? 0;
      return p.tier === 'S' ? e * 0.65 : e;
    };
    const mBaseEffs = [0, 1, 2, 3].map((idx) =>
      males[idx] ? getEff(males[idx]) : minMaleAssigned
    );
    const fBaseEffs = [0, 1, 2, 3].map((idx) =>
      females[idx] ? getEff(females[idx]) : minFemaleAssigned
    );
    const mInFour = fourPlayers
      .filter((p) => p.gender === 'M')
      .sort((a, b) => getEff(a) - getEff(b));
    const fInFour = fourPlayers
      .filter((p) => p.gender === 'F')
      .sort((a, b) => getEff(a) - getEff(b));

    let excessAssigned = 0;
    mInFour.forEach((p, idx) => {
      const rawExcess = Math.max(0, getEff(p) - (mBaseEffs[idx] ?? minMaleAssigned));
      const hasPartnerInFour = fourPlayers.some(
        (other) => other.id !== p.id && areDesignatedPartners(p, other)
      );
      excessAssigned += hasPartnerInFour && rawExcess <= 1.5 ? rawExcess * 0.35 : rawExcess;
    });
    fInFour.forEach((p, idx) => {
      const rawExcess = Math.max(0, getEff(p) - (fBaseEffs[idx] ?? minFemaleAssigned));
      const hasPartnerInFour = fourPlayers.some(
        (other) => other.id !== p.id && areDesignatedPartners(p, other)
      );
      excessAssigned += hasPartnerInFour && rawExcess <= 1.5 ? rawExcess * 0.35 : rawExcess;
    });

    const avgEffAssigned =
      fourPlayers.reduce((sum, p) => sum + getEff(p), 0) / Math.max(1, fourPlayers.length);

    const totalRests = fourPlayers.reduce((sum, p) => sum + p.consecutiveRestRounds, 0);
    const lateEqualPenalty = getLatePlayerEqualizationPenalty(
      fourPlayers,
      allPlayers,
      rawAssignedMap,
      undefined,
      recentPlayedOrQueuedIds
    );

    let score = 0;

    // 공정성 점수 반영: 적게 뛴 선수 및 오래 쉰 선수 우선 배정
    score -= excessAssigned * 80000;
    score -= avgEffAssigned * 15000;
    // 늦게 등록되었거나 휴식 후 복귀한 선수가 일찍 온 선수와 동일한 게임 수가 되거나 연속 경기에 배정되는 경우 강력 페널티 부여
    score -= lateEqualPenalty;
    if (options.avoidConsecutiveRests) {
      score += totalRests * 30000;
      const restedInFour = fourPlayers.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
      if (type === 'MD') {
        const reqMD = inferRequiredRestedCount(poolMales.slice(0, 4), males, effectiveAssignedMap, true);
        const topRestMD = poolMales.slice(0, 4).reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        score -= Math.max(0, reqMD - restedInFour) * 300000;
        score -= Math.max(0, topRestMD - totalRests) * 150000;
      } else if (type === 'WD') {
        const reqWD = inferRequiredRestedCount(poolFemales.slice(0, 4), females, effectiveAssignedMap, true);
        const topRestWD = poolFemales.slice(0, 4).reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        score -= Math.max(0, reqWD - restedInFour) * 300000;
        score -= Math.max(0, topRestWD - totalRests) * 150000;
      } else if (type === 'XD') {
        const reqM = inferRequiredRestedCount(poolMales.slice(0, 2), males, effectiveAssignedMap, true);
        const reqF = inferRequiredRestedCount(poolFemales.slice(0, 2), females, effectiveAssignedMap, true);
        const restedM = fourPlayers.filter((p) => p.gender === 'M' && (p.consecutiveRestRounds || 0) > 0).length;
        const restedF = fourPlayers.filter((p) => p.gender === 'F' && (p.consecutiveRestRounds || 0) > 0).length;
        const topRestM = poolMales.slice(0, 2).reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        const topRestF = poolFemales.slice(0, 2).reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        const curRestM = fourPlayers.filter((p) => p.gender === 'M').reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        const curRestF = fourPlayers.filter((p) => p.gender === 'F').reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
        score -= (Math.max(0, reqM - restedM) + Math.max(0, reqF - restedF)) * 300000;
        score -= (Math.max(0, topRestM - curRestM) + Math.max(0, topRestF - curRestF)) * 150000;
      }
    }

    const allSame = isSameTierFour(fourPlayers);

    if (options.mode !== 'random') {
      if (options.avoidConsecutiveRests) {
        score -= preferSameTierNow && allSame ? rankPenalty * 2000 : rankPenalty * 15000;

        // 전체 대기 1순위 선수 (가장 오래 쉰 선수) 포함 시 강력한 가산점
        if (sortedCandidates.length > 0 && fourPlayers.some((p) => p.id === sortedCandidates[0].id)) {
          score += 40000;
        }

        // 각 성별 대기 1순위 포함 가산점 (남복/여복/혼복 동등)
        if (type === 'MD' && poolMales.length > 0 && fourPlayers.some((p) => p.id === poolMales[0].id)) {
          score += 30000;
        }
        if (type === 'WD' && poolFemales.length > 0 && fourPlayers.some((p) => p.id === poolFemales[0].id)) {
          score += 30000;
        }
        if (type === 'XD') {
          if (poolMales.length > 0 && fourPlayers.some((p) => p.id === poolMales[0].id)) score += 15000;
          if (poolFemales.length > 0 && fourPlayers.some((p) => p.id === poolFemales[0].id)) score += 15000;
        }
      } else {
        // 직전 경기 휴식자 우선 출전 비체크 시: 동일 게임 수 내에서는 급수 밸런스/중복 방지가 우선 작동하도록 소폭의 순번 타이브레이커만 적용
        score -= rankPenalty * 25;
      }
    }

    // 동일 급수 4명(A 4명, B 4명, C 4명, D 4명, 초심 4명) 및 초심~S 혼합 경기 교차 보너스 (완전 랜덤 제외)
    if (options.mode !== 'random') {
      if (preferSameTierNow && allSame && excessAssigned <= 0.25 && lateEqualPenalty === 0) {
        const tUsage = getSameTierUsageCount(fourPlayers[0].tier);
        if (
          tUsage === minAvailSameUsage &&
          !(options.mode === 'mixed_preference' && (type === 'MD' || type === 'WD'))
        ) {
          score += 240000 - tUsage * 30000;
        }
      } else if (!preferSameTierNow) {
        if (allSame) {
          score -= 45000;
        } else {
          for (const p of fourPlayers) {
            score -= getUnplayedSameTierBreakPenalty(p, allPlayers, rawAssignedMap);
          }
        }
      }
    }

    // 종목별 기본 보너스 (남복/여복 75% : 혼복 25% 가이드라인 반영)
    if (type === 'MD') score += mdBaseBonus;
    else if (type === 'WD') score += wdBaseBonus;
    else if (type === 'XD') score += xdBaseBonus;

    // 이전 배정 경기(파트너+상대+4인 구성) 중복 페널티 및 지정 클럽 파트너 보너스 + 같은 코트 동반 배정 보너스 반영
    const pairPenalty =
      getPairPenalty(teamA[0], teamA[1], options.avoidDuplicatePartners) +
      getPairPenalty(teamB[0], teamB[1], options.avoidDuplicatePartners) +
      getOpponentPenalty(teamA, teamB, options.avoidDuplicatePartners) +
      getMatchOverlapPenalty(fourPlayers, options.avoidDuplicatePartners);
    score -= pairPenalty;
    score += getSameCourtPartnerBonus(fourPlayers);

    // 급수 밸런스(tierDiff) 반영
    if (options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
      score -= tierDiff * 10000;
      if (tierDiff === 0) score += 20000;
      else if (tierDiff === 1) score += 12000;
      else if (tierDiff === 2) score += 5000;
      else score -= (tierDiff - 2) * 10000;
    } else if (options.mode === 'balanced') {
      score -= tierDiff * 12000;
      if (tierDiff === 0) score += 20000;
      else if (tierDiff === 1) score += 12000;
      else if (tierDiff === 2) score += 5000;
      else score -= (tierDiff - 2) * 10000;
    } else {
      // options.mode === 'random': 완전 랜덤 무작위 추첨 (급수 차이 감점 없음, 조합 개수 비대칭 보정)
      const typeJitter =
        type === 'MD' ? mdRandomTypeJitter : type === 'WD' ? wdRandomTypeJitter : xdRandomTypeJitter;
      score += typeJitter + (dryRun ? 0 : (Math.random() - 0.5) * 12000);
    }

    candidateOptions.push({
      type,
      title,
      players: fourPlayers,
      teamA,
      teamB,
      tierDiff,
      score,
    });
  };

  // 1. Evaluate Men's Doubles (남복 4M)
  if (poolMales.length >= 4) {
    for (let i = 0; i < poolMales.length - 3; i++) {
      for (let j = i + 1; j < poolMales.length - 2; j++) {
        for (let k = j + 1; k < poolMales.length - 1; k++) {
          for (let l = k + 1; l < poolMales.length; l++) {
            evaluateCandidateFour(
              [poolMales[i], poolMales[j], poolMales[k], poolMales[l]],
              'MD',
              '남복'
            );
          }
        }
      }
    }
  }

  // 2. Evaluate Women's Doubles (여복 4F)
  if (poolFemales.length >= 4) {
    for (let i = 0; i < poolFemales.length - 3; i++) {
      for (let j = i + 1; j < poolFemales.length - 2; j++) {
        for (let k = j + 1; k < poolFemales.length - 1; k++) {
          for (let l = k + 1; l < poolFemales.length; l++) {
            evaluateCandidateFour(
              [poolFemales[i], poolFemales[j], poolFemales[k], poolFemales[l]],
              'WD',
              '여복'
            );
          }
        }
      }
    }
  }

  // 3. Evaluate Mixed Doubles (혼복 2M + 2F)
  if (
    options.mode !== 'doubles_only' &&
    poolMales.length >= 2 &&
    poolFemales.length >= 2
  ) {
    for (let i = 0; i < poolMales.length - 1; i++) {
      for (let j = i + 1; j < poolMales.length; j++) {
        for (let k = 0; k < poolFemales.length - 1; k++) {
          for (let l = k + 1; l < poolFemales.length; l++) {
            const fourCand = [poolMales[i], poolMales[j], poolFemales[k], poolFemales[l]];
            evaluateCandidateFour(fourCand, 'XD', '혼복');
          }
        }
      }
    }
  }

  // 4. In random mode: 정규 복식(4M/4F/2M2F) 형성이 불가능한 성비 불균형 시 3:1 (3M+1F or 3F+1M) 후보 평가
  if (options.mode === 'random') {
    if (poolMales.length >= 3 && poolFemales.length >= 1 && poolFemales.length < 2 && poolMales.length < 4) {
      const top3M = poolMales.slice(0, 3);
      const top1F = poolFemales[0];
      const balanced = balanceThreeAndOne(top1F, [top3M[0], top3M[1], top3M[2]], options.avoidDuplicatePartners, options.mode);
      candidateOptions.push({
        type: 'X3M',
        title: '혼복(3:1)',
        players: [top1F, ...top3M],
        teamA: balanced.teamA,
        teamB: balanced.teamB,
        tierDiff: 0,
        score: 30000 + (Math.random() - 0.5) * 40000,
      });
    }
    if (poolFemales.length >= 3 && poolMales.length >= 1 && poolMales.length < 2 && poolFemales.length < 4) {
      const top3F = poolFemales.slice(0, 3);
      const top1M = poolMales[0];
      const balanced = balanceThreeAndOne(top1M, [top3F[0], top3F[1], top3F[2]], options.avoidDuplicatePartners, options.mode);
      candidateOptions.push({
        type: 'X3F',
        title: '혼복(3:1)',
        players: [top1M, ...top3F],
        teamA: balanced.teamA,
        teamB: balanced.teamB,
        tierDiff: 0,
        score: 30000 + (Math.random() - 0.5) * 40000,
      });
    }
  }

  // 5. Fallback if no pure standard 4M, 4F, or 2M+2F can be formed from pool:
  // (e.g. only 3 males and 1 female, and options.mode === 'random')
  if (candidateOptions.length === 0 && options.mode === 'random') {
    if (males.length >= 3 && females.length >= 1) {
      const top3M = males.slice(0, 3);
      const top1F = females[0];
      const balanced = balanceThreeAndOne(top1F, [top3M[0], top3M[1], top3M[2]], options.avoidDuplicatePartners, options.mode);
      candidateOptions.push({
        type: 'X3M',
        title: '혼복(3:1)',
        players: [top1F, ...top3M],
        teamA: balanced.teamA,
        teamB: balanced.teamB,
        tierDiff: 0,
        score: 0,
      });
    } else if (females.length >= 3 && males.length >= 1) {
      const top3F = females.slice(0, 3);
      const top1M = males[0];
      const balanced = balanceThreeAndOne(top1M, [top3F[0], top3F[1], top3F[2]], options.avoidDuplicatePartners, options.mode);
      candidateOptions.push({
        type: 'X3F',
        title: '혼복(3:1)',
        players: [top1M, ...top3F],
        teamA: balanced.teamA,
        teamB: balanced.teamB,
        tierDiff: 0,
        score: 0,
      });
    }
  }

  if (candidateOptions.length === 0) {
    if (options.mode === 'doubles_only') {
      throw new Error(
        `복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. (대기 중: 남 ${males.length}명, 여 ${females.length}명)`
      );
    }
    throw new Error(
      `복식(남복, 여복, 혼복) 구성이 가능한 대기 선수가 부족합니다. (대기 중: 남 ${males.length}명, 여 ${females.length}명)`
    );
  }

  candidateOptions.sort((a, b) => b.score - a.score);
  const best = candidateOptions[0];
  if (!dryRun) {
    recordFormedMatchTierPattern(best.players);
  }

  const match: CourtMatch = {
    id: generateId(),
    courtNumber,
    round: currentRoundNumber,
    teamA: {
      player1Id: best.teamA[0].id,
      player2Id: best.teamA[1].id,
      score: 0,
    },
    teamB: {
      player1Id: best.teamB[0].id,
      player2Id: best.teamB[1].id,
      score: 0,
    },
    status: 'waiting',
    title: best.title,
    startedAt: Date.now(),
  };

  return {
    match,
    assignedPlayerIds: best.players.map((p) => p.id),
  };
}

/**
 * Helper to pick supplementary candidates from pool that achieve the best tier balance
 */
function pickBestSupplementaryCandidates(
  selected: Player[],
  candidates: Player[],
  neededCount: number,
  isMixed: boolean,
  avoidDuplicatePartners: boolean,
  avoidConsecutiveRests: boolean = true
): Player[] {
  if (candidates.length <= neededCount) {
    return candidates.slice(0, neededCount);
  }

  const pool = prioritizePartnersForSelection(candidates, 8).slice(0, Math.min(8, candidates.length));
  const topRestedCount = avoidConsecutiveRests
    ? pool.slice(0, neededCount).filter((p) => (p.consecutiveRestRounds || 0) > 0).length
    : 0;
  const topRestSum = avoidConsecutiveRests
    ? pool.slice(0, neededCount).reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0)
    : 0;
  const getRestPenalty = (picked: Player[]) => {
    if (!avoidConsecutiveRests) return 0;
    const pickedRested = picked.filter((p) => (p.consecutiveRestRounds || 0) > 0).length;
    const pickedRestSum = picked.reduce((s, p) => s + (p.consecutiveRestRounds || 0), 0);
    return (
      Math.max(0, topRestedCount - pickedRested) * 300000 +
      Math.max(0, topRestSum - pickedRestSum) * 150000
    );
  };

  if (neededCount === 1) {
    let best = [pool[0]];
    let bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const four = [...selected, pool[i]];
      let diff = 0;
      let penalty = 0;
      if (
        isMixed &&
        four.filter((p) => p.gender === 'M').length === 2 &&
        four.filter((p) => p.gender === 'F').length === 2
      ) {
        const m = four.filter((p) => p.gender === 'M');
        const f = four.filter((p) => p.gender === 'F');
        const bal = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], avoidDuplicatePartners, 'balanced');
        const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
        const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
        diff = Math.abs(sA - sB);
        penalty =
          getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
          getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
          getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
          getMatchOverlapPenalty(four, avoidDuplicatePartners) -
          getSameCourtPartnerBonus(four);
      } else if (four.length === 4) {
        const bal = balanceDoublesFour(four[0], four[1], four[2], four[3], avoidDuplicatePartners, 'balanced');
        const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
        const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
        diff = Math.abs(sA - sB);
        penalty =
          getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
          getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
          getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
          getMatchOverlapPenalty(four, avoidDuplicatePartners) -
          getSameCourtPartnerBonus(four);
      }
      const score = diff * 1000 + i * 5 + penalty + getRestPenalty([pool[i]]);
      if (score < bestScore) {
        bestScore = score;
        best = [pool[i]];
      }
    }
    return best;
  }

  if (neededCount === 2) {
    let best = [pool[0], pool[1]];
    let bestScore = Infinity;
    for (let i = 0; i < pool.length - 1; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const four = [...selected, pool[i], pool[j]];
        let diff = 0;
        let penalty = 0;
        if (
          isMixed &&
          four.filter((p) => p.gender === 'M').length === 2 &&
          four.filter((p) => p.gender === 'F').length === 2
        ) {
          const m = four.filter((p) => p.gender === 'M');
          const f = four.filter((p) => p.gender === 'F');
          const bal = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], avoidDuplicatePartners, 'balanced');
          const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
          const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
          diff = Math.abs(sA - sB);
          penalty =
            getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
            getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
            getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
            getMatchOverlapPenalty(four, avoidDuplicatePartners) -
            getSameCourtPartnerBonus(four);
        } else if (four.length === 4) {
          const bal = balanceDoublesFour(four[0], four[1], four[2], four[3], avoidDuplicatePartners, 'balanced');
          const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
          const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
          diff = Math.abs(sA - sB);
          penalty =
            getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
            getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
            getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
            getMatchOverlapPenalty(four, avoidDuplicatePartners) -
            getSameCourtPartnerBonus(four);
        }
        const score = diff * 1000 + (i + j) * 5 + penalty + getRestPenalty([pool[i], pool[j]]);
        if (score < bestScore) {
          bestScore = score;
          best = [pool[i], pool[j]];
        }
      }
    }
    return best;
  }

  if (neededCount === 3) {
    let best = [pool[0], pool[1], pool[2]];
    let bestScore = Infinity;
    for (let i = 0; i < pool.length - 2; i++) {
      for (let j = i + 1; j < pool.length - 1; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const four = [...selected, pool[i], pool[j], pool[k]];
          const bal = balanceDoublesFour(four[0], four[1], four[2], four[3], avoidDuplicatePartners, 'balanced');
          const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
          const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
          const diff = Math.abs(sA - sB);
          const penalty =
            getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
            getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
            getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
            getMatchOverlapPenalty(four, avoidDuplicatePartners) -
            getSameCourtPartnerBonus(four);
          const score =
            diff * 1000 + (i + j + k) * 5 + penalty + getRestPenalty([pool[i], pool[j], pool[k]]);
          if (score < bestScore) {
            bestScore = score;
            best = [pool[i], pool[j], pool[k]];
          }
        }
      }
    }
    return best;
  }

  return candidates.slice(0, neededCount);
}

/**
 * 1명, 2명, 또는 3명의 선수가 선택되었을 때, 남복(4남), 여복(4여), 또는 정규 혼합복식(2남 2여)으로
 * 성비를 완벽하게 맞춰서 4명을 완성하는 헬퍼 함수.
 * 3:1 비율(3남1여 / 3여1남)을 엄격히 방지하고, 클럽 내 가용 선수가 극단적으로 부족한 비상 상황을 제외하고는
 * 반드시 남복, 여복, 또는 2:2 정규 혼복으로 매치 인원을 충원합니다.
 */
export function fillSelectedPlayersToBalancedFour(
  selected: Player[],
  availableCandidates: Player[],
  playerAssignedCount?: Record<string, number>,
  mode: MatchmakingMode = 'balanced',
  avoidDuplicatePartners: boolean = true,
  avoidConsecutiveRests: boolean = true
): {
  finalFour: Player[];
  chosenAddedIds: string[];
} {
  if (selected.length >= 4) {
    let finalFour = [...selected.slice(0, 4)];
    const m = selected.filter((p) => p.gender === 'M');
    const f = selected.filter((p) => p.gender === 'F');

    if (mode === 'doubles_only') {
      if (m.length >= 4) {
        finalFour = m.slice(0, 4);
      } else if (f.length >= 4) {
        finalFour = f.slice(0, 4);
      } else {
        throw new Error(
          '복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. 남성과 여성이 혼합된 조는 생성할 수 없습니다.'
        );
      }
      return { finalFour, chosenAddedIds: [] };
    } else if (mode === 'mixed_preference' && m.length >= 2 && f.length >= 2) {
      finalFour = [...m.slice(0, 2), ...f.slice(0, 2)];
    } else if (m.length >= 4) {
      finalFour = m.slice(0, 4);
    } else if (f.length >= 4) {
      finalFour = f.slice(0, 4);
    } else if (m.length >= 2 && f.length >= 2) {
      finalFour = [...m.slice(0, 2), ...f.slice(0, 2)];
    }
    return { finalFour, chosenAddedIds: [] };
  }

  const selectedIds = new Set(selected.map((p) => p.id));
  const partnerIdSet = new Set(selected.map((p) => p.partnerId).filter(Boolean));

  const allRelevant = [...selected, ...availableCandidates];
  const effectiveMap = computeEffectiveAssignedMap(allRelevant, playerAssignedCount);

  // Sort candidates by:
  // 1) Is partner of one of the selected players?
  // 2) Least effective assigned / games played (preventing latecomer equalization)
  // 3) Most consecutive rest rounds (if avoidConsecutiveRests is true) & registration timestamp
  const sortedCandidates = availableCandidates
    .filter((p) => !selectedIds.has(p.id) && isPlayerEligibleForMatchmaking(p))
    .sort((a, b) => {
      const aIsPartner =
        partnerIdSet.has(a.id) || selected.some((s) => areDesignatedPartners(s, a)) ? 1 : 0;
      const bIsPartner =
        partnerIdSet.has(b.id) || selected.some((s) => areDesignatedPartners(s, b)) ? 1 : 0;
      if (aIsPartner !== bIsPartner) return bIsPartner - aIsPartner;

      const aAssigned = effectiveMap[a.id] ?? (playerAssignedCount ? (playerAssignedCount[a.id] || 0) : a.gamesPlayed);
      const bAssigned = effectiveMap[b.id] ?? (playerAssignedCount ? (playerAssignedCount[b.id] || 0) : b.gamesPlayed);
      const aEff = a.tier === 'S' ? aAssigned * 0.65 : aAssigned;
      const bEff = b.tier === 'S' ? bAssigned * 0.65 : bAssigned;
      if (Math.abs(aEff - bEff) >= 0.5) return aEff - bEff;

      if (avoidConsecutiveRests) {
        const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        if (bRested !== aRested) return bRested - aRested;
        if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
          return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
        }
      }
      if (aEff !== bEff) return aEff - bEff;
      return getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
    });

  const mSel = selected.filter((p) => p.gender === 'M');
  const fSel = selected.filter((p) => p.gender === 'F');

  const mAvail = sortedCandidates.filter((p) => p.gender === 'M');
  const fAvail = sortedCandidates.filter((p) => p.gender === 'F');

  let chosenAdded: Player[] | null = null;

  // Case 1: Both genders are present among selected players (e.g. 1M+1F, 1M+2F, 2M+1F)
  if (mSel.length > 0 && fSel.length > 0) {
    if (mode === 'doubles_only') {
      throw new Error(
        '복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. 남성과 여성을 함께 선택할 수 없습니다.'
      );
    }
    const needM = 2 - mSel.length;
    const needF = 2 - fSel.length;
    if (needM >= 0 && needF >= 0 && mAvail.length >= needM && fAvail.length >= needF) {
      if (mode === 'balanced' && needM === 1 && needF === 1 && mAvail.length > 1 && fAvail.length > 1) {
        const poolM = mAvail.slice(0, Math.min(5, mAvail.length));
        const poolF = fAvail.slice(0, Math.min(5, fAvail.length));
        const topRestM = avoidConsecutiveRests ? poolM[0].consecutiveRestRounds || 0 : 0;
        const topRestF = avoidConsecutiveRests ? poolF[0].consecutiveRestRounds || 0 : 0;
        let bestPair = [poolM[0], poolF[0]];
        let bestScore = Infinity;
        for (let j = 0; j < poolM.length; j++) {
          for (let k = 0; k < poolF.length; k++) {
            const curM = [mSel[0], poolM[j]];
            const curF = [fSel[0], poolF[k]];
            const four = [...curM, ...curF];
            const bal = balanceMixedDoublesFour(curM[0], curM[1], curF[0], curF[1], avoidDuplicatePartners, 'balanced');
            const sA = (TIER_SCORES[bal.teamA[0].tier] || 1) + (TIER_SCORES[bal.teamA[1].tier] || 1);
            const sB = (TIER_SCORES[bal.teamB[0].tier] || 1) + (TIER_SCORES[bal.teamB[1].tier] || 1);
            const diff = Math.abs(sA - sB);
            const penalty =
              getPairPenalty(bal.teamA[0], bal.teamA[1], avoidDuplicatePartners) +
              getPairPenalty(bal.teamB[0], bal.teamB[1], avoidDuplicatePartners) +
              getOpponentPenalty(bal.teamA, bal.teamB, avoidDuplicatePartners) +
              getMatchOverlapPenalty(four, avoidDuplicatePartners) -
              getSameCourtPartnerBonus(four);
            const restPen = avoidConsecutiveRests
              ? (Math.max(0, topRestM - (poolM[j].consecutiveRestRounds || 0)) +
                  Math.max(0, topRestF - (poolF[k].consecutiveRestRounds || 0))) *
                150000
              : 0;
            const score = diff * 1000 + (j + k) * 5 + penalty + restPen;
            if (score < bestScore) {
              bestScore = score;
              bestPair = [poolM[j], poolF[k]];
            }
          }
        }
        chosenAdded = bestPair;
      } else {
        chosenAdded = [...mAvail.slice(0, needM), ...fAvail.slice(0, needF)];
      }
    }
  }

  // Case 2: Only Male(s) are selected (1M, 2M, or 3M)
  if (!chosenAdded && mSel.length > 0 && fSel.length === 0) {
    const needMForMixed = 2 - mSel.length;
    const needFForMixed = 2;
    const canMakeMixed = mSel.length <= 2 && mAvail.length >= needMForMixed && fAvail.length >= needFForMixed;
    const needMForMD = 4 - mSel.length;
    const canMakeMD = mAvail.length >= needMForMD;
    // 선택된 남성 선수에게 가용 여성 지정 파트너가 있는 경우 혼복으로 함께 배정
    const hasSelectedMaleWithFemalePartner = mSel.some((m) =>
      fAvail.some((f) => areDesignatedPartners(m, f))
    );

    if (mode === 'doubles_only') {
      if (canMakeMD) {
        chosenAdded = pickBestSupplementaryCandidates(
          selected,
          mAvail,
          needMForMD,
          false,
          avoidDuplicatePartners,
          avoidConsecutiveRests
        );
      } else {
        throw new Error(`남복을 완성하기 위한 남성 대기 인원이 부족합니다. (남성 ${needMForMD}명 필요)`);
      }
    } else if ((mode === 'mixed_preference' || hasSelectedMaleWithFemalePartner) && canMakeMixed) {
      // 혼복 우선 모드이거나 선택된 남성에게 여성 지정 파트너가 있을 때: 정규 혼복(2M + 2F) 최우선 편성
      chosenAdded = [...mAvail.slice(0, needMForMixed), ...fAvail.slice(0, needFForMixed)];
    } else if (canMakeMD) {
      if (mode === 'balanced') {
        chosenAdded = pickBestSupplementaryCandidates(
          selected,
          mAvail,
          needMForMD,
          false,
          avoidDuplicatePartners,
          avoidConsecutiveRests
        );
      } else {
        chosenAdded = mAvail.slice(0, needMForMD);
      }
    } else if (canMakeMixed) {
      chosenAdded = [...mAvail.slice(0, needMForMixed), ...fAvail.slice(0, needFForMixed)];
    }
  }

  // Case 3: Only Female(s) are selected (1F, 2F, or 3F)
  if (!chosenAdded && fSel.length > 0 && mSel.length === 0) {
    const needMForMixed = 2;
    const needFForMixed = 2 - fSel.length;
    const canMakeMixed = fSel.length <= 2 && mAvail.length >= needMForMixed && fAvail.length >= needFForMixed;
    const needFForWD = 4 - fSel.length;
    const canMakeWD = fAvail.length >= needFForWD;
    // 선택된 여성 선수에게 가용 남성 지정 파트너가 있는 경우 혼복으로 함께 배정
    const hasSelectedFemaleWithMalePartner = fSel.some((f) =>
      mAvail.some((m) => areDesignatedPartners(f, m))
    );

    if (mode === 'doubles_only') {
      if (canMakeWD) {
        chosenAdded = pickBestSupplementaryCandidates(
          selected,
          fAvail,
          needFForWD,
          false,
          avoidDuplicatePartners,
          avoidConsecutiveRests
        );
      } else {
        throw new Error(`여복을 완성하기 위한 여성 대기 인원이 부족합니다. (여성 ${needFForWD}명 필요)`);
      }
    } else if ((mode === 'mixed_preference' || hasSelectedFemaleWithMalePartner) && canMakeMixed) {
      // 혼복 우선 모드이거나 선택된 여성에게 남성 지정 파트너가 있을 때: 정규 혼복(2M + 2F) 최우선 편성
      chosenAdded = [...mAvail.slice(0, needMForMixed), ...fAvail.slice(0, needFForMixed)];
    } else if (canMakeWD) {
      if (mode === 'balanced') {
        chosenAdded = pickBestSupplementaryCandidates(
          selected,
          fAvail,
          needFForWD,
          false,
          avoidDuplicatePartners,
          avoidConsecutiveRests
        );
      } else {
        chosenAdded = fAvail.slice(0, needFForWD);
      }
    } else if (canMakeMixed) {
      chosenAdded = [...mAvail.slice(0, needMForMixed), ...fAvail.slice(0, needFForMixed)];
    }
  }

  // Emergency Fallback (Only if mathematically impossible to make 4M, 4F, or 2M+2F with available members):
  if (mode !== 'doubles_only' && !chosenAdded && sortedCandidates.length >= 4 - selected.length) {
    chosenAdded = sortedCandidates.slice(0, 4 - selected.length);
  }

  if (!chosenAdded || selected.length + chosenAdded.length < 4) {
    throw new Error(
      `선택한 선수(${selected.length}명)를 포함하여 복식 경기를 완성할 대기 인원이 부족합니다. (최소 4명 필요)`
    );
  }

  const finalFour = [...selected, ...chosenAdded];
  const chosenAddedIds = chosenAdded.map((p) => p.id);
  return { finalFour, chosenAddedIds };
}

/**
 * Forms a doubles match for a specific court given a list of selected resting players.
 * If fewer than 4 players are selected, it fills the remaining slots from other active resting players
 * while strictly upholding 남복 (4M), 여복 (4F), or 정규 혼복 (2M+2F) rules without creating 3:1 matches.
 */
export function createDoublesMatchFromSelected(
  selectedPlayers: Player[],
  allRestingPlayers: Player[],
  courtNumber: number,
  roundNumber: number,
  options: MatchOptions,
  existingQueuedMatches: CourtMatch[] = [],
  activeMatches: CourtMatch[] = []
): {
  match: CourtMatch;
  assignedPlayerIds: string[];
} {
  const activeCourtIds = new Set<string>();
  activeMatches.forEach((m) => {
    if (m.status !== 'completed') {
      if (m.teamA?.player1Id) activeCourtIds.add(m.teamA.player1Id);
      if (m.teamA?.player2Id) activeCourtIds.add(m.teamA.player2Id);
      if (m.teamB?.player1Id) activeCourtIds.add(m.teamB.player1Id);
      if (m.teamB?.player2Id) activeCourtIds.add(m.teamB.player2Id);
    }
  });

  for (const sp of selectedPlayers) {
    if (!isPlayerEligibleForMatchmaking(sp, activeCourtIds, existingQueuedMatches)) {
      const reason =
        sp.specialStatus === 'resting'
          ? '휴식중'
          : sp.specialStatus === 'lesson'
          ? '레슨중'
          : sp.specialStatus === 'last_match' && !isPlayerLastMatchCompleted(sp)
          ? '마지막판으로 이미 코트/대기열에 배정됨'
          : '퇴장/마지막판 완료';
      throw new Error(`${sp.name} 선수는 현재 [${reason}] 상태이므로 코트에 배정할 수 없습니다.`);
    }
  }

  const selectedWithHistory = mergeQueuedPartnerHistory(
    selectedPlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );
  const restingWithHistory = mergeQueuedPartnerHistory(
    allRestingPlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );

  const selectedIds = new Set(selectedWithHistory.map((p) => p.id));
  const otherResting = restingWithHistory.filter(
    (p) => !selectedIds.has(p.id) && isPlayerEligibleForMatchmaking(p, activeCourtIds, existingQueuedMatches)
  );

  const playerAssignedCount: Record<string, number> = {};
  [...selectedWithHistory, ...otherResting].forEach((p) => {
    const inQueueCount = existingQueuedMatches.filter(
      (m) =>
        m.teamA.player1Id === p.id ||
        m.teamA.player2Id === p.id ||
        m.teamB.player1Id === p.id ||
        m.teamB.player2Id === p.id
    ).length;
    playerAssignedCount[p.id] = (p.gamesPlayed || 0) + inQueueCount;
  });

  const { finalFour } = fillSelectedPlayersToBalancedFour(
    selectedWithHistory,
    otherResting,
    playerAssignedCount,
    options.mode,
    options.avoidDuplicatePartners,
    options.avoidConsecutiveRests
  );

  // Create match from finalFour
  const males = finalFour.filter((p) => p.gender === 'M');
  const females = finalFour.filter((p) => p.gender === 'F');

  let matchTitle = '경기';
  let teamAPlayers: [Player, Player];
  let teamBPlayers: [Player, Player];

  if (males.length === 4) {
    matchTitle = '남복';
    const balanced = balanceDoublesFour(
      finalFour[0],
      finalFour[1],
      finalFour[2],
      finalFour[3],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  } else if (females.length === 4) {
    matchTitle = '여복';
    const balanced = balanceDoublesFour(
      finalFour[0],
      finalFour[1],
      finalFour[2],
      finalFour[3],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  } else if (males.length === 2 && females.length === 2) {
    matchTitle = '혼복';
    const balanced = balanceMixedDoublesFour(
      males[0],
      males[1],
      females[0],
      females[1],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  } else if (males.length === 3 && females.length === 1) {
    matchTitle = '혼복(3:1)';
    const balanced = balanceThreeAndOne(
      females[0],
      [males[0], males[1], males[2]],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  } else if (females.length === 3 && males.length === 1) {
    matchTitle = '혼복(3:1)';
    const balanced = balanceThreeAndOne(
      males[0],
      [females[0], females[1], females[2]],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  } else {
    matchTitle = '복식';
    const balanced = balanceDoublesFour(
      finalFour[0],
      finalFour[1],
      finalFour[2],
      finalFour[3],
      options.avoidDuplicatePartners,
      options.mode
    );
    teamAPlayers = balanced.teamA;
    teamBPlayers = balanced.teamB;
  }

  const match: CourtMatch = {
    id: generateId(),
    courtNumber,
    round: roundNumber,
    teamA: {
      player1Id: teamAPlayers[0].id,
      player2Id: teamAPlayers[1].id,
      score: 0,
    },
    teamB: {
      player1Id: teamBPlayers[0].id,
      player2Id: teamBPlayers[1].id,
      score: 0,
    },
    status: courtNumber > 0 ? 'waiting' : 'queued',
    title: matchTitle,
    startedAt: Date.now(),
  };

  return {
    match,
    assignedPlayerIds: finalFour.map((p) => p.id),
  };
}

/**
 * Generates one or more queued matches featuring specifically selected players.
 * If 1 to 3 players are selected, remaining slots (to reach 4) are filled with the most rested/least assigned candidates.
 */
export function createQueuedMatchesFromSelectedPlayers(
  selectedPlayerIds: string[],
  allPlayers: Player[],
  existingQueuedMatches: CourtMatch[] = [],
  activeCourtPlayerIds: Set<string> = new Set(),
  options?: MatchOptions,
  activeMatches: CourtMatch[] = []
): CourtMatch[] {
  const playersWithHistory = mergeQueuedPartnerHistory(
    allPlayers,
    existingQueuedMatches,
    activeMatches,
    options?.courtCount
  );
  const selectedPlayers = playersWithHistory.filter((p) => selectedPlayerIds.includes(p.id));
  if (selectedPlayers.length === 0) return [];

  for (const sp of selectedPlayers) {
    if (!isPlayerEligibleForMatchmaking(sp, activeCourtPlayerIds, existingQueuedMatches)) {
      const reason =
        sp.specialStatus === 'resting'
          ? '휴식중'
          : sp.specialStatus === 'lesson'
          ? '레슨중'
          : sp.specialStatus === 'last_match' && !isPlayerLastMatchCompleted(sp)
          ? '마지막판으로 이미 코트/대기열에 배정됨'
          : '퇴장/마지막판 완료';
      throw new Error(`${sp.name} 선수는 현재 [${reason}] 상태이므로 대기열에 추가 배정할 수 없습니다.`);
    }
  }

  // Track each player's total current assigned count:
  const playerAssignedCount: Record<string, number> = {};
  playersWithHistory.forEach((p) => {
    const activeCourtCount = activeCourtPlayerIds.has(p.id) ? 1 : 0;
    const inQueueCount = existingQueuedMatches.filter(
      (m) =>
        m.teamA.player1Id === p.id ||
        m.teamA.player2Id === p.id ||
        m.teamB.player1Id === p.id ||
        m.teamB.player2Id === p.id
    ).length;
    playerAssignedCount[p.id] = p.gamesPlayed + activeCourtCount + inQueueCount;
  });

  const effectiveAssignedCount = computeEffectiveAssignedMap(
    playersWithHistory,
    playerAssignedCount,
    activeCourtPlayerIds,
    allPlayers
  );

  const remainingCandidates = playersWithHistory
    .filter(
      (p) =>
        !selectedPlayerIds.includes(p.id) &&
        isPlayerEligibleForMatchmaking(p, activeCourtPlayerIds, existingQueuedMatches)
    )
    .sort((a, b) => {
      const aAssigned = effectiveAssignedCount[a.id] ?? (playerAssignedCount[a.id] || 0);
      const bAssigned = effectiveAssignedCount[b.id] ?? (playerAssignedCount[b.id] || 0);
      const aEff = a.tier === 'S' ? aAssigned * 0.65 : aAssigned;
      const bEff = b.tier === 'S' ? bAssigned * 0.65 : bAssigned;
      if (Math.abs(aEff - bEff) >= 0.5) return aEff - bEff;
      if (options?.avoidConsecutiveRests ?? true) {
        const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        if (aRested !== bRested) return bRested - aRested;
        if ((a.consecutiveRestRounds || 0) !== (b.consecutiveRestRounds || 0)) {
          return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
        }
      }
      if (aEff !== bEff) return aEff - bEff;
      const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
      if (regDiff !== 0) return regDiff;
      return Math.random() - 0.5;
    });

  const createdMatches: CourtMatch[] = [];
  const selectedPool = clusterPartners([...selectedPlayers]);
  let candidatePool = clusterPartners([...remainingCandidates]);

  const avoidDup = options?.avoidDuplicatePartners ?? true;
  const currentMode = options?.mode ?? 'balanced';

  while (selectedPool.length > 0) {
    const currentGroup: Player[] = [];

    if (currentMode === 'doubles_only') {
      const availM = clusterPartners(selectedPool.filter((p) => p.gender === 'M'));
      const availF = clusterPartners(selectedPool.filter((p) => p.gender === 'F'));
      if (availM.length > 0) {
        const takeM = availM.slice(0, 4);
        currentGroup.push(...takeM);
        const chosenIds = new Set(takeM.map((p) => p.id));
        for (let i = selectedPool.length - 1; i >= 0; i--) {
          if (chosenIds.has(selectedPool[i].id)) {
            selectedPool.splice(i, 1);
          }
        }
      } else if (availF.length > 0) {
        const takeF = availF.slice(0, 4);
        currentGroup.push(...takeF);
        const chosenIds = new Set(takeF.map((p) => p.id));
        for (let i = selectedPool.length - 1; i >= 0; i--) {
          if (chosenIds.has(selectedPool[i].id)) {
            selectedPool.splice(i, 1);
          }
        }
      }
    } else if (currentMode === 'mixed_preference') {
      const availM = selectedPool.filter((p) => p.gender === 'M');
      const availF = selectedPool.filter((p) => p.gender === 'F');
      if (availM.length >= 2 && availF.length >= 2) {
        // 혼복 우선 모드: 선택된 인원 중 파트너 쌍을 우선 포함하여 2M + 2F 추출
        const chosenM: Player[] = [];
        const chosenF: Player[] = [];
        for (const m of availM) {
          if (chosenM.length < 2 && availF.some((f) => areDesignatedPartners(m, f))) {
            const fPartner = availF.find((f) => areDesignatedPartners(m, f))!;
            if (!chosenF.some((cf) => cf.id === fPartner.id) && chosenF.length < 2) {
              chosenM.push(m);
              chosenF.push(fPartner);
            }
          }
        }
        for (const m of availM) {
          if (chosenM.length < 2 && !chosenM.some((cm) => cm.id === m.id)) chosenM.push(m);
        }
        for (const f of availF) {
          if (chosenF.length < 2 && !chosenF.some((cf) => cf.id === f.id)) chosenF.push(f);
        }
        currentGroup.push(...chosenM, ...chosenF);
        const chosenIds = new Set(currentGroup.map((p) => p.id));
        for (let i = selectedPool.length - 1; i >= 0; i--) {
          if (chosenIds.has(selectedPool[i].id)) {
            selectedPool.splice(i, 1);
          }
        }
      }
    }

    if (currentGroup.length === 0) {
      while (currentGroup.length < 4 && selectedPool.length > 0) {
        const nextP = selectedPool.shift()!;
        currentGroup.push(nextP);
        // 선택된 선수의 지정 파트너가 selectedPool에 남아있고 자리가 있으면 즉시 같은 그룹에 합류
        if (currentGroup.length < 4 && nextP.partnerId) {
          const partnerIdx = selectedPool.findIndex((sp) => areDesignatedPartners(nextP, sp));
          if (partnerIdx !== -1) {
            currentGroup.push(selectedPool.splice(partnerIdx, 1)[0]);
          }
        }
      }
    }

    let finalFour: Player[];
    if (currentGroup.length === 4) {
      const m = currentGroup.filter((p) => p.gender === 'M');
      const f = currentGroup.filter((p) => p.gender === 'F');
      if (currentMode === 'doubles_only' && m.length !== 4 && f.length !== 4) {
        throw new Error(
          '복식 우선 모드에서는 남복(남 4명) 또는 여복(여 4명)만 편성 가능합니다. 남성과 여성이 혼합된 조는 생성할 수 없습니다.'
        );
      }
      finalFour = currentGroup;
    } else {
      const balanced = fillSelectedPlayersToBalancedFour(
        currentGroup,
        candidatePool,
        playerAssignedCount,
        currentMode,
        avoidDup,
        options?.avoidConsecutiveRests ?? true
      );
      finalFour = balanced.finalFour;
      const chosenAddedSet = new Set(balanced.chosenAddedIds);
      candidatePool = candidatePool.filter((p) => !chosenAddedSet.has(p.id));
    }

    if (finalFour.length < 4) {
      // Not enough total players in the meetup to reach 4
      break;
    }

    const males = finalFour.filter((p) => p.gender === 'M');
    const females = finalFour.filter((p) => p.gender === 'F');

    let matchTitle = '경기';
    let teamAPlayers: [Player, Player];
    let teamBPlayers: [Player, Player];

    if (males.length === 4) {
      matchTitle = '남복';
      const balanced = balanceDoublesFour(finalFour[0], finalFour[1], finalFour[2], finalFour[3], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else if (females.length === 4) {
      matchTitle = '여복';
      const balanced = balanceDoublesFour(finalFour[0], finalFour[1], finalFour[2], finalFour[3], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else if (males.length === 2 && females.length === 2) {
      matchTitle = '혼복';
      const balanced = balanceMixedDoublesFour(males[0], males[1], females[0], females[1], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else if (males.length === 3 && females.length === 1) {
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(females[0], [males[0], males[1], males[2]], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else if (females.length === 3 && males.length === 1) {
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(males[0], [females[0], females[1], females[2]], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else {
      const balanced = balanceDoublesFour(finalFour[0], finalFour[1], finalFour[2], finalFour[3], avoidDup, currentMode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    }

    const newMatch: CourtMatch = {
      id: generateId(),
      courtNumber: 0,
      round: 1,
      teamA: {
        player1Id: teamAPlayers[0].id,
        player2Id: teamAPlayers[1].id,
        score: 0,
      },
      teamB: {
        player1Id: teamBPlayers[0].id,
        player2Id: teamBPlayers[1].id,
        score: 0,
      },
      status: 'queued',
      title: matchTitle,
      startedAt: Date.now(),
    };

    createdMatches.push(newMatch);
    updateInMemoryMatchHistory(playersWithHistory, teamAPlayers, teamBPlayers);
  }

  return createdMatches;
}

/**
 * Generates a specific doubles match ('MD' | 'WD' | 'XD') for the upcoming queue,
 * selecting active players with the lowest assignment and games played counts.
 */
export function generateSpecificTypeQueuedMatch(
  matchType: 'MD' | 'WD' | 'XD',
  allPlayers: Player[],
  existingQueuedMatches: CourtMatch[] = [],
  activeCourtPlayerIds: Set<string> = new Set(),
  options: MatchOptions = {
    mode: 'balanced',
    courtCount: 2,
    avoidConsecutiveRests: true,
    avoidDuplicatePartners: true,
  },
  activeMatches: CourtMatch[] = []
): CourtMatch {
  // Merge existingQueuedMatches and activeMatches partner history and simulated rest rounds into cloned player objects
  const playersWithHistory = mergeQueuedPartnerHistory(
    allPlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );

  // Compute total assignments per player (gamesPlayed + active + in queue)
  const playerAssignedCount: Record<string, number> = {};
  playersWithHistory.forEach((p) => {
    const activeCourtCount = activeCourtPlayerIds.has(p.id) ? 1 : 0;
    const inQueueCount = existingQueuedMatches.filter(
      (m) =>
        m.teamA.player1Id === p.id ||
        m.teamA.player2Id === p.id ||
        m.teamB.player1Id === p.id ||
        m.teamB.player2Id === p.id
    ).length;
    playerAssignedCount[p.id] = p.gamesPlayed + activeCourtCount + inQueueCount;
  });

  const effectiveCourtCount = Math.max(1, options.courtCount || 1);
  const waveStartIdx =
    Math.floor(existingQueuedMatches.length / effectiveCourtCount) * effectiveCourtCount;
  const currentWaveMatches = existingQueuedMatches.slice(waveStartIdx);
  const recentWindowMatches =
    effectiveCourtCount > 1 ? existingQueuedMatches.slice(-(effectiveCourtCount - 1)) : [];

  const currentCourtWavePlayerIds = new Set<string>();
  [...currentWaveMatches, ...recentWindowMatches].forEach((m) => {
    currentCourtWavePlayerIds.add(m.teamA.player1Id);
    currentCourtWavePlayerIds.add(m.teamA.player2Id);
    currentCourtWavePlayerIds.add(m.teamB.player1Id);
    currentCourtWavePlayerIds.add(m.teamB.player2Id);
  });

  const lastMatchIds = new Set<string>();
  existingQueuedMatches.slice(-effectiveCourtCount).forEach((m) => {
    lastMatchIds.add(m.teamA.player1Id);
    lastMatchIds.add(m.teamA.player2Id);
    lastMatchIds.add(m.teamB.player1Id);
    lastMatchIds.add(m.teamB.player2Id);
  });
  if (existingQueuedMatches.length === 0) {
    playersWithHistory.forEach((p) => {
      if (
        activeCourtPlayerIds.has(p.id) ||
        ((p.consecutiveRestRounds || 0) === 0 &&
          (p.gamesPlayed || 0) > (p.restStartGamesPlayed ?? 0))
      ) {
        lastMatchIds.add(p.id);
      }
    });
  }

  const effectiveAssignedCount = computeEffectiveAssignedMap(
    playersWithHistory,
    playerAssignedCount,
    new Set<string>([...activeCourtPlayerIds, ...currentCourtWavePlayerIds, ...lastMatchIds]),
    allPlayers
  );

  const sortedAllCandidates = playersWithHistory
    .filter((p) => isPlayerEligibleForMatchmaking(p, activeCourtPlayerIds, existingQueuedMatches))
    .sort((a, b) => {
      const aInWave = currentCourtWavePlayerIds.has(a.id) ? 1 : 0;
      const bInWave = currentCourtWavePlayerIds.has(b.id) ? 1 : 0;
      if (aInWave !== bInWave) return aInWave - bInWave;

      const aIsLate = isLateRegisteredPlayer(a, allPlayers);
      const bIsLate = isLateRegisteredPlayer(b, allPlayers);
      const aLateConsecutive = aIsLate && lastMatchIds.has(a.id) ? 1 : 0;
      const bLateConsecutive = bIsLate && lastMatchIds.has(b.id) ? 1 : 0;
      if (aLateConsecutive !== bLateConsecutive) {
        return aLateConsecutive - bLateConsecutive;
      }

      if (existingQueuedMatches.length < effectiveCourtCount) {
        const aPlaying = activeCourtPlayerIds.has(a.id) ? 1 : 0;
        const bPlaying = activeCourtPlayerIds.has(b.id) ? 1 : 0;
        if (aPlaying !== bPlaying) return aPlaying - bPlaying;
      }

      const aAssigned = effectiveAssignedCount[a.id] ?? (playerAssignedCount[a.id] || 0);
      const bAssigned = effectiveAssignedCount[b.id] ?? (playerAssignedCount[b.id] || 0);
      // S조는 다른 조(A,B,C,D,E조)보다 더 많은 비율의 배정/진행을 받을 수 있도록 가중치(0.65배) 적용
      const aEffAssigned = a.tier === 'S' ? aAssigned * 0.65 : aAssigned;
      const bEffAssigned = b.tier === 'S' ? bAssigned * 0.65 : bAssigned;

      if ((aIsLate || bIsLate) && Math.abs(aEffAssigned - bEffAssigned) >= 0.5) {
        return aEffAssigned - bEffAssigned;
      }

      if (options.avoidConsecutiveRests) {
        const aRested = (a.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        const bRested = (b.consecutiveRestRounds || 0) > 0 ? 1 : 0;
        if (bRested !== aRested) return bRested - aRested;
        if ((b.consecutiveRestRounds || 0) !== (a.consecutiveRestRounds || 0)) {
          return (b.consecutiveRestRounds || 0) - (a.consecutiveRestRounds || 0);
        }
      }

      if (aEffAssigned !== bEffAssigned) return aEffAssigned - bEffAssigned;
      const aGames = a.tier === 'S' ? a.gamesPlayed * 0.65 : a.gamesPlayed;
      const bGames = b.tier === 'S' ? b.gamesPlayed * 0.65 : b.gamesPlayed;
      if (aGames !== bGames) return aGames - bGames;
      if (a.tier === 'S' && b.tier !== 'S') return -1;
      if (b.tier === 'S' && a.tier !== 'S') return 1;
      const regDiff = getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
      if (Math.abs(regDiff) >= 60000) return regDiff;
      if (!options.avoidConsecutiveRests || options.mode === 'random') {
        return Math.random() - 0.5;
      }
      if (regDiff !== 0) return regDiff;
      return Math.random() - 0.5;
    });

  const nonWaveCandidates = sortedAllCandidates.filter((p) => !currentCourtWavePlayerIds.has(p.id));
  const nonWaveMales = nonWaveCandidates.filter((p) => p.gender === 'M');
  const nonWaveFemales = nonWaveCandidates.filter((p) => p.gender === 'F');
  const canUseNonWave =
    (matchType === 'MD' && nonWaveMales.length >= 4) ||
    (matchType === 'WD' && nonWaveFemales.length >= 4) ||
    (matchType === 'XD' &&
      ((nonWaveMales.length >= 2 && nonWaveFemales.length >= 2) ||
        (options.mode === 'random' &&
          nonWaveCandidates.length >= 4 &&
          nonWaveMales.length >= 1 &&
          nonWaveFemales.length >= 1)));

  const activeCandidates = canUseNonWave ? nonWaveCandidates : sortedAllCandidates;

  const males = activeCandidates.filter((p) => p.gender === 'M');
  const females = activeCandidates.filter((p) => p.gender === 'F');

  let matchTitle = '경기';
  let teamAPlayers: [Player, Player];
  let teamBPlayers: [Player, Player];

  if (matchType === 'MD') {
    if (males.length < 4) {
      throw new Error(`남복 생성을 위해서는 참가 중인 남성 선수가 최소 4명 필요합니다. (현재 ${males.length}명)`);
    }
    matchTitle = '남복';
    if (options.mode === 'balanced' || options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
      const balanced = selectBalancedFourCandidates(
        males,
        options.avoidDuplicatePartners,
        effectiveAssignedCount,
        playerAssignedCount,
        allPlayers,
        options.avoidConsecutiveRests
      );
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else {
      const randomRes = selectRandomFourSameGender(
        males,
        options.avoidDuplicatePartners,
        effectiveAssignedCount,
        playerAssignedCount,
        allPlayers,
        options.avoidConsecutiveRests
      );
      teamAPlayers = randomRes.teamA;
      teamBPlayers = randomRes.teamB;
    }
  } else if (matchType === 'WD') {
    if (females.length < 4) {
      throw new Error(`여복 생성을 위해서는 참가 중인 여성 선수가 최소 4명 필요합니다. (현재 ${females.length}명)`);
    }
    matchTitle = '여복';
    if (options.mode === 'balanced' || options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
      const balanced = selectBalancedFourCandidates(
        females,
        options.avoidDuplicatePartners,
        effectiveAssignedCount,
        playerAssignedCount,
        allPlayers,
        options.avoidConsecutiveRests
      );
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else {
      const randomRes = selectRandomFourSameGender(
        females,
        options.avoidDuplicatePartners,
        effectiveAssignedCount,
        playerAssignedCount,
        allPlayers,
        options.avoidConsecutiveRests
      );
      teamAPlayers = randomRes.teamA;
      teamBPlayers = randomRes.teamB;
    }
  } else {
    // XD (혼복) - 수동 '혼복 생성' 버튼 클릭 시 모든 복식 조 편성 방식에서 작동 보장
    if (males.length >= 2 && females.length >= 2) {
      matchTitle = '혼복';
      if (options.mode === 'balanced' || options.mode === 'mixed_preference' || options.mode === 'doubles_only') {
        const balanced = selectBalancedMixedCandidates(
          males,
          females,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
      } else {
        const randomRes = selectRandomFourMixedGender(
          males,
          females,
          options.avoidDuplicatePartners,
          effectiveAssignedCount,
          playerAssignedCount,
          allPlayers,
          options.avoidConsecutiveRests
        );
        teamAPlayers = randomRes.teamA;
        teamBPlayers = randomRes.teamB;
      }
    } else if (options.mode === 'random' && males.length >= 3 && females.length >= 1) {
      const selMales = males.slice(0, 3);
      const female = females[0];
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(
        female,
        [selMales[0], selMales[1], selMales[2]],
        options.avoidDuplicatePartners,
        options.mode
      );
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else if (options.mode === 'random' && females.length >= 3 && males.length >= 1) {
      const selFemales = females.slice(0, 3);
      const male = males[0];
      matchTitle = '혼복(3:1)';
      const balanced = balanceThreeAndOne(
        male,
        [selFemales[0], selFemales[1], selFemales[2]],
        options.avoidDuplicatePartners,
        options.mode
      );
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
    } else {
      throw new Error(
        `혼복 생성을 위한 인원이 부족합니다. (남성 2명, 여성 2명 이상 필요${
          options.mode === 'random' ? ' / 완전랜덤 시 3:1 가능' : ''
        })`
      );
    }
  }

  recordFormedMatchTierPattern([...teamAPlayers, ...teamBPlayers]);

  return {
    id: generateId(),
    courtNumber: 0,
    round: 1,
    teamA: {
      player1Id: teamAPlayers[0].id,
      player2Id: teamAPlayers[1].id,
      score: 0,
    },
    teamB: {
      player1Id: teamBPlayers[0].id,
      player2Id: teamBPlayers[1].id,
      score: 0,
    },
    status: 'queued',
    title: matchTitle,
    startedAt: Date.now(),
  };
}

/**
 * Generates queued matches prioritized strictly by participant arrival/registration order (참가자 명단 오름차순).
 * Properly mixes Men's/Women's Doubles (복식: 남복, 여복) and Mixed Doubles (혼복: 2M+2F),
 * giving absolute priority to earlier arrivals in the roster while maintaining balanced 4:0, 0:4, or 2:2 gender compositions.
 */
export function generateQueueMatchesByArrivalOrder(
  allPlayers: Player[],
  activeCourtPlayerIds: Set<string> = new Set(),
  existingQueuedMatches: CourtMatch[] = [],
  options: MatchOptions = {
    mode: 'balanced',
    courtCount: 2,
    avoidConsecutiveRests: true,
    avoidDuplicatePartners: true,
  },
  maxMatchesToGenerate?: number,
  activeMatches: CourtMatch[] = []
): CourtMatch[] {
  // 1. Identify players already busy (in existing queued matches)
  const busyIds = new Set<string>();
  existingQueuedMatches.forEach((m) => {
    busyIds.add(m.teamA.player1Id);
    busyIds.add(m.teamA.player2Id);
    busyIds.add(m.teamB.player1Id);
    busyIds.add(m.teamB.player2Id);
  });

  // Merge existingQueuedMatches and activeMatches partner history and simulated rest rounds into cloned player objects
  const playersWithHistory = mergeQueuedPartnerHistory(
    allPlayers,
    existingQueuedMatches,
    activeMatches,
    options.courtCount
  );

  // 2. Filter available active players (excluding those already in existing queue)
  // To assign ALL participants on the roster into queued matches:
  // - Priority 1: Resting players (not currently on court), ordered by arrival index
  // - Priority 2: Players currently on active courts, ordered by arrival index
  // This ensures resting players are placed at the head of the queue (ready to enter courts first),
  // while currently active players are placed in subsequent matches in the queue.
  const relativeOffsetMap = computeRelativeLateOffsetMap(playersWithHistory);

  const activeRoster = playersWithHistory
    .map((p, idx) => ({ player: p, arrivalIndex: idx }))
    .filter(
      ({ player }) =>
        !busyIds.has(player.id) &&
        isPlayerEligibleForMatchmaking(player, activeCourtPlayerIds, existingQueuedMatches)
    )
    .sort((a, b) => {
      // 사용자가 수동으로 순서를 변경했거나 수동 배정/교체에 관여한 선수는 현재 명단 순번(arrivalIndex)을 그대로 존중
      if (a.player.manualInterventionExempt || b.player.manualInterventionExempt) {
        return a.arrivalIndex - b.arrivalIndex;
      }
      const aOffset = relativeOffsetMap[a.player.id] ?? getPlayerEffectiveOffset(a.player, allPlayers);
      const bOffset = relativeOffsetMap[b.player.id] ?? getPlayerEffectiveOffset(b.player, allPlayers);
      if (aOffset !== bOffset) return aOffset - bOffset;
      const regDiff = getPlayerRegistrationTime(a.player) - getPlayerRegistrationTime(b.player);
      if (regDiff !== 0 && Math.abs(regDiff) > 5000) return regDiff;
      return a.arrivalIndex - b.arrivalIndex;
    });

  const restingPlayers = activeRoster.filter(
    ({ player }) => !activeCourtPlayerIds.has(player.id)
  );
  const onCourtPlayers = activeRoster.filter(
    ({ player }) => activeCourtPlayerIds.has(player.id)
  );

  // Combine with sortRank: resting players get arrival order (with relative latecomer tier offset * 500 so later waves don't jump ahead of earlier waves),
  // on-court players get 10000 + arrival order so they are queued after resting players.
  // When avoidConsecutiveRests is active, resting players with consecutiveRestRounds > 0 are prioritized ahead of non-rested players.
  const orderedAvailable = [
    ...restingPlayers.map((item, orderedIdx) => {
      const restBonus =
        options.avoidConsecutiveRests && (item.player.consecutiveRestRounds || 0) > 0
          ? -2000 - Math.min(10, item.player.consecutiveRestRounds || 1) * 100
          : 0;
      const gamesRank = (item.player.gamesPlayed || 0) * 5000;
      return {
        ...item,
        sortRank:
          orderedIdx +
          gamesRank +
          restBonus +
          (!item.player.manualInterventionExempt
            ? (relativeOffsetMap[item.player.id] ?? getPlayerEffectiveOffset(item.player, allPlayers)) * 500
            : 0),
      };
    }),
    ...onCourtPlayers.map((item, orderedIdx) => ({
      ...item,
      sortRank:
        10000 +
        orderedIdx +
        (item.player.gamesPlayed || 0) * 5000 +
        (!item.player.manualInterventionExempt
          ? (relativeOffsetMap[item.player.id] ?? getPlayerEffectiveOffset(item.player, allPlayers)) * 500
          : 0),
    })),
  ];

  if (orderedAvailable.length < 4) {
    throw new Error(
      `대기열을 생성하기 위한 참가자가 부족합니다. (최소 4명 필요, 현재 참가자: ${orderedAvailable.length}명)`
    );
  }

  // Separate by gender while preserving priority rank
  let males = orderedAvailable
    .filter(({ player }) => player.gender === 'M')
    .sort((a, b) => a.sortRank - b.sortRank);
  let females = orderedAvailable
    .filter(({ player }) => player.gender === 'F')
    .sort((a, b) => a.sortRank - b.sortRank);

  const newMatches: CourtMatch[] = [];

  // Determine how many matches to generate: 참가자 명단 인원을 최대한 모두 배정
  const totalPossibleMatches = Math.floor((males.length + females.length) / 4);
  const targetMatchCount =
    maxMatchesToGenerate !== undefined
      ? Math.min(maxMatchesToGenerate, totalPossibleMatches)
      : totalPossibleMatches;

  // 3. Ratio control: "배정 비율이 혼복보다 복식(남복/여복)의 배정 비율을 75% 정도로 해줘 혼복이 될 비율은 25% 인거야"
  // Target: Doubles (남복/여복) ~75%, Mixed Doubles (혼복) ~25%
  let doublesCount = 0;
  let mixedCount = 0;
  const targetMixedMatches =
    options.mode === 'doubles_only'
      ? 0
      : options.mode === 'mixed_preference'
      ? targetMatchCount
      : Math.max(
          targetMatchCount >= 2 ? 1 : 0,
          Math.round(targetMatchCount * 0.25)
        );

  // Helper to pick N players strictly by arrival order while pulling in designated partners within a nearby window
  // (or avoiding previous match overlap only when the top 4 actually overlap with the previous match)
  const pickSameGenderWithPartner = (
    list: typeof males,
    count: number,
    windowSize: number = 6
  ): typeof males => {
    if (list.length <= count) {
      return list.slice(0, count);
    }

    const topSlice = list.slice(0, count);
    const hasTopPartner = topSlice.some((item) => Boolean(item.player.partnerId));
    const evaluateSameGenderFourDupCost = (fourPlayers: Player[]) => {
      const bal = balanceDoublesFour(
        fourPlayers[0],
        fourPlayers[1],
        fourPlayers[2],
        fourPlayers[3],
        true,
        options.mode
      );
      return Math.max(
        0,
        getMatchOverlapPenalty(fourPlayers, true) +
          getPairPenalty(bal.teamA[0], bal.teamA[1], true) +
          getPairPenalty(bal.teamB[0], bal.teamB[1], true) +
          getOpponentPenalty(bal.teamA, bal.teamB, true) -
          getSameCourtPartnerBonus(fourPlayers)
      );
    };

    const topOverlap =
      options.avoidDuplicatePartners && count === 4
        ? evaluateSameGenderFourDupCost(topSlice.map((x) => x.player))
        : 0;

    // 지정 파트너가 없고 이전 배정 경기와 중복도 없다면 참가순 그대로 상위 N명 즉시 반환
    if (!hasTopPartner && topOverlap === 0) {
      return topSlice;
    }

    if (options.avoidDuplicatePartners && count === 4 && topOverlap > 0 && !hasTopPartner) {
      const baseRank = list[0].sortRank;
      const sameWave = list
        .filter((item) => Math.abs(item.sortRank - baseRank) < 350)
        .slice(0, Math.min(6, list.length));
      if (sameWave.length >= 4) {
        let bestItems = sameWave.slice(0, 4);
        let bestCost = Infinity;
        for (let i = 0; i < sameWave.length - 3; i++) {
          for (let j = i + 1; j < sameWave.length - 2; j++) {
            for (let k = j + 1; k < sameWave.length - 1; k++) {
              for (let l = k + 1; l < sameWave.length; l++) {
                const candItems = [sameWave[i], sameWave[j], sameWave[k], sameWave[l]];
                const candPlayers = candItems.map((x) => x.player);
                const overlap = evaluateSameGenderFourDupCost(candPlayers);
                const rankCost = (i + j + k + l) * 3500;
                const mustCost = i === 0 ? 0 : 25000;
                const totalCost = overlap + rankCost + mustCost;
                if (totalCost < bestCost) {
                  bestCost = totalCost;
                  bestItems = candItems;
                }
              }
            }
          }
        }
        return bestItems;
      }
    }

    const picked: typeof males = [];
    const usedIds = new Set<string>();
    const windowList = list.slice(0, Math.min(list.length, windowSize));

    for (const item of list) {
      if (picked.length >= count) break;
      if (usedIds.has(item.player.id)) continue;
      picked.push(item);
      usedIds.add(item.player.id);

      if (picked.length < count && item.player.partnerId) {
        const partnerItem = windowList.find(
          (cand) =>
            !usedIds.has(cand.player.id) &&
            areDesignatedPartners(item.player, cand.player) &&
            Math.abs(cand.sortRank - item.sortRank) < 400
        );
        if (partnerItem) {
          picked.push(partnerItem);
          usedIds.add(partnerItem.player.id);
        }
      }
    }
    return picked;
  };

  for (let mIdx = 0; mIdx < targetMatchCount; mIdx++) {
    if (males.length + females.length < 4) break;

    type MatchCandidateOption = {
      type: 'MD' | 'WD' | 'XD' | 'X3M' | 'X3F';
      malesUsed: typeof males;
      femalesUsed: typeof females;
      avgArrivalIndex: number;
      maxArrivalIndex: number;
      hasPartnerPair: boolean;
      title: string;
    };

    const validOptions: MatchCandidateOption[] = [];

    // Can we form MD (남복 4M)?
    if (males.length >= 4) {
      const top4M = pickSameGenderWithPartner(males, 4, 6);
      const hasPartnerPair = top4M.some((a) =>
        top4M.some((b) => a.player.id !== b.player.id && areDesignatedPartners(a.player, b.player))
      );
      const avgArrival = top4M.reduce((sum, item) => sum + item.sortRank, 0) / 4;
      const maxArrival = Math.max(...top4M.map((item) => item.sortRank));
      validOptions.push({
        type: 'MD',
        malesUsed: top4M,
        femalesUsed: [],
        avgArrivalIndex: hasPartnerPair ? avgArrival - 2.0 : avgArrival,
        maxArrivalIndex: maxArrival,
        hasPartnerPair,
        title: '남복',
      });
    }

    // Can we form WD (여복 4F)?
    if (females.length >= 4) {
      const top4F = pickSameGenderWithPartner(females, 4, 6);
      const hasPartnerPair = top4F.some((a) =>
        top4F.some((b) => a.player.id !== b.player.id && areDesignatedPartners(a.player, b.player))
      );
      const avgArrival = top4F.reduce((sum, item) => sum + item.sortRank, 0) / 4;
      const maxArrival = Math.max(...top4F.map((item) => item.sortRank));
      validOptions.push({
        type: 'WD',
        malesUsed: [],
        femalesUsed: top4F,
        avgArrivalIndex: hasPartnerPair ? avgArrival - 2.0 : avgArrival,
        maxArrivalIndex: maxArrival,
        hasPartnerPair,
        title: '여복',
      });
    }

    // Can we form XD (혼복 2M + 2F)?
    if (options.mode !== 'doubles_only' && males.length >= 2 && females.length >= 2) {
      let top2M = males.slice(0, 2);
      let top2F = females.slice(0, 2);
      const windowM = males.slice(0, Math.min(6, males.length));
      const windowF = females.slice(0, Math.min(6, females.length));

      // 참가순 상위권 내에 혼복 지정 파트너 쌍(남+여)이 있으면 함께 묶어 선발
      const mixedM = windowM.find((m) =>
        windowF.some(
          (f) =>
            areDesignatedPartners(m.player, f.player) &&
            Math.abs(m.sortRank - f.sortRank) < 400
        )
      );
      if (mixedM) {
        const mixedF = windowF.find((f) => areDesignatedPartners(mixedM.player, f.player))!;
        top2M = [mixedM, ...males.filter((m) => m.player.id !== mixedM.player.id).slice(0, 1)];
        top2F = [mixedF, ...females.filter((f) => f.player.id !== mixedF.player.id).slice(0, 1)];
      } else if (options.avoidDuplicatePartners && (windowM.length > 2 || windowF.length > 2)) {
        const evalMixedDup = (m1: Player, m2: Player, f1: Player, f2: Player) => {
          const bal = balanceMixedDoublesFour(m1, m2, f1, f2, true, options.mode);
          const four = [m1, m2, f1, f2];
          return Math.max(
            0,
            getMatchOverlapPenalty(four, true) +
              getPairPenalty(bal.teamA[0], bal.teamA[1], true) +
              getPairPenalty(bal.teamB[0], bal.teamB[1], true) +
              getOpponentPenalty(bal.teamA, bal.teamB, true) -
              getSameCourtPartnerBonus(four)
          );
        };
        const topMixedOverlap = evalMixedDup(
          top2M[0].player,
          top2M[1].player,
          top2F[0].player,
          top2F[1].player
        );
        if (topMixedOverlap > 0) {
          let bestM = top2M;
          let bestF = top2F;
          let bestCost = Infinity;
          for (let mi = 0; mi < windowM.length - 1; mi++) {
            for (let mj = mi + 1; mj < windowM.length; mj++) {
              for (let fi = 0; fi < windowF.length - 1; fi++) {
                for (let fj = fi + 1; fj < windowF.length; fj++) {
                  const overlap = evalMixedDup(
                    windowM[mi].player,
                    windowM[mj].player,
                    windowF[fi].player,
                    windowF[fj].player
                  );
                  const rankCost = (mi + mj + fi + fj) * 3500;
                  const totalCost = overlap + rankCost;
                  if (totalCost < bestCost) {
                    bestCost = totalCost;
                    bestM = [windowM[mi], windowM[mj]];
                    bestF = [windowF[fi], windowF[fj]];
                  }
                }
              }
            }
          }
          top2M = bestM;
          top2F = bestF;
        }
      }

      const hasPartnerPair = top2M.some((m) =>
        top2F.some((f) => areDesignatedPartners(m.player, f.player))
      );
      const avgArrival =
        (top2M[0].sortRank +
          top2M[1].sortRank +
          top2F[0].sortRank +
          top2F[1].sortRank) /
        4;
      const maxArrival = Math.max(
        top2M[0].sortRank,
        top2M[1].sortRank,
        top2F[0].sortRank,
        top2F[1].sortRank
      );
      validOptions.push({
        type: 'XD',
        malesUsed: top2M,
        femalesUsed: top2F,
        avgArrivalIndex: hasPartnerPair ? avgArrival - 2.5 : avgArrival,
        maxArrivalIndex: maxArrival,
        hasPartnerPair,
        title: '혼복',
      });
    }

    // If no pure standard match (4M, 4F, or 2M+2F) can be formed from unassigned pool,
    // break out to borrow from earlier assigned teams (starting from newMatches[0])
    if (validOptions.length === 0) break;

    const remainingMatches = targetMatchCount - mIdx;
    const mixedNeeded = targetMixedMatches - mixedCount;

    const hasDoublesOption = validOptions.some((o) => o.type === 'MD' || o.type === 'WD');
    const hasMixedOption = validOptions.some((o) => o.type === 'XD');
    const xdOptionObj = validOptions.find((o) => o.type === 'XD');

    let preferMixed = false;
    if (options.mode === 'doubles_only') {
      preferMixed = false;
    } else if (options.mode === 'mixed_preference') {
      preferMixed = hasMixedOption;
    } else if (!hasDoublesOption && hasMixedOption) {
      preferMixed = true;
    } else if (hasDoublesOption && !hasMixedOption) {
      preferMixed = false;
    } else if (hasDoublesOption && hasMixedOption) {
      if (xdOptionObj?.hasPartnerPair) {
        preferMixed = true;
      } else if (mixedCount >= targetMixedMatches) {
        preferMixed = false;
      } else if (mixedNeeded >= remainingMatches) {
        preferMixed = true;
      } else {
        if (doublesCount < 2 || (doublesCount < 3 * (mixedCount + 1) && remainingMatches > mixedNeeded + 1)) {
          preferMixed = false;
        } else {
          preferMixed = true;
        }
      }
    }

    const prevType = newMatches.length > 0 ? newMatches[newMatches.length - 1].title : '';

    validOptions.sort((a, b) => {
      const aIsMixed = a.type === 'XD';
      const bIsMixed = b.type === 'XD';

      // 혼복 우선 모드일 때는 같은 시간대(지각 오프셋 단계) 내에서 혼복을 최우선 선택
      if (options.mode === 'mixed_preference' && Math.abs(a.avgArrivalIndex - b.avgArrivalIndex) < 250) {
        if (preferMixed && aIsMixed && !bIsMixed) return -1;
        if (preferMixed && !aIsMixed && bIsMixed) return 1;
      }

      // 1. 참가순(도착 순서) 최우선: 먼저 온 참가자 그룹(평균 참가순 및 최대 순번)이 눈에 띄게 앞선다면 급수나 종목에 무관하게 먼저 배정
      const arrivalDiff = a.avgArrivalIndex - b.avgArrivalIndex;
      if (Math.abs(arrivalDiff) > 1.25) {
        return arrivalDiff;
      }
      const maxDiff = a.maxArrivalIndex - b.maxArrivalIndex;
      if (Math.abs(maxDiff) > 2) {
        return maxDiff;
      }

      // 2. 참가순이 거의 동일한 후보 간에는 복식/혼복 비율 및 남복/여복 교차 적용
      if (preferMixed && aIsMixed && !bIsMixed) return -1;
      if (preferMixed && !aIsMixed && bIsMixed) return 1;
      if (!preferMixed && !aIsMixed && bIsMixed) return -1;
      if (!preferMixed && aIsMixed && !bIsMixed) return 1;

      if (!aIsMixed && !bIsMixed && prevType) {
        if (a.title.includes(prevType) && !b.title.includes(prevType)) return 1;
        if (!a.title.includes(prevType) && b.title.includes(prevType)) return -1;
      }

      return arrivalDiff;
    });

    const chosenOption = validOptions[0];

    // Balance teams
    let teamAPlayers: [Player, Player];
    let teamBPlayers: [Player, Player];

    if (chosenOption.type === 'MD') {
      const p = chosenOption.malesUsed.map((x) => x.player);
      const balanced = balanceDoublesFour(p[0], p[1], p[2], p[3], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      const usedIds = new Set(p.map((x) => x.id));
      males = males.filter((x) => !usedIds.has(x.player.id));
    } else if (chosenOption.type === 'WD') {
      const p = chosenOption.femalesUsed.map((x) => x.player);
      const balanced = balanceDoublesFour(p[0], p[1], p[2], p[3], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      const usedIds = new Set(p.map((x) => x.id));
      females = females.filter((x) => !usedIds.has(x.player.id));
    } else {
      const m = chosenOption.malesUsed.map((x) => x.player);
      const f = chosenOption.femalesUsed.map((x) => x.player);
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      const usedMIds = new Set(m.map((x) => x.id));
      const usedFIds = new Set(f.map((x) => x.id));
      males = males.filter((x) => !usedMIds.has(x.player.id));
      females = females.filter((x) => !usedFIds.has(x.player.id));
    }

    recordFormedMatchTierPattern([...teamAPlayers, ...teamBPlayers]);

    const match: CourtMatch = {
      id: generateId(),
      courtNumber: 0,
      round: 1,
      teamA: {
        player1Id: teamAPlayers[0].id,
        player2Id: teamAPlayers[1].id,
        score: 0,
      },
      teamB: {
        player1Id: teamBPlayers[0].id,
        player2Id: teamBPlayers[1].id,
        score: 0,
      },
      status: 'queued',
      title: chosenOption.title,
      startedAt: Date.now(),
    };

    newMatches.push(match);

    // Update in-memory partner and opponent history for cloned candidate players so subsequent matches in this batch avoid duplicate assigned matches
    updateInMemoryMatchHistory(playersWithHistory, teamAPlayers, teamBPlayers);

    if (chosenOption.type === 'MD' || chosenOption.type === 'WD') {
      doublesCount++;
    } else {
      mixedCount++;
    }
  }

  // Helper to retrieve borrowable players from earlier assigned teams,
  // prioritizing the first assigned team (newMatches[0]) as requested
  const getBorrowablePlayers = () => {
    const list: Player[] = [];
    const seen = new Set<string>();
    for (const match of newMatches) {
      const ids = [
        match.teamA.player1Id,
        match.teamA.player2Id,
        match.teamB.player1Id,
        match.teamB.player2Id,
      ];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          const p = playersWithHistory.find((x) => x.id === id);
          if (p) list.push(p);
        }
      }
    }
    return list;
  };

  // Remaining unassigned players resolution:
  // User instruction: "3:1 배정은 만들지 말고 먼저 참가해 제일 처음 배정된 팀에서 대려와 복식/혼복 배정을 해줘"
  // 잔여 인원의 지정 파트너가 앞선 배정 팀(borrowable)에 있다면 우선 차출하여 파트너 동반 코트 배정 보장
  while (males.length > 0 || females.length > 0) {
    const borrowable = getBorrowablePlayers().filter((p) =>
      isPlayerEligibleForMatchmaking(p, activeCourtPlayerIds, [...existingQueuedMatches, ...newMatches])
    );
    const unassignedPlayers = [
      ...males.map((x) => x.player),
      ...females.map((x) => x.player),
    ];
    const prioritizeBorrow = (list: Player[]) => {
      return [...list].sort((a, b) => {
        // 늦게 등록된 선수는 상대평가 오프셋 단계에 따라 추가 차출(보충 경기)에서 후순위로 배치하여 앞선 단계 선수와 배정 수가 같아지거나 연속 게임에 들어가는 것을 방지
        const aOffset = relativeOffsetMap[a.id] ?? getPlayerEffectiveOffset(a, allPlayers);
        const bOffset = relativeOffsetMap[b.id] ?? getPlayerEffectiveOffset(b, allPlayers);
        if (aOffset !== bOffset) return aOffset - bOffset;
        const aIsPartner = unassignedPlayers.some((u) => areDesignatedPartners(u, a)) ? 1 : 0;
        const bIsPartner = unassignedPlayers.some((u) => areDesignatedPartners(u, b)) ? 1 : 0;
        if (bIsPartner !== aIsPartner) return bIsPartner - aIsPartner;
        if (options.avoidDuplicatePartners) {
          const aDup = unassignedPlayers.reduce(
            (sum, u) =>
              sum +
              (u.partnerHistory?.[a.id] || 0) * 2 +
              (u.opponentHistory?.[a.id] || 0),
            0
          );
          const bDup = unassignedPlayers.reduce(
            (sum, u) =>
              sum +
              (u.partnerHistory?.[b.id] || 0) * 2 +
              (u.opponentHistory?.[b.id] || 0),
            0
          );
          if (aDup !== bDup) return aDup - bDup;
        }
        return getPlayerRegistrationTime(a) - getPlayerRegistrationTime(b);
      });
    };
    const bMales = prioritizeBorrow(borrowable.filter((p) => p.gender === 'M'));
    const bFemales = prioritizeBorrow(borrowable.filter((p) => p.gender === 'F'));

    let teamAPlayers: [Player, Player] | null = null;
    let teamBPlayers: [Player, Player] | null = null;
    let title = '';

    if (options.mode === 'doubles_only') {
      if (males.length > 0) {
        const takeM = males.slice(0, Math.min(4, males.length)).map((x) => x.player);
        const needed = 4 - takeM.length;
        const takeIds = new Set(takeM.map((p) => p.id));
        const availBMales = bMales.filter((p) => !takeIds.has(p.id));
        if (availBMales.length >= needed) {
          const fourM = [...takeM, ...availBMales.slice(0, needed)];
          const balanced = balanceDoublesFour(fourM[0], fourM[1], fourM[2], fourM[3], options.avoidDuplicatePartners, options.mode);
          teamAPlayers = balanced.teamA;
          teamBPlayers = balanced.teamB;
          title = '남복';
        }
        males = males.slice(takeM.length);
      } else if (females.length > 0) {
        const takeF = females.slice(0, Math.min(4, females.length)).map((x) => x.player);
        const needed = 4 - takeF.length;
        const takeIds = new Set(takeF.map((p) => p.id));
        const availBFemales = bFemales.filter((p) => !takeIds.has(p.id));
        if (availBFemales.length >= needed) {
          const fourF = [...takeF, ...availBFemales.slice(0, needed)];
          const balanced = balanceDoublesFour(fourF[0], fourF[1], fourF[2], fourF[3], options.avoidDuplicatePartners, options.mode);
          teamAPlayers = balanced.teamA;
          teamBPlayers = balanced.teamB;
          title = '여복';
        }
        females = females.slice(takeF.length);
      } else {
        break;
      }
    } else if (options.mode === 'mixed_preference' && males.length >= 2 && females.length >= 1 && bFemales.length >= 1) {
      const m = males.slice(0, 2).map((x) => x.player);
      const f = [females[0].player, bFemales[0]];
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(2);
      females = females.slice(1);
    } else if (options.mode === 'mixed_preference' && males.length >= 1 && females.length >= 2 && bMales.length >= 1) {
      const m = [males[0].player, bMales[0]];
      const f = females.slice(0, 2).map((x) => x.player);
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(1);
      females = females.slice(2);
    } else if (options.mode === 'mixed_preference' && males.length >= 2 && bFemales.length >= 2) {
      const m = males.slice(0, 2).map((x) => x.player);
      const balanced = balanceMixedDoublesFour(m[0], m[1], bFemales[0], bFemales[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(2);
    } else if (options.mode === 'mixed_preference' && females.length >= 2 && bMales.length >= 2) {
      const f = females.slice(0, 2).map((x) => x.player);
      const balanced = balanceMixedDoublesFour(bMales[0], bMales[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      females = females.slice(2);
    } else if (males.length >= 3 && bMales.length >= 1) {
      const p = males.slice(0, 3).map((x) => x.player);
      const balanced = balanceDoublesFour(p[0], p[1], p[2], bMales[0], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '남복';
      males = males.slice(3);
    } else if (females.length >= 3 && bFemales.length >= 1) {
      const p = females.slice(0, 3).map((x) => x.player);
      const balanced = balanceDoublesFour(p[0], p[1], p[2], bFemales[0], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '여복';
      females = females.slice(3);
    } else if (males.length >= 2 && females.length >= 1 && bFemales.length >= 1) {
      const m = males.slice(0, 2).map((x) => x.player);
      const f = [females[0].player, bFemales[0]];
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(2);
      females = females.slice(1);
    } else if (males.length >= 1 && females.length >= 2 && bMales.length >= 1) {
      const m = [males[0].player, bMales[0]];
      const f = females.slice(0, 2).map((x) => x.player);
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(1);
      females = females.slice(2);
    } else if (males.length >= 1 && females.length >= 1 && bMales.length >= 1 && bFemales.length >= 1) {
      const m = [males[0].player, bMales[0]];
      const f = [females[0].player, bFemales[0]];
      const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
      teamAPlayers = balanced.teamA;
      teamBPlayers = balanced.teamB;
      title = '혼복';
      males = males.slice(1);
      females = females.slice(1);
    } else if (males.length >= 2) {
      const p = males.slice(0, 2).map((x) => x.player);
      if (bMales.length >= 2) {
        const balanced = balanceDoublesFour(p[0], p[1], bMales[0], bMales[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '남복';
      } else if (bFemales.length >= 2) {
        const balanced = balanceMixedDoublesFour(p[0], p[1], bFemales[0], bFemales[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '혼복';
      }
      males = males.slice(2);
    } else if (females.length >= 2) {
      const p = females.slice(0, 2).map((x) => x.player);
      if (bFemales.length >= 2) {
        const balanced = balanceDoublesFour(p[0], p[1], bFemales[0], bFemales[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '여복';
      } else if (bMales.length >= 2) {
        const balanced = balanceMixedDoublesFour(bMales[0], bMales[1], p[0], p[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '혼복';
      }
      females = females.slice(2);
    } else if (males.length === 1) {
      if (bMales.length >= 1 && bFemales.length >= 2) {
        const m = [males[0].player, bMales[0]];
        const f = [bFemales[0], bFemales[1]];
        const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '혼복';
      } else if (bMales.length >= 3) {
        const balanced = balanceDoublesFour(males[0].player, bMales[0], bMales[1], bMales[2], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '남복';
      }
      males = males.slice(1);
    } else if (females.length === 1) {
      if (bMales.length >= 2 && bFemales.length >= 1) {
        const m = [bMales[0], bMales[1]];
        const f = [females[0].player, bFemales[0]];
        const balanced = balanceMixedDoublesFour(m[0], m[1], f[0], f[1], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '혼복';
      } else if (bFemales.length >= 3) {
        const balanced = balanceDoublesFour(females[0].player, bFemales[0], bFemales[1], bFemales[2], options.avoidDuplicatePartners, options.mode);
        teamAPlayers = balanced.teamA;
        teamBPlayers = balanced.teamB;
        title = '여복';
      }
      females = females.slice(1);
    } else {
      break;
    }

    if (!teamAPlayers || !teamBPlayers) {
      continue;
    }

    const match: CourtMatch = {
      id: generateId(),
      courtNumber: 0,
      round: 1,
      teamA: {
        player1Id: teamAPlayers[0].id,
        player2Id: teamAPlayers[1].id,
        score: 0,
      },
      teamB: {
        player1Id: teamBPlayers[0].id,
        player2Id: teamBPlayers[1].id,
        score: 0,
      },
      status: 'queued',
      title,
      startedAt: Date.now(),
    };

    newMatches.push(match);

    // Update in-memory partner and opponent history for borrowed/assigned candidate players
    updateInMemoryMatchHistory(playersWithHistory, teamAPlayers, teamBPlayers);
  }


  if (newMatches.length === 0) {
    throw new Error('참가자 순서에 맞춰 배정할 수 있는 유효한 복식/혼복 조합을 생성하지 못했습니다.');
  }

  return newMatches;
}



