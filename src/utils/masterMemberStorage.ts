import { MasterMember, Gender, Tier, Player } from '../types';
import { INITIAL_SAMPLE_PLAYERS } from './sampleData';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
} from './deviceStorage';

export const LOCAL_STORAGE_KEY_MASTER_MEMBERS = DEVICE_STORAGE_KEYS.MASTER_MEMBERS;

/**
 * 기기 내부(로컬 저장소)에서 전체 회원 목록을 불러옵니다.
 * 저장소에 데이터가 전혀 없으면 초기 샘플 회원 목록으로 자동 세팅합니다.
 */
export const loadMasterMembersFromStorage = (): MasterMember[] => {
  try {
    const raw = getDeviceStorageItem(LOCAL_STORAGE_KEY_MASTER_MEMBERS);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load master members from device storage:', err);
  }

  // 초기 샘플 회원들로 기본 구성 (중복 방지)
  const initialMembers: MasterMember[] = INITIAL_SAMPLE_PLAYERS.map((p, idx) => ({
    id: `master_${p.name}_${idx}`,
    name: p.name,
    gender: p.gender,
    tier: p.tier,
    registeredAt: Date.now() - (INITIAL_SAMPLE_PLAYERS.length - idx) * 1000,
  }));

  saveMasterMembersToStorage(initialMembers);
  return initialMembers;
};

/**
 * 전체 회원 목록을 기기 내부(로컬 저장소)에 영구 저장합니다.
 */
export const saveMasterMembersToStorage = (members: MasterMember[]): void => {
  try {
    setDeviceStorageItem(LOCAL_STORAGE_KEY_MASTER_MEMBERS, JSON.stringify(members));
  } catch (err) {
    console.error('Failed to save master members to device storage:', err);
  }
};

/**
 * 참가자 목록에서 선수의 정보(성별, 급수, 이름)가 변경되었을 때,
 * 전체 회원 명부(masterMembers)에 등록된 해당 회원도 1:1로 완전 동기화하여 수정합니다.
 * (신규 중복 회원을 생성하지 않고 기존 회원 정보를 업데이트)
 */
