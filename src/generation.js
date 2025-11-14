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

        const prompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${contextText}${proseTemplateText}\n\nBEAT TO EXPAND:\n${beat}\n\nWrite the next 2-3 paragraphs:<|im_end|>\n<|im_start|>assistant\n`;

        // If we have compendiumText, insert it right after the user context and before the BEAT
        if (compendiumText) {
            const insertAt = prompt.indexOf('\n\nBEAT TO EXPAND:');
            if (insertAt !== -1) {
                const before = prompt.substring(0, insertAt);
                const after = prompt.substring(insertAt);
                return before + compendiumText + '\n' + after;
            }
        }
        return prompt;
    }

    async function streamGeneration(prompt, onToken) {
        // Performs the POST to the local llama-server completion endpoint and streams tokens.
        const response = await fetch('http://localhost:8080/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                n_predict: 300,
                temperature: 0.8,
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
                            // server indicated stop; finish early
                            return;
                        }
                    } catch (e) {
                        // ignore parse errors for incomplete chunks
                    }
                }
            }
        }
    }

    window.Generation = {
        buildPrompt,
        streamGeneration
    };
})();
