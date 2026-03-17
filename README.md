# PNPM Migrator TUI

A CLI/TUI tool to migrate multiple Node.js projects to PNPM safely, with parallel jobs, progress bar, and node_modules cleanup.

---

## 🔹 Features / Özellikler

- **Recursive project scan / Proje tarama:**  
  Scans a root directory and all its subfolders for Node.js projects (detects `package.json`).

- **Supports npm projects / NPM projelerini destekler:**  
  If `package-lock.json` exists, runs `pnpm import` to convert npm project to PNPM.

- **Clean messy node_modules / Karmaşık node_modules temizleme:**  
  Deletes all `node_modules*` folders before installation to avoid conflicts.

- **Install dependencies with PNPM / PNPM ile bağımlılık yükleme:**  
  Runs `pnpm install --frozen-lockfile=false`.

- **Approve PNPM builds automatically / PNPM build’lerini otomatik onaylama:**  
  Runs `pnpm approve-builds --all`.

- **Parallel execution / Paralel çalıştırma:**  
  Choose how many projects to migrate simultaneously for faster execution.

- **Progress bar / İlerleme göstergesi:**  
  Visual progress bar showing total projects processed and percentage.

- **Dry-run mode / Deneme modu:**  
  See what would be done without actually modifying any files.

- **Remove old package-lock.json / Eski package-lock.json silme:**  
  Deletes `package-lock.json` after migration.

- **Interactive TUI / Etkileşimli TUI:**  
  Easy CLI prompts for all options.

---

## 🔹 CLI Options / CLI Seçenekleri

When you run the tool, it asks for:

| Option                  | Description                                       | Açıklama                                               |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| **Root directory**      | Path where the tool should scan for projects      | Taramayı başlatacağı klasör yolu                       |
| **Dry-run**             | Only simulate migration without changing anything | Sadece ne yapılacağını gösterir, dosya değiştirmez     |
| **Parallel jobs**       | How many projects to migrate at the same time     | Paralel olarak kaç proje işlenecek                     |
| **Delete node_modules** | Remove all `node_modules*` folders before install | Kurulumdan önce tüm `node_modules*` klasörlerini siler |
| **Approve builds**      | Automatically approve PNPM builds                 | PNPM build’lerini otomatik onaylar                     |

---

## 🔹 Installation / Kurulum

You can run directly via `npx` (no global install needed):

```bash
npx pnpm-migrator-tui
```
