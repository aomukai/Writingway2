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

// Add compendium table (v4)
db.version(4).stores({
    compendium: 'id, projectId, category, title, modified, tags'
}).upgrade(async tx => {
    // noop migration; new installs will get empty compendium
});

// Add compound index for compendium queries to speed up category lookups
// This creates a compound index on [projectId+category] which Dexie will use
// when querying by both fields together (e.g., { projectId, category }).
// Use a new DB version so existing installs get the index via Dexie migration.
db.version(5).stores({
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags'
}).upgrade(async tx => {
    // noop: index addition handled by Dexie
});

// Add prompt history table (v6)
db.version(6).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount',
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified',
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags',
    promptHistory: 'id, projectId, sceneId, timestamp, beat, prompt'
}).upgrade(async tx => {
    // noop: new table for prompt history
});

// Add workshopSessions table for Workshop Chat feature (v7)
db.version(7).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount',
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified',
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags',
    promptHistory: 'id, projectId, sceneId, timestamp, beat, prompt',
    workshopSessions: 'id, projectId, name, createdAt, updatedAt'
}).upgrade(async tx => {
    // noop: new table will be created automatically
});

// Expose the global Dexie instance for debugging and console usage
try { window.db = window.db || db; } catch (e) { /* ignore in non-browser env */ }

// Dev helpers: wait for Alpine app to be attached, force-save current scene, and dump DB
window.__waitForApp = function (timeout = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function check() {
            try {
                const el = document.querySelector('[x-data="app"]');
                const app = (el && el.__x && el.__x.$data) ? el.__x.$data : null;
                if (app) return resolve(app);
            } catch (e) { /* ignore */ }
            if (Date.now() - start > timeout) return reject(new Error('timeout waiting for app'));
            setTimeout(check, 100);
        })();
    });
};

window.__forceSave = async function () {
    const app = await window.__waitForApp().catch(e => null);
    if (!app) throw new Error('app not ready');
    if (window.Save && typeof window.Save.saveScene === 'function') {
        return await window.Save.saveScene(app);
    }
    if (typeof app.saveScene === 'function') return await app.saveScene();
    throw new Error('no save function available');
};

window.__dumpWritingway = async function () {
    try {
        const d = window.db || new Dexie('WritingwayDB');
        await d.open();
        console.log('projects:', await d.projects.toArray());
        console.log('chapters:', await d.chapters.toArray());
        console.log('scenes:', await d.scenes.toArray());
        console.log('content:', await d.content.toArray());
        d.close();
    } catch (e) {
        console.error('dump err', e);
    }
};

