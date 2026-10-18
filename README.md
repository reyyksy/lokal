# 🗂 LAN File Explorer

Server file berbasis browser untuk jaringan LAN, dibuat dengan **Node.js murni** (tanpa dependensi eksternal). Dirancang untuk transfer file berukuran besar (ISO Linux, VMDK, dll) dengan kecepatan tinggi melalui streaming langsung ke disk.

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|-------|-----------|
| **High-Speed Transfer** | Upload/download via streaming 4MB chunk — tidak ada buffering di RAM |
| **Progress Widget** | Kotak status Linux-Explorer-style: nama file, %, kecepatan, kecepatan rata-rata, ETA |
| **Transfer Tetap Berjalan** | Refresh browser tidak memutus proses copy/paste yang sedang berjalan |
| **Copy / Cut / Paste** | Operasi file/folder dengan progress di background job |
| **Upload Drag & Drop** | Seret file ke zona upload, progress real-time ditampilkan |
| **Info Detail File** | Modal properti (nama, tipe, ukuran, path, tanggal) — shortcut `Alt+Enter` |
| **Manajemen Akun** | Tambah/ubah/hapus user, atur role dan direktori yang diizinkan |
| **Isolasi Direktori Ketat** | User hanya bisa melihat & mengakses folder yang diizinkan admin |
| **Traffic Log Persisten** | Semua aktivitas pengguna dicatat ke `traffic.log` meski server dimatikan |
| **Pemantau Lalu Lintas** | Lihat riwayat: login, download, upload, hapus, copy, paste, buka folder, dll |

---

## 🚀 Cara Menjalankan

### Linux / macOS
```bash
# Clone (sekali saja)
git clone <URL_REPO>
cd lokal

# Jalankan launcher interaktif
./server.sh

# Atau langsung jalankan server
node server.js

# Atau langsung buka menu manajemen
node manage-account.js
```

### Windows
```bat
REM Double-klik file server.bat
REM Atau jalankan di Command Prompt:
server.bat
```

