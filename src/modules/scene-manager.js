// Scene Manager Module
// Handles all scene-level CRUD operations, loading, ordering, and modal controls
(function () {
    const SceneManager = {
        /**
         * Open the new scene modal
         * @param {Object} app - Alpine app instance
         */
        openNewSceneModal(app) {
            // small helper so clicks are routed through a method (easier to debug)
            app.showNewSceneModal = true;
        },

        /**
         * Create a new scene in the current or first chapter
         * @param {Object} app - Alpine app instance
         * @param {string} sceneName - Name for the new scene
         */
        async createScene(app, sceneName) {
            if (!sceneName) return;

            // Ensure we have a chapter to attach to
            if (!app.chapters || app.chapters.length === 0) {
                const chap = {
                    id: Date.now().toString() + '-c',
                    projectId: app.currentProject.id,
                    title: t('chapter.defaultTitle'),
                    order: 0,
                    created: new Date(),
                    modified: new Date()
                };
                await db.chapters.add(chap);
                await app.loadChapters();
            }

            const targetChapter = app.currentChapter || app.chapters[0];

            const now = Date.now();
            const scene = {
                id: now.toString(),
                projectId: app.currentProject.id,
                chapterId: targetChapter.id,
                title: sceneName,
                order: (targetChapter.scenes || []).length,
                // initialize with current POV options, ensuring proper defaults
                povCharacter: app.povCharacter || '',
                pov: (app.pov && app.pov.trim()) ? app.pov : '3rd person limited',
                tense: (app.tense && app.tense.trim()) ? app.tense : 'past',
                created: new Date(),
                modified: new Date(),
                updatedAt: now
            };

            await db.scenes.add(scene);
            await db.content.add({
                sceneId: scene.id,
                text: '',
                wordCount: 0,
                updatedAt: now
            });

            // Broadcast scene creation
            if (window.TabSync) {
                window.TabSync.broadcast(window.TabSync.MSG_TYPES.SCENE_SAVED, {
                    id: scene.id,
                    projectId: scene.projectId,
                    chapterId: scene.chapterId,
                    updatedAt: scene.updatedAt
                });
            }

            app.showNewSceneModal = false;
            app.newSceneName = '';

            // Normalize orders and reload
            await app.normalizeAllOrders();
            await this.loadScene(app, scene.id);
        },

        /**
         * Load a scene and its content
         * @param {Object} app - Alpine app instance
         * @param {string} sceneId - ID of scene to load
         */
        async loadScene(app, sceneId) {
            const scene = await db.scenes.get(sceneId);
            // Load content for the scene, using a primary-key get() first and a
            // fallback where('sceneId') lookup for robustness across DB variants.
            let content = null;
            try {
                content = await db.content.get(sceneId);
            } catch (e) { content = null; }
            if (!content) {
                try { content = await db.content.where('sceneId').equals(sceneId).first(); } catch (e) { content = null; }
            }

            // Clean any RTL/LTR override characters from content
            let cleanContent = content ? content.text : '';
            if (cleanContent) {
                // Remove Unicode bidirectional control characters that can cause RTL rendering
                cleanContent = cleanContent.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
            }

            app.currentScene = {
                ...scene,
                content: cleanContent,
                // Track when this version was loaded for conflict detection
                loadedUpdatedAt: scene.updatedAt || Date.now(),
                contentLoadedUpdatedAt: content?.updatedAt || Date.now()
            };

            // Load scene-specific generation options into UI state
            app.povCharacter = scene.povCharacter || '';
            app.pov = scene.pov || '3rd person limited';
            app.tense = scene.tense || 'past';

            // Force LTR direction on the editor after it's rendered
            app.$nextTick(() => {
                const editor = document.querySelector('.editor-textarea[contenteditable="true"]');
                if (editor) {
                    editor.setAttribute('dir', 'ltr');
                    editor.style.direction = 'ltr';
                    editor.style.unicodeBidi = 'normal';
                }
            });

            // Set currentChapter to the scene's chapter
            if (scene && scene.chapterId) {
                const ch = app.chapters.find(c => c.id === scene.chapterId);
                if (ch) app.currentChapter = ch;
            }
        },

        /**
         * Move a scene to a different chapter
         * @param {Object} app - Alpine app instance
         * @param {string} sceneId - ID of scene to move
         * @param {string} targetChapterId - ID of target chapter
         */
        async moveSceneToChapter(app, sceneId, targetChapterId) {
            if (!sceneId || !targetChapterId) return;

            // Put the scene at the end of the target chapter
            const targetChapter = app.chapters.find(c => c.id === targetChapterId);
            const newOrder = (targetChapter && targetChapter.scenes) ? targetChapter.scenes.length : 0;

            try {
                await db.scenes.update(sceneId, { chapterId: targetChapterId, order: newOrder, modified: new Date() });
            } catch (e) {
                console.error('moveSceneToChapter update failed:', e);
            }

            // Normalize orders across chapters/scenes and reload
            await app.normalizeAllOrders();
            await this.loadScene(app, sceneId);
        },

        /**
         * Move a scene up within its chapter
         * @param {Object} app - Alpine app instance
         * @param {string} sceneId - ID of scene to move
         */
        async moveSceneUp(app, sceneId) {
            // find scene and its chapter
            const scene = await db.scenes.get(sceneId);
            if (!scene) return;
            const ch = app.chapters.find(c => c.id === scene.chapterId);
            if (!ch || !ch.scenes) return;
            const idx = ch.scenes.findIndex(s => s.id === sceneId);
            if (idx <= 0) return; // already first

            const prev = ch.scenes[idx - 1];
            // swap orders
            await db.scenes.update(sceneId, { order: prev.order });
            await db.scenes.update(prev.id, { order: scene.order });
            await app.normalizeAllOrders();
        },

        /**
         * Move a scene down within its chapter
         * @param {Object} app - Alpine app instance
         * @param {string} sceneId - ID of scene to move
         */
        async moveSceneDown(app, sceneId) {
            const scene = await db.scenes.get(sceneId);
            if (!scene) return;
            const ch = app.chapters.find(c => c.id === scene.chapterId);
            if (!ch || !ch.scenes) return;
            const idx = ch.scenes.findIndex(s => s.id === sceneId);
            if (idx === -1 || idx >= ch.scenes.length - 1) return; // already last

            const next = ch.scenes[idx + 1];
            await db.scenes.update(sceneId, { order: next.order });
            await db.scenes.update(next.id, { order: scene.order });
            await app.normalizeAllOrders();
        },

        /**
         * Delete a scene and its content
         * @param {Object} app - Alpine app instance
         * @param {string} sceneId - ID of scene to delete
         */
        async deleteScene(app, sceneId) {
            if (!confirm(t('scene.deleteConfirm'))) return;
            try {
                const scene = await db.scenes.get(sceneId);
                await db.scenes.delete(sceneId);
                await db.content.delete(sceneId);

                // Broadcast scene deletion
                if (window.TabSync && scene) {
                    window.TabSync.broadcast(window.TabSync.MSG_TYPES.SCENE_DELETED, {
                        id: sceneId,
                        projectId: scene.projectId,
                        chapterId: scene.chapterId
                    });
                }

                if (app.currentScene && app.currentScene.id === sceneId) app.currentScene = null;
                await app.normalizeAllOrders();
            } catch (e) {
                console.error('Failed to delete scene:', e);
            }
        }
    };

    // Export to window
    window.SceneManager = SceneManager;

    // Expose test helpers
    window.__test = window.__test || {};
    window.__test.SceneManager = SceneManager;
})();
