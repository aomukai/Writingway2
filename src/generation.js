// Generation helpers module
// Exposes window.Generation with:
// - buildPrompt(beat, sceneContext, options) => string
// - streamGeneration(prompt, onToken(token)) => Promise<void>
(function () {
    function buildPrompt(beat, sceneContext, options = {}) {
        try {
            console.debug('[buildPrompt] received prosePrompt:', JSON.stringify(options.prosePrompt));
        } catch (e) { /* ignore */ }
        const povName = (options.povCharacter && options.povCharacter.trim()) ? options.povCharacter.trim() : 'the protagonist';
        const tenseText = (options.tense === 'present') ? 'present tense' : 'past tense';
        const povText = options.pov || '3rd person limited';
        const povSentence = `You are a co-author tasked with assisting your partner. You are writing a story from the point of view of ${povName} in ${tenseText}, in ${povText}.`;

        const systemPrompt = `${povSentence} You are a creative writing assistant. The author provides a BEAT (what happens next) and you expand it into vivid, engaging prose. Write 2-3 paragraphs that bring the beat to life. Match the author's tone and style. Use sensory details. Show, don't tell.`;

        let contextText = '';
        if (sceneContext && sceneContext.length > 0) {
            const words = sceneContext.split(/\s+/);
            const contextWords = words.slice(-500).join(' ');
            contextText = `\n\nCURRENT SCENE SO FAR:\n${contextWords}`;
        }

        // If a prose prompt template is provided, include it before the BEAT so the model can use it.
        // When `options.preview === true` we avoid adding explicit debug markers so the preview is cleaner.
        let proseTemplateText = '';
        if (options.prosePrompt && typeof options.prosePrompt === 'string' && options.prosePrompt.trim()) {
            if (options.preview) {
                proseTemplateText = `\n\n${options.prosePrompt.trim()}`;
            } else {
                // Add explicit markers to make the template visible during debugging/inspection
                proseTemplateText = `\n\n--- PROMPT TEMPLATE START ---\n${options.prosePrompt.trim()}\n--- PROMPT TEMPLATE END ---`;
            }
        }

        // If compendium entries are provided, include them as references before the BEAT.
        // For preview mode we omit the full compendium bodies to keep the overlay concise.
        let compendiumText = '';
        if (!options.preview && options.compendiumEntries && Array.isArray(options.compendiumEntries) && options.compendiumEntries.length > 0) {
            compendiumText = '\n\nCOMPENDIUM REFERENCES:\n';
            for (const ce of options.compendiumEntries) {
                try {
                    const title = ce.title || ('entry ' + (ce.id || ''));
                    const body = (ce.body || ce.body || ce.description || '') || ce.body || '';
                    compendiumText += `\n-- ${title} --\n${body}\n`;
                } catch (e) { /* ignore */ }
            }
        }

        let userContent = `${contextText}${proseTemplateText}`;
        if (compendiumText) {
            userContent += compendiumText;
        }
        userContent += `\n\nBEAT TO EXPAND:\n${beat}\n\nWrite the next 2-3 paragraphs:`;

        // Return object with both messages array (for APIs) and string format (for local)
        const result = {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            // Legacy string format for local models with chat template
            asString: function () {
                return `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n`;
            }
        };
        return result;
    }

    async function streamGeneration(prompt, onToken, app) {
        // Get AI settings from app if provided
        const aiMode = app?.aiMode || 'local';
        const aiProvider = app?.aiProvider || 'anthropic';
        const aiApiKey = app?.aiApiKey || '';
        const aiModel = app?.aiModel || '';
        const aiEndpoint = app?.aiEndpoint || 'http://localhost:8080';
        const temperature = app?.temperature || 0.8;
        const maxTokens = app?.maxTokens || 300;

        // Convert prompt to appropriate format
        let promptStr = prompt;
        let messages = null;

        if (typeof prompt === 'object' && prompt.messages) {
            messages = prompt.messages;
            if (aiMode === 'local') {
                // Use string format for local server
                promptStr = prompt.asString();
            }
        }

        if (aiMode === 'api') {
            // API Mode - use configured provider with messages
            return await streamGenerationAPI(messages || promptStr, onToken, aiProvider, aiApiKey, aiModel, aiEndpoint, temperature, maxTokens);
        } else {
            // Local Mode - use llama-server with string prompt
            return await streamGenerationLocal(promptStr, onToken, aiEndpoint, temperature, maxTokens);
        }
    }

    async function streamGenerationLocal(prompt, onToken, endpoint, temperature, maxTokens) {
        // Local llama-server completion
        const response = await fetch(endpoint + '/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                n_predict: maxTokens || 300,
                temperature: temperature || 0.8,
                top_p: 0.9,
                stop: ['<|im_end|>', '<|endoftext|>', '\n\n\n\n', 'USER:', 'HUMAN:'],
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            onToken(data.content);
                        }
                        if (data.stop) {
                            return;
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
            }
        }
    }

    async function streamGenerationAPI(prompt, onToken, provider, apiKey, model, customEndpoint, temperature, maxTokens) {
        // API Mode - construct request based on provider
        let url, headers, body;

        // Convert prompt to messages if needed
        let messages;
        if (Array.isArray(prompt)) {
            messages = prompt;
        } else if (typeof prompt === 'string') {
            messages = [{ role: 'user', content: prompt }];
        } else {
            messages = [{ role: 'user', content: String(prompt) }];
        }

        const temp = temperature || 0.8;
        const maxTok = maxTokens || 300;

        if (provider === 'openrouter') {
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Writingway'
            };
            body = {
                model: model || 'google/gemini-2.0-flash-exp:free',
                messages: messages,
                temperature: temp,
                max_tokens: maxTok,
                stream: true
            };
        } else if (provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/messages';
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };
            body = {
                model: model || 'claude-3-5-sonnet-20241022',
                messages: messages,
                temperature: temp,
                max_tokens: maxTok,
                stream: true
            };
        } else if (provider === 'openai') {
            url = 'https://api.openai.com/v1/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            body = {
                model: model || 'gpt-4o-mini',
                messages: messages,
                temperature: temp,
                max_tokens: maxTok,
                stream: true
            };
        } else if (provider === 'google') {
            // Google AI uses a different API format - extract text from messages
            const text = messages.map(m => m.content).join('\n\n');
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash-exp'}:streamGenerateContent?key=${apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = {
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    temperature: temp,
                    maxOutputTokens: maxTok
                }
            };
        } else if (provider === 'custom') {
            url = customEndpoint;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            body = {
                model: model,
                messages: messages,
                temperature: temp,
                max_tokens: maxTok,
                stream: true
            };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${await response.text()}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    // Handle different streaming formats
                    let jsonStr = line;
                    if (line.startsWith('data: ')) jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') return;

                    const data = JSON.parse(jsonStr);

                    // Extract token based on provider format
                    let token = null;
                    if (provider === 'openrouter' || provider === 'openai' || provider === 'custom') {
                        token = data.choices?.[0]?.delta?.content;
                    } else if (provider === 'anthropic') {
                        if (data.type === 'content_block_delta') {
                            token = data.delta?.text;
                        }
                    } else if (provider === 'google') {
                        token = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    }

                    if (token) onToken(token);
                } catch (e) {
                    // Ignore parse errors for incomplete chunks
                }
            }
        }
    }

    window.Generation = {
        buildPrompt,
        streamGeneration
    };
})();
