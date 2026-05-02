class ChineseReader {
    constructor() {
        this.config = null;
        this.cleanText = '';
        this.currentAudio = null;
        this.isPlaying = false;
        this.wordAudios = {};
        this.sentences = [];
        this.currentSentenceIndex = -1;
        this.init();
    }

    async init() {
        try {
            const response = await fetch('config.json');
            this.config = await response.json();
            // Keep original text with line breaks for rendering
            this.displayText = this.config.fullText;
            // Clean text for searching (no newlines)
            this.cleanText = this.config.fullText.replace(/\n/g, '');
            this.parseSentences();
            this.render();
            this.preloadAudios();
        } catch (error) {
            console.error('Error loading config:', error);
            this.showStatus('Error loading configuration');
        }
    }

    parseSentences() {
        // Create sentence objects with their text and position in cleanText
        this.sentences = [];

        this.config.sentences.forEach(sentenceConfig => {
            const sentenceText = sentenceConfig.text;
            const startIndex = this.cleanText.indexOf(sentenceText);

            if (startIndex !== -1) {
                this.sentences.push({
                    text: sentenceText,
                    startIndex: startIndex,
                    endIndex: startIndex + sentenceText.length,
                    audio: sentenceConfig.audio
                });
            }
        });
    }

    preloadAudios() {
        // Preload word audio files
        if (this.config.audioFiles.words) {
            Object.entries(this.config.audioFiles.words).forEach(([word, file]) => {
                const audio = new Audio(file);
                this.wordAudios[word] = audio;
            });
        }
    }

    render() {
        const textArea = document.getElementById('textArea');
        textArea.innerHTML = '';

        let cleanIndex = 0; // Track position in cleanText

        for (let i = 0; i < this.displayText.length; i++) {
            const char = this.displayText[i];

            // Handle line breaks
            if (char === '\n') {
                textArea.appendChild(document.createElement('br'));
                continue;
            }

            const span = document.createElement('span');
            span.className = 'text-char';
            span.textContent = char;
            span.dataset.index = cleanIndex;

            // Check if this character is part of a sentence
            const sentenceIndex = this.sentences.findIndex(s => cleanIndex >= s.startIndex && cleanIndex < s.endIndex);
            if (sentenceIndex !== -1) {
                span.classList.add('sentence-char');
                span.dataset.sentenceIndex = sentenceIndex;
            }

            // Check if this character has an audio file
            if (this.config.audioFiles.words && this.config.audioFiles.words[char]) {
                span.classList.add('word-button');
                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.playWord(char);
                });
            } else if (sentenceIndex !== -1) {
                // If part of sentence but not a word button, still make it clickable
                span.addEventListener('click', () => {
                    this.playSentenceByIndex(sentenceIndex);
                });
            }

            textArea.appendChild(span);
            cleanIndex++;
        }
    }

    playWord(char) {
        if (!this.wordAudios[char]) {
            console.warn(`No audio for character: ${char}`);
            return;
        }

        // Stop current playback
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
        }

        this.currentAudio = this.wordAudios[char];
        this.currentAudio.play().catch(err => console.error('Error playing audio:', err));
    }

    playSentenceByIndex(sentenceIndex) {
        if (sentenceIndex < 0 || sentenceIndex >= this.sentences.length) {
            return;
        }

        if (this.isPlaying) {
            this.stopPlayback();
            return;
        }

        const sentence = this.sentences[sentenceIndex];
        this.currentSentenceIndex = sentenceIndex;
        this.isPlaying = true;

        // Highlight the sentence
        this.highlightSentence(sentenceIndex);

        try {
            const audio = new Audio(sentence.audio);
            this.currentAudio = audio;

            audio.onended = () => {
                this.stopPlayback();
            };

            audio.play().catch(err => {
                console.error('Error playing sentence audio:', err);
                this.showStatus('❌ Error playing sentence');
                this.stopPlayback();
            });

            this.showStatus(`📖 Playing: ${sentence.text}`);
        } catch (error) {
            console.error('Error:', error);
            this.stopPlayback();
        }
    }

    highlightSentence(sentenceIndex) {
        // Clear all highlights
        document.querySelectorAll('.sentence-highlight').forEach(span => {
            span.classList.remove('sentence-highlight');
        });

        if (sentenceIndex >= 0 && sentenceIndex < this.sentences.length) {
            const sentence = this.sentences[sentenceIndex];
            const spans = document.querySelectorAll('[data-index]');

            spans.forEach(span => {
                const index = parseInt(span.dataset.index);
                if (index >= sentence.startIndex && index < sentence.endIndex) {
                    span.classList.add('sentence-highlight');
                }
            });
        }
    }

    async playFull() {
        if (this.isPlaying) {
            this.stopPlayback();
            return;
        }

        this.isPlaying = true;
        this.updatePlayingState();

        try {
            const audio = new Audio(this.config.audioFiles.full);
            this.currentAudio = audio;

            audio.onended = () => {
                this.stopPlayback();
            };

            audio.play().catch(err => {
                console.error('Error playing audio:', err);
                this.showStatus('❌ Error playing audio');
                this.stopPlayback();
            });

            this.showStatus('🔊 Playing full passage...');
        } catch (error) {
            console.error('Error:', error);
            this.showStatus('❌ Error');
            this.stopPlayback();
        }
    }

    highlightCurrentWord(currentTime) {
        const spans = document.querySelectorAll('.text-char');
        spans.forEach(span => span.classList.remove('highlight'));

        for (let timing of this.config.wordTimings) {
            if (currentTime >= timing.start && currentTime < timing.end) {
                const charIndex = this.cleanText.indexOf(timing.char);
                if (charIndex >= 0) {
                    for (let span of spans) {
                        if (parseInt(span.dataset.index) === charIndex) {
                            span.classList.add('highlight');
                            break;
                        }
                    }
                }
            }
        }
    }

    clearHighlights() {
        document.querySelectorAll('.highlight').forEach(span => {
            span.classList.remove('highlight');
        });
        document.querySelectorAll('.sentence-highlight').forEach(span => {
            span.classList.remove('sentence-highlight');
        });
    }

    stopPlayback() {
        this.isPlaying = false;
        this.updatePlayingState();
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
        }
        this.clearHighlights();
        this.currentSentenceIndex = -1;
        this.showStatus('');
    }

    updatePlayingState() {
        const btn = document.getElementById('btnReadFull');
        if (this.isPlaying) {
            btn.classList.add('playing');
        } else {
            btn.classList.remove('playing');
        }
    }

    showStatus(message) {
        document.getElementById('status').textContent = message;
    }

    reset() {
        this.stopPlayback();
        this.clearHighlights();
        this.render();
        this.showStatus('✨ Ready to learn!');
    }
}

// Initialize when page loads
let reader;
document.addEventListener('DOMContentLoaded', () => {
    reader = new ChineseReader();

    document.getElementById('btnReadFull').addEventListener('click', () => reader.playFull());
    document.getElementById('btnReset').addEventListener('click', () => reader.reset());
});
