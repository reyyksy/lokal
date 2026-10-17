# 📁 LAN Web File Explorer

Server berbagi file berbasis web yang modern dan responsif, dibuat murni menggunakan **Node.js** bawaan (tanpa perlu install dependencies luar, ringan, dan cepat). Dilengkapi sistem keamanan proteksi login akun yang dikelola secara eksklusif dari terminal server host.

---

## 🚀 Cara Menjalankan Server

### 1. Di Linux / macOS:
```bash
node server.js
# atau
npm start
# atau
./start.sh
```

### 2. Di Windows:
- Klik dua kali [start.bat](file:///home/reihan/repo/me/lokal/start.bat) **ATAU** ketik di terminal / PowerShell:
```powershell
node server.js
```

---

## 🔐 Manajemen Akun (Hanya dari Terminal Server Host)

Untuk alasan keamanan, **tidak ada opsi pendaftaran/pengelolaan akun di web**. Mengatur akun (tambah user, ganti password, ganti username, atau hapus user) **hanya bisa dilakukan langsung dari komputer/perangkat yang menjadi server**.

Antarmuka terminal dilengkapi menu interaktif navigasi panah keyboard (`↑` / `↓` lalu `Enter`).

### Cara Mengelola Akun:
1. Buka terminal di perangkat server dan masuk ke direktori proyek ini:
   ```bash
   cd /path/to/lokal
   ```
2. Jalankan perintah manajemen akun:
   ```bash
   node manage-account.js
   # atau
   npm run account
   ```
3. Navigasi menu menggunakan tombol panah keyboard:
   - **👥 Lihat Daftar Akun**
   - **➕ Tambah Akun Baru**
   - **🔑 Ganti Password Akun**
   - **✏️ Ubah Username Akun**
   - **🗑️ Hapus Akun**
   - **🚪 Keluar dari Terminal Akun**

> **Catatan:**
> - Jika belum ada akun yang dibuat, server dapat diakses bebas.
> - Begitu ada 1 akun dibuat di terminal server, web otomatis terkunci dan mewajibkan login dengan username & password tersebut.

---

## 🌐 Cara Mengakses Web File Explorer

Saat server dijalankan, terminal akan menampilkan alamat IP lokal, contoh:
- **Dari komputer server sendiri:**
  - `http://localhost:3000`
- **Dari HP / Laptop lain di jaringan WiFi atau LAN yang sama:**
  - `http://<IP-Server>:3000` (contoh: `http://192.168.1.10:3000`)

---

## 🎨 Pembaruan UI/UX (Standar UI/UX Pro Max)
- **Desain Modern & Flat Design**: Tipografi Poppins & Open Sans yang nyaman dibaca, kontras warna AA/AAA, dan dark mode otomatis.
- **100% SVG Vector Icons**: Menghapus seluruh penggunaan emoji pada kontrol sistem dan tombol aksi, digantikan SVG ikon yang tajam dan konsisten.
- **Aksesibilitas & Interaksi**: Setiap elemen klik dilengkapi efek hover transisi halus, indikator fokus keyboard, dan `cursor-pointer`.
- **Drag & Drop Upload**: Unggah file atau multi-file langsung dengan drag-and-drop.
- **Keamanan Berlapis**: Proteksi path traversal, password hashing dengan `scrypt` + cryptographic salt, dan session cookie HTTP-only.
