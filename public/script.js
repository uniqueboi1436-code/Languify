// PDF.js worker (required for PDF rendering)
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const sourceText = document.getElementById('sourceText');
const translatedText = document.getElementById('translatedText');
const translatedImageWrap = document.getElementById('translatedImageWrap');
const translatedImage = document.getElementById('translatedImage');
const sourceLang = document.getElementById('sourceLang');
const targetLang = document.getElementById('targetLang');
const sourceLangSearch = document.getElementById('sourceLangSearch');
const targetLangSearch = document.getElementById('targetLangSearch');
const translateBtn = document.getElementById('translateBtn');
const clearBtn = document.getElementById('clearBtn');
const swapBtn = document.getElementById('swapBtn');
const copyBtn = document.getElementById('copyBtn');
const speakBtn = document.getElementById('speakBtn');
const voiceBtn = document.getElementById('voiceBtn');
const voiceVisualizer = document.getElementById('voiceVisualizer');
const voiceStatus = document.getElementById('voiceStatus');
const loading = document.getElementById('loading');
const errorBox = document.getElementById('error');
const successBox = document.getElementById('success');
// ===== APP STATE =====
const saveTranslationBtn = document.getElementById('saveTranslationBtn');
let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
  sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('sessionId', sessionId);
}

// Check for shared translation in URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('share')) {
  const shareId = urlParams.get('share');
  fetch(`/api/translation?id=${encodeURIComponent(shareId)}`)
    .then(resp => resp.json())
    .then(json => {
      if (json.success && json.data) {
        sourceText.value = json.data.source_text || '';
        translatedText.value = json.data.translated_text || '';
        if (json.data.source_lang) sourceLang.value = json.data.source_lang;
        if (json.data.target_lang) targetLang.value = json.data.target_lang;
      }
    })
    .catch(err => console.error('Failed to load shared translation', err));
}

function showError(msg) {
  hideMessages();
  if (errorBox) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
}

function showSuccess(msg) {
  hideMessages();
  if (successBox) {
    successBox.textContent = msg;
    successBox.classList.remove('hidden');
  }
}

// Save translation handler

