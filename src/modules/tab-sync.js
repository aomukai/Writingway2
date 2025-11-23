// Tab synchronization using BroadcastChannel API
// This module handles syncing changes between multiple tabs of the application
(function () {
    const CHANNEL_NAME = 'writingway-sync';
    let channel = null;
    let app = null;

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

        app = appInstance;
        channel = new BroadcastChannel(CHANNEL_NAME);

        channel.onmessage = async (event) => {
            const { type, data } = event.data;
            console.log('📡 Received sync message:', type, data);

            try {
                await handleMessage(type, data);
            } catch (e) {
                console.error('Failed to handle sync message:', e);
            }
        };

        console.log('✅ Tab sync initialized');
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
                // Reload scene if it's currently open in another tab
                if (app.currentScene?.id === data.id) {
                    const updatedScene = await db.scenes.get(data.id);
                    if (updatedScene && updatedScene.updatedAt !== app.currentScene.updatedAt) {
                        // Scene was modified in another tab
                        const shouldReload = confirm(
                            `This scene was modified in another tab.\n\n` +
                            `Click OK to reload the latest version, or Cancel to keep your current changes.`
                        );
                        if (shouldReload) {
                            await app.loadScene?.(data.id);
                        }
                    }
                } else if (app.currentProject?.id === data.projectId) {
                    // Refresh scene list if viewing same project but different scene
                    await app.loadChapters?.();
                }
                break;

            case MSG_TYPES.CONTENT_SAVED:
                // If viewing the same scene, check for conflicts
                if (app.currentScene?.id === data.sceneId) {
                    const updatedContent = await db.content.get(data.sceneId);
                    if (updatedContent && app.currentScene.content) {
                        const currentContentTimestamp = app.currentScene.contentUpdatedAt || 0;
                        if (updatedContent.updatedAt > currentContentTimestamp) {
                            const shouldReload = confirm(
                                `This scene's content was modified in another tab.\n\n` +
                                `Click OK to reload the latest version, or Cancel to keep your current changes.`
                            );
                            if (shouldReload) {
                                await app.loadScene?.(data.sceneId);
                            }
                        }
                    }
                }
                break;

            case MSG_TYPES.PROJECT_DELETED:
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

        const message = { type, data, timestamp: Date.now() };
        console.log('📤 Broadcasting:', message);
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
