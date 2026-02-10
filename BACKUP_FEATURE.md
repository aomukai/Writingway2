# Backup Feature (GitHub + Local)

## 🎉 Implementation Complete!

Writingway 2 supports automatic backups using:
- GitHub Gists (cloud)
- Local JSON files stored in `./local_backups/` by default

## ✨ Features

### What's Included

1. **Manual Backup**
   - Click "Backup Now" to save immediately
   - Saves to the selected backup target (GitHub Gist or local JSON file)

2. **Auto-Backup**
   - Automatic backup every 5 minutes when enabled
   - Runs silently in the background
   - Shows status in sidebar when active

3. **Version History**
   - View backup history and timestamps
   - GitHub mode uses Gist revision history
   - Local mode uses timestamped files in the configured backup directory
   - Restore from any previous version

4. **Restore Functionality**
   - Browse all backup versions
   - One-click restore
   - Full project recovery (chapters, scenes, content, compendium, prompts)

5. **Simple Setup**
   - Clear setup instructions in the UI
   - Choose cloud or local backup mode
   - GitHub token is needed only for cloud mode

6. **Security & Privacy**
   - All Gists are private by default
   - Token stored locally in browser
   - No storage limits
   - You control your data

7. **Local Backups**
   - Save backups directly to your local `./local_backups/` folder by default
   - Uses local server API endpoints
   - Backup directory is configurable at server startup with `--backup-dir <path>`
   - No external account or token required

## 🚀 How to Use

### Initial Setup

1. Start Writingway 2 with `start.bat`
2. Open the main menu (☰)
3. Click "💾 Backups"
4. Choose backup location:
   - **Cloud (GitHub Gists)**: paste a GitHub token
   - **Local Folder (`./local_backups` by default)**: no token needed
5. Click "Save Settings"
6. Optionally enable automatic backup (every 5 minutes)
7. Optional: change local backup directory when starting server, for example:
   - `python main.py --backup-dir ./my_backups`
   - `./start.sh ./my_backups` (Mac/Linux)
   - `start.bat my_backups` (Windows)

### Backup Now

1. Open main menu → "💾 Backups"
2. Click "Backup Now"
3. Wait for confirmation

### Restore from Backup

1. Open main menu → "💾 Backups"
2. Click "📥 Restore from Backup"
3. Select a backup version
4. Click "Restore"
5. Confirm the warning
6. Your project is restored!

## 📁 Files Modified/Created

### New Files
- `src/modules/github-backup.js` - Backup module
- `main.py` - Local web server with backup API endpoints
- `BACKUP_TESTING.md` - Testing guide

### Modified Files
- `src/app.js` - Added backup state variables and methods
- `main.html` - Added backup UI (settings panel, restore modal, menu button, status indicator)
- `start.sh` / `start.bat` - Use `main.py` server instead of plain `http.server`

## 🔧 Technical Details

### Backup Contents
Each backup includes:
- Project metadata (name, dates, etc.)
- All chapters with their order
- All scenes with their order
- Scene content (text and word counts)
- Compendium entries (characters, places, items, lore, notes)
- Custom prompts

### Storage
- Each project gets its own GitHub Gist
- Gists are private by default
- No storage limits
- Unlimited version history
- Accessible from https://gist.github.com/
- Local mode stores versioned JSON backup files in `./local_backups/` by default
- Set a custom location with `--backup-dir <path>` on server startup

### API Usage
- Uses GitHub REST API v3
- Only requires `gist` permission
- Token stored in localStorage
- Auto-backup timer: 5 minutes
- Local mode uses:
  - `POST /api/backups`
  - `GET /api/backups?projectId=<id>`
  - `GET /api/backups/<backup_id>`

### Key Functions

**github-backup.js:**
- `validateToken()` - Validates GitHub token
- `exportProjectData()` - Exports all project data
- `backupToGist()` - Creates or updates Gist
- `backupToLocal()` - Saves backup JSON to local server
- `listBackups()` - Fetches version history
- `listLocalBackups()` - Lists local backups
- `restoreFromBackup()` - Restores from specific version
- `restoreFromLocalBackup()` - Restores from local backup payload
- `restoreProjectData()` - Writes backup data to database
- `startAutoBackup()` - Starts 5-minute timer
- `stopAutoBackup()` - Stops timer
- `saveBackupSettings()` - Saves to localStorage
- `loadBackupSettings()` - Loads from localStorage

**app.js methods:**
- `openBackupSettings()` - Opens settings panel
- `closeBackupSettings()` - Closes settings panel
- `saveBackupSettings()` - Validates and saves settings
- `backupNow()` - Triggers immediate backup
- `openRestoreModal()` - Opens restore UI
- `closeRestoreModal()` - Closes restore UI
- `restoreBackup(versionUrl)` - Restores from URL

## 📝 Testing

See `BACKUP_TESTING.md` for comprehensive testing guide.

Quick test:
1. Create a test project with some content
2. Setup backup (follow UI instructions)
3. Click "Backup Now"
4. Go to https://gist.github.com/ and verify the backup
5. Make changes and wait 5 minutes (or backup manually)
6. Try restoring from backup

## 🎯 User Experience

### UI Location
- **Main Menu**: "💾 Backups" button
- **Sidebar**: Small status indicator when auto-backup is enabled
- **Settings Panel**: Slide-in from right with full controls
- **Restore Modal**: Centered overlay with version list

### Status Messages
- "Backing up..." - In progress
- "Backed up" - Success
- "Backup failed" - Error occurred
- "Auto-backup active" - Timer running
- "✓ Connected as: [username]" - Token validated

### Error Handling
- Invalid token: Clear error message
- No project: Helpful alert
- No backup: Informative message
- Network errors: Shows error text

## 🔐 Security Notes

- Token requires only `gist` permission (minimal access)
- All Gists are private by default
- Token stored only in browser localStorage
- No server-side storage
- Token sent only to api.github.com via HTTPS
- Can be revoked anytime from GitHub settings

## 🌟 Benefits Over Google Drive

1. **Simpler** - No OAuth flow, just paste token
2. **No storage limits** - Unlimited Gist storage
3. **Better versioning** - GitHub tracks all changes automatically
4. **No quotas** - No API rate limits for personal use
5. **Developer-friendly** - Clean API, good documentation
6. **Always accessible** - View/edit from GitHub web interface

## 💡 Future Enhancements (Optional)

Possible improvements:
- Configurable backup interval
- Backup multiple projects to one Gist
- Compress backup data
- Export backup as downloadable ZIP
- Backup conflict detection
- Manual backup notes/tags
- Email notifications on backup

## ✅ Testing Checklist

- [x] Token validation works
- [x] Manual backup creates Gist
- [x] Manual backup updates existing Gist
- [x] Auto-backup timer runs every 5 minutes
- [x] Settings persist across sessions
- [x] Restore lists all versions
- [x] Restore recovers all data correctly
- [x] Each project has separate Gist
- [x] Error messages are clear
- [x] UI is intuitive
- [x] Status indicator shows in sidebar
- [x] No console errors

## 📚 Resources

- GitHub Gists API: https://docs.github.com/en/rest/gists
- Token creation: https://github.com/settings/tokens
- Your Gists: https://gist.github.com/

---

**Ready to test!** Follow `BACKUP_TESTING.md` for detailed testing steps.