saveTranslationBtn.addEventListener('click', async () => {
  try {
    const payload = {
      sourceText: sourceText.value,
      translatedText: translatedText.value,
      sourceLang: sourceLang.value,
      targetLang: targetLang.value,
      sessionId: sessionId
    };

    const resp = await fetch('/api/save-translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Save failed');
    showSuccess('Translation saved successfully');

    // Display share link if id returned
    if (data.id) {
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(data.id)}`;
      const container = document.getElementById('shareLinkContainer');
      container.innerHTML = `Share this translation: <input id="shareLinkText" type="text" readonly value="${shareUrl}" class="share-url-input" /> <button id="copyShareBtn" class="btn btn-secondary">Copy</button>`;
      container.classList.remove('hidden');

      const copyBtn = document.getElementById('copyShareBtn');
      copyBtn.addEventListener('click', () => {
        const linkInput = document.getElementById('shareLinkText');
        linkInput.select();
        document.execCommand('copy');
        showSuccess('Link copied to clipboard');
      });
    }
  } catch (err) {
    showError('Save failed: ' + err.message);
  }
});

// Speech Recognition Setup

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();

  // Configure speech recognition for no background noise
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US'; // Default language

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceVisualizer.classList.remove('hidden');
    voiceStatus.textContent = 'Listening... Speak clearly';
    console.log('Voice recognition started');
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }

    // Update voice status
    if (finalTranscript) {
      voiceStatus.textContent = `Recognized: "${finalTranscript.trim()}"`;
      sourceText.value = (sourceText.value + ' ' + finalTranscript).trim();
    } else if (interimTranscript) {
      voiceStatus.textContent = `Interim: "${interimTranscript}"`;
    }
  };

  recognition.onerror = (event) => {
    console.error('Voice recognition error:', event.error);
    let errorMessage = 'Error: ';

    switch (event.error) {
      case 'network':
        errorMessage += 'Network error. Check your internet connection.';
        break;
      case 'no-speech':
        errorMessage += 'No speech detected. Please try again.';
        break;
      case 'audio-capture':
        errorMessage += 'No microphone found. Please check your device.';
        break;
      default:
        errorMessage += event.error;
    }

    voiceStatus.textContent = errorMessage;
    showError(errorMessage);
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceVisualizer.classList.add('hidden');
    voiceStatus.textContent = 'Voice input ended. Click to try again.';
    console.log('Voice recognition ended');
  };
} else {
  console.warn('Speech Recognition API not supported in this browser');
}

// Voice Input Button Handler
voiceBtn.addEventListener('click', () => {
  if (!recognition) {
    showError('Voice recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
    return;
  }

  if (isListening) {
    recognition.stop();
  } else {
    try {
      // Get the selected source language
      const sourceLangCode = sourceLang.value;

      // Map language codes to Web Speech API language format
      const languageMap = {
        'auto': 'en-US',
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'pt': 'pt-BR',
        'ru': 'ru-RU',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'zh': 'zh-CN',
        'zh-TW': 'zh-TW',
        'ar': 'ar-SA',
        'hi': 'hi-IN',
        'th': 'th-TH',
        'vi': 'vi-VN',
        'tr': 'tr-TR',
        'nl': 'nl-NL',
        'sv': 'sv-SE',
        'no': 'no-NO',
        'da': 'da-DK',
        'fi': 'fi-FI',
        'el': 'el-GR',
        'hu': 'hu-HU',
        'cs': 'cs-CZ',
        'ro': 'ro-RO',
        'bg': 'bg-BG',
        'hr': 'hr-HR',
        'uk': 'uk-UA',
        'pl': 'pl-PL',
      };

      recognition.lang = languageMap[sourceLangCode] || 'en-US';
      sourceText.value = ''; // Clear previous text
      recognition.start();
    } catch (error) {
      showError('Failed to start voice input: ' + error.message);
    }
  }
});

// Theme toggle functionality
const themeToggle = document.getElementById('themeToggle');
let currentTheme = localStorage.getItem('theme') || 'light';

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  currentTheme = theme;

  // Update button icon
  if (theme === 'dark') {
    themeToggle.textContent = '☀️';
    themeToggle.title = 'Switch to Light Mode';
  } else {
    themeToggle.textContent = '🌙';
    themeToggle.title = 'Switch to Dark Mode';
  }
}

// Initialize theme
setTheme(currentTheme);

// Theme toggle event listener
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  });
}

// Initialize App - Run Immediately since script is at end of body
console.log('App Initializing...');

// Setup Language Inputs (deferred slightly to ensure other scripts loaded)

setTimeout(() => {
  if (typeof populateLanguageSelect === 'function') {
    populateLanguageSelect(sourceLang);
    populateLanguageSelect(targetLang);
  }
  setupLanguageSearch();
  if (sourceLang) sourceLang.value = 'auto';
  if (targetLang) targetLang.value = 'es';

  // 3. Load Voices
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => console.log('Voices loaded');
  }
}, 100);

// Language search functionality
function setupLanguageSearch() {
  // Source language search
  if (sourceLangSearch) {
    sourceLangSearch.addEventListener('input', (e) => {
      const searchTerm = e.target.value;
      populateLanguageSelect(sourceLang, searchTerm);

      // Keep it at source language if it was previously set
      if (searchTerm === '') {
        sourceLang.value = 'auto';
      }
    });

    // Focus event to show all languages
    sourceLangSearch.addEventListener('focus', () => {
      if (sourceLangSearch.value === '') {
        populateLanguageSelect(sourceLang, '');
      }
    });
  }

  // Target language search
  if (targetLangSearch) {
    targetLangSearch.addEventListener('input', (e) => {
      const searchTerm = e.target.value;
      populateLanguageSelect(targetLang, searchTerm);
    });

    // Focus event to show all languages
    targetLangSearch.addEventListener('focus', () => {
      if (targetLangSearch.value === '') {
        populateLanguageSelect(targetLang, '');
      }
    });
  }
}

// Fallback helper for translation
async function executeTranslation(text, srcLang, tgtLang) {
  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang: srcLang, targetLang: tgtLang })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Backend translation failed');
    }
    const data = await response.json();
    return data.translatedText || '';
  } catch (err) {
    console.warn("Backend translation failed, falling back to direct API:", err.message);
    const sourceLangCode = srcLang === 'auto' ? 'auto' : srcLang;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLangCode}&tl=${tgtLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Translation failed');
    const result = await res.json();
    if (result && result[0] && result[0][0]) {
      return result[0].map(item => item[0]).join('');
    }
    throw new Error('Invalid translation response');
  }
}

// Translate function
translateBtn.addEventListener('click', async () => {
  const text = sourceText.value.trim();

  if (!text) {
    showError('Please enter some text to translate');
    return;
  }

  if (!targetLang.value) {
    showError('Please select a target language');
    return;
  }

  showLoading(true);
  hideMessages();

  try {
    // Document translation mode: translate with layout preservation
    if (documentTranslationSource && documentTranslationSource.lines.length > 0) {
      const { imageDataUrl, lines, ocrWidth, ocrHeight, origWidth, origHeight } = documentTranslationSource;
      const translatedLines = [];

      // Translate each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const translated = await executeTranslation(line.text, sourceLang.value, targetLang.value);
        translatedLines.push(translated);
      }

      // Combine lines with translations
      const linesWithTranslated = lines.map((l, i) => ({ ...l, translatedText: translatedLines[i] }));

      // Render translated document
      const translatedDocDataUrl = await renderTranslatedDocument(imageDataUrl, linesWithTranslated, ocrWidth, ocrHeight, origWidth, origHeight);

      // Store for download
      documentTranslationSource.translatedDataUrl = translatedDocDataUrl;

      // Display translated text
      translatedText.value = translatedLines.join('\n');

      // Show translated document image
      if (translatedDocumentPreview && translatedDocumentWrap) {
        translatedDocumentPreview.src = translatedDocDataUrl;
        translatedDocumentWrap.classList.remove('hidden');
        translatedText.classList.add('hidden');
        if (translatedImageWrap) translatedImageWrap.classList.add('hidden');
      }

      showSuccess('Document translated with layout preserved! You can download it below.');
      return;
    }

    // Photo mode: translate each line and render image with text replaced
    if (photoTranslationSource && photoTranslationSource.lines.length > 0) {
      const { imageDataUrl, lines, ocrWidth, ocrHeight, origWidth, origHeight } = photoTranslationSource;
      const translatedLines = [];
      for (const line of lines) {
        const translated = await executeTranslation(line.text, sourceLang.value, targetLang.value);
        translatedLines.push(translated);
      }
      const linesWithTranslated = lines.map((l, i) => ({ ...l, translatedText: translatedLines[i] }));
      const translatedImageDataUrl = await renderTranslatedPhoto(imageDataUrl, linesWithTranslated, ocrWidth, ocrHeight, origWidth, origHeight);
      translatedText.value = translatedLines.join('\n');
      if (translatedImage && translatedImageWrap) {
        translatedImage.src = translatedImageDataUrl;
        translatedImageWrap.classList.remove('hidden');
        translatedText.classList.add('hidden');
      }
      if (translatedDocumentWrap) translatedDocumentWrap.classList.add('hidden');
      showSuccess('Photo translated! Image shown with text in your language.');
      return;
    }

    // Normal text translation
    const translated = await executeTranslation(text, sourceLang.value, targetLang.value);
    translatedText.value = translated;
    if (translatedImageWrap) translatedImageWrap.classList.add('hidden');
    if (translatedDocumentWrap) translatedDocumentWrap.classList.add('hidden');
    if (translatedText) translatedText.classList.remove('hidden');
    showSuccess('Translation completed successfully!');
  } catch (error) {
    showError(`Error: ${error.message}`);
  } finally {
    showLoading(false);
  }
});

// Clear button
clearBtn.addEventListener('click', () => {
  sourceText.value = '';
  photoTranslationSource = null;
  documentTranslationSource = null;
  if (translatedImageWrap) translatedImageWrap.classList.add('hidden');
  if (translatedDocumentWrap) translatedDocumentWrap.classList.add('hidden');
  if (translatedText) {
    translatedText.classList.remove('hidden');
    translatedText.value = '';
  }
  hideMessages();
});

// Swap languages and text
swapBtn.addEventListener('click', () => {
  photoTranslationSource = null;
  documentTranslationSource = null;
  if (translatedImageWrap) translatedImageWrap.classList.add('hidden');
  if (translatedDocumentWrap) translatedDocumentWrap.classList.add('hidden');
  if (translatedText) translatedText.classList.remove('hidden');

  const temp = sourceText.value;
  sourceText.value = translatedText.value;
  translatedText.value = temp;

  const tempLang = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = tempLang;

  sourceLangSearch.value = '';
  targetLangSearch.value = '';

  if (tempLang === 'auto') {
    sourceLang.value = 'auto';
  }

  hideMessages();
});

// Copy translated text
copyBtn.addEventListener('click', () => {
  if (!translatedText.value) {
    showError('Nothing to copy!');
    return;
  }

  navigator.clipboard.writeText(translatedText.value).then(() => {
    showSuccess('Copied to clipboard!');
  }).catch(() => {
    showError('Failed to copy to clipboard');
  });
});

// Speak function (using Web Speech API with proper language mapping and voice loading)
speakBtn.addEventListener('click', () => {
  const text = translatedText.value.trim();

  if (!text) {
    showError('No text to speak');
    return;
  }

  // Check if speech synthesis is supported
  if (!window.speechSynthesis) {
    showError('Speech synthesis is not supported in your browser');
    return;
  }

  // Stop any ongoing speech first
  window.speechSynthesis.cancel();

  // Function to speak with proper voice loading
  const speakText = (retryCount = 0) => {
    const utterance = new SpeechSynthesisUtterance(text);

    // Map language codes to proper BCP 47 tags
    const languageMap = {
      'auto': 'en-US',
      'en': 'en-US',
      'es': 'es-ES',
      'fr': 'fr-FR',
      'de': 'de-DE',
      'it': 'it-IT',
      'pt': 'pt-BR',
      'ru': 'ru-RU',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'zh': 'zh-CN',
      'zh-TW': 'zh-TW',
      'ar': 'ar-SA',
      'hi': 'hi-IN',
      'th': 'th-TH',
      'vi': 'vi-VN',
      'tr': 'tr-TR',
      'nl': 'nl-NL',
      'sv': 'sv-SE',
      'no': 'no-NO',
      'da': 'da-DK',
      'fi': 'fi-FI',
      'el': 'el-GR',
      'hu': 'hu-HU',
      'cs': 'cs-CZ',
      'ro': 'ro-RO',
      'bg': 'bg-BG',
      'hr': 'hr-HR',
      'uk': 'uk-UA',
      'pl': 'pl-PL',
      // African
      'af': 'af-ZA',
      'am': 'am-ET',
      'ny': 'ny-MW',
      'st': 'st-ZA',
      'sn': 'sn-ZW',
      'so': 'so-SO',
      'sw': 'sw-KE',
      'yo': 'yo-NG',
      'zu': 'zu-ZA',
      'xh': 'xh-ZA',
      'rw': 'rw-RW',
      'lg': 'lg-UG',
      'mg': 'mg-MG',
      'ti': 'ti-ER',
      // European
      'sq': 'sq-AL',
      'hy': 'hy-AM',
      'eu': 'eu-ES',
      'be': 'be-BY',
      'bs': 'bs-BA',
      'ca': 'ca-ES',
      'ceb': 'ceb-PH',
      'et': 'et-EE',
      'gl': 'gl-ES',
      'ka': 'ka-GE',
      'is': 'is-IS',
      'ga': 'ga-IE',
      'lv': 'lv-LV',
      'lt': 'lt-LT',
      'lb': 'lb-LU',
      'mk': 'mk-MK',
      'mt': 'mt-MT',
      'gd': 'gd-GB',
      'sr': 'sr-RS',
      'sk': 'sk-SK',
      'sl': 'sl-SI',
      'cy': 'cy-GB',
      'fo': 'fo-FO',
      'fy': 'fy-NL',
      'eo': 'eo',
      // Asian
      'lo': 'lo-LA',
      'km': 'km-KH',
      'my': 'my-MM',
      'tl': 'tl-PH',
      'id': 'id-ID',
      'ms': 'ms-MY',
      'bn': 'bn-BD',
      'pa': 'pa-IN',
      'ur': 'ur-PK',
      'ta': 'ta-IN',
      'te': 'te-IN',
      'mr': 'mr-IN',
      'gu': 'gu-IN',
      'kn': 'kn-IN',
      'ml': 'ml-IN',
      'or': 'or-IN',
      'ne': 'ne-NP',
      'mai': 'mai-IN',
      'bho': 'bho-IN',
      'new': 'new-NP',
      'taj': 'taj-NP',
      'si': 'si-LK',
      'dv': 'dv-MV',
      'as': 'as-IN',
      'bh': 'bh-IN',
      'sa': 'sa-IN',
      'fa': 'fa-IR',
      'he': 'he-IL',
      'ps': 'ps-AF',
      'az': 'az-AZ',
      'kk': 'kk-KZ',
      'ky': 'ky-KG',
      'tg': 'tg-TJ',
      'tk': 'tk-TM',
      'uz': 'uz-UZ',
      'mn': 'mn-MN',
      'dz': 'dz-BT',
      'tet': 'tet-TL',
      // Americas
      'ak': 'ak-GH',
      'ha': 'ha-NG',
      'ig': 'ig-NG',
      'la': 'la',
      'mi': 'mi-NZ',
      'qu': 'qu-PE',
      'ay': 'ay-BO',
      'gn': 'gn-PY',
    };

    utterance.lang = languageMap[targetLang.value] || targetLang.value;

    // Get voices and select appropriate voice
    let voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;

    console.log('Available voices:', voices.length);
    console.log('Target language:', targetLang.value, 'utterance.lang:', utterance.lang);

    if (voices.length > 0) {
      const targetLangCode = targetLang.value;
      const targetLangBase = targetLangCode.split('-')[0];

      // Priority 1: Flexible language match (handles es-ES matching es, etc.)
      selectedVoice = voices.find(voice => {
        const voiceLang = voice.lang.toLowerCase();
        const targetLang = utterance.lang.toLowerCase();
        return voiceLang.startsWith(targetLang) || targetLang.startsWith(voiceLang);
      });

      // Priority 2: Language family match with flexible matching
      if (!selectedVoice) {
        selectedVoice = voices.find(voice => {
          const voiceLang = voice.lang.toLowerCase();
          return voiceLang.startsWith(targetLangBase + '-') || voiceLang === targetLangBase;
        });
      }

      // Priority 3: Voice name contains language code
      if (!selectedVoice) {
        selectedVoice = voices.find(voice =>
          voice.name.toLowerCase().includes(targetLangCode) ||
          voice.name.toLowerCase().includes(targetLangBase)
        );
      }

      // Priority 4: Try common language fallbacks with flexible matching
      if (!selectedVoice) {
        const fallbacks = {
          'zh': ['zh-CN', 'zh-TW', 'zh-HK', 'zh'],
          'en': ['en-US', 'en-GB', 'en-AU', 'en'],
          'es': ['es-ES', 'es-US', 'es-MX', 'es'],
          'fr': ['fr-FR', 'fr-CA', 'fr'],
          'de': ['de-DE', 'de-AT', 'de'],
          'it': ['it-IT', 'it'],
          'pt': ['pt-BR', 'pt-PT', 'pt'],
          'ru': ['ru-RU', 'ru'],
          'ja': ['ja-JP', 'ja'],
          'ko': ['ko-KR', 'ko'],
          'ar': ['ar-SA', 'ar-EG', 'ar'],
          'hi': ['hi-IN', 'hi'],
        };

        if (fallbacks[targetLangBase]) {
          for (const fallback of fallbacks[targetLangBase]) {
            selectedVoice = voices.find(voice => {
              const voiceLang = voice.lang.toLowerCase();
              return voiceLang === fallback.toLowerCase() || voiceLang.startsWith(fallback.toLowerCase());
            });
            if (selectedVoice) break;
          }
        }
      }

      // Priority 5: Use any available voice as last resort
      if (!selectedVoice) {
        selectedVoice = voices[0];
      }
    }

    // Use the selected voice and set lang to match the voice
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang; // Set lang to match the selected voice
      console.log('Selected voice:', selectedVoice.name, 'voice lang:', selectedVoice.lang, 'target:', targetLang.value);
    } else {
      // No suitable voice found for the target language
      console.warn('No voice found for target language:', targetLang.value, 'trying server-side TTS');

      // Try server-side TTS for unsupported languages
      fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, language: targetLang.value })
      })
        .then(response => {
          if (response.ok && response.headers.get('content-type') === 'audio/mpeg') {
            // Server returned audio
            return response.blob().then(blob => {
              const audioUrl = URL.createObjectURL(blob);
              const audio = new Audio(audioUrl);
              audio.onended = () => {
                speakBtn.disabled = false;
                speakBtn.textContent = '🔊 Speak';
                URL.revokeObjectURL(audioUrl);
              };
              audio.onerror = () => {
                speakBtn.disabled = false;
                speakBtn.textContent = '🔊 Speak';
                showError('Failed to play server-generated audio');
              };
              audio.play();
              speakBtn.disabled = true;
              speakBtn.textContent = '🔊 Speaking...';
              showSuccess('Speaking with server-generated voice...');
            });
          } else {
            return response.json().then(data => {
              if (data.fallback) {
                // Server suggests using browser voices
                showError(`No voice available for ${getLanguageName(targetLang.value)}. Try listening on YouTube: https://www.youtube.com/results?search_query=${encodeURIComponent(getLanguageName(targetLang.value) + ' pronunciation')}`);
              } else {
                showError(data.error || 'Server TTS failed');
              }
            });
          }
        })
        .catch(error => {
          console.error('Server TTS error:', error);
          showError(`No voice available for ${getLanguageName(targetLang.value)}. Try listening on YouTube: https://www.youtube.com/results?search_query=${encodeURIComponent(getLanguageName(targetLang.value) + ' pronunciation')}`);
        })
        .finally(() => {
          speakBtn.disabled = false;
          speakBtn.textContent = '🔊 Speak';
        });

      return;
    }

    // Set speech parameters for smooth speaking
    utterance.pitch = 1.0;
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.volume = 1.0;

    // Language-specific adjustments for smoother speech
    const langSettings = {
      'zh': { rate: 0.7 },
      'zh-TW': { rate: 0.7 },
      'ja': { rate: 0.75 },
      'ko': { rate: 0.8 },
      'ar': { rate: 0.75 },
      'hi': { rate: 0.8 },
      'th': { rate: 0.75 },
      'vi': { rate: 0.85 },
      'en': { rate: 0.85 },
      'es': { rate: 0.8 },
      'fr': { rate: 0.8 },
      'de': { rate: 0.8 },
      'ru': { rate: 0.75 },
    };

    const languageCode = targetLang.value;
    if (langSettings[languageCode]) {
      utterance.rate = langSettings[languageCode].rate;
    }

    utterance.onstart = () => {
      speakBtn.disabled = true;
      speakBtn.textContent = '🔊 Speaking...';
      showSuccess('Speaking...');
    };

    utterance.onend = () => {
      speakBtn.disabled = false;
      speakBtn.textContent = '🔊 Speak';
    };

    utterance.onerror = (error) => {
      speakBtn.disabled = false;
      speakBtn.textContent = '🔊 Speak';
      console.error('Speech error:', error);

      // Retry once if voices weren't loaded properly
      if (retryCount < 1) {
        console.log('Retrying speech...');
        setTimeout(() => speakText(retryCount + 1), 500);
        return;
      }

      showError(`Speech error: ${error.error || 'Unknown error'}`);
    };

    // Speak the utterance
    try {
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Failed to speak:', error);

      // Retry once if initial speak failed
      if (retryCount < 1) {
        console.log('Retrying speech after error...');
        setTimeout(() => speakText(retryCount + 1), 500);
        return;
      }

      showError('Failed to start speech: ' + error.message);
      speakBtn.disabled = false;
      speakBtn.textContent = '🔊 Speak';
    }
  };

  // Check if voices are loaded, if not wait for them
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    // Voices not loaded yet, wait for them
    const handleVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      speakText();
    };
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);

    // Also set a timeout in case voiceschanged doesn't fire
    setTimeout(() => {
      if (window.speechSynthesis.getVoices().length > 0) {
        speakText();
      } else {
        showError('Speech voices not available. Please refresh the page and try again.');
        speakBtn.disabled = false;
        speakBtn.textContent = '🔊 Speak';
      }
    }, 2000);
  } else {
    speakText();
  }
});