// Note: Dexie will open when first used; no automatic recovery toggles are present.

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
        showPromptHistory: false,
        promptHistoryList: [],
        showCodexPanel: false,
        showSpecialChars: false,

        // Projects carousel view
        showProjectsView: false,
        currentProjectCarouselIndex: 0,

        // Writingway 1 import
        showW1ImportModal: false,
        w1ImportInProgress: false,

        // Workshop Chat state
        showWorkshopChat: false,
        workshopSessions: [],
        currentWorkshopSessionIndex: 0,
        // Ensure at least one session exists when opening
        get hasWorkshopSessions() {
            return this.workshopSessions && this.workshopSessions.length > 0;
        },
        workshopInput: '',
        workshopIsGenerating: false,
        selectedWorkshopPromptId: null,
        workshopFidelityMode: 'balanced',
        showWorkshopContext: false,
        selectedWorkshopContext: [],
        // Workshop mention autocomplete state
        showWorkshopQuickSearch: false,
        workshopQuickSearchMatches: [],
        workshopQuickSearchSelectedIndex: 0,
        showWorkshopSceneSearch: false,
        workshopSceneSearchMatches: [],
        workshopSceneSearchSelectedIndex: 0,
        workshopCompendiumMap: {},
        workshopSceneMap: {},

        // Update checker state
        showUpdateDialog: false,
        updateAvailable: null,
        checkingForUpdates: false,

        // TTS (Text-to-Speech) state
        isReading: false,
        ttsVoiceName: '', // Selected voice name (string)
        ttsSpeed: 1.0, // Speech rate (0.5 - 2.0)
        availableTTSVoices: [], // Populated on init

        // Markdown preview state
        showMarkdownPreview: false,

        // App initialization state
        appReady: false,
        initProgress: 0,

        // Alpine lifecycle - setup watchers
        init() {
            // Watch for preview mode changes and stop TTS when switching to edit mode
            this.$watch('showMarkdownPreview', (isPreview) => {
                if (!isPreview && this.isReading) {
                    // Switched from preview to edit mode while reading - stop TTS
                    window.TTS.stop();
                    this.isReading = false;
                }
            });

            // Continue with normal initialization
            this.initializeApp();
        },

        currentScene: null,
        chapters: [],
        scenes: [], // flattened scenes list for quick access
        currentChapter: null,
        beatInput: '',
        // Quick-search state for compendium entries inside the beat field
        showQuickSearch: false,
        quickSearchMatches: [],
        quickSearchSelectedIndex: 0,
        quickInsertedCompendium: [],
        // Map of compendium mention titles to IDs in current beat: {'Dog': 'id123', ...}
        beatCompendiumMap: {},
        // Scene mention state (similar to compendium mentions)
        showSceneSearch: false,
        sceneSearchMatches: [],
        sceneSearchSelectedIndex: 0,
        quickInsertedScenes: [],
        // Map of scene mention titles to IDs in current beat: {'Scene 1': 'id456', ...}
        beatSceneMap: {},
        isGenerating: false,
        isSaving: false,
        saveStatus: 'Saved',
        // Generation acceptance flow
        lastGenStart: null,
        lastGenText: '',
        showGenActions: false,
        showGeneratedHighlight: false,
        lastBeat: '',
        saveTimeout: null,
        showNewProjectModal: false,
        showNewSceneModal: false,
        showNewChapterModal: false,
        showRenameChapterModal: false,
        showRenameSceneModal: false,
        newChapterName: '',
        newProjectName: '',
        newSceneName: '',
        renameChapterId: null,
        renameChapterName: '',
        renameSceneId: null,
        renameSceneName: '',

        // Scene generation options
        showSceneOptions: false,
        showContextPanel: false,
        povCharacter: '',
        pov: '3rd person limited',
        tense: 'past',

        // Scene summary panel
        showSummaryPanel: false,
        summaryText: '',
        summaryTargetSceneId: null,
        summaryTargetChapterId: null,
        selectedSummaryPromptId: null,
        showSummaryPromptList: false,

        // Tags (for scenes only)
        sceneTags: '', // Comma-separated tags for current scene being edited

        // Context Panel (persistent scene context for generation)
        contextPanel: {
            compendiumIds: [], // Array of compendium entry IDs
            chapters: {}, // { chapterId: 'full' | 'summary' | null }
            scenes: {}, // { sceneId: 'full' | 'summary' | null }
            tags: [] // Array of tag strings
        },

        // Prompts / Codex state
        prompts: [],
        promptCategories: ['prose', 'rewrite', 'summary', 'workshop'],
        promptCollapsed: {},
        currentPrompt: {},
        promptEditorContent: '',
        newPromptTitle: '',
        // Selected prose prompt id for generation defaults (persisted per-project in localStorage)
        selectedProsePromptId: null,

        // Compendium state
        // Reordered for priority: characters, places, items, lore, notes
        compendiumCategories: ['characters', 'places', 'items', 'lore', 'notes'],
        compendiumCounts: {},
        currentCompCategory: 'lore',
        compendiumList: [],
        currentCompEntry: null,

        // AI State
        compendiumSaveStatus: '',
        newCompTag: '',
        aiWorker: null,
        aiStatus: 'loading', // loading, ready, error
        aiStatusText: 'Initializing...',
        showModelLoading: false,
        loadingMessage: 'Setting up AI...',
        loadingProgress: 0,
        isInitializing: true, // Flag to prevent watchers from firing during init
        // AI Configuration
        aiMode: 'local', // 'local' or 'api'
        aiProvider: 'anthropic', // 'anthropic', 'openrouter', 'openai', 'google'
        aiApiKey: '',
        aiModel: '', // For API: model name, For local: filename from models folder
        aiEndpoint: '', // Custom endpoint URL
        availableLocalModels: [],
        showAIQuickStart: false,
        fetchingModels: false, // Loading state for model fetching
        modelsFetched: false, // Whether we've already fetched models for current provider

        // GitHub Backup State
        githubToken: '',
        githubUsername: '',
        backupEnabled: false,
        lastBackupTime: null,
        backupStatus: '',
        showBackupSettings: false,
        showRestoreModal: false,
        backupList: [],
        currentProjectGistId: '',

        // Generation Parameters
        temperature: 0.8,
        maxTokens: 300,

        // Available models per provider
        providerModels: {
            openrouter: [],
            anthropic: [
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', recommended: true },
                { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
            ],
            openai: [
                { id: 'gpt-4o', name: 'GPT-4o', recommended: true },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
                { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
                { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
            ],
            google: [
                { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', recommended: true },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
            ]
        },

        // Rewrite selection UI with modal
        showRewriteBtn: false,
        selectedTextForRewrite: '',
        rewriteSelectionRange: null,
        rewriteTextareaStart: null,
        rewriteTextareaEnd: null,
        showRewriteModal: false,
        rewriteOriginalText: '',
        rewriteOutput: '',
        rewriteInProgress: false,
        rewritePromptPreview: '',
        showRewritePromptList: false,
        selectedRewritePromptId: null,
        // track last mouseup info to avoid treating selection mouseup as an explicit click
        _lastMouseUpTargetTag: null,
        _lastMouseUpTime: 0,

        // Computed
        get currentSceneWords() {
            if (!this.currentScene || !this.currentScene.content) return 0;
            return this.countWords(this.currentScene.content);
        },

        get totalWords() {
            // Sum word counts by unique scene id to avoid double-counting duplicates
            const seen = new Set();
            let total = 0;
            for (const s of (this.scenes || [])) {
                if (!s || !s.id) continue;
                if (seen.has(s.id)) continue;
                seen.add(s.id);
                total += (s.wordCount || 0);
            }
            return total;
        },

        // Helper to update loading screen
        updateLoadingScreen(progress, status, tip) {
            try {
                const screen = document.getElementById('loadingScreen');
                const bar = document.getElementById('loadingBar');
                const statusEl = document.getElementById('loadingStatus');
                const tipEl = document.getElementById('loadingTip');

                if (bar) bar.style.width = `${progress}%`;
                if (statusEl && status) statusEl.textContent = status;
                if (tipEl && tip) tipEl.textContent = tip;

                this.initProgress = progress;
            } catch (e) {
                console.warn('Could not update loading screen:', e);
            }
        },

        // Hide loading screen when ready
        hideLoadingScreen() {
            try {
                const screen = document.getElementById('loadingScreen');
                if (screen) {
                    screen.style.opacity = '0';
                    setTimeout(() => {
                        screen.style.display = 'none';
                    }, 500);
                }
                this.appReady = true;
            } catch (e) {
                console.warn('Could not hide loading screen:', e);
            }
        },

        // Initialize
        async init() {
            this.updateLoadingScreen(10, 'Initializing...', 'Checking startup method...');

            // Detect if opened via file:// protocol and warn user
            if (window.location.protocol === 'file:') {
                const useFileDirect = confirm(
                    '⚠️ IMPORTANT: Data Storage Location\n\n' +
                    'You opened Writingway directly (file://) instead of using start.bat\n\n' +
                    'This means:\n' +
                    '• Your projects are stored in a DIFFERENT database than start.bat\n' +
                    '• Local AI server will NOT be running\n' +
                    '• You cannot use local models without start.bat\n\n' +
                    'RECOMMENDATION: Close this and run start.bat instead.\n\n' +
                    'Click OK to continue anyway (different database)\n' +
                    'Click Cancel to see instructions'
                );

                if (!useFileDirect) {
                    document.body.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;padding:20px;">
                            <div style="max-width:600px;background:#2a2a2a;border:2px solid #4a9eff;border-radius:12px;padding:32px;">
                                <h1 style="margin:0 0 16px 0;color:#4a9eff;font-size:24px;">🚀 How to Start Writingway</h1>
                                <ol style="line-height:1.8;padding-left:24px;margin:16px 0;">
                                    <li>Close this browser tab</li>
                                    <li>Navigate to your Writingway folder: <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;">E:\\Writingway2</code></li>
                                    <li>Double-click <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;color:#4a9eff;font-weight:600;">start.bat</code></li>
                                </ol>
                                <div style="background:rgba(74,158,255,0.1);border:1px solid rgba(74,158,255,0.3);border-radius:8px;padding:16px;margin-top:20px;">
                                    <p style="margin:0;font-size:14px;"><strong>Why?</strong></p>
                                    <p style="margin:8px 0 0 0;font-size:13px;line-height:1.6;">
                                        start.bat ensures:<br>
                                        • Unified project database (http://localhost:8000)<br>
                                        • Local AI server running with GPU support<br>
                                        • Fast model loading (2-3 seconds vs minutes)<br>
                                        • Proper CORS and security settings
                                    </p>
                                </div>
                                <button onclick="window.close()" style="margin-top:20px;padding:10px 20px;background:#4a9eff;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Close This Tab</button>
                            </div>
                        </div>
                    `;
                    return;
                }
            }

            this.updateLoadingScreen(20, 'Loading projects...', 'Accessing local database...');

            // Load projects and show projects view instead of auto-loading
            try {
                await this.loadProjects();
                // One-time migration: ensure scenes have a projectId so they are discoverable
                try { await this.migrateMissingSceneProjectIds(); } catch (e) { /* ignore */ }
                // Show projects landing page
                this.showProjectsView = true;
            } catch (e) {
                console.error('Failed to load projects:', e);
            }

            this.updateLoadingScreen(40, 'Loading AI settings...', 'Configuring generation parameters...');

            // Load AI settings from localStorage
            await this.loadAISettings();

            this.updateLoadingScreen(50, 'Initializing AI...', 'This may take 2-3 minutes on first run...');

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
                        // Allow ESC to close the Summary panel even when its textarea is focused.
                        if (isEditable && this.showSummaryPanel) {
                            this.showSummaryPanel = false;
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                        // Otherwise, don't close panels while typing in inputs/textareas
                        if (isEditable) return;
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
                    this.showSummaryPanel = false;
                    // stop propagation so nested handlers don't re-open
                    e.preventDefault();
                    e.stopPropagation();
                }

                // Arrow key navigation for project carousel
                if (this.showProjectsView && this.projects.length > 1) {
                    if (e.key === 'ArrowLeft') {
                        this.currentProjectCarouselIndex = (this.currentProjectCarouselIndex - 1 + this.projects.length) % this.projects.length;
                        e.preventDefault();
                    } else if (e.key === 'ArrowRight') {
                        this.currentProjectCarouselIndex = (this.currentProjectCarouselIndex + 1) % this.projects.length;
                        e.preventDefault();
                    } else if (e.key === 'Enter') {
                        // Open current carousel project
                        const currentProj = this.projects[this.currentProjectCarouselIndex];
                        if (currentProj) {
                            this.openProject(currentProj.id);
                            e.preventDefault();
                        }
                    }
                }
            });

            // Track last mouseup target so we can ignore accidental clicks caused by selection mouseup
            document.addEventListener('mouseup', (ev) => {
                try {
                    this._lastMouseUpTargetTag = ev && ev.target && ev.target.tagName ? ev.target.tagName.toUpperCase() : null;
                    this._lastMouseUpTime = Date.now();
                } catch (e) { /* ignore */ }
            }, true);

            // Watch AI settings and auto-save when they change (but not during initialization)
            this.$watch('aiMode', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('aiProvider', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('aiModel', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('aiApiKey', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('aiEndpoint', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('temperature', () => { if (!this.isInitializing) this.saveGenerationParams(); });
            this.$watch('maxTokens', () => { if (!this.isInitializing) this.saveGenerationParams(); });

            this.updateLoadingScreen(70, 'Loading features...', 'Setting up text-to-speech and updates...');

            // Check for updates on startup (silent mode)
            if (window.UpdateChecker) {
                setTimeout(() => window.UpdateChecker.checkAndNotify(this, true), 2000);
            }

            // Initialize TTS voices
            if (window.TTS) {
                // Load voices (they load async)
                setTimeout(() => {
                    this.availableTTSVoices = window.TTS.getVoices();
                    // Load saved voice preference
                    const savedVoiceName = localStorage.getItem('writingway:ttsVoice');
                    if (savedVoiceName) {
                        this.ttsVoiceName = savedVoiceName;
                    }
                    // Load saved speed
                    const savedSpeed = localStorage.getItem('writingway:ttsSpeed');
                    if (savedSpeed) this.ttsSpeed = parseFloat(savedSpeed);
                }, 500);
            }

            this.updateLoadingScreen(85, 'Almost ready...', 'Finalizing setup...');

            // Selection change handler: show Rewrite button when text is selected
            const self = this;
            const handleTextareaSelection = () => {
                try {
                    const editor = document.querySelector('.editor-textarea');
                    if (!editor || editor.tagName !== 'TEXTAREA') {
                        self.showRewriteBtn = false;
                        return;
                    }

                    // Get selected text from textarea
                    const start = editor.selectionStart;
                    const end = editor.selectionEnd;

                    if (start === end) {
                        self.showRewriteBtn = false;
                        return;
                    }

                    const selectedText = editor.value.substring(start, end).trim();
                    if (!selectedText) {
                        self.showRewriteBtn = false;
                        return;
                    }

                    // Store selection info
                    self.selectedTextForRewrite = selectedText;
                    self.rewriteTextareaStart = start;
                    self.rewriteTextareaEnd = end;
                    self.showRewriteBtn = true;
                } catch (e) {
                    // don't let selection code break the app
                    self.showRewriteBtn = false;
                }
            };

            // Add listeners for selection changes in textarea
            document.addEventListener('mouseup', handleTextareaSelection);
            document.addEventListener('keyup', handleTextareaSelection);
            // Mount the beat splitter which allows resizing the beat textarea
            try { this.mountBeatSplitter(); } catch (err) { /* ignore */ }

            // Add global enforcement of LTR direction on editor
            document.addEventListener('DOMNodeInserted', () => {
                const editor = document.querySelector('.editor-textarea[contenteditable="true"]');
                if (editor) {
                    editor.setAttribute('dir', 'ltr');
                    editor.style.direction = 'ltr';
                    editor.style.unicodeBidi = 'normal';
                }
            });

            // Also enforce on focus events
            document.addEventListener('focusin', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('editor-textarea')) {
                    e.target.setAttribute('dir', 'ltr');
                    e.target.style.direction = 'ltr';
                    e.target.style.unicodeBidi = 'normal';
                }
            }, true);

            // Load GitHub backup settings (with error handling to not block initialization)
            try {
                if (window.GitHubBackup && typeof window.GitHubBackup.loadBackupSettings === 'function') {
                    window.GitHubBackup.loadBackupSettings(this);
                }
            } catch (e) {
                console.error('Failed to load backup settings:', e);
            }

            // Final step: hide loading screen
            this.updateLoadingScreen(100, 'Ready!', 'Welcome to Writingway');
            setTimeout(() => {
                this.hideLoadingScreen();
                // Now that initialization is complete, enable watchers
                this.isInitializing = false;
            }, 300);
        },

        // Compute selection coordinates inside a textarea by mirroring styles into a hidden div.
        _getTextareaSelectionCoords(textarea, selectionIndex) {
            try {
                const rect = textarea.getBoundingClientRect();

                // Don't show button if textarea is not visible
                if (rect.width === 0 || rect.height === 0) {
                    return null;
                }

                // Create mirror div placed at the textarea's position
                const div = document.createElement('div');
                const style = window.getComputedStyle(textarea);
                // Copy relevant textarea styles
                div.style.position = 'absolute';
                div.style.visibility = 'hidden';
                div.style.whiteSpace = 'pre-wrap';
                div.style.wordWrap = 'break-word';
                div.style.overflow = 'hidden';
                div.style.boxSizing = 'border-box';
                div.style.width = rect.width + 'px';
                div.style.left = rect.left + window.scrollX + 'px';
                div.style.top = rect.top + window.scrollY + 'px';
                div.style.font = style.font || `${style.fontSize} ${style.fontFamily}`;
                div.style.fontSize = style.fontSize;
                div.style.lineHeight = style.lineHeight;
                div.style.padding = style.padding;
                div.style.border = style.border;
                div.style.letterSpacing = style.letterSpacing;
                div.style.whiteSpace = 'pre-wrap';

                const text = textarea.value.substring(0, selectionIndex);
                // Replace trailing spaces with nbsp so measurement matches
                const safe = text.replace(/\n$/g, '\n\u200b');
                div.textContent = safe;

                const span = document.createElement('span');
                span.textContent = textarea.value.substring(selectionIndex, selectionIndex + 1) || '\u200b';
                div.appendChild(span);

                document.body.appendChild(div);
                const spanRect = span.getBoundingClientRect();
                const coords = { left: spanRect.left, top: spanRect.top, height: spanRect.height, right: spanRect.right };
                document.body.removeChild(div);

                return coords;
            } catch (e) {
                return null;
            }
        },

        // Handle clicks on the floating Rewrite button: open modal with selected text
        handleRewriteButtonClick() {
            try {
                // For textarea, use stored selection indices
                const editor = document.querySelector('.editor-textarea');
                if (editor && editor.tagName === 'TEXTAREA') {
                    this.rewriteOriginalText = this.selectedTextForRewrite || '';
                    // Keep the selection indices for later replacement
                } else {
                    // Fallback for contenteditable (if ever used)
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        this.rewriteSelectionRange = selection.getRangeAt(0).cloneRange();
                        this.rewriteOriginalText = selection.toString();
                    } else {
                        this.rewriteOriginalText = this.selectedTextForRewrite || '';
                        this.rewriteSelectionRange = null;
                    }
                }
                this.rewriteOutput = '';
                this.rewritePromptPreview = '';
                this.rewriteInProgress = false;
                this.showRewriteModal = true;
                this.showRewriteBtn = false;
            } catch (e) { console.error('handleRewriteButtonClick error', e); }
        },

        buildRewritePrompt() {
            try {
                // Show the rewrite prompt list for selection
                this.showRewritePromptList = true;

                // If a rewrite prompt is selected, use it
                let rewritePrompt = '';
                if (this.selectedRewritePromptId) {
                    const selected = this.prompts.find(p => p.id === this.selectedRewritePromptId);
                    if (selected && selected.content) {
                        rewritePrompt = selected.content;
                    }
                }

                // Build the full prompt
                let prompt = rewritePrompt || 'Rewrite the following passage to be more vivid and polished while preserving its meaning and details. Keep roughly the same length.';
                prompt += '\n\nORIGINAL TEXT:\n' + this.rewriteOriginalText + '\n\nREWRITTEN TEXT:';
                this.rewritePromptPreview = prompt;
                return prompt;
            } catch (e) {
                console.error('buildRewritePrompt error', e);
                return 'Rewrite the following text:\n\n' + this.rewriteOriginalText;
            }
        },

        async performRewrite() {
            try {
                if (!this.rewriteOriginalText) return;
                if (!window.Generation || typeof window.Generation.streamGeneration !== 'function') {
                    throw new Error('Generation not available');
                }
                this.rewriteOutput = '';
                this.rewriteInProgress = true;
                const prompt = this.buildRewritePrompt();
                await window.Generation.streamGeneration(prompt, (token) => {
                    this.rewriteOutput += token;
                }, this);
                this.rewriteInProgress = false;
            } catch (e) {
                console.error('performRewrite error', e);
                this.rewriteInProgress = false;
                alert('Rewrite failed: ' + (e && e.message ? e.message : e));
            }
        },

        async acceptRewrite() {
            try {
                if (!this.currentScene || !this.rewriteOutput) return;

                const editor = document.querySelector('.editor-textarea');
                if (editor && editor.tagName === 'TEXTAREA') {
                    // Replace text in textarea using stored selection indices
                    if (this.rewriteTextareaStart !== null && this.rewriteTextareaEnd !== null) {
                        const before = this.currentScene.content.substring(0, this.rewriteTextareaStart);
                        const after = this.currentScene.content.substring(this.rewriteTextareaEnd);
                        this.currentScene.content = before + this.rewriteOutput + after;

                        // Save the scene
                        await this.saveCurrentScene();
                    }
                } else if (this.rewriteSelectionRange) {
                    // Fallback for contenteditable (if ever used)
                    const contentEditor = document.querySelector('.editor-textarea[contenteditable="true"]');
                    if (contentEditor) {
                        // Delete the selected content and insert the new text
                        this.rewriteSelectionRange.deleteContents();
                        const textNode = document.createTextNode(this.rewriteOutput);
                        this.rewriteSelectionRange.insertNode(textNode);

                        // Trigger the input event to save the change
                        const event = new Event('input', { bubbles: true });
                        contentEditor.dispatchEvent(event);
                    }
                }

                this.showRewriteModal = false;
                this.rewriteOriginalText = '';
                this.rewriteOutput = '';
                this.rewriteSelectionRange = null;
                this.rewriteTextareaStart = null;
                this.rewriteTextareaEnd = null;
            } catch (e) {
                console.error('acceptRewrite error', e);
            }
        },

        retryRewrite() {
            this.rewriteOutput = '';
            this.performRewrite();
        },

        discardRewrite() {
            this.showRewriteModal = false;
            this.showRewritePromptList = false;
            this.selectedRewritePromptId = null;
            this.rewriteOriginalText = '';
            this.rewriteOutput = '';
            this.rewritePromptPreview = '';
            this.rewriteTextareaStart = null;
            this.rewriteTextareaEnd = null;
        },

        // AI Configuration Functions - delegated to AISettings
        async fetchProviderModels() {
            await window.AISettings.fetchProviderModels(this);
        },
        async scanLocalModels() {
            await window.AISettings.scanLocalModels(this);
        },
        saveGenerationParams() {
            window.AISettings.saveGenerationParams(this);
        },
        async saveAISettings() {
            await window.AISettings.saveAISettings(this);
        },
        async loadAISettings() {
            await window.AISettings.loadAISettings(this);
        },

        // Update Checker
        async checkForUpdates() {
            if (window.UpdateChecker) {
                await window.UpdateChecker.checkAndNotify(this, false);
            }
        },

        // TTS: Toggle reading current scene aloud
        toggleTTS() {
            if (!window.TTS) {
                alert('Text-to-Speech not available');
                return;
            }

            if (this.isReading) {
                // Stop reading
                window.TTS.stop();
                this.isReading = false;
            } else {
                // Start reading current scene (only works in preview mode)
                if (!this.currentScene) {
                    alert('No scene selected to read');
                    return;
                }

                if (!this.showMarkdownPreview) {
                    alert('Switch to Preview mode to use Read Aloud');
                    return;
                }

                // Read from preview (Markdown rendered as plain text)
                const preview = document.querySelector('.editor-preview');
                const text = preview ? preview.innerText.trim() : '';

                if (!text || text.length === 0) {
                    alert('Scene is empty - nothing to read');
                    return;
                }

                this.isReading = true;

                // Find voice object by name
                let voiceObj = null;
                if (this.ttsVoiceName) {
                    voiceObj = this.availableTTSVoices.find(v => v.name === this.ttsVoiceName);
                }

                // Read with current settings
                window.TTS.speak(text, {
                    voice: voiceObj,
                    rate: this.ttsSpeed,
                    onEnd: () => {
                        this.isReading = false;
                    }
                });
            }
        },

        // Save TTS settings to localStorage
        saveTTSSettings() {
            if (this.ttsVoiceName) {
                localStorage.setItem('writingway:ttsVoice', this.ttsVoiceName);
            }
            localStorage.setItem('writingway:ttsSpeed', this.ttsSpeed.toString());
        },

        // Wire up the draggable beat splitter. Runs after Alpine has mounted.
        mountBeatSplitter() {
            const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

            const wireSplitter = () => {
                const separator = document.querySelector('.beat-separator');
                const beat = document.querySelector('.beat-input');
                if (!separator || !beat) return false;

                // Try restore saved height
                try {
                    const raw = localStorage.getItem('ww2_beatHeight');
                    if (raw) {
                        const parsed = parseInt(raw, 10);
                        if (!isNaN(parsed)) {
                            const style = window.getComputedStyle(beat);
                            const minH = parseInt(style.minHeight) || 40;
                            const maxH = parseInt(style.maxHeight) || 1000;
                            const restored = clamp(parsed, minH, maxH);
                            beat.style.height = restored + 'px';
                        }
                    }
                } catch (err) { /* ignore storage errors */ }

                let dragging = false;
                let startY = 0;
                let startHeight = 0;

                const mouseMove = (e) => {
                    if (!dragging) return;
                    const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
                    const delta = startY - clientY;
                    let newH = startHeight + delta;
                    const style = window.getComputedStyle(beat);
                    const minH = parseInt(style.minHeight) || 40;
                    const maxH = parseInt(style.maxHeight) || 1000;
                    newH = clamp(newH, minH, maxH);
                    beat.style.height = newH + 'px';
                    beat.dataset._lastHeight = String(newH);
                    e.preventDefault();
                };

                const stop = () => {
                    if (!dragging) return;
                    dragging = false;
                    document.removeEventListener('mousemove', mouseMove);
                    document.removeEventListener('touchmove', mouseMove);
                    document.removeEventListener('mouseup', stop);
                    document.removeEventListener('touchend', stop);
                    document.body.style.userSelect = '';
                    try {
                        const finalH = parseInt(beat.dataset._lastHeight || beat.clientHeight || 0, 10);
                        if (!isNaN(finalH) && finalH > 0) {
                            localStorage.setItem('ww2_beatHeight', String(finalH));
                        }
                    } catch (err) { /* ignore storage errors */ }
                };

                const start = (e) => {
                    dragging = true;
                    startY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
                    startHeight = beat.clientHeight;
                    document.addEventListener('mousemove', mouseMove, { passive: false });
                    document.addEventListener('touchmove', mouseMove, { passive: false });
                    document.addEventListener('mouseup', stop);
                    document.addEventListener('touchend', stop);
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                };

                separator.addEventListener('mousedown', start);
                separator.addEventListener('touchstart', start, { passive: false });
                return true;
            };

            const tryWire = () => {
                if (wireSplitter()) return;
                const t = setInterval(() => {
                    if (wireSplitter()) clearInterval(t);
                }, 150);
            };

            tryWire();
        },



        async loadLastProject() {
            await window.ProjectManager.loadLastProject(this);
        },

        // Open the summary slide-panel for a scene (foundation - placeholder)
        async openSceneSummary(sceneId) {
            try {
                const scene = (this.scenes || []).find(s => s.id === sceneId) || (this.currentScene && this.currentScene.id === sceneId ? this.currentScene : null);
                this.summaryTargetSceneId = sceneId;
                this.summaryTargetChapterId = null;
                this.summaryText = (scene && (scene.summary || '')) || '';
                // Load tags (array to comma-separated string)
                this.sceneTags = (scene && scene.tags && Array.isArray(scene.tags)) ? scene.tags.join(', ') : '';
                this.showSummaryPanel = true;
            } catch (e) {
                console.error('openSceneSummary error', e);
            }
        },

        // Open the summary slide-panel for a chapter
        async openChapterSummary(chapterId) {
            try {
                const chapter = (this.chapters || []).find(c => c.id === chapterId);
                this.summaryTargetChapterId = chapterId;
                this.summaryTargetSceneId = null;
                this.summaryText = (chapter && (chapter.summary || '')) || '';
                this.sceneTags = ''; // Clear tags for chapters
                this.showSummaryPanel = true;
            } catch (e) {
                console.error('openChapterSummary error', e);
            }
        },

        // Placeholder: generate a quick summary from the scene content (client-side heuristic)
        async summarizeScene() {
            try {
                const id = this.summaryTargetSceneId;
                if (!id) return;

                // Check if we should use AI or heuristic
                const summaryPrompts = this.prompts.filter(p => p.category === 'summary');
                const usePrompt = this.selectedSummaryPromptId
                    ? summaryPrompts.find(p => p.id === this.selectedSummaryPromptId)
                    : summaryPrompts[0]; // Use first summary prompt as default

                // Take the scene text if loaded, fall back to scenes list
                const scene = (this.scenes || []).find(s => s.id === id) || (this.currentScene && this.currentScene.id === id ? this.currentScene : null);
                const text = (scene && scene.content) || (this.currentScene && this.currentScene.content) || '';
                if (!text) {
                    this.summaryText = '';
                    return;
                }

                // If we have a summary prompt and AI is ready, use AI
                if (usePrompt && window.Generation && this.aiStatus === 'ready') {
                    try {
                        this.summaryText = 'Generating summary...';
                        const promptText = usePrompt.content || '';

                        // Build proper messages array with system instruction and user content
                        const messages = [
                            { role: 'system', content: promptText },
                            { role: 'user', content: `Please summarize the following scene text:\n\n${text}` }
                        ];

                        // Debug logging to verify which prompt is being used
                        console.log('🎯 Summarizing with prompt:', usePrompt.title);
                        console.log('📝 Prompt content:', promptText.slice(0, 100) + '...');
                        console.log('📄 Scene length:', text.length, 'characters');

                        let result = '';
                        await window.Generation.streamGeneration(messages, (token) => {
                            if (result === '' && this.summaryText === 'Generating summary...') {
                                this.summaryText = '';
                            }
                            result += token;
                            this.summaryText = result;
                        }, this);
                        return;
                    } catch (aiError) {
                        console.warn('AI summary failed, falling back to heuristic:', aiError);
                        // Fall through to heuristic below
                    }
                }

                // Fallback: Simple heuristic: take first 2 sentences or first 200 chars
                const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
                let summary = '';
                if (sentences.length >= 2) {
                    summary = (sentences[0] + ' ' + sentences[1]).trim();
                } else {
                    summary = text.replace(/\s+/g, ' ').trim().slice(0, 200);
                    if (text.length > 200) summary += '…';
                }

                this.summaryText = summary;
            } catch (e) {
                console.error('summarizeScene error', e);
            }
        },

        // Save the summary into IndexedDB and update in-memory scene
        async saveSceneSummary() {
            try {
                const id = this.summaryTargetSceneId;
                if (!id) return;

                // Parse tags from comma-separated string to array
                const tagsArray = this.sceneTags
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(tag => tag.length > 0);

                // update DB (create/overwrite summary field and summaryUpdated)
                // Safe-merge update: read current record, merge summary fields, then put back.
                try {
                    const cur = await db.scenes.get(id) || {};
                    const merged = Object.assign({}, cur, {
                        summary: this.summaryText,
                        summaryUpdated: new Date().toISOString(),
                        summarySource: 'manual',
                        summaryStale: false,
                        tags: tagsArray,
                        modified: new Date(),
                        id
                    });
                    await db.scenes.put(merged);
                } catch (e) {
                    console.warn('[App] saveSceneSummary write/readback failed', e);
                }

                // (watcher removed)

                // Update in-memory scenes list
                const s = (this.scenes || []).find(x => x.id === id);
                if (s) {
                    s.summary = this.summaryText;
                    s.summaryUpdated = new Date().toISOString();
                    s.summarySource = 'manual';
                    s.summaryStale = false;
                    s.tags = tagsArray;
                }
                // Also update chapter-scoped scenes so the sidebar reflects changes immediately
                try {
                    const sceneObj = (this.scenes || []).find(x => x.id === id) || this.currentScene;
                    if (sceneObj && sceneObj.chapterId) {
                        const ch = (this.chapters || []).find(c => c.id === sceneObj.chapterId);
                        if (ch && Array.isArray(ch.scenes)) {
                            const cs = ch.scenes.find(x => x.id === id);
                            if (cs) {
                                cs.summary = this.summaryText;
                                cs.summaryUpdated = new Date().toISOString();
                                cs.summarySource = 'manual';
                                cs.summaryStale = false;
                                cs.tags = tagsArray;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
                if (this.currentScene && this.currentScene.id === id) {
                    this.currentScene.summary = this.summaryText;
                    this.currentScene.summaryUpdated = new Date().toISOString();
                    this.currentScene.summarySource = 'manual';
                    this.currentScene.summaryStale = false;
                    this.currentScene.tags = tagsArray;
                }

                this.showSummaryPanel = false;
                this.summaryTargetSceneId = null;
                this.summaryText = '';
                this.sceneTags = '';
                this.saveStatus = 'Summary saved';
                setTimeout(() => { this.saveStatus = 'Saved'; }, 1200);
            } catch (e) {
                console.error('saveSceneSummary error', e);
            }
        },

        // Generate chapter summary from all scene summaries in the chapter
        async summarizeChapter() {
            try {
                const id = this.summaryTargetChapterId;
                if (!id) return;

                const chapter = (this.chapters || []).find(c => c.id === id);
                if (!chapter || !chapter.scenes || chapter.scenes.length === 0) {
                    this.summaryText = 'No scenes in this chapter to summarize.';
                    return;
                }

                // Check if we should use AI or heuristic
                const summaryPrompts = this.prompts.filter(p => p.category === 'summary');
                const usePrompt = this.selectedSummaryPromptId
                    ? summaryPrompts.find(p => p.id === this.selectedSummaryPromptId)
                    : summaryPrompts[0]; // Use first summary prompt as default

                // Collect all scene summaries
                const sceneSummaries = chapter.scenes
                    .filter(s => s.summary)
                    .map(s => `${s.title}: ${s.summary}`)
                    .join('\n\n');

                if (!sceneSummaries) {
                    this.summaryText = 'No scene summaries available. Please summarize individual scenes first.';
                    return;
                }

                // If we have a summary prompt and AI is ready, use AI
                if (usePrompt && window.Generation && this.aiStatus === 'ready') {
                    try {
                        this.summaryText = 'Generating chapter summary...';
                        const promptText = usePrompt.content || '';

                        // Build proper messages array with system instruction and user content
                        const messages = [
                            { role: 'system', content: promptText },
                            { role: 'user', content: `Please create a cohesive chapter summary from these scene summaries:\n\n${sceneSummaries}` }
                        ];

                        console.log('🎯 Summarizing chapter with prompt:', usePrompt.title);
                        console.log('📝 Chapter:', chapter.title);
                        console.log('📄 Scene summaries count:', chapter.scenes.filter(s => s.summary).length);

                        let result = '';
                        await window.Generation.streamGeneration(messages, (token) => {
                            if (result === '' && this.summaryText === 'Generating chapter summary...') {
                                this.summaryText = '';
                            }
                            result += token;
                            this.summaryText = result;
                        }, this);
                        return;
                    } catch (aiError) {
                        console.warn('AI chapter summary failed, falling back to heuristic:', aiError);
                        // Fall through to heuristic below
                    }
                }

                // Fallback: Simple concatenation of scene summaries
                this.summaryText = sceneSummaries;
            } catch (e) {
                console.error('summarizeChapter error', e);
            }
        },

        // Save the chapter summary into IndexedDB and update in-memory chapter
        async saveChapterSummary() {
            try {
                const id = this.summaryTargetChapterId;
                if (!id) return;

                // Update DB
                try {
                    const cur = await db.chapters.get(id) || {};
                    const merged = Object.assign({}, cur, {
                        summary: this.summaryText,
                        summaryUpdated: new Date().toISOString(),
                        summarySource: 'manual',
                        summaryStale: false,
                        modified: new Date(),
                        id
                    });
                    await db.chapters.put(merged);
                } catch (e) {
                    console.warn('[App] saveChapterSummary write/readback failed', e);
                }

                // Update in-memory chapters list
                const ch = this.chapters.find(c => c.id === id);
                if (ch) {
                    ch.summary = this.summaryText;
                    ch.summaryUpdated = new Date().toISOString();
                    ch.summarySource = 'manual';
                    ch.summaryStale = false;
                }

                this.showSummaryPanel = false;
                this.summaryTargetChapterId = null;
                this.summaryText = '';

                console.log('✅ Chapter summary saved:', id);
            } catch (e) {
                console.error('saveChapterSummary error', e);
            }
        },

        // Get all unique tags from scenes in the current project
        getAllTags() {
            const tagsSet = new Set();
            if (this.scenes && Array.isArray(this.scenes)) {
                this.scenes.forEach(scene => {
                    if (scene.tags && Array.isArray(scene.tags)) {
                        scene.tags.forEach(tag => {
                            if (tag && tag.trim()) {
                                tagsSet.add(tag.trim());
                            }
                        });
                    }
                });
            }
            return Array.from(tagsSet).sort();
        },

        // Context Panel Management
        toggleContextCompendium(entryId) {
            const index = this.contextPanel.compendiumIds.indexOf(entryId);
            if (index > -1) {
                this.contextPanel.compendiumIds.splice(index, 1);
            } else {
                this.contextPanel.compendiumIds.push(entryId);
            }
            this.saveContextPanel();
        },

        setContextChapter(chapterId, mode) {
            // mode: 'full', 'summary', or null
            if (mode === null) {
                delete this.contextPanel.chapters[chapterId];
            } else {
                this.contextPanel.chapters[chapterId] = mode;
            }
            this.saveContextPanel();
        },

        setContextScene(sceneId, mode) {
            // mode: 'full', 'summary', or null
            if (mode === null) {
                delete this.contextPanel.scenes[sceneId];
            } else {
                this.contextPanel.scenes[sceneId] = mode;
            }
            this.saveContextPanel();
        },

        toggleContextTag(tag) {
            const index = this.contextPanel.tags.indexOf(tag);
            if (index > -1) {
                this.contextPanel.tags.splice(index, 1);
            } else {
                this.contextPanel.tags.push(tag);
            }
            this.saveContextPanel();
        },

        saveContextPanel() {
            if (!this.currentProject) return;
            try {
                const key = `writingway:contextPanel:${this.currentProject.id}`;
                localStorage.setItem(key, JSON.stringify(this.contextPanel));
            } catch (e) {
                console.warn('Failed to save context panel:', e);
            }
        },

        loadContextPanel() {
            if (!this.currentProject) return;
            try {
                const key = `writingway:contextPanel:${this.currentProject.id}`;
                const saved = localStorage.getItem(key);
                if (saved) {
                    this.contextPanel = JSON.parse(saved);
                } else {
                    // Reset to default
                    this.contextPanel = {
                        compendiumIds: [],
                        chapters: {},
                        scenes: {},
                        tags: []
                    };
                }
            } catch (e) {
                console.warn('Failed to load context panel:', e);
                this.contextPanel = {
                    compendiumIds: [],
                    chapters: {},
                    scenes: {},
                    tags: []
                };
            }
        },

        // Project Management
        async createProject() {
            await window.ProjectManager.createProject(this, this.newProjectName);
        },

        async createDefaultScene() {
            await window.ProjectManager.createDefaultScene(this);
        },

        async loadProjects() {
            await window.ProjectManager.loadProjects(this);
        },

        // Fix scenes that may have been saved without a projectId (legacy or accidental overwrite).
        // Uses chapter.projectId when available, otherwise assigns the first project in the DB.
        async migrateMissingSceneProjectIds() {
            await window.ProjectManager.migrateMissingSceneProjectIds();
        },

        async selectProject(projectId) {
            await window.ProjectManager.selectProject(this, projectId);
        },

        // Open project from carousel (used in landing page)
        async openProject(projectId) {
            this.showProjectsView = false;
            await this.selectProject(projectId);
            localStorage.setItem('writingway:lastProject', projectId);
        },

        // Navigate back to projects carousel
        backToProjects() {
            this.showProjectsView = true;
            this.currentProject = null;
            this.chapters = [];
            this.scenes = [];
            this.currentScene = null;
        },

        // Delete a project
        async deleteProject(projectId) {
            await window.ProjectManager.deleteProject(this, projectId);
        },

        // Rename a project from carousel
        async renameProject(project) {
            if (!project) return;
            const newName = prompt('Enter new project name:', project.name);
            if (!newName || newName === project.name) return;
            try {
                await db.projects.update(project.id, { name: newName, modified: new Date() });
                await this.loadProjects();
            } catch (e) {
                console.error('Failed to rename project:', e);
                alert('Failed to rename project.');
            }
        },

        // Update project cover image
        async updateProjectCover(projectId, file) {
            if (!file || !file.type.startsWith('image/')) {
                alert('Please select an image file.');
                return;
            }

            // Resize and convert to data URL
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const img = new Image();
                    img.onload = async () => {
                        // Resize to max 400x600 (book cover proportions)
                        const maxWidth = 400;
                        const maxHeight = 600;
                        let width = img.width;
                        let height = img.height;

                        if (width > maxWidth || height > maxHeight) {
                            const ratio = Math.min(maxWidth / width, maxHeight / height);
                            width = width * ratio;
                            height = height * ratio;
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                        await window.ProjectManager.updateProjectCover(this, projectId, dataUrl);
                        // Force UI update by creating a new array reference
                        this.projects = await db.projects.orderBy('created').reverse().toArray();
                    };
                    img.src = e.target.result;
                } catch (err) {
                    console.error('Failed to process cover image:', err);
                    alert('Failed to process image.');
                }
            };
            reader.readAsDataURL(file);
        },

        // Remove project cover image
        async removeProjectCover(projectId) {
            if (!projectId) return;
            try {
                await db.projects.update(projectId, { coverImage: null, modified: new Date() });
                this.projects = await db.projects.orderBy('created').reverse().toArray();
            } catch (e) {
                console.error('Failed to remove cover:', e);
            }
        },

        // Import project from Writingway 1
        async importFromW1(event) {
            if (!window.W1Importer) {
                alert('W1 Importer module not loaded');
                return;
            }
            await window.W1Importer.importProject(this, event.target.files);
        },

        // Load persisted prose prompt selection for the current project (localStorage key per project)
        async loadSelectedProsePrompt() {
            await window.ProjectManager.loadSelectedProsePrompt(this);
        },

        // Persist selected prose prompt id per project
        saveSelectedProsePrompt(id) {
            window.ProjectManager.saveSelectedProsePrompt(this, id);
        },

        async renameCurrentProject() {
            await window.ProjectManager.renameCurrentProject(this, this.renameProjectName);
        },

        // Export the current project as a ZIP file containing scenes (Markdown), metadata, and compendium
        async exportProject() {
            await window.ProjectManager.exportProject(this);
        },

        // Import a project from a ZIP file
        async importProject(e) {
            await window.ProjectManager.importProject(this, e);
        },

        // Prompts management
        async loadPrompts() {
            // Delegate to prompts module
            if (window.Prompts && typeof window.Prompts.loadPrompts === 'function') {
                await window.Prompts.loadPrompts(this);
                try { await this.loadSelectedProsePrompt(); } catch (e) { /* ignore */ }
                return;
            }
            // Fallback: no-op
            this.prompts = [];
        },

        // Compendium methods - delegated to CompendiumManager
        async openCompendium() {
            await window.CompendiumManager.openCompendium(this);
        },
        async loadCompendiumCounts() {
            await window.CompendiumManager.loadCompendiumCounts(this);
        },
        async loadCompendiumCategory(category) {
            await window.CompendiumManager.loadCompendiumCategory(this, category);
        },
        // Get all compendium entries for the current project (for context panel)
        async getAllCompendiumEntries() {
            if (!this.currentProject) return [];
            try {
                const entries = await db.compendium.where('projectId').equals(this.currentProject.id).toArray();
                return entries || [];
            } catch (e) {
                console.error('Failed to load all compendium entries:', e);
                return [];
            }
        },
        async createCompendiumEntry(category) {
            await window.CompendiumManager.createCompendiumEntry(this, category);
        },
        async selectCompendiumEntry(id) {
            await window.CompendiumManager.selectCompendiumEntry(this, id);
        },
        async saveCompendiumEntry() {
            await window.CompendiumManager.saveCompendiumEntry(this);
        },
        addCompTag() {
            window.CompendiumManager.addCompTag(this);
        },
        removeCompTag(index) {
            window.CompendiumManager.removeCompTag(this, index);
        },
        setCompImageFromFile(e) {
            window.CompendiumManager.setCompImageFromFile(this, e);
        },
        confirmRemoveCompImage() {
            window.CompendiumManager.confirmRemoveCompImage(this);
        },
        async deleteCompendiumEntry(id) {
            await window.CompendiumManager.deleteCompendiumEntry(this, id);
        },
        async moveCompendiumEntryUp(id) {
            await window.CompendiumManager.moveCompendiumEntryUp(this, id);
        },
        async moveCompendiumEntryDown(id) {
            await window.CompendiumManager.moveCompendiumEntryDown(this, id);
        },
        async moveCompendiumEntryToCategory(id, newCategory) {
            await window.CompendiumManager.moveCompendiumEntryToCategory(this, id, newCategory);
        },

        // Workshop Chat methods
        async loadWorkshopSessions() {
            if (!this.currentProject) return;
            try {
                const sessions = await db.workshopSessions
                    .where('projectId')
                    .equals(this.currentProject.id)
                    .toArray();

                console.log('Loaded workshop sessions:', sessions.length, sessions);
                if (sessions.length > 0) {
                    this.workshopSessions = sessions;
                    // Ensure currentWorkshopSessionIndex is valid
                    if (this.currentWorkshopSessionIndex >= sessions.length) {
                        this.currentWorkshopSessionIndex = 0;
                    }
                } else {
                    // Create a default session
                    this.workshopSessions = [window.workshopChat.createNewSession(this)];
                    await this.saveWorkshopSessions();
                }
            } catch (error) {
                console.error('Failed to load workshop sessions:', error);
                this.workshopSessions = [window.workshopChat.createNewSession(this)];
            }
        },

        async saveWorkshopSessions() {
            if (!this.currentProject || !this.workshopSessions) return;
            try {
                console.log('Saving workshop sessions:', this.workshopSessions.length);
                // Save each session by updating or adding
                for (const session of this.workshopSessions) {
                    // Convert to plain object to avoid Proxy clone error
                    const sessionData = {
                        id: session.id,
                        name: session.name,
                        messages: JSON.parse(JSON.stringify(session.messages || [])), // Deep clone messages
                        createdAt: session.createdAt,
                        projectId: this.currentProject.id,
                        updatedAt: new Date().toISOString()
                    };

                    // Try to update first, if it doesn't exist, add it
                    const existing = await db.workshopSessions.get(session.id);
                    if (existing) {
                        console.log('Updating session:', session.id, session.name);
                        await db.workshopSessions.put(sessionData);
                    } else {
                        console.log('Adding new session:', session.id, session.name);
                        await db.workshopSessions.add(sessionData);
                    }
                }

                // Clean up any sessions in DB that are no longer in the array
                const allSessions = await db.workshopSessions
                    .where('projectId')
                    .equals(this.currentProject.id)
                    .toArray();

                const currentIds = new Set(this.workshopSessions.map(s => s.id));
                for (const session of allSessions) {
                    if (!currentIds.has(session.id)) {
                        console.log('Deleting orphaned session:', session.id);
                        await db.workshopSessions.delete(session.id);
                    }
                }
                console.log('✓ Workshop sessions saved successfully');
            } catch (error) {
                console.error('Failed to save workshop sessions:', error);
            }
        }, createWorkshopSession() {
            const newSession = window.workshopChat.createNewSession(this);
            this.workshopSessions.push(newSession);
            this.currentWorkshopSessionIndex = this.workshopSessions.length - 1;
            this.saveWorkshopSessions();
        },

        renameWorkshopSession(index) {
            const session = this.workshopSessions[index];
            if (!session) return;
            const newName = prompt('Rename conversation:', session.name);
            if (newName && newName.trim()) {
                session.name = newName.trim();
                // Force array update to trigger reactivity
                this.workshopSessions = [...this.workshopSessions];
                this.saveWorkshopSessions();
            }
        },

        async clearWorkshopSession(index) {
            const session = this.workshopSessions[index];
            if (!session) return;
            if (confirm('Clear all messages in this conversation? The conversation will be kept but all messages will be deleted.')) {
                session.messages = [];
                await this.saveWorkshopSessions();
            }
        },

        exportWorkshopSession(index) {
            const session = this.workshopSessions[index];
            if (!session || !session.messages || session.messages.length === 0) {
                alert('No messages to export.');
                return;
            }

            // Build markdown content
            let markdown = `# ${session.name}\n\n`;
            markdown += `*Created: ${new Date(session.createdAt).toLocaleString()}*\n\n`;
            markdown += `---\n\n`;

            for (const msg of session.messages) {
                const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
                const role = msg.role === 'user' ? '**You**' : '**Assistant**';
                markdown += `### ${role}${timestamp ? ' (' + timestamp + ')' : ''}\n\n`;
                markdown += `${msg.content}\n\n`;
                markdown += `---\n\n`;
            }

            // Download as file
            const blob = new Blob([markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            a.download = `workshop_${safeName}_${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
        },

        async deleteWorkshopSession(index) {
            if (this.workshopSessions.length <= 1) {
                alert('You must have at least one chat session.');
                return;
            }
            if (confirm('Delete this chat session? This cannot be undone.')) {
                this.workshopSessions.splice(index, 1);
                if (this.currentWorkshopSessionIndex >= this.workshopSessions.length) {
                    this.currentWorkshopSessionIndex = this.workshopSessions.length - 1;
                }
                await this.saveWorkshopSessions();
            }
        },

        async loadSelectedWorkshopPrompt() {
            if (!this.currentProject) return;
            const key = `workshopPrompt_${this.currentProject.id}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                this.selectedWorkshopPromptId = saved;
            }
        },

        saveSelectedWorkshopPrompt() {
            if (!this.currentProject) return;
            const key = `workshopPrompt_${this.currentProject.id}`;
            if (this.selectedWorkshopPromptId) {
                localStorage.setItem(key, this.selectedWorkshopPromptId);
            } else {
                localStorage.removeItem(key);
            }
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

        async movePromptUp(id) {
            if (!id || !this.currentProject) return;
            try {
                if (window.Prompts && typeof window.Prompts.movePromptUp === 'function') {
                    await window.Prompts.movePromptUp(this, id);
                }
            } catch (e) {
                console.error('Failed to move prompt up:', e);
            }
        },

        async movePromptDown(id) {
            if (!id || !this.currentProject) return;
            try {
                if (window.Prompts && typeof window.Prompts.movePromptDown === 'function') {
                    await window.Prompts.movePromptDown(this, id);
                }
            } catch (e) {
                console.error('Failed to move prompt down:', e);
            }
        },

        async renamePrompt(id) {
            if (!id) return;
            try {
                if (window.Prompts && typeof window.Prompts.renamePrompt === 'function') {
                    await window.Prompts.renamePrompt(this, id);
                }
            } catch (e) {
                console.error('Failed to rename prompt:', e);
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
                    // Primary lookup by primary key (sceneId), but some restored DBs may have
                    // stored content records with a different primary key. Use a fallback
                    // lookup by the `sceneId` property if primary-key get() returns nothing.
                    let content = null;
                    try {
                        content = await db.content.get(s.id);
                    } catch (e) {
                        content = null;
                    }
                    if (!content) {
                        try {
                            content = await db.content.where('sceneId').equals(s.id).first();
                        } catch (e) {
                            content = null;
                        }
                    }
                    s.wordCount = content ? content.wordCount : 0;
                    // load persisted generation options into scene if present
                    s.povCharacter = s.povCharacter || s.povCharacter === '' ? s.povCharacter : '';
                    s.pov = s.pov || s.pov === '' ? s.pov : '3rd person limited';
                    s.tense = s.tense || s.tense === '' ? s.tense : 'past';
                    // (debug log removed)
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

            // Debug: dump scenes for current project so we can inspect summary fields after load
            // (debug dump removed)
        },

        async createScene() {
            await window.SceneManager.createScene(this, this.newSceneName);
        },

        openNewSceneModal() {
            window.SceneManager.openNewSceneModal(this);
        },

        openNewChapterModal() {
            window.ChapterManager.openNewChapterModal(this);
        },

        async createChapter() {
            await window.ChapterManager.createChapter(this, this.newChapterName);
        },

        async loadScene(sceneId) {
            await window.SceneManager.loadScene(this, sceneId);
        },

        async moveSceneToChapter(sceneId, targetChapterId) {
            await window.SceneManager.moveSceneToChapter(this, sceneId, targetChapterId);
        },

        async moveSceneUp(sceneId) {
            await window.SceneManager.moveSceneUp(this, sceneId);
        },

        async moveSceneDown(sceneId) {
            await window.SceneManager.moveSceneDown(this, sceneId);
        },

        async deleteScene(sceneId) {
            await window.SceneManager.deleteScene(this, sceneId);
        },

        async moveChapterUp(chapterId) {
            await window.ChapterManager.moveChapterUp(this, chapterId);
        },

        async moveChapterDown(chapterId) {
            await window.ChapterManager.moveChapterDown(this, chapterId);
        },

        async deleteChapter(chapterId) {
            await window.ChapterManager.deleteChapter(this, chapterId);
        },

        openRenameChapterModal(chapterId) {
            const chapter = this.chapters.find(c => c.id === chapterId);
            if (chapter) {
                this.renameChapterId = chapterId;
                this.renameChapterName = chapter.title;
                this.showRenameChapterModal = true;
            }
        },

        async renameChapter() {
            if (!this.renameChapterId || !this.renameChapterName.trim()) return;
            try {
                await db.chapters.update(this.renameChapterId, {
                    title: this.renameChapterName.trim(),
                    modified: new Date()
                });
                await this.loadChapters();
                this.showRenameChapterModal = false;
                this.renameChapterId = null;
                this.renameChapterName = '';
            } catch (e) {
                console.error('Failed to rename chapter:', e);
                alert('Failed to rename chapter');
            }
        },

        openRenameSceneModal(sceneId) {
            const scene = this.scenes.find(s => s.id === sceneId);
            if (scene) {
                this.renameSceneId = sceneId;
                this.renameSceneName = scene.title;
                this.showRenameSceneModal = true;
            }
        },

        async renameScene() {
            if (!this.renameSceneId || !this.renameSceneName.trim()) return;
            try {
                await db.scenes.update(this.renameSceneId, {
                    title: this.renameSceneName.trim(),
                    modified: new Date()
                });
                await this.loadChapters();
                this.showRenameSceneModal = false;
                this.renameSceneId = null;
                this.renameSceneName = '';
            } catch (e) {
                console.error('Failed to rename scene:', e);
                alert('Failed to rename scene');
            }
        },

        // Editor
        onEditorChange(e) {
            // Content automatically updated via x-model
            this.saveStatus = 'Unsaved';
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => {
                this.saveScene({ autosave: true });
            }, 2000);
        },

        // Handle paste events
        handlePaste(e) {
            // Default paste behavior is fine for textarea
        },

        // Convert Markdown to HTML for preview
        markdownToHtml(text) {
            if (!text) return '';

            let html = text
                // Headers (must be processed before paragraphs)
                .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                // Blockquotes (must be before paragraphs)
                .replace(/^> (.+$)/gim, '<blockquote>$1</blockquote>')
                // Bold (process before paragraphs)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                // Italic (process before paragraphs)
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                // Strikethrough (process before paragraphs)
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                // Convert double line breaks to paragraph breaks
                .replace(/\n\n+/g, '</p><p>')
                // Convert single line breaks to <br>
                .replace(/\n/g, '<br>');

            // Wrap in paragraphs if not already wrapped in block elements
            if (!html.startsWith('<h') && !html.startsWith('<blockquote>')) {
                html = `<p>${html}</p>`;
            }

            return html;
        },        // Apply Markdown formatting to selected text in textarea
        applyFormatting(format) {
            const editor = document.querySelector('.editor-textarea');
            if (!editor || !this.currentScene) return;

            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const selectedText = editor.value.substring(start, end);

            if (!selectedText) {
                // No selection, just return
                return;
            }

            let replacement = '';

            switch (format) {
                case 'bold':
                    replacement = `**${selectedText}**`;
                    break;
                case 'italic':
                    replacement = `*${selectedText}*`;
                    break;
                case 'underline':
                    // Markdown doesn't have native underline, use HTML
                    replacement = `<u>${selectedText}</u>`;
                    break;
                case 'strikethrough':
                    replacement = `~~${selectedText}~~`;
                    break;
                case 'heading':
                    // Add heading at start of line
                    replacement = `## ${selectedText}`;
                    break;
                case 'quote':
                    // Add blockquote
                    replacement = `> ${selectedText}`;
                    break;
                default:
                    return;
            }

            // Replace selected text with formatted version
            const newContent =
                editor.value.substring(0, start) +
                replacement +
                editor.value.substring(end);

            this.currentScene.content = newContent;

            // Set cursor position after the inserted text
            this.$nextTick(() => {
                editor.focus();
                editor.selectionStart = start + replacement.length;
                editor.selectionEnd = start + replacement.length;
            });

            // Trigger save
            this.saveStatus = 'Unsaved';
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => {
                this.saveScene({ autosave: true });
            }, 2000);
        },

        // Beat quick-search handlers: detect @tokens (compendium) and #tokens (scenes)
        async onBeatInput(e) {
            await window.BeatMentions.onBeatInput(this, e);
        },

        async handleSceneSearch(query) {
            await window.BeatMentions.handleSceneSearch(this, query);
        },

        onBeatKey(e) {
            window.BeatMentions.onBeatKey(this, e);
        },

        selectQuickMatch(item) {
            window.BeatMentions.selectQuickMatch(this, item);
        },

        selectSceneMatch(scene) {
            window.BeatMentions.selectSceneMatch(this, scene);
        },

        // Parse beatInput for @[Title] mentions and return resolved compendium rows
        async resolveCompendiumEntriesFromBeat(beatText) {
            return await window.BeatMentions.resolveCompendiumEntriesFromBeat(this, beatText);
        },

        // Parse beatInput for #[Title] mentions and return resolved scene summaries
        async resolveSceneSummariesFromBeat(beatText) {
            return await window.BeatMentions.resolveSceneSummariesFromBeat(this, beatText);
        },



        // Temporary: build and show the exact prompt that will be sent to the LLM.
        // This honors POV, tense, selected prose prompt, and includes scene context.
        async previewPrompt() {
            if (!this.beatInput) {
                alert('No beat provided to preview.');
                return;
            }

            try {
                // Resolve prose prompt text (in-memory first, then DB fallback)
                const proseInfo = await this.resolveProsePromptInfo();
                const prosePromptText = proseInfo && proseInfo.text ? proseInfo.text : null;

                // Get context from context panel
                const panelContext = await this.buildContextFromPanel();

                // Resolve compendium entries and scene summaries from beat mentions
                let beatCompEntries = [];
                let beatSceneSummaries = [];
                try { beatCompEntries = await this.resolveCompendiumEntriesFromBeat(this.beatInput || ''); } catch (e) { beatCompEntries = []; }
                try { beatSceneSummaries = await this.resolveSceneSummariesFromBeat(this.beatInput || ''); } catch (e) { beatSceneSummaries = []; }

                // Merge context
                const compMap = new Map();
                panelContext.compendiumEntries.forEach(e => compMap.set(e.id, e));
                beatCompEntries.forEach(e => compMap.set(e.id, e));
                const compEntries = Array.from(compMap.values());

                const sceneMap = new Map();
                panelContext.sceneSummaries.forEach(s => sceneMap.set(s.title, s));
                beatSceneSummaries.forEach(s => sceneMap.set(s.title, s));
                const sceneSummaries = Array.from(sceneMap.values());

                let prompt;
                if (window.Generation && typeof window.Generation.buildPrompt === 'function') {
                    // DEBUG: log resolved prose info and options
                    try { console.debug('[preview] proseInfo=', proseInfo); } catch (e) { }
                    const optsPreview = { povCharacter: this.povCharacter, pov: this.pov, tense: this.tense, prosePrompt: prosePromptText, compendiumEntries: compEntries, sceneSummaries: sceneSummaries, preview: true };
                    try { console.debug('[preview] buildPrompt opts:', { proseType: typeof optsPreview.prosePrompt, len: optsPreview.prosePrompt ? optsPreview.prosePrompt.length : 0 }); } catch (e) { }
                    try { console.debug('[preview] prosePrompt raw:', JSON.stringify(optsPreview.prosePrompt)); } catch (e) { }
                    prompt = window.Generation.buildPrompt(this.beatInput, this.currentScene?.content || '', optsPreview);
                    try { console.debug('[preview] builtPrompt preview:', String(prompt).slice(0, 600).replace(/\n/g, '\\n')); } catch (e) { }
                } else {
                    // Fallback textual representation if generation module isn't loaded
                    prompt = `=== PREVIEW PROMPT ===\nBEAT:\n${this.beatInput}\n\nPOV CHARACTER: ${this.povCharacter || ''}\nPOV: ${this.pov}\nTENSE: ${this.tense}\n\n---\n(Scene content below)\n${this.currentScene?.content || ''}\n\n---\n(Prose prompt)\n${prosePromptText || '(none)'}\n`;
                }

                // Create a simple overlay showing the prompt in a read-only textarea so the user can inspect/copy it.
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.left = '0';
                overlay.style.top = '0';
                overlay.style.right = '0';
                overlay.style.bottom = '0';
                overlay.style.background = 'rgba(0,0,0,0.6)';
                overlay.style.zIndex = 99999;
                overlay.style.display = 'flex';
                overlay.style.alignItems = 'center';
                overlay.style.justifyContent = 'center';

                const box = document.createElement('div');
                box.style.width = '80%';
                box.style.maxWidth = '900px';
                box.style.maxHeight = '80%';
                box.style.background = 'var(--bg-primary)';
                box.style.color = 'var(--text-primary)';
                box.style.padding = '12px';
                box.style.borderRadius = '8px';
                box.style.overflow = 'auto';
                box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';

                // Header showing which prompt id/source was resolved (helps debug why fallback used)
                const header = document.createElement('div');
                header.style.fontSize = '13px';
                header.style.color = 'var(--text-secondary)';
                header.style.marginBottom = '8px';
                const resolvedId = (proseInfo && proseInfo.id) ? proseInfo.id : '(none)';
                const resolvedSource = (proseInfo && proseInfo.source) ? proseInfo.source : 'none';
                header.textContent = `Resolved prose prompt: ${resolvedId} (${resolvedSource})`;

                const ta = document.createElement('textarea');
                ta.readOnly = true;
                ta.style.width = '100%';
                ta.style.height = '60vh';
                ta.style.whiteSpace = 'pre-wrap';
                ta.style.fontFamily = 'monospace';
                ta.style.fontSize = '13px';
                ta.value = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

                const controls = document.createElement('div');
                controls.style.display = 'flex';
                controls.style.justifyContent = 'flex-end';
                controls.style.marginTop = '8px';

                const close = document.createElement('button');
                close.textContent = 'Close';
                close.className = 'btn btn-primary';
                close.onclick = () => { overlay.remove(); };

                const copy = document.createElement('button');
                copy.textContent = 'Copy';
                copy.className = 'btn btn-secondary';
                copy.style.marginRight = '8px';
                copy.onclick = () => {
                    try {
                        ta.select();
                        document.execCommand('copy');
                    } catch (e) { /* ignore */ }
                    copy.textContent = 'Copied';
                    setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
                };

                controls.appendChild(copy);
                controls.appendChild(close);

                box.appendChild(header);
                box.appendChild(ta);
                box.appendChild(controls);
                overlay.appendChild(box);
                document.body.appendChild(overlay);

            } catch (e) {
                console.error('previewPrompt error', e);
                alert('Failed to build preview prompt: ' + (e && e.message ? e.message : e));
            }
        },

        // Resolve the prose prompt content by id: check in-memory prompts then fall back to DB read.
        async resolveProsePromptText() {
            try {
                if (this.selectedProsePromptId) {
                    let p = (this.prompts || []).find(x => x.id === this.selectedProsePromptId && x.category === 'prose');
                    if (!p) {
                        try { p = await db.prompts.get(this.selectedProsePromptId); } catch (e) { p = null; }
                    }
                    if (p && p.content) return p.content;
                }
            } catch (e) {
                // ignore and fallthrough
            }

            if (this.currentPrompt && this.currentPrompt.content) return this.currentPrompt.content;
            return null;
        },

        // More detailed resolver that returns the prompt text, id and source (memory/db/current/none)
        async resolveProsePromptInfo() {
            try {
                if (this.selectedProsePromptId) {
                    let p = (this.prompts || []).find(x => x.id === this.selectedProsePromptId && x.category === 'prose');
                    if (p) return { id: p.id, text: p.content || null, source: 'memory' };
                    try {
                        p = await db.prompts.get(this.selectedProsePromptId);
                    } catch (e) { p = null; }
                    if (p) return { id: p.id, text: p.content || null, source: 'db' };
                    return { id: this.selectedProsePromptId, text: null, source: 'missing' };
                }
            } catch (e) {
                // fallthrough
            }

            if (this.currentPrompt && this.currentPrompt.content) return { id: this.currentPrompt.id || null, text: this.currentPrompt.content, source: 'currentPrompt' };
            return { id: null, text: null, source: 'none' };
        },

        async saveScene(opts) {
            opts = opts || {};
            // Delegate to extracted save utility when available
            if (window.Save && typeof window.Save.saveScene === 'function') {
                try {
                    return await window.Save.saveScene(this, opts);
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

            // Read previous records to detect content changes and mark summary stale if needed
            let prevContent = null;
            let prevScene = null;
            try {
                prevContent = await db.content.get(this.currentScene.id);
            } catch (e) { /* ignore */ }
            try {
                prevScene = await db.scenes.get(this.currentScene.id);
            } catch (e) { /* ignore */ }

            await db.content.put({
                sceneId: this.currentScene.id,
                text: this.currentScene.content,
                wordCount: wordCount
            });

            const scenePatch = { modified: new Date() };
            try {
                const contentChanged = prevContent && (prevContent.text || '') !== (this.currentScene.content || '');
                // Only mark summary stale automatically during autosave events
                if (contentChanged && prevScene && prevScene.summary && opts && opts.autosave) {
                    scenePatch.summaryStale = true;
                }
                // (debug log removed)
            } catch (e) { /* ignore */ }

            // Safe-merge update to avoid removing fields like `summary`.
            try {
                const cur = await db.scenes.get(this.currentScene.id) || {};
                const merged = Object.assign({}, cur, scenePatch, { id: this.currentScene.id });
                await db.scenes.put(merged);
                // (debug log removed)
            } catch (e) {
                // fallback to update if put fails
                try { await db.scenes.update(this.currentScene.id, scenePatch); } catch (err) { console.warn('fallback update failed', err); }
                try {
                    const dbScene = await db.scenes.get(this.currentScene.id);
                } catch (err) { /* ignore */ }
            }

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
                if (scenePatch.summaryStale) this.scenes[sceneIndex].summaryStale = true;
            }

            // Also update in chapter lists
            for (let ch of this.chapters) {
                if (ch.scenes) {
                    const idx = ch.scenes.findIndex(s => s.id === this.currentScene.id);
                    if (idx !== -1) ch.scenes[idx].wordCount = wordCount;
                    if (scenePatch.summaryStale && idx !== -1) ch.scenes[idx].summaryStale = true;
                }
            }

            if (scenePatch.summaryStale) {
                try {
                    if (this.currentScene) this.currentScene.summaryStale = true;
                } catch (e) { }
            }

            this.isSaving = false;
            this.saveStatus = 'Saved';
        },

        // Generation action handlers
        async acceptGeneration() {
            // Accept — nothing to change, just hide actions and clear buffers
            this.showGenActions = false;
            this.showGeneratedHighlight = false;
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
            this.showGeneratedHighlight = false;
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
            this.showGeneratedHighlight = false;
            this.lastGenStart = null;
            this.lastGenText = '';
            this.lastBeat = '';
            this.beatInput = '';
            await this.saveScene();
        },

        countWords(text) {
            if (!text) return 0;
            // Strip HTML tags for word counting
            const plainText = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
            return plainText.trim().split(/\s+/).filter(word => word.length > 0).length;
        },

        // Insert special character at cursor position in editor
        insertSpecialChar(char) {
            if (!this.currentScene) return;
            const textarea = document.querySelector('.editor-textarea');
            if (!textarea) return;

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = this.currentScene.content || '';

            this.currentScene.content = text.substring(0, start) + char + text.substring(end);
            this.showSpecialChars = false;

            this.$nextTick(() => {
                textarea.focus();
                const newPos = start + char.length;
                textarea.setSelectionRange(newPos, newPos);
            });
        },

        // Handle auto-replacement of -- to em dash
        handleAutoReplace(event) {
            if (!this.currentScene || !this.currentScene.content) return;

            const textarea = event.target;
            const cursorPos = textarea.selectionStart;
            const text = this.currentScene.content;

            // Check if we just typed a second hyphen
            if (text.substring(cursorPos - 2, cursorPos) === '--') {
                // Replace -- with em dash
                this.currentScene.content = text.substring(0, cursorPos - 2) + '—' + text.substring(cursorPos);

                this.$nextTick(() => {
                    const newPos = cursorPos - 1; // Move cursor after the em dash
                    textarea.setSelectionRange(newPos, newPos);
                });
            }
        },

        // AI Generation (delegates to src/generation.js)
        async loadPromptHistory() {
            if (!this.currentProject) {
                this.promptHistoryList = [];
                return;
            }
            try {
                const history = await db.promptHistory
                    .where('projectId')
                    .equals(this.currentProject.id)
                    .reverse()
                    .sortBy('timestamp');
                this.promptHistoryList = history;
            } catch (e) {
                console.error('Failed to load prompt history:', e);
                this.promptHistoryList = [];
            }
        },

        // Build context from context panel settings
        async buildContextFromPanel() {
            const context = {
                compendiumEntries: [],
                sceneSummaries: []
            };

            if (!this.currentProject) return context;

            // 1. Add compendium entries from context panel
            for (const entryId of this.contextPanel.compendiumIds) {
                try {
                    const entry = await db.compendium.get(entryId);
                    if (entry) {
                        context.compendiumEntries.push(entry);
                    }
                } catch (e) {
                    console.warn('Failed to load compendium entry:', entryId, e);
                }
            }

            // 2. Add scenes based on chapter/scene selections
            const processedScenes = new Set();

            // Process chapter-level selections
            for (const [chapterId, mode] of Object.entries(this.contextPanel.chapters)) {
                if (!mode) continue; // skip if no mode selected

                const chapter = this.chapters.find(c => c.id === chapterId);
                if (!chapter || !chapter.scenes) continue;

                for (const scene of chapter.scenes) {
                    if (processedScenes.has(scene.id)) continue;
                    processedScenes.add(scene.id);

                    if (mode === 'full') {
                        // Load full scene content
                        try {
                            const fullScene = await db.scenes.get(scene.id);
                            const content = await db.content.get(scene.id);
                            if (fullScene && content) {
                                context.sceneSummaries.push({
                                    title: fullScene.title,
                                    summary: content.text || ''
                                });
                            }
                        } catch (e) {
                            console.warn('Failed to load scene content:', scene.id, e);
                        }
                    } else if (mode === 'summary' && scene.summary) {
                        context.sceneSummaries.push({
                            title: scene.title,
                            summary: scene.summary
                        });
                    }
                }
            }

            // Process individual scene selections (only if chapter doesn't have a mode)
            for (const [sceneId, mode] of Object.entries(this.contextPanel.scenes)) {
                if (!mode || processedScenes.has(sceneId)) continue;

                // Check if this scene's chapter has a mode set
                const scene = this.scenes.find(s => s.id === sceneId);
                if (!scene) continue;

                if (this.contextPanel.chapters[scene.chapterId]) {
                    // Chapter mode takes precedence, skip individual scene
                    continue;
                }

                processedScenes.add(sceneId);

                if (mode === 'full') {
                    // Load full scene content
                    try {
                        const fullScene = await db.scenes.get(sceneId);
                        const content = await db.content.get(sceneId);
                        if (fullScene && content) {
                            context.sceneSummaries.push({
                                title: fullScene.title,
                                summary: content.text || ''
                            });
                        }
                    } catch (e) {
                        console.warn('Failed to load scene content:', sceneId, e);
                    }
                } else if (mode === 'summary' && scene.summary) {
                    context.sceneSummaries.push({
                        title: scene.title,
                        summary: scene.summary
                    });
                }
            }

            // 3. Add scenes by tags
            for (const tag of this.contextPanel.tags) {
                const taggedScenes = this.scenes.filter(s =>
                    s.tags && Array.isArray(s.tags) && s.tags.includes(tag)
                );

                for (const scene of taggedScenes) {
                    if (processedScenes.has(scene.id)) continue;
                    processedScenes.add(scene.id);

                    // Use summary if available, otherwise skip
                    if (scene.summary) {
                        context.sceneSummaries.push({
                            title: scene.title,
                            summary: scene.summary
                        });
                    }
                }
            }

            return context;
        },

        async generateFromBeat() {
            if (!this.beatInput || this.aiStatus !== 'ready') return;

            this.isGenerating = true;

            try {
                // store the beat so retry can reuse it
                this.lastBeat = this.beatInput;

                // Build the prompt using the generation module
                let prompt;
                if (window.Generation && typeof window.Generation.buildPrompt === 'function') {
                    // Resolve prose prompt text (in-memory first, then DB fallback)
                    const proseInfo = await this.resolveProsePromptInfo();
                    const prosePromptText = proseInfo && proseInfo.text ? proseInfo.text : null;

                    // Get context from context panel
                    const panelContext = await this.buildContextFromPanel();

                    // Resolve compendium entries and scene summaries from beat mentions (@/#)
                    let beatCompEntries = [];
                    let beatSceneSummaries = [];
                    try { beatCompEntries = await this.resolveCompendiumEntriesFromBeat(this.beatInput || ''); } catch (e) { beatCompEntries = []; }
                    try { beatSceneSummaries = await this.resolveSceneSummariesFromBeat(this.beatInput || ''); } catch (e) { beatSceneSummaries = []; }

                    // Merge context: panel context + beat mentions
                    // Use Map to deduplicate by ID
                    const compMap = new Map();
                    panelContext.compendiumEntries.forEach(e => compMap.set(e.id, e));
                    beatCompEntries.forEach(e => compMap.set(e.id, e));
                    const compEntries = Array.from(compMap.values());

                    // Merge scene summaries (deduplicate by title)
                    const sceneMap = new Map();
                    panelContext.sceneSummaries.forEach(s => sceneMap.set(s.title, s));
                    beatSceneSummaries.forEach(s => sceneMap.set(s.title, s));
                    const sceneSummaries = Array.from(sceneMap.values());

                    // DEBUG: log resolved context
                    try { console.debug('[generate] proseInfo=', proseInfo); } catch (e) { }
                    try { console.debug('[generate] prosePrompt raw:', JSON.stringify(prosePromptText)); } catch (e) { }
                    try { console.debug('[generate] panel compendium:', panelContext.compendiumEntries.length); } catch (e) { }
                    try { console.debug('[generate] panel scenes:', panelContext.sceneSummaries.length); } catch (e) { }
                    try { console.debug('[generate] beat compendium:', beatCompEntries.length); } catch (e) { }
                    try { console.debug('[generate] beat scenes:', beatSceneSummaries.length); } catch (e) { }
                    try { console.debug('[generate] merged compendium:', compEntries.length); } catch (e) { }
                    try { console.debug('[generate] merged scenes:', sceneSummaries.length); } catch (e) { }

                    const genOpts = { povCharacter: this.povCharacter, pov: this.pov, tense: this.tense, prosePrompt: prosePromptText, compendiumEntries: compEntries, sceneSummaries: sceneSummaries };
                    try { console.debug('[generate] buildPrompt opts:', { proseType: typeof genOpts.prosePrompt, len: genOpts.prosePrompt ? genOpts.prosePrompt.length : 0 }); } catch (e) { }
                    prompt = window.Generation.buildPrompt(this.beatInput, this.currentScene?.content || '', genOpts);
                    try { console.debug('[generate] builtPrompt preview:', String(prompt).slice(0, 600).replace(/\n/g, '\\n')); } catch (e) { }
                } else {
                    throw new Error('Generation module not available');
                }

                // Save prompt to history
                try {
                    await db.promptHistory.add({
                        id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 9),
                        projectId: this.currentProject?.id,
                        sceneId: this.currentScene?.id,
                        timestamp: new Date(),
                        beat: this.beatInput,
                        prompt: typeof prompt === 'object' && prompt.asString ? prompt.asString() : String(prompt)
                    });
                } catch (e) {
                    console.warn('Failed to save prompt history:', e);
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
                }, this);

                // Generation complete — expose accept/retry/discard actions
                this.showGenActions = true;
                this.showGeneratedHighlight = true;

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

                    // Auto-hide highlight after 5 seconds
                    setTimeout(() => {
                        this.showGeneratedHighlight = false;
                    }, 5000);
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
        },

        // ========== GitHub Backup Methods ==========

        async openBackupSettings() {
            this.showBackupSettings = true;
        },

        async closeBackupSettings() {
            this.showBackupSettings = false;
        },

        async saveBackupSettings() {
            // Validate token first
            if (this.githubToken) {
                this.backupStatus = 'Validating token...';
                const result = await window.GitHubBackup.validateToken(this.githubToken);

                if (!result.valid) {
                    alert('Invalid GitHub token: ' + result.error);
                    this.backupStatus = 'Token invalid';
                    return;
                }

                this.githubUsername = result.username;
            }

            // Save settings
            window.GitHubBackup.saveBackupSettings(this);

            // Start or stop auto-backup based on enabled state
            if (this.backupEnabled && this.githubToken) {
                window.GitHubBackup.startAutoBackup(this);
                this.backupStatus = 'Auto-backup enabled';
            } else {
                window.GitHubBackup.stopAutoBackup();
                this.backupStatus = 'Auto-backup disabled';
            }

            this.showBackupSettings = false;
        },

        async backupNow() {
            if (!this.githubToken || !this.currentProject) {
                alert('Please configure GitHub token and select a project first.');
                return;
            }

            this.backupStatus = 'Backing up...';
            const result = await window.GitHubBackup.backupToGist(this);

            if (result.success) {
                this.lastBackupTime = new Date();
                this.backupStatus = 'Backed up';
                if (result.gistId) {
                    this.currentProjectGistId = result.gistId;
                    window.GitHubBackup.saveBackupSettings(this);
                }
                alert('Backup successful!');
            } else {
                this.backupStatus = 'Backup failed';
                alert('Backup failed: ' + result.error);
            }
        },

        async openRestoreModal() {
            if (!this.githubToken || !this.currentProjectGistId) {
                alert('No backup configured for this project.');
                return;
            }

            this.backupStatus = 'Loading backups...';
            const result = await window.GitHubBackup.listBackups(this);

            if (result.success) {
                this.backupList = result.backups;
                this.showRestoreModal = true;
                this.backupStatus = '';
            } else {
                alert('Failed to load backups: ' + result.error);
                this.backupStatus = 'Failed to load';
            }
        },

        async closeRestoreModal() {
            this.showRestoreModal = false;
            this.backupList = [];
        },

        async restoreBackup(versionUrl) {
            if (!confirm('This will replace your current project with the backup. Continue?')) {
                return;
            }

            this.backupStatus = 'Restoring...';
            const result = await window.GitHubBackup.restoreFromBackup(this, versionUrl);

            if (result.success) {
                this.backupStatus = 'Restored';
                alert('Backup restored successfully!');
                this.showRestoreModal = false;
                this.backupList = [];
            } else {
                this.backupStatus = 'Restore failed';
                alert('Restore failed: ' + result.error);
            }
        }
    }));
});
