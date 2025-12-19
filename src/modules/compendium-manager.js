// Compendium Manager Module
// Handles all compendium-level operations: categories, entries, tags, images, ordering
(function () {
    const CompendiumManager = {
        /**
         * Check if the current compendium entry has unsaved changes
         * Compares current entry to the original snapshot
         * @param {Object} app - Alpine app instance
         * @returns {boolean} - True if entry has unsaved changes
         */
        isCompendiumDirty(app) {
            if (!app.currentCompEntry || !app.compendiumOriginalEntry) return false;
            const curr = app.currentCompEntry;
            const orig = app.compendiumOriginalEntry;
            // Compare editable fields
            if (curr.title !== orig.title) return true;
            if (curr.body !== orig.body) return true;
            if (curr.imageUrl !== orig.imageUrl) return true;
            if (Boolean(curr.alwaysInContext) !== Boolean(orig.alwaysInContext)) return true;
            // Compare tags arrays
            const currTags = curr.tags || [];
            const origTags = orig.tags || [];
            if (currTags.length !== origTags.length) return true;
            for (let i = 0; i < currTags.length; i++) {
                if (currTags[i] !== origTags[i]) return true;
            }
            return false;
        },

        /**
         * Update the compendiumDirty flag based on current state
         * Called whenever editable fields change
         * @param {Object} app - Alpine app instance
         */
        updateCompendiumDirtyFlag(app) {
            app.compendiumDirty = this.isCompendiumDirty(app);
        },

        /**
         * Store a snapshot of the entry for dirty comparison
         * Called when loading/saving an entry
         * @param {Object} app - Alpine app instance
         */
        storeCompendiumOriginal(app) {
            if (app.currentCompEntry) {
                app.compendiumOriginalEntry = JSON.parse(JSON.stringify(app.currentCompEntry));
            } else {
                app.compendiumOriginalEntry = null;
            }
            app.compendiumDirty = false;
        },

        /**
         * Guard wrapper: checks for unsaved changes before executing an action
         * If dirty, shows confirmation modal and stores pending action
         * @param {Object} app - Alpine app instance
         * @param {Object} action - The pending action { type, ... }
         * @param {Function} proceed - Function to execute if not dirty or user confirms
         */
        guardCompendiumAction(app, action, proceed) {
            if (app.compendiumDirty) {
                app.pendingCompendiumAction = action;
                app.showCompendiumUnsavedModal = true;
            } else {
                proceed();
            }
        },

        /**
         * Execute the pending compendium action after save/discard
         * @param {Object} app - Alpine app instance
         */
        async executePendingCompendiumAction(app) {
            const action = app.pendingCompendiumAction;
            app.pendingCompendiumAction = null;
            app.showCompendiumUnsavedModal = false;

            if (!action) return;

            switch (action.type) {
                case 'select':
                    await this._doSelectCompendiumEntry(app, action.id);
                    break;
                case 'close':
                    this._doCloseCompendium(app);
                    break;
                case 'category':
                    await this._doLoadCompendiumCategory(app, action.category);
                    break;
                case 'create':
                    // For create, we need to actually create the entry
                    await this._doCreateCompendiumEntry(app, action.category);
                    break;
                case 'moveToCategory':
                    await this._doMoveCompendiumEntryToCategory(app, action.id, action.newCategory);
                    break;
            }
        },

        /**
         * Handle "Save & leave" button in unsaved changes modal
         * @param {Object} app - Alpine app instance
         */
        async saveAndProceedCompendium(app) {
            await this.saveCompendiumEntry(app);
            await this.executePendingCompendiumAction(app);
        },

        /**
         * Handle "Leave without saving" button in unsaved changes modal
         * @param {Object} app - Alpine app instance
         */
        async discardAndProceedCompendium(app) {
            // Reset dirty flag without saving
            app.compendiumDirty = false;
            app.compendiumOriginalEntry = null;
            await this.executePendingCompendiumAction(app);
        },

        /**
         * Handle "Cancel" button in unsaved changes modal
         * @param {Object} app - Alpine app instance
         */
        cancelCompendiumAction(app) {
            app.pendingCompendiumAction = null;
            app.showCompendiumUnsavedModal = false;
        },

        /**
         * Close the compendium panel with unsaved changes guard
         * @param {Object} app - Alpine app instance
         */
        closeCompendium(app) {
            this.guardCompendiumAction(app, { type: 'close' }, () => {
                this._doCloseCompendium(app);
            });
        },

        /**
         * Internal: Actually close the compendium panel
         * @param {Object} app - Alpine app instance
         */
        _doCloseCompendium(app) {
            app.showCodexPanel = false;
            app.currentCompEntry = null;
            app.compendiumOriginalEntry = null;
            app.compendiumDirty = false;
        },

        /**
         * Open the compendium panel and load initial data
         * @param {Object} app - Alpine app instance
         */
        async openCompendium(app) {
            // Toggle behavior: close if already open (with guard), otherwise open and load data
            if (app.showCodexPanel) {
                this.closeCompendium(app);
                return;
            }
            app.showCodexPanel = true;
            // load counts
            await this.loadCompendiumCounts(app);
            // Load entries for any already-open categories
            for (const cat of app.openCompCategories) {
                await this.refreshCategoryList(app, cat);
            }
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
         * Toggle a category open/closed (supports multiple open categories)
         * With unsaved changes guard when closing a category that contains the current entry
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category to toggle
         */
        async loadCompendiumCategory(app, category) {
            if (!app.currentProject) return;

            const idx = app.openCompCategories.indexOf(category);
            if (idx !== -1) {
                // Category is open, trying to close it
                // If the selected entry is in this category and has unsaved changes, guard it
                if (app.currentCompEntry && app.currentCompEntry.category === category) {
                    this.guardCompendiumAction(app, { type: 'category', category }, async () => {
                        await this._doLoadCompendiumCategory(app, category);
                    });
                } else {
                    await this._doLoadCompendiumCategory(app, category);
                }
                return;
            }

            // Open the category (no guard needed)
            app.openCompCategories.push(category);
            await this.refreshCategoryList(app, category);
            await this.loadCompendiumCounts(app);
        },

        /**
         * Internal: Actually toggle category (close path)
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category to close
         */
        async _doLoadCompendiumCategory(app, category) {
            const idx = app.openCompCategories.indexOf(category);
            if (idx !== -1) {
                app.openCompCategories.splice(idx, 1);
                delete app.compendiumLists[category];
                // Clear selection if the selected entry was in this category
                if (app.currentCompEntry && app.currentCompEntry.category === category) {
                    app.currentCompEntry = null;
                    app.compendiumOriginalEntry = null;
                    app.compendiumDirty = false;
                }
                try { await this.loadCompendiumCounts(app); } catch (e) { /* ignore */ }
            }
        },

        /**
         * Refresh entries for a specific category without toggling
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category to refresh
         */
        async refreshCategoryList(app, category) {
            if (!app.currentProject || !category) return;
            try {
                if (window.Compendium && typeof window.Compendium.listByCategory === 'function') {
                    app.compendiumLists[category] = await window.Compendium.listByCategory(app.currentProject.id, category) || [];
                } else {
                    app.compendiumLists[category] = [];
                }
            } catch (e) {
                console.error('Failed to refresh compendium category:', e);
                app.compendiumLists[category] = [];
            }
        },

        /**
         * Create a new compendium entry (with unsaved changes guard)
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category for new entry
         */
        async createCompendiumEntry(app, category) {
            if (!app.currentProject) return;

            const cat = category || app.compendiumCategories[0];

            this.guardCompendiumAction(app, { type: 'create', category: cat }, async () => {
                await this._doCreateCompendiumEntry(app, cat);
            });
        },

        /**
         * Internal: Actually create a new compendium entry
         * @param {Object} app - Alpine app instance
         * @param {string} category - Category for new entry
         */
        async _doCreateCompendiumEntry(app, category) {
            try {
                const entry = await window.Compendium.createEntry(app.currentProject.id, { category, title: 'New Entry', body: '' });
                // Ensure category is open
                if (!app.openCompCategories.includes(category)) {
                    app.openCompCategories.push(category);
                }
                await this.refreshCategoryList(app, category);
                await this.loadCompendiumCounts(app);
                // Directly select without guard since we've already passed the guard
                await this._doSelectCompendiumEntry(app, entry.id);
            } catch (e) {
                console.error('Failed to create compendium entry:', e);
            }
        },

        /**
         * Select and load a compendium entry (with unsaved changes guard)
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to select
         */
        async selectCompendiumEntry(app, id) {
            // Don't guard if selecting the same entry
            if (app.currentCompEntry && app.currentCompEntry.id === id) return;

            this.guardCompendiumAction(app, { type: 'select', id }, async () => {
                await this._doSelectCompendiumEntry(app, id);
            });
        },

        /**
         * Internal: Actually select and load a compendium entry
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to select
         */
        async _doSelectCompendiumEntry(app, id) {
            try {
                const e = await window.Compendium.getEntry(id);
                app.currentCompEntry = e || null;
                // Store snapshot for dirty comparison
                this.storeCompendiumOriginal(app);
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
                const entryCategory = app.currentCompEntry.category;
                const updates = {
                    title: app.currentCompEntry.title || '',
                    body: app.currentCompEntry.body || '',
                    tags: JSON.parse(JSON.stringify(app.currentCompEntry.tags || [])),
                    imageUrl: app.currentCompEntry.imageUrl || null,
                    alwaysInContext: app.currentCompEntry.alwaysInContext || false
                };
                await window.Compendium.updateEntry(app.currentCompEntry.id, updates);
                // Refresh only the entry's category without toggling
                await this.refreshCategoryList(app, entryCategory);
                await this.loadCompendiumCounts(app);
                // Reset dirty state after successful save
                this.storeCompendiumOriginal(app);
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
            if (!app.currentCompEntry.tags.includes(tag)) {
                app.currentCompEntry.tags.push(tag);
                this.updateCompendiumDirtyFlag(app);
            }
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
            this.updateCompendiumDirtyFlag(app);
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

            const self = this;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    app.currentCompEntry.imageUrl = ev.target.result;
                    self.updateCompendiumDirtyFlag(app);
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
                this.updateCompendiumDirtyFlag(app);
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
                // Get the entry's category before deleting
                const entry = await window.Compendium.getEntry(id);
                const entryCategory = entry ? entry.category : null;
                await window.Compendium.deleteEntry(id);
                app.currentCompEntry = null;
                // Refresh only the entry's category without toggling
                if (entryCategory) {
                    await this.refreshCategoryList(app, entryCategory);
                }
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
            if (!id) return;
            try {
                // Get entry to find its category
                const entry = await window.Compendium.getEntry(id);
                if (!entry) return;
                const category = entry.category;
                const list = await window.Compendium.listByCategory(app.currentProject.id, category) || [];
                const idx = list.findIndex(x => x.id === id);
                if (idx <= 0) return; // already at top
                const above = list[idx - 1];
                const item = list[idx];
                const aOrder = (above.order || 0);
                const iOrder = (item.order || 0);
                await window.Compendium.updateEntry(above.id, { order: iOrder });
                await window.Compendium.updateEntry(item.id, { order: aOrder });
                await this.refreshCategoryList(app, category);
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
            if (!id) return;
            try {
                // Get entry to find its category
                const entry = await window.Compendium.getEntry(id);
                if (!entry) return;
                const category = entry.category;
                const list = await window.Compendium.listByCategory(app.currentProject.id, category) || [];
                const idx = list.findIndex(x => x.id === id);
                if (idx === -1 || idx >= list.length - 1) return; // already at bottom
                const below = list[idx + 1];
                const item = list[idx];
                const bOrder = (below.order || 0);
                const iOrder = (item.order || 0);
                await window.Compendium.updateEntry(below.id, { order: iOrder });
                await window.Compendium.updateEntry(item.id, { order: bOrder });
                await this.refreshCategoryList(app, category);
            } catch (e) {
                console.error('Failed to move compendium entry down:', e);
            }
        },

        /**
         * Move compendium entry to a different category (with guard if moving selected entry)
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to move
         * @param {string} newCategory - Target category
         */
        async moveCompendiumEntryToCategory(app, id, newCategory) {
            if (!id || !newCategory) return;

            // Guard if moving the currently selected entry with unsaved changes
            if (app.currentCompEntry && app.currentCompEntry.id === id && app.compendiumDirty) {
                this.guardCompendiumAction(app, { type: 'moveToCategory', id, newCategory }, async () => {
                    await this._doMoveCompendiumEntryToCategory(app, id, newCategory);
                });
            } else {
                await this._doMoveCompendiumEntryToCategory(app, id, newCategory);
            }
        },

        /**
         * Internal: Actually move compendium entry to a different category
         * @param {Object} app - Alpine app instance
         * @param {string} id - Entry ID to move
         * @param {string} newCategory - Target category
         */
        async _doMoveCompendiumEntryToCategory(app, id, newCategory) {
            try {
                // Get entry's old category before moving
                const entry = await window.Compendium.getEntry(id);
                const oldCategory = entry ? entry.category : null;

                // find current max order in target category and append
                const items = await window.Compendium.listByCategory(app.currentProject.id, newCategory) || [];
                const maxOrder = items.length ? Math.max(...items.map(it => (it.order || 0))) : -1;
                await window.Compendium.updateEntry(id, { category: newCategory, order: maxOrder + 1 });

                // Refresh both old and new categories if they're open
                if (oldCategory && app.openCompCategories.includes(oldCategory)) {
                    await this.refreshCategoryList(app, oldCategory);
                }
                if (app.openCompCategories.includes(newCategory)) {
                    await this.refreshCategoryList(app, newCategory);
                }
                await this.loadCompendiumCounts(app);

                // clear selection if we moved the selected entry away
                if (app.currentCompEntry && app.currentCompEntry.id === id) {
                    app.currentCompEntry = null;
                    app.compendiumOriginalEntry = null;
                    app.compendiumDirty = false;
                }
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
