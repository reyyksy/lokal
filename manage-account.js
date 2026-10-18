#!/usr/bin/env node
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const SHARED_DIR = path.resolve(__dirname, 'shared');

// Daftar role lengkap dengan penjelasan
const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'Admin Penuh',
    desc: 'Bisa baca & tulis semua direktori'
  },
  {
    value: 'read_only',
    label: 'Lihat Semua (Hanya Baca)',
    desc: 'Bisa melihat & download semua direktori, tidak bisa upload/hapus/buat folder'
  },
  {
    value: 'dir_read_only',
    label: 'Lihat Direktori Tertentu (Hanya Baca)',
    desc: 'Hanya bisa melihat & download di folder-folder yang ditentukan'
  },
  {
    value: 'dir_read_write',
    label: 'Edit Direktori Tertentu (Baca & Tulis)',
    desc: 'Hanya bisa membaca & menulis di folder-folder yang ditentukan'
  },
  {
    value: 'read_all_write_dir',
    label: 'Lihat Semua, Edit Direktori Tertentu',
    desc: 'Bisa melihat semua, tetapi hanya bisa upload/hapus di folder-folder tertentu'
  },
  {
    value: 'blocked',
    label: 'Blokir Akun',
    desc: 'Akun dinonaktifkan, tidak bisa login sama sekali'
  }
];

