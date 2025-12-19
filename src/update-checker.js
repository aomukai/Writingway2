// Update Checker Module
// Checks for new versions on GitHub based on latest commit date
// Integrates with local updater service for one-click updates
(function () {
    const UpdateChecker = {
        // Build timestamp - update this when you push a new version
        // This represents when this version was created
        buildDate: new Date('2025-12-19T13:45:00Z').getTime(), // Update before each push

        // GitHub repository info
        repoOwner: 'aomukai',
        repoName: 'Writingway2',
        branch: 'main',

        // Updater service endpoint
        updaterUrl: 'http://127.0.0.1:8001',

        /**
         * Check for updates by comparing commit dates
         * @returns {Promise<Object|null>} Update info or null if no update
         */
        async checkForUpdates() {
            try {
                // Fetch latest commit from the main branch
                const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits/${this.branch}`);
                if (!response.ok) {
                    console.log('Could not check for updates:', response.status);
                    return null;
                }

                const commit = await response.json();
                const commitDate = new Date(commit.commit.committer.date).getTime();

                // If buildDate is invalid (still has placeholder), use a very old date
                const localBuildDate = isNaN(this.buildDate) ? 0 : this.buildDate;

                if (commitDate > localBuildDate) {
                    const commitShort = commit.sha.substring(0, 7);
                    return {
                        version: commitShort,
                        commitDate: new Date(commitDate).toLocaleDateString(),
                        message: commit.commit.message.split('\n')[0], // First line only
                        url: commit.html_url,
                        downloadUrl: `https://github.com/${this.repoOwner}/${this.repoName}/archive/refs/heads/${this.branch}.zip`,
                        notes: `Latest commit: ${commit.commit.message}`,
                        publishedAt: new Date(commitDate).toLocaleDateString()
                    };
                }

                return null; // No update available
            } catch (error) {
                console.error('Error checking for updates:', error);
                return null;
            }
        },

        /**
         * Check if the updater service is running
         * @returns {Promise<boolean>}
         */
        async isUpdaterAvailable() {
            try {
                const response = await fetch(`${this.updaterUrl}/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000)
                });
                return response.ok;
            } catch (error) {
                return false;
            }
        },

        /**
         * Check if an update is already staged
         * @returns {Promise<boolean>}
         */
        async isUpdateStaged() {
            try {
                const response = await fetch(`${this.updaterUrl}/update/status`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000)
                });
                if (response.ok) {
                    const data = await response.json();
                    return data.ready === true;
                }
                return false;
            } catch (error) {
                return false;
            }
        },

        /**
         * Download update via the updater service
         * @returns {Promise<{success: boolean, message: string}>}
         */
        async downloadUpdate() {
            try {
                const response = await fetch(`${this.updaterUrl}/update/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (response.ok && data.ok) {
                    return { success: true, message: data.message || 'Downloaded. Restart to apply.' };
                } else {
                    return { success: false, message: data.error || 'Download failed' };
                }
            } catch (error) {
                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    return { success: false, message: 'Updater service not running. Please restart Writingway.' };
                }
                return { success: false, message: `Error: ${error.message}` };
            }
        },

        /**
         * Clear staged update
         * @returns {Promise<boolean>}
         */
        async clearUpdate() {
            try {
                const response = await fetch(`${this.updaterUrl}/update/clear`, {
                    method: 'POST'
                });
                return response.ok;
            } catch (error) {
                return false;
            }
        },

        /**
         * Show update notification to user
         * @param {Object} app - Alpine app instance
         * @param {Object} updateInfo - Update information
         */
        async showUpdateDialog(app, updateInfo) {
            if (!updateInfo) return;

            // Check if updater service is available
            const updaterAvailable = await this.isUpdaterAvailable();
            const updateStaged = updaterAvailable ? await this.isUpdateStaged() : false;

            app.updateAvailable = {
                ...updateInfo,
                updaterAvailable,
                updateStaged,
                downloading: false,
                downloadError: null,
                downloadSuccess: false
            };
            app.showUpdateDialog = true;
        },

        /**
         * Handle download button click
         * @param {Object} app - Alpine app instance
         */
        async handleDownload(app) {
            if (!app.updateAvailable) return;

            app.updateAvailable.downloading = true;
            app.updateAvailable.downloadError = null;
            app.updateAvailable.downloadSuccess = false;

            const result = await this.downloadUpdate();

            app.updateAvailable.downloading = false;

            if (result.success) {
                app.updateAvailable.downloadSuccess = true;
                app.updateAvailable.updateStaged = true;
            } else {
                app.updateAvailable.downloadError = result.message;
            }
        },

        /**
         * Check for updates and notify user if available
         * @param {Object} app - Alpine app instance
         * @param {boolean} silent - If true, don't show "no updates" message
         */
        async checkAndNotify(app, silent = true) {
            try {
                app.checkingForUpdates = true;
                const updateInfo = await this.checkForUpdates();

                if (updateInfo) {
                    await this.showUpdateDialog(app, updateInfo);
                } else if (!silent) {
                    alert('✓ You are running the latest version of Writingway!');
                }
            } catch (error) {
                if (!silent) {
                    alert('Could not check for updates. Please check your internet connection.');
                }
            } finally {
                app.checkingForUpdates = false;
            }
        }
    };

    // Export to window
    window.UpdateChecker = UpdateChecker;
})();
