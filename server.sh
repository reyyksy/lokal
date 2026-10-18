#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#   LAN File Explorer — Launcher Script (Linux / macOS)
#   Jalankan: bash server.sh   atau   ./server.sh
# ═══════════════════════════════════════════════════════════

# Pindah ke direktori tempat script ini berada
cd "$(dirname "$0")" || exit 1

# Cek Node.js tersedia
if ! command -v node &> /dev/null; then
  echo ""
  echo "  ✖  Node.js tidak ditemukan!"
  echo "     Install Node.js terlebih dahulu:"
  echo "     • Debian/Ubuntu : sudo apt install nodejs"
  echo "     • Arch          : sudo pacman -S nodejs"
  echo "     • Fedora        : sudo dnf install nodejs"
  echo ""
  exit 1
fi

# Tampilkan banner
echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║         LAN FILE EXPLORER — Launcher                 ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Pilih mode:"
echo ""
echo "  1) Jalankan Server Langsung (port 3000)"
echo "  2) Buka Menu Manajemen (Akun, Traffic Log, dll)"
echo "  3) Keluar"
echo ""
read -rp "  Pilihan [1/2/3]: " pilihan

case "$pilihan" in
  1)
    echo ""
    echo "  ▶  Menjalankan LAN File Server di http://0.0.0.0:3000 ..."
    echo "  ℹ  Tekan Ctrl+C untuk menghentikan server."
    echo ""
    node server.js
    ;;
  2)
    echo ""
    echo "  ▶  Membuka Menu Manajemen ..."
    echo ""
    node manage-account.js
    ;;
  3|"")
    echo ""
    echo "  Keluar."
    echo ""
    exit 0
    ;;
  *)
    echo ""
    echo "  Pilihan tidak valid. Keluar."
    echo ""
    exit 1
    ;;
esac
