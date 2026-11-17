export type Gender = 'M' | 'F';

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D' | 'Beginner';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  tier: Tier;
  isActive: boolean; // whether currently participating in generation
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalPointsWon: number;
  totalPointsLost: number;
  consecutiveRestRounds: number;
  partnerHistory: Record<string, number>; // playerId -> times partnered
  opponentHistory: Record<string, number>; // playerId -> times faced
  createdAt: number;
  registeredAt?: number; // 참가자 명단에 실시간 등록된 시각 (타임스탬프, 화면 비노출)
  initialAssignedOffset?: number; // 지각(늦게) 등록되거나 휴식을 사용한 선수의 배정/진행 보정 오프셋 (동등 배정 및 연속 게임 투입 방지용)
  registeredBeforeFirstAssign?: boolean; // 맨처음 등록된 4명의 선수들의 첫번째 배정/진행 시작 이후 20분 미만(또는 시작 이전)에 등록된 참가자 여부 (true: 지각 오프셋 0, false: 첫 배정/진행 시작 이후 20분 경과 후 등록된 지각 참가자)
  firstFourAssignedAt?: number; // 맨처음 등록된 4명의 첫번째 배정/진행이 시작된 기준 타임스탬프 (첫 배정/진행 시작 이후 20분 경과 시점부터 지각 오프셋 산정용)
  hasRested?: boolean; // 부채꼴 메뉴 휴식(resting) 기능 사용 이력 여부
  restStartedAt?: number; // 휴식 시작 시각 (타임스탬프, 화면 비노출)
  restEndedAt?: number; // 휴식 해제 시각 (타임스탬프, 화면 비노출)
  restStartGamesPlayed?: number; // 휴식 설정/해제 시점의 완료 게임 수 (해제 직후 연속 경기 투입 차단용)
  manualInterventionExempt?: boolean; // 선수교체, 대기열배정, 코트에배정 등 수동 배정/진행 관여 시 밀림 방지 플래그
  shuttlecockSubmitted?: boolean; // 콕제출 완료 여부
  partnerId?: string; // 파트너 선수 ID (같은 코트 우선 배정)
  lastPartnerId?: string; // 직전(이전) 배정 경기 함께 뛴 파트너 ID
  lastOpponentIds?: string[]; // 직전(이전) 배정 경기 상대팀 선수 ID 목록
  specialStatus?: 'resting' | 'lesson' | 'last_match' | 'exited'; // 'resting': 휴식중, 'lesson': 레슨중, 'last_match': 마지막판(막판), 'exited': 퇴장, undefined: 정상 대기/출전 가능
  lastMatchInitialGamesPlayed?: number; // 마지막판 지정 시점의 완료 게임 수 (1판 배정 후 자동 제외 관리용)
  masterMemberId?: string; // 전체 회원 고유 ID (전체회원관리와 1:1 완전 동기화 연동용)
  coneNumber?: number | string; // 꼬깔 번호
  attendancePending?: boolean; // 일괄등록 출석체크 대기 상태 여부 (true: 이름 빗금 및 출석 버튼 표시, 코트현황/게임목록 비노출)
  isTest?: boolean; // 테스트(선수 24명 생성) 기능으로 등록된 선수 여부 (전체 회원 명부 등록 제외)
}

export interface MasterMember {
  id: string;
  name: string;
  gender: Gender;
  tier: Tier;
  registeredAt: number;
}

export interface MatchTeam {
  player1Id: string;
  player2Id: string;
  score: number;
}

export type ConeColor = 'red' | 'gray'; // 'red': 우리클럽 (Red), 'gray': 다른클럽 (Gray)

export interface ConeItem {
  id: string;
  color: ConeColor;
  label?: string; // e.g. "우리클럽", "타클럽"
  orderNumber?: number; // 생성 고유 순번 (1번째, 2번째, 3번째...)
}

export interface CourtTurnRecord {
  prevConeId: string;
  prevTurnColor: ConeColor;
  completedMatchId?: string;
}

export interface CourtInfo {
  id: string;
  courtNumber: number;
  name: string;
  cones: ConeItem[];
  currentConeIndex: number;
  turnStartedAt?: number;
  turnHistory?: CourtTurnRecord[];
}

export type MatchStatus = 'waiting' | 'in_progress' | 'completed' | 'queued';

