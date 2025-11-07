// Initialize Dexie Database with a migration path
const db = new Dexie('WritingwayDB');
// Original schema (version 1) - ensures compatibility with existing installs
db.version(1).stores({
    projects: 'id, name, created, modified',
    scenes: 'id, projectId, title, order, created, modified',
    content: 'sceneId, text, wordCount'
});
// Test-only helpers. Exposed to make automated tests deterministic.
// NOTE: This API is intended for test/dev only. It is safe to leave in the repo
// for FOSS usage; it exposes no secrets and only manipulates local IndexedDB and
// the app instance already present on the page.
(function () {
    try {
        window.__test = window.__test || {};

        window.__test.getApp = function () {
            const el = document.querySelector('[x-data="app"]');
            return (el && el.__x && el.__x.$data) ? el.__x.$data : null;
        };

        window.__test.seedProject = async function (name) {
            const id = Date.now().toString();
            const proj = { id: id, name: name || ('P-' + id), created: new Date(), modified: new Date() };
            await db.projects.add(proj);
            try { localStorage.setItem('writingway:lastProject', proj.id); } catch (e) { }
            return proj;
        };

        window.__test.seedChapter = async function (projectId, title) {
            const id = Date.now().toString() + '-c' + Math.random().toString(36).slice(2, 6);
            const chap = { id: id, projectId: projectId, title: title || 'Chapter', order: (await db.chapters.where('projectId').equals(projectId).count()), created: new Date(), modified: new Date() };
            await db.chapters.add(chap);
            return chap;
        };

        window.__test.seedScene = async function (projectId, chapterId, title) {
            const id = Date.now().toString() + '-s' + Math.random().toString(36).slice(2, 6);
            const scene = { id: id, projectId: projectId, chapterId: chapterId, title: title || 'Scene', order: (await db.scenes.where('projectId').equals(projectId).and(s => s.chapterId === chapterId).count()), created: new Date(), modified: new Date() };
            await db.scenes.add(scene);
            await db.content.add({ sceneId: scene.id, text: '', wordCount: 0 });
            return scene;
        };

        window.__test.selectProject = async function (projectId) {
            const app = window.__test.getApp();
            if (app && typeof app.selectProject === 'function') {
                await app.selectProject(projectId);
                return true;
            }
            return false;
        };

        window.__test.getLastGen = function () {
            const app = window.__test.getApp();
            if (!app) return null;
            return { lastGenStart: app.lastGenStart, lastGenText: app.lastGenText, lastBeat: app.lastBeat };
        };

        window.__test.triggerGenerate = async function (beat) {
            const app = window.__test.getApp();
            if (!app) throw new Error('app not ready');
            app.beatInput = beat || app.beatInput || '';
            if (typeof app.generateFromBeat === 'function') {
                await app.generateFromBeat();
                return true;
            }
            return false;
        };

        window.__test.callSave = async function () {
            const app = window.__test.getApp();
            if (!app) throw new Error('app not ready');
            if (typeof app.saveScene === 'function') {
                await app.saveScene();
                return true;
            }
            return false;
        };

        window.__test.normalizeAllOrders = async function () {
            const app = window.__test.getApp();
            if (app && typeof app.normalizeAllOrders === 'function') {
                await app.normalizeAllOrders();
                return true;
            }
            return false;
        };
    } catch (e) {
        // don't break app if test helper fails
        console.warn('Failed to attach __test helpers:', e && e.message ? e.message : e);
    }
})();

