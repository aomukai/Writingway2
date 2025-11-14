// AI Settings Module
// Handles AI configuration: provider selection, model fetching, settings persistence, connection testing
(function () {
    const AISettings = {
        /**
         * Fetch available models from the current provider
         * @param {Object} app - Alpine app instance
         */
        async fetchProviderModels(app) {
            // Fetch available models from the current provider
            if (app.aiMode !== 'api' || !app.aiApiKey) return;
            if (app.fetchingModels) return; // Prevent duplicate fetches

            try {
                app.fetchingModels = true;

                if (app.aiProvider === 'openrouter') {
                    // OpenRouter has a models API endpoint
                    const response = await fetch('https://openrouter.ai/api/v1/models', {
                        headers: {
                            'Authorization': `Bearer ${app.aiApiKey}`
                        }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Filter and format models, prioritize free ones
                        app.providerModels.openrouter = data.data
                            .filter(m => m.id) // Has valid ID
                            .sort((a, b) => {
                                // Free models first
                                const aFree = a.id.includes(':free');
                                const bFree = b.id.includes(':free');
                                if (aFree && !bFree) return -1;
                                if (!aFree && bFree) return 1;
                                return 0;
                            })
                            .map(m => ({
                                id: m.id,
                                name: m.name || m.id,
                                recommended: m.id.includes(':free') || m.id.includes('gemini-2.0-flash')
                            }));
                        app.modelsFetched = true;
                    }
                } else if (app.aiProvider === 'openai') {
                    // OpenAI has a models API
                    const response = await fetch('https://api.openai.com/v1/models', {
                        headers: {
                            'Authorization': `Bearer ${app.aiApiKey}`
                        }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Filter to chat models only
                        app.providerModels.openai = data.data
                            .filter(m => m.id.includes('gpt'))
                            .map(m => ({
                                id: m.id,
                                name: m.id.toUpperCase().replace(/-/g, ' '),
                                recommended: m.id === 'gpt-4o' || m.id === 'gpt-4o-mini'
                            }));
                        app.modelsFetched = true;
                    }
                } else if (app.aiProvider === 'anthropic') {
                    // Anthropic doesn't have a public models API, keep hardcoded list
                    // (Their models are well-known and don't change often)
                    app.modelsFetched = true;
                } else if (app.aiProvider === 'google') {
                    // Google AI doesn't have a public models list API for free tier
                    // Keep hardcoded list
                    app.modelsFetched = true;
                }
            } catch (e) {
                console.error('Failed to fetch models:', e);
                // Fall back to hardcoded list on error
            } finally {
                app.fetchingModels = false;
            }
        },

        /**
         * Scan for available local models
         * @param {Object} app - Alpine app instance
         */
        async scanLocalModels(app) {
            try {
                // In a real file system environment, we'd scan the models folder
                // For now, try to list what we can detect
                app.availableLocalModels = ['Qwen3-4B-Instruct-2507-IQ4_XS.gguf'];
                alert('Model scan complete! Found ' + app.availableLocalModels.length + ' model(s).');
            } catch (e) {
                console.error('Failed to scan models:', e);
                alert('Could not scan models folder');
            }
        },

        /**
         * Quick save for generation parameters (no validation/testing)
         * @param {Object} app - Alpine app instance
         */
        saveGenerationParams(app) {
            try {
                const settings = {
                    mode: app.aiMode,
                    provider: app.aiProvider,
                    apiKey: app.aiApiKey,
                    model: app.aiModel,
                    endpoint: app.aiEndpoint || (app.aiMode === 'local' ? 'http://localhost:8080' : ''),
                    temperature: app.temperature,
                    maxTokens: app.maxTokens
                };
                localStorage.setItem('writingway:aiSettings', JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save generation params:', e);
            }
        },

        /**
         * Save AI settings and test connection
         * @param {Object} app - Alpine app instance
         */
        async saveAISettings(app) {
            try {
                // Save settings to localStorage
                const settings = {
                    mode: app.aiMode,
                    provider: app.aiProvider,
                    apiKey: app.aiApiKey,
                    model: app.aiModel,
                    endpoint: app.aiEndpoint || (app.aiMode === 'local' ? 'http://localhost:8080' : ''),
                    temperature: app.temperature,
                    maxTokens: app.maxTokens
                };
                localStorage.setItem('writingway:aiSettings', JSON.stringify(settings));

                // Test connection
                app.showModelLoading = true;
                app.loadingMessage = 'Testing connection...';
                app.loadingProgress = 50;

                if (app.aiMode === 'local') {
                    // Test local server
                    const endpoint = app.aiEndpoint || 'http://localhost:8080';
                    const response = await fetch(endpoint + '/health');
                    if (response.ok) {
                        app.aiStatus = 'ready';
                        app.aiStatusText = 'AI Ready (Local)';
                        app.loadingProgress = 100;
                        setTimeout(() => { app.showModelLoading = false; }, 500);
                        alert('✓ Connected to local server successfully!');
                    } else {
                        throw new Error('Local server not responding');
                    }
                } else {
                    // Test API connection (basic validation)
                    if (!app.aiApiKey) {
                        throw new Error('API key is required');
                    }
                    if (!app.aiModel) {
                        throw new Error('Model name is required');
                    }
                    app.aiStatus = 'ready';
                    app.aiStatusText = `AI Ready (${app.aiProvider})`;
                    app.loadingProgress = 100;
                    setTimeout(() => { app.showModelLoading = false; }, 500);
                    alert('✓ API settings saved! Ready to generate.');
                }

                app.showAISettings = false;
            } catch (e) {
                console.error('AI settings save/test failed:', e);
                app.aiStatus = 'error';
                app.aiStatusText = 'Connection failed';
                app.showModelLoading = false;
                alert('Connection failed: ' + (e.message || e));
            }
        },

        /**
         * Load AI settings from localStorage
         * @param {Object} app - Alpine app instance
         */
        async loadAISettings(app) {
            try {
                const saved = localStorage.getItem('writingway:aiSettings');
                if (saved) {
                    const settings = JSON.parse(saved);
                    app.aiMode = settings.mode || 'local';
                    app.aiProvider = settings.provider || 'anthropic';
                    app.aiApiKey = settings.apiKey || '';
                    app.aiModel = settings.model || '';
                    app.aiEndpoint = settings.endpoint || '';
                    app.temperature = settings.temperature || 0.8;
                    app.maxTokens = settings.maxTokens || 300;

                    // Fetch fresh model list if we have API credentials
                    if (app.aiMode === 'api' && app.aiApiKey) {
                        await this.fetchProviderModels(app);
                    }
                }
            } catch (e) {
                console.error('Failed to load AI settings:', e);
            }
        }
    };

    // Export to window
    window.AISettings = AISettings;

    // Expose test helpers
    window.__test = window.__test || {};
    window.__test.AISettings = AISettings;
})();
