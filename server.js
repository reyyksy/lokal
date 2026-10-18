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

const LOG_FILE = path.resolve(__dirname, 'traffic.log');

// ─── USER ACTIVITY TRAFFIC LOGGING ENGINE ────────────────────────────────────
function logActivity({ username, ip, host, action, details, status = 'SUCCESS' }) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      username: username || 'Tamu (Guest)',
      ip: (ip || '127.0.0.1').replace(/^.*:/, ''), // clean IPv6 mapped IPv4
      host: host || 'localhost',
      action,
      details: details || '-',
      status
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (err) {
    console.error('Gagal menulis traffic log:', err.message);
  }
}

// ─── ACTIVE BACKGROUND JOBS STORE ───────────────────────────────────────────
// Mempertahankan transfer saat user me-refresh browser (Linux explorer style)
const activeJobs = new Map();

function formatSize(bytes) {
  if (bytes === 0 || !bytes || isNaN(bytes)) return '0 B';
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

function formatFullDate(date) {
  const d = new Date(date);
  return d.toLocaleString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
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

// Hitung total ukuran direktori / file secara rekursif
function getDirOrFileSize(itemPath) {
  try {
    const stat = fs.statSync(itemPath);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    const entries = fs.readdirSync(itemPath, { withFileTypes: true });
    for (const ent of entries) {
      total += getDirOrFileSize(path.join(itemPath, ent.name));
    }
    return total;
  } catch {
    return 0;
  }
}

// ─── STREAMING UPLOAD HANDLER (HIGH SPEED & CONSTANT MEMORY) ────────────────
function handleUploadStream(req, targetDir, callback) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return callback(new Error('Format upload bukan multipart/form-data valid'));

  const boundary = match[1] || match[2];
  const boundaryBuffer = Buffer.from('--' + boundary);

  let buffer = Buffer.alloc(0);
  let state = 'FIND_BOUNDARY';
  let curFileStream = null;
  let filesSaved = 0;

  function cleanup() {
    if (curFileStream) {
      try { curFileStream.destroy(); } catch {}
      curFileStream = null;
    }
  }

  req.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);

    let processing = true;
    while (processing) {
      if (state === 'FIND_BOUNDARY') {
        const idx = buffer.indexOf(boundaryBuffer);
        if (idx === -1) {
          if (buffer.length > boundaryBuffer.length + 4) {
            buffer = buffer.slice(buffer.length - (boundaryBuffer.length + 4));
          }
          processing = false;
        } else {
          buffer = buffer.slice(idx + boundaryBuffer.length);
          state = 'READ_HEADERS';
        }
      } else if (state === 'READ_HEADERS') {
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) {
          processing = false;
        } else {
          const headerStr = buffer.slice(0, headerEnd).toString('utf8');
          buffer = buffer.slice(headerEnd + 4);

          const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
          if (filenameMatch && filenameMatch[1]) {
            let filename = path.basename(filenameMatch[1].trim());
            filename = filename.replace(/[<>:"/\\|?*]/g, '_');
            if (filename) {
              const destPath = path.join(targetDir, filename);
              if (isSafePath(destPath) || destPath === SHARED_DIR) {
                curFileStream = fs.createWriteStream(destPath, { highWaterMark: 1024 * 1024 * 4 });
                state = 'WRITE_BODY';
                continue;
              }
            }
          }
          state = 'SKIP_FIELD';
        }
      } else if (state === 'WRITE_BODY') {
        const nextBoundaryIdx = buffer.indexOf(boundaryBuffer);
        if (nextBoundaryIdx === -1) {
          const safeKeep = boundaryBuffer.length + 6;
          if (buffer.length > safeKeep) {
            const writeChunk = buffer.slice(0, buffer.length - safeKeep);
            curFileStream.write(writeChunk);
            buffer = buffer.slice(buffer.length - safeKeep);
          }
          processing = false;
        } else {
          let bodyPart = buffer.slice(0, nextBoundaryIdx);
          if (bodyPart.length >= 2 && bodyPart[bodyPart.length - 2] === 13 && bodyPart[bodyPart.length - 1] === 10) {
            bodyPart = bodyPart.slice(0, bodyPart.length - 2);
          }
          curFileStream.write(bodyPart);
          curFileStream.end();
          filesSaved++;
          curFileStream = null;
          buffer = buffer.slice(nextBoundaryIdx + boundaryBuffer.length);
          state = 'READ_HEADERS';
        }
      } else if (state === 'SKIP_FIELD') {
        const nextBoundaryIdx = buffer.indexOf(boundaryBuffer);
        if (nextBoundaryIdx === -1) {
          const safeKeep = boundaryBuffer.length + 6;
          if (buffer.length > safeKeep) {
            buffer = buffer.slice(buffer.length - safeKeep);
          }
          processing = false;
        } else {
          buffer = buffer.slice(nextBoundaryIdx + boundaryBuffer.length);
          state = 'READ_HEADERS';
        }
      }
    }
  });

  req.on('end', () => {
    if (curFileStream) {
      curFileStream.end();
      filesSaved++;
    }
    callback(null, filesSaved);
  });

  req.on('error', err => {
    cleanup();
    callback(err);
  });
}

// ─── HIGH PERFORMANCE SERVER-SIDE FILE / FOLDER COPY ─────────────────────────
function copyFileWithProgress(src, dest, onProgress, isCanceled) {
  return new Promise((resolve, reject) => {
    const srcStat = fs.statSync(src);
    const totalSize = srcStat.size;

    // Fast-path: reflink copy jika didukung filesystem
    try {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
      if (onProgress) onProgress(totalSize);
      return resolve();
    } catch {}

    const readStream = fs.createReadStream(src, { highWaterMark: 1024 * 1024 * 4 });
    const writeStream = fs.createWriteStream(dest, { highWaterMark: 1024 * 1024 * 4 });

    readStream.on('data', chunk => {
      if (isCanceled && isCanceled()) {
        readStream.destroy();
        writeStream.destroy();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error('Dibatalkan oleh pengguna'));
      }
      if (onProgress) onProgress(chunk.length);
    });

    writeStream.on('finish', () => resolve());
    readStream.on('error', err => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
    writeStream.on('error', err => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });

    readStream.pipe(writeStream);
  });
}

async function copyRecursiveWithProgress(src, dest, onProgress, isCanceled) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      if (isCanceled && isCanceled()) throw new Error('Dibatalkan oleh pengguna');
      const srcChild = path.join(src, entry);
      const destChild = path.join(dest, entry);
      await copyRecursiveWithProgress(srcChild, destChild, onProgress, isCanceled);
    }
  } else {
    await copyFileWithProgress(src, dest, onProgress, isCanceled);
  }
}

// ─── ASYNCHRONOUS JOB MANAGER (PERSISTENT STATUS BOX) ─────────────────────────
function createJob({ type, source, dest, filename, totalBytes }) {
  const id = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const job = {
    id,
    type,
    filename,
    source,
    dest,
    totalBytes: totalBytes || 1,
    processedBytes: 0,
    startTime: Date.now(),
    lastTime: Date.now(),
    lastBytes: 0,
    speedBps: 0,
    avgSpeedBps: 0,
    status: 'running',
    error: null,
    isCanceled: false
  };
  activeJobs.set(id, job);
  return job;
}