// New schema (version 2) adds chapters and scene.chapterId. Use upgrade() to migrate orphan scenes.
db.version(2).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount'
}).upgrade(async tx => {
    try {
        const projects = await tx.table('projects').toArray();
        for (const p of projects) {
            // Create a default chapter for the project
            const chapId = Date.now().toString() + '-m-' + Math.random().toString(36).slice(2, 7);
            await tx.table('chapters').add({
                id: chapId,
                projectId: p.id,
                title: 'Chapter 1',
                order: 0,
                created: new Date(),
                modified: new Date()
            });

            // Move orphan scenes (no chapterId) into the new default chapter
            const orphanScenes = await tx.table('scenes').where('projectId').equals(p.id).filter(s => !s.chapterId).toArray();
            for (const s of orphanScenes) {
                await tx.table('scenes').update(s.id, { chapterId: chapId });
            }
        }
    } catch (e) {
        // If migration fails for any reason, log but don't block opening the DB
        console.error('Dexie upgrade migration failed:', e);
    }
});

// Add prompts and codex tables (v3)
db.version(3).stores({
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified'
}).upgrade(async tx => {
    // noop migration for now; existing installs will get empty prompts/codex
});

// Alpine.js App
document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        // State
        currentProject: null,
        projects: [],
        selectedProjectId: null,
        showRenameProjectModal: false,
        renameProjectName: '',
        showAISettings: false,
        showPromptsPanel: false,
        showCodexPanel: false,
        currentScene: null,
        chapters: [],
        scenes: [], // flattened scenes list for quick access
        currentChapter: null,
        beatInput: '',
        isGenerating: false,
        isSaving: false,
        saveStatus: 'Saved',
        // Generation acceptance flow
        lastGenStart: null,
        lastGenText: '',
        showGenActions: false,
        lastBeat: '',
        saveTimeout: null,
        showNewProjectModal: false,
        showNewSceneModal: false,
        showNewChapterModal: false,
        newChapterName: '',
        newProjectName: '',
        newSceneName: '',

        // Scene generation options
        showSceneOptions: false,
        povCharacter: '',
        pov: '3rd person limited',
        tense: 'past',

        // Prompts / Codex state
        prompts: [],
        promptCategories: ['prose', 'rewrite', 'summary', 'workshop'],
        promptCollapsed: {},
        currentPrompt: {},
        promptEditorContent: '',
        newPromptTitle: '',

        // AI State
        aiWorker: null,
        aiStatus: 'loading', // loading, ready, error
        aiStatusText: 'Initializing...',
        showModelLoading: false,
        loadingMessage: 'Setting up AI...',
        loadingProgress: 0,

        // Computed
        get currentSceneWords() {
            if (!this.currentScene || !this.currentScene.content) return 0;
            return this.countWords(this.currentScene.content);
        },

        get totalWords() {
            return this.scenes.reduce((total, scene) => total + (scene.wordCount || 0), 0);
        },

        // Initialize
        async init() {
            // Load projects and last project selection, but don't let DB failures block AI initialization
            try {
                await this.loadProjects();
                // restore last selected project from localStorage if present
                const last = localStorage.getItem('writingway:lastProject');
                if (last && this.projects.find(p => p.id === last)) {
                    await this.selectProject(last);
                } else {
                    await this.loadLastProject();
                }
            } catch (e) {
                console.error('Failed to load projects/last project:', e);
            }

            // Initialize AI via extracted module (src/ai.js)
            if (window.AI && typeof window.AI.init === 'function') {
                try {
                    await window.AI.init(this);
                } catch (e) {
                    console.error('AI init failed:', e);
                    this.aiStatus = 'error';
                    this.aiStatusText = 'AI init failed';
                    this.showModelLoading = false;
                }
            } else {
                // Fallback if ai.js is not loaded
                this.aiStatus = 'error';
                this.aiStatusText = 'AI module missing';
                this.showModelLoading = false;
            }

            // Global Escape key handler to close slide panels / settings
            // BUT ignore when focus is inside an input/textarea or contenteditable element
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    try {
                        const ae = document.activeElement;
                        const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : null;
                        const isEditable = ae && (ae.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
                        if (isEditable) return; // don't close panels while typing
                    } catch (err) {
                        // ignore errors and continue
                    }

                    // Close all modals and slide panels if they're open
                    this.showAISettings = false;
                    this.showPromptsPanel = false;
                    this.showCodexPanel = false;
                    this.showNewProjectModal = false;
                    this.showRenameProjectModal = false;
                    this.showNewSceneModal = false;
                    this.showNewChapterModal = false;
                    // stop propagation so nested handlers don't re-open
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        },



        async loadLastProject() {
            // fallback: pick first project if available
            const projects = await db.projects.toArray();
            if (projects.length > 0) {
                this.currentProject = projects[0];
                this.selectedProjectId = this.currentProject.id;
                await this.loadChapters();
                if (this.scenes.length > 0) {
                    await this.loadScene(this.scenes[0].id);
                }
            }
        },

        // Project Management
        async createProject() {
            if (!this.newProjectName) return;

            const project = {
                id: Date.now().toString(),
                name: this.newProjectName,
                created: new Date(),
                modified: new Date()
            };

            await db.projects.add(project);
            this.currentProject = project;
            this.showNewProjectModal = false;
            this.newProjectName = '';

            // refresh projects list and select the new project
            await this.loadProjects();
            await this.selectProject(project.id);
            await this.createDefaultScene();
        },

        async createDefaultScene() {
            // Ensure there's at least one chapter; reuse existing if present to avoid duplicates
            let chapter = (await db.chapters.where('projectId').equals(this.currentProject.id).sortBy('order'))[0];
            if (!chapter) {
                chapter = {
                    id: Date.now().toString() + '-c',
                    projectId: this.currentProject.id,
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
                nextOrder = await db.scenes.where('projectId').equals(this.currentProject.id).and(s => s.chapterId === chapter.id).count();
            } catch (e) {
                nextOrder = 0;
            }

            const scene = {
                id: Date.now().toString(),
                projectId: this.currentProject.id,
                chapterId: chapter.id,
                title: 'Scene 1',
                order: nextOrder,
                // initialize with current POV options
                povCharacter: this.povCharacter || '',
                pov: this.pov || '3rd person limited',
                tense: this.tense || 'past',
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
            await this.normalizeAllOrders();
            await this.loadScene(scene.id);
        },

        async loadProjects() {
            this.projects = await db.projects.orderBy('created').reverse().toArray();
        },

        async selectProject(projectId) {
            const proj = await db.projects.get(projectId);
            if (!proj) return;
            this.currentProject = proj;
            this.selectedProjectId = proj.id;
            // persist last opened project
            try { localStorage.setItem('writingway:lastProject', proj.id); } catch (e) { }
            await this.loadChapters();
            await this.loadPrompts();
            if (this.scenes.length > 0) {
                await this.loadScene(this.scenes[0].id);
            } else {
                this.currentScene = null;
            }
        },

        async renameCurrentProject() {
            if (!this.currentProject || !this.renameProjectName) return;
            try {
                await db.projects.update(this.currentProject.id, { name: this.renameProjectName, modified: new Date() });
                await this.loadProjects();
                // refresh currentProject reference
                this.currentProject = await db.projects.get(this.currentProject.id);
                this.showRenameProjectModal = false;
            } catch (e) {
                console.error('Failed to rename project:', e);
            }
        },

        // Prompts management
        async loadPrompts() {
            // Delegate to prompts module
            if (window.Prompts && typeof window.Prompts.loadPrompts === 'function') {
                return window.Prompts.loadPrompts(this);
            }
            // Fallback: no-op
            this.prompts = [];
        },

        async createPrompt(category) {
            if (window.Prompts && typeof window.Prompts.createPrompt === 'function') {
                return window.Prompts.createPrompt(this, category);
            }
        },

        openPrompt(id) {
            if (window.Prompts && typeof window.Prompts.openPrompt === 'function') {
                return window.Prompts.openPrompt(this, id);
            }
        },

        async savePrompt() {
            if (window.Prompts && typeof window.Prompts.savePrompt === 'function') {
                return window.Prompts.savePrompt(this);
            }
        },

        async deletePrompt(id) {
            if (window.Prompts && typeof window.Prompts.deletePrompt === 'function') {
                return window.Prompts.deletePrompt(this, id);
            }
        },



        // Scene & Chapter Management
        async loadChapters() {
            // Load chapters for the current project
            this.chapters = await db.chapters
                .where('projectId')
                .equals(this.currentProject.id)
                .sortBy('order');

            // For each chapter, load its scenes
            this.scenes = [];
            for (let ch of this.chapters) {
                // Load scenes for this chapter by filtering projectId and chapterId
                let scenesForChapter = await db.scenes
                    .where('projectId')
                    .equals(this.currentProject.id)
                    .and(s => s.chapterId === ch.id)
                    .sortBy('order');

                for (let s of scenesForChapter) {
                    const content = await db.content.get(s.id);
                    s.wordCount = content ? content.wordCount : 0;
                    // load persisted generation options into scene if present
                    s.povCharacter = s.povCharacter || s.povCharacter === '' ? s.povCharacter : '';
                    s.pov = s.pov || s.pov === '' ? s.pov : '3rd person limited';
                    s.tense = s.tense || s.tense === '' ? s.tense : 'past';
                }

                // attach scenes array to chapter for UI
                ch.scenes = scenesForChapter;
                ch.expanded = ch.expanded ?? true;

                // add to flattened scenes list
                this.scenes.push(...scenesForChapter);
            }

            // If there are no chapters, create a default one and migrate orphan scenes
            if (this.chapters.length === 0) {
                const chapter = {
                    id: Date.now().toString() + '-c',
                    projectId: this.currentProject.id,
                    title: 'Chapter 1',
                    order: 0,
                    created: new Date(),
                    modified: new Date()
                };
                await db.chapters.add(chapter);

                // Move any existing scenes (which lack chapterId) into this chapter
                try {
                    const orphanScenes = await db.scenes.where('projectId').equals(this.currentProject.id).filter(s => !s.chapterId).toArray();
                    for (const s of orphanScenes) {
                        await db.scenes.update(s.id, { chapterId: chapter.id });
                    }
                } catch (e) {
                    console.warn('Failed to migrate orphan scenes into default chapter:', e);
                }

                await this.loadChapters();
                return;
            }

            // Set currentChapter to first if none
            if (!this.currentChapter) this.currentChapter = this.chapters[0];
        },

        async createScene() {
            if (!this.newSceneName) return;

            // Ensure we have a chapter to attach to
            if (!this.chapters || this.chapters.length === 0) {
                const chap = {
                    id: Date.now().toString() + '-c',
                    projectId: this.currentProject.id,
                    title: 'Chapter 1',
                    order: 0,
                    created: new Date(),
                    modified: new Date()
                };
                await db.chapters.add(chap);
                await this.loadChapters();
            }

            const targetChapter = this.currentChapter || this.chapters[0];

            const scene = {
                id: Date.now().toString(),
                projectId: this.currentProject.id,
                chapterId: targetChapter.id,
                title: this.newSceneName,
                order: (targetChapter.scenes || []).length,
                // initialize with current POV options
                povCharacter: this.povCharacter || '',
                pov: this.pov || '3rd person limited',
                tense: this.tense || 'past',
                created: new Date(),
                modified: new Date()
            };

            await db.scenes.add(scene);
            await db.content.add({
                sceneId: scene.id,
                text: '',
                wordCount: 0
            });

            this.showNewSceneModal = false;
            this.newSceneName = '';

            // Normalize orders and reload
            await this.normalizeAllOrders();
            await this.loadScene(scene.id);
        },

        openNewSceneModal() {
            // small helper so clicks are routed through a method (easier to debug)
            this.showNewSceneModal = true;
        },

        openNewChapterModal() {
            // set on next tick to avoid any click-propagation immediately closing the modal
            setTimeout(() => {
                this.showNewChapterModal = true;
            }, 0);
        },

        async createChapter() {
            if (!this.newChapterName) return;

            const chapter = {
                id: Date.now().toString(),
                projectId: this.currentProject.id,
                title: this.newChapterName,
                order: this.chapters.length,
                created: new Date(),
                modified: new Date()
            };

            await db.chapters.add(chapter);
            this.showNewChapterModal = false;
            this.newChapterName = '';

            // Normalize orders and reload chapters
            await this.normalizeAllOrders();
        },

        async loadScene(sceneId) {
            const scene = await db.scenes.get(sceneId);
            const content = await db.content.get(sceneId);

            this.currentScene = {
                ...scene,
                content: content ? content.text : ''
            };

            // Load scene-specific generation options into UI state
            this.povCharacter = scene.povCharacter || '';
            this.pov = scene.pov || '3rd person limited';
            this.tense = scene.tense || 'past';

            // Set currentChapter to the scene's chapter
            if (scene && scene.chapterId) {
                const ch = this.chapters.find(c => c.id === scene.chapterId);
                if (ch) this.currentChapter = ch;
            }
        },

        async moveSceneToChapter(sceneId, targetChapterId) {
            if (!sceneId || !targetChapterId) return;


            // Put the scene at the end of the target chapter
            const targetChapter = this.chapters.find(c => c.id === targetChapterId);
            const newOrder = (targetChapter && targetChapter.scenes) ? targetChapter.scenes.length : 0;
            // targetChapter lookup and newOrder determined here

            try {
                const res = await db.scenes.update(sceneId, { chapterId: targetChapterId, order: newOrder, modified: new Date() });
            } catch (e) {
                console.error('moveSceneToChapter update failed:', e);
            }

            // Normalize orders across chapters/scenes and reload
            await this.normalizeAllOrders();
            await this.loadScene(sceneId);
        },

        async moveSceneUp(sceneId) {
            // find scene and its chapter
            const scene = await db.scenes.get(sceneId);
            if (!scene) return;
            const ch = this.chapters.find(c => c.id === scene.chapterId);
            if (!ch || !ch.scenes) return;
            const idx = ch.scenes.findIndex(s => s.id === sceneId);
            if (idx <= 0) return; // already first

            const prev = ch.scenes[idx - 1];
            // swap orders
            await db.scenes.update(sceneId, { order: prev.order });
            await db.scenes.update(prev.id, { order: scene.order });
            await this.normalizeAllOrders();
        },

        async moveSceneDown(sceneId) {
            const scene = await db.scenes.get(sceneId);
            if (!scene) return;
            const ch = this.chapters.find(c => c.id === scene.chapterId);
            if (!ch || !ch.scenes) return;
            const idx = ch.scenes.findIndex(s => s.id === sceneId);
            if (idx === -1 || idx >= ch.scenes.length - 1) return; // already last

            const next = ch.scenes[idx + 1];
            await db.scenes.update(sceneId, { order: next.order });
            await db.scenes.update(next.id, { order: scene.order });
            await this.normalizeAllOrders();
        },

        async deleteScene(sceneId) {
            if (!confirm('Delete this scene? This cannot be undone.')) return;
            try {
                await db.scenes.delete(sceneId);
                await db.content.delete(sceneId);
                if (this.currentScene && this.currentScene.id === sceneId) this.currentScene = null;
                await this.normalizeAllOrders();
            } catch (e) {
                console.error('Failed to delete scene:', e);
            }
        },

        async moveChapterUp(chapterId) {
            const idx = this.chapters.findIndex(c => c.id === chapterId);
            if (idx <= 0) return;
            const cur = this.chapters[idx];
            const prev = this.chapters[idx - 1];
            await db.chapters.update(cur.id, { order: prev.order });
            await db.chapters.update(prev.id, { order: cur.order });
            await this.normalizeAllOrders();
        },

        async moveChapterDown(chapterId) {
            const idx = this.chapters.findIndex(c => c.id === chapterId);
            if (idx === -1 || idx >= this.chapters.length - 1) return;
            const cur = this.chapters[idx];
            const next = this.chapters[idx + 1];
            await db.chapters.update(cur.id, { order: next.order });
            await db.chapters.update(next.id, { order: cur.order });
            await this.normalizeAllOrders();
        },

        async deleteChapter(chapterId) {
            if (!confirm('Delete this chapter? Scenes inside will be moved to another chapter or deleted. Continue?')) return;
            const idx = this.chapters.findIndex(c => c.id === chapterId);
            if (idx === -1) return;

            // determine move target chapter (previous or next)
            let target = this.chapters[idx - 1] || this.chapters[idx + 1] || null;

            try {
                const scenesToHandle = (await db.scenes.where('projectId').equals(this.currentProject.id).filter(s => s.chapterId === chapterId).toArray()) || [];
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
                if (this.currentChapter && this.currentChapter.id === chapterId) this.currentChapter = target || null;
                await this.normalizeAllOrders();
            } catch (e) {
                console.error('Failed to delete chapter:', e);
            }
        },

        // Editor
        onEditorChange() {
            this.saveStatus = 'Unsaved';
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => {
                this.saveScene();
            }, 2000);
        },

        async saveScene() {
            // Delegate to extracted save utility when available
            if (window.Save && typeof window.Save.saveScene === 'function') {
                try {
                    return await window.Save.saveScene(this);
                } catch (err) {
                    // If helper fails, fall through to fallback behavior
                    console.error('Save helper failed, falling back to inline save:', err);
                }
            }

            // Fallback (inlined) save behavior if save-utils is not loaded or failed
            if (!this.currentScene) return;

            this.isSaving = true;
            this.saveStatus = 'Saving...';

            const wordCount = this.countWords(this.currentScene.content);

            await db.content.put({
                sceneId: this.currentScene.id,
                text: this.currentScene.content,
                wordCount: wordCount
            });

            await db.scenes.update(this.currentScene.id, {
                modified: new Date()
            });

            // persist generation options per-scene
            try {
                await db.scenes.update(this.currentScene.id, {
                    povCharacter: this.povCharacter || '',
                    pov: this.pov || '3rd person limited',
                    tense: this.tense || 'past'
                });
            } catch (e) {
                console.warn('Failed to persist scene generation options:', e);
            }

            const sceneIndex = this.scenes.findIndex(s => s.id === this.currentScene.id);
            if (sceneIndex !== -1) {
                this.scenes[sceneIndex].wordCount = wordCount;
            }

            // Also update in chapter lists
            for (let ch of this.chapters) {
                if (ch.scenes) {
                    const idx = ch.scenes.findIndex(s => s.id === this.currentScene.id);
                    if (idx !== -1) ch.scenes[idx].wordCount = wordCount;
                }
            }

            this.isSaving = false;
            this.saveStatus = 'Saved';
        },

        // Generation action handlers
        async acceptGeneration() {
            // Accept — nothing to change, just hide actions and clear buffers
            this.showGenActions = false;
            this.lastGenStart = null;
            this.lastGenText = '';
            this.lastBeat = '';
            // ensure scene saved
            await this.saveScene();
        },

        async retryGeneration() {
            // Remove the last generated text and re-run generation with same beat
            // lastGenStart may be 0 (start of content), so only bail when it's null/undefined
            if (!this.currentScene || this.lastGenStart === null || this.lastGenStart === undefined) return;
            const content = this.currentScene.content || '';
            const newContent = content.slice(0, this.lastGenStart);
            this.currentScene.content = newContent;
            this.showGenActions = false;
            // save removal
            await this.saveScene();

            // restore beat and re-run
            if (this.lastBeat) {
                this.beatInput = this.lastBeat;
                await this.generateFromBeat();
            }
        },

        async discardGeneration() {
            // Remove generated text and clear beat input
            // lastGenStart may be 0 (start of content), so only bail when it's null/undefined
            if (!this.currentScene || this.lastGenStart === null || this.lastGenStart === undefined) return;
            const content = this.currentScene.content || '';
            const newContent = content.slice(0, this.lastGenStart);
            this.currentScene.content = newContent;
            this.showGenActions = false;
            this.lastGenStart = null;
            this.lastGenText = '';
            this.lastBeat = '';
            this.beatInput = '';
            await this.saveScene();
        },

        countWords(text) {
            if (!text) return 0;
            return text.trim().split(/\s+/).filter(word => word.length > 0).length;
        },

        // AI Generation (delegates to src/generation.js)
        async generateFromBeat() {
            if (!this.beatInput || this.aiStatus !== 'ready') return;

            this.isGenerating = true;

            try {
                // store the beat so retry can reuse it
                this.lastBeat = this.beatInput;

                // Build the prompt using the generation module
                let prompt;
                if (window.Generation && typeof window.Generation.buildPrompt === 'function') {
                    prompt = window.Generation.buildPrompt(this.beatInput, this.currentScene?.content || '', {
                        povCharacter: this.povCharacter,
                        pov: this.pov,
                        tense: this.tense
                    });
                } else {
                    throw new Error('Generation module not available');
                }

                // remember where generated text will start
                const prevLen = this.currentScene ? (this.currentScene.content ? this.currentScene.content.length : 0) : 0;
                this.lastGenStart = prevLen;
                this.lastGenText = '';
                this.showGenActions = false;

                console.log('Sending generation request to llama-server...');

                if (!(window.Generation && typeof window.Generation.streamGeneration === 'function')) {
                    throw new Error('Generation.streamGeneration not available');
                }

                // Stream tokens and append into the current scene
                await window.Generation.streamGeneration(prompt, (token) => {
                    this.currentScene.content += token;
                    this.lastGenText += token;
                });

                // Generation complete — expose accept/retry/discard actions
                this.showGenActions = true;

                // Select the newly generated text in the textarea
                this.$nextTick(() => {
                    try {
                        const ta = document.querySelector('.editor-textarea');
                        if (ta) {
                            ta.focus();
                            // set selection to the generated region
                            const start = this.lastGenStart || 0;
                            const end = (this.currentScene && this.currentScene.content) ? this.currentScene.content.length : start;
                            ta.selectionStart = start;
                            ta.selectionEnd = end;
                            // scroll selection into view
                            const lineHeight = parseInt(window.getComputedStyle(ta).lineHeight) || 20;
                            ta.scrollTop = Math.max(0, Math.floor(start / 80) * lineHeight);
                        }
                    } catch (e) { }
                });

                // Clear beat input (we keep lastBeat so retry can reuse it)
                this.beatInput = '';

                // Auto-save after generation
                await this.saveScene();

            } catch (error) {
                console.error('Generation error:', error);
                alert('Failed to generate text. Make sure llama-server is running.\n\nError: ' + (error && error.message ? error.message : error));
            } finally {
                this.isGenerating = false;
            }
        },



        // Normalize chapter and scene order fields to be consecutive integers.
        async normalizeAllOrders() {
            if (window.DBUtils && typeof window.DBUtils.normalizeAllOrders === 'function') {
                return window.DBUtils.normalizeAllOrders(this);
            }

            // Fallback: if DBUtils is not available, perform local normalization
            if (!this.currentProject) return;
            const chs = await db.chapters.where('projectId').equals(this.currentProject.id).sortBy('order');
            for (let i = 0; i < chs.length; i++) {
                if (chs[i].order !== i) {
                    try { await db.chapters.update(chs[i].id, { order: i }); } catch (e) { }
                }
            }
            for (let ch of chs) {
                const scenes = await db.scenes.where('projectId').equals(this.currentProject.id).and(s => s.chapterId === ch.id).sortBy('order');
                for (let j = 0; j < scenes.length; j++) {
                    if (scenes[j].order !== j) {
                        try { await db.scenes.update(scenes[j].id, { order: j }); } catch (e) { }
                    }
                }
            }
            await this.loadChapters();
        }
    }));
});
