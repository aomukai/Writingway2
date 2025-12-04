// Update Checker Module
// Checks for new versions on GitHub based on latest commit date
(function () {
    const UpdateChecker = {
        // Build timestamp - update this when you push a new version
        // This represents when this version was created
        buildDate: new Date('2025-12-03T11:40:00Z').getTime(), // Update before each push

        // GitHub repository info
        repoOwner: 'aomukai',
        repoName: 'Writingway2',
        branch: 'main',

        /**
         * Check for updates by comparing commit dates
         * @returns {Promise<Object|null>} Update info or null if no update
         */
        async checkForUpdates() {
            try {
                // Fetch latest commit from the main branchscm-history-item:e%3A%5CWritingway2?%7B%22repositoryId%22%3A%22scm0%22%2C%22historyItemId%22%3A%22f46a020f4d39216e401318130b0a4f7934d366f8%22%2C%22historyItemParentId%22%3A%22d18a5aa189144e323b651fe30611164f32132c9f%22%2C%22historyItemDisplayId%22%3A%22f46a020%22%7D
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
         * Show update notification to user
         * @param {Object} app - Alpine app instance
         * @param {Object} updateInfo - Update information
         */
        showUpdateDialog(app, updateInfo) {
            if (!updateInfo) return;

            app.updateAvailable = updateInfo;
            app.showUpdateDialog = true;
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
                    this.showUpdateDialog(app, updateInfo);
                } else if (!silent) {
                    alert(t('update.latest'));
                }
            } catch (error) {
                if (!silent) {
                    alert(t('update.checkFailed'));
                }
            } finally {
                app.checkingForUpdates = false;
            }
        }
    };

    // Export to window
    window.UpdateChecker = UpdateChecker;
})();