function updateJobProgress(job, bytesChunk) {
  job.processedBytes += bytesChunk;
  const now = Date.now();
  const timeDiff = (now - job.lastTime) / 1000;
  if (timeDiff >= 0.3 || job.processedBytes >= job.totalBytes) {
    const bytesDiff = job.processedBytes - job.lastBytes;
    job.speedBps = timeDiff > 0 ? (bytesDiff / timeDiff) : 0;
    const totalTime = (now - job.startTime) / 1000;
    job.avgSpeedBps = totalTime > 0 ? (job.processedBytes / totalTime) : 0;
    job.lastTime = now;
    job.lastBytes = job.processedBytes;
  }
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
  '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.iso': 'application/x-iso9660-image', '.img': 'application/octet-stream',
  '.qcow2': 'application/octet-stream', '.vmdk': 'application/octet-stream'
};

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── SVG ICONS (STRICT: NO EMOJIS, HIGH CONTRAST SVG) ───────────────────────
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
  copy:       `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  cut:        `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>`,
  paste:      `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="5" y="8" rx="2" ry="2"/><path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2H9V4z"/></svg>`,
  activity:   `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  info:       `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  check:      `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x:          `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>`,
  shield:     `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
};

function getFileIcon(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.zip': case '.rar': case '.7z': case '.tar': case '.gz': case '.iso': case '.img': return ICONS.fileArchive;
    case '.png': case '.jpg': case '.jpeg': case '.gif': case '.webp': case '.svg': return ICONS.fileImage;
    case '.mp4': case '.mkv': case '.webm': case '.avi': return ICONS.fileVideo;
    case '.mp3': case '.wav': case '.ogg': case '.flac': return ICONS.fileAudio;
    case '.pdf': return ICONS.filePdf;
    case '.js': case '.ts': case '.html': case '.css': case '.py': case '.json':
    case '.c': case '.cpp': case '.sh': case '.bat': return ICONS.fileCode;
    default: return ICONS.fileDefault;
  }
}

