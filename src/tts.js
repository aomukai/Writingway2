// Text-to-Speech Module
// Uses Web Speech API for natural voice reading
(function () {
    const TTS = {
        // Speech synthesis instance
        synth: window.speechSynthesis,
        currentUtterance: null,
        isPaused: false,

        /**
         * Get list of available voices
         * @returns {Array} Array of available voice objects
         */
        getVoices() {
            return this.synth.getVoices();
        },

        /**
         * Find best default voice (prefer English, neural if available)
         * @returns {SpeechSynthesisVoice|null} Best voice or null
         */
        getDefaultVoice() {
            const voices = this.getVoices();
            if (voices.length === 0) return null;

            // Prefer English voices
            let englishVoices = voices.filter(v => v.lang.startsWith('en'));
            if (englishVoices.length === 0) englishVoices = voices;

            // Prefer voices with "Natural" or "Neural" in the name (better quality)
            const naturalVoice = englishVoices.find(v =>
                v.name.includes('Natural') ||
                v.name.includes('Neural') ||
                v.name.includes('Premium')
            );

            return naturalVoice || englishVoices[0];
        },

        /**
         * Read text aloud
         * @param {string} text - Text to read
         * @param {Object} options - Options {voice, rate, pitch, onEnd, onStart}
         */
        speak(text, options = {}) {
            // Stop any current speech
            this.stop();

            if (!text || text.trim().length === 0) {
                console.warn('TTS: No text provided');
                return;
            }

            const utterance = new SpeechSynthesisUtterance(text);

            // Set voice
            if (options.voice) {
                utterance.voice = options.voice;
            } else {
                utterance.voice = this.getDefaultVoice();
            }

            // Set rate (0.5 - 2.0, default 1.0)
            utterance.rate = options.rate || 1.0;

            // Set pitch (0.0 - 2.0, default 1.0)
            utterance.pitch = options.pitch || 1.0;

            // Set volume (0.0 - 1.0, default 1.0)
            utterance.volume = options.volume || 1.0;

            // Event handlers
            utterance.onstart = () => {
                this.isPaused = false;
                if (options.onStart) options.onStart();
            };

            utterance.onend = () => {
                this.currentUtterance = null;
                this.isPaused = false;
                if (options.onEnd) options.onEnd();
            };

            utterance.onerror = (event) => {
                console.error('TTS error:', event);
                this.currentUtterance = null;
                this.isPaused = false;
                if (options.onEnd) options.onEnd(); // Treat error as end
            };

            this.currentUtterance = utterance;
            this.synth.speak(utterance);
        },

        /**
         * Pause current speech
         */
        pause() {
            if (this.synth.speaking && !this.isPaused) {
                this.synth.pause();
                this.isPaused = true;
            }
        },

        /**
         * Resume paused speech
         */
        resume() {
            if (this.isPaused) {
                this.synth.resume();
                this.isPaused = false;
            }
        },

        /**
         * Stop current speech
         */
        stop() {
            if (this.synth.speaking) {
                this.synth.cancel();
                this.currentUtterance = null;
                this.isPaused = false;
            }
        },

        /**
         * Check if currently speaking
         * @returns {boolean} True if speaking
         */
        isSpeaking() {
            return this.synth.speaking && !this.isPaused;
        },

        /**
         * Check if currently paused
         * @returns {boolean} True if paused
         */
        isPausedState() {
            return this.isPaused;
        }
    };

    // Export to window
    window.TTS = TTS;

    // Load voices (they load asynchronously)
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            // Voices loaded, can be used now
            console.log('TTS: Voices loaded', TTS.getVoices().length);
        };
    }
})();
