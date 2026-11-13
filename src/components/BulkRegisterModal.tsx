import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MasterMember, Player, Gender, Tier, TIER_LABELS } from '../types';
import {
  X,
  Users,
  UserPlus,
  Check,
  AlertCircle,
  ListPlus,
  Trash2,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RotateCcw,
  BookOpen,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { findMasterMembersExactName, isTestPlayer } from '../utils/masterMemberStorage';
import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
} from '../utils/deviceStorage';

export interface BulkAddPlayerEntry {
  name: string;
  gender: Gender;
  tier: Tier;
  masterMemberId?: string;
  coneNumber?: string;
  attendancePending?: boolean;
}

export interface BulkAddBatchResult {
  addedCount: number;
  skippedDuplicates: string[];
  restoredNames: string[];
}

interface ParsedBulkItem {
  raw: string;
  name: string;
  gender: Gender | null;
  tier: Tier | null;
  coneNumber?: string;
  hasExplicitSlash?: boolean;
}

interface AmbiguousNameGroup {
  key: string;
  searchName: string;
  matchedMembers: MasterMember[];
  coneNumber?: string;
}

interface NewMemberDraft {
  id: string;
  name: string;
  gender: Gender | null;
  tier: Tier | null;
  coneNumber?: string;
}

interface BulkRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterMembers: MasterMember[];
  currentPlayers: Player[];
  onExecuteBatchRegister: (entries: BulkAddPlayerEntry[]) => BulkAddBatchResult;
  onCompleteNotice?: (message: string) => void;
}

function parseGenderWord(token: string): Gender | null {
  const clean = token.trim().toLowerCase();
  if (clean === '남' || clean === '남성' || clean === '남자' || clean === 'm' || clean === 'male') {
    return 'M';
  }
  if (clean === '여' || clean === '여성' || clean === '여자' || clean === 'f' || clean === 'female') {
    return 'F';
  }
  return null;
}

function parseTierWord(token: string): Tier | null {
  const clean = token.trim().toLowerCase();
  if (
    clean === 's' ||
    clean === 's조' ||
    clean === 's급' ||
    clean === '자강' ||
    clean === '자강조' ||
    clean === '자강급' ||
    clean === '준자강' ||
    clean === '준자강조' ||
    clean === '준자강급'
  ) {
    return 'S';
  }
  if (clean === 'a' || clean === 'a조' || clean === 'a급') {
    return 'A';
  }
  if (clean === 'b' || clean === 'b조' || clean === 'b급') {
    return 'B';
  }
  if (clean === 'c' || clean === 'c조' || clean === 'c급') {
    return 'C';
  }
  if (clean === 'd' || clean === 'd조' || clean === 'd급') {
    return 'D';
  }
  if (
    clean === 'e' ||
    clean === 'e조' ||
    clean === 'e급' ||
    clean === '초심' ||
    clean === '초심조' ||
    clean === '초심급' ||
    clean === '초보' ||
    clean === '초보자' ||
    clean === '왕초심' ||
    clean === '왕초심조' ||
    clean === '왕초심급' ||
    clean === 'beginner'
  ) {
    return 'Beginner';
  }
  return null;
}

interface ModifierTokenResult {
  gender?: Gender;
  tier?: Tier;
  coneNumber?: string;
}

/**
 * 단일 토큰이 성별, 급수, 꼬깔번호(또는 이들의 조합: 예 "남", "A", "12", "남A", "A남", "12남", "남12", "12남A", "남A12" 등)인지 판별합니다.
 */