// ===== CAMERA & OCR FUNCTIONALITY =====
const cameraBtn = document.getElementById('cameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const captureBtn = document.getElementById('capturePhotoBtn');
const retakeBtn = document.getElementById('retakePhotoBtn');
const extractBtn = document.getElementById('extractTextBtn');
const closeBtn = document.getElementById('closeCameraBtn');
const imagePreview = document.getElementById('imagePreview');
const ocrStatus = document.getElementById('ocrStatus');
const ocrStatusText = document.getElementById('ocrStatusText');

let mediaStream = null;
let capturedImageData = null;

// When source is from camera photo: store image + OCR lines for in-image translation
let photoTranslationSource = null;

// Shared OCR worker (reused for speed - avoids ~2-5s init per use)
let ocrWorker = null;
let ocrWorkerLang = null;
const OCR_LANG_MAP = {
  'es': 'spa', 'fr': 'fra', 'de': 'deu', 'it': 'ita', 'pt': 'por',
  'ru': 'rus', 'ja': 'jpn', 'ko': 'kor', 'zh': 'chi_sim', 'zh-CN': 'chi_sim', 'zh-TW': 'chi_tra', 'ar': 'ara',
  'hi': 'hin', 'th': 'tha', 'vi': 'vie', 'tr': 'tur', 'pl': 'pol',
  'nl': 'nld', 'sv': 'swe', 'da': 'dan', 'fi': 'fin', 'no': 'nor',
  'el': 'ell', 'cs': 'ces', 'hu': 'hun', 'ro': 'ron', 'uk': 'ukr'
};
const MAX_OCR_DIM = 800; // Downscale for faster OCR (smaller = quicker)

async function getOcrWorker(ocrLang) {
  if (ocrWorker && ocrWorkerLang === ocrLang) return ocrWorker;
  if (!ocrWorker) {
    const { createWorker } = Tesseract;
    ocrWorker = await createWorker();
  }
  await ocrWorker.loadLanguage(ocrLang);
  await ocrWorker.initialize(ocrLang);
  ocrWorkerLang = ocrLang;
  return ocrWorker;
}

// Extract text from PDF using PDF.js + Tesseract (for scanned/image-based PDFs)
async function extractPdfWithOcr(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const ocrLang = getOcrLang();
  const worker = await getOcrWorker(ocrLang);
  const texts = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    const imgForOcr = await downscaleForOcr(imgData);
    const { data: { text } } = await worker.recognize(imgForOcr);
    if (text && text.trim()) texts.push(text.trim());
  }
  return normalizeExtractedText(texts.join('\n\n'));
}

