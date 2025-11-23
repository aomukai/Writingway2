// Tab synchronization using BroadcastChannel API
// This module handles syncing changes between multiple tabs of the application
(function () {
    const CHANNEL_NAME = 'writingway-sync';
    let channel = null;
    let app = null;

    // Unique identifier for this tab instance
    const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Message types
    const MSG_TYPES = {
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
            case MSG_TYPES.PROJECT_SAVED:
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
                        // Only show conflict dialog if this tab doesn't have focus
                        // If user is actively working here, don't interrupt them
                        const hasFocus = document.hasFocus();
                        console.log('🔍 Focus check:', {
                            hasFocus,
                            activeElement: document.activeElement?.tagName,
                            activeElementId: document.activeElement?.id
                        });

                        if (hasFocus) {
                            console.log('⏭️ Tab has focus, silently updating loadedUpdatedAt without showing dialog');
                            // Silently acknowledge the change so we don't get repeated notifications
                            if (app.currentScene) {
                                app.currentScene.loadedUpdatedAt = updatedScene.updatedAt;
                            }
                        } else {
                            // Scene was modified in another tab and this tab is inactive
                            console.warn('⚠️ Showing conflict dialog');
                            const shouldReload = confirm(
                                `This scene was modified in another tab.\n\n` +
                                `Click OK to reload the latest version, or Cancel to keep your current changes.`
                            );
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
                    alert('This project was deleted in another tab.');
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
                    alert('This scene was deleted in another tab.');
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
        MSG_TYPES
    };
})();