function parseModifierToken(token: string): ModifierTokenResult | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // 1. 순수 꼬깔번호 (예: "12", "12번", "#12", "꼬깔12")
  const pureCone = trimmed.match(/^(?:꼬깔|#)?(\d+)번?$/);
  if (pureCone) {
    return { coneNumber: pureCone[1] };
  }

  // 2. 순수 성별 (예: "남", "여", "남성", "여성", "M", "F")
  const pureGender = parseGenderWord(trimmed);
  if (pureGender) {
    return { gender: pureGender };
  }

  // 3. 순수 급수 (예: "S", "A", "B", "C", "D", "E", "A조", "B급", "초심", "자강", "준자강")
  const pureTier = parseTierWord(trimmed);
  if (pureTier) {
    return { tier: pureTier };
  }

  // 4. 복합 수식어 토큰 (성별/급수/꼬깔번호가 공백 없이 붙어 있는 경우: 예 "남A", "A남", "12남", "남12", "12A", "A12", "12남A", "남12A", "남A12")
  // 영문 단어 오인식을 막기 위해 복합 토큰 내 성별은 한글(남/여 등)이거나 구분자(/·-)가 있는 경우만 허용
  let rest = trimmed;
  let foundGender: Gender | undefined;
  let foundTier: Tier | undefined;
  let foundCone: string | undefined;
  let matchedCount = 0;

  // 영어 알파벳만으로 이루어진 2글자 이상 토큰(예: "kim", "lee")은 복합 수식어로 분리하지 않음
  if (/^[a-zA-Z]{2,}$/.test(rest)) {
    return null;
  }

  for (let step = 0; step < 3 && rest.length > 0; step++) {
    rest = rest.replace(/^[/·\-]+/, '').trim();
    if (!rest) break;

    // 꼬깔번호 매칭
    if (!foundCone) {
      const cMatch = rest.match(/^(?:꼬깔|#)?(\d+)번?/);
      if (cMatch) {
        foundCone = cMatch[1];
        rest = rest.slice(cMatch[0].length);
        matchedCount++;
        continue;
      }
    }

    // 성별 매칭
    if (!foundGender) {
      const gMatch = rest.match(/^(남성|남자|남|여성|여자|여|m|f)(?=$|[/·\-]|(?:\d)|(?:s|a|b|c|d|e|초심|왕초심|초보|자강|준자강))/i);
      if (gMatch) {
        const g = parseGenderWord(gMatch[1]);
        if (g) {
          foundGender = g;
          rest = rest.slice(gMatch[0].length);
          matchedCount++;
          continue;
        }
      }
    }

    // 급수 매칭
    if (!foundTier) {
      const tMatch = rest.match(/^(왕초심|초심|초보자|초보|준자강|자강|s|a|b|c|d|e)(?:조|급)?/i);
      if (tMatch) {
        const t = parseTierWord(tMatch[1]);
        if (t) {
          foundTier = t;
          rest = rest.slice(tMatch[0].length);
          matchedCount++;
          continue;
        }
      }
    }

    // 더 이상 매칭되지 않으면 중단
    break;
  }

  rest = rest.replace(/^[/·\-]+/, '').trim();
  if (rest.length === 0 && matchedCount >= 2) {
    return {
      gender: foundGender,
      tier: foundTier,
      coneNumber: foundCone,
    };
  }

  return null;
}

/**
 * 새로운 선수 이름 토큰에서 이름과 뒤에 붙은 꼬깔번호/성별/급수를 분리합니다.
 * 예: "홍길동", "홍길동12", "홍길동12남A", "홍길동12남", "홍길동남A"
 */
function extractPlayerStartToken(rawToken: string): {
  name: string;
  coneNumber?: string;
  gender?: Gender;
  tier?: Tier;
} {
  const trimmed = rawToken.trim();

  // 1. 이름 + 숫자(꼬깔번호) + 추가 수식어(성별/급수) 형태 (예: "홍길동12남A", "홍길동12남", "홍길동12A조")
  const nameConeModMatch = trimmed.match(
    /^([가-힣a-zA-Z]+)\s*(?:꼬깔|#)?(\d+)번?\s*(.+)$/
  );
  if (nameConeModMatch) {
    const mod = parseModifierToken(nameConeModMatch[3]);
    if (mod && !mod.coneNumber) {
      return {
        name: nameConeModMatch[1].trim(),
        coneNumber: nameConeModMatch[2],
        gender: mod.gender,
        tier: mod.tier,
      };
    }
  }

  // 2. 한글 이름(2글자 이상) + 성별 + 급수 (+ 선택적 꼬깔번호) 붙여쓰기 형태 (예: "홍길동남A", "홍길동여초심", "홍길동남A12")
  const nameGenderTierMatch = trimmed.match(
    /^([가-힣]{2,})(남성|남자|남|여성|여자|여)(왕초심|초심|초보자|초보|준자강|자강|s|a|b|c|d|e)(?:조|급)?(?:\s*(?:꼬깔|#)?(\d+)번?)?$/i
  );
  if (nameGenderTierMatch) {
    const g = parseGenderWord(nameGenderTierMatch[2]);
    const t = parseTierWord(nameGenderTierMatch[3]);
    if (g && t) {
      return {
        name: nameGenderTierMatch[1].trim(),
        gender: g,
        tier: t,
        coneNumber: nameGenderTierMatch[4] || undefined,
      };
    }
  }

  // 3. 이름 + 숫자(꼬깔번호) 형태 (예: "홍길동12", "홍길동12번", "홍길동#12")
  const nameConeMatch = trimmed.match(
    /^([가-힣a-zA-Z]+(?:\s+[가-힣a-zA-Z]+)*)\s*(?:꼬깔|#)?(\d+)번?$/
  );
  if (nameConeMatch) {
    return {
      name: nameConeMatch[1].trim(),
      coneNumber: nameConeMatch[2],
    };
  }

  return { name: trimmed };
}

/**
 * 일괄등록 입력 문자열을 파싱합니다.
 * - 줄바꿈, 쉼표(,), 세미콜론(;), 번호 매김(1. 홍길동 2. 김철수), 공백(띄어쓰기) 구분 입력을 모두 지원합니다.
 * - 선수이름 뒤에 숫자가 입력된 경우(예: "홍길동12", "홍길동 12"): 꼬깔번호(coneNumber: "12")로 추출합니다.
 * - 띄어쓰기만으로 입력한 "홍길동 남 A", "홍길동 12 남 A", "홍길동12 남 A" 및 슬래시 구분 "홍길동/남/A" 형식을 모두 지원합니다.
 */
export function parseBulkRegistrationText(rawText: string): ParsedBulkItem[] {
  if (!rawText || !rawText.trim()) return [];

  // 1. 줄바꿈, 쉼표, 세미콜론 및 인라인 번호("1. 홍길동 2. 김철수") 기준으로 1차 분리
  const rawSegments = rawText
    .split(/\r?\n|[,;]+|(?=(?:^|\s)\d+\s*[.)]\s*)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const results: ParsedBulkItem[] = [];

  for (const seg of rawSegments) {
    // 앞쪽 불릿/번호 제거 (예: "1.", "1)", "(1)", "[1]", "#1 ") 및 괄호 안이 성별/급수/꼬깔 수식어인 경우만 공백으로 풀어줌
    const stripped = seg
      .replace(/^(?:\d+\s*[.)]|\(\d+\)|\[\d+\]|#\d+\s+|[-*•▪▫◈▶▷✓✔☑️✅]+)\s*/, '')
      .replace(/[(\[]([^)\]]+)[)\]]/g, (fullMatch, inner: string) => {
        const parts = inner
          .trim()
          .split(/[\s/·,]+/)
          .filter(Boolean);
        if (parts.length > 0 && parts.every((p) => parseModifierToken(p) !== null)) {
          return ` ${inner} `;
        }
        return fullMatch;
      })
      .replace(/\s*\/\s*/g, '/')
      .trim();

    if (!stripped) continue;

    const tokens = stripped.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    let currentItem: ParsedBulkItem | null = null;

    const flushCurrent = () => {
      if (currentItem && currentItem.name.trim()) {
        results.push(currentItem);
      }
      currentItem = null;
    };

    for (const rawTok of tokens) {
      const tok = rawTok.replace(/^\d+[.)]/, '').trim();
      if (!tok) continue;

      // Case 1: 슬래시(/)가 포함된 토큰 (예: "홍길동/남/A", "홍길동12/남/A", "홍길동/남/A/12", 또는 "홍길동 12/남/A"의 "12/남/A")
      if (tok.includes('/')) {
        const parts = tok
          .split('/')
          .map((p) => p.trim())
          .filter(Boolean);

        let slashName = '';
        let slashGender: Gender | null = null;
        let slashTier: Tier | null = null;
        let slashCone: string | undefined = undefined;

        for (const part of parts) {
          const mod = parseModifierToken(part);
          if (mod) {
            if (mod.gender && !slashGender) slashGender = mod.gender;
            if (mod.tier && !slashTier) slashTier = mod.tier;
            if (mod.coneNumber && !slashCone) slashCone = mod.coneNumber;
            continue;
          }

          // 이름 파트 (이름 뒤에 숫자/성별/급수가 붙어있으면 함께 분리)
          const extracted = extractPlayerStartToken(part);
          slashName = slashName ? `${slashName} ${extracted.name}` : extracted.name;
          if (extracted.coneNumber && !slashCone) {
            slashCone = extracted.coneNumber;
          }
          if (extracted.gender && !slashGender) {
            slashGender = extracted.gender;
          }
          if (extracted.tier && !slashTier) {
            slashTier = extracted.tier;
          }
        }

        if (slashName) {
          flushCurrent();
          currentItem = {
            raw: tok,
            name: slashName,
            gender: slashGender,
            tier: slashTier,
            coneNumber: slashCone,
            hasExplicitSlash: true,
          };
        } else if (currentItem) {
          // 앞선 이름 토큰에 이어진 "/남/A" 또는 "12/남/A" 형태인 경우 현재 아이템에 병합
          if (slashGender && !currentItem.gender) currentItem.gender = slashGender;
          if (slashTier && !currentItem.tier) currentItem.tier = slashTier;
          if (slashCone && !currentItem.coneNumber) currentItem.coneNumber = slashCone;
          currentItem.hasExplicitSlash = true;
        }
        continue;
      }

      // Case 2: 슬래시가 없는 띄어쓰기(공백) 구분 토큰 -> 현재 선수의 수식어(꼬깔번호/성별/급수 또는 복합 수식어)인지 확인
      const mod = parseModifierToken(tok);
      if (mod) {
        if (currentItem) {
          if (mod.gender && !currentItem.gender) currentItem.gender = mod.gender;
          if (mod.tier && !currentItem.tier) currentItem.tier = mod.tier;
          if (mod.coneNumber && !currentItem.coneNumber) currentItem.coneNumber = mod.coneNumber;
        }
        continue;
      }

      // 새로운 선수 이름 토큰 (예: "홍길동", "홍길동12", "홍길동12남A", "홍길동남A")
      flushCurrent();
      const extracted = extractPlayerStartToken(tok);
      if (extracted.name) {
        currentItem = {
          raw: tok,
          name: extracted.name,
          gender: extracted.gender ?? null,
          tier: extracted.tier ?? null,
          coneNumber: extracted.coneNumber,
        };
      }
    }

    flushCurrent();
  }

  return results;
}

export const BulkRegisterModal: React.FC<BulkRegisterModalProps> = ({
  isOpen,
  onClose,
  masterMembers,
  currentPlayers,
  onExecuteBatchRegister,
  onCompleteNotice,
}) => {
  const [step, setStep] = useState<'input' | 'duplicate_select' | 'new_members'>('input');
  const [bulkText, setBulkText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Step 2: 동명이인 (전체 회원 검색 결과 선택 메뉴) 상태
  const [ambiguousGroups, setAmbiguousGroups] = useState<AmbiguousNameGroup[]>([]);
  // groupKey -> 선택된 masterMember.id 배열 (동명이인 1명 선택 또는 복수 선택 지원)
  const [selectedDuplicateMemberIds, setSelectedDuplicateMemberIds] = useState<
    Record<string, string[]>
  >({});

  // Step 3: 전체 회원에 없는 신규 회원 등록 메뉴 상태
  const [newMemberDrafts, setNewMemberDrafts] = useState<NewMemberDraft[]>([]);

  // 단계 진행 중 누적 등록 통계
  const [accumulatedAddedCount, setAccumulatedAddedCount] = useState(0);
  const [accumulatedSkippedNames, setAccumulatedSkippedNames] = useState<string[]>([]);
  const [accumulatedRestoredNames, setAccumulatedRestoredNames] = useState<string[]>([]);
  const [stepBannerMessage, setStepBannerMessage] = useState<string | null>(null);
  const [modalAlert, setModalAlert] = useState<string | null>(null);
  const [showPamphlet, setShowPamphlet] = useState(false);

  // 출석체크 체크박스 상태 (체크 시 일괄등록된 선수가 참가자 명단에 빗금 및 출석 버튼 대기 상태로 등록, 비체크 시 즉시 출석 등록)
  const [isAttendanceCheckEnabled, setIsAttendanceCheckEnabled] = useState<boolean>(() => {
    const saved = getDeviceStorageItem(DEVICE_STORAGE_KEYS.BULK_ATTENDANCE_CHECK_ENABLED);
    return saved !== null ? saved === 'true' : true;
  });

  const handleToggleAttendanceCheck = (checked: boolean) => {
    soundEffects.playScorePoint();
    setIsAttendanceCheckEnabled(checked);
    setDeviceStorageItem(DEVICE_STORAGE_KEYS.BULK_ATTENDANCE_CHECK_ENABLED, String(checked));
  };

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setStep('input');
      setBulkText('');
      setAmbiguousGroups([]);
      setSelectedDuplicateMemberIds({});
      setNewMemberDrafts([]);
      setAccumulatedAddedCount(0);
      setAccumulatedSkippedNames([]);
      setAccumulatedRestoredNames([]);
      setStepBannerMessage(null);
      setModalAlert(null);
      setShowPamphlet(false);
      requestAnimationFrame(() => {
        try {
          textareaRef.current?.focus({ preventScroll: true });
        } catch {
          textareaRef.current?.focus();
        }
      });
    }
  }, [isOpen]);

  // 전체 회원 관리(masterMembers)가 실시간으로 변경될 때 동명이인 검색 결과 그룹도 실시간 동기화
  useEffect(() => {
    if (step === 'duplicate_select' && ambiguousGroups.length > 0) {
      setAmbiguousGroups((prevGroups) =>
        prevGroups.map((group) => {
          const freshMatches = findMasterMembersExactName(group.searchName, masterMembers);
          return {
            ...group,
            matchedMembers: freshMatches.length > 0 ? freshMatches : group.matchedMembers,
          };
        })
      );
    }
  }, [masterMembers, step]);

  // 현재 오늘 참가자 명단에 있는 선수 키 Set (실시간 동기화)
  const participatingKeySet = useMemo(() => {
    const set = new Set<string>();
    currentPlayers.forEach((p) => {
      if (isTestPlayer(p)) return;
      if (p.masterMemberId) {
        set.add(`id__${p.masterMemberId}`);
      }
      set.add(`${p.name.trim().toLowerCase()}__${p.gender}__${p.tier}`);
    });
    return set;
  }, [currentPlayers]);

  // 입력 텍스트 실시간 분석 (전체 회원 명부와 실시간 대조)
  const livePreview = useMemo(() => {
    const items = parseBulkRegistrationText(bulkText);
    let exactOneCount = 0;
    let duplicateCount = 0;
    let newMemberCount = 0;
    let coneCount = 0;

    for (const item of items) {
      if (item.coneNumber) {
        coneCount++;
      }
      if (item.gender && item.tier) {
        const existsInMaster = masterMembers.some(
          (m) =>
            m.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
            m.gender === item.gender &&
            m.tier === item.tier
        );
        if (existsInMaster) {
          exactOneCount++;
        } else {
          newMemberCount++;
        }
        continue;
      }
      let matches = findMasterMembersExactName(item.name, masterMembers);
      if (item.raw && item.raw.trim() !== item.name.trim()) {
        const rawMatches = findMasterMembersExactName(item.raw, masterMembers);
        const existingIds = new Set(matches.map((m) => m.id));
        for (const rm of rawMatches) {
          if (!existingIds.has(rm.id)) {
            matches.push(rm);
          }
        }
      }
      if (item.gender) {
        matches = matches.filter((m) => m.gender === item.gender);
      }
      if (item.tier) {
        matches = matches.filter((m) => m.tier === item.tier);
      }

      const isSingleExactNameMatch =
        matches.length === 1 &&
        matches[0].name.trim().toLowerCase() === item.name.trim().toLowerCase();

      if (isSingleExactNameMatch) {
        exactOneCount++;
      } else if (matches.length >= 1) {
        duplicateCount++;
      } else {
        newMemberCount++;
      }
    }

    return {
      totalCount: items.length,
      exactOneCount,
      duplicateCount,
      newMemberCount,
      coneCount,
    };
  }, [bulkText, masterMembers]);

  if (!isOpen) return null;

  const finalizeAndClose = (
    totalAdded: number,
    skippedList: string[],
    restoredList: string[]
  ) => {
    const parts: string[] = [];
    if (totalAdded > 0) {
      parts.push(`일괄 등록 완료: 총 ${totalAdded}명의 선수가 참가자 명단 및 전체 회원과 동기화되었습니다.`);
    }
    if (restoredList.length > 0) {
      parts.push(`이전 경기 기록 복원: ${restoredList.join(', ')}`);
    }
    if (skippedList.length > 0) {
      const uniqueSkipped = Array.from(new Set(skippedList));
      parts.push(`이미 참가 중인 선수 제외(${uniqueSkipped.length}명): ${uniqueSkipped.join(', ')}`);
    }

    if (parts.length > 0 && onCompleteNotice) {
      onCompleteNotice(parts.join(' / '));
    }
    onClose();
  };

  // Step 1 제출: 입력된 명단을 분류하여 즉시 등록 / 동명이인 검색 결과 선택 메뉴 / 신규 회원 등록 메뉴로 라우팅
  const handleStartBulkProcess = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsedItems = parseBulkRegistrationText(bulkText);
    if (parsedItems.length === 0) {
      soundEffects.playScorePoint();
      setModalAlert('등록할 참가자 이름을 입력해 주세요.');
      return;
    }

    const immediateEntries: BulkAddPlayerEntry[] = [];
    const nextAmbiguousGroups: AmbiguousNameGroup[] = [];
    const nextNewDrafts: NewMemberDraft[] = [];
    const seenAmbiguousKeys = new Set<string>();
    const seenNewKeys = new Set<string>();

    parsedItems.forEach((item, idx) => {
      const cleanName = item.name.trim();
      if (!cleanName) return;

      // 1. 선수이름/성별/급수 등 성별과 급수가 모두 명시된 경우 -> 신규 회원으로 전체회원관리에 등록 및 참가자 즉시 등록
      if (item.gender && item.tier) {
        const exactMaster = masterMembers.find(
          (m) =>
            m.name.trim().toLowerCase() === cleanName.toLowerCase() &&
            m.gender === item.gender &&
            m.tier === item.tier
        );
        immediateEntries.push({
          name: cleanName,
          gender: item.gender,
          tier: item.tier,
          masterMemberId: exactMaster?.id,
          coneNumber: item.coneNumber,
          attendancePending: isAttendanceCheckEnabled,
        });
        return;
      }

      // 2. 이름만 입력된 경우 (또는 성별/급수 중 하나만 입력된 경우) -> 전체 회원(masterMembers)에서 앞뒤 숫자/특수문자/기타문자 포함 전체 검색
      let matched = findMasterMembersExactName(cleanName, masterMembers);
      if (item.raw && item.raw.trim() !== cleanName) {
        const rawMatches = findMasterMembersExactName(item.raw, masterMembers);
        const existingIds = new Set(matched.map((m) => m.id));
        for (const rm of rawMatches) {
          if (!existingIds.has(rm.id)) {
            matched.push(rm);
          }
        }
      }
      if (item.gender) {
        matched = matched.filter((m) => m.gender === item.gender);
      }
      if (item.tier) {
        matched = matched.filter((m) => m.tier === item.tier);
      }

      const isSingleExactNameMatch =
        matched.length === 1 &&
        matched[0].name.trim().toLowerCase() === cleanName.toLowerCase();

      if (isSingleExactNameMatch) {
        // 전체 회원에 정확히 동일한 이름의 선수가 1명만 있는 경우 -> 참가자에 바로 등록 (꼬깔번호 포함)
        const m = matched[0];
        immediateEntries.push({
          name: m.name,
          gender: m.gender,
          tier: m.tier,
          masterMemberId: m.id,
          coneNumber: item.coneNumber,
          attendancePending: isAttendanceCheckEnabled,
        });
      } else if (matched.length >= 1) {
        // 동명이인이 2명 이상이거나, 이름 앞뒤에 숫자/특수문자/다른 문자가 붙은 회원이 검색된 경우 -> 전체 회원 검색 결과 메뉴에서 선택
        const dedupKey = `${cleanName.toLowerCase()}__${item.coneNumber ?? ''}`;
        if (!seenAmbiguousKeys.has(dedupKey)) {
          seenAmbiguousKeys.add(dedupKey);
          nextAmbiguousGroups.push({
            key: `amb_${idx}_${dedupKey}`,
            searchName: cleanName,
            matchedMembers: matched,
            coneNumber: item.coneNumber,
          });
        }
      } else {
        // 전체 회원에 없는 신규 회원인 경우 -> 신규 회원 등록 메뉴에서 성별/급수 선택
        const dedupKey = `${cleanName.toLowerCase()}__${item.coneNumber ?? ''}`;
        if (!seenNewKeys.has(dedupKey)) {
          seenNewKeys.add(dedupKey);
          nextNewDrafts.push({
            id: `new_${Date.now()}_${idx}`,
            name: cleanName,
            gender: item.gender ?? null,
            tier: item.tier ?? null,
            coneNumber: item.coneNumber,
          });
        }
      }
    });

    // 즉시 등록 가능한 회원(전체회원 1명 정확 일치 또는 이름/성별/급수 직접 입력 신규회원) 먼저 전체회원 및 참가자 명단에 반영
    let currentAdded = 0;
    let currentSkipped: string[] = [];
    let currentRestored: string[] = [];

    if (immediateEntries.length > 0) {
      const res = onExecuteBatchRegister(immediateEntries);
      currentAdded += res.addedCount;
      currentSkipped = [...res.skippedDuplicates];
      currentRestored = [...res.restoredNames];
      setAccumulatedAddedCount(currentAdded);
      setAccumulatedSkippedNames(currentSkipped);
      setAccumulatedRestoredNames(currentRestored);
    }

    // 검색 결과 선택 대상도 없고 추가 성별/급수 선택이 필요한 신규 회원도 없는 경우: 즉시 완료
    if (nextAmbiguousGroups.length === 0 && nextNewDrafts.length === 0) {
      if (currentAdded === 0 && currentSkipped.length > 0) {
        soundEffects.playScorePoint();
        setModalAlert(
          `입력하신 선수(${Array.from(new Set(currentSkipped)).join(', ')})는 이미 오늘 참가자 명단에 등록되어 있습니다.`
        );
        return;
      }
      soundEffects.playWhistle();
      finalizeAndClose(currentAdded, currentSkipped, currentRestored);
      return;
    }

    if (currentAdded > 0) {
      setStepBannerMessage(
        `${currentAdded}명의 선수가 전체 회원 및 참가자 명단에 먼저 등록되었습니다.`
      );
    } else if (currentSkipped.length > 0) {
      setStepBannerMessage(
        `이미 참가 중인 ${currentSkipped.length}명(${Array.from(new Set(currentSkipped)).join(', ')})은 제외되었습니다.`
      );
    } else {
      setStepBannerMessage(null);
    }

    setAmbiguousGroups(nextAmbiguousGroups);
    setNewMemberDrafts(nextNewDrafts);

    // 검색 결과 선택 대상(동명이인 또는 앞뒤 숫자/특수문자 포함 회원)이 1건 이상 있으면 '전체 회원 검색 결과' 선택 메뉴로 이동
    if (nextAmbiguousGroups.length > 0) {
      const initialSelections: Record<string, string[]> = {};
      nextAmbiguousGroups.forEach((g) => {
        initialSelections[g.key] =
          nextAmbiguousGroups.length > 1 && g.matchedMembers.length === 1
            ? [g.matchedMembers[0].id]
            : [];
      });
      setSelectedDuplicateMemberIds(initialSelections);
      soundEffects.playWhistle();
      setStep('duplicate_select');
      return;
    }

    // 동명이인은 없고 신규 회원이 있으면 '신규 회원 등록 메뉴'로 바로 이동
    soundEffects.playWhistle();
    setStep('new_members');
  };

  // Step 2: 동명이인 검색 결과 메뉴에서 개별 회원 토글 선택
  const handleToggleDuplicateMember = (groupKey: string, memberId: string) => {
    soundEffects.playRacketHit();
    setSelectedDuplicateMemberIds((prev) => {
      const currentList = prev[groupKey] || [];
      const exists = currentList.includes(memberId);
      const nextList = exists
        ? currentList.filter((id) => id !== memberId)
        : [...currentList, memberId];
      return {
        ...prev,
        [groupKey]: nextList,
      };
    });
  };

  // Step 2: 동명이인이 1건일 때 [바로 선택] 클릭 시 즉시 등록하고 다음 단계로 진행
  const handleQuickSelectSingleDuplicate = (group: AmbiguousNameGroup, member: MasterMember) => {
    const isAlreadyInToday =
      participatingKeySet.has(`id__${member.id}`) ||
      participatingKeySet.has(
        `${member.name.trim().toLowerCase()}__${member.gender}__${member.tier}`
      );

    if (
      isAlreadyInToday &&
      !group.coneNumber &&
      ambiguousGroups.length === 1 &&
      newMemberDrafts.length === 0
    ) {
      soundEffects.playScorePoint();
      setModalAlert(
        `'${member.name}' (${member.gender === 'M' ? '남성' : '여성'}, ${
          TIER_LABELS[member.tier]?.short || member.tier
        }) 선수는 이미 당일 참가자 명단에 등록되어 있습니다.`
      );
      return;
    }

    // 그룹이 1개뿐인 경우 클릭 즉시 해당 회원을 등록하고 다음 단계(신규 회원 메뉴 또는 종료)로 이동
    if (ambiguousGroups.length === 1) {
      const res = onExecuteBatchRegister([
        {
          name: member.name,
          gender: member.gender,
          tier: member.tier,
          masterMemberId: member.id,
          coneNumber: group.coneNumber,
          attendancePending: isAttendanceCheckEnabled,
        },
      ]);
      const nextAdded = accumulatedAddedCount + res.addedCount;
      const nextSkipped = [...accumulatedSkippedNames, ...res.skippedDuplicates];
      const nextRestored = [...accumulatedRestoredNames, ...res.restoredNames];

      setAccumulatedAddedCount(nextAdded);
      setAccumulatedSkippedNames(nextSkipped);
      setAccumulatedRestoredNames(nextRestored);

      soundEffects.playWhistle();
      if (newMemberDrafts.length > 0) {
        if (nextAdded > 0) {
          setStepBannerMessage(
            `선택하신 기존 회원 포함 총 ${nextAdded}명이 참가자 명단에 등록되었습니다. 이제 신규 회원의 성별/급수를 선택해 주세요.`
          );
        }
        setStep('new_members');
      } else {
        finalizeAndClose(nextAdded, nextSkipped, nextRestored);
      }
      return;
    }

    // 그룹이 여러 개인 경우 선택 상태 토글
    handleToggleDuplicateMember(group.key, member.id);
  };

  // Step 2: 동명이인 중 찾는 회원이 없어 '동명이인 신규 회원'으로 넘기는 기능
  const handleSendAmbiguousToNewMember = (group: AmbiguousNameGroup) => {
    soundEffects.playRacketHit();
    const newDraft: NewMemberDraft = {
      id: `new_homonym_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: group.searchName,
      gender: null,
      tier: null,
      coneNumber: group.coneNumber,
    };
    const updatedDrafts = [...newMemberDrafts, newDraft];
    setNewMemberDrafts(updatedDrafts);

    const remainingGroups = ambiguousGroups.filter((g) => g.key !== group.key);
    setAmbiguousGroups(remainingGroups);

    if (remainingGroups.length === 0) {
      // 이전에 다른 그룹에서 선택해 둔 동명이인 회원이 있다면 먼저 등록
      const selectedEntries: BulkAddPlayerEntry[] = [];
      for (const g of ambiguousGroups) {
        if (g.key === group.key) continue;
        const chosenIds = selectedDuplicateMemberIds[g.key] || [];
        for (const mid of chosenIds) {
          const found = g.matchedMembers.find((m) => m.id === mid);
          if (found) {
            selectedEntries.push({
              name: found.name,
              gender: found.gender,
              tier: found.tier,
              masterMemberId: found.id,
              coneNumber: g.coneNumber,
              attendancePending: isAttendanceCheckEnabled,
            });
          }
        }
      }
      if (selectedEntries.length > 0) {
        const res = onExecuteBatchRegister(selectedEntries);
        setAccumulatedAddedCount((prev) => prev + res.addedCount);
        setAccumulatedSkippedNames((prev) => [...prev, ...res.skippedDuplicates]);
        setAccumulatedRestoredNames((prev) => [...prev, ...res.restoredNames]);
      }
      setStep('new_members');
    }
  };

  // Step 2 완료 버튼: 선택된 동명이인 회원들을 일괄 등록하고 다음 단계(신규 회원 또는 완료)로 이동
  const handleConfirmDuplicateSelections = () => {
    // 각 동명이인 그룹별로 최소 1명 이상 선택되었는지 확인
    const unselectedGroup = ambiguousGroups.find(
      (g) => !selectedDuplicateMemberIds[g.key] || selectedDuplicateMemberIds[g.key].length === 0
    );
    if (unselectedGroup) {
      soundEffects.playScorePoint();
      setModalAlert(
        `'${unselectedGroup.searchName}' 동명이인 검색 결과에서 참가자에 등록할 회원을 선택해 주세요.`
      );
      return;
    }

    const entriesToAdd: BulkAddPlayerEntry[] = [];
    ambiguousGroups.forEach((group) => {
      const chosenIds = selectedDuplicateMemberIds[group.key] || [];
      chosenIds.forEach((mid) => {
        const member = group.matchedMembers.find((m) => m.id === mid);
        if (member) {
          entriesToAdd.push({
            name: member.name,
            gender: member.gender,
            tier: member.tier,
            masterMemberId: member.id,
            coneNumber: group.coneNumber,
            attendancePending: isAttendanceCheckEnabled,
          });
        }
      });
    });

    const res = onExecuteBatchRegister(entriesToAdd);
    const nextAdded = accumulatedAddedCount + res.addedCount;
    const nextSkipped = [...accumulatedSkippedNames, ...res.skippedDuplicates];
    const nextRestored = [...accumulatedRestoredNames, ...res.restoredNames];

    setAccumulatedAddedCount(nextAdded);
    setAccumulatedSkippedNames(nextSkipped);
    setAccumulatedRestoredNames(nextRestored);

    soundEffects.playWhistle();

    if (newMemberDrafts.length > 0) {
      if (nextAdded > 0) {
        setStepBannerMessage(
          `선택하신 회원 포함 총 ${nextAdded}명이 참가자 명단에 등록되었습니다. 이어서 신규 회원의 성별/급수를 선택해 주세요.`
        );
      }
      setStep('new_members');
    } else {
      finalizeAndClose(nextAdded, nextSkipped, nextRestored);
    }
  };

  // Step 3: 신규 회원 개별 성별/급수/이름/꼬깔번호 변경 및 일괄 적용
  const handleUpdateDraftGender = (id: string, gender: Gender) => {
    soundEffects.playRacketHit();
    setNewMemberDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, gender } : d))
    );
  };

  const handleUpdateDraftTier = (id: string, tier: Tier) => {
    soundEffects.playRacketHit();
    setNewMemberDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, tier } : d))
    );
  };

  const handleUpdateDraftName = (id: string, name: string) => {
    setNewMemberDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, name } : d))
    );
  };

  const handleUpdateDraftCone = (id: string, coneNumber: string) => {
    setNewMemberDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, coneNumber } : d))
    );
  };

  const handleRemoveDraft = (id: string) => {
    soundEffects.playScorePoint();
    const updated = newMemberDrafts.filter((d) => d.id !== id);
    setNewMemberDrafts(updated);
    if (updated.length === 0) {
      finalizeAndClose(
        accumulatedAddedCount,
        accumulatedSkippedNames,
        accumulatedRestoredNames
      );
    }
  };

  const handleApplyAllNewGender = (gender: Gender) => {
    soundEffects.playRacketHit();
    setNewMemberDrafts((prev) => prev.map((d) => ({ ...d, gender })));
  };

  const handleApplyAllNewTier = (tier: Tier) => {
    soundEffects.playRacketHit();
    setNewMemberDrafts((prev) => prev.map((d) => ({ ...d, tier })));
  };

  // Step 3 완료: 신규 회원들의 성별/급수 검증 후 전체회원(masterMembers) 및 참가자(players)에 실시간 동시 등록
  const handleConfirmNewMembersRegistration = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMemberDrafts.length === 0) {
      finalizeAndClose(
        accumulatedAddedCount,
        accumulatedSkippedNames,
        accumulatedRestoredNames
      );
      return;
    }

    const emptyNameDraft = newMemberDrafts.find((d) => !d.name.trim());
    if (emptyNameDraft) {
      soundEffects.playScorePoint();
      setModalAlert('모든 신규 회원의 이름을 입력해 주세요.');
      return;
    }

    const incompleteDraft = newMemberDrafts.find((d) => !d.gender || !d.tier);
    if (incompleteDraft) {
      soundEffects.playScorePoint();
      const missingParts: string[] = [];
      if (!incompleteDraft.gender) missingParts.push('성별');
      if (!incompleteDraft.tier) missingParts.push('급수');
      setModalAlert(
        `신규 회원 '${incompleteDraft.name.trim()}' 선수의 ${missingParts.join('과 ')}를 선택해 주세요.`
      );
      return;
    }

    const entries: BulkAddPlayerEntry[] = newMemberDrafts.map((d) => {
      const extracted = extractPlayerStartToken(d.name);
      const finalName = extracted.name || d.name.trim();
      const finalCone =
        d.coneNumber && d.coneNumber.trim() !== ''
          ? d.coneNumber.trim()
          : extracted.coneNumber;
      return {
        name: finalName,
        gender: d.gender!,
        tier: d.tier!,
        coneNumber: finalCone,
        attendancePending: isAttendanceCheckEnabled,
      };
    });

    const res = onExecuteBatchRegister(entries);
    const totalAdded = accumulatedAddedCount + res.addedCount;
    const totalSkipped = [...accumulatedSkippedNames, ...res.skippedDuplicates];
    const totalRestored = [...accumulatedRestoredNames, ...res.restoredNames];

    soundEffects.playWhistle();
    finalizeAndClose(totalAdded, totalSkipped, totalRestored);
  };

  const completedNewDraftCount = newMemberDrafts.filter(
    (d) => d.name.trim() && d.gender && d.tier
  ).length;

  const totalSelectedDuplicatesCount = Object.values(selectedDuplicateMemberIds).reduce(
    (acc, arr) => acc + arr.length,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 flex flex-col gap-2 shrink-0">
          {/* 1행: 상단 아이콘 + 참가자 일괄 등록 문구 + (데스크톱 배지) + 일괄 등록하기 버튼 + 닫기 버튼 (항상 같은 라인) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                  step === 'input'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : step === 'duplicate_select'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                }`}
              >
                {step === 'input' ? (
                  <ListPlus className="w-4 h-4" />
                ) : step === 'duplicate_select' ? (
                  <Users className="w-4 h-4" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
              </div>

              <h2 className="text-sm sm:text-base font-bold text-white whitespace-nowrap">
                {step === 'input'
                  ? '참가자 일괄 등록'
                  : step === 'duplicate_select'
                  ? '전체 회원 검색 결과'
                  : '신규 회원 등록 메뉴'}
              </h2>

              {step === 'input' && (
                <div className="hidden sm:flex items-center gap-1.5 flex-nowrap shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPamphlet(true)}
                    className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 transition-all cursor-pointer active:scale-95 shadow-sm shadow-emerald-500/10 whitespace-nowrap"
                    title="일괄등록 설명서 열기"
                  >
                    <BookOpen className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>설명서</span>
                  </button>
                  <label
                    className={`px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold border flex items-center gap-1.5 transition-all cursor-pointer select-none whitespace-nowrap ${
                      isAttendanceCheckEnabled
                        ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-400/50 shadow-sm shadow-cyan-500/10'
                        : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                    title="체크 시 일괄 등록된 선수가 참가자 명단에 출석 버튼(이름 빗금) 상태로 등록되며, 비체크 시 즉시 참가 등록됩니다"
                  >
                    <input
                      type="checkbox"
                      checked={isAttendanceCheckEnabled}
                      onChange={(e) => handleToggleAttendanceCheck(e.target.checked)}
                      className="w-3 h-3 rounded border-slate-600 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-900 accent-cyan-400 cursor-pointer"
                    />
                    <span>출석체크</span>
                  </label>
                </div>
              )}
              {step === 'duplicate_select' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap shrink-0">
                  동명이인 {ambiguousGroups.length}건
                </span>
              )}
              {step === 'new_members' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap shrink-0">
                  신규 회원 {newMemberDrafts.length}명
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {step === 'input' && (
                <button
                  type="button"
                  onClick={() => handleStartBulkProcess()}
                  className="px-2.5 sm:px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
                >
                  <ListPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>일괄 등록하기</span>
                  {livePreview.totalCount > 0 && (
                    <span className="font-mono">({livePreview.totalCount}명)</span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (accumulatedAddedCount > 0) {
                    finalizeAndClose(
                      accumulatedAddedCount,
                      accumulatedSkippedNames,
                      accumulatedRestoredNames
                    );
                  } else {
                    onClose();
                  }
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                aria-label="참가자 일괄 등록 닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 모바일 전용 2행 보조 버튼 또는 단계 안내 문구 */}
          {step === 'input' ? (
            <div className="flex sm:hidden items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowPamphlet(true)}
                className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 transition-all cursor-pointer active:scale-95 shadow-sm shadow-emerald-500/10 whitespace-nowrap"
                title="일괄등록 설명서 열기"
              >
                <BookOpen className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>설명서</span>
              </button>
              <label
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1.5 transition-all cursor-pointer select-none whitespace-nowrap ${
                  isAttendanceCheckEnabled
                    ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-400/50 shadow-sm shadow-cyan-500/10'
                    : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 border-slate-700'
                }`}
                title="체크 시 일괄 등록된 선수가 참가자 명단에 출석 버튼(이름 빗금) 상태로 등록되며, 비체크 시 즉시 참가 등록됩니다"
              >
                <input
                  type="checkbox"
                  checked={isAttendanceCheckEnabled}
                  onChange={(e) => handleToggleAttendanceCheck(e.target.checked)}
                  className="w-3 h-3 rounded border-slate-600 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-900 accent-cyan-400 cursor-pointer"
                />
                <span>출석체크</span>
              </label>
            </div>
          ) : (
            <p className="text-[11px] sm:text-xs text-slate-400 truncate">
              {step === 'duplicate_select'
                ? '전체 회원에 동일한 이름의 선수가 2명 이상 있습니다. 등록할 선수를 선택해 주세요.'
                : '전체 회원에 없는 신규 회원입니다. 성별/급수를 선택하면 전체 회원 및 참가자에 동시 등록됩니다.'}
            </p>
          )}
        </div>

        {/* Step Progress Banner (이전 단계에서 먼저 등록된 인원 안내) */}
        {stepBannerMessage && (
          <div className="px-5 py-2.5 bg-emerald-500/15 border-b border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{stepBannerMessage}</span>
          </div>
        )}

        {/* STEP 1: BULK TEXT INPUT */}
        {step === 'input' && (
          <form onSubmit={handleStartBulkProcess} className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 space-y-3.5 flex-1 overflow-y-auto">
              {/* Textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs font-bold text-slate-300">
                      참가자 명단 입력
                    </label>
                    <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 whitespace-nowrap">
                      <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
                      <span>전체회원 {masterMembers.length}명 동기화</span>
                    </span>
                  </div>
                  {bulkText && (
                    <button
                      type="button"
                      onClick={() => {
                        setBulkText('');
                        textareaRef.current?.focus();
                      }}
                      className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>입력 지우기</span>
                    </button>
                  )}
                </div>
                <textarea
                  ref={textareaRef}
                  rows={7}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`예시 1 (이름만 / 꼬깔번호 함께 입력):\n홍길동 12, 김철수5, 이영희\n\n예시 2 (띄어쓰기만으로 선수이름 성별 급수 입력):\n박지성 남 A, 손흥민 10 남 S, 김연경 여 B (박지성/남/A 도 가능)`}
                  className="w-full p-3.5 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none leading-relaxed resize-y"
                />
              </div>

              {/* Real-time Classification Preview */}
              <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-semibold">실시간 분석:</span>
                  <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-white font-mono font-bold">
                    총 {livePreview.totalCount}명
                  </span>
                  {livePreview.coneCount > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-bold text-[11px]">
                      꼬깔번호 {livePreview.coneCount}명
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold text-[11px]">
                    회원 즉시 매칭 {livePreview.exactOneCount}명
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-lg border font-semibold text-[11px] ${
                      livePreview.duplicateCount > 0
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}
                  >
                    동명이인 선택 {livePreview.duplicateCount}명
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-lg border font-semibold text-[11px] ${
                      livePreview.newMemberCount > 0
                        ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}
                  >
                    신규 회원 {livePreview.newMemberCount}명
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
              >
                닫기
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: DUPLICATE NAME SELECTION (전체 회원 검색 결과 메뉴 - 동명이인 2명 이상) */}
        {step === 'duplicate_select' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto">
              {ambiguousGroups.map((group) => {
                const chosenIds = selectedDuplicateMemberIds[group.key] || [];
                return (
                  <div
                    key={group.key}
                    className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">
                          '{group.searchName}' 전체 회원 검색 결과
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          동명이인 {group.matchedMembers.length}명
                        </span>
                        {group.coneNumber && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/25 text-amber-200 border border-amber-400/50">
                            꼬깔 {group.coneNumber}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSendAmbiguousToNewMember(group)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 flex items-center gap-1 transition-all cursor-pointer"
                        title="목록에 없는 새로운 동명이인인 경우 신규 회원 등록 메뉴로 이동"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>신규 동명이인으로 등록</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {group.matchedMembers.map((member) => {
                        const tierMeta = TIER_LABELS[member.tier] || TIER_LABELS.Beginner;
                        const isAlreadyPlaying =
                          participatingKeySet.has(`id__${member.id}`) ||
                          participatingKeySet.has(
                            `${member.name.trim().toLowerCase()}__${member.gender}__${member.tier}`
                          );
                        const isSelected = chosenIds.includes(member.id);

                        return (
                          <div
                            key={member.id}
                            onClick={() => {
                              if (ambiguousGroups.length > 1) {
                                handleToggleDuplicateMember(group.key, member.id);
                              }
                            }}
                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                              isSelected
                                ? 'bg-emerald-950/40 border-emerald-400 ring-1 ring-emerald-400/50 shadow-md'
                                : isAlreadyPlaying
                                ? 'bg-slate-900/50 border-slate-800/80 opacity-75'
                                : 'bg-slate-900/90 border-slate-800 hover:border-emerald-500/50'
                            } ${ambiguousGroups.length > 1 ? 'cursor-pointer' : ''}`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              {ambiguousGroups.length > 1 && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    handleToggleDuplicateMember(group.key, member.id)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded border-slate-600 text-emerald-400 accent-emerald-400 cursor-pointer"
                                />
                              )}
                              <span
                                className={`text-sm font-bold truncate ${
                                  member.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                                }`}
                              >
                                {member.name}
                                {group.coneNumber ? ` ${group.coneNumber}` : ''}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                  member.gender === 'M'
                                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                                    : 'bg-pink-500/15 border-pink-500/30 text-pink-300'
                                }`}
                              >
                                {member.gender === 'M' ? '남성' : '여성'}
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tierMeta.bg} ${tierMeta.color}`}
                              >
                                {tierMeta.short}
                              </span>
                              {isAlreadyPlaying && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                  오늘 참가 중
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {ambiguousGroups.length === 1 && group.matchedMembers.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDuplicateMember(group.key, member.id);
                                  }}
                                  className={`px-2.5 py-1.5 font-bold text-xs rounded-xl border transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                                  }`}
                                  title="동명이인 여러 명을 동시에 선택할 때 체크"
                                >
                                  {isSelected ? '체크됨 ✓' : '다중체크'}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuickSelectSingleDuplicate(group, member);
                                }}
                                className={`px-3.5 py-1.5 font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                                  isSelected
                                    ? 'bg-emerald-400 text-slate-950 shadow-sm shadow-emerald-500/30'
                                    : 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-sm shadow-emerald-500/20 active:scale-95'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>
                                  {ambiguousGroups.length === 1
                                    ? '선택'
                                    : isSelected
                                    ? '선택됨'
                                    : '선택'}
                                </span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer for Step 2 */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2 shrink-0 flex-wrap">
              <span className="text-xs text-slate-400">
                {newMemberDrafts.length > 0
                  ? `선택 완료 후 신규 회원(${newMemberDrafts.length}명) 등록 메뉴로 이어집니다.`
                  : '등록할 회원의 [선택] 버튼을 눌러주세요.'}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    if (newMemberDrafts.length > 0) {
                      setStep('new_members');
                    } else {
                      finalizeAndClose(
                        accumulatedAddedCount,
                        accumulatedSkippedNames,
                        accumulatedRestoredNames
                      );
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                >
                  {newMemberDrafts.length > 0 ? '건너뛰고 신규 회원 등록' : '닫기'}
                </button>
                {(ambiguousGroups.length > 1 || totalSelectedDuplicatesCount > 0) && (
                  <button
                    type="button"
                    onClick={handleConfirmDuplicateSelections}
                    className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>선택 회원 등록 ({totalSelectedDuplicatesCount}명)</span>
                    {newMemberDrafts.length > 0 && <ArrowRight className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: NEW MEMBERS BULK REGISTRATION MENU (신규 회원 등록 메뉴 - 전체 신규 회원 성별/급수 선택) */}
        {step === 'new_members' && (
          <form
            onSubmit={handleConfirmNewMembersRegistration}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Quick Bulk Apply Bar (일괄 성별/급수 선택 도우미) */}
            <div className="px-5 py-2.5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>전체 신규 회원 일괄 선택:</span>
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {/* Bulk Gender */}
                <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-1 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 mr-0.5">전체 성별</span>
                  <button
                    type="button"
                    onClick={() => handleApplyAllNewGender('M')}
                    className="px-2 py-0.5 text-[11px] font-bold rounded bg-blue-500/15 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition-colors cursor-pointer"
                  >
                    남성
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyAllNewGender('F')}
                    className="px-2 py-0.5 text-[11px] font-bold rounded bg-pink-500/15 hover:bg-pink-500/30 text-pink-300 border border-pink-500/30 transition-colors cursor-pointer"
                  >
                    여성
                  </button>
                </div>

                {/* Bulk Tier */}
                <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-1 rounded-lg border border-slate-800 overflow-x-auto">
                  <span className="text-[10px] text-slate-400 mr-0.5">전체 급수</span>
                  {(['S', 'A', 'B', 'C', 'D', 'Beginner'] as Tier[]).map((t) => {
                    const meta = TIER_LABELS[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleApplyAllNewTier(t)}
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded border transition-all cursor-pointer ${meta.bg} ${meta.color} hover:brightness-125`}
                      >
                        {meta.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* New Members List */}
            <div className="p-4 sm:p-5 space-y-2.5 flex-1 overflow-y-auto">
              {newMemberDrafts.map((draft, idx) => {
                const isComplete = Boolean(draft.name.trim() && draft.gender && draft.tier);
                return (
                  <div
                    key={draft.id}
                    className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 ${
                      isComplete
                        ? 'bg-slate-950/90 border-emerald-500/40'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    {/* Left: Index + Name + Cone Number */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`w-6 h-6 rounded-lg text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                          isComplete
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) => handleUpdateDraftName(draft.id, e.target.value)}
                        placeholder="신규 회원 이름"
                        className="flex-1 min-w-0 px-3 py-1.5 bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-xl text-xs sm:text-sm font-bold text-white focus:outline-none"
                      />
                      <input
                        type="text"
                        value={draft.coneNumber ?? ''}
                        onChange={(e) => handleUpdateDraftCone(draft.id, e.target.value)}
                        placeholder="꼬깔"
                        title="꼬깔 번호 (선택)"
                        className="w-14 px-2 py-1.5 bg-slate-900 border border-amber-500/40 focus:border-amber-400 rounded-xl text-xs sm:text-sm font-mono font-bold text-amber-300 placeholder-slate-500 text-center focus:outline-none shrink-0"
                      />
                    </div>

                    {/* Right: Gender + Tier + Remove */}
                    <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap shrink-0">
                      {/* Gender Selector */}
                      <div className="flex items-center bg-slate-900 p-0.5 rounded-xl border border-slate-700 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateDraftGender(draft.id, 'M')}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                            draft.gender === 'M'
                              ? 'bg-blue-500/25 text-blue-300 border border-blue-500/50 shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          남성
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateDraftGender(draft.id, 'F')}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                            draft.gender === 'F'
                              ? 'bg-pink-500/25 text-pink-300 border border-pink-500/50 shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          여성
                        </button>
                      </div>

                      {/* Tier Selector */}
                      <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
                        {(['S', 'A', 'B', 'C', 'D', 'Beginner'] as Tier[]).map((t) => {
                          const isSelected = draft.tier === t;
                          const meta = TIER_LABELS[t];
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => handleUpdateDraftTier(draft.id, t)}
                              className={`px-2 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                isSelected
                                  ? `${meta.bg} ${meta.color} ring-2 ring-emerald-400 shadow-sm`
                                  : 'border-slate-800 text-slate-500 bg-slate-900 hover:text-slate-300'
                              }`}
                            >
                              {meta.short}
                            </button>
                          );
                        })}
                      </div>

                      {/* Delete Row Button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveDraft(draft.id)}
                        title="이 신규 회원 등록 제외"
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer for Step 3 */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2 shrink-0 flex-wrap">
              <div className="text-xs text-slate-400">
                성별/급수 선택 완료:{' '}
                <strong
                  className={`font-mono ${
                    completedNewDraftCount === newMemberDrafts.length
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {completedNewDraftCount}/{newMemberDrafts.length}명
                </strong>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    finalizeAndClose(
                      accumulatedAddedCount,
                      accumulatedSkippedNames,
                      accumulatedRestoredNames
                    );
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 active:scale-95 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>신규 회원 및 참가자 등록 ({newMemberDrafts.length}명)</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* 일괄등록 설명서 팜플렛 모달 */}
        {showPamphlet && (
          <div
            className="fixed inset-0 z-[115] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setShowPamphlet(false)}
          >
            <div
              className="relative w-full max-w-lg bg-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Pamphlet Header */}
              <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-purple-950/60 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-bold text-white truncate">
                    참가자 일괄등록 설명서
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPamphlet(false)}
                  className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Pamphlet Body (요점 정리) */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 text-xs text-slate-300">
                {/* 출석체크 연동 안내 (핵심 신규 기능) */}
                <div className="p-3 rounded-xl bg-cyan-950/35 border border-cyan-500/40 flex flex-col gap-1.5">
                  <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 stroke-[2.5]" />
                    <span>[출석체크] 체크버튼 &amp; 참가 순서 자동 정렬</span>
                  </div>
                  <ul className="text-slate-300 text-[11px] space-y-1 leading-relaxed">
                    <li>
                      • <strong className="text-cyan-200">체크 상태 (기본):</strong> 일괄 등록 시 참가자 명단에 <strong className="text-white">반투명 빗금</strong>이 쳐진 미출석 상태로 등록되며, <code className="text-cyan-300">[🏸 콕제출]</code> 전에 <code className="text-cyan-300 font-bold">[출석]</code> 버튼이 먼저 표시됩니다.
                    </li>
                    <li>
                      • <strong className="text-cyan-200">오름차순 등록:</strong> 선수가 도착해 <code className="text-cyan-300 font-bold">[출석]</code>을 누르면 누른 순서대로 <strong className="text-emerald-300">1, 2, 3... 오름차순 참가 순서</strong>로 등록됩니다. (미출석 선수는 코트 현황·게임 목록에 표시되지 않습니다.)
                    </li>
                    <li>
                      • <strong className="text-cyan-200">꼬깔확인 &amp; 지각 연동:</strong> 상단 <code className="text-amber-300">[꼬깔확인]</code> 체크 시 출석 버튼을 누르면 꼬깔 번호 입력창이 열리며, 첫 게임 배정 20분 뒤 출석 시 지각 보정이 자동 적용됩니다.
                    </li>
                    <li>
                      • <strong className="text-slate-200">비체크 상태:</strong> 출석 확인 단계 없이 일괄 등록 즉시 참가자 명단에 정식 등록됩니다.
                    </li>
                  </ul>
                </div>

                {/* 1. 이름만 입력 */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/30 flex flex-col gap-1">
                  <div className="font-bold text-purple-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>1. 이름만 입력 → 전체회원 자동 매칭</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    전체회원에서 이름·성별·급수를 찾아 참가자로 즉시 등록합니다.{' '}
                    <span className="font-mono text-purple-200">(예: 홍길동, 김철수)</span>
                  </p>
                </div>

                {/* 2. 꼬깔번호 입력 */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 flex flex-col gap-1">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>2. 이름 뒤 숫자 → 꼬깔번호 등록</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    이름 뒤 숫자는 오늘의 꼬깔번호로 자동 지정됩니다.{' '}
                    <span className="font-mono text-amber-200">(예: 홍길동 12, 김철수7)</span>
                  </p>
                </div>

                {/* 3. 동명이인 & 4. 미등록 이름 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-sky-500/30 flex flex-col gap-1">
                    <div className="font-bold text-sky-300 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>3. 동명이인 (2명 이상)</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      검색 결과 화면에서 대상 회원을 선택하거나 신규 동명이인으로 등록합니다.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/80 border border-indigo-500/30 flex flex-col gap-1">
                    <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>4. 미등록 이름 입력</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      성별·급수 선택 화면이 열리며, 전체회원과 참가자에 동시 등록됩니다.
                    </p>
                  </div>
                </div>

                {/* 5. 이름 성별 급수 직접 입력 */}
                <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col gap-1">
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>5. 이름 성별 급수 입력 → 신규회원 + 참가자 즉시 등록</span>
                  </div>
                  <p className="text-slate-300 text-[11px]">
                    띄어쓰기 또는 <code className="text-emerald-300">/</code>로 구분 시 확인 단계 없이 즉시 등록됩니다.
                  </p>
                  <div className="font-mono text-[11px] text-emerald-200 pt-0.5">
                    예: 박지성 남 A, 손흥민 10 남 S, 김연아/여/B
                  </div>
                </div>

                {/* 입력 팁 요약 */}
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <div>
                    • <strong className="text-slate-200">구분:</strong> 줄바꿈, 쉼표(<code className="text-slate-200">,</code>), 띄어쓰기 혼용 가능 · 앞 번호(<code className="text-slate-200">1. 홍길동</code>) 자동 제거
                  </div>
                  <div>
                    • <strong className="text-slate-200">인식:</strong> 성별(<code className="text-slate-200">남/여, M/F</code>) · 급수(<code className="text-slate-200">S, A, B, C, D, E, 초심</code>) 자동 인식
                  </div>
                </div>
              </div>

              {/* Pamphlet Footer */}
              <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPamphlet(false)}
                  className="px-5 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-Modal Alert Dialog */}
        {modalAlert && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setModalAlert(null)}
          >
            <div
              className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3.5 shadow-sm shadow-amber-500/20">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">알림</h4>
              <p className="text-sm text-slate-300 leading-relaxed mb-5 whitespace-pre-line font-medium">
                {modalAlert}
              </p>
              <button
                type="button"
                autoFocus
                onClick={() => setModalAlert(null)}
                className="w-full py-2.5 px-4 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] text-slate-950 font-bold text-sm rounded-xl transition-all cursor-pointer"
              >
                확인
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
