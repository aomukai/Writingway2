// AI initialization helper
// Exposes window.AI.init(app) which performs the model health check and updates the app state
(function () {
    async function init(app) {
        try {
            // Check what mode the user has configured
            const aiMode = app.aiMode || 'api'; // Default to API mode
            const hasApiKey = app.aiApiKey && app.aiApiKey.length > 0;
            const provider = app.aiProvider || 'anthropic';

            // Providers that don't require an API key
            const noKeyRequired = provider === 'lmstudio';

            // If using API mode and has API key (or provider doesn't need one), mark as ready
            if (aiMode === 'api' && (hasApiKey || noKeyRequired)) {
                if (app.updateLoadingScreen) {
                    app.updateLoadingScreen(60, 'AI Ready', `Connected to ${provider}`);
                }
                app.aiStatus = 'ready';

                // Get the display name for the model
                let modelDisplayName = app.aiModel;
                if (app.providerModels[provider]) {
                    const modelInfo = app.providerModels[provider].find(m => m.id === app.aiModel);
                    if (modelInfo) {
                        modelDisplayName = modelInfo.name;
                    }
                }

                app.aiStatusText = modelDisplayName ? `AI Ready (${modelDisplayName})` : `AI Ready (${provider})`;
                console.log(`✓ AI configured with ${provider}${noKeyRequired ? ' (no API key required)' : ''}`);
                return;
            }

            // If using local mode, try to connect to llama-server
            if (aiMode === 'local') {
                if (!app.runtimeInfo || !app.runtimeInfo.localAIAvailable) {
                    if (app.updateLoadingScreen) {
                        app.updateLoadingScreen(60, 'Local AI unavailable', 'Add a GGUF model and install llama.cpp to enable it');
                    }
                    app.aiStatus = 'not-configured';
                    app.aiStatusText = 'Configure AI';
                    app.showModelLoading = false;
                    console.log('ℹ️ Local GGUF mode is unavailable on this system right now.');
                    return;
                }

                if (app.updateLoadingScreen) {
                    app.updateLoadingScreen(55, 'Connecting to AI...', 'Checking local server...');
                }
                app.showModelLoading = true;
                app.loadingMessage = 'Connecting to local AI server...';
                app.loadingProgress = 30;

                const endpoint = app.aiEndpoint || 'http://localhost:8080';
                const response = await fetch(endpoint + '/health', {
                    method: 'GET',
                    signal: AbortSignal.timeout(3000) // 3 second timeout
                });

                if (response.ok) {
                    if (app.updateLoadingScreen) {
                        app.updateLoadingScreen(65, 'AI Connected!', 'Local server is ready');
                    }
                    app.loadingProgress = 100;
                    app.loadingMessage = 'Connected to AI!';

                    await new Promise(resolve => setTimeout(resolve, 500));

                    app.aiStatus = 'ready';
                    app.aiStatusText = 'AI Ready (Local Server)';
                    app.showModelLoading = false;

                    console.log('✓ Connected to llama-server successfully');
                    return;
                }
            }

            // If we get here, no AI is configured
            if (app.updateLoadingScreen) {
                app.updateLoadingScreen(60, 'AI not configured', 'You can set this up later');
            }
            app.aiStatus = 'not-configured';
            app.aiStatusText = 'Configure AI';
            app.showModelLoading = false;

            // Detailed logging for debugging configuration issues
            const configDetails = [];
            if (aiMode === 'api') {
                if (!hasApiKey && !noKeyRequired) {
                    configDetails.push(`Missing API key for ${provider}`);
                }
            }
            console.log('ℹ️ AI not configured. Click "Configure AI" to set up.');
            if (configDetails.length > 0) {
                console.log('   Reason:', configDetails.join(', '));
            }

        } catch (error) {
            // Connection failed or timeout - gracefully handle
            console.log('AI connection attempt failed (this is OK for first-time users):', error.message);

            if (app.aiMode === 'local') {
                if (app.updateLoadingScreen) {
                    app.updateLoadingScreen(60, 'Local AI offline', 'You can configure this later');
                }
                app.aiStatus = 'error';
                app.aiStatusText = 'Local server offline';
                console.log('💡 To use local AI: Run start.bat or configure an API provider');
            } else {
                if (app.updateLoadingScreen) {
                    app.updateLoadingScreen(60, 'AI not configured', 'Configure in settings');
                }
                app.aiStatus = 'not-configured';
                app.aiStatusText = 'Configure AI';
                console.log('💡 Click "Configure AI" to set up an API provider');
            }

            app.showModelLoading = false;
        }
    }

    window.AI = window.AI || {};
    window.AI.init = init;
})();