export const updateMasterMemberFromPlayer = (
  player: Player,
  currentMembers: MasterMember[]
): MasterMember[] => {
  const cleanName = player.name.trim();
  let matched = false;

  const updatedMembers = currentMembers.map((m) => {
    // 1순위: masterMemberId가 일치하는 경우
    if (player.masterMemberId && m.id === player.masterMemberId) {
      matched = true;
      return {
        ...m,
        name: cleanName,
        gender: player.gender,
        tier: player.tier,
      };
    }
    return m;
  });

  // masterMemberId가 비어있는 레거시 상태인 경우 이름으로 매칭 탐색
  if (!matched && !player.masterMemberId) {
    const targetIdx = currentMembers.findIndex(
      (m) => m.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (targetIdx !== -1) {
      matched = true;
      updatedMembers[targetIdx] = {
        ...updatedMembers[targetIdx],
        name: cleanName,
        gender: player.gender,
        tier: player.tier,
      };
    }
  }

  if (!matched) {
    // 전체 회원에 전혀 없던 새로운 참가자인 경우에만 신규 등록
    const newId = player.masterMemberId || `master_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    updatedMembers.push({
      id: newId,
      name: cleanName,
      gender: player.gender,
      tier: player.tier,
      registeredAt: Date.now(),
    });
  }

  const sorted = updatedMembers.sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, 'ko');
    if (nameDiff !== 0) return nameDiff;
    const genderDiff = a.gender.localeCompare(b.gender);
    if (genderDiff !== 0) return genderDiff;
    return a.tier.localeCompare(b.tier);
  });

  saveMasterMembersToStorage(sorted);
  return sorted;
};

/**
 * 선수가 매칭 옵션의 테스트(선수 24명 생성)로 등록된 선수인지 판별
 */
export const isTestPlayer = (
  player?: { id?: string; isTest?: boolean } | null
): boolean => {
  if (!player) return false;
  return Boolean(player.isTest || (player.id && player.id.startsWith('p_test_')));
};

/**
 * 당일 참가자 명단(players)과 전체 회원 명부(masterMembers)를 완전 연동(동기화)합니다.
 * 1. player.masterMemberId가 있는 경우:
 *    - 전체 회원 명부의 해당 회원(m.id === player.masterMemberId)의 정보(이름, 성별, 급수)를 참가자 정보로 동기화 수정합니다.
 *    - 절대로 신규 중복 회원을 생성하지 않습니다.
 * 2. player.masterMemberId가 없는 경우:
 *    - 전체 회원 중 이름, 성별, 급수가 모두 일치하는 기존 회원이 있으면 해당 회원 ID로 연결합니다.
 *    - 일치하는 회원이 없다면(새 참가자이거나 같은 이름이지만 성별/급수가 다른 신규 회원) 신규 전체 회원으로 등록하고 연결합니다.
 * 3. 테스트(선수 24명 생성)로 생성된 선수는 전체 회원에 절대로 등록하지 않습니다.
 * 4. 결과로 동기화된 전체 회원 목록(updatedMembers)과 masterMemberId가 보장된 참가자 목록(updatedPlayers)을 반환합니다.
 */
export const syncPlayersAndMasterMembers = (
  players: Player[],
  currentMembers: MasterMember[]
): {
  updatedMembers: MasterMember[];
  updatedPlayers: Player[];
  hasMemberChanges: boolean;
  hasPlayerChanges: boolean;
} => {
  const membersMap = new Map<string, MasterMember>();
  currentMembers.forEach((m) => membersMap.set(m.id, { ...m }));

  let hasMemberChanges = false;
  let hasPlayerChanges = false;

  const updatedPlayers: Player[] = players.map((player) => {
    const cleanName = player.name.trim();
    if (!cleanName) return player;

    // 테스트 생성 선수(선수 24명 생성)는 전체 회원 명부(masterMembers)에 절대로 등록/연동하지 않음
    if (isTestPlayer(player)) {
      return player;
    }

    // 1. 이미 masterMemberId가 있고 해당 회원이 존재하는 경우
    if (player.masterMemberId && membersMap.has(player.masterMemberId)) {
      const member = membersMap.get(player.masterMemberId)!;
      // 참가자의 변경사항(이름, 성별, 급수)을 전체 회원에 1:1 반영 (꼬깔 번호는 당일 전용이므로 제외)
      if (
        member.name !== cleanName ||
        member.gender !== player.gender ||
        member.tier !== player.tier
      ) {
        membersMap.set(player.masterMemberId, {
          ...member,
          name: cleanName,
          gender: player.gender,
          tier: player.tier,
        });
        hasMemberChanges = true;
      }

      return player;
    }

    // 2. masterMemberId가 없거나 매칭되지 않는 경우:
    // 전체 회원 중 이름, 성별, 급수가 모두 일치하는 기존 회원이 있는지 탐색
    const exactMatch = Array.from(membersMap.values()).find(
      (m) =>
        m.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        m.gender === player.gender &&
        m.tier === player.tier
    );

    if (exactMatch) {
      hasPlayerChanges = true;
      return {
        ...player,
        masterMemberId: exactMatch.id,
      };
    }

    // 3. 일치하는 회원이 없는 경우 (새로운 참가자 또는 동명이인이지만 성별/급수가 다른 회원):
    // 신규 전체 회원으로 등록하고 player와 연결
    const newMasterId = `master_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newMember: MasterMember = {
      id: newMasterId,
      name: cleanName,
      gender: player.gender,
      tier: player.tier,
      registeredAt: Date.now(),
    };
    membersMap.set(newMasterId, newMember);
    hasMemberChanges = true;
    hasPlayerChanges = true;

    return {
      ...player,
      masterMemberId: newMasterId,
    };
  });

  const updatedMembersList = Array.from(membersMap.values()).sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, 'ko');
    if (nameDiff !== 0) return nameDiff;
    const genderDiff = a.gender.localeCompare(b.gender);
    if (genderDiff !== 0) return genderDiff;
    return a.tier.localeCompare(b.tier);
  });

  if (hasMemberChanges) {
    saveMasterMembersToStorage(updatedMembersList);
  }

  return {
    updatedMembers: updatedMembersList,
    updatedPlayers,
    hasMemberChanges,
    hasPlayerChanges,
  };
};

/**
 * 당일 참가자 명단을 전체 회원 명부와 동기화 (기존 시그니처 호환용)
 */
