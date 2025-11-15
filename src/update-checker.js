// Update Checker Module
// Checks for new versions on GitHub and prompts user to update
(function () {
    const UpdateChecker = {
        // Current version - update this with each release
        currentVersion: '1.0.0',
        
        // GitHub repository info
        repoOwner: 'aomukai',
        repoName: 'Writingway2',
        
        /**
         * Check for updates from GitHub releases
         * @returns {Promise<Object|null>} Update info or null if no update
         */
        async checkForUpdates() {
            try {
                const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`);
                if (!response.ok) {
                    console.log('Could not check for updates:', response.status);
                    return null;
                }
                
                const release = await response.json();
                const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
                
                if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                    return {
                        version: latestVersion,
                        url: release.html_url,
                        downloadUrl: release.zipball_url,
                        notes: release.body || 'No release notes available.',
                        publishedAt: new Date(release.published_at).toLocaleDateString()
                    };
                }
                
                return null; // No update available
            } catch (error) {
                console.error('Error checking for updates:', error);
                return null;
            }
        },
        
        /**
         * Compare version numbers (semantic versioning)
         * @param {string} newVer - New version (e.g., "1.2.3")
         * @param {string} currentVer - Current version (e.g., "1.2.0")
         * @returns {boolean} True if newVer is newer
         */
        isNewerVersion(newVer, currentVer) {
            const newParts = newVer.split('.').map(Number);
            const currentParts = currentVer.split('.').map(Number);
            
            for (let i = 0; i < 3; i++) {
                const newPart = newParts[i] || 0;
                const currentPart = currentParts[i] || 0;
                if (newPart > currentPart) return true;
                if (newPart < currentPart) return false;
            }
            
            return false; // Versions are equal
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