function normalizeExtractedText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function downscaleForOcr(imgSrc, maxDim = MAX_OCR_DIM) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) {
        resolve(imgSrc);
        return;
      }
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

// Returns { dataUrl, width, height } for OCR (used so we can scale bboxes back to original image)
function downscaleForOcrWithDimensions(imgSrc, maxDim = MAX_OCR_DIM) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const origW = w, origH = h;
      if (w <= maxDim && h <= maxDim) {
        resolve({ dataUrl: imgSrc, width: w, height: h, origWidth: origW, origHeight: origH });
        return;
      }
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.85), width: w, height: h, origWidth: origW, origHeight: origH });
    };
    img.onerror = () => resolve({ dataUrl: imgSrc, width: 0, height: 0, origWidth: 0, origHeight: 0 });
    img.src = imgSrc;
  });
}

function getOcrLang() {
  const v = sourceLang?.value;
  return OCR_LANG_MAP[v] || OCR_LANG_MAP[v?.slice(0, 2)] || 'eng';
}

// Render photo with original image and translated text overlaid (only text replaced)
function renderTranslatedPhoto(imageDataUrl, linesWithTranslatedText, ocrW, ocrH, origW, origH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scaleX = origW / ocrW;
      const scaleY = origH / ocrH;
      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.textBaseline = 'top';

      const padding = 2;
      linesWithTranslatedText.forEach(({ translatedText: lineText, bbox }) => {
        if (!bbox || !lineText) return;
        const x0 = Math.max(0, bbox.x0 * scaleX - padding);
        const y0 = Math.max(0, bbox.y0 * scaleY - padding);
        const x1 = Math.min(origW, bbox.x1 * scaleX + padding);
        const y1 = Math.min(origH, bbox.y1 * scaleY + padding);
        const w = x1 - x0;
        const h = y1 - y0;
        const fontSize = Math.max(10, Math.min(h * 0.95, 64));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x0, y0, w, h);
        ctx.fillStyle = '#000000';
        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.fillText(lineText, x0 + padding, y0 + padding);
      });

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

