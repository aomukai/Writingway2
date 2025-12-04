// src/modules/generation.js
// Extracted generation logic from app.js

const Generation = {
    // Build the prompt for AI generation
    buildPrompt(beatInput, sceneContent, opts) {
        // This is a placeholder. Actual logic should be copied from app.js
        // and may use opts: { povCharacter, pov, tense, prosePrompt, compendiumEntries, sceneSummaries }
        // For now, just concatenate for demonstration:
        let prompt = '';
        if (opts && opts.prosePrompt) prompt += opts.prosePrompt + '\n';
        if (beatInput) prompt += 'Beat: ' + beatInput + '\n';
        if (sceneContent) prompt += 'Scene: ' + sceneContent + '\n';
        // Add compendium and scene summaries if present
        if (opts && opts.compendiumEntries && opts.compendiumEntries.length) {
            prompt += '\nCompendium:\n';
            opts.compendiumEntries.forEach(e => {
                prompt += `- ${e.title || e.id}: ${e.content || ''}\n`;
            });
        }
        if (opts && opts.sceneSummaries && opts.sceneSummaries.length) {
            prompt += '\nScene Summaries:\n';
            opts.sceneSummaries.forEach(s => {
                prompt += `- ${s.title}: ${s.summary || ''}\n`;
            });
        }
        // Add POV and tense
        if (opts && opts.povCharacter) prompt += `POV Character: ${opts.povCharacter}\n`;
        if (opts && opts.pov) prompt += `POV: ${opts.pov}\n`;
        if (opts && opts.tense) prompt += `Tense: ${opts.tense}\n`;
        return prompt;
    },

    // Stream generation tokens from the AI server
    async streamGeneration(prompt, onToken, appContext) {
        // This is a placeholder for actual streaming logic.
        // In production, this would call the backend (e.g., llama-server) and stream tokens.
        // For now, simulate streaming with a timeout.
        const fakeResponse = 'This is a generated response from the AI model.';
        for (let i = 0; i < fakeResponse.length; i++) {
            await new Promise(res => setTimeout(res, 10));
            onToken(fakeResponse[i]);
        }
    }
};

Generation.loadPromptHistory = async function (app) {
    if (!app.currentProject) {
        app.promptHistoryList = [];
        return;
    }
    try {
        const history = await db.promptHistory
            .where('projectId')
            .equals(app.currentProject.id)
            .reverse()
            .sortBy('timestamp');
        app.promptHistoryList = history;
    } catch (e) {
        console.error('Failed to load prompt history:', e);
        app.promptHistoryList = [];
    }
};

Generation.generateFromBeat = async function (app) {
    if (!app.beatInput || app.aiStatus !== 'ready') return;
    app.isGenerating = true;
    try {
        app.lastBeat = app.beatInput;
        // Resolve prose prompt text (in-memory first, then DB fallback)
        const proseInfo = await app.resolveProsePromptInfo();
        const prosePromptText = proseInfo && proseInfo.text ? proseInfo.text : null;
        // Get context from context panel
        const panelContext = await app.buildContextFromPanel();
        // Resolve compendium entries and scene summaries from beat mentions (@/#)
        let beatCompEntries = [];
        let beatSceneSummaries = [];
        try { beatCompEntries = await app.resolveCompendiumEntriesFromBeat(app.beatInput || ''); } catch (e) { beatCompEntries = []; }
        try { beatSceneSummaries = await app.resolveSceneSummariesFromBeat(app.beatInput || ''); } catch (e) { beatSceneSummaries = []; }
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
        const genOpts = { povCharacter: app.povCharacter, pov: app.pov, tense: app.tense, prosePrompt: prosePromptText, compendiumEntries: compEntries, sceneSummaries: sceneSummaries };
        let prompt = Generation.buildPrompt(app.beatInput, app.currentScene?.content || '', genOpts);
        // Save prompt to history
        try {
            await db.promptHistory.add({
                id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 9),
                projectId: app.currentProject?.id,
                sceneId: app.currentScene?.id,
                timestamp: new Date(),
                beat: app.beatInput,
                prompt: typeof prompt === 'object' && prompt.asString ? prompt.asString() : String(prompt)
            });
        } catch (e) {
            console.warn('Failed to save prompt history:', e);
        }
        // remember where generated text will start
        const prevLen = app.currentScene ? (app.currentScene.content ? app.currentScene.content.length : 0) : 0;
        app.lastGenStart = prevLen;
        app.lastGenText = '';
        app.showGenActions = false;
        // Stream tokens and append into the current scene
        await Generation.streamGeneration(prompt, (token) => {
            app.currentScene.content += token;
            app.lastGenText += token;
        }, app);
        // Generation complete — expose accept/retry/discard actions
        app.showGenActions = true;
        app.showGeneratedHighlight = true;
        // Select the newly generated text in the textarea
        app.$nextTick(() => {
            try {
                const ta = document.querySelector('.editor-textarea');
                if (ta) {
                    ta.focus();
                    // set selection to the generated region
                    const start = app.lastGenStart || 0;
                    const end = (app.currentScene && app.currentScene.content) ? app.currentScene.content.length : start;
                    ta.selectionStart = start;
                    ta.selectionEnd = end;
                    // scroll selection into view
                    const lineHeight = parseInt(window.getComputedStyle(ta).lineHeight) || 20;
                    ta.scrollTop = Math.max(0, Math.floor(start / 80) * lineHeight);
                }
            } catch (e) { }
            // Auto-hide highlight after 5 seconds
            setTimeout(() => {
                app.showGeneratedHighlight = false;
            }, 5000);
        });
        // Clear beat input (we keep lastBeat so retry can reuse it)
        app.beatInput = '';
        // Auto-save after generation
        await app.saveScene();
    } catch (error) {
        console.error('Generation error:', error);
        alert(t('generate.failedPrefix') + (error && error.message ? error.message : error));
    } finally {
        app.isGenerating = false;
    }
};

window.Generation = Generation;
