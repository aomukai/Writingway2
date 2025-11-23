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
            // Include the full scene context - modern models have large context windows
            contextText = `\n\nCURRENT SCENE SO FAR:\n${sceneContext}`;
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
        let compendiumText = '';
        if (options.compendiumEntries && Array.isArray(options.compendiumEntries) && options.compendiumEntries.length > 0) {
            compendiumText = '\n\nCOMPENDIUM REFERENCES:\n';
            for (const ce of options.compendiumEntries) {
                try {
                    const title = ce.title || ('entry ' + (ce.id || ''));
                    const body = (ce.body || ce.body || ce.description || '') || ce.body || '';
                    compendiumText += `\n-- ${title} --\n${body}\n`;
                } catch (e) { /* ignore */ }
            }
        }

        // If scene summaries are provided, include them as context before the BEAT.
        let sceneSummariesText = '';
        if (options.sceneSummaries && Array.isArray(options.sceneSummaries) && options.sceneSummaries.length > 0) {
            sceneSummariesText = '\n\nPREVIOUS SCENES:\n';
            for (const scene of options.sceneSummaries) {
                try {
                    const title = scene.title || 'Untitled Scene';
                    const summary = scene.summary || '';
                    if (summary) {
                        sceneSummariesText += `\n-- ${title} --\n${summary}\n`;
                    }
                } catch (e) { /* ignore */ }
            }
        }

        let userContent = `${contextText}${proseTemplateText}`;
        if (compendiumText) {
            userContent += compendiumText;
        }
        if (sceneSummariesText) {
            userContent += sceneSummariesText;
        }

        // Strip mention tags from beat since they're already resolved and included above
        let cleanedBeat = beat;
        // Remove @[Title] compendium mentions
        cleanedBeat = cleanedBeat.replace(/@\[([^\]]+)\]/g, '');
        // Remove #[Title] scene mentions
        cleanedBeat = cleanedBeat.replace(/#\[([^\]]+)\]/g, '');
        // Clean up extra whitespace
        cleanedBeat = cleanedBeat.replace(/\s+/g, ' ').trim();

        userContent += `\n\nBEAT TO EXPAND:\n${cleanedBeat}\n\nWrite the next 2-3 paragraphs:`;

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
            // buildPrompt() result with messages and asString()
            messages = prompt.messages;
            if (aiMode === 'local') {
                // Use string format for local server
                promptStr = prompt.asString();
            }
        } else if (Array.isArray(prompt)) {
            // Raw messages array (e.g., from workshop chat)
            messages = prompt;
            if (aiMode === 'local') {
                // Convert messages array to ChatML format for local server
                promptStr = messagesToChatML(messages);
            }
        }

        if (aiMode === 'api') {
            // API Mode - use configured provider with messages
            return await streamGenerationAPI(messages || promptStr, onToken, aiProvider, aiApiKey, aiModel, aiEndpoint, temperature, maxTokens, app);
        } else {
            // Local Mode - use llama-server with string prompt
            return await streamGenerationLocal(promptStr, onToken, aiEndpoint, temperature, maxTokens);
        }
    }

    /**
     * Convert messages array to ChatML format string
     * @param {Array} messages - Array of {role, content} objects
     * @returns {string} - Formatted ChatML string
     */
    function messagesToChatML(messages) {
        if (!Array.isArray(messages)) return '';

        let result = '';
        for (const msg of messages) {
            result += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
        }
        // Add assistant start tag for completion
        result += '<|im_start|>assistant\n';
        return result;
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

    async function streamGenerationAPI(prompt, onToken, provider, apiKey, model, customEndpoint, temperature, maxTokens, app) {
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

        // Check if user has explicitly forced non-streaming mode
        const userForcedNonStreaming = app?.forceNonStreaming || false;

        // Detect thinking models that don't support streaming
        // This includes known patterns and can be expanded as new models emerge
        // TODO: Consider adding a user-facing "Force non-streaming" toggle in AI settings
        // for models that aren't auto-detected but still need it
        const modelLower = (model || '').toLowerCase();
        const isThinkingModel = model && (
            // OpenAI o-series (o1, o3, o4, etc.)
            /\bo[0-9][-_]/.test(model) ||
            // Explicit reasoning/thinking indicators
            modelLower.includes('reasoning') ||
            modelLower.includes('think') ||
            modelLower.includes('thought') ||
            // Known thinking model families
            modelLower.includes('deepseek-reasoner') ||
            modelLower.includes('qwq') ||
            modelLower.includes('r1') && modelLower.includes('deepseek')
        );

        const shouldDisableStreaming = userForcedNonStreaming || isThinkingModel;

        if (shouldDisableStreaming) {
            if (userForcedNonStreaming) {
                console.log('🔧 Non-streaming mode forced by user setting');
            }
            if (isThinkingModel) {
                console.log('🧠 Thinking model detected:', model, '- will use non-streaming mode');
            }
        }

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
                stream: !shouldDisableStreaming // Disable streaming for thinking models or if forced
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
                stream: true // Anthropic models all support streaming
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
                stream: !shouldDisableStreaming // Disable streaming for thinking models or if forced
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

        // Debug logging for API requests
        console.log('🚀 API Request to:', provider);
        console.log('📨 Messages being sent:', JSON.stringify(messages, null, 2));
        console.log('⚙️ Temperature:', temp, 'Max Tokens:', maxTok);

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error:', response.status, errorText);
            throw new Error(`API returned ${response.status}: ${errorText}`);
        }

        // Check if response is actually streaming or if it's a complete response
        const contentType = response.headers.get('content-type');
        console.log('📋 Response Content-Type:', contentType);

        // Some thinking models don't support streaming and return complete JSON
        if (contentType?.includes('application/json') && !contentType?.includes('text/event-stream')) {
            console.log('📦 Non-streaming response detected (likely thinking model)');
            const data = await response.json();
            console.log('📄 Full response data:', JSON.stringify(data, null, 2));

            // Extract content from non-streaming response
            let content = null;
            if (provider === 'openrouter' || provider === 'openai' || provider === 'custom') {
                content = data.choices?.[0]?.message?.content;

                // For thinking models (o1, o3, etc.) that return encrypted reasoning,
                // check if content is empty but there's a finish_reason
                if (!content && data.choices?.[0]?.finish_reason) {
                    console.warn('⚠️ Thinking model returned empty content. This usually means:');
                    console.warn('   - Max tokens was hit during reasoning phase');
                    console.warn('   - Model never produced final answer');
                    console.warn('   - Try increasing max_tokens significantly (10000+) for thinking models');
                    throw new Error('Thinking model returned empty response. The model likely hit max_tokens during its reasoning phase before generating an answer. Try increasing Max Length to 10000+ tokens in AI Settings.');
                }
            } else if (provider === 'anthropic') {
                content = data.content?.[0]?.text;
            } else if (provider === 'google') {
                content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            }

            console.log('✅ Extracted content length:', content?.length || 0);

            if (content) {
                // Emit content in chunks to simulate streaming
                const words = content.split(/(\s+)/);
                for (const word of words) {
                    onToken(word);
                    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for UI
                }
            } else {
                console.error('❌ No content found in non-streaming response');
                throw new Error('No content received from API');
            }
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let hasReceivedContent = false;

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
                    if (jsonStr === '[DONE]') {
                        console.log('🏁 Stream finished with [DONE]');
                        if (!hasReceivedContent) {
                            console.warn('⚠️ Stream ended without content - possible thinking model without streaming support');
                        }
                        return;
                    }

                    const data = JSON.parse(jsonStr);

                    // Debug: Log every chunk to see what we're receiving
                    if (!hasReceivedContent) {
                        console.log('🔍 First chunk received:', JSON.stringify(data, null, 2));
                    }

                    // Extract token based on provider format
                    let token = null;
                    if (provider === 'openrouter' || provider === 'openai' || provider === 'custom') {
                        // For thinking models (o1, o3, etc), reasoning is in a separate field
                        // We want to capture both reasoning and regular content
                        const delta = data.choices?.[0]?.delta;
                        if (delta) {
                            // Try reasoning_content first (for thinking models)
                            token = delta.reasoning_content || delta.content;

                            if (!hasReceivedContent && delta) {
                                console.log('🔍 Delta object:', JSON.stringify(delta, null, 2));
                            }
                        }

                        // Some models put the complete message in the first chunk
                        if (!token && data.choices?.[0]?.message?.content) {
                            token = data.choices[0].message.content;
                            console.log('📝 Found complete message in chunk');
                        }
                    } else if (provider === 'anthropic') {
                        if (data.type === 'content_block_delta') {
                            token = data.delta?.text;
                        }
                    } else if (provider === 'google') {
                        token = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    }

                    if (token) {
                        hasReceivedContent = true;
                        onToken(token);
                    } else if (!hasReceivedContent) {
                        console.log('⚠️ No token extracted from chunk');
                    }
                } catch (e) {
                    // Ignore parse errors for incomplete chunks
                    console.debug('Parse error (likely incomplete chunk):', e.message);
                }
            }
        }

        if (!hasReceivedContent) {
            console.error('⚠️ No content received from stream');
            console.error('This usually happens with thinking models that either:');
            console.error('1. Do not support streaming at all');
            console.error('2. Return content in a different field structure');
            console.error('3. Require stream=false in the API request');
            throw new Error('No content received from API. This model may not support streaming or may require different parameters.');
        }
    }

    window.Generation = {
        buildPrompt,
        streamGeneration
    };
})();
