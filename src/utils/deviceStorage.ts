/**
 * 기기 내부(로컬 저장소) 영구 저장 엔진 (Device Internal Local Storage)
 *
 * 브라우저 임시 캐시 증발을 방지하고 모바일/태블릿/PC 기기 내부 저장소에 데이터를 안전하게 보존하기 위해
 * 다음 3중 로컬 저장소 계층을 동시에 동기화합니다:
 * 1. Origin Private File System (OPFS: navigator.storage.getDirectory) - 기기 내부 전용 파일 시스템에 JSON 파일 직접 기록
 * 2. IndexedDB (minton_matchmaker_device_internal_db_v1) - 기기 내부 대용량 비동기 로컬 DB 저장소
 * 3. Persistent Storage Lock (navigator.storage.persist) + 동기식 로컬 캐시 미러링
 */

const IDB_NAME = 'minton_matchmaker_device_internal_db_v1';
const IDB_VERSION = 1;
const IDB_STORE_NAME = 'device_local_store';
const OPFS_FILE_NAME = 'minton_matchmaker_device_storage_v1.json';

export const DEVICE_STORAGE_KEYS = {
  PLAYERS: 'minton_matchmaker_players_v1',
  COURTS: 'minton_matchmaker_courts_v1',
  MATCHES: 'minton_matchmaker_active_matches_v1',
  QUEUED: 'minton_matchmaker_queued_matches_v1',
  HISTORY: 'minton_matchmaker_round_history_v1',
  OPTIONS: 'minton_matchmaker_options_v1',
  MEETUP_NAME: 'minton_matchmaker_meetup_name_v1',
  MASTER_MEMBERS: 'minton_matchmaker_master_members_v1',
  ARCHIVED_PLAYERS: 'minton_matchmaker_archived_players_v1',
  CONE_CHECK_ENABLED: 'minton_matchmaker_cone_check_enabled_v1',
  BULK_ATTENDANCE_CHECK_ENABLED: 'minton_matchmaker_bulk_attendance_check_enabled_v1',
  COURT_SCROLL_MODE: 'court_view_scroll_mode',
  SOUND_ENABLED: 'minton_matchmaker_sound_enabled_v1',
  WORKOUT_RECORDS: 'minton_matchmaker_workout_records_v1',
  PRE_MIDNIGHT_RECORDS: 'minton_matchmaker_pre_midnight_records_v1',
  TODAY_LIVE_STASH: 'minton_matchmaker_today_live_stash_v1',
  VIEWING_WORKOUT_DATE: 'minton_matchmaker_viewing_workout_date_v1',
  FOUR_AM_STATE: 'minton_matchmaker_four_am_state_v1',
} as const;

type DeviceStorageSnapshot = Record<string, string>;
type HydrationListener = (restoredKeys: Record<string, string>) => void;

const memoryCache: Map<string, string> = new Map();
const bootLocalSnapshot: Map<string, string> = new Map();
const userModifiedKeys: Set<string> = new Set();
const hydrationListeners: Set<HydrationListener> = new Set();

// 앱 최초 로드 시점(React 마운트 useEffect 실행 전)의 실제 localStorage 스냅샷 기록
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    for (const key of Object.values(DEVICE_STORAGE_KEYS)) {
      const val = window.localStorage.getItem(key);
      if (val !== null) {
        bootLocalSnapshot.set(key, val);
        memoryCache.set(key, val);
      }
    }
  }
} catch {
  // ignore
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let isHydrated = false;
let isPersistedGranted = false;
let opfsWriteQueue: Promise<void> = Promise.resolve();

/**
 * OS 및 기기에 영구 로컬 저장소(Persistent Device Storage) 권한 요청
 */
export async function requestDevicePersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const alreadyPersisted = await navigator.storage.persisted?.();
      if (alreadyPersisted) {
        isPersistedGranted = true;
        return true;
      }
      const granted = await navigator.storage.persist();
      isPersistedGranted = granted;
      return granted;
    }
  } catch {
    // 일부 구형 환경에서는 무시
  }
  return false;
}

export function isDeviceStoragePersistent(): boolean {
  return isPersistedGranted;
}

/**
 * 기기 내부 IndexedDB 연결 열기
 */
function openDeviceIndexedDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGetAll(): Promise<DeviceStorageSnapshot> {
  const db = await openDeviceIndexedDB();
  if (!db) return {};

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const result: DeviceStorageSnapshot = {};
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && typeof cursor.value === 'string') {
            result[cursor.key] = cursor.value;
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      cursorReq.onerror = () => resolve(result);
    } catch {
      resolve({});
    }
  });
}

async function idbSetItem(key: string, value: string): Promise<void> {
  const db = await openDeviceIndexedDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbRemoveItem(key: string): Promise<void> {
  const db = await openDeviceIndexedDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * 기기 내부 전용 파일 시스템 (OPFS: Origin Private File System) 읽기/쓰기
 */
async function opfsReadSnapshot(): Promise<DeviceStorageSnapshot> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== 'function'
    ) {
      return {};
    }
    const rootDir = await navigator.storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle(OPFS_FILE_NAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as DeviceStorageSnapshot;
    }
  } catch {
    // 파일이 아직 없거나 OPFS 미지원 환경
  }
  return {};
}

