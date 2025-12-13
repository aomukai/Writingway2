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
        const prompt = { id, projectId: app.currentProject.id, category, title, content: '', systemContent: '', created: now, modified: now };
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
        app.promptEditorSystemContent = p.systemContent || '';

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
                systemContent: app.promptEditorSystemContent,
                category: app.currentPrompt.category,
                modified: now
            });
            await loadPrompts(app);
            // refresh currentPrompt reference
            app.currentPrompt = await db.prompts.get(app.currentPrompt.id);
            app.promptEditorContent = app.currentPrompt.content || '';
            app.promptEditorSystemContent = app.currentPrompt.systemContent || '';
        } catch (e) {
            console.error('Failed to save prompt:', e);
        }
    }

    async function deletePrompt(app, id) {
        if (!id) return;
        if (!confirm('Delete this prompt?')) return;
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
                title = prompt('Rename prompt:', p && p.title ? p.title : '');
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

    // Export all prompts for the current project as JSON
    async function exportPrompts(app) {
        if (!app.currentProject) {
            alert('No project selected.');
            return;
        }
        try {
            const prompts = await db.prompts.where('projectId').equals(app.currentProject.id).toArray();
            if (!prompts || prompts.length === 0) {
                alert('No prompts to export.');
                return;
            }
            
            // Prepare export data (strip projectId as it will be reassigned on import)
            const exportData = {
                version: '1.0',
                type: 'prompts',
                exportedAt: new Date().toISOString(),
                projectName: app.currentProject.name,
                prompts: prompts.map(p => ({
                    category: p.category,
                    title: p.title,
                    content: p.content || '',
                    systemContent: p.systemContent || '',
                    created: p.created,
                    modified: p.modified
                }))
            };
            
            // Create and download JSON file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${app.currentProject.name.replace(/[^a-z0-9]/gi, '_')}_prompts.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to export prompts:', e);
            alert('Failed to export prompts: ' + e.message);
        }
    }

    // Import prompts from a JSON file
    async function importPrompts(app, fileInput) {
        if (!app.currentProject) {
            alert('No project selected.');
            return;
        }
        
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            return;
        }
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            // Validate format
            if (!data.type || data.type !== 'prompts' || !Array.isArray(data.prompts)) {
                alert('Invalid prompts file format.');
                return;
            }
            
            const count = data.prompts.length;
            if (!confirm(`Import ${count} prompt(s) into the current project?`)) {
                return;
            }
            
            // Import each prompt with new IDs
            const now = new Date();
            for (const p of data.prompts) {
                const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2, 7);
                await db.prompts.add({
                    id,
                    projectId: app.currentProject.id,
                    category: p.category || 'prose',
                    title: p.title || 'Imported Prompt',
                    content: p.content || '',
                    systemContent: p.systemContent || '',
                    created: now,
                    modified: now
                });
                // Small delay to ensure unique IDs
                await new Promise(r => setTimeout(r, 1));
            }
            
            await loadPrompts(app);
            alert(`Successfully imported ${count} prompt(s).`);
        } catch (e) {
            console.error('Failed to import prompts:', e);
            alert('Failed to import prompts: ' + e.message);
        } finally {
            // Reset file input
            fileInput.value = '';
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
        renamePrompt,
        exportPrompts,
        importPrompts
    };
})();
