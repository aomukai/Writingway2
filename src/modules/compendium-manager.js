// Compendium Manager Module
// Handles all compendium-level operations: categories, entries, tags, images, ordering
(function () {
    const CompendiumManager = {
        /**
         * Open the compendium panel and load initial data
         * @param {Object} app - Alpine app instance
         */
        async openCompendium(app) {
            // Toggle behavior: close if already open, otherwise open and load data
            if (app.showCodexPanel) {
                app.showCodexPanel = false;
                return;
            }
            app.showCodexPanel = true;
            // load counts and default category
            await this.loadCompendiumCounts(app);
            await this.loadCompendiumCategory(app, app.currentCompCategory);
        },

        /**
         * Load entry counts for all categories
         * @param {Object} app - Alpine app instance
         */
        async loadCompendiumCounts(app) {
            try {
                const counts = {};
                for (const c of app.compendiumCategories) {
                    const list = await (window.Compendium ? window.Compendium.listByCategory(app.currentProject.id, c) : []);
                    counts[c] = list.length;
                }
                app.compendiumCounts = counts;
            } catch (e) {
                console.warn('Failed to load compendium counts:', e);
                app.compendiumCounts = {};
            }
        },

        /**
         * Load entries for a specific category
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category to load
         */
        async loadCompendiumCategory(app, category) {
            if (!app.currentProject) return;

            // Toggle behavior: if the same category is clicked again, close it
            if (app.currentCompCategory === category) {
                app.currentCompCategory = null;
                app.compendiumList = [];
                app.currentCompEntry = null;
                // refresh counts for UI consistency
                try { await this.loadCompendiumCounts(app); } catch (e) { /* ignore */ }
                return;
            }

            app.currentCompCategory = category;
            try {
                if (window.Compendium && typeof window.Compendium.listByCategory === 'function') {
                    app.compendiumList = await window.Compendium.listByCategory(app.currentProject.id, category) || [];
                } else {
                    app.compendiumList = [];
                }
                // clear current entry selection
                app.currentCompEntry = null;
                await this.loadCompendiumCounts(app);
            } catch (e) {
                console.error('Failed to load compendium category:', e);
            }
        },

        /**
         * Create a new compendium entry
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category for new entry
         */
        async createCompendiumEntry(app, category) {
            if (!app.currentProject) return;
            const cat = category || app.currentCompCategory || app.compendiumCategories[0];
            try {
                const entry = await window.Compendium.createEntry(app.currentProject.id, { category: cat, title: 'New Entry', body: '' });
                await this.loadCompendiumCategory(app, cat);
                await this.selectCompendiumEntry(app, entry.id);
            } catch (e) {
                console.error('Failed to create compendium entry:', e);
            }
        },

        /**
         * Select and load a compendium entry
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to select
         */
        async selectCompendiumEntry(app, id) {
            try {
                const e = await window.Compendium.getEntry(id);
                app.currentCompEntry = e || null;
            } catch (err) {
                console.error('Failed to load compendium entry:', err);
            }
        },

        /**
         * Save the current compendium entry
         * @param {Object} app - Alpine app instance
         */
        async saveCompendiumEntry(app) {
            if (!app.currentCompEntry || !app.currentCompEntry.id) return;
            try {
                app.compendiumSaveStatus = 'Saving...';
                const updates = {
                    title: app.currentCompEntry.title || '',
                    body: app.currentCompEntry.body || '',
                    tags: JSON.parse(JSON.stringify(app.currentCompEntry.tags || [])),
                    imageUrl: app.currentCompEntry.imageUrl || null
                };
                await window.Compendium.updateEntry(app.currentCompEntry.id, updates);
                await this.loadCompendiumCategory(app, app.currentCompCategory);
                await this.loadCompendiumCounts(app);
                app.compendiumSaveStatus = 'Saved';
                setTimeout(() => { app.compendiumSaveStatus = ''; }, 2000);
            } catch (e) {
                console.error('Failed to save compendium entry:', e);
                app.compendiumSaveStatus = 'Error';
                setTimeout(() => { app.compendiumSaveStatus = ''; }, 3000);
            }
        },

        /**
         * Add a tag to the current compendium entry
         * @param {Object} app - Alpine app instance
         */
        addCompTag(app) {
            if (!app.currentCompEntry) return;
            const tag = (app.newCompTag || '').trim();
            if (!tag) return;
            app.currentCompEntry.tags = app.currentCompEntry.tags || [];
            if (!app.currentCompEntry.tags.includes(tag)) app.currentCompEntry.tags.push(tag);
            app.newCompTag = '';
        },

        /**
         * Remove a tag from the current compendium entry
         * @param {Object} app - Alpine app instance
         * @param {number} index - Index of tag to remove
         */
        removeCompTag(app, index) {
            if (!app.currentCompEntry || !app.currentCompEntry.tags) return;
            app.currentCompEntry.tags.splice(index, 1);
        },

        /**
         * Set image from file input or drag-drop
         * @param {Object} app - Alpine app instance
         * @param {Event|File} e - File input event, drop event, or File object
         */
        setCompImageFromFile(app, e) {
            // Accept events from input change or drop events. Also accept a direct File.
            let file = null;
            try {
                if (e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    file = e.dataTransfer.files[0];
                } else if (e && e.target && e.target.files && e.target.files[0]) {
                    file = e.target.files[0];
                } else if (e instanceof File) {
                    file = e;
                }
            } catch (err) { file = null; }
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    app.currentCompEntry.imageUrl = ev.target.result;
                } catch (err) { }
            };
            reader.readAsDataURL(file);
            // clear input if present
            try { if (e && e.target) e.target.value = null; } catch (err) { }
        },

        /**
         * Confirm and remove image from current entry
         * @param {Object} app - Alpine app instance
         */
        confirmRemoveCompImage(app) {
            if (!app.currentCompEntry || !app.currentCompEntry.imageUrl) return;
            if (confirm('Remove this image from the entry?')) {
                app.currentCompEntry.imageUrl = null;
            }
        },

        /**
         * Delete a compendium entry
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to delete
         */
        async deleteCompendiumEntry(app, id) {
            if (!id) return;
            if (!confirm('Delete this compendium entry?')) return;
            try {
                await window.Compendium.deleteEntry(id);
                app.currentCompEntry = null;
                await this.loadCompendiumCategory(app, app.currentCompCategory);
                await this.loadCompendiumCounts(app);
            } catch (e) {
                console.error('Failed to delete compendium entry:', e);
            }
        },

        /**
         * Move compendium entry up in order
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to move
         */
        async moveCompendiumEntryUp(app, id) {
            if (!app.currentCompCategory || !id) return;
            try {
                const list = await window.Compendium.listByCategory(app.currentProject.id, app.currentCompCategory) || [];
                const idx = list.findIndex(x => x.id === id);
                if (idx <= 0) return; // already at top
                const above = list[idx - 1];
                const item = list[idx];
                const aOrder = (above.order || 0);
                const iOrder = (item.order || 0);
                await window.Compendium.updateEntry(above.id, { order: iOrder });
                await window.Compendium.updateEntry(item.id, { order: aOrder });
                await this.loadCompendiumCategory(app, app.currentCompCategory);
            } catch (e) {
                console.error('Failed to move compendium entry up:', e);
            }
        },

        /**
         * Move compendium entry down in order
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to move
         */
        async moveCompendiumEntryDown(app, id) {
            if (!app.currentCompCategory || !id) return;
            try {
                const list = await window.Compendium.listByCategory(app.currentProject.id, app.currentCompCategory) || [];
                const idx = list.findIndex(x => x.id === id);
                if (idx === -1 || idx >= list.length - 1) return; // already at bottom
                const below = list[idx + 1];
                const item = list[idx];
                const bOrder = (below.order || 0);
                const iOrder = (item.order || 0);
                await window.Compendium.updateEntry(below.id, { order: iOrder });
                await window.Compendium.updateEntry(item.id, { order: bOrder });
                await this.loadCompendiumCategory(app, app.currentCompCategory);
            } catch (e) {
                console.error('Failed to move compendium entry down:', e);
            }
        },

        /**
         * Move compendium entry to a different category
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to move
         * @param {string} newCategory - Target category
         */
        async moveCompendiumEntryToCategory(app, id, newCategory) {
            if (!id || !newCategory) return;
            try {
                // find current max order in target category and append
                const items = await window.Compendium.listByCategory(app.currentProject.id, newCategory) || [];
                const maxOrder = items.length ? Math.max(...items.map(it => (it.order || 0))) : -1;
                await window.Compendium.updateEntry(id, { category: newCategory, order: maxOrder + 1 });
                // if moved out of the currently-viewed category, refresh that list; else reload same category
                await this.loadCompendiumCategory(app, app.currentCompCategory);
                await this.loadCompendiumCounts(app);
                // clear selection if we moved the selected entry away
                if (app.currentCompEntry && app.currentCompEntry.id === id) app.currentCompEntry = null;
            } catch (e) {
                console.error('Failed to move compendium entry to category:', e);
            }
        }
    };

    // Export to window
    window.CompendiumManager = CompendiumManager;

    // Expose test helpers
    window.__test = window.__test || {};
    window.__test.CompendiumManager = CompendiumManager;
})();