export interface CourtMatch {
  id: string;
  courtNumber: number; // 0 if in queue waiting for court, or 1..N
  courtName?: string; // Custom name of court when assigned
  round?: number;
  teamA: MatchTeam;
  teamB: MatchTeam;
  status: MatchStatus;
  winner?: 'teamA' | 'teamB' | 'draw';
  startedAt?: number;
  completedAt?: number;
  elapsedSeconds?: number;
  title?: string; // Optional label e.g. "대기 1경기"
  isSpecialMatch?: boolean; // 선택한 4명으로 생성된 스페셜 게임 여부 (항상 대기열 최하단 유지 및 순서 도달 시 오로라 활성화)
  specialTargetLevel?: number; // 스페셜 게임 생성 시점의 목표 배정/진행 기준 단계 (다른 선수들이 이 단계를 넘어서면 스페셜 게임 투입 차례 도달)
  playerAssignedAt?: Record<string, number>; // playerId -> timestamp when assigned to this court
  playerSnapshots?: Record<
    string,
    { id: string; name: string; tier: Tier; gender: Gender; coneNumber?: number | string }
  >;
}

/**
 * 스페셜 게임(isSpecialMatch === true)이 항상 대기열 가장 아래(최하단)에 위치하도록 정렬을 보장하는 헬퍼 함수
 * 일반 대기열 경기들의 상대적 순서와 스페셜 게임들 간의 상대적 순서는 그대로 유지합니다.
 */
export const keepSpecialMatchesAtBottom = (matches: CourtMatch[]): CourtMatch[] => {
  if (!matches || matches.length <= 1) return matches || [];
  const normalMatches = matches.filter((m) => !m.isSpecialMatch);
  const specialMatches = matches.filter((m) => Boolean(m.isSpecialMatch));
  if (specialMatches.length === 0) return matches;
  return [...normalMatches, ...specialMatches];
};

export interface MatchRound {
  roundNumber: number;
  matches: CourtMatch[];
  restingPlayerIds: string[];
  timestamp: number;
}

export type MatchmakingMode = 'random' | 'balanced' | 'mixed_preference' | 'doubles_only';

export interface MatchOptions {
  mode: MatchmakingMode;
  courtCount: number;
  avoidConsecutiveRests: boolean;
  avoidDuplicatePartners: boolean;
  // 전체 경기 및 혼복 비율(15게임당 2~3.5게임) 조절용 세션 통계
  totalSessionMatches?: number;
  mixedSessionMatches?: number;
}

export const TIER_SCORES: Record<Tier, number> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  Beginner: 1,
};

