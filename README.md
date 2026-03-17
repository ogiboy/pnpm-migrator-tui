PNPM Migration TUI

A CLI/TUI tool to safely migrate multiple Node.js projects to PNPM, with parallel jobs, progress bar, backup, fuzzy root selection, and node_modules cleanup.
Node.js projelerinizi güvenle PNPM’e geçirmek için interaktif bir terminal aracı.

---

Features / Özellikler

- Recursive project scan / Proje tarama: Scans a root directory and all its subfolders for Node.js projects (package.json tespiti).
- Fuzzy root selection / Kolay root klasör seçimi: Quickly choose from frequently used root folders with fuzzy search.
- Dry run / Deneme modu: Preview all actions without making changes.
- Parallel processing / Paralel çalıştırma: Run multiple project migrations at the same time.
- Clean node_modules / node_modules temizleme: Deletes all node_modules\* folders before installation to prevent conflicts.
- Auto approve PNPM builds / PNPM build’lerini otomatik onaylama: Optionally approve builds post-install.
- Backup system / Yedekleme: Central backup of package.json and package-lock.json for each project in ~/pnpm-migration-backups.
- Retry mechanism / Tekrar deneme: Automatically retries PNPM install up to 2 times per project if it fails.
- Interactive project selection / Proje seçimi: If many projects are found, select which ones to migrate via checkbox list.
- Progress bar / İlerleme göstergesi: Shows real-time migration progress.
- Cache root directories / Root önbelleği: Remembers last used roots for faster selection.

---

CLI Options / CLI Seçenekleri

| Option / Seçenek                       | Description / Açıklama                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Root directory / Kök klasörü           | Path to scan for projects / Projelerin taranacağı klasör yolu                                                   |
| Dry run / Deneme modu                  | Preview actions without changing files / Dosya değiştirmeden ne yapılacağını gösterir                           |
| Parallel jobs / Paralel iş             | Number of projects to process concurrently / Aynı anda kaç proje işlenecek                                      |
| Delete node_modules / Node_modules sil | Remove all node_modules\* folders before migration / Kurulumdan önce tüm node_modules klasörlerini siler        |
| Auto approve builds / Build onayı      | Automatically approve PNPM builds / PNPM build’lerini otomatik onaylar                                          |
| Backup / Yedekleme                     | Backup package files before migration / Migration öncesi package.json ve package-lock.json dosyalarını yedekler |
| Project selection / Proje seçimi       | Select specific projects if many found / Çok proje bulunduğunda hangi projelerin işleneceğini seçin             |

---

Installation / Kurulum

Option 1: Install globally via npm

npm install -g <package-name>

Option 2: Clone & link locally for development

git clone <repo-url>
cd pnpm-migrator-tui
pnpm install
pnpm link

After linking, the CLI command pnpm-migrate becomes available globally.

---

Usage / Kullanım

pnpm-migrate

Steps / Adımlar

1. Select root directory / Kök klasörü seçin
   - Frequently used roots suggested, fuzzy search supported.
   - Önceden kullanılan klasörler ve popüler Documents alt klasörleri önerilir.

2. Select options / Seçenekleri belirleyin
   - Dry-run, parallel jobs, delete node_modules, backup, approve builds.

3. Project selection / Proje seçimi
   - Eğer çok proje varsa, checkbox list ile seçim yapabilirsiniz.
   - Listeyi görmek istemezsen tüm projeler seçilmiş kabul edilir.

4. Start migration / Migrasyonu başlat
   - Tool tüm seçilen projeleri işler.
   - Backup dizini ve ilerleme gösterimi sağlanır.

---

Backup & Cache / Yedek ve Önbellek

- Backups are stored in: ~/pnpm-migration-backups
- Cache of previously used root directories: ~/.pnpm-migration-cache.json

Example / Örnek

pnpm-migrate

# Root: ~/Documents/Projects

# Dry run? Yes

# Parallel jobs? 4

# Delete node_modules? Yes

# Auto approve builds? Yes

# Backup? Yes

# Show project list? Yes

# Select projects

# Start migration? Yes

---

Notes / Notlar

- Works on macOS / Linux (bash required for node_modules deletion).
- Make sure PNPM is installed globally: npm install -g pnpm
- Dry-run mode is safe to check actions before modifying projects.
- Backups are centralized, keeping project folders clean.
