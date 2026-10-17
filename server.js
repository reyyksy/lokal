const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const SHARED_DIR = path.resolve(__dirname, 'shared');

if (!fs.existsSync(SHARED_DIR)) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString('id-ID', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function isSafePath(targetPath) {
  const relative = path.relative(SHARED_DIR, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, address: iface.address });
      }
    }
  }
  return addresses;
}

function handleUpload(req, targetDir, callback) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return callback(new Error('Bukan multipart/form-data valid'));

  const boundary = match[1] || match[2];
  const boundaryBuffer = Buffer.from('--' + boundary);
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const fullBuffer = Buffer.concat(chunks);
    let startIdx = 0;
    const parts = [];
    while (true) {
      const idx = fullBuffer.indexOf(boundaryBuffer, startIdx);
      if (idx === -1) break;
      if (startIdx !== 0) {
        let partBuffer = fullBuffer.slice(startIdx, idx);
        if (partBuffer.length >= 2 && partBuffer[partBuffer.length - 2] === 13 && partBuffer[partBuffer.length - 1] === 10) {
          partBuffer = partBuffer.slice(0, partBuffer.length - 2);
        }
        parts.push(partBuffer);
      }
      startIdx = idx + boundaryBuffer.length;
      if (fullBuffer.slice(startIdx, startIdx + 2).equals(Buffer.from('--'))) break;
      if (fullBuffer.slice(startIdx, startIdx + 2).equals(Buffer.from('\r\n'))) startIdx += 2;
    }
    let filesSaved = 0;
    for (const part of parts) {
      const headerEndIdx = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEndIdx === -1) continue;
      const headerText = part.slice(0, headerEndIdx).toString('utf8');
      const bodyBuffer = part.slice(headerEndIdx + 4);
      const filenameMatch = headerText.match(/filename="([^"]+)"/i);
      if (filenameMatch && filenameMatch[1]) {
        let filename = path.basename(filenameMatch[1].trim());
        if (!filename) continue;
        filename = filename.replace(/[<>:"/\\|?*]/g, '_');
        const destPath = path.join(targetDir, filename);
        if (isSafePath(destPath) || destPath === SHARED_DIR) {
          fs.writeFileSync(destPath, bodyBuffer);
          filesSaved++;
        }
      }
    }
    callback(null, filesSaved);
  });
  req.on('error', err => callback(err));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed', '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar', '.gz': 'application/gzip'
};

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const ICONS = {
  logo:       `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M2 10h20"/></svg>`,
  server:     `<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`,
  user:       `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  logout:     `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
  lockClosed: `<svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  folderPlus: `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" x2="12" y1="10" y2="16"/><line x1="9" x2="15" y1="13" y2="13"/></svg>`,
  upload:     `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
  uploadCloud:`<svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>`,
  search:     `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg>`,
  download:   `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  trash:      `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
  arrowUp:    `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
  folder:     `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="#3B82F6" stroke="#2563EB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="fill-opacity:.2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  fileDefault:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
  fileImage:  `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  fileVideo:  `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="5" rx="2"/><polygon points="10 9 15 12 10 15 10 9" fill="#8B5CF6"/></svg>`,
  fileAudio:  `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  fileArchive:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EC4899" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
  fileCode:   `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  filePdf:    `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>`,
  eyeOff:     `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
  shield:     `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
};

function getFileIcon(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.zip': case '.rar': case '.7z': case '.tar': case '.gz': return ICONS.fileArchive;
    case '.png': case '.jpg': case '.jpeg': case '.gif': case '.webp': case '.svg': return ICONS.fileImage;
    case '.mp4': case '.mkv': case '.webm': case '.avi': return ICONS.fileVideo;
    case '.mp3': case '.wav': case '.ogg': case '.flac': return ICONS.fileAudio;
    case '.pdf': return ICONS.filePdf;
    case '.js': case '.ts': case '.html': case '.css': case '.py': case '.json':
    case '.c': case '.cpp': case '.sh': case '.bat': return ICONS.fileCode;
    default: return ICONS.fileDefault;
  }
}