export const TIER_LABELS: Record<Tier, { label: string; short: string; color: string; bg: string }> = {
  S: { label: 'S조', short: 'S조', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-400/40' },
  A: { label: 'A조', short: 'A조', color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' },
  B: { label: 'B조', short: 'B조', color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30' },
  C: { label: 'C조', short: 'C조', color: 'text-sky-400', bg: 'bg-sky-400/10 border-sky-400/30' },
  D: { label: 'D조', short: 'D조', color: 'text-indigo-400', bg: 'bg-indigo-400/10 border-indigo-400/30' },
  Beginner: { label: 'E조', short: 'E조', color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30' },
};

export interface SwapSelection {
  playerId: string;
  source: 'court' | 'bench';
  matchId?: string;
  team?: 'teamA' | 'teamB';
  slot?: 1 | 2;
  courtNumber?: number;
}

/**
 * 선수의 이름과 꼬깔 번호를 동일한 폰트/크기/색상으로 표현하기 위한 포맷 함수
 * 꼬깔 번호가 있는 경우: "홍길동 7", 없는 경우: "홍길동"
 */
export const formatPlayerDisplayName = (
  playerOrMember?: { name: string; coneNumber?: number | string } | null
): string => {
  if (!playerOrMember) return '';
  const cone = playerOrMember.coneNumber !== undefined && playerOrMember.coneNumber !== ''
    ? ` ${playerOrMember.coneNumber}`
    : '';
  return `${playerOrMember.name}${cone}`;
};

/**
 * 선수가 직접 '퇴장' 상태로 지정되었거나, 마지막판(막판) 상태에서 코트 배정 후 경기를 완료하여 '퇴장!' 상태인지 판별하는 함수
 */
export const isPlayerLastMatchCompleted = (player?: Player | null): boolean => {
  if (!player) return false;
  if (player.specialStatus === 'exited') return true;
  if (player.specialStatus !== 'last_match') return false;
  if (player.lastMatchInitialGamesPlayed === undefined) return false;
  return (player.gamesPlayed || 0) > player.lastMatchInitialGamesPlayed;
};

/**
 * 코트 이름(예: "제 1코트", "제1코트", "제 3 코트")에서 고정된 '제'와 '코트'를 제외한 번호(n)만 추출
 */
export const extractCourtNumberLabel = (
  courtName?: string,
  fallbackNumber?: number
): string => {
  if (!courtName) {
    return fallbackNumber !== undefined ? String(fallbackNumber) : '1';
  }
  const stripped = courtName
    .replace(/^제\s*/, '')
    .replace(/\s*코트$/, '')
    .trim();
  return stripped || (fallbackNumber !== undefined ? String(fallbackNumber) : '1');
};

/**
 * 번호(n)를 받아 고정 형식인 'n코트'로 반환 ('코트'는 고정)
 */
export const formatCourtName = (n: string | number): string => {
  const clean = String(n).trim();
  return `${clean}코트`;
};

/**
 * 각 꼬깔(ConeItem)에 고유 순번(orderNumber: 1, 2, 3...)이 부여되어 있는지 보장
 */
export const ensureConeOrderNumbers = (cones?: ConeItem[]): ConeItem[] => {
  if (!cones || cones.length === 0) return [];
  const usedNumbers = new Set<number>();
  cones.forEach((c) => {
    if (typeof c.orderNumber === 'number' && c.orderNumber >= 1) {
      usedNumbers.add(c.orderNumber);
    }
  });
  let nextNum = 1;
  return cones.map((c) => {
    if (typeof c.orderNumber === 'number' && c.orderNumber >= 1) {
      return c;
    }
    while (usedNumbers.has(nextNum)) {
      nextNum++;
    }
    usedNumbers.add(nextNum);
    return {
      ...c,
      orderNumber: nextNum,
    };
  });
};

/**
 * 꼬깔 삭제 시 남은 꼬깔들의 고유 순번을 상대적 크기 순서대로 1..N으로 재정렬
 */
export const compactConeOrderNumbers = (cones: ConeItem[]): ConeItem[] => {
  const withOrders = ensureConeOrderNumbers(cones);
  const sortedUniqueOrders = Array.from(
    new Set(withOrders.map((c) => c.orderNumber || 1))
  ).sort((a: number, b: number) => a - b);
  const rankMap = new Map<number, number>();
  sortedUniqueOrders.forEach((ord, idx) => {
    rankMap.set(ord, idx + 1);
  });
  return withOrders.map((c) => ({
    ...c,
    orderNumber: rankMap.get(c.orderNumber || 1) || 1,
  }));
};

/**
 * 현재 코트의 꼬깔 배열과 currentConeIndex를 받아
 * [현재 진행 꼬깔(index 0), 다음 꼬깔(index 1), ..., 마지막 대기 꼬깔(index N-1)] 순서의 정규화된 큐 반환
 */
export const getNormalizedTurnQueue = (
  cones?: ConeItem[],
  currentConeIndex: number = 0
): ConeItem[] => {
  const ensured = ensureConeOrderNumbers(cones);
  if (ensured.length === 0) return [];
  const safeIdx =
    ((currentConeIndex % ensured.length) + ensured.length) % ensured.length;
  if (safeIdx === 0) return ensured;
  return [...ensured.slice(safeIdx), ...ensured.slice(0, safeIdx)];
};

/**
 * 현재 턴(맨 앞 꼬깔)이 끝나면 맨 뒤로 보내고 다음 꼬깔이 맨 앞으로 오도록 순환
 * 예: (1번째 → 2번째 → 3번째) -> (2번째 → 3번째 → 1번째)
 */
export const advanceConeTurnQueue = (
  cones?: ConeItem[],
  currentConeIndex: number = 0
): {
  cones: ConeItem[];
  currentConeIndex: number;
  activeCone: ConeItem | null;
  prevCone: ConeItem | null;
} => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex);
  if (queue.length === 0) {
    return { cones: [], currentConeIndex: 0, activeCone: null, prevCone: null };
  }
  const prevCone = queue[0];
  const rotated = queue.length <= 1 ? queue : [...queue.slice(1), queue[0]];
  return {
    cones: rotated,
    currentConeIndex: 0,
    activeCone: rotated[0] || null,
    prevCone,
  };
};

/**
 * 중간에 새로운 꼬깔(+)이 생기면 현재 순환 순서의 맨 뒤에 (N+1)번째 꼬깔로 추가
 * 예: (2번째 → 3번째 → 1번째) + 신규 -> (2번째 → 3번째 → 1번째 → 4번째)
 */
export const addConeToTurnQueue = (
  cones: ConeItem[] | undefined,
  currentConeIndex: number | undefined,
  newConeOrColor: ConeItem | ConeColor
): { cones: ConeItem[]; currentConeIndex: number } => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex ?? 0);
  const maxOrder = queue.reduce(
    (max, c) => Math.max(max, c.orderNumber || 0),
    0
  );
  const nextOrder = Math.max(queue.length + 1, maxOrder + 1);
  const newConeObj: ConeItem =
    typeof newConeOrColor === 'string'
      ? {
          id: `cone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          color: newConeOrColor,
          label: newConeOrColor === 'red' ? '우리클럽' : '다른클럽',
          orderNumber: nextOrder,
        }
      : {
          ...newConeOrColor,
          orderNumber: nextOrder,
        };
  return {
    cones: [...queue, newConeObj],
    currentConeIndex: 0,
  };
};

/**
 * 꼬깔 삭제 시 정규화된 순환 큐에서 해당 꼬깔(기본: 가장 최근 추가된 맨 끝 꼬깔)을 제거하고 순번을 1..N으로 정리
 */
export const removeConeFromTurnQueue = (
  cones: ConeItem[] | undefined,
  currentConeIndex: number | undefined,
  removeQueueIndex?: number
): { cones: ConeItem[]; currentConeIndex: number } => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex ?? 0);
  if (queue.length <= 1) return { cones: queue, currentConeIndex: 0 };
  const targetIdx =
    removeQueueIndex !== undefined ? removeQueueIndex : queue.length - 1;
  const filtered = queue.filter((_, idx) => idx !== targetIdx);
  return {
    cones: compactConeOrderNumbers(filtered),
    currentConeIndex: 0,
  };
};

/**
 * 전 경기 팀으로 되돌리기 시 방금 뒤로 갔던 직전 꼬깔(맨 뒤)을 다시 맨 앞으로 복원
 */
export const revertConeTurnQueue = (
  cones?: ConeItem[],
  currentConeIndex: number = 0
): {
  cones: ConeItem[];
  currentConeIndex: number;
  activeCone: ConeItem | null;
} => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex);
  if (queue.length <= 1) {
    return {
      cones: queue,
      currentConeIndex: 0,
      activeCone: queue[0] || null,
    };
  }
  const reverted = [queue[queue.length - 1], ...queue.slice(0, queue.length - 1)];
  return {
    cones: reverted,
    currentConeIndex: 0,
    activeCone: reverted[0] || null,
  };
};

/**
 * 전 경기 팀으로 되돌리기 시 기록된 직전 턴 꼬깔(targetConeId 또는 targetColor)을 현재 턴(맨 앞)으로 정확히 복원
 * (중간에 새 꼬깔이 맨 뒤에 추가된 경우에도 직전 턴 꼬깔을 찾아 맨 앞으로 복원)
 */
export const revertConeToTarget = (
  cones?: ConeItem[],
  currentConeIndex: number = 0,
  targetConeId?: string,
  targetColor?: ConeColor
): {
  cones: ConeItem[];
  currentConeIndex: number;
  activeCone: ConeItem | null;
} => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex);
  if (queue.length <= 1) {
    return {
      cones: queue,
      currentConeIndex: 0,
      activeCone: queue[0] || null,
    };
  }

  if (targetConeId) {
    const targetIdx = queue.findIndex((c) => c.id === targetConeId);
    if (targetIdx >= 0) {
      const rotated =
        targetIdx === 0
          ? queue
          : [queue[targetIdx], ...queue.slice(0, targetIdx), ...queue.slice(targetIdx + 1)];
      return {
        cones: rotated,
        currentConeIndex: 0,
        activeCone: rotated[0] || null,
      };
    }
  }

  if (targetColor) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].color === targetColor) {
        const rotated =
          i === 0 ? queue : [queue[i], ...queue.slice(0, i), ...queue.slice(i + 1)];
        return {
          cones: rotated,
          currentConeIndex: 0,
          activeCone: rotated[0] || null,
        };
      }
    }
  }

  return revertConeTurnQueue(cones, currentConeIndex);
};

/**
 * 우리클럽 경기가 즉시 시작될 때 가장 가까운 우리클럽(빨간 꼬깔)이 현재 턴(맨 앞)이 되도록 순환
 */
export const rotateQueueToFirstRedCone = (
  cones?: ConeItem[],
  currentConeIndex: number = 0
): {
  cones: ConeItem[];
  currentConeIndex: number;
  activeCone: ConeItem | null;
} => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex);
  if (queue.length <= 1) {
    return {
      cones: queue,
      currentConeIndex: 0,
      activeCone: queue[0] || null,
    };
  }
  const redIdx = queue.findIndex((c) => c.color === 'red');
  const rotated =
    redIdx <= 0 ? queue : [...queue.slice(redIdx), ...queue.slice(0, redIdx)];
  return {
    cones: rotated,
    currentConeIndex: 0,
    activeCone: rotated[0] || null,
  };
};

/**
 * 현재 꼬깔 순환 순서를 "(2번째 → 3번째 → 1번째 → 4번째)" 형식의 문자열로 반환
 */
export const formatConeTurnSequence = (
  cones?: ConeItem[],
  currentConeIndex: number = 0
): string => {
  const queue = getNormalizedTurnQueue(cones, currentConeIndex);
  if (queue.length === 0) return '';
  return `(${queue.map((c, idx) => `${c.orderNumber ?? idx + 1}번째`).join(' → ')})`;
};

