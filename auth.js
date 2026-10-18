const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.resolve(__dirname, 'users.json');

// In-memory store for active sessions: token -> { username, createdAt, expiresAt }
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

function hashPassword(password, salt) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Gagal membaca users.json:', err.message);
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function getUserByUsername(username) {
  const users = loadUsers();
  return users.find(u => u.username.toLowerCase() === (username || '').trim().toLowerCase()) || null;
}

function authenticateUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;

  // Jika akun diblokir, tolak login
  if (user.role === 'blocked') {
    return { error: 'Akun Anda telah dinonaktifkan / diblokir.' };
  }

  if (verifyPassword(password, user.salt, user.hash)) {
    return { user: { username: user.username, role: user.role, allowedDirs: user.allowedDirs || [] } };
  }
  return null;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    username,
    createdAt: Date.now(),
    expiresAt
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (token) {
    sessions.delete(token);
  }
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

// Normalisasi subpath (misal: "docs/work" atau "photos")
function normalizeRelPath(subPath) {
  if (!subPath) return '';
  const clean = subPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return clean;
}

// Cek apakah target subpath berada di dalam atau sama dengan allowed subpath
function isSubPathOrEqual(target, allowed) {
  const t = normalizeRelPath(target);
  const a = normalizeRelPath(allowed);
  if (a === '') return true; // root access
  if (t === a) return true;
  return t.startsWith(a + '/');
}

// Cek apakah target subpath adalah leluhur (parent) dari allowed subpath
function isAncestorOf(target, allowed) {
  const t = normalizeRelPath(target);
  const a = normalizeRelPath(allowed);
  if (t === '') return false;
  return a.startsWith(t + '/');
}

/**
 * Memeriksa izin akses user terhadap target path.
 * action: 'read' (browse / download / streaming) atau 'write' (upload / mkdir / delete)
 */
function checkUserPermission(user, targetSubPath, action = 'read') {
  if (!user) return false;
  if (user.role === 'blocked') return false;

  const target = normalizeRelPath(targetSubPath);
  const allowedDirs = (user.allowedDirs || []).map(normalizeRelPath).filter(Boolean);

  switch (user.role) {
    case 'admin':
      return true;

    case 'read_only':
      return action === 'read';

    case 'dir_read_only':
      if (action !== 'read') return false;
      // Jika root '/', izinkan hanya sebagai wadah listing folder yang diizinkan (jika ada lebih dari 1 allowed dirs)
      if (target === '') return allowedDirs.length > 0;
      return allowedDirs.some(dir => isSubPathOrEqual(target, dir) || isAncestorOf(target, dir));

    case 'dir_read_write':
      if (action === 'read') {
        if (target === '') return allowedDirs.length > 0;
        return allowedDirs.some(dir => isSubPathOrEqual(target, dir) || isAncestorOf(target, dir));
      }
      if (action === 'write') {
        if (target === '') return false; // Dilarang menulis di root jika dibatasi direktori
        return allowedDirs.some(dir => isSubPathOrEqual(target, dir));
      }
      return false;

    case 'read_all_write_dir':
      if (action === 'read') return true;
      if (action === 'write') {
        if (target === '') return false;
        return allowedDirs.some(dir => isSubPathOrEqual(target, dir));
      }
      return false;

    case 'blocked':
    default:
      return false;
  }
}

// Menambahkan user baru
function addUser(username, password, role = 'admin', allowedDirs = []) {
  const cleanUsername = (username || '').trim();
  if (!cleanUsername) throw new Error('Username tidak boleh kosong');
  if (!password || password.length < 4) throw new Error('Password minimal 4 karakter');

  const validRoles = ['admin', 'read_only', 'dir_read_only', 'dir_read_write', 'read_all_write_dir', 'blocked'];
  if (!validRoles.includes(role)) {
    throw new Error('Role akses tidak valid');
  }

  const users = loadUsers();
  if (users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    throw new Error(`Username "${cleanUsername}" sudah digunakan`);
  }

  const { salt, hash } = hashPassword(password);
  const newUser = {
    username: cleanUsername,
    salt,
    hash,
    role,
    allowedDirs: allowedDirs.map(normalizeRelPath).filter(Boolean),
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);
  return newUser;
}

function updateUserRole(username, newRole, allowedDirs = []) {
  const cleanUsername = (username || '').trim();
  const validRoles = ['admin', 'read_only', 'dir_read_only', 'dir_read_write', 'read_all_write_dir', 'blocked'];
  if (!validRoles.includes(newRole)) {
    throw new Error('Role akses tidak valid');
  }

  const users = loadUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (index === -1) {
    throw new Error(`User "${cleanUsername}" tidak ditemukan`);
  }

  users[index].role = newRole;
  users[index].allowedDirs = allowedDirs.map(normalizeRelPath).filter(Boolean);
  users[index].updatedAt = new Date().toISOString();
  saveUsers(users);
}

function changePassword(username, newPassword) {
  const cleanUsername = (username || '').trim();
  if (!newPassword || newPassword.length < 4) throw new Error('Password minimal 4 karakter');

  const users = loadUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (index === -1) {
    throw new Error(`User "${cleanUsername}" tidak ditemukan`);
  }

  const { salt, hash } = hashPassword(newPassword);
  users[index].salt = salt;
  users[index].hash = hash;
  users[index].updatedAt = new Date().toISOString();
  saveUsers(users);
}

function changeUsername(oldUsername, newUsername) {
  const oldClean = (oldUsername || '').trim();
  const newClean = (newUsername || '').trim();
  if (!newClean) throw new Error('Username baru tidak boleh kosong');

  const users = loadUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === oldClean.toLowerCase());
  if (index === -1) {
    throw new Error(`User "${oldClean}" tidak ditemukan`);
  }

  if (users.some(u => u.username.toLowerCase() === newClean.toLowerCase() && u.username.toLowerCase() !== oldClean.toLowerCase())) {
    throw new Error(`Username "${newClean}" sudah digunakan`);
  }

  users[index].username = newClean;
  users[index].updatedAt = new Date().toISOString();
  saveUsers(users);
}

function deleteUser(username) {
  const cleanUsername = (username || '').trim();
  const users = loadUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (index === -1) {
    throw new Error(`User "${cleanUsername}" tidak ditemukan`);
  }

  users.splice(index, 1);
  saveUsers(users);
}

function deleteAllUsers() {
  saveUsers([]);
}

module.exports = {
  USERS_FILE,
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
  getUserByUsername,
  authenticateUser,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  normalizeRelPath,
  checkUserPermission,
  addUser,
  updateUserRole,
  changePassword,
  changeUsername,
  deleteUser,
  deleteAllUsers
};