// Pre-load OCR worker when modal opens (makes Extract click feel instant)
function preloadOcrWorker() {
  getOcrWorker(getOcrLang()).catch(() => { });
}

// Open camera modal
cameraBtn.addEventListener('click', async () => {
  preloadOcrWorker();
  cameraModal.classList.remove('hidden');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    cameraVideo.srcObject = mediaStream;
    cameraVideo.style.display = 'block';
    imagePreview.classList.add('hidden');
    captureBtn.classList.remove('hidden');
    retakeBtn.classList.add('hidden');
    extractBtn.classList.add('hidden');
    showSuccess('Camera ready. Take a photo!');
  } catch (err) {
    showError('Camera access denied or unavailable: ' + err.message);
    cameraModal.classList.add('hidden');
  }
});

// Capture photo from video
captureBtn.addEventListener('click', () => {
  const canvas = document.getElementById('captureCanvas');
  const ctx = canvas.getContext('2d');

  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;

  ctx.drawImage(cameraVideo, 0, 0);
  capturedImageData = canvas.toDataURL('image/jpeg');

  // Show preview
  imagePreview.src = capturedImageData;
  imagePreview.classList.remove('hidden');

  // Hide video, show retake and extract
  cameraVideo.style.display = 'none';
  captureBtn.classList.add('hidden');
  retakeBtn.classList.remove('hidden');
  extractBtn.classList.remove('hidden');

  showSuccess('Photo captured! Extract text or retake.');
});

// Retake photo
retakeBtn.addEventListener('click', () => {
  capturedImageData = null;
  cameraVideo.style.display = 'block';
  imagePreview.classList.add('hidden');
  captureBtn.classList.remove('hidden');
  retakeBtn.classList.add('hidden');
  extractBtn.classList.add('hidden');
  ocrStatus.classList.add('hidden');
});

// Extract text using Tesseract OCR; store lines + image for in-photo translation
extractBtn.addEventListener('click', async () => {
  if (!capturedImageData) {
    showError('No image captured');
    return;
  }

  ocrStatus.classList.remove('hidden');
  extractBtn.disabled = true;

  try {
    const ocrLang = getOcrLang();
    ocrStatusText.textContent = `Extracting text (${ocrLang})...`;

    const worker = await getOcrWorker(ocrLang);
    const { dataUrl, width: ocrW, height: ocrH, origWidth: origW, origHeight: origH } = await downscaleForOcrWithDimensions(capturedImageData);
    const { data } = await worker.recognize(dataUrl);

    const text = (data.text || '').trim();
    if (text) {
      sourceText.value = normalizeExtractedText(text);
      ocrStatusText.textContent = 'Text extracted successfully!';
      showSuccess('Text extracted and inserted!');

      let lines = (data.lines || []).filter(l => l.text && l.bbox).map(l => ({ text: l.text.trim(), bbox: l.bbox }));
      if (lines.length === 0 && data.words && data.words.length > 0) {
        const words = data.words.filter(w => w.text && w.bbox).map(w => ({ text: w.text.trim(), bbox: w.bbox, y0: w.bbox.y0 }));
        const lineThreshold = 8;
        const lineGroups = [];
        words.forEach(w => {
          const line = lineGroups.find(l => Math.abs(l.y0 - w.y0) < lineThreshold);
          if (line) {
            line.text += ' ' + w.text;
            line.bbox = { x0: Math.min(line.bbox.x0, w.bbox.x0), y0: Math.min(line.bbox.y0, w.bbox.y0), x1: Math.max(line.bbox.x1, w.bbox.x1), y1: Math.max(line.bbox.y1, w.bbox.y1) };
          } else {
            lineGroups.push({ text: w.text, bbox: { ...w.bbox }, y0: w.y0 });
          }
        });
        lines = lineGroups.map(l => ({ text: l.text.trim(), bbox: l.bbox }));
      }
      if (lines.length > 0 && origW > 0 && origH > 0) {
        photoTranslationSource = {
          imageDataUrl: capturedImageData,
          lines,
          ocrWidth: ocrW,
          ocrHeight: ocrH,
          origWidth: origW,
          origHeight: origH
        };
      } else {
        photoTranslationSource = null;
      }
      setTimeout(closeCamera, 700);
    } else {
      photoTranslationSource = null;
      showError('No text found in image. Try a clearer photo.');
      ocrStatusText.textContent = 'No text detected';
    }
  } catch (err) {
    photoTranslationSource = null;
    console.error('OCR Error:', err);
    showError('OCR processing failed: ' + err.message);
    ocrStatusText.textContent = 'Error processing image';
  } finally {
    extractBtn.disabled = false;
  }
});

// Close camera modal
function closeCamera() {
  cameraModal.classList.add('hidden');
  ocrStatus.classList.add('hidden');

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  capturedImageData = null;
  cameraVideo.style.display = 'block';
  cameraVideo.srcObject = null;
}

closeBtn.addEventListener('click', closeCamera);

// Close modal on background click
cameraModal.addEventListener('click', (e) => {
  if (e.target === cameraModal) {
    closeCamera();
  }
});

// ===== END CAMERA & OCR FUNCTIONALITY =====

// ===== DOCUMENT INPUT FUNCTIONALITY =====
const documentBtn = document.getElementById('documentBtn');
const documentInput = document.getElementById('documentInput');
const documentModal = document.getElementById('documentModal');
const documentDropZone = document.getElementById('documentDropZone');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const extractDocumentBtn = document.getElementById('extractDocumentBtn');
const documentPreview = document.getElementById('documentPreview');
const documentPreviewImg = document.getElementById('documentPreviewImg');
const translatedDocumentWrap = document.getElementById('translatedDocumentWrap');
const translatedDocumentPreview = document.getElementById('translatedDocumentPreview');
const downloadDocumentBtn = document.getElementById('downloadDocumentBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

// Document translation state (stores image + OCR data for layout-preserving translation)
let documentTranslationSource = null;

// Close document modal functions
function closeDocumentModal() {
  if (documentModal) documentModal.classList.add('hidden');
  if (documentStatus) documentStatus.classList.add('hidden');
  selectedFile = null;
  if (fileInfo) fileInfo.classList.add('hidden');
  if (extractDocumentBtn) extractDocumentBtn.classList.add('hidden');
  if (documentInput) documentInput.value = '';
  if (documentPreview) documentPreview.classList.add('hidden');
}

const closeDocumentBtn = document.getElementById('closeDocumentBtn');
const closeDocumentModalBtn = document.getElementById('closeDocumentModalBtn');

// Add event listeners for close buttons
if (closeDocumentBtn) {
  closeDocumentBtn.addEventListener('click', closeDocumentModal);
}

if (closeDocumentModalBtn) {
  closeDocumentModalBtn.addEventListener('click', closeDocumentModal);
}

// Close modal on background click
if (documentModal) {
  documentModal.addEventListener('click', (e) => {
    if (e.target === documentModal) {
      closeDocumentModal();
    }
  });
}
const documentStatus = document.getElementById('documentStatus');
const documentStatusText = document.getElementById('documentStatusText');

let selectedFile = null;

// Open document modal
documentBtn.addEventListener('click', () => {
  documentModal.classList.remove('hidden');
  selectedFile = null;
  fileInfo.classList.add('hidden');
  extractDocumentBtn.classList.add('hidden');
  documentStatus.classList.add('hidden');
  if (documentPreview) documentPreview.classList.add('hidden');
  preloadOcrWorker();
});

// Click to browse files
documentDropZone.addEventListener('click', () => {
  documentInput.click();
});

// Handle file selection from input
documentInput.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length > 0) {
    handleFileSelect(files[0]);
  }
});

