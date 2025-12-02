// Tab synchronization using BroadcastChannel API
// This module handles syncing changes between multiple tabs of the application
(function () {
    const CHANNEL_NAME = 'writingway-sync';
    let channel = null;
    let app = null;

    // Unique identifier for this tab instance
    const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const TAB_TIMESTAMP = Date.now();

    // Track which tabs exist and determine if this is the primary (editor) tab
    let knownTabs = new Map(); // Map of tabId -> { timestamp, lastHeartbeat }
    let isPrimaryTab = true; // Assume primary until we hear from an older tab
    let heartbeatInterval = null;
    const HEARTBEAT_INTERVAL = 2000; // Send heartbeat every 2 seconds
    const TAB_TIMEOUT = 6000; // Consider tab dead after 6 seconds without heartbeat

    // Track last user activity to avoid interrupting active editing
    let lastActivityTime = Date.now();
    const ACTIVITY_THRESHOLD = 5000; // 5 seconds - if user was active in last 5s, don't interrupt

    // Message types
    const MSG_TYPES = {
        TAB_ANNOUNCEMENT: 'tab:announcement',
        TAB_HEARTBEAT: 'tab:heartbeat',
        TAB_CLOSED: 'tab:closed',
        PROJECT_SAVED: 'project:saved',
        CHAPTER_SAVED: 'chapter:saved',
        SCENE_SAVED: 'scene:saved',
        CONTENT_SAVED: 'content:saved',
        PROJECT_DELETED: 'project:deleted',
        CHAPTER_DELETED: 'chapter:deleted',
        SCENE_DELETED: 'scene:deleted',
        PROMPT_SAVED: 'prompt:saved',
        CODEX_SAVED: 'codex:saved',
        COMPENDIUM_SAVED: 'compendium:saved',
        COMPENDIUM_DELETED: 'compendium:deleted',
        WORKSHOP_SAVED: 'workshop:saved'
    };

    function init(appInstance) {
        if (!window.BroadcastChannel) {
            console.warn('BroadcastChannel not supported - multi-tab sync disabled');
            return;
        }

        // Prevent double initialization
        if (channel) {
            console.warn('TabSync already initialized, skipping');
            return;
        }

        app = appInstance;
        channel = new BroadcastChannel(CHANNEL_NAME);

        // Register this tab
        knownTabs.set(TAB_ID, { timestamp: TAB_TIMESTAMP, lastHeartbeat: Date.now() });

        // Announce this tab's presence
        broadcast(MSG_TYPES.TAB_ANNOUNCEMENT, { tabId: TAB_ID, timestamp: TAB_TIMESTAMP });
        console.log('📢 Tab announced:', { TAB_ID, TAB_TIMESTAMP, isPrimaryTab });

        // Start heartbeat to signal we're alive
        startHeartbeat();

        // Periodically check for dead tabs
        setInterval(checkForDeadTabs, 3000);

        // Listen for beforeunload to announce tab closing
        window.addEventListener('beforeunload', () => {
            broadcast(MSG_TYPES.TAB_CLOSED, { tabId: TAB_ID });
            stopHeartbeat();
        });

        // Track user activity to avoid interrupting active editing
        const trackActivity = () => {
            lastActivityTime = Date.now();
        };
        document.addEventListener('keydown', trackActivity);
        document.addEventListener('keyup', trackActivity);
        document.addEventListener('click', trackActivity);
        document.addEventListener('input', trackActivity);
        document.addEventListener('change', trackActivity);
        document.addEventListener('mousedown', trackActivity);
        document.addEventListener('focus', trackActivity, true); // Use capture to catch all focus events

        channel.onmessage = async (event) => {
            const { type, data, tabId } = event.data;

            console.log('📨 Raw broadcast received:', { type, fromTabId: tabId, myTabId: TAB_ID, isOwnBroadcast: tabId === TAB_ID });

            // Ignore messages from this tab
            if (tabId === TAB_ID) {
                console.log('🚫 Ignoring own broadcast');
                return;
            }

            console.log('📡 Processing sync message:', type, data);

            try {
                await handleMessage(type, data);
            } catch (e) {
                console.error('Failed to handle sync message:', e);
            }
        };

        console.log('✅ Tab sync initialized with ID:', TAB_ID);
    }

    async function handleMessage(type, data) {
        if (!app) return;

        switch (type) {
            case MSG_TYPES.TAB_ANNOUNCEMENT:
                // Another tab is announcing itself
                knownTabs.set(data.tabId, { timestamp: data.timestamp, lastHeartbeat: Date.now() });

                // If the announcing tab is older than us, we're not primary
                if (data.timestamp < TAB_TIMESTAMP) {
                    if (isPrimaryTab) {
                        isPrimaryTab = false;
                        console.log('🔒 This tab is now READ-ONLY (older tab detected)');
                        setEditorReadOnly(true);
                    }
                } else {
                    // We're older - remind them we exist
                    broadcast(MSG_TYPES.TAB_ANNOUNCEMENT, { tabId: TAB_ID, timestamp: TAB_TIMESTAMP });
                }
                break;

            case MSG_TYPES.TAB_HEARTBEAT:
                // Update last heartbeat time for this tab
                const tabInfo = knownTabs.get(data.tabId);
                if (tabInfo) {
                    tabInfo.lastHeartbeat = Date.now();
                } else {
                    // New tab we didn't know about - add it
                    knownTabs.set(data.tabId, { timestamp: data.timestamp || Date.now(), lastHeartbeat: Date.now() });

                    // Check if we should demote to read-only
                    if ((data.timestamp || Date.now()) < TAB_TIMESTAMP && isPrimaryTab) {
                        isPrimaryTab = false;
                        console.log('🔒 This tab is now READ-ONLY (older tab heartbeat detected)');
                        setEditorReadOnly(true);
                    }
                }
                break;

            case MSG_TYPES.TAB_CLOSED:
                knownTabs.delete(data.tabId);
                checkIfShouldBecomePrimary();
                break; case MSG_TYPES.PROJECT_SAVED:
                // Reload projects list if on project selection screen
                if (!app.currentProject || app.currentProject.id === data.id) {
                    await app.loadProjects?.();
                }
                break;

            case MSG_TYPES.CHAPTER_SAVED:
                // Reload chapters if viewing this project
                if (app.currentProject?.id === data.projectId) {
                    await app.loadChapters?.();
                }
                break;

            case MSG_TYPES.SCENE_SAVED:
                console.log('🔍 SCENE_SAVED handler:', {
                    incomingSceneId: data.id,
                    currentSceneId: app.currentScene?.id,
                    match: app.currentScene?.id === data.id
                });

                // Reload scene if it's currently open in another tab
                if (app.currentScene?.id === data.id) {
                    const updatedScene = await db.scenes.get(data.id);
                    // Only show conflict if the DB version is newer than what we loaded
                    const loadedTimestamp = app.currentScene.loadedUpdatedAt || 0;

                    console.log('🔍 Timestamp check:', {
                        dbUpdatedAt: updatedScene?.updatedAt,
                        loadedUpdatedAt: loadedTimestamp,
                        willShowConflict: updatedScene?.updatedAt > loadedTimestamp
                    });

                    if (updatedScene && updatedScene.updatedAt && updatedScene.updatedAt > loadedTimestamp) {
                        // Check if user has unsaved changes - if so, don't interrupt them
                        const hasUnsavedChanges = app.currentScene.content !== updatedScene.content;

                        console.log('🔍 Content check:', {
                            hasUnsavedChanges,
                            currentLength: app.currentScene.content?.length,
                            dbLength: updatedScene.content?.length
                        });

                        if (hasUnsavedChanges) {
                            console.log('⏭️ User has unsaved changes, silently updating loadedUpdatedAt without showing dialog');
                            // Silently acknowledge the change so we don't get repeated notifications
                            if (app.currentScene) {
                                app.currentScene.loadedUpdatedAt = updatedScene.updatedAt;
                            }
                        } else {
                            // Scene was modified in another tab and user has no unsaved changes
                            console.warn('⚠️ Showing conflict dialog');
                            const shouldReload = confirm(t('tab.sceneModifiedConfirm'));
                            if (shouldReload) {
                                await app.loadScene?.(data.id);
                            } else {
                                // User chose to keep their version - update timestamp to prevent repeated conflicts
                                console.log('✅ User cancelled, updating loadedUpdatedAt to', updatedScene.updatedAt);
                                if (app.currentScene) {
                                    app.currentScene.loadedUpdatedAt = updatedScene.updatedAt;
                                }
                            }
                        }
                    }
                } else if (app.currentProject?.id === data.projectId) {
                    // Refresh scene list if viewing same project but different scene
                    await app.loadChapters?.();
                }
                break; case MSG_TYPES.PROJECT_DELETED:
                if (app.currentProject?.id === data.id) {
                    alert(t('tab.projectDeletedOtherTab'));
                    app.currentProject = null;
                    await app.loadProjects?.();
                } else {
                    await app.loadProjects?.();
                }
                break;

            case MSG_TYPES.CHAPTER_DELETED:
                if (app.currentProject?.id === data.projectId) {
                    await app.loadChapters?.();
                }
                break;

            case MSG_TYPES.SCENE_DELETED:
                if (app.currentScene?.id === data.id) {
                    alert(t('tab.sceneDeletedOtherTab'));
                    app.currentScene = null;
                    await app.loadChapters?.();
                } else if (app.currentProject?.id === data.projectId) {
                    await app.loadChapters?.();
                }
                break;

            case MSG_TYPES.PROMPT_SAVED:
            case MSG_TYPES.CODEX_SAVED:
                // Reload if viewing same project
                if (app.currentProject?.id === data.projectId) {
                    await app.loadAllPrompts?.();
                }
                break;

            case MSG_TYPES.COMPENDIUM_SAVED:
            case MSG_TYPES.COMPENDIUM_DELETED:
                // Reload compendium if viewing same project
                if (app.currentProject?.id === data.projectId) {
                    await app.loadCompendium?.();
                }
                break;

            case MSG_TYPES.WORKSHOP_SAVED:
                // Reload workshop sessions if viewing same project
                if (app.currentProject?.id === data.projectId) {
                    await app.loadWorkshopSessions?.();
                }
                break;
        }
    }

    function startHeartbeat() {
        if (heartbeatInterval) return;

        heartbeatInterval = setInterval(() => {
            broadcast(MSG_TYPES.TAB_HEARTBEAT, { tabId: TAB_ID, timestamp: TAB_TIMESTAMP });
        }, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    function checkForDeadTabs() {
        const now = Date.now();
        let removedAny = false;

        for (const [tabId, info] of knownTabs.entries()) {
            if (tabId === TAB_ID) continue; // Don't check ourselves

            if (now - info.lastHeartbeat > TAB_TIMEOUT) {
                console.log('💀 Tab considered dead (no heartbeat):', tabId);
                knownTabs.delete(tabId);
                removedAny = true;
            }
        }

        if (removedAny) {
            checkIfShouldBecomePrimary();
        }
    }

    function checkIfShouldBecomePrimary() {
        // Check if we should become primary (if we're the oldest remaining tab)
        let shouldBePrimary = true;
        let oldestTimestamp = TAB_TIMESTAMP;

        for (const [tabId, info] of knownTabs.entries()) {
            if (tabId !== TAB_ID && info.timestamp < oldestTimestamp) {
                shouldBePrimary = false;
                break;
            }
        }

        if (shouldBePrimary && !isPrimaryTab) {
            isPrimaryTab = true;
            console.log('✏️ This tab is now PRIMARY (oldest remaining tab)');
            setEditorReadOnly(false);
        }
    }

    function setEditorReadOnly(readonly) {
        if (!app) return;

        // Find the editor textarea
        const editor = document.querySelector('.editor-textarea');
        if (editor) {
            editor.readOnly = readonly;

            if (readonly) {
                // Add visual indicator that this is read-only
                editor.style.backgroundColor = 'var(--bg-secondary)';
                editor.style.cursor = 'not-allowed';
                editor.style.opacity = '0.7';
                editor.title = t('tab.readOnlyTooltip');

                // Add a prominent banner to the editor header
                addReadOnlyBanner();

                // Show notification
                if (app.currentScene) {
                        alert(t('tab.readOnlyAlert'));
                    }
            } else {
                editor.style.backgroundColor = '';
                editor.style.cursor = '';
                editor.style.opacity = '';
                editor.title = '';

                // Remove read-only banner
                removeReadOnlyBanner();
            }
        }

        // Store state for future reference
        if (app) {
            app.isReadOnlyTab = readonly;
        }
    }

    function addReadOnlyBanner() {
        // Remove existing banner if any
        removeReadOnlyBanner();

        const editorHeader = document.querySelector('.editor-header');
        if (!editorHeader) return;

        const banner = document.createElement('div');
        banner.id = 'readonly-banner';
        banner.style.cssText = `
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
            color: white;
            padding: 12px 30px;
            font-weight: 600;
            text-align: center;
            font-size: 14px;
            border-bottom: 2px solid rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        `;

        banner.innerHTML = `
            <span style="font-size: 20px;">🔒</span>
            <span>${t('tab.readOnlyBanner')}</span>
        `;

        editorHeader.insertAdjacentElement('afterend', banner);

        // Update document title
        const originalTitle = document.title;
        if (!originalTitle.startsWith('🔒')) {
            document.title = '🔒 ' + t('tab.readOnlyTitlePrefix') + ' | ' + originalTitle;
        }
    }

    function removeReadOnlyBanner() {
        const banner = document.getElementById('readonly-banner');
        if (banner) {
            banner.remove();
        }

        // Restore document title
        if (document.title.startsWith('🔒 ')) {
            document.title = document.title.replace(/^🔒 .*? \| /, '');
        }
    }

    function broadcast(type, data) {
        if (!channel) return;

        const message = { type, data, timestamp: Date.now(), tabId: TAB_ID };
        console.log('📤 Broadcasting from TAB_ID:', TAB_ID, 'message:', message);
        channel.postMessage(message);
    }

    function destroy() {
        if (channel) {
            channel.close();
            channel = null;
        }
        app = null;
    }

    // Export module
    window.TabSync = {
        init,
        broadcast,
        destroy,
        MSG_TYPES,
        TAB_ID,
        isPrimaryTab: () => isPrimaryTab,
        setReadOnly: setEditorReadOnly
    };
})();
