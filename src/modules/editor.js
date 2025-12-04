/**
 * Editor Module
 * Handles text editing functionality including selection, rewriting, special characters, and auto-replacement
 */

(function () {
    const Editor = {
        /**
         * Count words in text (strips HTML tags)
         * @param {string} text - Text to count words in
         * @returns {number} Word count
         */
        countWords(text) {
            if (!text) return 0;
            // Strip HTML tags for word counting
            const plainText = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
            return plainText.trim().split(/\s+/).filter(word => word.length > 0).length;
        },

        /**
         * Insert special character at cursor position in editor
         * @param {Object} app - Alpine app instance
         * @param {string} char - Character to insert
         */
        insertSpecialChar(app, char) {
            if (!app.currentScene) return;
            const textarea = document.querySelector('.editor-textarea');
            if (!textarea) return;

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = app.currentScene.content || '';

            app.currentScene.content = text.substring(0, start) + char + text.substring(end);
            app.showSpecialChars = false;

            app.$nextTick(() => {
                textarea.focus();
                const newPos = start + char.length;
                textarea.setSelectionRange(newPos, newPos);
            });
        },

        /**
         * Handle auto-replacement of -- to em dash
         * @param {Object} app - Alpine app instance
         * @param {Event} event - Input event
         */
        handleAutoReplace(app, event) {
            if (!app.currentScene || !app.currentScene.content) return;

            const textarea = event.target;
            const cursorPos = textarea.selectionStart;
            const text = app.currentScene.content;

            // Check if we just typed a second hyphen
            if (text.substring(cursorPos - 2, cursorPos) === '--') {
                // Replace -- with em dash
                app.currentScene.content = text.substring(0, cursorPos - 2) + '—' + text.substring(cursorPos);

                app.$nextTick(() => {
                    const newPos = cursorPos - 1; // Move cursor after the em dash
                    textarea.setSelectionRange(newPos, newPos);
                });
            }
        },

        /**
         * Compute selection coordinates inside a textarea by mirroring styles into a hidden div
         * @param {HTMLTextAreaElement} textarea - The textarea element
         * @param {number} selectionIndex - Selection position
         * @returns {Object|null} Coordinates {left, top, height, right} or null
         */
        getTextareaSelectionCoords(textarea, selectionIndex) {
            try {
                const rect = textarea.getBoundingClientRect();

                // Don't show button if textarea is not visible
                if (rect.width === 0 || rect.height === 0) {
                    return null;
                }

                // Create mirror div placed at the textarea's position
                const div = document.createElement('div');
                const style = window.getComputedStyle(textarea);
                // Copy relevant textarea styles
                div.style.position = 'absolute';
                div.style.visibility = 'hidden';
                div.style.whiteSpace = 'pre-wrap';
                div.style.wordWrap = 'break-word';
                div.style.overflow = 'hidden';
                div.style.boxSizing = 'border-box';
                div.style.width = rect.width + 'px';
                div.style.left = rect.left + window.scrollX + 'px';
                div.style.top = rect.top + window.scrollY + 'px';
                div.style.font = style.font || `${style.fontSize} ${style.fontFamily}`;
                div.style.fontSize = style.fontSize;
                div.style.lineHeight = style.lineHeight;
                div.style.padding = style.padding;
                div.style.border = style.border;
                div.style.letterSpacing = style.letterSpacing;
                div.style.whiteSpace = 'pre-wrap';

                const text = textarea.value.substring(0, selectionIndex);
                // Replace trailing spaces with nbsp so measurement matches
                const safe = text.replace(/\n$/g, '\n\u200b');
                div.textContent = safe;

                const span = document.createElement('span');
                span.textContent = textarea.value.substring(selectionIndex, selectionIndex + 1) || '\u200b';
                div.appendChild(span);

                document.body.appendChild(div);
                const spanRect = span.getBoundingClientRect();
                const coords = { left: spanRect.left, top: spanRect.top, height: spanRect.height, right: spanRect.right };
                document.body.removeChild(div);

                return coords;
            } catch (e) {
                return null;
            }
        },

        /**
         * Handle clicks on the floating Rewrite button: open modal with selected text
         * @param {Object} app - Alpine app instance
         */
        handleRewriteButtonClick(app) {
            try {
                // For textarea, use stored selection indices
                const editor = document.querySelector('.editor-textarea');
                if (editor && editor.tagName === 'TEXTAREA') {
                    app.rewriteOriginalText = app.selectedTextForRewrite || '';
                    // Keep the selection indices for later replacement
                } else {
                    // Fallback for contenteditable (if ever used)
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        app.rewriteSelectionRange = selection.getRangeAt(0).cloneRange();
                        app.rewriteOriginalText = selection.toString();
                    } else {
                        app.rewriteOriginalText = app.selectedTextForRewrite || '';
                        app.rewriteSelectionRange = null;
                    }
                }
                app.rewriteOutput = '';
                app.rewritePromptPreview = '';
                app.rewriteInProgress = false;
                app.showRewriteModal = true;
                app.showRewriteBtn = false;
            } catch (e) {
                console.error('handleRewriteButtonClick error', e);
            }
        },

        /**
         * Build the prompt for rewriting selected text
         * @param {Object} app - Alpine app instance
         * @returns {string} The rewrite prompt
         */
        buildRewritePrompt(app) {
            try {
                // Show the rewrite prompt list for selection
                app.showRewritePromptList = true;

                // If a rewrite prompt is selected, use it
                let rewritePrompt = '';
                if (app.selectedRewritePromptId) {
                    const selected = app.prompts.find(p => p.id === app.selectedRewritePromptId);
                    if (selected && selected.content) {
                        rewritePrompt = selected.content;
                    }
                }

                // Build the full prompt
                let prompt = rewritePrompt || 'Rewrite the following passage to be more vivid and polished while preserving its meaning and details. Keep roughly the same length.';
                prompt += '\n\nORIGINAL TEXT:\n' + app.rewriteOriginalText + '\n\nREWRITTEN TEXT:';
                app.rewritePromptPreview = prompt;
                return prompt;
            } catch (e) {
                console.error('buildRewritePrompt error', e);
                return 'Rewrite the following text:\n\n' + app.rewriteOriginalText;
            }
        },

        /**
         * Perform the rewrite operation using AI
         * @param {Object} app - Alpine app instance
         */
        async performRewrite(app) {
            try {
                if (!app.rewriteOriginalText) return;
                if (!window.Generation || typeof window.Generation.streamGeneration !== 'function') {
                    throw new Error('Generation not available');
                }
                app.rewriteOutput = '';
                app.rewriteInProgress = true;
                const prompt = this.buildRewritePrompt(app);
                const result = await window.Generation.streamGeneration(prompt, (token) => {
                    app.rewriteOutput += token;
                }, app);
                app.rewriteInProgress = false;

                // Notify user if response was truncated
                if (result?.finishReason === 'length' || result?.finishReason === 'MAX_TOKENS') {
                    console.warn('⚠️ Rewrite hit token limit');
                    alert(t('generation.tokenLimitTip'));
                }
            } catch (e) {
                console.error('performRewrite error', e);
                app.rewriteInProgress = false;
                alert(t('rewrite.failedPrefix') + (e && e.message ? e.message : e));
            }
        },

        /**
         * Accept the rewritten text and replace the original
         * @param {Object} app - Alpine app instance
         */
        async acceptRewrite(app) {
            try {
                if (!app.currentScene || !app.rewriteOutput) return;

                const editor = document.querySelector('.editor-textarea');
                if (editor && editor.tagName === 'TEXTAREA') {
                    // Replace text in textarea using stored selection indices
                    if (app.rewriteTextareaStart !== null && app.rewriteTextareaEnd !== null) {
                        const before = app.currentScene.content.substring(0, app.rewriteTextareaStart);
                        const after = app.currentScene.content.substring(app.rewriteTextareaEnd);
                        app.currentScene.content = before + app.rewriteOutput + after;

                        // Save the scene
                        await app.saveCurrentScene();
                    }
                } else if (app.rewriteSelectionRange) {
                    // Fallback for contenteditable (if ever used)
                    const contentEditor = document.querySelector('.editor-textarea[contenteditable="true"]');
                    if (contentEditor) {
                        // Delete the selected content and insert the new text
                        app.rewriteSelectionRange.deleteContents();
                        const textNode = document.createTextNode(app.rewriteOutput);
                        app.rewriteSelectionRange.insertNode(textNode);

                        // Trigger the input event to save the change
                        const event = new Event('input', { bubbles: true });
                        contentEditor.dispatchEvent(event);
                    }
                }

                app.showRewriteModal = false;
                app.rewriteOriginalText = '';
                app.rewriteOutput = '';
                app.rewriteSelectionRange = null;
                app.rewriteTextareaStart = null;
                app.rewriteTextareaEnd = null;
            } catch (e) {
                console.error('acceptRewrite error', e);
            }
        },

        /**
         * Retry the rewrite operation
         * @param {Object} app - Alpine app instance
         */
        retryRewrite(app) {
            app.rewriteOutput = '';
            this.performRewrite(app);
        },

        /**
         * Discard the rewrite and close the modal
         * @param {Object} app - Alpine app instance
         */
        discardRewrite(app) {
            app.showRewriteModal = false;
            app.showRewritePromptList = false;
            app.selectedRewritePromptId = null;
            app.rewriteOriginalText = '';
            app.rewriteOutput = '';
            app.rewritePromptPreview = '';
            app.rewriteTextareaStart = null;
            app.rewriteTextareaEnd = null;
        }
    };

    // Expose globally for Alpine.js
    window.Editor = Editor;
})();