// Drag and drop functionality
documentDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  documentDropZone.classList.add('dragover');
});

documentDropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  documentDropZone.classList.remove('dragover');
});

documentDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  documentDropZone.classList.remove('dragover');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileSelect(files[0]);
  }
});

// Handle file selection
function handleFileSelect(file) {
  // Validate file type: documents (PDF, DOCX, PPT, TXT) and images (for OCR incl. handwritten)
  const allowedExtensions = ['.txt', '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

  const fileExtension = '.' + file.name.split('.').pop().toLowerCase();

  if (!allowedExtensions.includes(fileExtension)) {
    showError('Invalid file type. Please upload .txt, .pdf, .docx, .pptx, .ppt, or image files (JPG, PNG, etc.).');
    return;
  }

  // Validate file size (max 50MB)
  if (file.size > 50 * 1024 * 1024) {
    showError('File size exceeds 50MB limit.');
    return;
  }

  selectedFile = file;

  // Show file info
  fileName.textContent = file.name;
  fileSize.textContent = `Size: ${(file.size / 1024).toFixed(2)} KB`;
  fileInfo.classList.remove('hidden');
  extractDocumentBtn.classList.remove('hidden');

  const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(fileExtension);
  const message = isImage ? 'Image selected! Click "Extract Text" to process with OCR.' : 'File selected! Click "Extract Text" to process.';
  showSuccess(message);
  if (isImage) preloadOcrWorker();
}

// Render PDF page to canvas and return image data URL
async function renderPdfPageToCanvas(file, pageNum = 1) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNum);
  const scale = 2; // High resolution for OCR quality
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: viewport.width,
    height: viewport.height,
    numPages: pdf.numPages
  };
}

// Extract text with bounding boxes for layout-preserving translation
async function extractTextWithPositions(imageDataUrl, ocrLang) {
  const worker = await getOcrWorker(ocrLang);
  const { dataUrl, width: ocrW, height: ocrH, origWidth, origHeight } = await downscaleForOcrWithDimensions(imageDataUrl);
  const { data } = await worker.recognize(dataUrl);

  // Extract lines with bounding boxes
  let lines = (data.lines || []).filter(l => l.text && l.bbox).map(l => ({
    text: l.text.trim(),
    bbox: l.bbox
  }));

  // Fallback: group words into lines if no lines detected
  if (lines.length === 0 && data.words && data.words.length > 0) {
    const words = data.words.filter(w => w.text && w.bbox);
    const lineThreshold = 8;
    const lineGroups = [];
    words.forEach(w => {
      const line = lineGroups.find(l => Math.abs(l.y0 - w.bbox.y0) < lineThreshold);
      if (line) {
        line.text += ' ' + w.text.trim();
        line.bbox = {
          x0: Math.min(line.bbox.x0, w.bbox.x0),
          y0: Math.min(line.bbox.y0, w.bbox.y0),
          x1: Math.max(line.bbox.x1, w.bbox.x1),
          y1: Math.max(line.bbox.y1, w.bbox.y1)
        };
      } else {
        lineGroups.push({ text: w.text.trim(), bbox: { ...w.bbox }, y0: w.bbox.y0 });
      }
    });
    lines = lineGroups.map(l => ({ text: l.text, bbox: l.bbox }));
  }

  return { lines, ocrWidth: ocrW, ocrHeight: ocrH, origWidth, origHeight, fullText: (data.text || '').trim() };
}

// Render translated document with text overlay (preserves layout)
function renderTranslatedDocument(imageDataUrl, linesWithTranslatedText, ocrW, ocrH, origW, origH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scaleX = origW / ocrW;
      const scaleY = origH / ocrH;
      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');

      // Draw original image
      ctx.drawImage(img, 0, 0, origW, origH);
      ctx.textBaseline = 'top';

      const padding = 4;
      linesWithTranslatedText.forEach(({ translatedText: lineText, bbox }) => {
        if (!bbox || !lineText) return;

        const x0 = Math.max(0, bbox.x0 * scaleX - padding);
        const y0 = Math.max(0, bbox.y0 * scaleY - padding);
        const x1 = Math.min(origW, bbox.x1 * scaleX + padding);
        const y1 = Math.min(origH, bbox.y1 * scaleY + padding);
        const w = x1 - x0;
        const h = y1 - y0;

        // Dynamically size font to fit in bounding box
        let fontSize = Math.max(10, Math.min(h * 0.85, 48));
        ctx.font = `${fontSize}px Arial, sans-serif`;

        // Shrink font if text is too wide
        while (ctx.measureText(lineText).width > w - padding * 2 && fontSize > 8) {
          fontSize -= 1;
          ctx.font = `${fontSize}px Arial, sans-serif`;
        }

        // White background to cover original text
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x0, y0, w, h);

        // Draw translated text
        ctx.fillStyle = '#000000';
        ctx.fillText(lineText, x0 + padding, y0 + padding);
      });

      resolve(canvas.toDataURL('image/png', 1.0));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

// Prepare document for translation (extract text with positions, store for translation phase)
extractDocumentBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    showError('No file selected');
    return;
  }

  documentStatus.classList.remove('hidden');
  extractDocumentBtn.disabled = true;
  documentStatusText.textContent = 'Processing document...';

  try {
    const fileExtension = '.' + selectedFile.name.split('.').pop().toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(fileExtension);
    const isPdf = fileExtension === '.pdf';

    let imageDataUrl, ocrData;
    const ocrLang = getOcrLang();

    if (isImage) {
      // Read image file
      documentStatusText.textContent = 'Reading image...';
      const reader = new FileReader();
      imageDataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(selectedFile);
      });
    } else if (isPdf) {
      // Render first page of PDF to image
      documentStatusText.textContent = 'Rendering PDF...';
      const pdfResult = await renderPdfPageToCanvas(selectedFile, 1);
      imageDataUrl = pdfResult.dataUrl;

      if (pdfResult.numPages > 1) {
        showSuccess(`Note: Multi-page PDF detected. Currently processing page 1 of ${pdfResult.numPages}.`);
      }
    } else if (fileExtension === '.txt') {
      // TXT: Client-side extraction
      documentStatusText.textContent = 'Reading text file...';
      const text = await selectedFile.text();
      if (text && text.trim()) {
        photoTranslationSource = null;
        documentTranslationSource = null;
        sourceText.value = normalizeExtractedText(text);
        showSuccess('Text extracted! Click Translate to convert.');
        setTimeout(closeDocumentModal, 700);
      } else {
        showError('File is empty.');
        documentStatusText.textContent = 'No text found';
      }
      return;
    } else {
      // DOCX/PPT: Requires server, but user wants "No API / Client-Side only"
      // Suggest converting to PDF or using Image
      showError('For client-side extraction (No API mode), please use PDF, Image, or Text files. DOCX/PPT requires server processing.');
      documentStatusText.textContent = 'File type not supported in offline mode';
      return;
    }

    // Extract text with positions using OCR
    documentStatusText.textContent = `Analyzing document layout (${ocrLang})...`;
    ocrData = await extractTextWithPositions(imageDataUrl, ocrLang);

    if (!ocrData.fullText || ocrData.lines.length === 0) {
      showError('No text found in document. Try a clearer image.');
      documentStatusText.textContent = 'No text detected';
      return;
    }

    // Store for translation phase
    documentTranslationSource = {
      imageDataUrl,
      lines: ocrData.lines,
      ocrWidth: ocrData.ocrWidth,
      ocrHeight: ocrData.ocrHeight,
      origWidth: ocrData.origWidth,
      origHeight: ocrData.origHeight,
      fileName: selectedFile.name
    };

    // Show preview in source text and display extracted text
    photoTranslationSource = null;
    sourceText.value = ocrData.lines.map(l => l.text).join('\n');

    // Show preview image in modal
    if (documentPreviewImg && documentPreview) {
      documentPreviewImg.src = imageDataUrl;
      documentPreview.classList.remove('hidden');
    }

    documentStatusText.textContent = 'Ready! Click Translate to preserve layout.';
    showSuccess('Document prepared! Select target language and click Translate.');
    setTimeout(closeDocumentModal, 1000);

  } catch (err) {
    console.error('Document processing error:', err);
    showError('Processing failed: ' + (err.message || err));
    documentStatusText.textContent = 'Error';
    documentTranslationSource = null;
  } finally {
    extractDocumentBtn.disabled = false;
  }
});