> **Syarat:** [Node.js](https://nodejs.org/) terinstall. Tidak perlu `npm install` — tidak ada dependensi eksternal.

### Menggunakan Alias (Debian/Ubuntu)
Jika sudah dikonfigurasi alias di `.bashrc` / `.zshrc`:
```bash
server    # langsung buka menu launcher dari direktori manapun
```

---

## 📁 Struktur Direktori

```
lokal/
├── server.js          ← Web server utama (port 3000)
├── manage-account.js  ← CLI manajemen akun & traffic log
├── auth.js            ← Autentikasi, sesi, RBAC
├── users.json         ← Database akun pengguna (auto-dibuat)
├── traffic.log        ← Riwayat aktivitas pengguna (auto-dibuat)
├── shared/            ← Folder yang dibagikan lewat browser
├── server.sh          ← Launcher Linux/macOS
└── server.bat         ← Launcher Windows
```

---

## 🌐 Akses Browser

Setelah server berjalan, buka di browser:

| Akses | URL |
|-------|-----|
| Lokal | `http://localhost:3000` |
| Jaringan LAN | `http://<IP-Server>:3000` |

---

## 👥 Manajemen Akun

Buka menu manajemen dengan salah satu cara:
```bash
./server.sh          # pilih opsi 2
node manage-account.js
```

### Role yang Tersedia

| Role | Keterangan |
|------|-----------|
| `admin` | Baca & tulis semua direktori |
| `read_only` | Lihat & download semua, tidak bisa upload/hapus |
| `dir_read_only` | Hanya bisa lihat & download di folder tertentu |
| `dir_read_write` | Baca & tulis hanya di folder tertentu |
| `read_all_write_dir` | Lihat semua, tulis hanya di folder tertentu |
| `blocked` | Akun dinonaktifkan, tidak bisa login |

### Isolasi Direktori

Jika user dibatasi ke direktori tertentu (misal: `folder-A`, `folder-B`):
- Saat login, hanya `folder-A` dan `folder-B` yang tampil
- Mengakses URL folder lain langsung (`/folder-C/`) → **403 Forbidden**
- Bypass via URL tidak bisa — server memverifikasi izin di setiap request

---

## 📊 Lalu Lintas Pengguna (Traffic Log)

Semua aktivitas pengguna dicatat secara persisten ke `traffic.log` (format JSON per baris). Log tetap ada meski server dimatikan dan di-restart.

### Aksi yang Dicatat

| Aksi | Keterangan |
|------|-----------|
| `LOGIN` | Login berhasil / gagal / diblokir |
| `LOGOUT` | User keluar |
| `BUKA_FOLDER` | Membuka / menelusuri direktori |
| `BUKA_FILE` | Membuka file di browser |
| `UNDUH` | Download file |
| `UPLOAD` | Upload file ke server |
| `SALIN (Copy)` | Operasi salin file/folder |
| `PINDAHKAN (Move)` | Operasi pindah/cut file/folder |
| `BUAT_FOLDER` | Membuat folder baru |
| `HAPUS` | Menghapus file atau folder |
| `VIEW_INFO` | Melihat properti detail file (Alt+Enter) |
| `AKSES_FILE` | Akses file yang ditolak (403) |

### Cara Melihat Log

```bash
node manage-account.js
# Pilih: 📊 Lalu Lintas Pengguna (Traffic Log)
```

**Filter tersedia:**
- 100 / 500 aktivitas terbaru
- Semua aktivitas
- Filter per username
- Filter per jenis aksi
- Hapus semua log

---

## ⌨️ Shortcut Keyboard (Browser)

| Shortcut | Fungsi |
|----------|--------|
| `Alt + Enter` | Buka detail properti item yang dipilih |

---

## 🔒 Keamanan

- Semua endpoint diproteksi login (session cookie `HttpOnly`)
- Path traversal dicegah (`isSafePath` check)
- Akses direktori yang tidak diizinkan → 403 Forbidden (tidak bisa di-bypass via URL)
- Password disimpan sebagai hash (bcrypt-style via `auth.js`)
- Akun `blocked` tidak bisa login

---

## ⚡ Arsitektur Transfer Kecepatan Tinggi

- **Upload**: Streaming multipart parser langsung tulis ke disk (buffer 4MB), tidak ada buffering ke RAM
- **Download**: `fs.createReadStream` dengan `highWaterMark: 4MB`, mendukung HTTP Range request (resume)
- **Copy/Paste**: Background job dengan `COPYFILE_FICLONE` (reflink btrfs/zfs) → fallback 4MB stream chunks
- **Progress Widget**: Polling `/?action=job_status` setiap 800ms, data disimpan di `localStorage` — refresh browser tidak memutus operasi

---

## 📝 Contoh `traffic.log`

```json
{"timestamp":"2025-01-15T08:30:00.000Z","username":"admin","ip":"192.168.1.5","host":"192.168.1.1:3000","action":"LOGIN","details":"Berhasil masuk ke sistem","status":"SUCCESS"}
{"timestamp":"2025-01-15T08:30:10.000Z","username":"admin","ip":"192.168.1.5","host":"192.168.1.1:3000","action":"BUKA_FOLDER","details":"Membuka direktori: /root","status":"SUCCESS"}
{"timestamp":"2025-01-15T08:31:00.000Z","username":"admin","ip":"192.168.1.5","host":"192.168.1.1:3000","action":"UNDUH","details":"Mengunduh file: /root/ubuntu-24.04.iso (1.5 GB)","status":"SUCCESS"}
```

---

## 🛠 Konfigurasi

Edit di bagian atas `server.js`:
```js
const PORT       = 3000;        // Port server
const SHARED_DIR = path.resolve(__dirname, 'shared');  // Folder yang dibagikan
```

---

## 📋 Lisensi

MIT — bebas digunakan dan dimodifikasi.