// ─── SHARED CSS ───────────────────────────────────────────────────────────────
function getBaseCss() {
  return `
    :root {
      --c-primary: #2563EB;
      --c-primary-hover: #1D4ED8;
      --c-bg: #F8FAFC;
      --c-fg: #0F172A;
      --c-card: #FFFFFF;
      --c-muted: #F1F5FD;
      --c-muted-fg: #475569;
      --c-border: #E2ECF8;
      --c-danger: #DC2626;
      --c-danger-hover: #B91C1C;
      --c-ring: rgba(37,99,235,0.25);
      --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
      --shadow-md: 0 4px 16px rgba(0,0,0,.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --c-primary: #3B82F6; --c-primary-hover: #60A5FA;
        --c-bg: #0B1120; --c-fg: #F8FAFC;
        --c-card: #1E293B; --c-muted: #182234;
        --c-muted-fg: #94A3B8; --c-border: #334155;
        --c-danger: #F87171; --c-danger-hover: #EF4444;
      }
    }
    *,::before,::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:var(--c-bg); color:var(--c-fg); line-height:1.5;
      min-height:100vh; min-height:100dvh;
    }
    .cursor-pointer{cursor:pointer}
    button,.btn{
      display:inline-flex; align-items:center; gap:7px;
      background:var(--c-primary); color:#fff; border:none;
      padding:9px 16px; min-height:42px;
      border-radius:var(--r-sm); font-family:'Poppins',sans-serif;
      font-size:.875rem; font-weight:600; text-decoration:none;
      cursor:pointer; transition:background .15s ease;
    }
    button:hover,.btn:hover{background:var(--c-primary-hover)}
    button:focus-visible,.btn:focus-visible{outline:2px solid var(--c-primary);outline-offset:2px}
    .btn-secondary{background:var(--c-muted);color:var(--c-fg);border:1px solid var(--c-border)}
    .btn-secondary:hover{background:var(--c-border)}
    input,select{
      width:100%;min-height:44px;padding:9px 14px;
      border-radius:var(--r-sm);border:1px solid var(--c-border);
      background:var(--c-bg);color:var(--c-fg);
      font-size:.9375rem;font-family:inherit;outline:none;
      transition:border-color .15s,box-shadow .15s;
    }
    input:focus,select:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px var(--c-ring)}
    label{display:block;font-size:.8125rem;font-weight:600;margin-bottom:5px}
    @media (prefers-reduced-motion:reduce){*,::before,::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  `;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function renderLoginPage({ errorMessage = '', blockedMessage = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Masuk — LAN File Explorer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
  <style>
    ${getBaseCss()}
    body{
      display:flex; align-items:center; justify-content:center;
      padding:20px env(safe-area-inset-right,20px) env(safe-area-inset-bottom,20px) env(safe-area-inset-left,20px);
    }
    .card{
      width:100%; max-width:400px;
      background:var(--c-card); border:1px solid var(--c-border);
      border-radius:var(--r-lg); padding:36px 28px;
      box-shadow:var(--shadow-md);
    }
    .card-header{text-align:center;margin-bottom:28px}
    .icon-wrap{
      width:60px; height:60px; border-radius:var(--r-md);
      background:rgba(37,99,235,.1); color:var(--c-primary);
      display:inline-flex; align-items:center; justify-content:center;
      margin-bottom:16px;
    }
    .card-header h1{
      font-family:'Poppins',sans-serif; font-size:1.25rem;
      font-weight:700; color:var(--c-fg); margin-bottom:4px;
    }
    .card-header p{font-size:.85rem; color:var(--c-muted-fg)}
    .form-group{margin-bottom:16px}
    .alert{
      padding:12px 14px; border-radius:var(--r-sm);
      margin-bottom:18px; display:flex; align-items:flex-start; gap:10px;
      font-size:.85rem;
    }
    .alert-error{
      background:rgba(220,38,38,.08);
      border:1px solid rgba(220,38,38,.2);
      color:var(--c-danger);
    }
    .btn-submit{
      width:100%; min-height:46px;
      justify-content:center; font-size:.9375rem;
    }
    .footer-note{
      margin-top:24px; padding-top:20px;
      border-top:1px solid var(--c-border);
      text-align:center; font-size:.75rem;
      color:var(--c-muted-fg); line-height:1.6;
      display:flex; align-items:center; justify-content:center; gap:6px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="icon-wrap">${ICONS.lockClosed}</div>
      <h1>Masuk ke Sistem</h1>
      <p>LAN Web File Explorer — Akses terbatas</p>
    </div>

    ${errorMessage ? `
      <div class="alert alert-error" role="alert">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${escapeHtml(errorMessage)}</span>
      </div>` : ''}

    ${blockedMessage ? `
      <div class="alert alert-error" role="alert">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        <span>${escapeHtml(blockedMessage)}</span>
      </div>` : ''}

    <form method="POST" action="/login" autocomplete="on" novalidate>
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required
               autocomplete="username" autofocus spellcheck="false">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required
               autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-submit cursor-pointer">
        Masuk
      </button>
    </form>

    <div class="footer-note">
      ${ICONS.shield}
      <span>Akses dikelola oleh administrator sistem</span>
    </div>
  </div>
</body>
</html>`;
}

// ─── 403 FORBIDDEN PAGE ───────────────────────────────────────────────────────
function render403Page(username, targetPath) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Akses Ditolak — LAN File Explorer</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Open+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${getBaseCss()}
    body{display:flex;align-items:center;justify-content:center;padding:24px;min-height:100vh}
    .box{text-align:center;max-width:440px}
    .icon-wrap{width:72px;height:72px;border-radius:18px;background:rgba(220,38,38,.1);color:var(--c-danger);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px}
    h1{font-family:'Poppins',sans-serif;font-size:1.4rem;font-weight:700;margin-bottom:8px}
    p{color:var(--c-muted-fg);font-size:.9rem;margin-bottom:6px}
    .path{font-family:monospace;background:var(--c-muted);padding:4px 10px;border-radius:6px;font-size:.85rem;margin-top:4px;display:inline-block}
    .back{margin-top:24px}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon-wrap">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
    </div>
    <h1>Akses Ditolak</h1>
    <p>Akun <strong>${escapeHtml(username)}</strong> tidak memiliki izin untuk mengakses:</p>
    <p><span class="path">${escapeHtml(targetPath || '/')}</span></p>
    <p style="margin-top:14px">Hubungi administrator sistem untuk mengubah hak akses Anda.</p>
    <div class="back">
      <a href="/" class="btn btn-secondary cursor-pointer">← Kembali</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── MAIN EXPLORER UI ─────────────────────────────────────────────────────────
function generateExplorerHtml({ currentPath, breadcrumbHtml, parentPath, items, osInfo, currentUser, userRole, canWrite }) {
  const roleLabel = {
    admin: 'Administrator', read_only: 'Hanya Baca', dir_read_only: 'Baca Terbatas',
    dir_read_write: 'Edit Terbatas', read_all_write_dir: 'Baca Semua / Edit Terbatas', blocked: 'Diblokir'
  }[userRole] || userRole;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
  <title>LAN File Explorer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    ${getBaseCss()}
    body{padding:env(safe-area-inset-top,14px) env(safe-area-inset-right,14px) env(safe-area-inset-bottom,14px) env(safe-area-inset-left,14px)}
    .wrap{max-width:1160px;margin:0 auto}

    /* Header */
    header{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-lg);padding:14px 18px;margin-bottom:14px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow-sm)}
    @media(min-width:768px){header{flex-direction:row;justify-content:space-between;align-items:center;padding:16px 24px;margin-bottom:20px}}
    .logo-area{display:flex;align-items:center;gap:12px}
    .logo-badge{width:42px;height:42px;border-radius:10px;background:rgba(37,99,235,.1);color:var(--c-primary);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .logo-titles h1{font-family:'Poppins',sans-serif;font-size:1.1rem;font-weight:700;line-height:1.2}
    .logo-meta{display:flex;align-items:center;gap:5px;font-size:.7rem;color:var(--c-muted-fg);margin-top:3px}
    .header-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    @media(max-width:767px){.header-right{width:100%}}
    .user-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;min-height:38px;border-radius:9999px;background:var(--c-muted);border:1px solid var(--c-border);font-size:.8rem;font-weight:600;flex-shrink:0}
    .role-badge{font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:9999px;background:rgba(37,99,235,.1);color:var(--c-primary)}
    .actions-wrap{display:flex;gap:8px;flex:1;justify-content:flex-end}
    @media(max-width:479px){.actions-wrap{width:100%}.actions-wrap button{flex:1;justify-content:center}}
    .btn-sm{padding:7px 13px;min-height:38px;font-size:.8rem}

    /* Card */
    .main-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow-sm)}

    /* Breadcrumb */
    .breadcrumb{padding:12px 18px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:5px;font-size:.85rem;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}
    .crumb{color:var(--c-primary);text-decoration:none;font-weight:600;padding:3px 6px;border-radius:5px;min-height:30px;display:inline-flex;align-items:center}
    .crumb:hover{background:rgba(37,99,235,.08);text-decoration:underline}
    .crumb-sep{color:var(--c-muted-fg)}

    /* Dropzone */
    .dropzone{border:2px dashed var(--c-border);border-radius:var(--r-md);padding:22px 16px;margin:14px 16px;text-align:center;background:var(--c-muted);cursor:pointer;transition:border-color .2s,background .2s;display:flex;flex-direction:column;align-items:center;gap:6px}
    .dropzone.dragover{border-color:var(--c-primary);background:rgba(37,99,235,.06)}
    .dropzone-title{font-size:.875rem;font-weight:600;color:var(--c-fg)}
    .dropzone-sub{font-size:.775rem;color:var(--c-muted-fg)}

    /* Progress */
    #progressWrap{display:none;margin:0 16px 12px;background:var(--c-muted);border-radius:99px;overflow:hidden;height:7px;border:1px solid var(--c-border)}
    #progressBar{width:0%;height:100%;background:#10B981;transition:width .15s ease}

    /* Search */
    .search-wrap{margin:0 16px 12px;position:relative}
    .search-icon{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--c-muted-fg);pointer-events:none;display:flex}
    .search-input{padding-left:38px!important}

    /* Mobile cards */
    .mobile-list{display:flex;flex-direction:column;padding:0 12px 14px;gap:9px}
    .m-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .m-card.parent-dir{background:var(--c-muted);border-style:dashed}
    .m-card-link{display:flex;align-items:center;gap:12px;flex:1;min-width:0;text-decoration:none;color:var(--c-fg)}
    .m-name{font-size:.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    .m-meta{font-size:.74rem;color:var(--c-muted-fg);margin-top:2px;display:flex;gap:6px}
    .m-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}

    /* Desktop table */
    .desktop-table{display:none;overflow-x:auto}
    @media(min-width:768px){.mobile-list{display:none}.desktop-table{display:block}}
    table{width:100%;border-collapse:collapse;font-size:.875rem;text-align:left}
    th{background:var(--c-muted);color:var(--c-muted-fg);font-weight:600;padding:11px 18px;border-bottom:1px solid var(--c-border);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
    td{padding:11px 18px;border-bottom:1px solid var(--c-border);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr.file-row:hover td{background:var(--c-muted)}
    .item-link{display:inline-flex;align-items:center;gap:10px;color:var(--c-fg);text-decoration:none;font-weight:500;word-break:break-all;transition:color .15s}
    .item-link:hover{color:var(--c-primary)}
    .muted-cell{color:var(--c-muted-fg);white-space:nowrap;font-size:.8125rem}
    .row-actions{display:flex;gap:6px;justify-content:flex-end}

    /* Action buttons */
    .icon-btn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:var(--r-sm);border:1px solid var(--c-border);background:var(--c-card);color:var(--c-fg);transition:all .15s;cursor:pointer;text-decoration:none;flex-shrink:0}
    .icon-btn:hover{background:var(--c-muted);border-color:var(--c-primary);color:var(--c-primary)}
    .icon-btn.danger:hover{background:rgba(220,38,38,.1);border-color:var(--c-danger);color:var(--c-danger)}

    /* Empty */
    .empty-state{padding:44px 16px;text-align:center;color:var(--c-muted-fg)}

    /* Toast */
    .toast{position:fixed;bottom:calc(env(safe-area-inset-bottom,16px) + 16px);right:16px;left:16px;max-width:380px;margin-left:auto;padding:13px 18px;border-radius:var(--r-md);background:#0F172A;color:#fff;font-size:.875rem;font-weight:500;box-shadow:0 10px 24px rgba(0,0,0,.18);z-index:9999;transform:translateY(120%);opacity:0;transition:transform .25s cubic-bezier(.16,1,.3,1),opacity .25s;display:flex;align-items:center;gap:10px}
    .toast.show{transform:translateY(0);opacity:1}

    /* Modal */
    .modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(3px);z-index:1000;align-items:center;justify-content:center;padding:16px}
    .modal-bg.active{display:flex}
    .modal{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-lg);width:100%;max-width:420px;padding:24px;box-shadow:var(--shadow-md)}
    .modal-title{font-family:'Poppins',sans-serif;font-size:1.1rem;font-weight:700;margin-bottom:16px}
    .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
    @media(max-width:479px){.modal-footer button{flex:1;justify-content:center}}
  </style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="logo-area">
      <div class="logo-badge">${ICONS.logo}</div>
      <div class="logo-titles">
        <h1>LAN File Explorer</h1>
        <div class="logo-meta">${ICONS.server}<span>${escapeHtml(osInfo)}</span></div>
      </div>
    </div>

    <div class="header-right">
      <div class="user-pill">
        ${ICONS.user}
        <span>${escapeHtml(currentUser)}</span>
        <span class="role-badge">${escapeHtml(roleLabel)}</span>
      </div>
      <form method="POST" action="/logout" style="margin:0">
        <button type="submit" class="btn btn-secondary btn-sm cursor-pointer" title="Keluar">
          ${ICONS.logout} <span>Keluar</span>
        </button>
      </form>

      ${canWrite ? `
      <div class="actions-wrap">
        <button class="btn btn-secondary btn-sm cursor-pointer" onclick="openFolderModal()">
          ${ICONS.folderPlus}<span>Folder Baru</span>
        </button>
        <button class="btn btn-sm cursor-pointer" onclick="document.getElementById('fileInput').click()">
          ${ICONS.upload}<span>Unggah</span>
        </button>
        <input type="file" id="fileInput" multiple style="display:none" onchange="uploadFiles(this.files)">
      </div>` : ''}
    </div>
  </header>

  <div class="main-card">
    <div class="breadcrumb">${breadcrumbHtml}</div>

    ${canWrite ? `
    <div class="dropzone cursor-pointer" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <div style="color:var(--c-primary)">${ICONS.uploadCloud}</div>
      <p class="dropzone-title">Tarik & lepas file atau ketuk untuk mengunggah</p>
      <p class="dropzone-sub">Mendukung multi-file & berbagai format</p>
    </div>
    <div id="progressWrap"><div id="progressBar"></div></div>` : ''}

    <div class="search-wrap">
      <div class="search-icon">${ICONS.search}</div>
      <input type="text" class="search-input" id="searchInput" placeholder="Cari file atau folder…" oninput="filterList()">
    </div>

    <!-- MOBILE LIST -->
    <div class="mobile-list" id="mobileList">
      ${parentPath !== null ? `
      <div class="m-card parent-dir">
        <a href="${parentPath}" class="m-card-link cursor-pointer" style="color:var(--c-muted-fg)">
          <span style="flex-shrink:0">${ICONS.arrowUp}</span>
          <div><span class="m-name">.. Kembali ke folder atas</span></div>
        </a>
      </div>` : ''}

      ${items.length === 0 ? `<div class="empty-state"><p>Folder ini kosong.</p></div>` : ''}

      ${items.map(item => {
        const iurl = (currentPath.endsWith('/') ? currentPath : currentPath + '/') + encodeURIComponent(item.name) + (item.isDirectory ? '/' : '');
        const durl = iurl.replace(/\/+$/, '') + '?download=1';
        const icon = item.isDirectory ? ICONS.folder : getFileIcon(item.name);
        const relBase = currentPath.replace(/^\/+/, '');
        const relPath = (relBase ? relBase + '/' : '') + item.name;
        return `
        <div class="m-card file-card" data-name="${escapeHtml(item.name.toLowerCase())}">
          <a href="${iurl}" class="m-card-link cursor-pointer" ${item.isDirectory ? '' : 'target="_blank"'}>
            <span style="flex-shrink:0">${icon}</span>
            <div class="m-info" style="min-width:0">
              <span class="m-name">${escapeHtml(item.name)}</span>
              <div class="m-meta"><span>${escapeHtml(item.sizeFormatted)}</span><span>•</span><span>${escapeHtml(item.mtime)}</span></div>
            </div>
          </a>
          <div class="m-actions">
            ${!item.isDirectory ? `<a href="${durl}" class="icon-btn cursor-pointer" download title="Unduh" aria-label="Unduh ${escapeHtml(item.name)}">${ICONS.download}</a>` : ''}
            ${canWrite ? `<button type="button" class="icon-btn danger cursor-pointer" onclick="delItem('${escapeHtml(relPath)}','${escapeHtml(item.name)}')" title="Hapus" aria-label="Hapus ${escapeHtml(item.name)}">${ICONS.trash}</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- DESKTOP TABLE -->
    <div class="desktop-table">
      <table>
        <thead><tr>
          <th>Nama</th><th style="width:130px">Ukuran</th>
          <th style="width:170px">Diubah</th><th style="width:120px;text-align:right">Aksi</th>
        </tr></thead>
        <tbody>
          ${parentPath !== null ? `
          <tr><td colspan="4">
            <a href="${parentPath}" class="item-link cursor-pointer" style="color:var(--c-muted-fg)">
              ${ICONS.arrowUp}<span>.. Kembali ke folder atas</span>
            </a>
          </td></tr>` : ''}
          ${items.length === 0 ? `<tr><td colspan="4" class="empty-state">Folder ini kosong.</td></tr>` : ''}
          ${items.map(item => {
            const iurl = (currentPath.endsWith('/') ? currentPath : currentPath + '/') + encodeURIComponent(item.name) + (item.isDirectory ? '/' : '');
            const durl = iurl.replace(/\/+$/, '') + '?download=1';
            const icon = item.isDirectory ? ICONS.folder : getFileIcon(item.name);
            const relBase = currentPath.replace(/^\/+/, '');
            const relPath = (relBase ? relBase + '/' : '') + item.name;
            return `
            <tr class="file-row" data-name="${escapeHtml(item.name.toLowerCase())}">
              <td><a href="${iurl}" class="item-link cursor-pointer" ${item.isDirectory ? '' : 'target="_blank"'}><span style="flex-shrink:0">${icon}</span><span>${escapeHtml(item.name)}</span></a></td>
              <td class="muted-cell">${escapeHtml(item.sizeFormatted)}</td>
              <td class="muted-cell">${escapeHtml(item.mtime)}</td>
              <td>
                <div class="row-actions">
                  ${!item.isDirectory ? `<a href="${durl}" class="icon-btn cursor-pointer" download title="Unduh" aria-label="Unduh ${escapeHtml(item.name)}">${ICONS.download}</a>` : ''}
                  ${canWrite ? `<button type="button" class="icon-btn danger cursor-pointer" onclick="delItem('${escapeHtml(relPath)}','${escapeHtml(item.name)}')" title="Hapus" aria-label="Hapus ${escapeHtml(item.name)}">${ICONS.trash}</button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Modal Folder -->
<div id="folderModal" class="modal-bg">
  <div class="modal">
    <h2 class="modal-title">Buat Folder Baru</h2>
    <div style="margin-bottom:14px">
      <label for="newFolderName">Nama Folder</label>
      <input type="text" id="newFolderName" placeholder="Contoh: Dokumen Kerja">
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary cursor-pointer" onclick="closeFolderModal()">Batal</button>
      <button type="button" class="btn cursor-pointer" onclick="submitFolder()">Buat</button>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
  const currentPath=${JSON.stringify(currentPath)};
  function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)}
  function filterList(){
    const v=document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.file-row').forEach(r=>r.style.display=r.dataset.name.includes(v)?'':'none');
    document.querySelectorAll('.file-card').forEach(c=>c.style.display=c.dataset.name.includes(v)?'':'none');
  }
  ${canWrite ? `
  const dz=document.getElementById('dropZone');
  ['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();ev.stopPropagation();dz.classList.add('dragover')},false));
  ['dragleave','drop'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();ev.stopPropagation();dz.classList.remove('dragover')},false));
  dz.addEventListener('drop',e=>{if(e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files)});
  function uploadFiles(files){
    if(!files||!files.length)return;
    const fd=new FormData();
    for(let i=0;i<files.length;i++)fd.append('file'+i,files[i]);
    const pw=document.getElementById('progressWrap'),pb=document.getElementById('progressBar');
    pw.style.display='block';pb.style.width='0%';
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/?action=upload&folder='+encodeURIComponent(currentPath),true);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)pb.style.width=Math.round(e.loaded/e.total*100)+'%'};
    xhr.onload=()=>{pw.style.display='none';if(xhr.status===200){toast('File berhasil diunggah!');setTimeout(()=>location.reload(),600)}else toast('Gagal mengunggah: '+xhr.responseText)};
    xhr.onerror=()=>{pw.style.display='none';toast('Koneksi terputus')};
    xhr.send(fd);
  }
  function openFolderModal(){document.getElementById('newFolderName').value='';document.getElementById('folderModal').classList.add('active');setTimeout(()=>document.getElementById('newFolderName').focus(),50)}
  function closeFolderModal(){document.getElementById('folderModal').classList.remove('active')}
  function submitFolder(){
    const name=document.getElementById('newFolderName').value.trim();if(!name)return;
    fetch('/?action=mkdir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,path:currentPath})})
    .then(r=>r.json()).then(res=>{if(res.success){closeFolderModal();toast('Folder berhasil dibuat');location.reload()}else alert('Gagal: '+(res.error||'?'))})
    .catch(err=>alert('Error: '+err.message));
  }
  function delItem(p,n){
    if(!confirm('Hapus "'+n+'"? Tindakan ini tidak dapat dibatalkan.'))return;
    fetch('/?action=delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})})
    .then(r=>r.json()).then(res=>{if(res.success){toast('Item dihapus');location.reload()}else alert('Gagal: '+(res.error||'?'))})
    .catch(err=>alert('Error: '+err.message));
  }
  ` : `
  function openFolderModal(){}function closeFolderModal(){}function submitFolder(){}function delItem(){}function uploadFiles(){}
  `}
</script>
</body>
</html>`;
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = decodeURIComponent(parsedUrl.pathname);

  const cookies = auth.parseCookies(req);
  const session = auth.getSession(cookies['session_token']);
  const sessionToken = cookies['session_token'];

  // ─ POST /login
  if (req.method === 'POST' && reqPath === '/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const result = auth.authenticateUser(params.get('username') || '', params.get('password') || '');

      if (!result) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderLoginPage({ errorMessage: 'Username atau password tidak valid.' }));
      }
      if (result.error) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderLoginPage({ blockedMessage: result.error }));
      }

      const token = auth.createSession(result.user.username);
      res.writeHead(302, {
        'Set-Cookie': `session_token=${token}; HttpOnly; Path=/; SameSite=Lax`,
        'Location': '/'
      });
      return res.end();
    });
    return;
  }

  // ─ GET /login
  if (req.method === 'GET' && reqPath === '/login') {
    if (session) { res.writeHead(302, { Location: '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderLoginPage());
  }

  // ─ /logout
  if (reqPath === '/logout') {
    auth.destroySession(sessionToken);
    res.writeHead(302, {
      'Set-Cookie': 'session_token=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/login'
    });
    return res.end();
  }

  // ─ Wajib login
  if (!session) {
    if (req.method === 'POST') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Silakan login terlebih dahulu' }));
    }
    res.writeHead(302, { Location: '/login' });
    return res.end();
  }

  // Ambil data user dari sesi
  const dbUser = auth.getUserByUsername(session.username);
  if (!dbUser || dbUser.role === 'blocked') {
    auth.destroySession(sessionToken);
    res.writeHead(302, {
      'Set-Cookie': 'session_token=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/login'
    });
    return res.end();
  }

  const userInfo = { username: dbUser.username, role: dbUser.role, allowedDirs: dbUser.allowedDirs || [] };

  // Hitung subpath relatif terhadap SHARED_DIR
  const cleanSubPath = reqPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(SHARED_DIR, cleanSubPath);

  if (!isSafePath(absolutePath) && absolutePath !== SHARED_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  // ─ POST Actions
  if (req.method === 'POST') {
    const action = parsedUrl.searchParams.get('action');

    if (action === 'upload') {
      const folderParam = parsedUrl.searchParams.get('folder') || '';
      const targetDir = path.resolve(SHARED_DIR, folderParam.replace(/^\/+/, ''));
      const targetSub = path.relative(SHARED_DIR, targetDir);

      if (!auth.checkUserPermission(userInfo, targetSub, 'write')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin upload di direktori ini' }));
      }
      if (!isSafePath(targetDir) && targetDir !== SHARED_DIR) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Path tidak aman' }));
      }
      handleUpload(req, targetDir, (err, count) => {
        if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: err.message })); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count }));
      });
      return;
    }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');

        if (action === 'mkdir') {
          const folderName = (data.name || '').trim().replace(/[<>:"/\\|?*]/g, '_');
          const parentSub = (data.path || '').replace(/^\/+/, '');
          if (!folderName) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Nama folder kosong' })); }
          if (!auth.checkUserPermission(userInfo, parentSub, 'write')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin membuat folder di sini' }));
          }
          const targetPath = path.resolve(SHARED_DIR, parentSub, folderName);
          if (!isSafePath(targetPath)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Path tidak diizinkan' })); }
          if (fs.existsSync(targetPath)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Folder sudah ada' })); }
          fs.mkdirSync(targetPath, { recursive: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (action === 'delete') {
          const itemSub = (data.path || '').replace(/^\/+/, '');
          const targetPath = path.resolve(SHARED_DIR, itemSub);
          if (!isSafePath(targetPath) || targetPath === SHARED_DIR) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Operasi ditolak' })); }
          // Permission: write on parent dir
          const parentSub = path.relative(SHARED_DIR, path.dirname(targetPath));
          if (!auth.checkUserPermission(userInfo, parentSub, 'write')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin menghapus di direktori ini' }));
          }
          if (!fs.existsSync(targetPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Tidak ditemukan' })); }
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
          else fs.unlinkSync(targetPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Aksi tidak dikenal' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ─ GET: File / Directory
  if (!fs.existsSync(absolutePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<div style="font-family:sans-serif;text-align:center;padding:60px"><h2>404 — Tidak Ditemukan</h2><a href="/" style="color:#2563EB;text-decoration:none">&larr; Kembali</a></div>`);
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    // Cek read permission
    if (!auth.checkUserPermission(userInfo, cleanSubPath, 'read')) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(userInfo.username, reqPath));
    }
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const forceDownload = parsedUrl.searchParams.get('download') === '1';
    const filename = path.basename(absolutePath);
    const headers = { 'Content-Type': contentType, 'Content-Length': stat.size, 'Last-Modified': stat.mtime.toUTCString(), 'Accept-Ranges': 'bytes' };
    if (forceDownload || !MIME_TYPES[ext]) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(s, 10), end = e ? parseInt(e, 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(absolutePath, { start, end }).pipe(res);
    }
    res.writeHead(200, headers);
    return fs.createReadStream(absolutePath).pipe(res);
  }

  if (stat.isDirectory()) {
    if (reqPath !== '/' && !reqPath.endsWith('/')) {
      res.writeHead(301, { Location: reqPath + '/' }); return res.end();
    }

    // Cek read permission pada subpath ini
    if (!auth.checkUserPermission(userInfo, cleanSubPath, 'read')) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(userInfo.username, reqPath));
    }
    // Cek apakah user punya write permission di path ini
    const canWrite = auth.checkUserPermission(userInfo, cleanSubPath, 'write');

    fs.readdir(absolutePath, { withFileTypes: true }, (err, items) => {
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Gagal membaca direktori: ' + err.message); }

      const folders = [], files = [];
      for (const item of items) {
        try {
          const full = path.join(absolutePath, item.name);
          const s = fs.statSync(full);
          const d = { name: item.name, sizeFormatted: item.isDirectory() ? '--' : formatSize(s.size), mtime: formatDate(s.mtime), isDirectory: item.isDirectory() };
          if (item.isDirectory()) folders.push(d); else files.push(d);
        } catch {}
      }
      folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      const pathParts = cleanSubPath.split('/').filter(Boolean);
      let breadcrumbHtml = `<a href="/" class="crumb cursor-pointer">root</a>`;
      let acc = '';
      for (let i = 0; i < pathParts.length; i++) {
        acc += '/' + pathParts[i];
        breadcrumbHtml += ` <span class="crumb-sep">/</span> <a href="${acc}/" class="crumb cursor-pointer">${escapeHtml(pathParts[i])}</a>`;
      }
      const parentPath = pathParts.length > 0 ? '/' + pathParts.slice(0, -1).join('/') + (pathParts.length > 1 ? '/' : '') : null;

      const html = generateExplorerHtml({
        currentPath: reqPath, breadcrumbHtml, parentPath,
        items: [...folders, ...files],
        osInfo: `${os.type()} (${os.platform()} ${os.arch()})`,
        currentUser: userInfo.username, userRole: userInfo.role, canWrite
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const users = auth.loadUsers();
  console.log('════════════════════════════════════════════════════════');
  console.log('  LAN Web File Explorer — Server Aktif');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Folder    : ${SHARED_DIR}`);
  console.log(`  Akun      : ${users.length} akun terdaftar — login wajib`);
  console.log(`  Kelola    : node manage-account.js  (atau ketik: server)`);
  console.log('────────────────────────────────────────────────────────');
  console.log(`  Lokal     : http://localhost:${PORT}`);
  const ips = getLocalIPs();
  if (ips.length === 0) {
    console.log(`  Jaringan  : http://<IP-Server>:${PORT}`);
  } else {
    for (const ip of ips) console.log(`  Jaringan  : http://${ip.address}:${PORT}  (${ip.name})`);
  }
  console.log('════════════════════════════════════════════════════════');
  console.log('  Ctrl+C untuk menghentikan server.');
});
