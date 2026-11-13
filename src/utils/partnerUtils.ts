import { Player } from '../types';

export interface PartnerColorDef {
  id: string;
  name: string;
  bg: string;
  border: string;
  text: string;
  shadow: string;
  glow: string;
  ring: string;
}

// 12가지 서로 다른 선명하고 독특한 파트너 고유 색상 팔레트
export const PARTNER_COLOR_PALETTE: PartnerColorDef[] = [
  {
    id: 'cyan',
    name: '시안 블루',
    bg: 'bg-cyan-500',
    border: 'border-cyan-300',
    text: 'text-cyan-300',
    shadow: 'shadow-cyan-500/50',
    glow: '#06b6d4',
    ring: 'ring-cyan-400',
  },
  {
    id: 'rose',
    name: '로즈 핑크',
    bg: 'bg-rose-500',
    border: 'border-rose-300',
    text: 'text-rose-300',
    shadow: 'shadow-rose-500/50',
    glow: '#f43f5e',
    ring: 'ring-rose-400',
  },
  {
    id: 'amber',
    name: '앰버 옐로우',
    bg: 'bg-amber-400',
    border: 'border-amber-300',
    text: 'text-amber-300',
    shadow: 'shadow-amber-400/50',
    glow: '#f59e0b',
    ring: 'ring-amber-400',
  },
  {
    id: 'purple',
    name: '바이올렛 퍼플',
    bg: 'bg-purple-500',
    border: 'border-purple-300',
    text: 'text-purple-300',
    shadow: 'shadow-purple-500/50',
    glow: '#a855f7',
    ring: 'ring-purple-400',
  },
  {
    id: 'emerald',
    name: '에메랄드 그린',
    bg: 'bg-emerald-500',
    border: 'border-emerald-300',
    text: 'text-emerald-300',
    shadow: 'shadow-emerald-500/50',
    glow: '#10b981',
    ring: 'ring-emerald-400',
  },
  {
    id: 'orange',
    name: '비비드 오렌지',
    bg: 'bg-orange-500',
    border: 'border-orange-300',
    text: 'text-orange-300',
    shadow: 'shadow-orange-500/50',
    glow: '#f97316',
    ring: 'ring-orange-400',
  },
  {
    id: 'sky',
    name: '스카이 블루',
    bg: 'bg-sky-400',
    border: 'border-sky-300',
    text: 'text-sky-300',
    shadow: 'shadow-sky-400/50',
    glow: '#38bdf8',
    ring: 'ring-sky-400',
  },
  {
    id: 'fuchsia',
    name: '푸시아 마젠타',
    bg: 'bg-fuchsia-500',
    border: 'border-fuchsia-300',
    text: 'text-fuchsia-300',
    shadow: 'shadow-fuchsia-500/50',
    glow: '#d946ef',
    ring: 'ring-fuchsia-400',
  },
  {
    id: 'lime',
    name: '라임 옐로그린',
    bg: 'bg-lime-400',
    border: 'border-lime-300',
    text: 'text-lime-300',
    shadow: 'shadow-lime-400/50',
    glow: '#a3e635',
    ring: 'ring-lime-400',
  },
  {
    id: 'indigo',
    name: '인디고 블루',
    bg: 'bg-indigo-500',
    border: 'border-indigo-300',
    text: 'text-indigo-300',
    shadow: 'shadow-indigo-500/50',
    glow: '#6366f1',
    ring: 'ring-indigo-400',
  },
  {
    id: 'teal',
    name: '딥 틸',
    bg: 'bg-teal-400',
    border: 'border-teal-300',
    text: 'text-teal-300',
    shadow: 'shadow-teal-400/50',
    glow: '#2dd4bf',
    ring: 'ring-teal-400',
  },
  {
    id: 'red',
    name: '비비드 레드',
    bg: 'bg-red-500',
    border: 'border-red-300',
    text: 'text-red-300',
    shadow: 'shadow-red-500/50',
    glow: '#ef4444',
    ring: 'ring-red-400',
  },
];

