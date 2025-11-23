/**
 * Workshop Chat Module
 * Handles AI-powered brainstorming chat with context from the project
 */

window.workshopChat = {
    /**
     * Initialize a new workshop chat session
     * @param {Object} app - Alpine app instance (optional, used for counting)
     */
    createNewSession(app) {
        const count = app && app.workshopSessions ? app.workshopSessions.length + 1 : 1;
        return {
            id: `ws_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            name: `Chat ${count}`,
            messages: [],
            createdAt: new Date().toISOString()
        };
    },

    /**
     * Build the prompt for the workshop chat including context
     * @param {Object} app - The Alpine.js app instance
     * @param {string} userMessage - The user's message
     * @returns {Promise<Array>} - Array of messages for the LLM
     */
    async buildWorkshopPrompt(app, userMessage) {
        const messages = [];
        const currentSession = app.workshopSessions[app.currentWorkshopSessionIndex];

        // Get the selected workshop prompt
        const selectedPrompt = app.prompts.find(p => p.id === app.selectedWorkshopPromptId);
        const systemPrompt = selectedPrompt?.content ||
            "You are a creative writing assistant helping to brainstorm and develop story ideas. Be thoughtful, creative, and supportive.";

        // Add system message
        messages.push({
            role: 'system',
            content: systemPrompt
        });

        // Extract mentions and build context
        const context = await this.extractContext(app, userMessage);
        if (context) {
            messages.push({
                role: 'system',
                content: `\n\n--- Project Context ---\n${context}\n--- End Context ---\n`
            });
        }

        // Add conversation history based on fidelity mode
        const historyMessages = this.getConversationHistory(currentSession, app.workshopFidelityMode);
        messages.push(...historyMessages);

        // Add the new user message
        messages.push({
            role: 'user',
            content: userMessage
        });

        return messages;
    },

    /**
     * Extract context from @mentions and #hashtags in the message
     * Uses same format as beat mentions: @[Title] and #[Title]
     * @param {Object} app - The Alpine.js app instance
     * @param {string} message - The user's message
     * @returns {Promise<string>} - Formatted context string
     */
    async extractContext(app, message) {
        const contextParts = [];

        // Extract @[Title] mentions (compendium entries)
        const mentionPattern = /@\[([^\]]+)\]/g;
        const mentionMatches = [...message.matchAll(mentionPattern)];

        for (const match of mentionMatches) {
            const title = match[1];
            try {
                if (app.currentProject) {
                    const allEntries = await db.compendium
                        .where('projectId')
                        .equals(app.currentProject.id)
                        .toArray();

                    const entry = allEntries.find(e =>
                        e.title && e.title === title
                    );

                    if (entry) {
                        contextParts.push(`[${entry.category}: ${entry.title}]\n${entry.body || ''}`);
                    }
                }
            } catch (e) {
                console.warn('Error fetching compendium entry:', e);
            }
        }

        // Extract #[Title] hashtags (scene references)
        const scenePattern = /#\[([^\]]+)\]/g;
        const sceneMatches = [...message.matchAll(scenePattern)];

        for (const match of sceneMatches) {
            const title = match[1];
            try {
                if (app.currentProject) {
                    const allScenes = await db.scenes
                        .where('projectId')
                        .equals(app.currentProject.id)
                        .toArray();

                    const scene = allScenes.find(s =>
                        s.title && s.title === title
                    );

                    if (scene) {
                        // Fetch the actual scene content from the content table
                        const sceneContent = await db.content.get(scene.id);
                        const content = sceneContent ? sceneContent.text : '';

                        // Log scene info for debugging Cyrillic/encoding issues
                        console.log(`📖 Adding scene "${scene.title}" to workshop context:`, {
                            contentLength: content.length,
                            wordCount: content.split(/\s+/).length,
                            hasNonAscii: /[^\x00-\x7F]/.test(content),
                            firstChars: content.slice(0, 50)
                        });

                        contextParts.push(`[Scene: ${scene.title}]\n${content}`);
                    }
                }
            } catch (e) {
                console.warn('Error fetching scene:', e);
            }
        }

        // Also check for any selected context items (if we add manual selection later)
        if (app.selectedWorkshopContext && app.selectedWorkshopContext.length > 0) {
            for (const ctx of app.selectedWorkshopContext) {
                if (ctx.type === 'scene') {
                    const scene = app.scenes.find(s => s.id === ctx.id);
                    if (scene) {
                        // Fetch the actual scene content from the content table
                        const sceneContent = await db.content.get(scene.id);
                        const content = sceneContent ? sceneContent.text : '';
                        contextParts.push(`[Scene: ${scene.title}]\n${content}`);
                    }
                } else if (ctx.type === 'compendium') {
                    try {
                        const entry = await db.compendium.get(ctx.id);
                        if (entry) {
                            contextParts.push(`[${entry.category}: ${entry.title}]\n${entry.body}`);
                        }
                    } catch (e) {
                        console.warn('Error fetching compendium entry:', e);
                    }
                }
            }
        }

        return contextParts.length > 0 ? contextParts.join('\n\n') : '';
    },

    /**
     * Get conversation history based on fidelity mode
     * @param {Object} session - The current chat session
     * @param {string} mode - The fidelity mode ('high', 'balanced', 'compressed')
     * @returns {Array} - Array of message objects
     */
    getConversationHistory(session, mode = 'balanced') {
        if (!session || !session.messages || session.messages.length === 0) {
            return [];
        }

        const messages = session.messages;
        const maxMessages = {
            'high': 50,
            'balanced': 20,
            'compressed': 10
        }[mode] || 20;

        // For now, simple truncation - we can add summarization later
        if (messages.length <= maxMessages) {
            return [...messages];
        }

        // Take the most recent messages
        return messages.slice(-maxMessages);
    },

    /**
     * Summarize old messages (placeholder for future implementation)
     * @param {Array} messages - Messages to summarize
     * @returns {string} - Summarized text
     */
    async summarizeMessages(messages) {
        // TODO: Implement actual summarization using LLM
        // For now, just create a simple summary
        const userMessages = messages.filter(m => m.role === 'user').length;
        const assistantMessages = messages.filter(m => m.role === 'assistant').length;
        return `[Summary: Previous conversation with ${userMessages} user messages and ${assistantMessages} assistant responses]`;
    },

    /**
     * Send a message in the workshop chat
     * @param {Object} app - The Alpine.js app instance
     * @param {string} message - The message to send
     */
    async sendMessage(app, message) {
        if (!message || !message.trim()) return;

        const currentSession = app.workshopSessions[app.currentWorkshopSessionIndex];
        if (!currentSession) return;

        // Add user message to session
        currentSession.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        });

        // Clear input and close dropdowns
        app.workshopInput = '';
        app.showWorkshopQuickSearch = false;
        app.showWorkshopSceneSearch = false;

        // Set loading state
        app.workshopIsGenerating = true;

        // Add placeholder for assistant response
        const assistantMessageIndex = currentSession.messages.length;
        currentSession.messages.push({
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString()
        });

        try {
            // Build the full prompt with context
            const promptMessages = await this.buildWorkshopPrompt(app, message);

            // Log prompt size for debugging
            const totalPromptLength = JSON.stringify(promptMessages).length;
            console.log('📊 Workshop prompt stats:', {
                messageCount: promptMessages.length,
                totalChars: totalPromptLength,
                totalBytes: new Blob([JSON.stringify(promptMessages)]).size
            });

            // Check if Generation module is available
            if (!window.Generation || typeof window.Generation.streamGeneration !== 'function') {
                throw new Error('Generation module not available');
            }

            // Stream the AI response
            let fullResponse = '';
            const result = await window.Generation.streamGeneration(promptMessages, (token) => {
                fullResponse += token;
                // Update the message and trigger reactivity by replacing the array
                currentSession.messages[assistantMessageIndex].content = fullResponse;
                // Force Alpine to detect the change
                currentSession.messages = [...currentSession.messages];

                // Scroll to bottom of chat (use requestAnimationFrame for better timing)
                requestAnimationFrame(() => {
                    const chatMessages = document.querySelector('.workshop-messages');
                    if (chatMessages) {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                });
            }, app);

            // Notify user if response was truncated
            if (result?.finishReason === 'length' || result?.finishReason === 'MAX_TOKENS') {
                console.warn('⚠️ Workshop chat hit token limit');
                alert('⚠️ The response reached the token limit and may be incomplete.\n\nTip: Increase "Max Length" in AI Settings (⚙️) for longer responses.');
            }

            // Save sessions to database
            await app.saveWorkshopSessions();

            // Final scroll to ensure message is fully visible
            requestAnimationFrame(() => {
                const chatMessages = document.querySelector('.workshop-messages');
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            });

        } catch (error) {
            console.error('Workshop chat error:', error);
            console.error('Error stack:', error.stack);
            currentSession.messages[assistantMessageIndex].content = `Error: ${error.message}`;
            currentSession.messages[assistantMessageIndex].isError = true;
            currentSession.messages = [...currentSession.messages];
        } finally {
            app.workshopIsGenerating = false;
        }
    },

    /**
     * Handle workshop input changes to detect @ and # mentions
     * @param {Object} app - Alpine app instance
     * @param {Event} e - Input event
     */
    async onWorkshopInput(app, e) {
        try {
            const ta = e.target;
            const pos = ta.selectionStart;
            const text = app.workshopInput || '';

            // Check for # (scene mentions) first
            const lastHash = text.lastIndexOf('#', pos - 1);
            if (lastHash !== -1 && (lastHash === 0 || /\s/.test(text.charAt(lastHash - 1)))) {
                const q = text.substring(lastHash + 1, pos).trim();
                if (q && q.length >= 1) {
                    await this.handleWorkshopSceneSearch(app, q);
                    return;
                }
            }

            // Check for @ (compendium mentions)
            const lastAt = text.lastIndexOf('@', pos - 1);
            if (lastAt === -1) {
                app.showWorkshopQuickSearch = false;
                app.workshopQuickSearchMatches = [];
                app.showWorkshopSceneSearch = false;
                app.workshopSceneSearchMatches = [];
                return;
            }

            // Ensure '@' is start of token (start of string or preceded by whitespace)
            if (lastAt > 0 && !/\s/.test(text.charAt(lastAt - 1))) {
                app.showWorkshopQuickSearch = false;
                app.workshopQuickSearchMatches = [];
                app.showWorkshopSceneSearch = false;
                app.workshopSceneSearchMatches = [];
                return;
            }

            const q = text.substring(lastAt + 1, pos).trim();
            if (!q || q.length < 1) {
                app.showWorkshopQuickSearch = false;
                app.workshopQuickSearchMatches = [];
                app.showWorkshopSceneSearch = false;
                app.workshopSceneSearchMatches = [];
                return;
            }

            // Query compendium titles that match query (case-insensitive contains)
            const pid = app.currentProject ? app.currentProject.id : null;
            if (!pid) return;
            const all = await db.compendium.where('projectId').equals(pid).toArray();
            const lower = q.toLowerCase();
            const matches = (all || []).filter(it => (it.title || '').toLowerCase().includes(lower));
            app.workshopQuickSearchMatches = matches.slice(0, 20);
            app.workshopQuickSearchSelectedIndex = 0;
            app.showWorkshopQuickSearch = app.workshopQuickSearchMatches.length > 0;
            app.showWorkshopSceneSearch = false;
        } catch (err) {
            app.showWorkshopQuickSearch = false;
            app.workshopQuickSearchMatches = [];
            app.showWorkshopSceneSearch = false;
            app.workshopSceneSearchMatches = [];
        }
    },

    /**
     * Search for scenes matching the query
     * @param {Object} app - Alpine app instance
     * @param {string} query - Search query
     */
    async handleWorkshopSceneSearch(app, query) {
        try {
            const pid = app.currentProject ? app.currentProject.id : null;
            if (!pid) return;

            // Get all scenes in project
            const allScenes = await db.scenes.where('projectId').equals(pid).toArray();
            const lower = query.toLowerCase();

            // Filter by title match
            let matches = allScenes.filter(s => (s.title || '').toLowerCase().includes(lower));

            // Sort: current chapter scenes first, then others
            const currentChapterId = app.currentChapter?.id;
            matches.sort((a, b) => {
                const aIsCurrent = a.chapterId === currentChapterId;
                const bIsCurrent = b.chapterId === currentChapterId;
                if (aIsCurrent && !bIsCurrent) return -1;
                if (!aIsCurrent && bIsCurrent) return 1;
                return (a.order || 0) - (b.order || 0);
            });

            app.workshopSceneSearchMatches = matches.slice(0, 20);
            app.workshopSceneSearchSelectedIndex = 0;
            app.showWorkshopSceneSearch = app.workshopSceneSearchMatches.length > 0;
            app.showWorkshopQuickSearch = false;
        } catch (err) {
            app.showWorkshopSceneSearch = false;
            app.workshopSceneSearchMatches = [];
        }
    },

    /**
     * Handle keyboard navigation in workshop dropdowns
     * @param {Object} app - Alpine app instance
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleWorkshopKeydown(app, e) {
        try {
            if (app.showWorkshopQuickSearch && app.workshopQuickSearchMatches && app.workshopQuickSearchMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    app.workshopQuickSearchSelectedIndex = Math.min(
                        app.workshopQuickSearchSelectedIndex + 1,
                        app.workshopQuickSearchMatches.length - 1
                    );
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    app.workshopQuickSearchSelectedIndex = Math.max(app.workshopQuickSearchSelectedIndex - 1, 0);
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    const sel = app.workshopQuickSearchMatches[app.workshopQuickSearchSelectedIndex];
                    this.selectWorkshopQuickMatch(app, sel);
                } else if (e.key === 'Escape') {
                    app.showWorkshopQuickSearch = false;
                }
            } else if (app.showWorkshopSceneSearch && app.workshopSceneSearchMatches && app.workshopSceneSearchMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    app.workshopSceneSearchSelectedIndex = Math.min(
                        app.workshopSceneSearchSelectedIndex + 1,
                        app.workshopSceneSearchMatches.length - 1
                    );
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    app.workshopSceneSearchSelectedIndex = Math.max(app.workshopSceneSearchSelectedIndex - 1, 0);
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    const sel = app.workshopSceneSearchMatches[app.workshopSceneSearchSelectedIndex];
                    this.selectWorkshopSceneMatch(app, sel);
                } else if (e.key === 'Escape') {
                    app.showWorkshopSceneSearch = false;
                }
            }
        } catch (err) { /* ignore */ }
    },

    /**
     * Select a compendium entry from the dropdown
     * @param {Object} app - Alpine app instance
     * @param {Object} item - Compendium item to insert
     */
    selectWorkshopQuickMatch(app, item) {
        try {
            if (!item || !item.id) return;
            // Replace the last @token before caret with @[Title] format
            const ta = document.querySelector('.workshop-textarea');
            if (!ta) return;
            const pos = ta.selectionStart;
            const text = app.workshopInput || '';
            const lastAt = text.lastIndexOf('@', pos - 1);
            if (lastAt === -1) return;
            const before = text.substring(0, lastAt);
            const after = text.substring(pos);
            // Insert clean mention format: @[Title] with trailing space
            const insert = `@[${item.title}] `;
            app.workshopInput = before + insert + after;
            // Store mapping of title to ID for later resolution
            app.workshopCompendiumMap[item.title] = item.id;
            // hide suggestions
            app.showWorkshopQuickSearch = false;
            app.workshopQuickSearchMatches = [];
            app.$nextTick(() => {
                try { ta.focus(); ta.selectionStart = ta.selectionEnd = (before + insert).length; } catch (e) { }
            });
        } catch (e) { console.error('selectWorkshopQuickMatch error', e); }
    },

    /**
     * Select a scene from the dropdown
     * @param {Object} app - Alpine app instance
     * @param {Object} scene - Scene to insert
     */
    selectWorkshopSceneMatch(app, scene) {
        try {
            if (!scene || !scene.id) return;
            const ta = document.querySelector('.workshop-textarea');
            if (!ta) return;
            const pos = ta.selectionStart;
            const text = app.workshopInput || '';
            const lastHash = text.lastIndexOf('#', pos - 1);
            if (lastHash === -1) return;
            const before = text.substring(0, lastHash);
            const after = text.substring(pos);
            // Insert clean mention format: #[Title] with trailing space
            const insert = `#[${scene.title}] `;
            app.workshopInput = before + insert + after;
            // Store mapping of title to ID for later resolution
            app.workshopSceneMap[scene.title] = scene.id;
            // hide suggestions
            app.showWorkshopSceneSearch = false;
            app.workshopSceneSearchMatches = [];
            app.$nextTick(() => {
                try { ta.focus(); ta.selectionStart = ta.selectionEnd = (before + insert).length; } catch (e) { }
            });
        } catch (e) { console.error('selectWorkshopSceneMatch error', e); }
    }
};
