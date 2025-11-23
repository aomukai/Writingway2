// Chapter Manager Module
// Handles all chapter-level CRUD operations, ordering, and modal controls
(function () {
    const ChapterManager = {
        /**
         * Open the new chapter modal
         * @param {Object} app - Alpine app instance
         */
        openNewChapterModal(app) {
            // set on next tick to avoid any click-propagation immediately closing the modal
            setTimeout(() => {
                app.showNewChapterModal = true;
            }, 0);
        },

        /**
         * Create a new chapter
         * @param {Object} app - Alpine app instance
         * @param {string} chapterName - Name for the new chapter
         */
        async createChapter(app, chapterName) {
            if (!chapterName) return;

            const chapter = {
                id: Date.now().toString(),
                projectId: app.currentProject.id,
                title: chapterName,
                order: app.chapters.length,
                created: new Date(),
                modified: new Date(),
                updatedAt: Date.now()
            };

            await db.chapters.add(chapter);

            // Broadcast chapter creation
            if (window.TabSync) {
                window.TabSync.broadcast(window.TabSync.MSG_TYPES.CHAPTER_SAVED, {
                    id: chapter.id,
                    projectId: chapter.projectId,
                    updatedAt: chapter.updatedAt
                });
            }

            app.showNewChapterModal = false;
            app.newChapterName = '';

            // Normalize orders and reload chapters
            await app.normalizeAllOrders();
        },

        /**
         * Move a chapter up in the order
         * @param {Object} app - Alpine app instance
         * @param {string} chapterId - ID of chapter to move
         */
        async moveChapterUp(app, chapterId) {
            const idx = app.chapters.findIndex(c => c.id === chapterId);
            if (idx <= 0) return;
            const cur = app.chapters[idx];
            const prev = app.chapters[idx - 1];
            await db.chapters.update(cur.id, { order: prev.order });
            await db.chapters.update(prev.id, { order: cur.order });
            await app.normalizeAllOrders();
        },

        /**
         * Move a chapter down in the order
         * @param {Object} app - Alpine app instance
         * @param {string} chapterId - ID of chapter to move
         */
        async moveChapterDown(app, chapterId) {
            const idx = app.chapters.findIndex(c => c.id === chapterId);
            if (idx === -1 || idx >= app.chapters.length - 1) return;
            const cur = app.chapters[idx];
            const next = app.chapters[idx + 1];
            await db.chapters.update(cur.id, { order: next.order });
            await db.chapters.update(next.id, { order: cur.order });
            await app.normalizeAllOrders();
        },

        /**
         * Delete a chapter and handle its scenes
         * Moves scenes to adjacent chapter or deletes them if no target exists
         * @param {Object} app - Alpine app instance
         * @param {string} chapterId - ID of chapter to delete
         */
        async deleteChapter(app, chapterId) {
            if (!confirm('Delete this chapter? Scenes inside will be moved to another chapter or deleted. Continue?')) return;
            const idx = app.chapters.findIndex(c => c.id === chapterId);
            if (idx === -1) return;

            // determine move target chapter (previous or next)
            let target = app.chapters[idx - 1] || app.chapters[idx + 1] || null;

            try {
                const scenesToHandle = (await db.scenes.where('projectId').equals(app.currentProject.id).filter(s => s.chapterId === chapterId).toArray()) || [];
                if (target) {
                    // move scenes to target, append at end
                    const startOrder = (target.scenes || []).length;
                    for (let i = 0; i < scenesToHandle.length; i++) {
                        const s = scenesToHandle[i];
                        await db.scenes.update(s.id, { chapterId: target.id, order: startOrder + i });
                    }
                } else {
                    // no target - delete scenes
                    for (const s of scenesToHandle) {
                        await db.scenes.delete(s.id);
                        await db.content.delete(s.id);
                    }
                }

                await db.chapters.delete(chapterId);

                // Broadcast chapter deletion
                if (window.TabSync) {
                    window.TabSync.broadcast(window.TabSync.MSG_TYPES.CHAPTER_DELETED, {
                        id: chapterId,
                        projectId: app.currentProject.id
                    });
                }

                if (app.currentChapter && app.currentChapter.id === chapterId) app.currentChapter = target || null;
                await app.normalizeAllOrders();
            } catch (e) {
                console.error('Failed to delete chapter:', e);
            }
        }
    };

    // Export to window
    window.ChapterManager = ChapterManager;

    // Expose test helpers
    window.__test = window.__test || {};
    window.__test.ChapterManager = ChapterManager;
})();
