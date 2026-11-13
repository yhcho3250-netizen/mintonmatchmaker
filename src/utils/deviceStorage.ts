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

  if (isHydrated) {
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

/**
 * 기기 내부 파일로 백업 저장 (모바일/태블릿/PC 기기 내 파일 저장소에 .json 파일로 직접 저장)
 */
export async function exportDataToDeviceFile(customFileName?: string): Promise<boolean> {
  const payload: Record<string, unknown> = {
    app: 'MintonMatchMaker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {} as Record<string, unknown>,
  };

  const dataMap = payload.data as Record<string, unknown>;
  for (const key of Object.values(DEVICE_STORAGE_KEYS)) {
    const raw = getDeviceStorageItem(key);
    if (raw !== null) {
      try {
        dataMap[key] = JSON.parse(raw);
      } catch {
        dataMap[key] = raw;
      }
    }
  }

  const jsonString = JSON.stringify(payload, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = customFileName || `민턴매치메이커_기기내부데이터_${dateStr}.json`;

  // File System Access API 지원 기기에서는 기기 내부 폴더 직접 선택 저장 지원
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
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
      // Fallback to anchor download below
    }
  }

  // 모바일/일반 기기 내부 다운로드 폴더 저장
  try {
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
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
 * 기기 내부 저장소 파일(.json)에서 데이터 불러오기 및 전체 메뉴 즉시 반영
 */
export function parseAndRestoreDeviceBackupJson(jsonText: string): {
  success: boolean;
  message: string;
  restoredKeys: Record<string, string>;
} {
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        message: '유효하지 않은 기기 저장소 데이터 파일입니다.',
        restoredKeys: {},
      };
    }

    const restoredKeys: Record<string, string> = {};

    const restoreFromMap = (sourceObj: Record<string, unknown>) => {
      for (const targetKey of Object.values(DEVICE_STORAGE_KEYS)) {
        let matchedVal: unknown = undefined;
        if (targetKey in sourceObj && sourceObj[targetKey] !== undefined) {
          matchedVal = sourceObj[targetKey];
        } else {
          const suffix = targetKey.replace(/^minton_matchmaker_/, '_');
          const foundEntry = Object.entries(sourceObj).find(
            ([k, v]) => v !== undefined && k.endsWith(suffix)
          );
          if (foundEntry) {
            matchedVal = foundEntry[1];
          }
        }
        if (matchedVal !== undefined) {
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
    if (parsed.data && typeof parsed.data === 'object') {
      restoreFromMap(parsed.data as Record<string, unknown>);
    }
    // 형태 2: 전체 회원 배열만 단독으로 저장된 파일인 경우 ([{ id, name, gender, tier }, ...])
    else if (Array.isArray(parsed)) {
      const val = JSON.stringify(parsed);
      setDeviceStorageItem(DEVICE_STORAGE_KEYS.MASTER_MEMBERS, val);
      restoredKeys[DEVICE_STORAGE_KEYS.MASTER_MEMBERS] = val;
    }
    // 형태 3: 키-값 맵이 직접 저장된 파일인 경우
    else {
      restoreFromMap(parsed as Record<string, unknown>);
    }

    if (Object.keys(restoredKeys).length === 0) {
      return {
        success: false,
        message: '복원할 수 있는 민턴매치메이커 데이터가 파일에 포함되어 있지 않습니다.',
        restoredKeys: {},
      };
    }

    // 구독 중인 모든 메뉴(App.tsx 등)에 즉시 알림
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