function scheduleOpfsWriteSnapshot(): void {
  opfsWriteQueue = opfsWriteQueue
    .then(async () => {
      try {
        if (
          typeof navigator === 'undefined' ||
          !navigator.storage ||
          typeof navigator.storage.getDirectory !== 'function'
        ) {
          return;
        }
        const snapshot: DeviceStorageSnapshot = {};
        memoryCache.forEach((val, key) => {
          snapshot[key] = val;
        });

        const rootDir = await navigator.storage.getDirectory();
        const fileHandle = await rootDir.getFileHandle(OPFS_FILE_NAME, { create: true });
        if (typeof (fileHandle as any).createWritable === 'function') {
          const writable = await (fileHandle as any).createWritable();
          await writable.write(JSON.stringify(snapshot));
          await writable.close();
        } else if (typeof (rootDir as any).removeEntry === 'function') {
          await (rootDir as any).removeEntry(OPFS_FILE_NAME).catch(() => {});
        }
      } catch {
        // OPFS 쓰기 실패 시 IndexedDB가 백업 역할 수행
      }
    })
    .catch(() => {});
}

/**
 * 동기식 읽기 (초기 렌더링 시 지연 없이 즉시 반환)
 */
export function getDeviceStorageItem(key: string): string | null {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) ?? null;
  }
  try {
    const val = localStorage.getItem(key);
    if (val !== null) {
      memoryCache.set(key, val);
      return val;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 기기 내부 로컬 저장소에 값 저장 (메모리 + localStorage + IndexedDB + 기기 내부 OPFS 파일 동시 기록)
 */
export function setDeviceStorageItem(key: string, value: string): void {
  const isInitialMountEmptyWrite =
    !isHydrated &&
    !bootLocalSnapshot.has(key) &&
    !userModifiedKeys.has(key) &&
    (value === '[]' || value === '{}');

  if (isHydrated || key === DEVICE_STORAGE_KEYS.FOUR_AM_STATE) {
    userModifiedKeys.add(key);
    bootLocalSnapshot.set(key, value);
  }

  memoryCache.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota or private mode fallback: memoryCache + IndexedDB + OPFS still store it
  }

  // 앱 최초 마운트 시 localStorage가 비어 있어 기본 빈 배열('[]')이 기록되는 경우에는
  // initializeDeviceStorage가 IndexedDB 백업 본을 먼저 읽어 복원할 수 있도록 덮어쓰기 보류
  if (!isInitialMountEmptyWrite) {
    void idbSetItem(key, value);
    scheduleOpfsWriteSnapshot();
  }
}

/**
 * 기기 내부 로컬 저장소에서 키 삭제
 */
export function removeDeviceStorageItem(key: string): void {
  userModifiedKeys.add(key);
  bootLocalSnapshot.delete(key);
  memoryCache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  void idbRemoveItem(key);
  scheduleOpfsWriteSnapshot();
}

/**
 * 앱 데이터 초기화 시 사용자 명시적 초기화 상태임을 저장소 엔진에 즉시 마킹
 */
export function markKeysAsExplicitlyReset(keys: string[]): void {
  for (const key of keys) {
    userModifiedKeys.add(key);
    const cur = memoryCache.get(key);
    if (cur !== undefined) {
      bootLocalSnapshot.set(key, cur);
    }
  }
}

/**
 * 앱 시작 시 기기 내부 저장소(IndexedDB + OPFS 파일 시스템)와 동기화 및 복원
 * - localStorage가 브라우저에 의해 증발(null)되었을 때 기기 내부 DB(IndexedDB/OPFS)에 보존된 데이터를 즉시 복구합니다.
 * - 사용자가 [전체 완전 초기화]를 실행하여 명시적으로 빈 배열('[]'/'{}')을 저장한 경우에는 이전 데이터를 덮어쓰지 않고 초기화된 기본 상태를 유지합니다.
 * - 단, [전체 회원](MASTER_MEMBERS) 명부는 항상 안전하게 복원 및 보존됩니다.
 */
export async function initializeDeviceStorage(): Promise<Record<string, string>> {
  void requestDevicePersistentStorage();

  const allKnownKeys = Object.values(DEVICE_STORAGE_KEYS);

  // 1. 현재 localStorage 값을 메모리 캐시에 적재
  for (const key of allKnownKeys) {
    try {
      const localVal = localStorage.getItem(key);
      if (localVal !== null) {
        memoryCache.set(key, localVal);
      }
    } catch {
      // ignore
    }
  }

  // 2. 기기 내부 IndexedDB 및 OPFS 파일 시스템에서 저장된 스냅샷 로드
  const [idbSnapshot, opfsSnapshot] = await Promise.all([
    idbGetAll(),
    opfsReadSnapshot(),
  ]);

  const mergedDeviceData: Record<string, string> = {
    ...opfsSnapshot,
    ...idbSnapshot,
  };

  const restoredForApp: Record<string, string> = {};

  for (const key of allKnownKeys) {
    const deviceVal = mergedDeviceData[key];
    const currentVal = memoryCache.get(key);
    const bootVal = bootLocalSnapshot.get(key);
    const wasExplicitlyModified = userModifiedKeys.has(key);

    if (deviceVal !== undefined) {
      const isPersistentArchiveKey =
        key === DEVICE_STORAGE_KEYS.MASTER_MEMBERS ||
        key === DEVICE_STORAGE_KEYS.WORKOUT_RECORDS ||
        key === DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS;
      const isCurrentEmpty =
        currentVal === undefined ||
        currentVal === null ||
        currentVal === '[]' ||
        currentVal === '{}';
      const isDeviceNonEmpty =
        deviceVal !== '[]' && deviceVal !== '{}' && deviceVal.trim() !== '';

      // 복원 조건:
      // 1) 전체 회원(MASTER_MEMBERS) 및 1개월 운동 기록(WORKOUT_RECORDS)은 현재 값이 비어있고 기기 내부 저장소에 데이터가 있으면 무조건 복원
      // 2) 일반 세션 데이터는 앱 시작 시점에 localStorage 키가 아예 없었을 때(bootVal === undefined)만 복원
      //    (전체 완전 초기화로 '[]' 또는 '{}'가 명시적으로 저장된 경우에는 이전 데이터로 되살리지 않음)
      const shouldRestore =
        !wasExplicitlyModified &&
        isDeviceNonEmpty &&
        currentVal !== deviceVal &&
        (isPersistentArchiveKey ? isCurrentEmpty : bootVal === undefined);

      if (shouldRestore) {
        memoryCache.set(key, deviceVal);
        bootLocalSnapshot.set(key, deviceVal);
        try {
          localStorage.setItem(key, deviceVal);
        } catch {
          // ignore
        }
        restoredForApp[key] = deviceVal;
      } else if (currentVal !== undefined && currentVal !== deviceVal) {
        // 현재 메모리/로컬 값을 기기 내부 DB에 최신화 (초기화된 빈 배열 포함)
        void idbSetItem(key, currentVal);
      }
    } else if (currentVal !== undefined) {
      // 기기 내부 DB에 아직 없던 기존 데이터를 기기 내부 DB로 마이그레이션 저장
      void idbSetItem(key, currentVal);
    }
  }

  scheduleOpfsWriteSnapshot();
  isHydrated = true;

  if (Object.keys(restoredForApp).length > 0) {
    hydrationListeners.forEach((listener) => {
      try {
        listener(restoredKeysWithFallback(restoredForApp));
      } catch {
        // ignore
      }
    });
  }

  return restoredForApp;
}

function restoredKeysWithFallback(keys: Record<string, string>): Record<string, string> {
  return keys;
}

/**
 * 기기 내부 저장소 복원/변경 이벤트 구독
 */
export function subscribeDeviceStorageHydration(listener: HydrationListener): () => void {
  hydrationListeners.add(listener);
  return () => {
    hydrationListeners.delete(listener);
  };
}

export function isDeviceStorageHydrated(): boolean {
  return isHydrated;
}

function formatLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentFourAmBoundaryKey(now: Date = new Date()): string {
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
  return formatLocalDateString(boundary);
}

const VALID_TIERS = new Set(['S', 'A', 'B', 'C', 'D', 'Beginner']);

function sanitizeMasterMembersArray(rawList: unknown[]): Array<{
  id: string;
  name: string;
  gender: 'M' | 'F';
  tier: 'S' | 'A' | 'B' | 'C' | 'D' | 'Beginner';
  registeredAt: number;
}> {
  const result: Array<{
    id: string;
    name: string;
    gender: 'M' | 'F';
    tier: 'S' | 'A' | 'B' | 'C' | 'D' | 'Beginner';
    registeredAt: number;
  }> = [];
  const usedIds = new Set<string>();
  const usedCompositeKeys = new Set<string>();
  const nowMs = Date.now();

  rawList.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!rawName) return;

    const gender: 'M' | 'F' = obj.gender === 'F' ? 'F' : 'M';
    const rawTier = typeof obj.tier === 'string' ? obj.tier.trim() : 'C';
    const tier = (VALID_TIERS.has(rawTier) ? rawTier : 'C') as
      | 'S'
      | 'A'
      | 'B'
      | 'C'
      | 'D'
      | 'Beginner';

    const compositeKey = `${rawName.toLowerCase()}__${gender}__${tier}`;
    if (usedCompositeKeys.has(compositeKey)) return;
    usedCompositeKeys.add(compositeKey);

    let id =
      typeof obj.id === 'string' && obj.id.trim().length > 0
        ? obj.id.trim()
        : `master_${nowMs}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
    if (usedIds.has(id)) {
      id = `${id}_${idx}_${Math.random().toString(36).slice(2, 5)}`;
    }
    usedIds.add(id);

    const registeredAt =
      typeof obj.registeredAt === 'number' && Number.isFinite(obj.registeredAt)
        ? obj.registeredAt
        : nowMs + idx;

    result.push({
      id,
      name: rawName,
      gender,
      tier,
      registeredAt,
    });
  });

  return result.sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, 'ko');
    if (nameDiff !== 0) return nameDiff;
    const genderDiff = a.gender.localeCompare(b.gender);
    if (genderDiff !== 0) return genderDiff;
    return a.tier.localeCompare(b.tier);
  });
}

/**
 * 백업 JSON 페이로드 생성 (테스트 및 파일 내보내기 공용)
 */
export function buildDeviceBackupPayload(
  overrides?: Partial<Record<string, unknown>>
): {
  app: string;
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
} {
  const dataMap: Record<string, unknown> = {};
  const arrayKeys = new Set<string>([
    DEVICE_STORAGE_KEYS.PLAYERS,
    DEVICE_STORAGE_KEYS.COURTS,
    DEVICE_STORAGE_KEYS.MATCHES,
    DEVICE_STORAGE_KEYS.QUEUED,
    DEVICE_STORAGE_KEYS.HISTORY,
    DEVICE_STORAGE_KEYS.MASTER_MEMBERS,
  ]);
  const objectKeys = new Set<string>([
    DEVICE_STORAGE_KEYS.ARCHIVED_PLAYERS,
    DEVICE_STORAGE_KEYS.WORKOUT_RECORDS,
    DEVICE_STORAGE_KEYS.PRE_MIDNIGHT_RECORDS,
  ]);
  const nullableKeys = new Set<string>([
    DEVICE_STORAGE_KEYS.TODAY_LIVE_STASH,
    DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE,
  ]);

  for (const key of Object.values(DEVICE_STORAGE_KEYS)) {
    if (overrides && key in overrides && overrides[key] !== undefined) {
      dataMap[key] = overrides[key];
      continue;
    }
    const raw = getDeviceStorageItem(key);
    if (raw !== null) {
      try {
        dataMap[key] = JSON.parse(raw);
      } catch {
        dataMap[key] = raw;
      }
    } else if (nullableKeys.has(key)) {
      dataMap[key] = null;
    } else if (arrayKeys.has(key)) {
      dataMap[key] = [];
    } else if (objectKeys.has(key)) {
      dataMap[key] = {};
    }
  }

  return {
    app: 'MintonMatchMaker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: dataMap,
  };
}

export function getDefaultBackupFileName(date: Date = new Date()): string {
  const dateStr = formatLocalDateString(date);
  return `민턴매치메이커_기기내부데이터_${dateStr}.json`;
}

function normalizeJsonFileName(customFileName?: string): string {
  if (!customFileName || !customFileName.trim()) {
    return getDefaultBackupFileName(new Date());
  }
  const cleaned = customFileName.trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;
}

export function isMedianOrAndroidWebView(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return Boolean(
    w.median ||
      w.gonative ||
      /median|gonative|;\s*wv\b|Version\/\d+\.\d+\s+Chrome\//i.test(ua)
  );
}

export interface DeviceBackupSlotSummary {
  id: string;
  fileName: string;
  createdAt: number;
  memberCount: number;
  playerCount: number;
  jsonContent?: string;
}

export type SavedBackupSlotMeta = DeviceBackupSlotSummary;

const LOCAL_BACKUP_SLOTS_KEY = 'minton_matchmaker_internal_backup_slots_v1';
const MAX_LOCAL_SLOTS = 15;

function readLocalBackupSlots(): DeviceBackupSlotSummary[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOCAL_BACKUP_SLOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalBackupSlots(slots: DeviceBackupSlotSummary[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = slots.slice(0, MAX_LOCAL_SLOTS);
    const serialized = JSON.stringify(trimmed);
    localStorage.setItem(LOCAL_BACKUP_SLOTS_KEY, serialized);
    void idbSetItem(LOCAL_BACKUP_SLOTS_KEY, serialized);
  } catch {
    // ignore
  }
}

function saveSlotLocally(fileName: string, jsonString: string, token?: string): DeviceBackupSlotSummary {
  let memberCount = 0;
  let playerCount = 0;
  try {
    const parsed = JSON.parse(jsonString);
    const dataObj = parsed?.data || parsed;
    const members = dataObj?.[DEVICE_STORAGE_KEYS.MASTER_MEMBERS];
    const players = dataObj?.[DEVICE_STORAGE_KEYS.PLAYERS];
    if (Array.isArray(members)) memberCount = members.length;
    if (Array.isArray(players)) playerCount = players.length;
  } catch {
    // ignore
  }

  const slot: DeviceBackupSlotSummary = {
    id: token || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    createdAt: Date.now(),
    memberCount,
    playerCount,
    jsonContent: jsonString,
  };

  const existing = readLocalBackupSlots().filter(
    (s) => s.id !== slot.id && s.fileName !== slot.fileName
  );
  writeLocalBackupSlots([slot, ...existing]);
  return slot;
}

async function prepareServerBackupUrls(
  fileName: string,
  jsonString: string
): Promise<{
  token: string;
  downloadUrl: string;
  browserSaveUrl: string;
} | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const baseOrigin =
      window.location?.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '';
    const res = await fetch(`${baseOrigin}/api/backup-prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, jsonContent: jsonString, saveSlot: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.downloadPath === 'string' && typeof data.token === 'string') {
      const browserPath =
        typeof data.browserSavePath === 'string'
          ? data.browserSavePath
          : `/api/backup-browser-save/${data.token}`;
      return {
        token: data.token,
        downloadUrl: `${baseOrigin}${data.downloadPath}`,
        browserSaveUrl: `${baseOrigin}${browserPath}`,
      };
    }
  } catch {
    // ignore network/offline errors
  }
  return null;
}