// ===== DOCUMENT DOWNLOAD FUNCTIONALITY =====

// Download translated document as PNG image
if (downloadDocumentBtn) {
  downloadDocumentBtn.addEventListener('click', () => {
    if (!documentTranslationSource || !documentTranslationSource.translatedDataUrl) {
      showError('No translated document available. Please translate a document first.');
      return;
    }

    const link = document.createElement('a');
    const originalName = documentTranslationSource.fileName || 'document';
    const baseName = originalName.replace(/\.[^/.]+$/, '');
    link.download = `${baseName}_translated.png`;
    link.href = documentTranslationSource.translatedDataUrl;
    link.click();
    showSuccess('Document downloaded as PNG image!');
  });
}

// Download translated document as PDF
if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener('click', async () => {
    if (!documentTranslationSource || !documentTranslationSource.translatedDataUrl) {
      showError('No translated document available. Please translate a document first.');
      return;
    }

    try {
      // Create PDF from image using canvas
      const img = new Image();
      img.src = documentTranslationSource.translatedDataUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Create canvas for PDF
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Convert to blob and download as PDF-like image
      // Note: For true PDF, would need jsPDF library. Using high-quality PNG for now.
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      const originalName = documentTranslationSource.fileName || 'document';
      const baseName = originalName.replace(/\.[^/.]+$/, '');
      link.download = `${baseName}_translated.pdf.png`;
      link.href = url;
      link.click();

      URL.revokeObjectURL(url);
      showSuccess('Document downloaded! (Save as PDF from your image viewer for best compatibility)');
    } catch (err) {
      console.error('PDF download error:', err);
      showError('Download failed: ' + (err.message || err));
    }
  });
}

// ===== MUSIC/VIDEO INPUT - Upload & transcribe OR live voice =====
const musicVideoBtn = document.getElementById('musicVideoBtn');
const musicVideoModal = document.getElementById('musicVideoModal');
const musicVideoVoiceBtn = document.getElementById('musicVideoVoiceBtn');
const musicVideoDropZone = document.getElementById('musicVideoDropZone');
const musicVideoInput = document.getElementById('musicVideoInput');
const musicVideoFileInfo = document.getElementById('musicVideoFileInfo');
const musicVideoFileName = document.getElementById('musicVideoFileName');
const musicVideoFileSize = document.getElementById('musicVideoFileSize');
const musicVideoExtractBtn = document.getElementById('musicVideoExtractBtn');
const musicVideoStatus = document.getElementById('musicVideoStatus');
const musicVideoStatusText = document.getElementById('musicVideoStatusText');

let selectedMusicFile = null;

function closeMusicVideoModal() {
  if (musicVideoModal) musicVideoModal.classList.add('hidden');
  selectedMusicFile = null;
  if (musicVideoFileInfo) musicVideoFileInfo.classList.add('hidden');
  if (musicVideoExtractBtn) musicVideoExtractBtn.classList.add('hidden');
  if (musicVideoStatus) musicVideoStatus.classList.add('hidden');
  if (musicVideoInput) musicVideoInput.value = '';
}

if (musicVideoBtn) musicVideoBtn.addEventListener('click', () => {
  if (musicVideoModal) musicVideoModal.classList.remove('hidden');
});

document.getElementById('closeMusicVideoBtn')?.addEventListener('click', closeMusicVideoModal);
document.getElementById('closeMusicVideoModalBtn')?.addEventListener('click', closeMusicVideoModal);
musicVideoModal?.addEventListener('click', (e) => { if (e.target === musicVideoModal) closeMusicVideoModal(); });

// Upload: click to browse
musicVideoDropZone?.addEventListener('click', () => musicVideoInput?.click());
musicVideoInput?.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) {
    selectedMusicFile = f;
    if (musicVideoFileName) musicVideoFileName.textContent = f.name;
    if (musicVideoFileSize) musicVideoFileSize.textContent = `Size: ${(f.size / 1024).toFixed(2)} KB`;
    if (musicVideoFileInfo) musicVideoFileInfo.classList.remove('hidden');
    if (musicVideoExtractBtn) musicVideoExtractBtn.classList.remove('hidden');
  }
});

// Drag and drop
musicVideoDropZone?.addEventListener('dragover', (e) => { e.preventDefault(); musicVideoDropZone?.classList.add('dragover'); });
musicVideoDropZone?.addEventListener('dragleave', (e) => { e.preventDefault(); musicVideoDropZone?.classList.remove('dragover'); });
musicVideoDropZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  musicVideoDropZone?.classList.remove('dragover');
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.(mp3|wav|mp4|webm|m4a|ogg|aac)$/i.test(f.name)) {
    selectedMusicFile = f;
    if (musicVideoFileName) musicVideoFileName.textContent = f.name;
    if (musicVideoFileSize) musicVideoFileSize.textContent = `Size: ${(f.size / 1024).toFixed(2)} KB`;
    if (musicVideoFileInfo) musicVideoFileInfo.classList.remove('hidden');
    if (musicVideoExtractBtn) musicVideoExtractBtn.classList.remove('hidden');
  } else if (f) {
    showError('Use MP3, WAV, MP4, WebM, M4A, OGG, or AAC files.');
  }
});

