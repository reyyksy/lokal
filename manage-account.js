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

async function main() {
  while (true) {
    const action = await selectMenu('Menu Utama:', [
      { label: 'Lihat Daftar Akun', value: 'list' },
      { label: 'Tambah Akun Baru', value: 'add' },
      { label: 'Ubah Hak Akses Akun', value: 'role' },
      { label: 'Ganti Password Akun', value: 'password' },
      { label: 'Ubah Username Akun', value: 'username' },
      { label: 'Hapus Akun', value: 'delete' },
      { label: 'Keluar', value: 'exit' }
    ]);

    if (!action || action === 'exit') {
      console.clear();
      console.log('\x1b[32mSesi manajemen akun selesai.\x1b[0m\n');
      process.exit(0);
    }

    switch (action) {
      case 'list':     await handleListUsers(); break;
      case 'add':      await handleAddUser(); break;
      case 'role':     await handleChangeRole(); break;
      case 'password': await handleChangePassword(); break;
      case 'username': await handleChangeUsername(); break;
      case 'delete':   await handleDeleteUser(); break;
    }
  }
}

main().catch(err => {
  console.error('\nKesalahan fatal:', err.message);
  process.exit(1);
});