// ─── BASE CSS (DESIGN SYSTEM PRO-MAX) ────────────────────────────────────────
function getBaseCss() {
  return `
    :root {
      --c-primary: #2563EB;
      --c-primary-hover: #1D4ED8;
      --c-secondary: #3B82F6;
      --c-accent: #EA580C;
      --c-accent-hover: #C2410C;
      --c-bg: #F8FAFC;
      --c-fg: #1E293B;
      --c-card: #FFFFFF;
      --c-muted: #E9EFF8;
      --c-muted-fg: #475569;
      --c-border: #E2E8F0;
      --c-danger: #DC2626;
      --c-danger-hover: #B91C1C;
      --c-success: #10B981;
      --c-ring: rgba(37,99,235,0.25);
      --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
      --shadow-sm: 0 1px 3px rgba(15,23,42,.06);
      --shadow-md: 0 4px 16px rgba(15,23,42,.08);
      --shadow-lg: 0 10px 30px rgba(15,23,42,.14);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --c-primary: #3B82F6; --c-primary-hover: #60A5FA;
        --c-secondary: #60A5FA;
        --c-accent: #F97316;
        --c-bg: #0B1120; --c-fg: #F8FAFC;
        --c-card: #1E293B; --c-muted: #182234;
        --c-muted-fg: #94A3B8; --c-border: #334155;
        --c-danger: #F87171; --c-danger-hover: #EF4444;
        --c-success: #34D399;
        --shadow-sm: 0 1px 3px rgba(0,0,0,.3);
        --shadow-md: 0 4px 16px rgba(0,0,0,.4);
        --shadow-lg: 0 10px 30px rgba(0,0,0,.5);
      }
    }
    *,::before,::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:'Work Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:var(--c-bg); color:var(--c-fg); line-height:1.5;
      min-height:100vh; min-height:100dvh;
    }
    .cursor-pointer{cursor:pointer}
    button,.btn{
      display:inline-flex; align-items:center; gap:8px;
      background:var(--c-primary); color:#ffffff; border:none;
      padding:9px 16px; min-height:42px;
      border-radius:var(--r-sm); font-family:'Outfit',sans-serif;
      font-size:.875rem; font-weight:600; text-decoration:none;
      cursor:pointer; transition:background .15s ease, transform .1s ease;
    }
    button:hover,.btn:hover{background:var(--c-primary-hover)}
    button:focus-visible,.btn:focus-visible{outline:2px solid var(--c-primary);outline-offset:2px}
    button:active,.btn:active{transform:translateY(1px)}
    .btn-secondary{background:var(--c-muted);color:var(--c-fg);border:1px solid var(--c-border)}
    .btn-secondary:hover{background:var(--c-border)}
    .btn-accent{background:var(--c-accent);color:#ffffff}
    .btn-accent:hover{background:var(--c-accent-hover)}
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
  <title>Masuk — LAN File Server</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
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
      font-family:'Outfit',sans-serif; font-size:1.3rem;
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
      <h1>Masuk ke Server File</h1>
      <p>Lokal File Explorer — Akses Terbatas</p>
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
      <span>Otentikasi aman LAN • Hak akses per-direktori</span>
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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${getBaseCss()}
    body{display:flex;align-items:center;justify-content:center;padding:24px;min-height:100vh}
    .box{text-align:center;max-width:440px}
    .icon-wrap{width:72px;height:72px;border-radius:18px;background:rgba(220,38,38,.1);color:var(--c-danger);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px}
    h1{font-family:'Outfit',sans-serif;font-size:1.4rem;font-weight:700;margin-bottom:8px}
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
      <a href="/" class="btn btn-secondary cursor-pointer">← Kembali ke Root</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── MAIN EXPLORER UI WITH AUDITED DESIGN SYSTEM ─────────────────────────────
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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    ${getBaseCss()}
    body{padding:env(safe-area-inset-top,14px) env(safe-area-inset-right,14px) env(safe-area-inset-bottom,14px) env(safe-area-inset-left,14px)}
    .wrap{max-width:1200px;margin:0 auto}

    /* Header */
    header{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-lg);padding:14px 18px;margin-bottom:14px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow-sm)}
    @media(min-width:768px){header{flex-direction:row;justify-content:space-between;align-items:center;padding:16px 24px;margin-bottom:18px}}
    .logo-area{display:flex;align-items:center;gap:12px}
    .logo-badge{width:42px;height:42px;border-radius:10px;background:rgba(37,99,235,.1);color:var(--c-primary);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .logo-titles h1{font-family:'Outfit',sans-serif;font-size:1.2rem;font-weight:700;line-height:1.2}
    .logo-meta{display:flex;align-items:center;gap:5px;font-size:.72rem;color:var(--c-muted-fg);margin-top:3px}
    .header-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    @media(max-width:767px){.header-right{width:100%}}
    .user-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;min-height:38px;border-radius:9999px;background:var(--c-muted);border:1px solid var(--c-border);font-size:.8rem;font-weight:600;flex-shrink:0}
    .role-badge{font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:9999px;background:rgba(37,99,235,.1);color:var(--c-primary)}
    .actions-wrap{display:flex;gap:8px;flex:1;justify-content:flex-end;flex-wrap:wrap}
    @media(max-width:479px){.actions-wrap{width:100%}.actions-wrap button{flex:1;justify-content:center}}
    .btn-sm{padding:7px 13px;min-height:38px;font-size:.8rem}

    /* Clipboard bar */
    .clipboard-bar{display:none;align-items:center;justify-content:space-between;background:rgba(37,99,235,.09);border:1px solid var(--c-primary);border-radius:var(--r-md);padding:12px 16px;margin-bottom:14px;font-size:.875rem}
    .clipboard-bar.active{display:flex}
    .clipboard-info{display:flex;align-items:center;gap:10px;overflow:hidden}
    .clipboard-text{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .clipboard-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}

    /* Main Card */
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

    /* Search & Filter */
    .search-wrap{margin:0 16px 12px;position:relative}
    .search-icon{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--c-muted-fg);pointer-events:none;display:flex}
    .search-input{padding-left:38px!important}

    /* Mobile list */
    .mobile-list{display:flex;flex-direction:column;padding:0 10px 14px;gap:8px}
    .m-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden}
    .m-card.parent-dir .m-main{background:var(--c-muted)}
    .m-main{display:flex;align-items:center;gap:10px;padding:11px 12px}
    .m-card-link{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-decoration:none;color:var(--c-fg)}
    .m-name{font-size:.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    .m-meta{font-size:.72rem;color:var(--c-muted-fg);margin-top:2px;display:flex;gap:6px}
    /* Three-dot toggle button */
    .m-toggle{background:none;border:1px solid var(--c-border);border-radius:var(--r-sm);width:36px;height:36px;min-width:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--c-muted-fg);flex-shrink:0;transition:all .15s}
    .m-toggle:hover,.m-toggle.open{background:var(--c-muted);border-color:var(--c-primary);color:var(--c-primary)}
    /* Expandable action panel */
    .m-panel{display:none;border-top:1px solid var(--c-border);background:var(--c-muted);padding:8px 10px;flex-wrap:wrap;gap:7px}
    .m-panel.open{display:flex}


    /* Desktop table */
    .desktop-table{display:none;overflow-x:auto}
    @media(min-width:768px){.mobile-list{display:none}.desktop-table{display:block}}
    table{width:100%;border-collapse:collapse;font-size:.875rem;text-align:left}
    th{background:var(--c-muted);color:var(--c-muted-fg);font-weight:600;padding:12px 18px;border-bottom:1px solid var(--c-border);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
    td{padding:12px 18px;border-bottom:1px solid var(--c-border);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr.file-row:hover td{background:var(--c-muted)}
    .item-link{display:inline-flex;align-items:center;gap:10px;color:var(--c-fg);text-decoration:none;font-weight:500;word-break:break-all;transition:color .15s}
    .item-link:hover{color:var(--c-primary)}
    .muted-cell{color:var(--c-muted-fg);white-space:nowrap;font-size:.8125rem}
    /* Action buttons: prominent & clear with text labels */
    .btn-action{
      display:inline-flex; align-items:center; gap:6px;
      padding:6px 12px; min-height:38px;
      border-radius:var(--r-sm); border:1px solid var(--c-border);
      background:var(--c-card); color:var(--c-fg);
      font-size:.8rem; font-weight:600; font-family:'Outfit',sans-serif;
      transition:all .15s ease; cursor:pointer; text-decoration:none;
      white-space:nowrap; flex-shrink:0;
    }
    .btn-action:hover{background:var(--c-muted);border-color:var(--c-primary);color:var(--c-primary)}
    .btn-action.btn-action-primary{color:var(--c-primary);border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.04)}
    .btn-action.btn-action-primary:hover{background:var(--c-primary);color:#ffffff;border-color:var(--c-primary)}
    .btn-action.btn-action-danger{color:var(--c-danger)}
    .btn-action.btn-action-danger:hover{background:var(--c-danger);color:#ffffff;border-color:var(--c-danger)}
    .btn-action-icon-only{
      padding:0; width:38px; height:38px; min-width:38px; min-height:38px;
      justify-content:center;
    }
    .empty-state{padding:44px 16px;text-align:center;color:var(--c-muted-fg)}

    /* ─── LINUX GNU STYLE FILE OPERATIONS FLOATING WIDGET ─── */
    .ops-widget{
      position:fixed; bottom:20px; right:20px; width:400px; max-width:calc(100vw - 32px);
      background:var(--c-card); border:1px solid var(--c-border); border-radius:var(--r-md);
      box-shadow:var(--shadow-lg); z-index:9000; overflow:hidden;
      display:none; flex-direction:column; transition:transform .2s ease;
    }
    .ops-widget.active{display:flex}
    .ops-header{
      background:var(--c-muted); padding:12px 16px; border-bottom:1px solid var(--c-border);
      display:flex; align-items:center; justify-content:space-between;
    }
    .ops-title{display:flex;align-items:center;gap:8px;font-family:'Outfit',sans-serif;font-size:.875rem;font-weight:700}
    .ops-close{background:none;border:none;min-height:unset;padding:4px;color:var(--c-muted-fg);cursor:pointer}
    .ops-close:hover{color:var(--c-fg)}
    .ops-body{padding:16px;display:flex;flex-direction:column;gap:12px}
    .ops-filename{font-size:.875rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ops-meta{display:flex;justify-content:space-between;font-size:.78rem;color:var(--c-muted-fg)}
    .ops-bar-bg{width:100%;height:8px;background:var(--c-muted);border-radius:99px;overflow:hidden;border:1px solid var(--c-border)}
    .ops-bar-fill{height:100%;width:0%;background:linear-gradient(90deg, #2563EB, #10B981);transition:width .2s ease}
    .ops-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.78rem;background:var(--c-muted);padding:10px 12px;border-radius:var(--r-sm)}
    .ops-details span{display:block}
    .ops-cancel-btn{margin-top:2px;background:none;border:1px solid var(--c-border);color:var(--c-danger);padding:7px 14px;font-size:.78rem;min-height:32px;border-radius:var(--r-sm);align-self:flex-end}
    .ops-cancel-btn:hover{background:rgba(220,38,38,.08);border-color:var(--c-danger)}

    /* Toast */
    .toast{position:fixed;bottom:calc(env(safe-area-inset-bottom,16px) + 16px);left:16px;max-width:360px;padding:12px 18px;border-radius:var(--r-md);background:#0F172A;color:#fff;font-size:.875rem;font-weight:500;box-shadow:var(--shadow-lg);z-index:9999;transform:translateY(120%);opacity:0;transition:transform .25s ease,opacity .25s;display:flex;align-items:center;gap:10px}
    .toast.show{transform:translateY(0);opacity:1}

    /* Modal */
    .modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(3px);z-index:9500;align-items:center;justify-content:center;padding:16px}
    .modal-bg.active{display:flex}
    .modal{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-lg);width:100%;max-width:440px;padding:24px;box-shadow:var(--shadow-md)}
    .modal-title{font-family:'Outfit',sans-serif;font-size:1.15rem;font-weight:700;margin-bottom:16px}
    .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
    @media(max-width:479px){.modal-footer button{flex:1;justify-content:center}}

    /* Properties Info Dialog (Alt+Enter style) */
    .prop-list{display:flex;flex-direction:column;gap:12px;margin-bottom:18px}
    .prop-row{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--c-border);font-size:.85rem}
    .prop-row:last-child{border-bottom:none;padding-bottom:0}
    .prop-label{color:var(--c-muted-fg);font-weight:500;flex-shrink:0;width:110px}
    .prop-value{font-weight:600;word-break:break-all;text-align:right}
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
          ${ICONS.upload}<span>Unggah File</span>
        </button>
        <input type="file" id="fileInput" multiple style="display:none" onchange="uploadFiles(this.files)">
      </div>` : ''}
    </div>
  </header>

  <!-- Clipboard bar (Copy/Paste status) -->
  <div id="clipboardBar" class="clipboard-bar">
    <div class="clipboard-info">
      <span style="color:var(--c-primary)" id="clipIcon">${ICONS.copy}</span>
      <span class="clipboard-text" id="clipboardText">1 item di clipboard</span>
    </div>
    <div class="clipboard-actions">
      ${canWrite ? `
      <button type="button" class="btn btn-sm btn-accent cursor-pointer" onclick="executePaste()">
        ${ICONS.paste} <span>Paste di Sini</span>
      </button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm cursor-pointer" onclick="clearClipboard()">
        ${ICONS.x} <span>Batal</span>
      </button>
    </div>
  </div>

  <div class="main-card">
    <div class="breadcrumb">${breadcrumbHtml}</div>

    ${canWrite ? `
    <div class="dropzone cursor-pointer" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <div style="color:var(--c-primary)">${ICONS.uploadCloud}</div>
      <p class="dropzone-title">Tarik & lepas file atau ketuk untuk mengunggah</p>
      <p class="dropzone-sub">Transfer berkecepatan tinggi tanpa batasan ukuran file</p>
    </div>` : ''}

    <div class="search-wrap">
      <div class="search-icon">${ICONS.search}</div>
      <input type="text" class="search-input" id="searchInput" placeholder="Cari file atau folder…" oninput="filterList()">
    </div>

    <!-- MOBILE LIST -->
    <div class="mobile-list" id="mobileList">
      ${parentPath !== null ? `
      <div class="m-card parent-dir">
        <div class="m-main">
          <a href="${parentPath}" class="m-card-link cursor-pointer" style="color:var(--c-muted-fg)">
            <span style="flex-shrink:0">${ICONS.arrowUp}</span>
            <div><span class="m-name">.. Kembali ke folder atas</span></div>
          </a>
        </div>
      </div>` : ''}

      ${items.length === 0 ? `<div class="empty-state"><p>Folder ini kosong.</p></div>` : ''}

      ${items.map((item, idx) => {
        const iurl = (currentPath.endsWith('/') ? currentPath : currentPath + '/') + encodeURIComponent(item.name) + (item.isDirectory ? '/' : '');
        const durl = iurl.replace(/\/+$/, '') + '?download=1';
        const icon = item.isDirectory ? ICONS.folder : getFileIcon(item.name);
        const relBase = currentPath.replace(/^\/+/, '');
        const relPath = (relBase ? relBase + '/' : '') + item.name;
        const escRel = escapeHtml(relPath);
        const escName = escapeHtml(item.name);
        const fullDate = escapeHtml(item.fullMtime || item.mtime);
        const rawSize = item.rawSizeBytes || 0;
        const panelId = `mp${idx}`;
        return `
        <div class="m-card file-card" data-name="${escName.toLowerCase()}">
          <div class="m-main">
            <a href="${iurl}" class="m-card-link cursor-pointer" ${item.isDirectory ? '' : 'target="_blank"'}>
              <span style="flex-shrink:0">${icon}</span>
              <div class="m-info" style="min-width:0">
                <span class="m-name">${escName}</span>
                <div class="m-meta"><span>${escapeHtml(item.sizeFormatted)}</span><span>•</span><span>${escapeHtml(item.mtime)}</span></div>
              </div>
            </a>
            <button type="button" class="m-toggle cursor-pointer" onclick="toggleMPanel('${panelId}',this)" title="Aksi" aria-label="Aksi untuk ${escName}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
          </div>
          <div class="m-panel" id="${panelId}">
            <button type="button" class="btn-action btn-action-icon-only cursor-pointer" onclick="showProperties('${escName}','${escRel}','${escapeHtml(item.sizeFormatted)}',${rawSize},'${fullDate}',${item.isDirectory})" title="Info Detail" aria-label="Info ${escName}">${ICONS.info}</button>
            ${!item.isDirectory ? `<a href="${durl}" class="btn-action btn-action-primary cursor-pointer" download title="Unduh File" aria-label="Unduh ${escName}">${ICONS.download}<span>Unduh</span></a>` : ''}
            <button type="button" class="btn-action cursor-pointer" onclick="setClipboard('${escRel}','${escName}','copy')" title="Salin (Copy)">${ICONS.copy}<span>Salin</span></button>
            ${canWrite ? `
            <button type="button" class="btn-action cursor-pointer" onclick="setClipboard('${escRel}','${escName}','move')" title="Potong (Cut)">${ICONS.cut}<span>Potong</span></button>
            <button type="button" class="btn-action btn-action-danger cursor-pointer" onclick="delItem('${escRel}','${escName}')" title="Hapus">${ICONS.trash}<span>Hapus</span></button>
            ` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>


    <!-- DESKTOP TABLE -->
    <div class="desktop-table">
      <table>
        <thead><tr>
          <th>Nama</th><th style="width:120px">Ukuran</th>
          <th style="width:160px">Diubah</th><th style="width:360px;text-align:right">Aksi File</th>
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
            const escRel = escapeHtml(relPath);
            const escName = escapeHtml(item.name);
            const fullDate = escapeHtml(item.fullMtime || item.mtime);
            const rawSize = item.rawSizeBytes || 0;
            return `
            <tr class="file-row" data-name="${escName.toLowerCase()}">
              <td><a href="${iurl}" class="item-link cursor-pointer" ${item.isDirectory ? '' : 'target="_blank"'}><span style="flex-shrink:0">${icon}</span><span>${escName}</span></a></td>
              <td class="muted-cell">${escapeHtml(item.sizeFormatted)}</td>
              <td class="muted-cell">${escapeHtml(item.mtime)}</td>
              <td>
                <div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
                  <button type="button" class="btn-action btn-action-icon-only cursor-pointer" onclick="showProperties('${escName}','${escRel}','${escapeHtml(item.sizeFormatted)}',${rawSize},'${fullDate}',${item.isDirectory})" title="Info Detail File (Alt+Enter)" aria-label="Info ${escName}">${ICONS.info}</button>
                  ${!item.isDirectory ? `<a href="${durl}" class="btn-action btn-action-primary cursor-pointer" download title="Unduh File" aria-label="Unduh ${escName}">${ICONS.download}<span>Unduh</span></a>` : ''}
                  <button type="button" class="btn-action cursor-pointer" onclick="setClipboard('${escRel}','${escName}','copy')" title="Salin (Copy)" aria-label="Copy ${escName}">${ICONS.copy}<span>Salin</span></button>
                  ${canWrite ? `
                  <button type="button" class="btn-action cursor-pointer" onclick="setClipboard('${escRel}','${escName}','move')" title="Potong (Cut / Pindahkan)" aria-label="Cut ${escName}">${ICONS.cut}<span>Potong</span></button>
                  <button type="button" class="btn-action btn-action-danger cursor-pointer" onclick="delItem('${escRel}','${escName}')" title="Hapus" aria-label="Hapus ${escName}">${ICONS.trash}<span>Hapus</span></button>
                  ` : ''}
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

<!-- Modal Properties File Info (Alt+Enter) -->
<div id="propModal" class="modal-bg">
  <div class="modal">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 class="modal-title" style="margin-bottom:0">Informasi Properti</h2>
      <button type="button" class="ops-close cursor-pointer" onclick="closeProperties()">${ICONS.x}</button>
    </div>
    <div class="prop-list">
      <div class="prop-row">
        <span class="prop-label">Nama</span>
        <span class="prop-value" id="propName">-</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Tipe</span>
        <span class="prop-value" id="propType">-</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Lokasi Path</span>
        <span class="prop-value" id="propPath">-</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Ukuran</span>
        <span class="prop-value" id="propSize">-</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Ukuran Byte</span>
        <span class="prop-value" id="propBytes">-</span>
      </div>
      <div class="prop-row">
        <span class="prop-label">Terakhir Diubah</span>
        <span class="prop-value" id="propDate">-</span>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary cursor-pointer" onclick="closeProperties()">Tutup</button>
    </div>
  </div>
</div>

<!-- LINUX EXPLORER PROGRESS WIDGET -->
<div id="opsWidget" class="ops-widget" role="dialog" aria-label="Status Operasi File">
  <div class="ops-header">
    <div class="ops-title">
      <span style="color:var(--c-primary)">${ICONS.activity}</span>
      <span id="opsHeaderTitle">Operasi File</span>
    </div>
    <button type="button" class="ops-close cursor-pointer" onclick="hideOpsWidget()" title="Tutup">${ICONS.x}</button>
  </div>
  <div class="ops-body">
    <div class="ops-filename" id="opsFileName">Nama File</div>
    <div class="ops-meta">
      <span id="opsStatusText">Memproses…</span>
      <strong id="opsPercentText">0%</strong>
    </div>
    <div class="ops-bar-bg">
      <div id="opsBarFill" class="ops-bar-fill"></div>
    </div>
    <div class="ops-details">
      <div><span style="color:var(--c-muted-fg)">Ukuran:</span> <strong id="opsSizeText">0 MB / 0 MB</strong></div>
      <div><span style="color:var(--c-muted-fg)">Kecepatan:</span> <strong id="opsSpeedText">0 MB/s</strong></div>
      <div><span style="color:var(--c-muted-fg)">Rata-rata:</span> <strong id="opsAvgSpeedText">0 MB/s</strong></div>
      <div><span style="color:var(--c-muted-fg)">Estimasi Sisa:</span> <strong id="opsEtaText">--:--</strong></div>
    </div>
    <button type="button" id="opsCancelBtn" class="ops-cancel-btn cursor-pointer" onclick="cancelCurrentJob()">Batalkan Operasi</button>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
  const currentPath = ${JSON.stringify(currentPath)};
  let activeJobId = null;
  let jobPollInterval = null;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  function filterList() {
    const v = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.file-row').forEach(r => r.style.display = r.dataset.name.includes(v) ? '' : 'none');
    document.querySelectorAll('.file-card').forEach(c => c.style.display = c.dataset.name.includes(v) ? '' : 'none');
  }

  // ─── MOBILE: Toggle panel aksi tiga titik ────────────────────────────────
  function toggleMPanel(id, btn) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    // Tutup semua panel lain dulu
    document.querySelectorAll('.m-panel.open').forEach(p => {
      if (p.id !== id) {
        p.classList.remove('open');
        const prevBtn = p.closest('.m-card')?.querySelector('.m-toggle');
        if (prevBtn) prevBtn.classList.remove('open');
      }
    });
    // Toggle panel ini
    panel.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
  }


  // ─── FILE PROPERTIES MODAL (Alt+Enter) ────────────────────────────────────
  function showProperties(name, relPath, sizeFormatted, rawBytes, mtime, isDir) {
    document.getElementById('propName').textContent = name;
    document.getElementById('propType').textContent = isDir ? 'Folder Direktori' : (name.split('.').pop().toUpperCase() + ' File');
    document.getElementById('propPath').textContent = '/' + relPath;
    document.getElementById('propSize').textContent = sizeFormatted;
    document.getElementById('propBytes').textContent = isDir ? '--' : (Number(rawBytes).toLocaleString('id-ID') + ' bytes');
    document.getElementById('propDate').textContent = mtime;
    document.getElementById('propModal').classList.add('active');

    // Catat ke traffic log server
    try {
      fetch('/?action=log_info&item=' + encodeURIComponent(relPath || name), { method: 'GET' }).catch(() => {});
    } catch {}
  }

  function closeProperties() {
    document.getElementById('propModal').classList.remove('active');
  }

  // Keyboard shortcut Alt+Enter: tampilkan info properti item pertama atau search
  window.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      const firstRow = document.querySelector('.file-row:not([style*="display: none"]) .icon-btn');
      if (firstRow) firstRow.click();
    }
  });

  // ─── CLIPBOARD STATE MANAGEMENT (PERSISTENT IN LOCALSTORAGE) ───────────────
  function updateClipboardUI() {
    const clip = JSON.parse(localStorage.getItem('lokal_clipboard') || 'null');
    const bar = document.getElementById('clipboardBar');
    if (!bar) return;
    if (clip && clip.path) {
      bar.classList.add('active');
      document.getElementById('clipboardText').textContent = 
        (clip.type === 'move' ? 'Pindahkan (Cut): ' : 'Salin (Copy): ') + clip.name;
      document.getElementById('clipIcon').innerHTML = clip.type === 'move' ? ${JSON.stringify(ICONS.cut)} : ${JSON.stringify(ICONS.copy)};
    } else {
      bar.classList.remove('active');
    }
  }

  function setClipboard(itemPath, itemName, type) {
    localStorage.setItem('lokal_clipboard', JSON.stringify({ path: itemPath, name: itemName, type }));
    updateClipboardUI();
    toast(type === 'move' ? 'Item siap dipindahkan' : 'Item disalin ke clipboard');
  }

  function clearClipboard() {
    localStorage.removeItem('lokal_clipboard');
    updateClipboardUI();
    toast('Clipboard dikosongkan');
  }

  function executePaste() {
    const clip = JSON.parse(localStorage.getItem('lokal_clipboard') || 'null');
    if (!clip || !clip.path) return;

    fetch('/?action=paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: clip.path,
        targetDir: currentPath,
        operation: clip.type
      })
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        if (clip.type === 'move') {
          clearClipboard();
        }
        if (res.jobId) {
          trackJob(res.jobId, clip.name, clip.type === 'move' ? 'Memindahkan File' : 'Menyalin File');
        } else {
          toast('Operasi selesai!');
          location.reload();
        }
      } else {
        alert('Gagal: ' + (res.error || 'Terjadi kesalahan'));
      }
    })
    .catch(err => alert('Error: ' + err.message));
  }

  // ─── LINUX OPERATION MONITORING (PERSISTENT & SURVIVES REFRESH) ───────────
  function showOpsWidget() {
    document.getElementById('opsWidget').classList.add('active');
  }
  function hideOpsWidget() {
    document.getElementById('opsWidget').classList.remove('active');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return 'Selesai';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function trackJob(jobId, fileName, title) {
    activeJobId = jobId;
    localStorage.setItem('lokal_active_job', JSON.stringify({ jobId, fileName, title }));
    document.getElementById('opsHeaderTitle').textContent = title || 'Operasi File';
    document.getElementById('opsFileName').textContent = fileName;
    showOpsWidget();

    if (jobPollInterval) clearInterval(jobPollInterval);
    jobPollInterval = setInterval(pollJobStatus, 400);
    pollJobStatus();
  }

  function pollJobStatus() {
    if (!activeJobId) return;
    fetch('/?action=job_status&id=' + encodeURIComponent(activeJobId))
      .then(r => r.json())
      .then(job => {
        if (!job || !job.id) {
          clearInterval(jobPollInterval);
          localStorage.removeItem('lokal_active_job');
          hideOpsWidget();
          return;
        }

        const pct = Math.min(100, Math.round((job.processedBytes / (job.totalBytes || 1)) * 100));
        document.getElementById('opsBarFill').style.width = pct + '%';
        document.getElementById('opsPercentText').textContent = pct + '%';
        document.getElementById('opsSizeText').textContent = 
          formatBytes(job.processedBytes) + ' / ' + formatBytes(job.totalBytes);

        document.getElementById('opsSpeedText').textContent = formatBytes(job.speedBps) + '/s';
        document.getElementById('opsAvgSpeedText').textContent = formatBytes(job.avgSpeedBps) + '/s';

        const remainingBytes = Math.max(0, job.totalBytes - job.processedBytes);
        const etaSec = job.avgSpeedBps > 0 ? (remainingBytes / job.avgSpeedBps) : 0;
        document.getElementById('opsEtaText').textContent = formatTime(etaSec);

        if (job.status === 'completed') {
          clearInterval(jobPollInterval);
          localStorage.removeItem('lokal_active_job');
          document.getElementById('opsStatusText').textContent = 'Selesai!';
          document.getElementById('opsBarFill').style.width = '100%';
          document.getElementById('opsPercentText').textContent = '100%';
          toast('Operasi berhasil diselesaikan!');
          setTimeout(() => {
            hideOpsWidget();
            location.reload();
          }, 1200);
        } else if (job.status === 'error') {
          clearInterval(jobPollInterval);
          localStorage.removeItem('lokal_active_job');
          document.getElementById('opsStatusText').textContent = 'Gagal: ' + (job.error || 'Error');
          toast('Operasi gagal: ' + (job.error || 'Terjadi kesalahan'));
        } else if (job.status === 'canceled') {
          clearInterval(jobPollInterval);
          localStorage.removeItem('lokal_active_job');
          document.getElementById('opsStatusText').textContent = 'Dibatalkan';
          toast('Operasi dibatalkan');
          setTimeout(hideOpsWidget, 1500);
        } else {
          document.getElementById('opsStatusText').textContent = 'Sedang berjalan…';
        }
      })
      .catch(() => {});
  }

  function cancelCurrentJob() {
    if (!activeJobId) return;
    fetch('/?action=cancel_job&id=' + encodeURIComponent(activeJobId), { method: 'POST' })
      .then(r => r.json())
      .then(() => toast('Membatalkan proses…'));
  }

  // Cek jika ada job yang sedang berjalan saat browser dibuka/direfresh
  window.addEventListener('DOMContentLoaded', () => {
    updateClipboardUI();
    const savedJob = JSON.parse(localStorage.getItem('lokal_active_job') || 'null');
    if (savedJob && savedJob.jobId) {
      trackJob(savedJob.jobId, savedJob.fileName, savedJob.title);
    }
  });

  ${canWrite ? `
  const dz = document.getElementById('dropZone');
  if (dz) {
    ['dragenter','dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); dz.classList.add('dragover'); }, false));
    ['dragleave','drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); dz.classList.remove('dragover'); }, false));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });
  }

  function uploadFiles(files) {
    if (!files || !files.length) return;
    const file = files[0];
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append('file' + i, files[i]);

    document.getElementById('opsHeaderTitle').textContent = 'Mengunggah File';
    document.getElementById('opsFileName').textContent = file.name + (files.length > 1 ? ' (+ ' + (files.length - 1) + ' file lainnya)' : '');
    document.getElementById('opsStatusText').textContent = 'Mengunggah ke server…';
    document.getElementById('opsBarFill').style.width = '0%';
    document.getElementById('opsPercentText').textContent = '0%';
    document.getElementById('opsCancelBtn').style.display = 'none';
    showOpsWidget();

    let startTime = Date.now();
    let lastTime = Date.now();
    let lastLoaded = 0;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/?action=upload&folder=' + encodeURIComponent(currentPath), true);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        document.getElementById('opsBarFill').style.width = pct + '%';
        document.getElementById('opsPercentText').textContent = pct + '%';
        document.getElementById('opsSizeText').textContent = formatBytes(e.loaded) + ' / ' + formatBytes(e.total);

        const now = Date.now();
        const diff = (now - lastTime) / 1000;
        if (diff >= 0.4) {
          const speed = (e.loaded - lastLoaded) / diff;
          const avgSpeed = e.loaded / ((now - startTime) / 1000);
          document.getElementById('opsSpeedText').textContent = formatBytes(speed) + '/s';
          document.getElementById('opsAvgSpeedText').textContent = formatBytes(avgSpeed) + '/s';
          const remaining = (e.total - e.loaded) / (avgSpeed || 1);
          document.getElementById('opsEtaText').textContent = formatTime(remaining);
          lastTime = now;
          lastLoaded = e.loaded;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        document.getElementById('opsBarFill').style.width = '100%';
        document.getElementById('opsPercentText').textContent = '100%';
        document.getElementById('opsStatusText').textContent = 'Selesai diunggah!';
        toast('File berhasil diunggah!');
        setTimeout(() => { hideOpsWidget(); location.reload(); }, 1000);
      } else {
        toast('Gagal: ' + xhr.responseText);
      }
    };

    xhr.onerror = () => {
      toast('Koneksi terputus saat mengunggah');
    };

    xhr.send(fd);
  }

  function openFolderModal() {
    document.getElementById('newFolderName').value = '';
    document.getElementById('folderModal').classList.add('active');
    setTimeout(() => document.getElementById('newFolderName').focus(), 50);
  }
  function closeFolderModal() {
    document.getElementById('folderModal').classList.remove('active');
  }
  function submitFolder() {
    const name = document.getElementById('newFolderName').value.trim();
    if (!name) return;
    fetch('/?action=mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: currentPath })
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        closeFolderModal();
        toast('Folder berhasil dibuat');
        location.reload();
      } else {
        alert('Gagal: ' + (res.error || '?'));
      }
    })
    .catch(err => alert('Error: ' + err.message));
  }

  function delItem(p, n) {
    if (!confirm('Hapus "' + n + '"? Tindakan ini tidak dapat dibatalkan.')) return;
    fetch('/?action=delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        toast('Item berhasil dihapus');
        location.reload();
      } else {
        alert('Gagal: ' + (res.error || '?'));
      }
    })
    .catch(err => alert('Error: ' + err.message));
  }
  ` : `
  function openFolderModal(){}function closeFolderModal(){}function submitFolder(){}function delItem(){}function uploadFiles(){}
  `}
</script>
</body>
</html>`;
}