// Extract & transcribe (Simulation for "No API" mode as requested)
// Extract & transcribe (Simulation for "No API" mode as requested)
musicVideoExtractBtn?.addEventListener('click', async () => {
  if (!selectedMusicFile) { showError('No file selected'); return; }

  const dubbingProcessUI = document.getElementById('dubbingProcessUI');
  const progressSeparation = document.getElementById('progressSeparation');
  const progressCloning = document.getElementById('progressCloning');
  const progressDubbing = document.getElementById('progressDubbing');
  const dubbingPlayerContainer = document.getElementById('dubbingPlayerContainer');
  const dubbingVideoPreview = document.getElementById('dubbingVideoPreview');
  const dubbingAudioPreview = document.getElementById('dubbingAudioPreview');
  const dubbingAudio = document.getElementById('dubbingAudio');

  // Reset UI
  musicVideoExtractBtn.disabled = true;
  musicVideoExtractBtn.classList.add('hidden');
  document.getElementById('musicVideoDropZone').classList.add('hidden');
  dubbingProcessUI.classList.remove('hidden');
  dubbingPlayerContainer.classList.add('hidden');

  // Helper for progress animation
  const animateProgress = (bar, duration) => {
    return new Promise(resolve => {
      let width = 0;
      const interval = setInterval(() => {
        width += 2;
        bar.style.width = width + '%';
        if (width >= 100) {
          clearInterval(interval);
          resolve();
        }
      }, duration / 50);
    });
  };

  try {
    // Step 1: Separate Vocals
    await animateProgress(progressSeparation, 200);

    // Step 2: Clone Voice (Analyze pitch/tone)
    // Real Analysis: specific logic to guess pitch
    const pitchType = await analyzeAudioPitch(selectedMusicFile);
    await animateProgress(progressCloning, 200);

    // Step 3: Transcribe, Translate & Synthesize All-in-One
    let dubbedAudioUrl = null;
    const targetLangElem = document.getElementById('targetLang');
    const currentTargetLang = targetLangElem && targetLangElem.value ? targetLangElem.value : 'es';

    try {
      showSuccess('Processing: transcribing, translating & synthesizing audio...');
      const formData = new FormData();
      formData.append('media', selectedMusicFile);
      formData.append('targetLanguage', currentTargetLang);

      const dubResp = await fetch('/api/dub-media', {
        method: 'POST',
        body: formData
      });

      if (!dubResp.ok) {
        const errData = await dubResp.json();
        throw new Error(errData.error || 'Dubbing failed');
      }

      // Get the dubbed audio blob
      const audioBlob = await dubResp.blob();
      dubbedAudioUrl = URL.createObjectURL(audioBlob);
      showSuccess('Dubbing complete! Playing dubbed audio...');

    } catch (e) {
      console.warn('Backend dubbing failed:', e);
      showError('Dubbing failed: ' + e.message);
      throw e;
    }

    // Simulate dubbing synthesis time
    await animateProgress(progressDubbing, 200);

    // Step 4: Ready to Play
    dubbingProcessUI.classList.add('hidden');
    dubbingPlayerContainer.classList.remove('hidden');

    // Setup Media Player with separate tracks
    const fileUrl = URL.createObjectURL(selectedMusicFile);
    const isVideo = selectedMusicFile.type.startsWith('video');

    if (isVideo) {
      dubbingVideoPreview.src = fileUrl;
      dubbingVideoPreview.classList.remove('hidden');
      dubbingAudioPreview.classList.add('hidden');
      dubbingAudio.src = dubbedAudioUrl; // Dubbed audio track

      // Sync logic for Video: Play dubbed audio when video plays
      dubbingVideoPreview.onplay = () => {
        dubbingAudio.play().catch(e => console.warn('Auto-play blocked:', e));
      };
      dubbingVideoPreview.onpause = () => dubbingAudio.pause();
      dubbingVideoPreview.onended = () => dubbingAudio.pause();
      // Ducking: Lower original volume to make dubbed audio more prominent
      dubbingVideoPreview.volume = 0.15;
      dubbingAudio.volume = 0.85;
    } else {
      dubbingAudioPreview.src = dubbedAudioUrl; // Play dubbed audio directly
      dubbingAudioPreview.classList.remove('hidden');
      dubbingVideoPreview.classList.add('hidden');
    }

    showSuccess('Dubbing complete! Ready to play in ' + currentTargetLang);

  } catch (err) {
    showError('Dubbing failed: ' + err.message);
    musicVideoExtractBtn.disabled = false;
    musicVideoExtractBtn.classList.remove('hidden');
    document.getElementById('musicVideoDropZone').classList.remove('hidden');
    dubbingProcessUI.classList.add('hidden');
  }
});

// Helper: Measure average pitch to guess voice type
async function analyzeAudioPitch(file) {
  try {
    const arrayBuffer = await file.slice(0, 1024 * 1024).arrayBuffer(); // Analyze first 1MB
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

    // Simple Zero-Crossing Rate (ZCR) approximation for fundamental frequency
    let zeroCrossings = 0;
    for (let i = 1; i < channelData.length; i++) {
      if ((channelData[i] >= 0 && channelData[i - 1] < 0) || (channelData[i] < 0 && channelData[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const duration = audioBuffer.duration;
    const freq = (zeroCrossings / 2) / duration;

    audioCtx.close();

    // Heuristic: Male < 160Hz approx, Female > 160Hz
    return freq > 160 ? 'High/Female' : 'Low/Male';
  } catch (e) {
    console.warn('Audio analysis failed, defaulting to Neutral', e);
    return 'Neutral';
  }
}

// Helper to speak dubbed audio with Voice Matching
function speakDubbedAudio(text, mediaElement, pitchType = 'Neutral', targetLang = 'en') {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  const voices = window.speechSynthesis.getVoices();
  let selectedVoice = null;
  const targetLangBase = targetLang.split('-')[0].toLowerCase();

  // Filter voices by target language first
  const langVoices = voices.filter(v =>
    v.lang.toLowerCase().startsWith(targetLangBase) ||
    v.lang.toLowerCase().includes(targetLangBase)
  );

  if (langVoices.length > 0) {
    // 1. Try to match Gender/Pitch within the target language
    if (pitchType === 'High/Female') {
      selectedVoice = langVoices.find(v => v.name.includes('Female') || v.name.includes('Woman') || v.name.includes('Zira') || v.name.includes('Google US English')); // 'Google US English' is often female-sounding default if no better match, but restricted to langVoices it might not be there. Better to trust name.
      if (!selectedVoice) selectedVoice = langVoices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman'));

      if (!selectedVoice) utterance.pitch = 1.2; // Artificial pitch up if gender match fail but we have lang voice
    } else if (pitchType === 'Low/Male') {
      selectedVoice = langVoices.find(v => v.name.includes('Male') || v.name.includes('Man') || v.name.includes('David'));
      if (!selectedVoice) selectedVoice = langVoices.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man'));

      if (!selectedVoice) utterance.pitch = 0.9; // Artificial pitch down if gender match fail
    }

    // 2. Fallback to any voice in that language if no specific gender match found
    if (!selectedVoice) {
      // Prefer "Google" or "Microsoft" voices as they are usually higher quality
      selectedVoice = langVoices.find(v => v.name.includes('Google') || v.name.includes('Microsoft')) || langVoices[0];
    }
  } else {
    // Fallback if language not found (shouldn't happen often if we support the lang)
    console.warn(`No voice found for language ${targetLang}, falling back to default.`);
    // Try to find ANY voice that might match? No, just use default but maybe log it.
  }

  // If we found a voice (either gendered or just lang-matched), use it.
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else {
    // Absolute fallback for safety
    // If we didn't find a lang match, we might still want to apply pitch to the default voice? 
    // But the default voice is likely English, which is the whole problem.
    // Let's at least try to set the lang property on the utterance so the browser *might* try to find a matching engine on the fly.
    utterance.lang = targetLang;
  }

  utterance.rate = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
}

// Or use Live Voice Input
if (musicVideoVoiceBtn && voiceBtn) {
  musicVideoVoiceBtn.addEventListener('click', () => {
    closeMusicVideoModal();
    voiceBtn.click();
  });
}



function hideMessages() {
  if (errorBox) errorBox.classList.add('hidden');
  if (successBox) successBox.classList.add('hidden');
}

function showLoading(show) {
  if (show) {
    loading.classList.remove('hidden');
    translateBtn.disabled = true;
  } else {
    loading.classList.add('hidden');
    translateBtn.disabled = false;
  }
}