const ROLE_LABELS = {
  admin: 'Admin Penuh',
  read_only: 'Lihat Semua (Hanya Baca)',
  dir_read_only: 'Lihat Direktori Tertentu',
  dir_read_write: 'Edit Direktori Tertentu',
  read_all_write_dir: 'Lihat Semua + Edit Direktori Tertentu',
  blocked: 'Diblokir'
};

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(question, isPassword = false) {
  return new Promise((resolve) => {
    if (!isPassword) {
      const rl = createPrompt();
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stdout.write(question);
    const stdin = process.stdin;
    const rl = readline.createInterface({ input: stdin, output: process.stdout });
    const oldRawMode = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    let password = '';
    const onData = (char) => {
      char = char.toString('utf8');
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          if (stdin.setRawMode) stdin.setRawMode(oldRawMode);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(password.trim());
          break;
        case '\u0003':
          if (stdin.setRawMode) stdin.setRawMode(oldRawMode);
          console.clear();
          console.log('\x1b[32mKeluar dari pengelola akun.\x1b[0m\n');
          process.exit();
          break;
        case '\u0008':
        case '\x7f':
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          password += char;
          process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function renderHeader() {
  console.clear();
  console.log('\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m\x1b[36m║         LAN FILE EXPLORER — MANAJEMEN AKUN TERMINAL          ║\x1b[0m');
  console.log('\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m');
}

function selectMenu(title, options, subTitle = '') {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      renderHeader();
      console.log(`\x1b[33m${title}\x1b[0m\n`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}. ${opt.label}`));
      const rl = createPrompt();
      rl.question('\nPilih nomor: ', (ans) => {
        rl.close();
        const num = parseInt(ans, 10) - 1;
        resolve((num >= 0 && num < options.length) ? options[num].value : null);
      });
      return;
    }

    readline.emitKeypressEvents(stdin);
    const oldRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function render() {
      renderHeader();
      console.log(`\x1b[1m\x1b[33m${title}\x1b[0m`);
      if (subTitle) console.log(`\x1b[90m${subTitle}\x1b[0m`);
      console.log('\x1b[90m↑ / ↓  Navigasi   Enter  Pilih   Ctrl+C  Keluar\x1b[0m\n');
      options.forEach((opt, index) => {
        if (index === selectedIndex) {
          const desc = opt.desc ? `\x1b[90m  └─ ${opt.desc}\x1b[0m` : '';
          console.log(`  \x1b[1m\x1b[32m❯ ◉ ${opt.label}\x1b[0m${desc ? '\n' + desc : ''}`);
        } else {
          console.log(`    ○ ${opt.label}`);
          if (opt.desc) console.log(`\x1b[90m       ${opt.desc}\x1b[0m`);
        }
      });
      console.log('');
    }

    function cleanup() {
      stdin.removeListener('keypress', onKeyPress);
      stdin.setRawMode(oldRawMode);
    }

    function onKeyPress(str, key) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        console.clear();
        console.log('\x1b[32mKeluar dari pengelola akun.\x1b[0m\n');
        process.exit();
      }
      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(options[selectedIndex].value);
      }
    }

    stdin.on('keypress', onKeyPress);
    render();
  });
}

function pause() {
  return new Promise((resolve) => {
    const rl = createPrompt();
    rl.question('\n\x1b[90mTekan Enter untuk melanjutkan...\x1b[0m', () => {
      rl.close();
      resolve();
    });
  });
}

// Mendapatkan daftar subfolder level 1 dari shared directory
function getAvailableSubDirs() {
  try {
    if (!fs.existsSync(SHARED_DIR)) return [];
    const entries = fs.readdirSync(SHARED_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

// Meminta user memilih & mengetik direktori yang diizinkan
async function promptAllowedDirs() {
  const subDirs = getAvailableSubDirs();

  renderHeader();
  console.log('\x1b[1m\x1b[33mATUR DIREKTORI YANG DIIZINKAN\x1b[0m');
  console.log('\x1b[90mMasukkan path relatif dari folder "shared", contoh: dokumen atau foto/album\x1b[0m');
  if (subDirs.length > 0) {
    console.log(`\x1b[90mFolder di shared/ yang ada saat ini: \x1b[36m${subDirs.join(', ')}\x1b[0m`);
  } else {
    console.log('\x1b[90m(Belum ada subfolder di shared/. Anda bisa mengetik nama folder yang akan dibuat nanti.)\x1b[0m');
  }
  console.log('\x1b[90mPisahkan beberapa direktori dengan koma. Biarkan kosong untuk root.\x1b[0m\n');

  const input = await ask('Direktori yang diizinkan: ');
  if (!input) return [];

  return input.split(',').map(d => d.trim()).filter(Boolean);
}

// --- HANDLER MENU ---

async function handleListUsers() {
  renderHeader();
  console.log('\x1b[1m\x1b[34m─── DAFTAR AKUN TERDAFTAR ───\x1b[0m\n');
  const users = auth.loadUsers();
  if (users.length === 0) {
    console.log('\x1b[33mBelum ada akun yang terdaftar.\x1b[0m');
    console.log('\x1b[90mGunakan menu "Tambah Akun Baru" untuk membuat akun pertama.\x1b[0m');
    console.log('\x1b[90mSelama tidak ada akun, web tidak bisa diakses oleh siapa pun.\x1b[0m');
  } else {
    const line = '─'.repeat(72);
    console.log(line);
    console.log(`${'No'.padEnd(4)} ${'Username'.padEnd(20)} ${'Role Akses'.padEnd(30)} ${'Dibuat'}`);
    console.log(line);
    users.forEach((u, i) => {
      const roleName = ROLE_LABELS[u.role] || u.role || '-';
      const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleString('id-ID') : '-';
      const dirs = (u.allowedDirs && u.allowedDirs.length > 0) ? `\n       \x1b[90m└─ Direktori: ${u.allowedDirs.join(', ')}\x1b[0m` : '';
      const statusColor = u.role === 'blocked' ? '\x1b[31m' : u.role === 'admin' ? '\x1b[33m' : '\x1b[32m';
      console.log(
        `\x1b[1m${String(i + 1).padEnd(4)}\x1b[0m` +
        `${u.username.padEnd(20)}` +
        `${statusColor}${roleName.padEnd(30)}\x1b[0m` +
        `${dateStr}` +
        dirs
      );
    });
    console.log(line);
    console.log(`\nTotal: ${users.length} akun\n`);
  }
  await pause();
}

async function handleAddUser() {
  renderHeader();
  console.log('\x1b[1m\x1b[32m─── TAMBAH AKUN BARU ───\x1b[0m\n');
  const username = await ask('Username baru: ');
  if (!username) {
    console.log('\x1b[31m✖ Username tidak boleh kosong.\x1b[0m');
    await pause();
    return;
  }

  const password = await ask('Password (min. 4 karakter): ', true);
  if (!password || password.length < 4) {
    console.log('\x1b[31m✖ Password minimal 4 karakter.\x1b[0m');
    await pause();
    return;
  }

  const confirm = await ask('Ulangi password: ', true);
  if (password !== confirm) {
    console.log('\x1b[31m✖ Password konfirmasi tidak cocok.\x1b[0m');
    await pause();
    return;
  }

  // Pilih role akses
  const role = await selectMenu(
    `Pilih Hak Akses untuk "${username}":`,
    ROLE_OPTIONS,
    'Setiap role menentukan apa yang bisa dilakukan user di web'
  );
  if (!role) return;

  let allowedDirs = [];
  if (['dir_read_only', 'dir_read_write', 'read_all_write_dir'].includes(role)) {
    allowedDirs = await promptAllowedDirs();
  }

  try {
    auth.addUser(username, password, role, allowedDirs);
    renderHeader();
    console.log(`\x1b[32m✔ Akun berhasil dibuat!\x1b[0m\n`);
    const roleName = ROLE_LABELS[role] || role;
    console.log(`  Username : \x1b[1m${username}\x1b[0m`);
    console.log(`  Hak Akses: \x1b[33m${roleName}\x1b[0m`);
    if (allowedDirs.length > 0) {
      console.log(`  Direktori: \x1b[36m${allowedDirs.join(', ')}\x1b[0m`);
    }
  } catch (err) {
    console.log(`\n\x1b[31m✖ Gagal: ${err.message}\x1b[0m`);
  }
  await pause();
}

async function handleChangePassword() {
  const users = auth.loadUsers();
  if (users.length === 0) {
    renderHeader();
    console.log('\x1b[33mBelum ada akun.\x1b[0m');
    await pause();
    return;
  }

  const options = users.map(u => ({ label: u.username, value: u.username }));
  options.push({ label: '← Kembali', value: '__back__' });
  const selectedUser = await selectMenu('Pilih akun untuk diganti passwordnya:', options);
  if (!selectedUser || selectedUser === '__back__') return;

  renderHeader();
  console.log(`\x1b[1m\x1b[33m─── GANTI PASSWORD: ${selectedUser} ───\x1b[0m\n`);
  const newPass = await ask('Password baru: ', true);
  if (!newPass || newPass.length < 4) {
    console.log('\x1b[31m✖ Password minimal 4 karakter.\x1b[0m');
    await pause();
    return;
  }

  const confirm = await ask('Ulangi password baru: ', true);
  if (newPass !== confirm) {
    console.log('\x1b[31m✖ Password konfirmasi tidak cocok.\x1b[0m');
    await pause();
    return;
  }

  try {
    auth.changePassword(selectedUser, newPass);
    console.log(`\n\x1b[32m✔ Password untuk "${selectedUser}" berhasil diperbarui!\x1b[0m`);
  } catch (err) {
    console.log(`\n\x1b[31m✖ Gagal: ${err.message}\x1b[0m`);
  }
  await pause();
}

async function handleChangeUsername() {
  const users = auth.loadUsers();
  if (users.length === 0) {
    renderHeader();
    console.log('\x1b[33mBelum ada akun.\x1b[0m');
    await pause();
    return;
  }

  const options = users.map(u => ({ label: u.username, value: u.username }));
  options.push({ label: '← Kembali', value: '__back__' });
  const selectedUser = await selectMenu('Pilih akun untuk diubah usernamenya:', options);
  if (!selectedUser || selectedUser === '__back__') return;

  renderHeader();
  console.log(`\x1b[1m\x1b[33m─── UBAH USERNAME: ${selectedUser} ───\x1b[0m\n`);
  const newUsername = await ask('Username baru: ');
  if (!newUsername) {
    console.log('\x1b[31m✖ Username baru tidak boleh kosong.\x1b[0m');
    await pause();
    return;
  }

  try {
    auth.changeUsername(selectedUser, newUsername);
    console.log(`\n\x1b[32m✔ Username berhasil diubah dari "${selectedUser}" menjadi "${newUsername}"!\x1b[0m`);
  } catch (err) {
    console.log(`\n\x1b[31m✖ Gagal: ${err.message}\x1b[0m`);
  }
  await pause();
}

async function handleChangeRole() {
  const users = auth.loadUsers();
  if (users.length === 0) {
    renderHeader();
    console.log('\x1b[33mBelum ada akun.\x1b[0m');
    await pause();
    return;
  }

  const userOptions = users.map(u => {
    const roleName = ROLE_LABELS[u.role] || u.role || '-';
    return { label: `${u.username}   \x1b[90m[${roleName}]\x1b[0m`, value: u.username };
  });
  userOptions.push({ label: '← Kembali', value: '__back__' });
  const selectedUser = await selectMenu('Pilih akun untuk diubah hak aksesnya:', userOptions);
  if (!selectedUser || selectedUser === '__back__') return;

  const newRole = await selectMenu(
    `Pilih Hak Akses Baru untuk "${selectedUser}":`,
    ROLE_OPTIONS,
    'Setiap role menentukan apa yang bisa dilakukan user di web'
  );
  if (!newRole) return;

  let allowedDirs = [];
  if (['dir_read_only', 'dir_read_write', 'read_all_write_dir'].includes(newRole)) {
    allowedDirs = await promptAllowedDirs();
  }

  try {
    auth.updateUserRole(selectedUser, newRole, allowedDirs);
    renderHeader();
    const roleName = ROLE_LABELS[newRole] || newRole;
    console.log(`\x1b[32m✔ Hak akses "${selectedUser}" berhasil diperbarui!\x1b[0m`);
    console.log(`  Role baru : \x1b[33m${roleName}\x1b[0m`);
    if (allowedDirs.length > 0) {
      console.log(`  Direktori : \x1b[36m${allowedDirs.join(', ')}\x1b[0m`);
    }
  } catch (err) {
    console.log(`\n\x1b[31m✖ Gagal: ${err.message}\x1b[0m`);
  }
  await pause();
}

async function handleDeleteUser() {
  const users = auth.loadUsers();
  if (users.length === 0) {
    renderHeader();
    console.log('\x1b[33mBelum ada akun yang bisa dihapus.\x1b[0m');
    await pause();
    return;
  }

  const options = users.map(u => ({
    label: `${u.username}   \x1b[90m[${ROLE_LABELS[u.role] || u.role}]\x1b[0m`,
    value: u.username
  }));
  options.push({ label: '← Kembali', value: '__back__' });

  const selectedUser = await selectMenu('Pilih akun yang akan DIHAPUS:', options);
  if (!selectedUser || selectedUser === '__back__') return;

  renderHeader();
  console.log(`\x1b[1m\x1b[31m─── HAPUS AKUN: ${selectedUser} ───\x1b[0m\n`);
  console.log('\x1b[31mTindakan ini tidak bisa dibatalkan!\x1b[0m\n');
  const confirm = await ask(`Ketik username "${selectedUser}" untuk konfirmasi penghapusan: `);
  if (confirm === selectedUser) {
    try {
      auth.deleteUser(selectedUser);
      console.log(`\n\x1b[32m✔ Akun "${selectedUser}" berhasil dihapus!\x1b[0m`);
    } catch (err) {
      console.log(`\n\x1b[31m✖ Gagal menghapus: ${err.message}\x1b[0m`);
    }
  } else {
    console.log('\n\x1b[33mKonfirmasi tidak cocok. Penghapusan dibatalkan.\x1b[0m');
  }
  await pause();
}

// ─── TRAFFIC LOG VIEWER ───────────────────────────────────────────────────────
const LOG_FILE = path.resolve(__dirname, 'traffic.log');

const ACTION_COLORS = {
  LOGIN:          '\x1b[32m', // hijau
  LOGOUT:         '\x1b[90m', // abu
  UPLOAD:         '\x1b[34m', // biru
  UNDUH:          '\x1b[36m', // cyan
  BUKA_FILE:      '\x1b[37m', // putih
  BUKA_FOLDER:    '\x1b[37m', // putih
  BUAT_FOLDER:    '\x1b[34m', // biru
  'SALIN (Copy)': '\x1b[33m', // kuning
  'PINDAHKAN (Cut)': '\x1b[33m',
  'PINDAHKAN (Move)': '\x1b[33m',
  HAPUS:          '\x1b[31m', // merah
  VIEW_INFO:      '\x1b[35m', // ungu
  AKSES_FILE:     '\x1b[31m', // merah
};

const STATUS_COLORS = {
  SUCCESS:  '\x1b[32m',
  FAILED:   '\x1b[31m',
  BLOCKED:  '\x1b[31m',
  CANCELED: '\x1b[33m',
};

function padEnd(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length);
}

function formatTrafficTime(isoStr) {
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return isoStr || '-';
  }
}

function renderTrafficTable(entries, title = 'LALU LINTAS PENGGUNA') {
  renderHeader();
  console.log(`\x1b[1m\x1b[33m─── ${title} ───\x1b[0m`);
  console.log(`\x1b[90mTotal entri: ${entries.length}\x1b[0m\n`);

  if (entries.length === 0) {
    console.log('\x1b[33mBelum ada catatan lalu lintas.\x1b[0m\n');
    return;
  }

  // Header tabel
  const hWaktu  = padEnd('WAKTU', 19);
  const hUser   = padEnd('USERNAME', 14);
  const hIp     = padEnd('IP', 15);
  const hAksi   = padEnd('AKSI', 20);
  const hDetail = 'DETAIL / KETERANGAN';
  console.log(`\x1b[1m\x1b[90m  ${hWaktu}  ${hUser}  ${hIp}  ${hAksi}  ${hDetail}\x1b[0m`);
  console.log(`\x1b[90m  ${'─'.repeat(19)}  ${'─'.repeat(14)}  ${'─'.repeat(15)}  ${'─'.repeat(20)}  ${'─'.repeat(40)}\x1b[0m`);

  for (const entry of entries) {
    const waktu  = padEnd(formatTrafficTime(entry.timestamp), 19);
    const user   = padEnd(entry.username, 14);
    const ip     = padEnd(entry.ip, 15);
    const aksi   = padEnd(entry.action, 20);
    const detail = (entry.details || '-').substring(0, 70);
    const status = entry.status && entry.status !== 'SUCCESS' ? ` [${entry.status}]` : '';

    const ac = ACTION_COLORS[entry.action] || '\x1b[37m';
    const sc = STATUS_COLORS[entry.status] || '';

    console.log(`  \x1b[90m${waktu}\x1b[0m  \x1b[1m${user}\x1b[0m  \x1b[36m${ip}\x1b[0m  ${ac}${aksi}\x1b[0m  \x1b[37m${detail}\x1b[0m${sc ? sc + status + '\x1b[0m' : ''}`);
  }
  console.log('');
}

function readTrafficLog(maxEntries = 100) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch {}
    }
    // Kembalikan N entri terakhir
    return parsed.slice(-maxEntries);
  } catch {
    return [];
  }
}

async function handleViewTraffic() {
  while (true) {
    const action = await selectMenu('Lalu Lintas Pengguna (Traffic Log):', [
      { label: '100 Aktivitas Terbaru', value: '100', desc: 'Tampilkan 100 entri terakhir dari log' },
      { label: '500 Aktivitas Terbaru', value: '500', desc: 'Tampilkan 500 entri terakhir dari log' },
      { label: 'Semua Aktivitas',        value: 'all', desc: 'Tampilkan seluruh riwayat (bisa panjang!)' },
      { label: 'Filter per Username',    value: 'filter_user', desc: 'Tampilkan aktivitas pengguna tertentu' },
      { label: 'Filter per Aksi',        value: 'filter_action', desc: 'Contoh: LOGIN, UNDUH, HAPUS, dll' },
      { label: 'Hapus Semua Log',        value: 'clear', desc: '⚠ Ini akan menghapus seluruh riwayat secara permanen' },
      { label: '← Kembali ke Menu Utama', value: '__back__' }
    ]);

    if (!action || action === '__back__') return;

    if (action === '100' || action === '500' || action === 'all') {
      const max = action === 'all' ? Infinity : parseInt(action, 10);
      const entries = max === Infinity
        ? readTrafficLog(999999)
        : readTrafficLog(max);
      renderTrafficTable(entries, `${max === 999999 ? 'SEMUA' : max} AKTIVITAS TERBARU`);
      await pause();
      continue;
    }

    if (action === 'filter_user') {
      renderHeader();
      const uname = await ask('Masukkan username yang ingin dicari: ');
      if (!uname.trim()) continue;
      const all = readTrafficLog(999999);
      const filtered = all.filter(e => (e.username || '').toLowerCase().includes(uname.toLowerCase()));
      renderTrafficTable(filtered, `AKTIVITAS USER: ${uname} (${filtered.length} entri)`);
      await pause();
      continue;
    }

    if (action === 'filter_action') {
      renderHeader();
      console.log('\x1b[90mAksi yang tersedia: LOGIN, LOGOUT, UPLOAD, UNDUH, BUKA_FILE, BUKA_FOLDER, BUAT_FOLDER, HAPUS, SALIN (Copy), PINDAHKAN (Move), VIEW_INFO\x1b[0m\n');
      const aksi = await ask('Masukkan nama aksi yang ingin dicari: ');
      if (!aksi.trim()) continue;
      const all = readTrafficLog(999999);
      const filtered = all.filter(e => (e.action || '').toLowerCase().includes(aksi.toLowerCase()));
      renderTrafficTable(filtered, `FILTER AKSI: ${aksi} (${filtered.length} entri)`);
      await pause();
      continue;
    }

    if (action === 'clear') {
      renderHeader();
      console.log('\x1b[1m\x1b[31m⚠  HAPUS SEMUA LOG LALU LINTAS ⚠\x1b[0m\n');
      console.log('\x1b[31mSeluruh riwayat aktivitas pengguna akan dihapus permanen!\x1b[0m\n');
      const conf = await ask('Ketik "HAPUS" untuk konfirmasi: ');
      if (conf === 'HAPUS') {
        try {
          fs.writeFileSync(LOG_FILE, '', 'utf8');
          console.log('\n\x1b[32m✔ Semua log lalu lintas berhasil dihapus.\x1b[0m');
        } catch (err) {
          console.log(`\n\x1b[31m✖ Gagal menghapus log: ${err.message}\x1b[0m`);
        }
      } else {
        console.log('\n\x1b[33mKonfirmasi tidak cocok. Log tidak dihapus.\x1b[0m');
      }
      await pause();
      continue;
    }
  }
}

// ─── MAIN MENU ─────────────────────────────────────────────────────────────
async function handleStartServer() {
  renderHeader();
  console.log('\x1b[1m\x1b[33m─── JALANKAN SERVER ───\x1b[0m\n');
  console.log('\x1b[37mServer akan dijalankan di latar belakang terminal ini.\x1b[0m');
  console.log('\x1b[90mGunakan Ctrl+C untuk menghentikan server saat berjalan.\x1b[0m\n');
  const { execSync } = require('child_process');
  const confirm = await ask('Tekan Enter untuk menjalankan server (atau ketik "batal" untuk membatalkan): ');
  if (confirm.toLowerCase() === 'batal') return;
  console.log('\n\x1b[32m▶  Menjalankan: node server.js\x1b[0m\n');
  try {
    // Jalankan server di proses yang sama (blocking) sehingga Ctrl+C menghentikannya
    const { spawnSync } = require('child_process');
    const result = spawnSync('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env
    });
    if (result.error) console.log('\n\x1b[31m✖ Gagal menjalankan server: ' + result.error.message + '\x1b[0m');
    else console.log('\n\x1b[33mServer dihentikan.\x1b[0m');
  } catch (err) {
    console.log('\n\x1b[31m✖ Error: ' + err.message + '\x1b[0m');
  }
  await pause();
}

async function main() {
  while (true) {
    const action = await selectMenu('Menu Utama:', [
      { label: '▶  Jalankan Server',                        value: 'start',   desc: 'Mulai LAN File Server di port 3000' },
      { label: '👥 Lihat Daftar Akun',                      value: 'list',    desc: 'Tampilkan semua akun pengguna terdaftar' },
      { label: '➕ Tambah Akun Baru',                        value: 'add',     desc: 'Daftarkan pengguna baru dengan role tertentu' },
      { label: '🔐 Ubah Hak Akses Akun',                    value: 'role',    desc: 'Ubah role dan direktori yang diizinkan' },
      { label: '🔑 Ganti Password Akun',                     value: 'password',desc: 'Reset password pengguna' },
      { label: '✏  Ubah Username Akun',                     value: 'username',desc: 'Ganti nama login pengguna' },
      { label: '🗑  Hapus Akun',                             value: 'delete',  desc: 'Hapus akun pengguna secara permanen' },
      { label: '📊 Lalu Lintas Pengguna (Traffic Log)',      value: 'traffic', desc: 'Lihat riwayat aktivitas semua pengguna' },
      { label: '🚪 Keluar',                                  value: 'exit' }
    ]);

    if (!action || action === 'exit') {
      console.clear();
      console.log('\x1b[32mSesi manajemen akun selesai.\x1b[0m\n');
      process.exit(0);
    }

    switch (action) {
      case 'start':    await handleStartServer(); break;
      case 'list':     await handleListUsers(); break;
      case 'add':      await handleAddUser(); break;
      case 'role':     await handleChangeRole(); break;
      case 'password': await handleChangePassword(); break;
      case 'username': await handleChangeUsername(); break;
      case 'delete':   await handleDeleteUser(); break;
      case 'traffic':  await handleViewTraffic(); break;
    }
  }
}

main().catch(err => {
  console.error('\nKesalahan fatal:', err.message);
  process.exit(1);
});