export const syncPlayersToMasterMembers = (
  players: (Player | { name: string; gender: Gender; tier: Tier; masterMemberId?: string; isTest?: boolean })[],
  currentMembers: MasterMember[]
): MasterMember[] => {
  // 테스트 생성 선수는 전체 회원 등록 대상에서 제외
  const nonTestPlayers = players.filter((p) => !isTestPlayer(p));

  // 고유 식별 키 생성기 (이름 + 성별 + 급수)
  const makeCompositeKey = (name: string, gender: Gender, tier: Tier) =>
    `${name.trim().toLowerCase()}__${gender}__${tier}`;

  const membersMap = new Map<string, MasterMember>();
  currentMembers.forEach((m) => membersMap.set(m.id, { ...m }));

  const existingKeySet = new Set<string>();
  currentMembers.forEach((m) => {
    existingKeySet.add(makeCompositeKey(m.name, m.gender, m.tier));
  });

  let hasChanges = false;

  nonTestPlayers.forEach((p, idx) => {
    const cleanName = p.name.trim();
    if (!cleanName) return;

    // 1. masterMemberId가 있으면 해당 회원의 정보 업데이트
    if (p.masterMemberId && membersMap.has(p.masterMemberId)) {
      const existing = membersMap.get(p.masterMemberId)!;
      if (
        existing.name !== cleanName ||
        existing.gender !== p.gender ||
        existing.tier !== p.tier
      ) {
        membersMap.set(p.masterMemberId, {
          ...existing,
          name: cleanName,
          gender: p.gender,
          tier: p.tier,
        });
        hasChanges = true;
      }
      return;
    }

    const key = makeCompositeKey(cleanName, p.gender, p.tier);

    // 이름, 성별, 급수가 모두 일치하는 회원이 이미 등록되어 있으면 기존 회원 유지
    if (existingKeySet.has(key)) {
      return;
    }

    // 이름이 새롭거나, 이름은 같지만 성별 또는 급수가 다른 신규 회원 등록
    existingKeySet.add(key);
    const newId = `master_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
    membersMap.set(newId, {
      id: newId,
      name: cleanName,
      gender: p.gender,
      tier: p.tier,
      registeredAt: Date.now() + idx,
    });
    hasChanges = true;
  });

  if (!hasChanges) {
    return currentMembers;
  }

  const updatedList = Array.from(membersMap.values()).sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, 'ko');
    if (nameDiff !== 0) return nameDiff;
    const genderDiff = a.gender.localeCompare(b.gender);
    if (genderDiff !== 0) return genderDiff;
    return a.tier.localeCompare(b.tier);
  });

  saveMasterMembersToStorage(updatedList);
  return updatedList;
};

/**
 * 전체 회원 중 이름이 일치하거나, 회원 이름 앞뒤에 숫자/특수문자/기타 문자가 붙어 있어도
 * 해당 이름을 포함하는 모든 회원을 검색합니다. (일치도 높은 순 정렬)
 */
export const findMasterMembersExactName = (
  name: string,
  members: MasterMember[]
): MasterMember[] => {
  const rawQuery = name.trim().toLowerCase();
  if (!rawQuery) return [];

  const compactQuery = rawQuery.replace(/\s+/g, '');
  // 숫자, 특수문자, 공백 등을 모두 제거한 순수 한글/영문 이름 글자
  const pureQuery = rawQuery.replace(/[^가-힣a-zA-Z]/g, '');
  // 특수문자/공백을 제거한 한글/영문/숫자
  const alphaNumQuery = rawQuery.replace(/[^가-힣a-zA-Z0-9]/g, '');

  const scored: { member: MasterMember; score: number }[] = [];

  for (const m of members) {
    const rawMember = m.name.trim().toLowerCase();
    if (!rawMember) continue;

    const compactMember = rawMember.replace(/\s+/g, '');
    const pureMember = rawMember.replace(/[^가-힣a-zA-Z]/g, '');
    const alphaNumMember = rawMember.replace(/[^가-힣a-zA-Z0-9]/g, '');

    let score = 0;

    // 1. 공백/대소문자 제외 완전 일치 (예: "홍길동" === "홍길동")
    if (compactMember === compactQuery) {
      score = 100;
    }
    // 2. 숫자/특수문자를 제외한 순수 이름 글자가 일치 (예: "1.홍길동", "홍길동1", "★홍길동★", "홍길동(1)" 등)
    else if (pureQuery.length > 0 && pureMember === pureQuery) {
      score = 95;
    }
    // 3. 특수문자만 제외한 한글/영문/숫자가 일치 (예: "★홍길동1" <-> "홍길동1")
    else if (alphaNumQuery.length > 0 && alphaNumMember === alphaNumQuery) {
      score = 92;
    }
    // 4. 전체회원 이름 앞뒤에 숫자/특수문자/다른 문자가 있어도 검색 이름을 포함하는 경우 (예: "[총무]홍길동", "홍길동(게스트)", "홍길동A", "01홍길동*")
    else if (compactQuery.length > 0 && compactMember.includes(compactQuery)) {
      score = 90;
    }
    // 5. 전체회원 이름의 순수 글자에 검색어 순수 글자가 포함된 경우 (예: "[임원] 홍.길.동(1)" <-> "홍길동")
    else if (pureQuery.length > 0 && pureMember.includes(pureQuery)) {
      score = 85;
    }
    // 6. 전체회원 이름의 한글/영문/숫자에 검색어 한글/영문/숫자가 포함된 경우
    else if (alphaNumQuery.length > 0 && alphaNumMember.includes(alphaNumQuery)) {
      score = 82;
    }
    // 7. 반대로 입력된 이름 앞뒤에 숫자/특수문자/수식어가 붙어 있고 전체회원 이름(2글자 이상)이 그 안에 포함된 경우
    else if (pureMember.length >= 2 && pureQuery.includes(pureMember)) {
      score = 75;
    } else if (compactMember.length >= 2 && compactQuery.includes(compactMember)) {
      score = 70;
    }

    if (score > 0) {
      scored.push({ member: m, score });
    }
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const lenDiffA = Math.abs(a.member.name.length - rawQuery.length);
      const lenDiffB = Math.abs(b.member.name.length - rawQuery.length);
      if (lenDiffA !== lenDiffB) return lenDiffA - lenDiffB;
      return a.member.name.localeCompare(b.member.name, 'ko');
    })
    .map((item) => item.member);
};

/**
 * 입력된 검색어(철자)를 포함하고 있는 전체 회원을 스마트하게 검색합니다.
 * 이름 앞뒤에 숫자(1. 등), 특수문자(#, () 등), 공백이 붙어 있어도
 * 동일한 철자/글자가 포함되어 있으면 모두 찾아내며 일치도가 높은 순으로 정렬합니다.
 */
export const searchMasterMembersBySpelling = (
  input: string,
  members: MasterMember[]
): MasterMember[] => {
  const rawQuery = input.trim().toLowerCase();
  if (!rawQuery) return [];

  // 한글/영문 순수 글자만 추출 (숫자, 기호, 공백 제거)
  const pureQueryLetters = rawQuery.replace(/[^가-힣a-zA-Z]/g, '');
  // 한글/영문/숫자 추출 (기호, 공백 제거)
  const alphaQuery = rawQuery.replace(/[^가-힣a-zA-Z0-9]/g, '');

  const scoredMatches: { member: MasterMember; score: number }[] = [];

  for (const member of members) {
    const rawName = member.name.trim().toLowerCase();
    const pureMemberLetters = rawName.replace(/[^가-힣a-zA-Z]/g, '');
    const alphaMember = rawName.replace(/[^가-힣a-zA-Z0-9]/g, '');

    let score = 0;

    // 1. 완전 정확 일치 (공백/대소문자 무시)
    if (rawName === rawQuery) {
      score = 100;
    }
    // 2. 특수문자/숫자를 제외한 순수 글자가 정확히 일치 ("1.홍길동" <-> "홍길동")
    else if (pureQueryLetters && pureMemberLetters && pureMemberLetters === pureQueryLetters) {
      score = 90;
    }
    // 3. 특수문자/숫자를 제외한 회원 이름이 검색어 글자로 시작
    else if (pureQueryLetters && pureMemberLetters.startsWith(pureQueryLetters)) {
      score = 80;
    }
    // 4. 특수문자/숫자를 제외한 회원 이름에 검색어 철자가 포함됨 ("철수" -> "김철수", "박철수")
    else if (pureQueryLetters && pureMemberLetters.includes(pureQueryLetters)) {
      score = 70;
    }
    // 5. 검색어에 회원 이름 글자가 포함됨 (사용자가 "홍길동A조" 입력 -> "홍길동" 검색)
    else if (pureMemberLetters && pureQueryLetters.includes(pureMemberLetters)) {
      score = 65;
    }
    // 6. 원본 문자열 포함 관계 ("홍길" in "홍길동")
    else if (rawName.includes(rawQuery)) {
      score = 60;
    }
    // 7. 검색어가 원본 회원명을 포함
    else if (rawQuery.includes(rawName)) {
      score = 55;
    }
    // 8. 알파벳/숫자 포함 ("hong1" in "hong12")
    else if (
      alphaQuery &&
      alphaMember &&
      (alphaMember.includes(alphaQuery) || alphaQuery.includes(alphaMember))
    ) {
      score = 50;
    }

    if (score > 0) {
      scoredMatches.push({ member, score });
    }
  }

  // 중복 제거 (동일 id 방지)
  const seenIds = new Set<string>();
  const uniqueMatches = scoredMatches.filter(({ member }) => {
    if (seenIds.has(member.id)) return false;
    seenIds.add(member.id);
    return true;
  });

  // 1순위: 일치도(score) 높은 순
  // 2순위: 검색어와의 길이 차이가 적은 순
  // 3순위: 한글 가나다순 정렬
  return uniqueMatches
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const lenDiffA = Math.abs(a.member.name.length - rawQuery.length);
      const lenDiffB = Math.abs(b.member.name.length - rawQuery.length);
      if (lenDiffA !== lenDiffB) {
        return lenDiffA - lenDiffB;
      }
      return a.member.name.localeCompare(b.member.name, 'ko');
    })
    .map((item) => item.member);
};
