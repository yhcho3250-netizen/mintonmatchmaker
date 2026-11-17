import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PreparedBackupEntry {
  fileName: string;
  jsonContent: string;
  createdAt: number;
}

export interface ServerBackupSlot {
  id: string;
  fileName: string;
  createdAt: number;
  memberCount: number;
  playerCount: number;
  jsonContent: string;
}

const preparedBackups = new Map<string, PreparedBackupEntry>();
const BACKUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SLOTS_FILE_PATH = path.join(__dirname, '.minton_backup_slots.json');
const MAX_BACKUP_SLOTS = 20;

function loadBackupSlotsFromDisk(): ServerBackupSlot[] {
  try {
    if (fs.existsSync(SLOTS_FILE_PATH)) {
      const raw = fs.readFileSync(SLOTS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function saveBackupSlotsToDisk(slots: ServerBackupSlot[]): void {
  try {
    fs.writeFileSync(SLOTS_FILE_PATH, JSON.stringify(slots, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

let backupSlots: ServerBackupSlot[] = loadBackupSlotsFromDisk();

function cleanupExpiredBackups(): void {
  const now = Date.now();
  preparedBackups.forEach((entry, key) => {
    if (now - entry.createdAt > BACKUP_TTL_MS) {
      preparedBackups.delete(key);
    }
  });
}

function sanitizeFileName(rawName: unknown): string {
  const fallbackDate = new Date().toISOString().slice(0, 10);
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return `민턴매치메이커_기기내부데이터_${fallbackDate}.json`;
  }
  const cleaned = rawName.trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;
}

function sendAttachmentDownload(
  res: express.Response,
  fileName: string,
  jsonContent: string
): void {
  const safeName = sanitizeFileName(fileName);
  const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, '_') || 'minton_backup.json';
  const encodedName = encodeURIComponent(safeName);
  const buffer = Buffer.from(jsonContent, 'utf-8');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`
  );
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(buffer);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // 1) Prepare backup download & external browser save page URL
  app.post('/api/backup-prepare', (req, res) => {
    try {
      cleanupExpiredBackups();
      const fileName = sanitizeFileName(req.body?.fileName);
      const jsonContent =
        typeof req.body?.jsonContent === 'string'
          ? req.body.jsonContent
          : JSON.stringify(req.body?.jsonContent ?? {}, null, 2);

      const token = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      preparedBackups.set(token, {
        fileName,
        jsonContent,
        createdAt: Date.now(),
      });

      // Also save or update in backupSlots so APK users always have an instant in-app backup copy
      if (req.body?.saveSlot !== false) {
        let memberCount = 0;
        let playerCount = 0;
        try {
          const parsed = JSON.parse(jsonContent);
          const dataObj = parsed?.data || parsed;
          const members = dataObj?.minton_matchmaker_master_members_v1;
          const players = dataObj?.minton_matchmaker_players_v1;
          if (Array.isArray(members)) memberCount = members.length;
          if (Array.isArray(players)) playerCount = players.length;
        } catch {
          // ignore
        }

        const newSlot: ServerBackupSlot = {
          id: token,
          fileName,
          createdAt: Date.now(),
          memberCount,
          playerCount,
          jsonContent,
        };
        backupSlots = [newSlot, ...backupSlots.filter((s) => s.fileName !== fileName)].slice(
          0,
          MAX_BACKUP_SLOTS
        );
        saveBackupSlotsToDisk(backupSlots);
      }

      res.json({
        success: true,
        token,
        fileName,
        downloadPath: `/api/backup-download/${token}/${encodeURIComponent(fileName)}`,
        browserSavePath: `/api/backup-browser-save/${token}`,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to prepare backup download.' });
    }
  });

  // 2) External Browser Save Page (Content-Type: text/html)
  // When opened via median.window.open(url, 'external'), this opens in Chrome / Samsung Internet
  // and immediately triggers the browser's native Save File dialog without Android ACTION_VIEW errors!
  app.get('/api/backup-browser-save/:token', (req, res) => {
    cleanupExpiredBackups();
    const token = req.params.token;
    const entry =
      preparedBackups.get(token) || backupSlots.find((s) => s.id === token);
    if (!entry) {
      res
        .status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>백업 만료</title></head><body style="background:#0f172a;color:#fff;font-family:sans-serif;padding:24px;text-align:center;"><h3>백업 링크가 만료되었습니다. 앱에서 다시 시도해주세요.</h3></body></html>'
        );
      return;
    }

    const safeFileName = sanitizeFileName(entry.fileName);
    const base64Json = Buffer.from(entry.jsonContent, 'utf-8').toString('base64');

    const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>민턴 매치메이커 - 기기 파일 저장</title>
  <style>
    body {
      margin: 0;
      padding: 24px 16px;
      background: #020617;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
      text-align: center;
    }
    h2 { margin: 0 0 6px; font-size: 17px; color: #fff; }
    p { margin: 0 0 14px; font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .filename {
      background: #020617;
      border: 1px solid #475569;
      border-radius: 10px;
      padding: 9px 12px;
      font-family: monospace;
      font-size: 12px;
      color: #e2e8f0;
      word-break: break-all;
      margin-bottom: 16px;
    }
    .btn {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 12px 16px;
      border-radius: 12px;
      border: none;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      margin-bottom: 8px;
      text-decoration: none;
    }
    .btn-primary {
      background: #a855f7;
      color: #ffffff;
    }
    .btn-secondary {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    .status {
      font-size: 12px;
      color: #34d399;
      margin-top: 10px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2 id="pageTitle">민턴 매치메이커 기기 파일 저장</h2>
    <p id="pageDesc">백업 파일(.json)을 기기에 저장하거나 다른 앱으로 직접 전송합니다.</p>
    <div class="filename" id="fname"></div>
    <button type="button" class="btn btn-primary" id="shareBtn">다른 앱(카카오톡·메모장 등)으로 .json 파일 공유</button>
    <button type="button" class="btn btn-secondary" id="dlBtn">기기 다운로드 폴더에 파일 저장 (.json)</button>
    <div class="status" id="statusMsg">원하시는 항목을 터치해주세요.</div>
  </div>
  <script>
    (function() {
      var fileName = ${JSON.stringify(safeFileName)};
      var base64Data = ${JSON.stringify(base64Json)};
      var downloadPath = '/api/backup-download/' + ${JSON.stringify(token)} + '/' + encodeURIComponent(fileName);
      document.getElementById('fname').textContent = fileName;

      function b64ToUtf8(b64) {
        var binString = atob(b64);
        var bytes = new Uint8Array(binString.length);
        for (var i = 0; i < binString.length; i++) {
          bytes[i] = binString.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
      }

      var jsonText = b64ToUtf8(base64Data);

      function triggerDownload() {
        try {
          var blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
          document.getElementById('statusMsg').textContent = '파일 저장이 실행되었습니다. 완료 후 앱으로 돌아가세요.';
        } catch (e) {
          window.location.href = downloadPath;
        }
      }

      function triggerShare() {
        if (navigator.share && typeof File !== 'undefined') {
          var mimeList = ['application/json', 'text/plain;charset=utf-8', 'text/plain', 'application/octet-stream'];
          var chosenFile = null;
          for (var i = 0; i < mimeList.length; i++) {
            try {
              var f = new File([jsonText], fileName, { type: mimeList[i] });
              if (!navigator.canShare || navigator.canShare({ files: [f] })) {
                chosenFile = f;
                break;
              }
            } catch (e) {}
          }
          if (!chosenFile) {
            try {
              chosenFile = new File([jsonText], fileName, { type: 'application/json' });
            } catch (e) {}
          }
          if (chosenFile) {
            navigator.share({ files: [chosenFile] }).then(function() {
              document.getElementById('statusMsg').textContent = '.json 백업 파일 공유가 완료되었습니다.';
            }).catch(function(err) {
              if (err && err.name === 'AbortError') return;
              navigator.share({ files: [chosenFile], title: fileName }).catch(function() {
                triggerDownload();
              });
            });
            return;
          }
        }
        triggerDownload();
      }

      document.getElementById('dlBtn').addEventListener('click', triggerDownload);
      document.getElementById('shareBtn').addEventListener('click', triggerShare);

      var params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'share') {
        document.getElementById('pageTitle').textContent = '백업 파일(.json) 다른 앱으로 공유';
        document.getElementById('pageDesc').textContent = '위 보라색 버튼을 터치하면 카카오톡·메모장 등으로 .json 파일 자체가 바로 전송됩니다.';
        document.getElementById('statusMsg').textContent = '위 [.json 파일 공유] 버튼을 터치해주세요.';
      } else {
        document.getElementById('dlBtn').className = 'btn btn-primary';
        document.getElementById('shareBtn').className = 'btn btn-secondary';
        document.getElementById('statusMsg').textContent = '파일 저장창을 실행 중입니다...';
        setTimeout(triggerDownload, 250);
      }
    })();
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  });

  // 3) In-app Server Backup Slots API (allows instant 1-tap save & restore inside APK without external file viewer apps)
  app.get('/api/backup-slots', (_req, res) => {
    const summaries = backupSlots.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      createdAt: s.createdAt,
      memberCount: s.memberCount,
      playerCount: s.playerCount,
    }));
    res.json({ success: true, slots: summaries });
  });

  app.get('/api/backup-slots/:id', (req, res) => {
    const slot = backupSlots.find((s) => s.id === req.params.id);
    if (!slot) {
      res.status(404).json({ success: false, message: '저장된 백업을 찾을 수 없습니다.' });
      return;
    }
    res.json({ success: true, slot });
  });

  app.delete('/api/backup-slots/:id', (req, res) => {
    backupSlots = backupSlots.filter((s) => s.id !== req.params.id);
    saveBackupSlotsToDisk(backupSlots);
    res.json({ success: true });
  });

  // 4) Direct HTTP GET/POST download endpoints
  app.get('/api/backup-download/:token/:fileName', (req, res) => {
    cleanupExpiredBackups();
    const token = req.params.token;
    const entry =
      preparedBackups.get(token) || backupSlots.find((s) => s.id === token);
    if (!entry) {
      res.status(404).send('Backup download link expired or not found.');
      return;
    }
    sendAttachmentDownload(res, entry.fileName, entry.jsonContent);
  });

  app.get('/api/backup-download/:token', (req, res) => {
    cleanupExpiredBackups();
    const token = req.params.token;
    const entry =
      preparedBackups.get(token) || backupSlots.find((s) => s.id === token);
    if (!entry) {
      res.status(404).send('Backup download link expired or not found.');
      return;
    }
    sendAttachmentDownload(res, entry.fileName, entry.jsonContent);
  });

  app.post('/api/backup-download', (req, res) => {
    const fileName = sanitizeFileName(req.body?.fileName);
    const jsonContent =
      typeof req.body?.jsonContent === 'string'
        ? req.body.jsonContent
        : JSON.stringify(req.body?.jsonContent ?? {}, null, 2);
    sendAttachmentDownload(res, fileName, jsonContent);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
