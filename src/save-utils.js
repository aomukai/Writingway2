// Save utilities for scenes. Exposes window.Save.saveScene(app)
(function () {
    async function saveScene(app) {
        if (!app) return false;
        try {
            app.isSaving = true;
            app.saveStatus = 'Saving...';

            const scene = app.currentScene;
            if (!scene) {
                app.saveStatus = 'No scene';
                app.isSaving = false;
                return false;
            }

            // compute word count from scene content
            const contentText = (scene.content || '').trim();
            const wordCount = contentText ? contentText.split(/\s+/).filter(w => w.length > 0).length : 0;

            // persist content and scene metadata using the global `db` instance
            const contentRecord = {
                sceneId: scene.id,
                text: scene.content || '',
                wordCount: wordCount,
                modified: new Date()
            };

            await db.content.put(contentRecord);

            const scenePatch = {
                id: scene.id,
                projectId: scene.projectId || (app.currentProject && app.currentProject.id) || null,
                title: scene.title || '',
                order: typeof scene.order === 'number' ? scene.order : 0,
                chapterId: scene.chapterId || null,
                // prefer app-level UI values if present (the POV inputs are bound to app props),
                // fallback to currentScene fields when available
                povCharacter: (app.povCharacter !== undefined ? app.povCharacter : (scene.povCharacter || '')),
                pov: (app.pov !== undefined ? app.pov : (scene.pov || '')),
                tense: (app.tense !== undefined ? app.tense : (scene.tense || '')),
                modified: new Date(),
                wordCount
            };

            await db.scenes.put(scenePatch);

            // Update in-memory lists
            try {
                const ch = app.chapters && app.chapters.find((c) => c.id === scene.chapterId);
                if (ch && Array.isArray(ch.scenes)) {
                    const s = ch.scenes.find((x) => x.id === scene.id);
                    if (s) Object.assign(s, scenePatch);
                }

                if (Array.isArray(app.scenes)) {
                    const ss = app.scenes.find((x) => x.id === scene.id);
                    if (ss) Object.assign(ss, scenePatch);
                }
            } catch (e) { /* ignore */ }

            app.saveStatus = 'Saved';
            return true;
        } catch (err) {
            console.error('saveScene error', err);
            app.saveStatus = 'Error';
            return false;
        } finally {
            app.isSaving = false;
        }
    }

    window.Save = window.Save || {};
    window.Save.saveScene = saveScene;
})();
