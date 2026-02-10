// Backup Module
// Handles GitHub Gist backups and local file backups via the local web server.

(function () {
    const BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const LOCAL_BACKUP_API = '/api/backups';
    let backupIntervalId = null;

    const GitHubBackup = {
        isGitHubMode(app) {
            return String(app.backupProvider || '').trim().toLowerCase() === 'github';
        },

        /**
         * Validate GitHub token.
         */
        async validateToken(token) {
            try {
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (response.ok) {
                    const user = await response.json();
                    return { valid: true, username: user.login };
                }
                return { valid: false, error: 'Invalid token' };
            } catch (e) {
                return { valid: false, error: e.message };
            }
        },

        /**
         * Export current project data as JSON.
         */
        async exportProjectData(app) {
            if (!app.currentProject) return null;

            try {
                const projectId = app.currentProject.id;

                const chapters = await db.chapters.where('projectId').equals(projectId).toArray();
                const scenes = await db.scenes.where('projectId').equals(projectId).toArray();

                const sceneContents = {};
                for (const scene of scenes) {
                    const content = await db.content.get(scene.id);
                    sceneContents[scene.id] = content ? content.text : '';
                }

                let compendium = [];
                try {
                    if (db.compendium) {
                        compendium = await db.compendium.where('projectId').equals(projectId).toArray();
                    }
                } catch (e) {
                    console.warn('Could not load compendium:', e);
                }

                let prompts = [];
                try {
                    if (db.prompts) {
                        prompts = await db.prompts.where('projectId').equals(projectId).toArray();
                    }
                } catch (e) {
                    console.warn('Could not load prompts:', e);
                }

                return {
                    version: '2.0',
                    exportedAt: new Date().toISOString(),
                    project: app.currentProject,
                    chapters: chapters,
                    scenes: scenes,
                    sceneContents: sceneContents,
                    compendium: compendium,
                    prompts: prompts
                };
            } catch (e) {
                console.error('Error exporting project data:', e);
                return null;
            }
        },

        /**
         * Create or update GitHub Gist with backup.
         */
        async backupToGist(app) {
            if (!app.githubToken || !app.currentProject) {
                return { success: false, error: 'No token or project' };
            }

            try {
                const projectData = await this.exportProjectData(app);
                if (!projectData) {
                    return { success: false, error: 'No project data' };
                }

                const filename = `${app.currentProject.name.replace(/[^a-z0-9]/gi, '_')}_backup.json`;
                const description = `Writingway Auto-Backup: ${app.currentProject.name}`;
                const gistId = app.currentProjectGistId;

                if (gistId) {
                    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `token ${app.githubToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            description: description,
                            files: {
                                [filename]: {
                                    content: JSON.stringify(projectData, null, 2)
                                }
                            }
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        return {
                            success: true,
                            gistId: data.id,
                            url: data.html_url,
                            updated: true
                        };
                    }
                }

                const response = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${app.githubToken}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        description: description,
                        public: false,
                        files: {
                            [filename]: {
                                content: JSON.stringify(projectData, null, 2)
                            }
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    return {
                        success: true,
                        gistId: data.id,
                        url: data.html_url,
                        created: true
                    };
                }

                return { success: false, error: `HTTP ${response.status}` };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * Save backup to local folder via local server API.
         * Default server folder is ./local_backups (can be changed with --backup-dir).
         */
        async backupToLocal(app) {
            if (!app.currentProject) {
                return { success: false, error: 'No project selected' };
            }

            try {
                const projectData = await this.exportProjectData(app);
                if (!projectData) {
                    return { success: false, error: 'No project data' };
                }

                const response = await fetch(LOCAL_BACKUP_API, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(projectData)
                });

                const data = await response.json().catch(() => null);
                if (!response.ok || !data || data.success === false) {
                    return {
                        success: false,
                        error: (data && data.error) ? data.error : `HTTP ${response.status}`
                    };
                }

                const backup = data.backup || {};
                return {
                    success: true,
                    backupId: backup.id || '',
                    backup: backup
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * List backup versions from gist history.
         */
        async listBackups(app) {
            if (!app.githubToken || !app.currentProjectGistId) {
                return { success: false, error: 'No token or gist ID' };
            }

            try {
                const response = await fetch(`https://api.github.com/gists/${app.currentProjectGistId}`, {
                    headers: {
                        'Authorization': `token ${app.githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (!response.ok) {
                    return { success: false, error: `HTTP ${response.status}` };
                }

                const gist = await response.json();
                const versions = gist.history || [];

                return {
                    success: true,
                    backups: versions.map(v => ({
                        version: v.version,
                        timestamp: v.committed_at,
                        url: v.url,
                        user: v.user ? v.user.login : 'unknown'
                    }))
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * List local backups for the currently selected project.
         */
        async listLocalBackups(app) {
            if (!app.currentProject) {
                return { success: false, error: 'No selected project' };
            }

            try {
                const projectId = encodeURIComponent(app.currentProject.id);
                const response = await fetch(`${LOCAL_BACKUP_API}?projectId=${projectId}`, {
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const data = await response.json().catch(() => null);
                if (!response.ok || !data || data.success === false) {
                    return {
                        success: false,
                        error: (data && data.error) ? data.error : `HTTP ${response.status}`
                    };
                }

                const rawBackups = Array.isArray(data.backups) ? data.backups : [];
                return {
                    success: true,
                    backups: rawBackups.map(b => ({
                        version: String(b.version || b.id || ''),
                        timestamp: b.timestamp || new Date().toISOString(),
                        url: b.url || `${LOCAL_BACKUP_API}/${encodeURIComponent(String(b.id || ''))}`,
                        id: b.id || ''
                    }))
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * Restore from a specific GitHub backup version.
         */
        async restoreFromBackup(app, versionUrl) {
            if (!app.githubToken) {
                return { success: false, error: 'No token' };
            }

            try {
                const response = await fetch(versionUrl, {
                    headers: {
                        'Authorization': `token ${app.githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (!response.ok) {
                    return { success: false, error: `HTTP ${response.status}` };
                }

                const gistVersion = await response.json();
                const files = gistVersion.files;
                const firstFile = Object.values(files)[0];

                if (!firstFile) {
                    return { success: false, error: 'No backup data found' };
                }

                const backupData = JSON.parse(firstFile.content);
                await this.restoreProjectData(app, backupData);

                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * Restore from a local backup file via local server API.
         */
        async restoreFromLocalBackup(app, backupRef) {
            if (!backupRef) {
                return { success: false, error: 'No backup reference provided' };
            }

            try {
                const url = backupRef.startsWith('/')
                    ? backupRef
                    : `${LOCAL_BACKUP_API}/${encodeURIComponent(backupRef)}`;

                const response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const backupData = await response.json().catch(() => null);
                if (!response.ok || !backupData || backupData.success === false) {
                    return {
                        success: false,
                        error: (backupData && backupData.error) ? backupData.error : `HTTP ${response.status}`
                    };
                }

                await this.restoreProjectData(app, backupData);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        /**
         * Restore project data from backup payload.
         */
        async restoreProjectData(app, backupData) {
            const projectId = backupData.project.id;

            await db.projects.put(backupData.project);

            await db.chapters.where('projectId').equals(projectId).delete();
            for (const chapter of backupData.chapters) {
                await db.chapters.add(chapter);
            }

            await db.scenes.where('projectId').equals(projectId).delete();
            for (const scene of backupData.scenes) {
                await db.scenes.add(scene);
            }

            for (const [sceneId, text] of Object.entries(backupData.sceneContents)) {
                const wordCount = text ? text.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
                await db.content.put({
                    sceneId: sceneId,
                    text: text,
                    wordCount: wordCount
                });
            }

            await db.compendium.where('projectId').equals(projectId).delete();
            for (const entry of backupData.compendium || []) {
                await db.compendium.add(entry);
            }

            if (backupData.prompts) {
                await db.prompts.where('projectId').equals(projectId).delete();
                for (const prompt of backupData.prompts) {
                    await db.prompts.add(prompt);
                }
            }

            await app.selectProject(projectId);
        },

        /**
         * Start auto-backup timer for current provider.
         */
        startAutoBackup(app) {
            if (backupIntervalId) {
                clearInterval(backupIntervalId);
            }

            backupIntervalId = setInterval(async () => {
                if (!app.backupEnabled || !app.currentProject) return;

                if (this.isGitHubMode(app) && !app.githubToken) return;

                app.backupStatus = 'Backing up...';
                const result = this.isGitHubMode(app)
                    ? await this.backupToGist(app)
                    : await this.backupToLocal(app);

                if (result.success) {
                    app.lastBackupTime = new Date();
                    app.backupStatus = 'Backed up';
                    if (result.gistId) {
                        app.currentProjectGistId = result.gistId;
                    }
                    this.saveBackupSettings(app);
                    console.log('✓ Auto-backup successful');
                } else {
                    app.backupStatus = 'Backup failed';
                    console.error('Auto-backup failed:', result.error);
                }
            }, BACKUP_INTERVAL);
        },

        /**
         * Stop auto-backup timer.
         */
        stopAutoBackup() {
            if (backupIntervalId) {
                clearInterval(backupIntervalId);
                backupIntervalId = null;
            }
        },

        /**
         * Save backup settings to localStorage.
         */
        saveBackupSettings(app) {
            try {
                const settings = {
                    provider: this.isGitHubMode(app) ? 'github' : 'local',
                    enabled: app.backupEnabled,
                    token: app.githubToken,
                    gistId: app.currentProjectGistId,
                    username: app.githubUsername
                };
                localStorage.setItem('writingway:backupSettings', JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save backup settings:', e);
            }
        },

        /**
         * Load backup settings from localStorage.
         */
        loadBackupSettings(app) {
            try {
                const saved = localStorage.getItem('writingway:backupSettings');
                if (!saved) return;

                const settings = JSON.parse(saved);

                // Backward compatibility:
                // older versions had no provider field and were GitHub-only.
                const provider = String(settings.provider || '').trim().toLowerCase();
                if (provider === 'local' || provider === 'github') {
                    app.backupProvider = provider;
                } else if (settings.token || settings.gistId || settings.username) {
                    app.backupProvider = 'github';
                } else {
                    app.backupProvider = 'local';
                }

                app.backupEnabled = settings.enabled || false;
                app.githubToken = settings.token || '';
                app.currentProjectGistId = settings.gistId || '';
                app.githubUsername = settings.username || '';

                const shouldAutoStart = app.backupEnabled && (
                    !this.isGitHubMode(app) || !!app.githubToken
                );

                if (shouldAutoStart) {
                    setTimeout(() => {
                        this.startAutoBackup(app);
                    }, 5000);
                }
            } catch (e) {
                console.error('Failed to load backup settings:', e);
            }
        }
    };

    window.GitHubBackup = GitHubBackup;
})();
