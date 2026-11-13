import React, { useEffect, useRef } from 'react';
import { MasterMember, Player, TIER_LABELS } from '../types';
import { X, Check, Users } from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface MemberSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchName: string;
  matchedMembers: MasterMember[];
  currentPlayers?: Player[];
  onSelectMember: (member: MasterMember) => void;
}

export const MemberSelectModal: React.FC<MemberSelectModalProps> = ({
  isOpen,
  onClose,
  searchName,
  matchedMembers,
  currentPlayers = [],
  onSelectMember,
}) => {
  const singleButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isArmed = false;
    const armTimer = setTimeout(() => {
      isArmed = true;
      if (matchedMembers.length === 1) {
        singleButtonRef.current?.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        if (isArmed && matchedMembers.length === 1) {
          e.preventDefault();
          soundEffects.playWhistle();
          onSelectMember(matchedMembers[0]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(armTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, matchedMembers, onSelectMember, onClose]);

  if (!isOpen) return null;

  const currentKeysSet = new Set<string>();
  currentPlayers.forEach((p) => {
    if (p.masterMemberId) {
      currentKeysSet.add(`id__${p.masterMemberId}`);
    }
    currentKeysSet.add(`${p.name.trim().toLowerCase()}__${p.gender}__${p.tier}`);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  전체 회원 검색 결과
                </h3>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {matchedMembers.length}명
                </span>
              </div>
              <p className="text-xs text-slate-400">
                '{searchName}' 관련 회원 {matchedMembers.length}명을 찾았습니다
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="p-4 space-y-2.5 max-h-80 overflow-y-auto">
          <p className="text-xs text-slate-300">
            {matchedMembers.length === 1 ? (
              <span>
                일치하는 회원이 1명입니다. <strong>[선택 (Enter)]</strong> 버튼을 누르거나 <strong>Enter(다음)</strong>를 누르면 바로 추가됩니다:
              </span>
            ) : (
              <span>
                선택할 회원의 <strong>[선택]</strong> 버튼을 누르면 해당 성별·급수로 오늘 참가자에 추가됩니다:
              </span>
            )}
          </p>

          <div className="space-y-2">
            {matchedMembers.map((member) => {
              const tierMeta = TIER_LABELS[member.tier] || TIER_LABELS.Beginner;
              const isAlreadyPlaying =
                currentKeysSet.has(`id__${member.id}`) ||
                currentKeysSet.has(
                  `${member.name.trim().toLowerCase()}__${member.gender}__${member.tier}`
                );
              const isOnlyMember = matchedMembers.length === 1;

              return (
                <div
                  key={member.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                    isAlreadyPlaying
                      ? 'bg-slate-950/40 border-slate-800/80 opacity-70'
                      : isOnlyMember
                      ? 'bg-slate-950/90 border-emerald-500/70 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/30'
                      : 'bg-slate-950/70 border-slate-800 hover:border-emerald-500/50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span
                      className={`text-sm font-bold truncate ${
                        member.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                      }`}
                    >
                      {member.name}
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
                      className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border ${tierMeta.bg} ${tierMeta.color}`}
                    >
                      {tierMeta.short}
                    </span>
                    {isAlreadyPlaying && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        오늘 참가 중
                      </span>
                    )}
                  </div>

                  <button
                    ref={isOnlyMember ? singleButtonRef : undefined}
                    type="button"
                    autoFocus={isOnlyMember}
                    onClick={() => {
                      soundEffects.playWhistle();
                      onSelectMember(member);
                    }}
                    className={`px-3.5 py-1.5 font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                      isAlreadyPlaying
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        : isOnlyMember
                        ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-md shadow-emerald-500/30 active:scale-95 ring-2 ring-emerald-300 ring-offset-2 ring-offset-slate-900'
                        : 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-sm shadow-emerald-500/20 active:scale-95'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isOnlyMember ? '선택 (Enter)' : '선택'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
