/**
 * App State Factory
 * Creates the initial state structure for the Alpine.js app
 * Organizes all reactive properties by feature/domain
 */

function createAppState() {
    return {
        // ========== Project State ==========
        currentProject: null,
        projects: [],
        selectedProjectId: null,

        // ========== UI Modal State ==========
        showRenameProjectModal: false,
        renameProjectName: '',
        showExportModal: false,
        exportFormat: 'zip', // 'zip', 'epub', 'html', 'txt'
        showAISettings: false,
        showPromptsPanel: false,
        showPromptHistory: false,
        promptHistoryList: [],
        showCodexPanel: false,
        showSpecialChars: false,
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

        // ========== Projects Carousel View ==========
        showProjectsView: false,
        currentProjectCarouselIndex: 0,
        currentProjectId: null,  // 当前轮播项目 ID（取代索引，避免数组重排序问题）

        // ========== Writingway 1 Import ==========
        showW1ImportModal: false,
        w1ImportInProgress: false,

        // ========== Workshop Chat State ==========
        showWorkshopChat: false,
        showEmbeddedWorkshop: false,
        workshopSplitterPosition: 50, // percentage
        beatPanelHeight: 280, // pixels - height of the beat panel
        workshopSessions: [],
        currentWorkshopSessionIndex: 0,
        workshopInput: '',
        workshopIsGenerating: false,
        selectedWorkshopPromptId: null,
        workshopFidelityMode: 'balanced',
        showWorkshopContext: false,
        selectedWorkshopContext: [],
        useWorkshopContextPanel: false,
        // Workshop mention autocomplete state
        showWorkshopQuickSearch: false,
        workshopQuickSearchMatches: [],
        workshopQuickSearchSelectedIndex: 0,
        showWorkshopSceneSearch: false,
        workshopSceneSearchMatches: [],
        workshopSceneSearchSelectedIndex: 0,
        workshopCompendiumMap: {},
        workshopSceneMap: {},

        // ========== Update Checker State ==========
        showUpdateDialog: false,
        updateAvailable: null,
        checkingForUpdates: false,

        // ========== Export Reminder State ==========
        showExportReminder: false,
        exportReminderDismissed: false,

        // ========== TTS (Text-to-Speech) State ==========
        isReading: false,
        ttsVoiceName: '', // Selected voice name
        ttsSpeed: 1.0, // Speech rate (0.5 - 2.0)
        availableTTSVoices: [], // Populated on init

        // ========== Markdown Preview State ==========
        showMarkdownPreview: false,

        // ========== App Initialization State ==========
        appReady: false,
        initProgress: 0,
        locale: (window.i18n && window.i18n.locale) || 'zh-CN',

        // ========== Scene Editing State ==========
        currentScene: null,
        chapters: [],
        scenes: [], // flattened scenes list for quick access
        currentChapter: null,

        // ========== Beat Input & Generation ==========
        beatInput: '',
        isGenerating: false,
        isSaving: false,
        saveStatus: 'Saved',
        saveTimeout: null,

        // ========== Generation Acceptance Flow ==========
        lastGenStart: null,
        lastGenText: '',
        showGenActions: false,
        showGeneratedHighlight: false,
        lastBeat: '',

        // ========== Quick Search for Compendium Mentions (@) ==========
        showQuickSearch: false,
        quickSearchMatches: [],
        quickSearchSelectedIndex: 0,
        quickInsertedCompendium: [],
        beatCompendiumMap: {}, // {'Title': 'id123'}

        // ========== Scene Mention Search (#) ==========
        showSceneSearch: false,
        sceneSearchMatches: [],
        sceneSearchSelectedIndex: 0,
        quickInsertedScenes: [],
        beatSceneMap: {}, // {'Scene 1': 'id456'}

        // ========== Scene Generation Options ==========
        showSceneOptions: false,
        showContextPanel: false,
        povCharacter: '',
        pov: '3rd person limited',
        tense: 'past',

        // ========== Scene Summary Panel ==========
        showSummaryPanel: false,
        summaryText: '',
        summaryTargetSceneId: null,
        summaryTargetChapterId: null,
        selectedSummaryPromptId: null,
        showSummaryPromptList: false,

        // ========== Scene Tags ==========
        sceneTags: '', // Comma-separated tags for current scene

        // ========== Context Panel (Persistent Generation Context) ==========
        contextPanel: {
            compendiumIds: [], // Array of compendium entry IDs
            chapters: {}, // { chapterId: 'full' | 'summary' | null }
            scenes: {}, // { sceneId: 'full' | 'summary' | null }
            tags: [] // Array of tag strings
        },
        allCompendiumEntries: [],

        // ========== Prompts / Codex State ==========
        prompts: [],
        promptCategories: [t('prompts.prose'), t('prompts.rewrite'), t('prompts.summary'), t('prompts.workshop')],
        promptCollapsed: {},
        currentPrompt: {},
        promptEditorContent: '',
        newPromptTitle: '',
        selectedProsePromptId: null, // Selected prose prompt for generation

        // ========== Compendium State ==========
        compendiumCategories: [t('compendium.characters'), t('compendium.places'), t('compendium.items'), t('compendium.lore'), t('compendium.notes')],
        compendiumCounts: {},
        currentCompCategory: 'lore',
        compendiumList: [],
        currentCompEntry: null,
        compendiumSaveStatus: '',
        newCompTag: '',

        // ========== AI Worker State ==========
        aiWorker: null,
        aiStatus: 'loading', // 'loading', 'ready', 'error'
        aiStatusText: 'Initializing...',
        showModelLoading: false,
        loadingMessage: 'Setting up AI...',
        loadingProgress: 0,
        isInitializing: true, // Flag to prevent watchers from firing during init

        // ========== AI Configuration ==========
        aiMode: 'local', // 'local' or 'api'
        aiProvider: 'anthropic', // 'anthropic', 'openrouter', 'openai', 'google'
        aiApiKey: '',
        aiModel: '', // For API: model name, For local: filename from models folder
        aiEndpoint: '', // Custom endpoint URL
        availableLocalModels: [],
        showAIQuickStart: false,
        fetchingModels: false, // Loading state for model fetching
        modelsFetched: false, // Whether we've already fetched models for current provider

        // ========== GitHub Backup State ==========
        githubToken: '',
        githubUsername: '',
        backupEnabled: false,
        lastBackupTime: null,
        backupStatus: '',
        showBackupSettings: false,
        showRestoreModal: false,
        backupList: [],
        currentProjectGistId: '',

        // ========== Generation Parameters ==========
        temperature: 0.8,
        maxTokens: 300,
        useProviderDefaults: false, // Don't send temperature/maxTokens, let provider use their defaults
        forceNonStreaming: false, // Force non-streaming mode for models that don't support it

        // ========== Available Models Per Provider ==========
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

        // ========== Rewrite Selection UI with Modal ==========
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
        // Track last mouseup info to avoid treating selection mouseup as an explicit click
        _lastMouseUpTargetTag: null,
        _lastMouseUpTime: 0,

        // ========== Computed Properties ==========
        get hasWorkshopSessions() {
            return this.workshopSessions && this.workshopSessions.length > 0;
        },

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
        }
    };
}

// Expose globally for Alpine.js
window.createAppState = createAppState;
