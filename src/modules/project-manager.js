// Project Manager Module
// Handles all project-level CRUD operations, selection, and export
(function () {
    const ProjectManager = {
        /**
         * Create a new project with a default chapter and scene
         * @param {Object} app - Alpine app instance
         * @param {string} projectName - Name for the new project
         */
        async createProject(app, projectName) {
            if (!projectName) return;

            const project = {
                id: Date.now().toString(),
                name: projectName,
                created: new Date(),
                modified: new Date()
            };

            await db.projects.add(project);
            app.currentProject = project;
            app.showNewProjectModal = false;
            app.newProjectName = '';

            // refresh projects list and select the new project
            await this.loadProjects(app);
            await this.selectProject(app, project.id);
            await this.createDefaultScene(app);
        },

        /**
         * Create a default chapter and scene for a new project
         * @param {Object} app - Alpine app instance
         */
        async createDefaultScene(app) {
            // Ensure there's at least one chapter; reuse existing if present to avoid duplicates
            let chapter = (await db.chapters.where('projectId').equals(app.currentProject.id).sortBy('order'))[0];
            if (!chapter) {
                chapter = {
                    id: Date.now().toString() + '-c',
                    projectId: app.currentProject.id,
                    title: 'Chapter 1',
                    order: 0,
                    created: new Date(),
                    modified: new Date()
                };
                await db.chapters.add(chapter);
            }

            // determine next scene order within chapter
            let nextOrder = 0;
            try {
                nextOrder = await db.scenes.where('projectId').equals(app.currentProject.id).and(s => s.chapterId === chapter.id).count();
            } catch (e) {
                nextOrder = 0;
            }

            const scene = {
                id: Date.now().toString(),
                projectId: app.currentProject.id,
                chapterId: chapter.id,
                title: 'Scene 1',
                order: nextOrder,
                // initialize with current POV options
                povCharacter: app.povCharacter || '',
                pov: app.pov || '3rd person limited',
                tense: app.tense || 'past',
                created: new Date(),
                modified: new Date()
            };

            await db.scenes.add(scene);
            await db.content.add({
                sceneId: scene.id,
                text: '',
                wordCount: 0
            });

            // Normalize orders and reload structured data
            await app.normalizeAllOrders();
            await app.loadScene(scene.id);
        },

        /**
         * Load all projects from database
         * @param {Object} app - Alpine app instance
         */
        async loadProjects(app) {
            app.projects = await db.projects.orderBy('created').reverse().toArray();
        },

        /**
         * Load the last opened project or fallback to first available
         * @param {Object} app - Alpine app instance
         */
        async loadLastProject(app) {
            // fallback: pick first project if available
            const projects = await db.projects.toArray();
            if (projects.length > 0) {
                app.currentProject = projects[0];
                app.selectedProjectId = app.currentProject.id;
                await app.loadChapters();
                if (app.scenes.length > 0) {
                    await app.loadScene(app.scenes[0].id);
                }
            }
        },

        /**
         * Fix scenes that may have been saved without a projectId (legacy migration)
         * Uses chapter.projectId when available, otherwise assigns the first project in the DB
         */
        async migrateMissingSceneProjectIds() {
            try {
                const scenes = await db.scenes.toArray();
                if (!scenes || scenes.length === 0) return;
                const projects = await db.projects.toArray();
                const defaultProject = projects && projects[0] ? projects[0].id : null;

                for (const s of scenes) {
                    if (!s.projectId) {
                        let projectId = null;
                        if (s.chapterId) {
                            const ch = await db.chapters.get(s.chapterId).catch(() => null);
                            if (ch && ch.projectId) projectId = ch.projectId;
                        }
                        if (!projectId && defaultProject) projectId = defaultProject;
                        if (projectId) {
                            await db.scenes.update(s.id, { projectId });
                        }
                    }
                }
            } catch (e) {
                console.warn('migrateMissingSceneProjectIds failed:', e);
            }
        },

        /**
         * Select and load a project
         * @param {Object} app - Alpine app instance
         * @param {string} projectId - ID of project to select
         */
        async selectProject(app, projectId) {
            const proj = await db.projects.get(projectId);
            if (!proj) return;
            app.currentProject = proj;
            app.selectedProjectId = proj.id;
            // persist last opened project
            try { localStorage.setItem('writingway:lastProject', proj.id); } catch (e) { }
            await app.loadChapters();
            await app.loadPrompts();
            // restore prose prompt selection for this project
            try { await this.loadSelectedProsePrompt(app); } catch (e) { /* ignore */ }
            // Load workshop sessions for this project
            try { await app.loadWorkshopSessions(); } catch (e) { console.error('Failed to load workshop sessions:', e); }
            // Load selected workshop prompt
            try { await app.loadSelectedWorkshopPrompt(); } catch (e) { /* ignore */ }
            // Load context panel settings for this project
            try { app.loadContextPanel(); } catch (e) { console.error('Failed to load context panel:', e); }
            if (app.scenes.length > 0) {
                await app.loadScene(app.scenes[0].id);
            } else {
                app.currentScene = null;
            }
        },

        /**
         * Load persisted prose prompt selection for the current project
         * @param {Object} app - Alpine app instance
         */
        async loadSelectedProsePrompt(app) {
            try {
                if (!app.currentProject || !app.currentProject.id) {
                    app.selectedProsePromptId = null;
                    return;
                }
                const key = `writingway:proj:${app.currentProject.id}:prosePrompt`;
                const raw = localStorage.getItem(key);
                if (!raw) {
                    app.selectedProsePromptId = null;
                    return;
                }
                // Ensure the stored id actually exists in the DB
                try {
                    const dbRow = await db.prompts.get(raw);
                    if (dbRow && dbRow.category === 'prose') {
                        app.selectedProsePromptId = raw;
                        // Also prime the in-memory currentPrompt so the UI reflects the selection
                        try {
                            app.currentPrompt = Object.assign({}, dbRow);
                            app.promptEditorContent = dbRow.content || '';
                        } catch (e) { /* ignore */ }
                        return;
                    }
                } catch (e) {
                    // ignore DB errors and fallthrough to clearing
                }

                // Fallback: check in-memory prompts list
                const exists = (app.prompts || []).some(p => p.id === raw && p.category === 'prose');
                app.selectedProsePromptId = exists ? raw : null;
            } catch (e) {
                app.selectedProsePromptId = null;
            }
        },

        /**
         * Persist selected prose prompt id per project
         * @param {Object} app - Alpine app instance
         * @param {string} id - Prompt ID to save
         */
        saveSelectedProsePrompt(app, id) {
            try {
                if (!app.currentProject || !app.currentProject.id) return;
                const key = `writingway:proj:${app.currentProject.id}:prosePrompt`;
                if (!id) {
                    localStorage.removeItem(key);
                    app.selectedProsePromptId = null;
                } else {
                    localStorage.setItem(key, id);
                    app.selectedProsePromptId = id;
                }
            } catch (e) { /* ignore */ }
        },

        /**
         * Rename the current project
         * @param {Object} app - Alpine app instance
         * @param {string} newName - New project name
         */
        async renameCurrentProject(app, newName) {
            if (!app.currentProject || !newName) return;
            try {
                await db.projects.update(app.currentProject.id, { name: newName, modified: new Date() });
                await this.loadProjects(app);
                // refresh currentProject reference
                app.currentProject = await db.projects.get(app.currentProject.id);
                app.showRenameProjectModal = false;
            } catch (e) {
                console.error('Failed to rename project:', e);
            }
        },

        /**
         * Delete a project and all its associated data
         * @param {Object} app - Alpine app instance
         * @param {string} projectId - ID of project to delete
         */
        async deleteProject(app, projectId) {
            if (!projectId) return;

            const project = await db.projects.get(projectId);
            if (!project) return;

            const confirmed = confirm(`Are you sure you want to delete "${project.name}"?\n\nThis will permanently delete:\n• All chapters and scenes\n• All compendium entries\n• All prompts\n• Workshop sessions\n\nThis cannot be undone!`);
            if (!confirmed) return;

            try {
                // Delete all related data
                await db.chapters.where('projectId').equals(projectId).delete();

                const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
                for (const scene of scenes) {
                    await db.content.where('sceneId').equals(scene.id).delete();
                }
                await db.scenes.where('projectId').equals(projectId).delete();

                await db.compendium.where('projectId').equals(projectId).delete();
                await db.prompts.where('projectId').equals(projectId).delete();

                // Delete project itself
                await db.projects.delete(projectId);

                // Reload projects list
                await this.loadProjects(app);

                // If we deleted the current project, clear it
                if (app.currentProject && app.currentProject.id === projectId) {
                    app.currentProject = null;
                    app.chapters = [];
                    app.scenes = [];
                    app.currentScene = null;
                }

                // Remove from localStorage if it was the last project
                const lastProjectId = localStorage.getItem('writingway:lastProject');
                if (lastProjectId === projectId) {
                    localStorage.removeItem('writingway:lastProject');
                }

                alert(`Project "${project.name}" has been deleted.`);
            } catch (e) {
                console.error('Failed to delete project:', e);
                alert('Failed to delete project. See console for details.');
            }
        },

        /**
         * Update project cover image
         * @param {Object} app - Alpine app instance
         * @param {string} projectId - ID of project to update
         * @param {string} coverDataUrl - Base64 data URL of cover image
         */
        async updateProjectCover(app, projectId, coverDataUrl) {
            if (!projectId) return;
            try {
                await db.projects.update(projectId, { coverImage: coverDataUrl, modified: new Date() });
                await this.loadProjects(app);
                // Refresh current project if it's the one being updated
                if (app.currentProject && app.currentProject.id === projectId) {
                    app.currentProject = await db.projects.get(projectId);
                }
            } catch (e) {
                console.error('Failed to update project cover:', e);
            }
        },

        /**
         * Export the current project as a ZIP file containing scenes (Markdown), metadata, and compendium
         * @param {Object} app - Alpine app instance
         */
        /**
         * Export current project as a ZIP file
         * @param {Object} app - Alpine app instance
         */
        async exportProject(app) {
            if (!app.currentProject) return;
            try {
                if (typeof JSZip === 'undefined') {
                    alert('ZIP export library is not loaded.');
                    return;
                }

                const zip = new JSZip();
                const pid = app.currentProject.id;

                const meta = { project: app.currentProject, chapters: [], exportedAt: new Date().toISOString() };

                const chapters = await db.chapters.where('projectId').equals(pid).sortBy('order');
                for (const ch of chapters) {
                    const chapterObj = { id: ch.id, title: ch.title, order: ch.order, scenes: [] };
                    const scenes = await db.scenes.where('projectId').equals(pid).and(s => s.chapterId === ch.id).sortBy('order');
                    for (const s of scenes) {
                        // fetch content robustly (primary lookup, then sceneId fallback)
                        let content = null;
                        try { content = await db.content.get(s.id); } catch (e) { content = null; }
                        if (!content) {
                            try { content = await db.content.where('sceneId').equals(s.id).first(); } catch (e) { content = null; }
                        }
                        const htmlText = content ? (content.text || '') : '';

                        // Export as plain text/Markdown
                        // Only remove filesystem-unsafe characters, keep Unicode (Cyrillic, etc.)
                        const safeTitle = (s.title || 'scene').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80).trim();
                        const filename = `scenes/${String(s.order).padStart(2, '0')}-${safeTitle || s.id}.txt`;
                        chapterObj.scenes.push({ id: s.id, title: s.title, order: s.order, filename });
                        zip.file(filename, htmlText || '');
                    }
                    meta.chapters.push(chapterObj);
                }

                // include compendium and other project-level stores
                try {
                    const comp = await db.compendium.where('projectId').equals(pid).toArray();
                    zip.file('compendium.json', JSON.stringify(comp || [], null, 2));
                } catch (e) {
                    // ignore if compendium doesn't exist
                }

                // include raw project JSON/metadata
                zip.file('metadata.json', JSON.stringify(meta, null, 2));

                const blob = await zip.generateAsync({ type: 'blob' });
                // Only remove filesystem-unsafe characters, keep Unicode (Cyrillic, etc.)
                const nameSafe = (app.currentProject.name || 'project').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80).trim();
                const fname = `${nameSafe || 'writingway_project'}.zip`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error('Export failed:', e);
                alert('Export failed: ' + (e && e.message ? e.message : e));
            }
        },

        /**
         * Import a project from a ZIP file
         * @param {Object} app - Alpine app instance
         * @param {Event|File} e - File input event or File object
         */
        async importProject(app, e) {
            try {
                if (typeof JSZip === 'undefined') {
                    alert('ZIP import library is not loaded.');
                    return;
                }

                // Get the file from the event or direct File object
                let file = null;
                if (e && e.target && e.target.files && e.target.files[0]) {
                    file = e.target.files[0];
                } else if (e instanceof File) {
                    file = e;
                }

                if (!file) {
                    alert('No file selected.');
                    return;
                }

                if (!file.name.endsWith('.zip')) {
                    alert('Please select a .zip file exported from Writingway.');
                    return;
                }

                // Read the ZIP file
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);

                // Read metadata
                const metadataFile = zip.file('metadata.json');
                if (!metadataFile) {
                    alert('Invalid export file: missing metadata.json');
                    return;
                }

                const metadataText = await metadataFile.async('text');
                const metadata = JSON.parse(metadataText);

                if (!metadata.project) {
                    alert('Invalid export file: missing project data');
                    return;
                }

                // Generate new IDs for the imported project to avoid conflicts
                const oldProjectId = metadata.project.id;
                const newProjectId = Date.now().toString() + '-imp-' + Math.random().toString(36).slice(2, 7);
                const idMap = { chapters: {}, scenes: {} }; // old ID -> new ID mapping

                // Create the project
                const newProject = {
                    id: newProjectId,
                    name: metadata.project.name + ' (imported)',
                    created: new Date(),
                    modified: new Date()
                };
                await db.projects.add(newProject);

                // Import chapters and scenes
                for (const chapterData of (metadata.chapters || [])) {
                    const oldChapterId = chapterData.id;
                    const newChapterId = Date.now().toString() + '-c-' + Math.random().toString(36).slice(2, 7);
                    idMap.chapters[oldChapterId] = newChapterId;

                    const newChapter = {
                        id: newChapterId,
                        projectId: newProjectId,
                        title: chapterData.title || 'Chapter',
                        order: chapterData.order || 0,
                        created: new Date(),
                        modified: new Date()
                    };
                    await db.chapters.add(newChapter);

                    // Import scenes for this chapter
                    for (const sceneData of (chapterData.scenes || [])) {
                        const oldSceneId = sceneData.id;
                        const newSceneId = Date.now().toString() + '-s-' + Math.random().toString(36).slice(2, 7);
                        idMap.scenes[oldSceneId] = newSceneId;

                        // Read scene content from the ZIP
                        const sceneFile = zip.file(sceneData.filename);
                        let text = '';
                        if (sceneFile) {
                            text = await sceneFile.async('text');
                        }

                        const newScene = {
                            id: newSceneId,
                            projectId: newProjectId,
                            chapterId: newChapterId,
                            title: sceneData.title || 'Scene',
                            order: sceneData.order || 0,
                            created: new Date(),
                            modified: new Date()
                        };
                        await db.scenes.add(newScene);

                        // Add scene content
                        const wordCount = text ? text.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
                        await db.content.add({
                            sceneId: newSceneId,
                            text: text || '',
                            wordCount: wordCount
                        });
                    }
                }

                // Import compendium if present
                try {
                    const compendiumFile = zip.file('compendium.json');
                    if (compendiumFile) {
                        const compendiumText = await compendiumFile.async('text');
                        const compendiumEntries = JSON.parse(compendiumText);

                        for (const entry of compendiumEntries) {
                            const newEntryId = Date.now().toString() + '-comp-' + Math.random().toString(36).slice(2, 7);
                            await db.compendium.add({
                                ...entry,
                                id: newEntryId,
                                projectId: newProjectId,
                                created: new Date(),
                                modified: new Date()
                            });
                        }
                    }
                } catch (e) {
                    console.warn('Failed to import compendium:', e);
                    // Continue anyway - compendium is optional
                }

                // Reload projects and select the new one
                await this.loadProjects(app);
                await this.selectProject(app, newProjectId);

                alert(`✓ Project imported successfully!\n\n"${newProject.name}"\n\nChapters: ${metadata.chapters.length}\nScenes: ${metadata.chapters.reduce((sum, ch) => sum + ch.scenes.length, 0)}`);

            } catch (e) {
                console.error('Import failed:', e);
                alert('Import failed: ' + (e && e.message ? e.message : e));
            }
        }
    };

    // Export to window
    window.ProjectManager = ProjectManager;

    // Expose test helpers
    window.__test = window.__test || {};
    window.__test.ProjectManager = ProjectManager;
})();