// ─── HTTP SERVER HANDLER ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = decodeURIComponent(parsedUrl.pathname);

  // Disable Nagle algorithm agar streaming transfer langsung dikirim tanpa latency TCP
  req.socket.setNoDelay(true);

  // Ambil IP & Host Pengunjung
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const clientHost = req.headers.host || 'localhost';

  // ─ Parse Cookie & Session
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  const sessionToken = cookies['session_token'] || '';
  const session = sessionToken ? auth.getSession(sessionToken) : null;

  // ─ POST /login
  if (req.method === 'POST' && reqPath === '/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const attemptUser = params.get('username') || '';
      const result = auth.authenticateUser(attemptUser, params.get('password') || '');

      if (!result) {
        logActivity({ username: attemptUser, ip: clientIp, host: clientHost, action: 'LOGIN', details: 'Gagal (Password/Username salah)', status: 'FAILED' });
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderLoginPage({ errorMessage: 'Username atau password tidak valid.' }));
      }
      if (result.error) {
        logActivity({ username: attemptUser, ip: clientIp, host: clientHost, action: 'LOGIN', details: 'Ditolak: ' + result.error, status: 'BLOCKED' });
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderLoginPage({ blockedMessage: result.error }));
      }

      const token = auth.createSession(result.user.username);
      logActivity({ username: result.user.username, ip: clientIp, host: clientHost, action: 'LOGIN', details: 'Berhasil masuk ke sistem' });
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
    if (session) {
      logActivity({ username: session.username, ip: clientIp, host: clientHost, action: 'LOGOUT', details: 'Pengguna keluar dari sistem' });
    }
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

  // ─ GET /?action=log_info (Catat peninjauan properti/detail file oleh user)
  if (req.method === 'GET' && parsedUrl.searchParams.get('action') === 'log_info') {
    const itemPath = parsedUrl.searchParams.get('item') || '-';
    logActivity({
      username: userInfo.username,
      ip: clientIp,
      host: clientHost,
      action: 'VIEW_INFO',
      details: 'Melihat rincian properti (Alt+Enter): /' + itemPath.replace(/^\/+/, '')
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // ─ GET /?action=job_status (Polling background job)
  if (req.method === 'GET' && parsedUrl.searchParams.get('action') === 'job_status') {
    const jId = parsedUrl.searchParams.get('id');
    const j = activeJobs.get(jId);
    if (!j) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Job not found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      id: j.id,
      type: j.type,
      filename: j.filename,
      totalBytes: j.totalBytes,
      processedBytes: j.processedBytes,
      speedBps: Math.round(j.speedBps),
      avgSpeedBps: Math.round(j.avgSpeedBps),
      status: j.status,
      error: j.error
    }));
  }

  // ─ POST Actions
  if (req.method === 'POST') {
    const action = parsedUrl.searchParams.get('action');

    // Cancel job
    if (action === 'cancel_job') {
      const jId = parsedUrl.searchParams.get('id');
      const j = activeJobs.get(jId);
      if (j) {
        j.isCanceled = true;
        j.status = 'canceled';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    // High Speed Streaming Upload
    if (action === 'upload') {
      const folderParam = parsedUrl.searchParams.get('folder') || '';
      const targetDir = path.resolve(SHARED_DIR, folderParam.replace(/^\/+/, ''));
      const targetSub = path.relative(SHARED_DIR, targetDir);

      if (!auth.checkUserPermission(userInfo, targetSub, 'write')) {
        logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'UPLOAD', details: 'Ditolak (Izin tulis tidak ada): /' + targetSub, status: 'BLOCKED' });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin upload di direktori ini' }));
      }
      if (!isSafePath(targetDir) && targetDir !== SHARED_DIR) {
        logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'UPLOAD', details: 'Ditolak (Path tidak aman): ' + folderParam, status: 'BLOCKED' });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Path tidak aman' }));
      }

      handleUploadStream(req, targetDir, (err, count) => {
        if (err) {
          logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'UPLOAD', details: 'Gagal mengunggah ke /' + targetSub + ': ' + err.message, status: 'FAILED' });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
        logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'UPLOAD', details: `Berhasil mengunggah ${count} file ke /${targetSub || 'root'}` });
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

        // Paste (Copy / Move)
        if (action === 'paste') {
          const sourceSub = (data.sourcePath || '').replace(/^\/+/, '');
          const targetFolderSub = (data.targetDir || '').replace(/^\/+/, '');
          const operation = data.operation === 'move' ? 'move' : 'copy';
          const opName = operation === 'move' ? 'PINDAHKAN (Cut)' : 'SALIN (Copy)';

          const sourceAbs = path.resolve(SHARED_DIR, sourceSub);
          const targetDirAbs = path.resolve(SHARED_DIR, targetFolderSub);

          if (!isSafePath(sourceAbs) || (!isSafePath(targetDirAbs) && targetDirAbs !== SHARED_DIR)) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Ditolak (Path tidak aman): ${sourceSub} -> ${targetFolderSub}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Path tidak aman' }));
          }

          if (!auth.checkUserPermission(userInfo, sourceSub, 'read')) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Ditolak (Tidak ada izin baca sumber): /${sourceSub}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin membaca item sumber' }));
          }
          if (!auth.checkUserPermission(userInfo, targetFolderSub, 'write')) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Ditolak (Tidak ada izin tulis tujuan): /${targetFolderSub}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin menulis di folder tujuan' }));
          }
          if (operation === 'move') {
            const srcParentSub = path.relative(SHARED_DIR, path.dirname(sourceAbs));
            if (!auth.checkUserPermission(userInfo, srcParentSub, 'write')) {
              logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Ditolak (Tidak ada izin hapus/pindah dari folder asal): /${srcParentSub}`, status: 'BLOCKED' });
              res.writeHead(403, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin memindahkan item dari folder asal' }));
            }
          }

          if (!fs.existsSync(sourceAbs)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Item sumber tidak ditemukan' }));
          }

          const baseName = path.basename(sourceAbs);
          let destAbs = path.join(targetDirAbs, baseName);

          if (destAbs === sourceAbs) {
            if (operation === 'move') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: 'Tujuan sama dengan sumber' }));
            }
            const ext = path.extname(baseName);
            const nameWithoutExt = path.basename(baseName, ext);
            destAbs = path.join(targetDirAbs, `${nameWithoutExt} - Salinan${ext}`);
          }

          const totalSize = getDirOrFileSize(sourceAbs);

          // Fast path rename
          if (operation === 'move') {
            try {
              fs.renameSync(sourceAbs, destAbs);
              logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'PINDAHKAN (Move)', details: `Berhasil memindahkan /${sourceSub} ke /${path.relative(SHARED_DIR, destAbs)}` });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: true }));
            } catch {}
          }

          // Asynchronous background job
          const job = createJob({
            type: operation,
            source: sourceAbs,
            dest: destAbs,
            filename: baseName,
            totalBytes: totalSize
          });

          logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Memulai proses: /${sourceSub} -> /${path.relative(SHARED_DIR, destAbs)} (${formatSize(totalSize)})` });

          (async () => {
            try {
              await copyRecursiveWithProgress(sourceAbs, destAbs, (chunkBytes) => {
                updateJobProgress(job, chunkBytes);
              }, () => job.isCanceled);

              if (operation === 'move' && !job.isCanceled) {
                const stat = fs.statSync(sourceAbs);
                if (stat.isDirectory()) fs.rmSync(sourceAbs, { recursive: true, force: true });
                else fs.unlinkSync(sourceAbs);
              }
              job.status = 'completed';
              job.processedBytes = job.totalBytes;
              logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Selesai: /${sourceSub} -> /${path.relative(SHARED_DIR, destAbs)} (${formatSize(totalSize)})` });
            } catch (err) {
              if (job.isCanceled) {
                job.status = 'canceled';
                logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Dibatalkan oleh user: ${baseName}`, status: 'CANCELED' });
              } else {
                job.status = 'error';
                job.error = err.message;
                logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: opName, details: `Gagal proses ${baseName}: ${err.message}`, status: 'FAILED' });
              }
            }
          })();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, jobId: job.id }));
        }

        if (action === 'mkdir') {
          const folderName = (data.name || '').trim().replace(/[<>:"/\\|?*]/g, '_');
          const parentSub = (data.path || '').replace(/^\/+/, '');
          if (!folderName) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Nama folder kosong' })); }
          if (!auth.checkUserPermission(userInfo, parentSub, 'write')) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUAT_FOLDER', details: `Ditolak (Izin tulis tidak ada): /${parentSub}/${folderName}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin membuat folder di sini' }));
          }
          const targetPath = path.resolve(SHARED_DIR, parentSub, folderName);
          if (!isSafePath(targetPath)) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUAT_FOLDER', details: `Ditolak (Path tidak aman): ${folderName}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Path tidak diizinkan' }));
          }
          if (fs.existsSync(targetPath)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Folder sudah ada' })); }
          fs.mkdirSync(targetPath, { recursive: true });
          logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUAT_FOLDER', details: `Membuat folder baru: /${path.relative(SHARED_DIR, targetPath)}` });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (action === 'delete') {
          const itemSub = (data.path || '').replace(/^\/+/, '');
          const targetPath = path.resolve(SHARED_DIR, itemSub);
          if (!isSafePath(targetPath) || targetPath === SHARED_DIR) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'HAPUS', details: `Ditolak (Operasi tidak diizinkan): /${itemSub}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Operasi ditolak' }));
          }
          const parentSub = path.relative(SHARED_DIR, path.dirname(targetPath));
          if (!auth.checkUserPermission(userInfo, parentSub, 'write')) {
            logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'HAPUS', details: `Ditolak (Tidak ada izin hapus di folder ini): /${itemSub}`, status: 'BLOCKED' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Tidak ada izin menghapus di direktori ini' }));
          }
          if (!fs.existsSync(targetPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: 'Tidak ditemukan' })); }
          const stat = fs.statSync(targetPath);
          const isDir = stat.isDirectory();
          if (isDir) fs.rmSync(targetPath, { recursive: true, force: true });
          else fs.unlinkSync(targetPath);
          logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'HAPUS', details: `Menghapus ${isDir ? 'folder' : 'file'}: /${itemSub}` });
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
    return res.end(`<div style="font-family:sans-serif;text-align:center;padding:60px"><h2>404 — Tidak Ditemukan</h2><a href="/" style="color:#2563EB;text-decoration:none">&larr; Kembali ke Beranda</a></div>`);
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    if (!auth.checkUserPermission(userInfo, cleanSubPath, 'read')) {
      logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'AKSES_FILE', details: `Ditolak (Tidak ada izin): /${cleanSubPath}`, status: 'BLOCKED' });
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(userInfo.username, reqPath));
    }
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const forceDownload = parsedUrl.searchParams.get('download') === '1';
    const filename = path.basename(absolutePath);

    // Catat aksi download atau akses file
    if (forceDownload || !MIME_TYPES[ext]) {
      logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'UNDUH', details: `Mengunduh file: /${cleanSubPath} (${formatSize(stat.size)})` });
    } else {
      logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUKA_FILE', details: `Membuka file: /${cleanSubPath} (${formatSize(stat.size)})` });
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString(),
      'Accept-Ranges': 'bytes'
    };
    if (forceDownload || !MIME_TYPES[ext]) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
    }

    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(s, 10);
      const end = e ? parseInt(e, 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(absolutePath, { start, end, highWaterMark: 1024 * 1024 * 4 }).pipe(res);
    }
    res.writeHead(200, headers);
    return fs.createReadStream(absolutePath, { highWaterMark: 1024 * 1024 * 4 }).pipe(res);
  }

  if (stat.isDirectory()) {
    if (reqPath !== '/' && !reqPath.endsWith('/')) {
      res.writeHead(301, { Location: reqPath + '/' });
      return res.end();
    }

    if (!auth.checkUserPermission(userInfo, cleanSubPath, 'read')) {
      logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUKA_FOLDER', details: `Ditolak (Tidak ada izin): /${cleanSubPath || 'root'}`, status: 'BLOCKED' });
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(userInfo.username, reqPath));
    }

    // Catat kunjungan direktori
    logActivity({ username: userInfo.username, ip: clientIp, host: clientHost, action: 'BUKA_FOLDER', details: `Membuka direktori: /${cleanSubPath || 'root'}` });

    const canWrite = auth.checkUserPermission(userInfo, cleanSubPath, 'write');

    fs.readdir(absolutePath, { withFileTypes: true }, (err, items) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Gagal membaca direktori: ' + err.message);
      }

      const folders = [], files = [];
      for (const item of items) {
        try {
          const itemSubPath = (cleanSubPath ? cleanSubPath + '/' : '') + item.name;
          // Filter ketat: jika user tidak punya izin baca ke subpath ini, jangan tampilkan di browser
          if (!auth.checkUserPermission(userInfo, itemSubPath, 'read')) {
            continue;
          }

          const full = path.join(absolutePath, item.name);
          const s = fs.statSync(full);
          const d = {
            name: item.name,
            sizeFormatted: item.isDirectory() ? '--' : formatSize(s.size),
            rawSizeBytes: item.isDirectory() ? 0 : s.size,
            mtime: formatDate(s.mtime),
            fullMtime: formatFullDate(s.mtime),
            isDirectory: item.isDirectory()
          };
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
  console.log('  LAN Web File Explorer — Server Aktif (High-Speed Engine)');
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
