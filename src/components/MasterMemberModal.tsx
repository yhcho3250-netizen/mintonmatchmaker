import React, { useState, useMemo, useRef } from 'react';
import { MasterMember, Player, Gender, Tier, TIER_LABELS } from '../types';
import {
  X,
  Users,
  Search,
  UserPlus,
  Plus,
  Trash2,
  Edit2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Download,
  Upload,
  FlaskConical,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import {
  exportDataToDeviceFile,
  parseAndRestoreDeviceBackupJson,
  DEVICE_STORAGE_KEYS,
} from '../utils/deviceStorage';
import { isTestPlayer } from '../utils/masterMemberStorage';

interface MasterMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterMembers: MasterMember[];
  onUpdateMasterMembers: (members: MasterMember[]) => void;
  currentPlayers: Player[];
  onAddPlayerToToday: (
    name: string,
    gender: Gender,
    tier: Tier,
    masterMemberId?: string
  ) => void;
  onUpdatePlayers?: (players: Player[]) => void;
  onSyncMemberEdit?: (oldMember: MasterMember, updatedMember: MasterMember) => void;
  onOpenTestConfirm?: () => void;
}

export const MasterMemberModal: React.FC<MasterMemberModalProps> = ({
  isOpen,
  onClose,
  masterMembers,
  onUpdateMasterMembers,
  currentPlayers,
  onAddPlayerToToday,
  onUpdatePlayers,
  onSyncMemberEdit,
  onOpenTestConfirm,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Member Form State
  const [newName, setNewName] = useState('');
  const [newGender, setNewGender] = useState<Gender | null>(null);
  const [newTier, setNewTier] = useState<Tier | null>(null);
  const newMemberNameInputRef = useRef<HTMLInputElement>(null);

  // Editing Member State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<Gender>('M');
  const [editTier, setEditTier] = useState<Tier>('C');
  const editMemberNameInputRef = useRef<HTMLInputElement>(null);

  // In-app Alert / Confirm States
  const [modalAlert, setModalAlert] = useState<string | null>(null);
  const [deleteConfirmMember, setDeleteConfirmMember] = useState<MasterMember | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Currently participating players key set (id and name + gender + tier) for fast lookup
  const participatingKeySet = useMemo(() => {
    const set = new Set<string>();
    currentPlayers.forEach((p) => {
      if (isTestPlayer(p)) return; // 테스트 생성 선수는 전체 회원과 무관하므로 제외
      if (p.masterMemberId) {
        set.add(`id__${p.masterMemberId}`);
      }
      set.add(`${p.name.trim().toLowerCase()}__${p.gender}__${p.tier}`);
    });
    return set;
  }, [currentPlayers]);

  if (!isOpen) return null;

  const filteredMembers = masterMembers.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const handleCreateMember = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName) {
      soundEffects.playScorePoint();
      setModalAlert('회원 이름을 입력해주세요.');
      return;
    }
    if (!newGender || !newTier) {
      soundEffects.playScorePoint();
      setModalAlert('성별과 급수를 모두 선택해주세요.');
      return;
    }

    // 이름, 성별, 급수가 모두 일치하는 동일 회원이 이미 있는지 확인
    const exactExisting = masterMembers.find(
      (m) =>
        m.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        m.gender === newGender &&
        m.tier === newTier
    );

    if (exactExisting) {
      soundEffects.playScorePoint();
      setModalAlert(
        `'${cleanName}' (${newGender === 'M' ? '남성' : '여성'}, ${
          TIER_LABELS[newTier]?.short || newTier
        }) 선수는 이미 전체 회원에 등록되어 있습니다.`
      );
      return;
    }

    // 회원 등록 (꼬깔 번호는 당일 참가자 전용이므로 전체 회원 명부에서는 입력 불필요)
    soundEffects.playWhistle();

    const newMember: MasterMember = {
      id: `master_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      gender: newGender,
      tier: newTier,
      registeredAt: Date.now(),
    };

    const updated = [...masterMembers, newMember].sort((a, b) => {
      const nameDiff = a.name.localeCompare(b.name, 'ko');
      if (nameDiff !== 0) return nameDiff;
      const genderDiff = a.gender.localeCompare(b.gender);
      if (genderDiff !== 0) return genderDiff;
      return a.tier.localeCompare(b.tier);
    });
    onUpdateMasterMembers(updated);

    // 당일 참가자 명단에 동일 선수가 이미 있는 경우 masterMemberId 연동 보장
    if (onUpdatePlayers) {
      const hasMatch = currentPlayers.some(
        (p) =>
          p.name.trim().toLowerCase() === cleanName.toLowerCase() &&
          p.gender === newGender &&
          p.tier === newTier &&
          p.masterMemberId !== newMember.id
      );
      if (hasMatch) {
        onUpdatePlayers(
          currentPlayers.map((p) =>
            p.name.trim().toLowerCase() === cleanName.toLowerCase() &&
            p.gender === newGender &&
            p.tier === newTier
              ? { ...p, masterMemberId: newMember.id }
              : p
          )
        );
      }
    }

    // Reset form and keep focus for consecutive registration (연속 등록 지원)
    setNewName('');
    setNewGender(null);
    setNewTier(null);
    requestAnimationFrame(() => {
      try {
        newMemberNameInputRef.current?.focus({ preventScroll: true });
      } catch {
        newMemberNameInputRef.current?.focus();
      }
    });
  };

  const handleStartEdit = (member: MasterMember) => {
    setEditingId(member.id);
    setEditName(member.name);
    setEditGender(member.gender);
    setEditTier(member.tier);
    requestAnimationFrame(() => {
      try {
        editMemberNameInputRef.current?.focus({ preventScroll: true });
        editMemberNameInputRef.current?.select();
      } catch {
        editMemberNameInputRef.current?.focus();
      }
    });
  };

  const handleSaveEdit = (id: string) => {
    const cleanName = editName.trim();
    if (!cleanName) {
      soundEffects.playScorePoint();
      setModalAlert('이름을 입력해주세요.');
      return;
    }

    // 수정 시 다른 회원과 이름+성별+급수가 완전히 중복되는지 검사
    const exactConflict = masterMembers.find(
      (m) =>
        m.id !== id &&
        m.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        m.gender === editGender &&
        m.tier === editTier
    );

    if (exactConflict) {
      soundEffects.playScorePoint();
      setModalAlert(
        `'${cleanName}' (${editGender === 'M' ? '남성' : '여성'}, ${
          TIER_LABELS[editTier]?.short || editTier
        }) 회원이 이미 존재합니다.`
      );
      return;
    }

    const targetOld = masterMembers.find((m) => m.id === id);
    const updatedMemberObj: MasterMember = {
      id,
      name: cleanName,
      gender: editGender,
      tier: editTier,
      registeredAt: targetOld?.registeredAt || Date.now(),
    };

    const updated = masterMembers.map((m) =>
      m.id === id ? updatedMemberObj : m
    );

    onUpdateMasterMembers(updated);
    setEditingId(null);
    soundEffects.playRacketHit();

    // 전체 회원 관리에서 정보가 수정되었을 때 당일 참가자 명단에 있는 해당 선수의 기본 정보도 1:1 동기화 (꼬깔 번호는 당일 유지)
    if (onUpdatePlayers && targetOld) {
      onUpdatePlayers(
        currentPlayers.map((p) => {
          const isTarget =
            (p.masterMemberId && p.masterMemberId === id) ||
            (!p.masterMemberId &&
              p.name.trim().toLowerCase() === targetOld.name.trim().toLowerCase() &&
              p.gender === targetOld.gender &&
              p.tier === targetOld.tier);

          if (isTarget) {
            return {
              ...p,
              name: cleanName,
              gender: editGender,
              tier: editTier,
              masterMemberId: id,
            };
          }
          return p;
        })
      );
    }

    if (onSyncMemberEdit && targetOld) {
      onSyncMemberEdit(targetOld, updatedMemberObj);
    }
  };

  const handleDeleteMember = (member: MasterMember) => {
    setDeleteConfirmMember(member);
  };

  const confirmDeleteMember = () => {
    if (!deleteConfirmMember) return;
    const updated = masterMembers.filter((m) => m.id !== deleteConfirmMember.id);
    onUpdateMasterMembers(updated);
    soundEffects.playScorePoint();
    setDeleteConfirmMember(null);
  };

  const handleAddMemberToToday = (member: MasterMember) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    soundEffects.playWhistle();
    onAddPlayerToToday(member.name, member.gender, member.tier, member.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 flex flex-col gap-2 shrink-0">
          {/* 1행: 상단 아이콘 + 전체 회원 관리 문구 + (데스크톱 배지/버튼) + 회원 직접 등록 버튼 + 닫기 버튼 (항상 같은 라인) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white whitespace-nowrap">
                전체 회원 관리
              </h2>
              <div className="hidden sm:flex items-center gap-1.5 flex-nowrap shrink-0">
                <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 whitespace-nowrap shrink-0">
                  총 {masterMembers.length}명
                </span>
                {onOpenTestConfirm && (
                  <button
                    type="button"
                    onClick={onOpenTestConfirm}
                    className="px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 hover:border-amber-400 transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
                    title="참가자 명단에 임의의 이름과 급수의 선수 24명 자동 생성 (전체 회원 등록 제외)"
                  >
                    <FlaskConical className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>테스트</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (masterMembers.length === 0) {
                      soundEffects.playScorePoint();
                      setModalAlert('초기화할 등록 회원이 없습니다.');
                      return;
                    }
                    setShowResetConfirm(true);
                  }}
                  className="px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-200 border border-rose-500/30 hover:border-rose-500/50 flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
                  title="전체 회원 명부 목록 초기화"
                >
                  <RotateCcw className="w-3 h-3 shrink-0" />
                  <span>회원초기화</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm((prev) => {
                    const next = !prev;
                    if (next) {
                      requestAnimationFrame(() => {
                        newMemberNameInputRef.current?.focus({ preventScroll: true });
                      });
                    }
                    return next;
                  });
                }}
                className="px-2.5 sm:px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>{showAddForm ? '접기' : '회원 직접 등록'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                aria-label="전체 회원 관리 닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2행 (모바일 전용): 총 인원 배지 + 테스트 + 회원초기화 버튼 */}
          <div className="flex sm:hidden items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 whitespace-nowrap shrink-0">
              총 {masterMembers.length}명
            </span>
            {onOpenTestConfirm && (
              <button
                type="button"
                onClick={onOpenTestConfirm}
                className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 hover:border-amber-400 transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
                title="참가자 명단에 임의의 이름과 급수의 선수 24명 자동 생성 (전체 회원 등록 제외)"
              >
                <FlaskConical className="w-3 h-3 text-amber-400 shrink-0" />
                <span>테스트</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (masterMembers.length === 0) {
                  soundEffects.playScorePoint();
                  setModalAlert('초기화할 등록 회원이 없습니다.');
                  return;
                }
                setShowResetConfirm(true);
              }}
              className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-200 border border-rose-500/30 hover:border-rose-500/50 flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
              title="전체 회원 명부 목록 초기화"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>회원초기화</span>
            </button>
          </div>
        </div>

        {/* Safe Device Internal Local Storage Notice Banner & File Backup/Restore */}
        <div className="px-5 py-2.5 bg-purple-950/40 border-b border-purple-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-purple-200 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="font-semibold">
              전체 회원 및 앱 데이터 저장
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={async () => {
                soundEffects.playRacketHit();
                const ok = await exportDataToDeviceFile();
                if (ok) {
                  setModalAlert('기기 내부 저장소(파일)로 데이터 백업이 완료되었습니다.');
                }
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 hover:text-white border border-purple-400/30 flex items-center gap-1 transition-all cursor-pointer active:scale-95"
              title="현재 기기 내부 파일(.json)로 저장"
            >
              <Download className="w-3 h-3" />
              <span>기기 파일 저장</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundEffects.playRacketHit();
                fileInputRef.current?.click();
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 flex items-center gap-1 transition-all cursor-pointer active:scale-95"
              title="기기 내부에 저장된 백업 파일(.json) 불러오기"
            >
              <Upload className="w-3 h-3" />
              <span>기기 파일 불러오기</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const text = typeof reader.result === 'string' ? reader.result : '';
                  const res = parseAndRestoreDeviceBackupJson(text);
                  if (res.success) {
                    const rawMembers = res.restoredKeys[DEVICE_STORAGE_KEYS.MASTER_MEMBERS];
                    if (rawMembers) {
                      try {
                        const parsedMembers = JSON.parse(rawMembers);
                        if (Array.isArray(parsedMembers)) {
                          onUpdateMasterMembers(parsedMembers);
                        }
                      } catch {
                        // ignore
                      }
                    }
                    soundEffects.playWhistle();
                    setModalAlert(res.message);
                  } else {
                    soundEffects.playScorePoint();
                    setModalAlert(res.message);
                  }
                };
                reader.readAsText(file);
              }}
            />
          </div>
        </div>

        {/* Direct Add Member Form (Collapsible) */}
        {showAddForm && (
          <form
            onSubmit={handleCreateMember}
            className="p-4 bg-slate-950/70 border-b border-slate-800 space-y-3 shrink-0 animate-in slide-in-from-top-2 duration-150"
          >
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>신규 전체 회원 등록</span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                ref={newMemberNameInputRef}
                type="text"
                placeholder="회원 이름 (예: 박지성)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 px-3.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />

              {/* Gender */}
              <div className="flex items-center bg-slate-900 p-0.5 rounded-xl border border-slate-700 shrink-0">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setNewGender('M')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    newGender === 'M'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  남성
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setNewGender('F')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    newGender === 'F'
                      ? 'bg-pink-500/20 text-pink-400 border border-pink-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  여성
                </button>
              </div>

              {/* Tier */}
              <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
                {(['S', 'A', 'B', 'C', 'D', 'Beginner'] as Tier[]).map((t) => {
                  const isSelected = newTier === t;
                  const meta = TIER_LABELS[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setNewTier(t)}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        isSelected
                          ? `${meta.bg} ${meta.color} ring-1 ring-emerald-400`
                          : 'border-slate-800 text-slate-500 bg-slate-900 hover:text-slate-300'
                      }`}
                    >
                      {meta.short}
                    </button>
                  );
                })}
              </div>

              <button
                type="submit"
                onMouseDown={(e) => e.preventDefault()}
                className="px-3.5 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0"
              >
                <span>등록</span>
              </button>
            </div>
          </form>
        )}

        {/* Search Bar */}
        <div className="p-3 bg-slate-950/40 border-b border-slate-800/80 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="전체 회원 검색 (이름)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Member List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredMembers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              {searchQuery
                ? `'${searchQuery}' 회원을 찾을 수 없습니다.`
                : '등록된 전체 회원이 없습니다. 상단 [회원 직접 등록]으로 회원을 추가해보세요.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filteredMembers.map((member) => {
                const tierMeta = TIER_LABELS[member.tier] || TIER_LABELS.Beginner;
                const isParticipating =
                  participatingKeySet.has(`id__${member.id}`) ||
                  participatingKeySet.has(
                    `${member.name.trim().toLowerCase()}__${member.gender}__${member.tier}`
                  );
                const isEditing = editingId === member.id;

                if (isEditing) {
                  return (
                    <form
                      key={member.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveEdit(member.id);
                      }}
                      className="p-3 rounded-xl bg-slate-950 border border-purple-500/60 space-y-2.5 animate-in fade-in duration-100"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          ref={editMemberNameInputRef}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveEdit(member.id);
                            }
                            if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          enterKeyHint="done"
                          placeholder="회원 이름 (엔터로 저장)"
                          className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-bold"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        {/* Gender */}
                        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                          <button
                            type="button"
                            onClick={() => setEditGender('M')}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors cursor-pointer ${
                              editGender === 'M' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            남성
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditGender('F')}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors cursor-pointer ${
                              editGender === 'F' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/40' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            여성
                          </button>
                        </div>

                        {/* Tier */}
                        <div className="flex items-center gap-0.5">
                          {(['S', 'A', 'B', 'C', 'D', 'Beginner'] as Tier[]).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setEditTier(t)}
                              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-all cursor-pointer ${
                                editTier === t ? `${TIER_LABELS[t].bg} ${TIER_LABELS[t].color} ring-1 ring-purple-400` : 'border-slate-800 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {TIER_LABELS[t].short}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-900">
                        <button
                          type="submit"
                          className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] rounded-lg transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1"
                        >
                          <span>저장 (Enter)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded-lg transition-colors cursor-pointer"
                        >
                          취소
                        </button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div
                    key={member.id}
                    className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-2.5 transition-all"
                  >
                    {/* Left: Name, Gender, Tier */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-sm font-bold truncate ${
                          member.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                        }`}
                      >
                        {member.name}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                          member.gender === 'M'
                            ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                            : 'bg-pink-500/15 border-pink-500/30 text-pink-300'
                        }`}
                      >
                        {member.gender === 'M' ? '남' : '여'}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border ${tierMeta.bg} ${tierMeta.color}`}
                      >
                        {tierMeta.short}
                      </span>
                    </div>

                    {/* Right: Add to today / Participating status + Edit/Delete */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isParticipating ? (
                        <span className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-800 text-slate-400 flex items-center gap-1 border border-slate-700/60">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>참가 중</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddMemberToToday(member)}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 hover:text-white flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                          title="오늘 모임 참가자로 추가"
                        >
                          <Plus className="w-3 h-3" />
                          <span>오늘 참가</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleStartEdit(member)}
                        className="p-1.5 text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                        title="회원 정보 수정"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteMember(member)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                        title="회원 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400 shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span>총 등록 회원: <strong className="text-white font-mono">{masterMembers.length}명</strong></span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>

        {/* In-app Alert Dialog */}
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

        {/* Delete Confirmation Dialog */}
        {deleteConfirmMember && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setDeleteConfirmMember(null)}
          >
            <div
              className="relative w-full max-w-sm bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto mb-3.5 shadow-sm shadow-rose-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">회원 삭제</h4>
              <p className="text-sm text-slate-300 leading-relaxed mb-5 whitespace-pre-line">
                <strong className="text-white">'{deleteConfirmMember.name}'</strong> 회원을 전체 회원 목록에서 삭제하시겠습니까?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmMember(null)}
                  className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm rounded-xl transition-all cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMember}
                  className="flex-1 py-2.5 px-4 bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer"
                >
                  삭제하기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reset All Master Members Confirmation Dialog */}
        {showResetConfirm && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setShowResetConfirm(false)}
          >
            <div
              className="relative w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto mb-3.5 shadow-sm shadow-rose-500/20">
                <RotateCcw className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-white mb-2">전체 회원 초기화</h4>
              <p className="text-sm text-slate-300 leading-relaxed mb-5 whitespace-pre-line">
                등록된 전체 회원 <strong className="text-rose-400 font-bold font-mono">{masterMembers.length}명</strong>의 정보를 모두 삭제하시겠습니까?
                {'\n'}
                <span className="text-xs text-slate-400 mt-1 block">초기화 후에는 저장된 회원 명부를 복구할 수 없습니다.</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm rounded-xl transition-all cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateMasterMembers([]);
                    soundEffects.playScorePoint();
                    setShowResetConfirm(false);
                    setModalAlert('전체 회원 목록이 초기화되었습니다.');
                  }}
                  className="flex-1 py-2.5 px-4 bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer"
                >
                  초기화하기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