/**
 * 앱 내부 백업 보관함에 즉시 저장 (APK 권한이나 외부 파일 열기 앱 없이도 기기+서버에 100% 안전 보관)
 */
export async function saveBackupToAppSlot(
  customFileName?: string,
  overrides?: Partial<Record<string, unknown>>
): Promise<DeviceBackupSlotSummary & { success: boolean; slot: DeviceBackupSlotSummary }> {
  const payload = buildDeviceBackupPayload(overrides);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = normalizeJsonFileName(customFileName);

  const prepared = await prepareServerBackupUrls(fileName, jsonString);
  const slot = saveSlotLocally(fileName, jsonString, prepared?.token);
  return { ...slot, success: true, slot };
}

/**
 * 저장된 앱 내부 백업 보관함 목록 조회 (서버 보관함 + 기기 로컬 보관함 통합)
 */
export async function fetchAppBackupSlots(): Promise<DeviceBackupSlotSummary[]> {
  const localSlots = readLocalBackupSlots();
  const mergedMap = new Map<string, DeviceBackupSlotSummary>();
  localSlots.forEach((s) => mergedMap.set(s.fileName, s));

  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const baseOrigin =
        window.location?.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '';
      const res = await fetch(`${baseOrigin}/api/backup-slots`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.slots)) {
          data.slots.forEach((srvSlot: DeviceBackupSlotSummary) => {
            const existing = mergedMap.get(srvSlot.fileName);
            if (!existing || srvSlot.createdAt >= existing.createdAt) {
              mergedMap.set(srvSlot.fileName, {
                ...srvSlot,
                jsonContent: existing?.jsonContent,
              });
            }
          });
        }
      }
    } catch {
      // ignore offline
    }
  }

  return Array.from(mergedMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 앱 내부 백업 보관함 슬롯의 JSON 텍스트 가져오기
 */
export async function loadBackupSlotJsonText(
  slotOrId: DeviceBackupSlotSummary | string
): Promise<string | null> {
  const slotId = typeof slotOrId === 'string' ? slotOrId : slotOrId.id;
  const slotFileName = typeof slotOrId === 'string' ? undefined : slotOrId.fileName;

  if (typeof slotOrId !== 'string' && slotOrId.jsonContent) {
    return slotOrId.jsonContent;
  }
  const localMatch = readLocalBackupSlots().find(
    (s) => s.id === slotId || (slotFileName && s.fileName === slotFileName)
  );
  if (localMatch?.jsonContent) {
    return localMatch.jsonContent;
  }
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const baseOrigin =
        window.location?.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '';
      const res = await fetch(`${baseOrigin}/api/backup-slots/${encodeURIComponent(slotId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.slot?.jsonContent) {
          return data.slot.jsonContent as string;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 앱 내부 백업 보관함 슬롯 삭제
 */
export async function deleteAppBackupSlot(
  slotOrId: DeviceBackupSlotSummary | string
): Promise<void> {
  const slotId = typeof slotOrId === 'string' ? slotOrId : slotOrId.id;
  const slotFileName = typeof slotOrId === 'string' ? undefined : slotOrId.fileName;

  const remaining = readLocalBackupSlots().filter(
    (s) => s.id !== slotId && (!slotFileName || s.fileName !== slotFileName)
  );
  writeLocalBackupSlots(remaining);

  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const baseOrigin =
        window.location?.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '';
      await fetch(`${baseOrigin}/api/backup-slots/${encodeURIComponent(slotId)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Median.co APK / Android WebView에서 외부 시스템 브라우저(Chrome / 삼성 인터넷)로 저장 페이지 열기
 * - APK 내부 FileDownloader가 .json 파일에 대해 ACTION_VIEW('이 파일을 열 수 있는 앱을 찾을 수 없습니다.')를 띄우는 현상을 원천 방지하고,
 *   정상 작동하는 휴대폰 브라우저 저장창을 직접 실행합니다.
 */
function openUrlInExternalSystemBrowser(targetHttpsUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;

  // 1) Median.co / GoNative 공식 외부 브라우저 호출 브릿지
  try {
    if (typeof w?.median?.window?.open === 'function') {
      w.median.window.open(targetHttpsUrl, 'external');
      return true;
    }
    if (typeof w?.gonative?.window?.open === 'function') {
      w.gonative.window.open(targetHttpsUrl, 'external');
      return true;
    }
  } catch {
    // fallback below
  }

  // 2) Android Intent 스킴으로 외부 브라우저(Chrome / 기본 브라우저) 실행
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (/Android/i.test(ua) && typeof document !== 'undefined') {
      const parsedUrl = new URL(targetHttpsUrl);
      const scheme = parsedUrl.protocol.replace(':', '');
      const hostAndPath = `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`;
      const intentUrl = `intent://${hostAndPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
      const a = document.createElement('a');
      a.href = intentUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }
  } catch {
    // fallback below
  }

  return false;
}

/**
 * 기기 내부 파일로 백업 저장 (Median.co APK / Android WebView / 모바일 / 태블릿 / PC 완벽 호환)
 */
export async function exportDataToDeviceFile(
  customFileName?: string,
  overrides?: Partial<Record<string, unknown>>
): Promise<boolean> {
  const payload = buildDeviceBackupPayload(overrides);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = normalizeJsonFileName(customFileName);

  // 항상 앱 내부 백업 보관함(로컬+서버)에 먼저 저장하여 어떠한 경우에도 데이터가 안전하게 보존되도록 보장
  const prepared = await prepareServerBackupUrls(fileName, jsonString);
  saveSlotLocally(fileName, jsonString, prepared?.token);

  const isTopLevelWindow = (() => {
    try {
      return typeof window !== 'undefined' && window.self === window.top;
    } catch {
      return false;
    }
  })();

  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  const inMedianOrWebView = isMedianOrAndroidWebView();

  // 1) PC/데스크톱 최상위 브라우저에서 File System Access API 지원 시 폴더 직접 선택 저장 창 실행
  if (
    !inMedianOrWebView &&
    isTopLevelWindow &&
    w &&
    typeof w.showSaveFilePicker === 'function'
  ) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'MintonMatchMaker 기기 내부 저장 파일 (.json)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return false;
      }
      // Fallback below
    }
  }

  // 2) Median.co (GoNative) APK 또는 Android WebView 환경:
  //    APK 내부에서 .json 파일을 직접 열려고(ACTION_VIEW) 하면 안드로이드가 "이 파일을 열 수 있는 앱을 찾을 수 없습니다." 오류를 띄우므로,
  //    (A) open: false 옵션으로 조용히 다운로드하거나,
  //    (B) 외부 브라우저(Chrome/삼성 인터넷) 저장 전용 페이지(/api/backup-browser-save/:token)를 열어 브라우저 저장창을 실행합니다.
  if (inMedianOrWebView) {
    if (prepared?.browserSaveUrl) {
      if (openUrlInExternalSystemBrowser(prepared.browserSaveUrl)) {
        return true;
      }
    }
    if (prepared?.downloadUrl) {
      try {
        if (w?.median?.share?.downloadFile) {
          w.median.share.downloadFile({
            url: prepared.downloadUrl,
            filename: fileName,
            open: false,
          });
          return true;
        }
        if (w?.gonative?.share?.downloadFile) {
          w.gonative.share.downloadFile({
            url: prepared.downloadUrl,
            filename: fileName,
            open: false,
          });
          return true;
        }
      } catch {
        // ignore
      }
    }
    return true;
  }

  // 3) 일반 모바일/태블릿/PC 브라우저 다운로드
  try {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return true;
    }

    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

/**
 * 공유 가능한 백업 File 객체 후보 생성
 * - iOS Safari 등은 .json (application/json) 파일 공유를 허용합니다.
 * - Android Chromium (Chrome, 삼성 인터넷, Android WebView)은 내부 보안 허용 목록(FILE_TYPES) 정책상
 *   .json 확장자를 차단(NotAllowedError)하고 .txt (text/plain) 확장자만 파일 첨부 공유를 허용하므로,
 *   .json 후보가 거부되면 즉시 .txt (내부 데이터는 100% 동일한 JSON) 파일 후보로 공유 시트를 실행합니다.
 */
function createShareableBackupFileCandidates(jsonString: string, fileName: string): File[] {
  if (typeof File === 'undefined') return [];
  const candidates: File[] = [];
  const baseName = fileName.replace(/\.json$/i, '');

  const specs: Array<{ name: string; type: string }> = [
    { name: fileName, type: 'application/json' },
    { name: `${baseName}.txt`, type: 'text/plain' },
    { name: `${fileName}.txt`, type: 'text/plain' },
    { name: fileName, type: 'text/plain' },
  ];

  for (const spec of specs) {
    try {
      candidates.push(new File([jsonString], spec.name, { type: spec.type }));
    } catch {
      // ignore
    }
  }
  return candidates;
}

/**
 * 핸드폰/태블릿 공유 시트 열기 (카톡, 메일, 메모장 등 공유 창을 앱 내에서 바로 표시)
 * - 절대로 외부 브라우저(openUrlInExternalSystemBrowser)를 열지 않습니다.
 * - 1순위: Web Share API로 백업 파일 자체를 첨부하여 공유 시트 호출 (.json 시도 후 Chromium 차단 시 .txt 파일로 즉시 공유)
 * - 2순위: Median.co APK 네이티브 공유 브릿지(median.share.sharePage) 또는 Android ACTION_SEND 인텐트로
 *          앱 안에서 즉시 카톡·메일·메모장 공유 창 호출
 */
export async function shareDataFileOnDevice(
  customFileName?: string,
  overrides?: Partial<Record<string, unknown>>
): Promise<{ success: boolean; cancelled?: boolean; method?: string }> {
  const payload = buildDeviceBackupPayload(overrides);
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = normalizeJsonFileName(customFileName);

  // 로컬 백업 보관함에 즉시(동기) 저장하고, 서버 보관함 저장은 백그라운드로 시작 (사용자 터치 제스처 유지)
  const slot = saveSlotLocally(fileName, jsonString);
  const serverPreparePromise = prepareServerBackupUrls(fileName, jsonString);

  // 1) Web Share API로 파일 자체를 직접 공유 (사용자 제스처 동기 턴에서 즉시 실행)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const allCandidates = createShareableBackupFileCandidates(jsonString, fileName);

    // navigator.canShare 지원 시 허용되는 파일 후보들을 우선 정렬
    const orderedCandidates: File[] = [];
    if (typeof navigator.canShare === 'function') {
      for (const c of allCandidates) {
        try {
          if (navigator.canShare({ files: [c] })) {
            orderedCandidates.push(c);
          }
        } catch {
          // ignore
        }
      }
    }
    for (const c of allCandidates) {
      if (!orderedCandidates.includes(c)) {
        orderedCandidates.push(c);
      }
    }

    for (const candidateFile of orderedCandidates) {
      try {
        await navigator.share({
          files: [candidateFile],
        });
        void serverPreparePromise;
        return { success: true, method: 'web-share-file' };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        try {
          await navigator.share({
            files: [candidateFile],
            title: candidateFile.name,
          });
          void serverPreparePromise;
          return { success: true, method: 'web-share-file' };
        } catch (retryErr: any) {
          if (retryErr?.name === 'AbortError') {
            return { success: false, cancelled: true };
          }
          // NotAllowedError / TypeError 등 발생 시 다음 파일 후보(.txt 등)로 즉시 재시도
        }
      }
    }
  }

  // 2) APK WebView에서 navigator.share({ files }) 파일 첨부가 지원되지 않는 환경:
  //    외부 브라우저를 켜지 않고, 앱 내부에서 즉시 안드로이드 시스템 공유 창(카톡, 메일, 메모장 등)을 실행합니다.
  const prepared = await serverPreparePromise;
  if (prepared?.token) {
    saveSlotLocally(fileName, jsonString, prepared.token);
  }

  const directFileUrl = prepared?.downloadUrl || '';
  const w = typeof window !== 'undefined' ? (window as any) : undefined;

  // 2-A) Web Share API (텍스트/파일 다운로드창) 공유 시트
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: fileName,
        text: directFileUrl
          ? `[민턴 매치메이커 백업 파일] ${fileName} (회원 ${slot.memberCount}명 · 참가자 ${slot.playerCount}명)\n${directFileUrl}`
          : jsonString,
      });
      return { success: true, method: 'web-share-sheet' };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
    }
  }

  // 2-B) Median.co / GoNative 네이티브 공유 시트 브릿지 (외부 브라우저를 열지 않고 카톡·메일·메모장 공유 창을 즉시 표시)
  try {
    if (typeof w?.median?.share?.sharePage === 'function') {
      w.median.share.sharePage({
        url: directFileUrl || w.location?.href || '',
        text: `[민턴 매치메이커 백업] ${fileName} (회원 ${slot.memberCount}명 · 참가자 ${slot.playerCount}명)`,
      });
      return { success: true, method: 'median-share-sheet' };
    }
    if (typeof w?.gonative?.share?.sharePage === 'function') {
      w.gonative.share.sharePage({
        url: directFileUrl || w.location?.href || '',
        text: `[민턴 매치메이커 백업] ${fileName} (회원 ${slot.memberCount}명 · 참가자 ${slot.playerCount}명)`,
      });
      return { success: true, method: 'gonative-share-sheet' };
    }
  } catch {
    // fallback below
  }

  // 2-C) Android 네이티브 ACTION_SEND 공유 시트 인텐트 호출 (카톡, 메일, 메모장 공유 창 직접 실행)
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (/Android/i.test(ua) && typeof document !== 'undefined') {
      const shareBody = directFileUrl
        ? `[민턴 매치메이커 백업] ${fileName}\n${directFileUrl}`
        : jsonString;
      const intentUri = `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.SUBJECT=${encodeURIComponent(
        fileName
      )};S.android.intent.extra.TEXT=${encodeURIComponent(shareBody)};end`;
      const a = document.createElement('a');
      a.href = intentUri;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { success: true, method: 'android-intent-send' };
    }
  } catch {
    // fallback below
  }

  // 3) 데스크톱 PC 브라우저 등 공유 시트 미지원 환경에서는 파일 다운로드 실행
  const exported = await exportDataToDeviceFile(fileName, overrides);
  return { success: exported, method: 'download-fallback' };
}

/**
 * 백업 JSON 문자열을 클립보드에 복사 (APK 파일 권한이 완전히 제한된 환경에서도 100% 작동)
 */
export async function copyBackupJsonToClipboard(
  overrides?: Partial<Record<string, unknown>>
): Promise<boolean> {
  const payload = buildDeviceBackupPayload(overrides);
  const jsonString = JSON.stringify(payload, null, 2);

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(jsonString);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = jsonString;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 기기 내부 저장소 파일(.json)에서 데이터 불러오기 및 전체 메뉴 즉시 반영
 */
export function parseAndRestoreDeviceBackupJson(jsonText: string): {
  success: boolean;
  message: string;
  restoredKeys: Record<string, string>;
} {
  try {
    const cleanText = typeof jsonText === 'string' ? jsonText.replace(/^\uFEFF/, '').trim() : '';
    if (!cleanText) {
      return {
        success: false,
        message: '비어 있는 파일입니다. 올바른 JSON 백업 파일인지 확인해주세요.',
        restoredKeys: {},
      };
    }

    const parsed = JSON.parse(cleanText);
    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        message: '유효하지 않은 기기 저장소 데이터 파일입니다.',
        restoredKeys: {},
      };
    }

    const restoredKeys: Record<string, string> = {};

    const restoreFromMap = (sourceObj: Record<string, unknown>, isFullBackup: boolean) => {
      for (const targetKey of Object.values(DEVICE_STORAGE_KEYS)) {
        let matchedVal: unknown = undefined;
        let hasKeyInSource = false;

        if (targetKey in sourceObj) {
          matchedVal = sourceObj[targetKey];
          hasKeyInSource = true;
        } else {
          const suffix = targetKey.replace(/^minton_matchmaker_/, '_');
          const foundEntry = Object.entries(sourceObj).find(([k]) => k.endsWith(suffix));
          if (foundEntry) {
            matchedVal = foundEntry[1];
            hasKeyInSource = true;
          }
        }

        // Nullable keys (TODAY_LIVE_STASH, VIEWING_WORKOUT_DATE)
        if (
          targetKey === DEVICE_STORAGE_KEYS.VIEWING_WORKOUT_DATE ||
          targetKey === DEVICE_STORAGE_KEYS.TODAY_LIVE_STASH
        ) {
          if (
            matchedVal === null ||
            matchedVal === '' ||
            (isFullBackup && !hasKeyInSource)
          ) {
            removeDeviceStorageItem(targetKey);
            restoredKeys[targetKey] = '';
            continue;
          }
        }

        if (matchedVal !== undefined && matchedVal !== null) {
          if (targetKey === DEVICE_STORAGE_KEYS.MASTER_MEMBERS) {
            let parsedArr: unknown[] | null = null;
            if (Array.isArray(matchedVal)) {
              parsedArr = matchedVal;
            } else if (typeof matchedVal === 'string') {
              try {
                const p = JSON.parse(matchedVal);
                if (Array.isArray(p)) parsedArr = p;
              } catch {
                // ignore
              }
            }
            if (parsedArr !== null) {
              const sanitized = sanitizeMasterMembersArray(parsedArr);
              const val = JSON.stringify(sanitized);
              setDeviceStorageItem(targetKey, val);
              restoredKeys[targetKey] = val;
              continue;
            }
          }

          const val =
            typeof matchedVal === 'string'
              ? matchedVal
              : JSON.stringify(matchedVal);
          setDeviceStorageItem(targetKey, val);
          restoredKeys[targetKey] = val;
        }
      }
    };

    // 형태 1: 전체 백업 포맷 ({ app: 'MintonMatchMaker', data: { ... } })
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      restoreFromMap(parsed.data as Record<string, unknown>, true);
    }
    // 형태 2: 전체 회원 배열만 단독으로 저장된 파일인 경우 ([{ id, name, gender, tier }, ...])
    else if (Array.isArray(parsed)) {
      const sanitized = sanitizeMasterMembersArray(parsed);
      const val = JSON.stringify(sanitized);
      setDeviceStorageItem(DEVICE_STORAGE_KEYS.MASTER_MEMBERS, val);
      restoredKeys[DEVICE_STORAGE_KEYS.MASTER_MEMBERS] = val;
    }
    // 형태 3: { masterMembers: [...] } 또는 { members: [...] } 형태인 경우
    else if (
      Array.isArray((parsed as Record<string, unknown>).masterMembers) ||
      Array.isArray((parsed as Record<string, unknown>).members)
    ) {
      const rawArr = (
        Array.isArray((parsed as Record<string, unknown>).masterMembers)
          ? (parsed as Record<string, unknown>).masterMembers
          : (parsed as Record<string, unknown>).members
      ) as unknown[];
      const sanitized = sanitizeMasterMembersArray(rawArr);
      const val = JSON.stringify(sanitized);
      setDeviceStorageItem(DEVICE_STORAGE_KEYS.MASTER_MEMBERS, val);
      restoredKeys[DEVICE_STORAGE_KEYS.MASTER_MEMBERS] = val;
    }
    // 형태 4: 키-값 맵이 직접 저장된 파일인 경우
    else {
      const hasSessionKeys =
        DEVICE_STORAGE_KEYS.PLAYERS in parsed ||
        DEVICE_STORAGE_KEYS.COURTS in parsed ||
        DEVICE_STORAGE_KEYS.MATCHES in parsed;
      restoreFromMap(parsed as Record<string, unknown>, hasSessionKeys);
    }

    if (Object.keys(restoredKeys).length === 0) {
      return {
        success: false,
        message: '복원할 수 있는 민턴매치메이커 데이터가 파일에 포함되어 있지 않습니다.',
        restoredKeys: {},
      };
    }

    // 백업 파일에 이전 날짜의 FOUR_AM_STATE가 포함되어 있어 복원 직후 04:00 자동 초기화가 오작동하는 현상 방지
    const hasRestoredSessionOrFourAm =
      DEVICE_STORAGE_KEYS.PLAYERS in restoredKeys ||
      DEVICE_STORAGE_KEYS.COURTS in restoredKeys ||
      DEVICE_STORAGE_KEYS.MATCHES in restoredKeys ||
      DEVICE_STORAGE_KEYS.QUEUED in restoredKeys ||
      DEVICE_STORAGE_KEYS.HISTORY in restoredKeys ||
      DEVICE_STORAGE_KEYS.FOUR_AM_STATE in restoredKeys;

    if (hasRestoredSessionOrFourAm) {
      const now = new Date();
      const todayKey = formatLocalDateString(now);
      const currentBoundaryKey = getCurrentFourAmBoundaryKey(now);
      const isZeroToFour = now.getHours() >= 0 && now.getHours() < 4;
      const safeFourAmState = {
        lastCompletedBoundaryKey: currentBoundaryKey,
        snoozeUntil: null,
        modalExpiresAt: null,
        pendingBoundaryKey: null,
        pendingArchiveDate: null,
        earlyMorningBypassBoundaryKey: isZeroToFour ? todayKey : null,
      };
      const safeFourAmJson = JSON.stringify(safeFourAmState);
      setDeviceStorageItem(DEVICE_STORAGE_KEYS.FOUR_AM_STATE, safeFourAmJson);
      restoredKeys[DEVICE_STORAGE_KEYS.FOUR_AM_STATE] = safeFourAmJson;
    }

    // 구독 중인 모든 메뉴(App.tsx, PlayerManager, CourtBoardView, BulkRegisterModal 등)에 즉시 알림
    hydrationListeners.forEach((listener) => {
      try {
        listener(restoredKeys);
      } catch {
        // ignore
      }
    });

    return {
      success: true,
      message: '기기 내부 저장소 파일에서 데이터를 성공적으로 불러왔습니다.',
      restoredKeys,
    };
  } catch {
    return {
      success: false,
      message: '파일 형식을 읽을 수 없습니다. 올바른 JSON 백업 파일인지 확인해주세요.',
      restoredKeys: {},
    };
  }
}
