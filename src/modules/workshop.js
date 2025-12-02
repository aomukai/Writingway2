// src/modules/workshop.js
// Extracted workshop chat/session logic from app.js

const Workshop = {
    async loadWorkshopSessions(app) {
        if (!app.currentProject) return;
        try {
            const sessions = await db.workshopSessions
                .where('projectId')
                .equals(app.currentProject.id)
                .toArray();
            console.log('Loaded workshop sessions:', sessions.length, sessions);
            if (sessions.length > 0) {
                app.workshopSessions = sessions;
                if (app.currentWorkshopSessionIndex >= sessions.length) {
                    app.currentWorkshopSessionIndex = 0;
                }
            } else {
                app.workshopSessions = [window.workshopChat.createNewSession(app)];
                await Workshop.saveWorkshopSessions(app);
            }
        } catch (error) {
            console.error('Failed to load workshop sessions:', error);
            app.workshopSessions = [window.workshopChat.createNewSession(app)];
        }
    },
    async saveWorkshopSessions(app) {
        if (!app.currentProject || !app.workshopSessions) return;
        try {
            console.log('Saving workshop sessions:', app.workshopSessions.length);
            for (const session of app.workshopSessions) {
                const sessionData = {
                    id: session.id,
                    name: session.name,
                    messages: JSON.parse(JSON.stringify(session.messages || [])),
                    createdAt: session.createdAt,
                    projectId: app.currentProject.id,
                    updatedAt: new Date().toISOString()
                };
                const existing = await db.workshopSessions.get(session.id);
                if (existing) {
                    console.log('Updating session:', session.id, session.name);
                    await db.workshopSessions.put(sessionData);
                } else {
                    console.log('Adding new session:', session.id, session.name);
                    await db.workshopSessions.add(sessionData);
                }
            }
            const allSessions = await db.workshopSessions
                .where('projectId')
                .equals(app.currentProject.id)
                .toArray();
            const currentIds = new Set(app.workshopSessions.map(s => s.id));
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
    },
    createWorkshopSession(app) {
        const newSession = window.workshopChat.createNewSession(app);
        app.workshopSessions.push(newSession);
        app.currentWorkshopSessionIndex = app.workshopSessions.length - 1;
        Workshop.saveWorkshopSessions(app);
    },
    renameWorkshopSession(app, index) {
        const session = app.workshopSessions[index];
        if (!session) return;
        const newName = prompt(t('workshop.renamePrompt'), session.name);
        if (newName && newName.trim()) {
            session.name = newName.trim();
            app.workshopSessions = [...app.workshopSessions];
            Workshop.saveWorkshopSessions(app);
        }
    },
    async clearWorkshopSession(app, index) {
        const session = app.workshopSessions[index];
        if (!session) return;
        if (confirm(t('workshop.clearConfirm'))) {
            session.messages = [];
            await Workshop.saveWorkshopSessions(app);
        }
    },
    exportWorkshopSession(app, index) {
        const session = app.workshopSessions[index];
        if (!session || !session.messages || session.messages.length === 0) {
            alert(t('workshop.noMessagesToExport'));
            return;
        }
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
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `workshop_${safeName}_${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    },
    async deleteWorkshopSession(app, index) {
        if (app.workshopSessions.length <= 1) {
            alert(t('workshop.mustHaveOneSession'));
            return;
        }
        if (confirm(t('workshop.deleteSessionConfirm'))) {
            app.workshopSessions.splice(index, 1);
            if (app.currentWorkshopSessionIndex >= app.workshopSessions.length) {
                app.currentWorkshopSessionIndex = app.workshopSessions.length - 1;
            }
            await Workshop.saveWorkshopSessions(app);
        }
    },
    async loadSelectedWorkshopPrompt(app) {
        if (!app.currentProject) return;
        const key = `workshopPrompt_${app.currentProject.id}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            app.selectedWorkshopPromptId = saved;
        }
    },
    saveSelectedWorkshopPrompt(app) {
        if (!app.currentProject) return;
        const key = `workshopPrompt_${app.currentProject.id}`;
        if (app.selectedWorkshopPromptId) {
            localStorage.setItem(key, app.selectedWorkshopPromptId);
        } else {
            localStorage.removeItem(key);
        }
    }
};

window.Workshop = Workshop;