export interface PartnerPair {
  pairKey: string;
  player1: Player;
  player2: Player;
  color: PartnerColorDef;
  pairIndex: number;
}

/**
 * 정렬된 ID를 기반으로 고유한 파트너 쌍 키를 생성
 */
export function getPartnerPairKey(id1: string, id2: string): string {
  return [id1, id2].sort().join('___');
}

/**
 * 모든 참가자 중에서 고유한 파트너 쌍 목록 추출
 */
export function getUniquePartnerPairs(players: Player[]): PartnerPair[] {
  const playerMap = new Map<string, Player>(players.map((p) => [p.id, p]));
  const seenPairKeys = new Set<string>();
  const pairs: PartnerPair[] = [];

  for (const player of players) {
    if (!player.partnerId) continue;
    const partner = playerMap.get(player.partnerId);
    if (!partner) continue;

    const key = getPartnerPairKey(player.id, partner.id);
    if (seenPairKeys.has(key)) continue;
    seenPairKeys.add(key);

    const pairIndex = pairs.length;
    const color = PARTNER_COLOR_PALETTE[pairIndex % PARTNER_COLOR_PALETTE.length];

    pairs.push({
      pairKey: key,
      player1: player,
      player2: partner,
      color,
      pairIndex,
    });
  }

  return pairs;
}

/**
 * 특정 선수의 파트너 정보 및 고유 색상 추출
 */
export function getPartnerInfo(
  playerId: string,
  allPlayers: Player[]
): {
  hasPartner: boolean;
  partner?: Player;
  color: PartnerColorDef;
  pairIndex: number;
} | null {
  const player = allPlayers.find((p) => p.id === playerId);
  if (!player || !player.partnerId) return null;

  const partner = allPlayers.find((p) => p.id === player.partnerId);
  if (!partner) return null;

  const pairs = getUniquePartnerPairs(allPlayers);
  const targetPair = pairs.find(
    (pr) =>
      (pr.player1.id === playerId && pr.player2.id === partner.id) ||
      (pr.player1.id === partner.id && pr.player2.id === playerId)
  );

  if (!targetPair) {
    return {
      hasPartner: true,
      partner,
      color: PARTNER_COLOR_PALETTE[0],
      pairIndex: 0,
    };
  }

  return {
    hasPartner: true,
    partner,
    color: targetPair.color,
    pairIndex: targetPair.pairIndex,
  };
}

/**
 * 두 선수를 상호 파트너로 설정 (이전 파트너가 있었다면 자동 정리)
 */
export function setPartnerPair(
  players: Player[],
  player1Id: string,
  player2Id: string
): Player[] {
  if (player1Id === player2Id) return players;

  return players.map((p) => {
    // 플레이어 1: 플레이어 2를 파트너로 설정
    if (p.id === player1Id) {
      return { ...p, partnerId: player2Id };
    }
    // 플레이어 2: 플레이어 1을 파트너로 설정
    if (p.id === player2Id) {
      return { ...p, partnerId: player1Id };
    }
    // 만약 플레이어 1 또는 2와 이전에 파트너였던 다른 선수가 있다면 파트너 해제
    if (p.partnerId === player1Id || p.partnerId === player2Id) {
      return { ...p, partnerId: undefined };
    }
    return p;
  });
}

/**
 * 특정 선수의 파트너 관계 해제
 */
export function removePartnerPair(players: Player[], playerId: string): Player[] {
  const target = players.find((p) => p.id === playerId);
  const partnerId = target?.partnerId;

  return players.map((p) => {
    if (p.id === playerId || (partnerId && p.id === partnerId) || p.partnerId === playerId) {
      return { ...p, partnerId: undefined };
    }
    return p;
  });
}

/**
 * 모든 참가자의 파트너 설정 일괄 해제
 */
export function clearAllPartners(players: Player[]): Player[] {
  return players.map((p) => ({ ...p, partnerId: undefined }));
}
