// Prompts module — exposes window.Prompts with functions that operate on the shared `db` instance
(function () {
    async function loadPrompts(app) {
        if (!app.currentProject) {
            app.prompts = [];
            return;
        }
        try {
            app.prompts = await db.prompts.where('projectId').equals(app.currentProject.id).sortBy('modified');
            // ensure collapsed map has entries
            for (let c of app.promptCategories) {
                if (app.promptCollapsed[c] === undefined) app.promptCollapsed[c] = false;
            }
        } catch (e) {
            console.error('Failed to load prompts:', e);
            app.prompts = [];
        }
    }

    async function createPrompt(app, category) {
        if (!app.currentProject) return;
        const title = app.newPromptTitle && app.newPromptTitle.trim() ? app.newPromptTitle.trim() : 'New Prompt';
        const id = Date.now().toString();
        const now = new Date();
        const prompt = { id, projectId: app.currentProject.id, category, title, content: '', created: now, modified: now };
        await db.prompts.add(prompt);
        app.newPromptTitle = '';
        await loadPrompts(app);
        openPrompt(app, id);
    }

    function openPrompt(app, id) {
        const p = app.prompts.find(x => x.id === id);
        if (!p) return;
        app.currentPrompt = { ...p };
        app.promptEditorContent = p.content || '';

        // If this is a prose prompt, persist it as the selected project-level prose prompt
        try {
            if (p.category === 'prose' && app && typeof app.saveSelectedProsePrompt === 'function') {
                app.saveSelectedProsePrompt(p.id);
            }
        } catch (e) {
            // ignore persistence failures
        }
    }

    async function savePrompt(app) {
        if (!app.currentPrompt) return;
        try {
            const now = new Date();
            await db.prompts.update(app.currentPrompt.id, {
                title: app.currentPrompt.title,
                content: app.promptEditorContent,
                category: app.currentPrompt.category,
                modified: now
            });
            await loadPrompts(app);
            // refresh currentPrompt reference
            app.currentPrompt = await db.prompts.get(app.currentPrompt.id);
            app.promptEditorContent = app.currentPrompt.content || '';
        } catch (e) {
            console.error('Failed to save prompt:', e);
        }
    }

    async function deletePrompt(app, id) {
        if (!id) return;
        if (!confirm(t('prompt.deleteConfirm'))) return;
        try {
            await db.prompts.delete(id);
            if (app.currentPrompt && app.currentPrompt.id === id) app.currentPrompt = null;
            // If this prompt was the selected project-level prose prompt, clear the persisted selection
            try {
                if (app && app.selectedProsePromptId === id && typeof app.saveSelectedProsePrompt === 'function') {
                    app.saveSelectedProsePrompt(null);
                }
            } catch (e) { /* ignore */ }
            await loadPrompts(app);
        } catch (e) {
            console.error('Failed to delete prompt:', e);
        }
    }

    // Rename a prompt by id; prompts the user for a new title if not provided
    async function renamePrompt(app, id, newTitle) {
        if (!id) return;
        try {
            let title = newTitle;
            if (!title) {
                const p = await db.prompts.get(id);
                title = prompt(t('prompt.renamePrompt'), p && p.title ? p.title : '');
            }
            if (title === null || title === undefined) return; // user cancelled
            title = String(title).trim();
            if (title.length === 0) return;
            const now = new Date();
            await db.prompts.update(id, { title, modified: now });
            await loadPrompts(app);
            if (app.currentPrompt && app.currentPrompt.id === id) {
                app.currentPrompt.title = title;
            }
        } catch (e) {
            console.error('Failed to rename prompt:', e);
        }
    }

    // Move prompt up within its category by swapping modified timestamps with the previous item
    async function movePromptUp(app, id) {
        try {
            const p = await db.prompts.get(id);
            if (!p || !app.currentProject) return;
            const list = await db.prompts.where('projectId').equals(app.currentProject.id).and(x => x.category === p.category).sortBy('modified');
            const idx = list.findIndex(x => x.id === id);
            if (idx <= 0) return; // already at top
            const above = list[idx - 1];
            const aMod = above.modified || new Date();
            const pMod = p.modified || new Date();
            await db.prompts.update(above.id, { modified: pMod });
            await db.prompts.update(p.id, { modified: aMod });
            await loadPrompts(app);
        } catch (e) {
            console.error('Failed to move prompt up:', e);
        }
    }

    // Move prompt down within its category by swapping modified timestamps with the next item
    async function movePromptDown(app, id) {
        try {
            const p = await db.prompts.get(id);
            if (!p || !app.currentProject) return;
            const list = await db.prompts.where('projectId').equals(app.currentProject.id).and(x => x.category === p.category).sortBy('modified');
            const idx = list.findIndex(x => x.id === id);
            if (idx === -1 || idx >= list.length - 1) return; // already at bottom
            const below = list[idx + 1];
            const bMod = below.modified || new Date();
            const pMod = p.modified || new Date();
            await db.prompts.update(below.id, { modified: pMod });
            await db.prompts.update(p.id, { modified: bMod });
            await loadPrompts(app);
        } catch (e) {
            console.error('Failed to move prompt down:', e);
        }
    }

    window.Prompts = {
        loadPrompts,
        createPrompt,
        openPrompt,
        savePrompt,
        deletePrompt,
        movePromptUp,
        movePromptDown,
        renamePrompt
    };
})();
