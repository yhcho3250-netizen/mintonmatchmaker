import { Player, Tier, Gender } from '../types';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
} from './deviceStorage';

export const LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS = DEVICE_STORAGE_KEYS.ARCHIVED_PLAYERS;

/**
 * 기기 내부(로컬 저장소)에서 보관된 전체 선수(삭제된 선수 포함) 기록 로드
 */
export function loadArchivedPlayers(): Record<string, Player> {
  try {
    const saved = getDeviceStorageItem(LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  return {};
}

/**
 * 기기 내부(로컬 저장소)에 보관된 전체 선수 기록 저장
 */
export function saveArchivedPlayersToStorage(archived: Record<string, Player>): void {
  try {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_ARCHIVED_PLAYERS, JSON.stringify(archived));
  } catch {
    // ignore
  }
}

/**
 * 현재 선수 목록을 아카이브 맵에 병합
 * - 기존에 저장된 통계(gamesPlayed, wins, losses 등) 중 최신/최대치를 유지
 */
export function mergePlayersIntoArchive(
  players: Player[],
  existingArchive: Record<string, Player> = {}
): Record<string, Player> {
  const updated: Record<string, Player> = { ...existingArchive };

  players.forEach((p) => {
    const prev = updated[p.id];
    if (!prev) {
      updated[p.id] = { ...p };
    } else {
      const isResetState =
        (p.gamesPlayed ?? 0) === 0 &&
        Object.keys(p.partnerHistory || {}).length === 0 &&
        Object.keys(p.opponentHistory || {}).length === 0;
      updated[p.id] = {
        ...prev,
        ...p,
        isTest: Boolean(p.isTest || prev.isTest || (typeof p.id === 'string' && p.id.startsWith('p_test_'))),
        specialStatus: p.specialStatus,
        lastMatchInitialGamesPlayed: p.lastMatchInitialGamesPlayed,
        gamesPlayed: p.gamesPlayed ?? prev.gamesPlayed ?? 0,
        wins: isResetState ? (p.wins ?? 0) : Math.max(p.wins ?? 0, prev.wins ?? 0),
        losses: isResetState ? (p.losses ?? 0) : Math.max(p.losses ?? 0, prev.losses ?? 0),
        partnerHistory: isResetState
          ? { ...(p.partnerHistory || {}) }
          : (() => {
              const merged: Record<string, number> = { ...(prev.partnerHistory || {}) };
              Object.entries(p.partnerHistory || {}).forEach(([pid, cnt]) => {
                merged[pid] = Math.max(merged[pid] || 0, cnt);
              });
              return merged;
            })(),
        opponentHistory: isResetState
          ? { ...(p.opponentHistory || {}) }
          : (() => {
              const merged: Record<string, number> = { ...(prev.opponentHistory || {}) };
              Object.entries(p.opponentHistory || {}).forEach(([pid, cnt]) => {
                merged[pid] = Math.max(merged[pid] || 0, cnt);
              });
              return merged;
            })(),
        lastPartnerId: isResetState ? p.lastPartnerId : p.lastPartnerId || prev.lastPartnerId,
      };
    }
  });

  return updated;
}

/**
 * 참가자명단에 다시 추가될 때 동일한 이름 및 급수를 가진 보관된 선수 탐색
 * - currentPlayers에 현재 이미 등록되어 있지 않은 선수만 매칭
 * - 테스트 선수(isTest / p_test_)는 실제 회원과 매칭되지 않도록 제외
 * - 여러 명일 경우 경기 수(gamesPlayed)가 가장 많은 선수를 우선 반환
 */
export function findMatchingArchivedPlayer(
  name: string,
  tier: Tier,
  archivedPlayers: Record<string, Player> | Player[],
  currentPlayers: Player[],
  gender?: Gender
): Player | undefined {
  const cleanName = name.trim().toLowerCase();
  if (!cleanName) return undefined;

  const currentIds = new Set(currentPlayers.map((p) => p.id));
  const list = Array.isArray(archivedPlayers)
    ? archivedPlayers
    : Object.values(archivedPlayers);

  const matched = list.filter((p) => {
    if (!p || currentIds.has(p.id)) return false; // 이미 현재 참가자명단에 있는 선수는 제외
    if (p.isTest || (typeof p.id === 'string' && p.id.startsWith('p_test_'))) return false; // 테스트 선수는 제외
    const pCleanName = (p.name || '').trim().toLowerCase();
    const isSameName = pCleanName === cleanName;
    const isSameTier = p.tier === tier;
    const isSameGender = gender ? p.gender === gender : true;
    return isSameName && isSameTier && isSameGender;
  });

  if (matched.length === 0) return undefined;

  // 경기 수 내림차순, 그 다음 생성일자 내림차순 정렬
  matched.sort((a, b) => {
    const diff = (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0);
    if (diff !== 0) return diff;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });

  return matched[0];
}

/**
 * 경기 완료/저장 시 참가 선수들의 스냅샷 정보(이름, 급수, 성별) 생성
 */
export function buildPlayerSnapshots(
  playerIds: (string | undefined | null)[],
  playersMap: Map<string, Player>
): Record<string, { id: string; name: string; tier: Tier; gender: Gender; coneNumber?: number | string }> {
  const snapshots: Record<string, { id: string; name: string; tier: Tier; gender: Gender; coneNumber?: number | string }> = {};

  playerIds.forEach((id) => {
    if (!id) return;
    const p = playersMap.get(id);
    if (p) {
      snapshots[id] = {
        id: p.id,
        name: p.name,
        tier: p.tier,
        gender: p.gender,
        coneNumber: p.coneNumber,
      };
    }
  });

  return snapshots;
}
