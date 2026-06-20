const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { LANGUAGES } = require('./public/languages.js');

// Google Cloud TTS (optional)
let textToSpeech = null;
try {
  textToSpeech = require('@google-cloud/text-to-speech');
} catch (e) {
  console.log('Google Cloud TTS not available - using browser voices only');
}

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client using environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Supabase client initialized');
} else {
  console.warn('SUPABASE_URL or SUPABASE_KEY not set. Supabase disabled.');
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const fileName = file.originalname.toLowerCase();
    const allowed = ['.txt', '.pdf', '.docx', '.doc', '.pptx', '.ppt'];
    if (allowed.some(ext => fileName.endsWith(ext))) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Use TXT, PDF, DOCX, PPT, or image files.'));
    }
  }
});

// Multer for audio/video (music-video feature)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const fileName = file.originalname.toLowerCase();
    const allowed = ['.mp3', '.wav', '.mp4', '.webm', '.m4a', '.ogg', '.aac'];
    if (allowed.some(ext => fileName.endsWith(ext))) cb(null, true);
    else cb(new Error('Invalid file type. Use MP3, WAV, MP4, WebM, M4A.'));
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Google Translate API function using Google Translate free endpoint
async function translateText(text, targetLang, sourceLang = 'auto') {
  return new Promise((resolve, reject) => {
    try {
      // Use Google Translate API via a simple HTTPS request
      const encodedText = encodeURIComponent(text);
      const sourceLangCode = sourceLang === 'auto' ? 'auto' : sourceLang;

      // Using Google's free translate endpoint
      const url = `https://translate.googleapis.com/translate_a/element.js?cb=googleTranslateElementInit&client=gtx`;

      // Alternative: Use a simple fetch to Google Translate
      const googleTranslateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLangCode}&tl=${targetLang}&dt=t&q=${encodedText}`;

      const request = https.get(googleTranslateUrl, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            // Parse the response
            const result = JSON.parse(data);
            // The translation is in the first element of the array
            if (result && result[0] && result[0][0]) {
              const translatedText = result[0].map(item => item[0]).join('');
              resolve(translatedText);
            } else {
              reject(new Error('Invalid translation response'));
            }
          } catch (e) {
            reject(new Error('Failed to parse translation response'));
          }
        });
      });

      request.on('error', (e) => {
        reject(e);
      });

      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Translation request timeout'));
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Translation API endpoint
app.post('/api/translate', async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body;

    if (!text || !targetLang) {
      return res.status(400).json({
        error: 'Text and target language are required'
      });
    }

    // If source language is not specified or is same as target, skip translation
    if (sourceLang === targetLang) {
      return res.json({
        translatedText: text,
        sourceLang: sourceLang,
        targetLang: targetLang
      });
    }

    try {
      // Perform translation using Google Translate
      const translatedText = await translateText(text, targetLang, sourceLang || 'auto');

      res.json({
        translatedText: translatedText,
        sourceLang: sourceLang || 'auto',
        targetLang: targetLang
      });
    } catch (translationError) {
      console.error('Translation error:', translationError);
      res.status(500).json({
        error: 'Translation failed. Please check the language codes and try again.',
        details: translationError.message
      });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Function to extract text from PDF
async function extractTextFromPDF(fileBuffer) {
  try {
    const data = await pdfParse(fileBuffer);
    return data.text;
  } catch (error) {
    // Fallback: try a basic binary extraction
    try {
      const text = fileBuffer.toString('binary');
      const matches = text.match(/\((.*?)\)/g) || [];
      let extractedText = matches.map(m => m.slice(1, -1)).join(' ').trim();
      if (extractedText.length === 0) {
        throw new Error('PDF parsing failed - no text could be extracted. The PDF might be image-based or encrypted.');
      }
      return extractedText;
    } catch (fallbackError) {
      throw new Error('Failed to parse PDF: ' + error.message);
    }
  }
}

// Function to extract text from DOCX
async function extractTextFromDOCX(fileBuffer) {
  try {
    // For DOCX files, we use a simpler approach by reading XML content
    const JSZip = require('jszip');
    const zip = new JSZip();
    await zip.loadAsync(fileBuffer);

    // Check if document.xml exists
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      // Try alternate location or assume it's an old .doc format
      throw new Error('Invalid DOCX file: document.xml not found');
    }

    // Extract text from document.xml
    const docXml = await docFile.async('string');

    // Remove XML tags and get plain text
    let text = docXml
      .replace(/<\/w:p>/g, '\n') // Add line breaks for paragraphs
      .replace(/<[^>]*>/g, '') // Remove all XML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n\n+/g, '\n') // Remove extra blank lines
      .trim();

    return text;
  } catch (error) {
    // For .doc files or corrupted DOCX files, try basic text extraction
    try {
      const text = fileBuffer.toString('binary').match(/[\x20-\x7E]+/g);
      if (text && text.join(' ').length > 10) {
        return text.join(' ');
      }
      throw new Error('Failed to parse DOCX: ' + error.message);
    } catch {
      throw new Error('Failed to parse DOCX: ' + error.message);
    }
  }
}

// Function to extract text from plain text file
async function extractTextFromTXT(fileBuffer) {
  try {
    return fileBuffer.toString('utf-8');
  } catch (error) {
    throw new Error('Failed to read text file: ' + error.message);
  }
}

// Function to extract text from PowerPoint PPTX
async function extractTextFromPPTX(fileBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fileBuffer);
    const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });

    const texts = [];
    for (const slidePath of slideFiles) {
      const slideXml = await zip.file(slidePath).async('string');
      // Extract text from <a:t> elements (PowerPoint text nodes)
      const matches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (matches) {
        texts.push(matches.map(m => m.replace(/<\/?a:t>/g, '')).join(' '));
      }
    }
    return texts.join('\n\n').trim();
  } catch (error) {
    throw new Error('Failed to parse PPTX: ' + error.message);
  }
}

// Document upload and extraction endpoint
app.post('/api/extract-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let extractedText = '';
    const fileName = req.file.originalname.toLowerCase();

    console.log(`Processing file: ${req.file.originalname}`);

    // Extract text based on file extension (more reliable than MIME type)
    if (fileName.endsWith('.txt')) {
      extractedText = await extractTextFromTXT(req.file.buffer);
    } else if (fileName.endsWith('.pdf')) {
      extractedText = await extractTextFromPDF(req.file.buffer);
    } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
      extractedText = await extractTextFromDOCX(req.file.buffer);
    } else if (fileName.endsWith('.pptx') || fileName.endsWith('.ppt')) {
      extractedText = await extractTextFromPPTX(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Trim and clean up the text
    extractedText = extractedText.trim();

    if (!extractedText) {
      // For PDFs, client can try OCR fallback for scanned/image-based PDFs
      const isPdf = fileName.endsWith('.pdf');
      return res.status(400).json({
        error: 'No text found in the document. The file might be empty or contain only images.',
        needsOcrFallback: isPdf
      });
    }

    console.log(`✓ Successfully extracted ${extractedText.length} characters from ${req.file.originalname}`);

    res.json({
      success: true,
      text: extractedText,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      textLength: extractedText.length
    });

  } catch (error) {
    console.error('Document extraction error:', error.message);
    res.status(500).json({
      error: 'Failed to extract text from document',
      details: error.message
    });
  }
});

// Music/Video transcription (OpenAI Whisper API)
app.post('/api/transcribe-media', mediaUpload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const openAiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!openAiKey && !groqKey) {
      return res.status(503).json({
        error: 'Audio transcription requires either OPENAI_API_KEY or GROQ_API_KEY in .env. See FREE_API_SOURCES.md for details.'
      });
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/mpeg' });
    formData.append('file', blob, req.file.originalname);

    let apiUrl, apiHeaders, model;

    // Prefer Groq (Free/Fast) if available
    if (groqKey) {
      console.log('Using Groq API for transcription...');
      apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
      apiHeaders = { 'Authorization': `Bearer ${groqKey}` };
      model = 'whisper-large-v3'; // Groq uses this model ID
    } else {
      console.log('Using OpenAI API for transcription...');
      apiUrl = 'https://api.openai.com/v1/audio/transcriptions';
      apiHeaders = { 'Authorization': `Bearer ${openAiKey}` };
      model = 'whisper-1';
    }

    formData.append('model', model);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: apiHeaders,
      body: formData
    });

    const text = await response.text();

    if (!response.ok) {
      let errMsg = 'Transcription failed';
      try {
        const data = JSON.parse(text);
        errMsg = data.error?.message || data.error || errMsg;
      } catch {
        errMsg = text || errMsg;
      }
      throw new Error(errMsg);
    }

    let transcript = '';
    try {
      const data = JSON.parse(text);
      transcript = (data.text || '').trim();
    } catch {
      transcript = text.trim();
    }

    if (!transcript) {
      return res.status(400).json({ error: 'No speech detected in the file.' });
    }

    res.json({ success: true, text: transcript });
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({
      error: 'Transcription failed',
      details: error.message
    });
  }
});

// ===== DUBBING PIPELINE (Audio/Video Translation with Voice Preservation) =====
app.post('/api/dub-media', mediaUpload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
    const { targetLanguage } = req.body;
    if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage is required' });

    const openAiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (!openAiKey && !groqKey) return res.status(503).json({ error: 'Dubbing requires OPENAI_API_KEY or GROQ_API_KEY' });

    console.log('Starting dubbing pipeline for:', targetLanguage);

    // STEP 1: Transcribe
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/mpeg' });
    formData.append('file', blob, req.file.originalname);
    // Debug tracking
    let transcribeBodyText = '';
    let transcribeStatus = null;
    let elevenRespStatus = null;
    let elevenRespBody = null;
    let translationPreview = '';
    formData.append('model', groqKey ? 'whisper-large-v3' : 'whisper-1');
    const langCode = getLanguageCodeForDubbing(targetLanguage);
    if (langCode) formData.append('language', langCode);

    const apiUrl = groqKey ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    const apiHeaders = { 'Authorization': `Bearer ${groqKey || openAiKey}` };

    const transcribeResp = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: formData });
    transcribeStatus = `${transcribeResp.status} ${transcribeResp.statusText}`;
    console.log('Transcription API status:', transcribeStatus);
    try { transcribeBodyText = await transcribeResp.text(); } catch (e) { console.warn('Failed reading transcribe response text'); }
    console.log('Transcription API raw body (truncated):', (transcribeBodyText || '').substring(0, 2000));
    if (!transcribeResp.ok) {
      return res.status(502).json({ error: 'Transcription failed', details: transcribeBodyText });
    }

    let transcribeData = {};
    try { transcribeData = JSON.parse(transcribeBodyText); } catch (e) { transcribeData = { text: transcribeBodyText }; }
    const sourceText = (transcribeData.text || '').trim();
    console.log('Transcribed text (first 300 chars):', (sourceText || '').substring(0,300));
    if (!sourceText) return res.status(400).json({ error: 'No speech detected', rawTranscription: transcribeData });

    // STEP 2: Translate
    let translatedText = sourceText;
    if (supabase) {
      try {
        console.log('Invoking Supabase translate function...');
        const { data, error } = await supabase.functions.invoke('translate', { body: { text: sourceText, targetLanguage } });
        if (error) {
          console.warn('Supabase translate returned error:', error);
        } else {
          console.log('Supabase translate result (truncated):', (data?.translatedText || '').substring(0,300));
          if (data?.translatedText) translatedText = data.translatedText;
        }
      } catch (e) {
        console.warn('Translation invocation failed:', e && e.message);
      }
    }

    // STEP 3: Synthesize speech
    let audioContent = null;
    // Prefer Google Cloud if credentials available
    if (textToSpeech && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        const ttsClient = new textToSpeech.TextToSpeechClient();
        const [response] = await ttsClient.synthesizeSpeech({
          input: { text: translatedText },
          voice: { languageCode: targetLanguage.split('-')[0], name: getVoiceNameForDubbing(targetLanguage), ssmlGender: 'NEUTRAL' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95, pitch: 0, volumeGainDb: 2 }
        });
        audioContent = response.audioContent;
      } catch (e) { console.warn('Google TTS fallback'); }
    }

    // Try ElevenLabs before falling back to VoiceRSS (with debug logs)
    if (!audioContent && process.env.ELEVENLABS_API_KEY) {
      try {
        console.log('Attempting ElevenLabs TTS...');
        const elevenUrl = 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM';
        const resp = await fetch(elevenUrl, {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({ text: translatedText, model_id: 'eleven_monolingual_v1' })
        });

        elevenRespStatus = `${resp.status} ${resp.statusText}`;
        console.log('ElevenLabs response status:', elevenRespStatus);
        const contentType = resp.headers.get('content-type') || '';
        console.log('ElevenLabs content-type:', contentType);

        if (resp.ok) {
          if (contentType.includes('audio')) {
            audioContent = await resp.arrayBuffer();
            console.log('Received audio from ElevenLabs, bytes:', audioContent?.byteLength || 0);
          } else {
            elevenRespBody = await resp.text();
            console.warn('ElevenLabs returned non-audio body:', elevenRespBody.substring(0,1000));
          }
        } else {
          elevenRespBody = await resp.text();
          console.warn('ElevenLabs error body:', elevenRespBody.substring(0,2000));
        }
      } catch (e) {
        console.warn('ElevenLabs request exception:', e && e.message);
      }
    }

    if (!audioContent) {
      try {
        const voiceRssUrl = `https://api.voicerss.org/?key=${process.env.VOICERSS_KEY || 'demo'}&hl=${targetLanguage}&src=${encodeURIComponent(translatedText)}&f=48khz_16bit_stereo&c=mp3`;
        const voiceResp = await fetch(voiceRssUrl);
        if (voiceResp.ok) audioContent = await voiceResp.arrayBuffer();
      } catch (e) { console.warn('VoiceRSS fallback'); }
    }

    if (!audioContent) {
      return res.status(500).json({
        error: 'TTS synthesis failed',
        debug: {
          transcribeStatus,
          transcribeBodyText: (transcribeBodyText || '').substring(0,2000),
          translationPreview,
          elevenRespStatus,
          elevenRespBody: elevenRespBody ? elevenRespBody.substring(0,2000) : null
        }
      });
    }

    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(Buffer.from(audioContent));
  } catch (error) {
    console.error('Dubbing error:', error);
    res.status(500).json({ error: 'Dubbing failed: ' + error.message });
  }
});

function getLanguageCodeForDubbing(lang) {
  const codes = { 'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt', 'ru': 'ru', 'ja': 'ja', 'ko': 'ko', 'zh': 'zh', 'ar': 'ar', 'hi': 'hi', 'th': 'th', 'vi': 'vi', 'tr': 'tr' };
  return codes[lang.split('-')[0]] || lang;
}

function getVoiceNameForDubbing(lang) {
  const voices = { 'en': 'en-US-Neural2-A', 'es': 'es-ES-Neural2-A', 'fr': 'fr-FR-Neural2-A', 'de': 'de-DE-Neural2-A', 'it': 'it-IT-Neural2-A', 'pt': 'pt-BR-Neural2-A', 'ru': 'ru-RU-Standard-A', 'ja': 'ja-JP-Neural2-A', 'ko': 'ko-KR-Neural2-A', 'zh': 'zh-CN-Standard-A', 'ar': 'ar-XA-Standard-A' };
  return voices[lang] || `${lang}-Standard-A`;
}

// Add endpoint for voice input
app.post('/voice-input', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    // Step 1: Convert voice to text
    const audioBytes = req.file.buffer.toString('base64');
    const speechClient = new (require('@google-cloud/speech').SpeechClient)();
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'en-US' },
    });
    const transcript = speechResponse.results.map(result => result.alternatives[0].transcript).join(' ');

    // Step 2: Translate text
    const targetLanguage = req.body.targetLanguage || 'es'; // Default to Spanish
    const { data, error } = await supabase.functions.invoke('translate', {
      body: { text: transcript, targetLanguage },
    });
    if (error) {
      throw new Error('Translation failed');
    }

    // Step 3: Convert translated text to speech
    const ttsClient = new textToSpeech.TextToSpeechClient();
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: data.translatedText },
      voice: { languageCode: targetLanguage, ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    // Send audio response
    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(ttsResponse.audioContent);
  } catch (error) {
    console.error('Error processing voice input:', error);
    res.status(500).json({ error: 'Failed to process voice input' });
  }
});

// ===== Supabase Integration =====

// Save translated text anonymously
app.post('/api/save-translation', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const { sourceText, translatedText, sourceLang, targetLang, sessionId } = req.body;

    const record = {
      source_text: sourceText || '',
      translated_text: translatedText || '',
      source_lang: sourceLang || null,
      target_lang: targetLang || null,
      session_id: sessionId || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('translations_anonymous').insert(record).select();
    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: error.message });
    }
    // data will be an array with the inserted record(s), include id for sharing
    const recordId = data && data[0] && data[0].id;
    res.json({ success: true, data, id: recordId });
  } catch (err) {
    console.error('Save translation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch recent translations anonymously
app.get('/api/translations', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const { sessionId } = req.query;

    if (sessionId) {
      // Fetch anonymous translations by session
      const { data, error } = await supabase
        .from('translations_anonymous')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Supabase fetch error:', error);
        return res.status(500).json({ error: error.message });
      }
      res.json({ success: true, data });
    } else {
      // No session specified
      res.json({ success: true, data: [] });
    }
  } catch (err) {
    console.error('Fetch translations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch a single translation record by id (for sharing)
app.get('/api/translation', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });
    const { data, error } = await supabase
      .from('translations_anonymous')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      console.error('Supabase fetch single error:', error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Fetch translation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Text-to-Speech endpoint using multiple TTS services
app.post('/api/speak', async (req, res) => {
  try {
    const { text, language } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Language mapping for TTS services - Google Translate TTS supports ~100 languages
    const languageMap = {
      // Major languages with native support
      'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it',
      'pt': 'pt', 'ru': 'ru', 'ja': 'ja', 'ko': 'ko', 'zh': 'zh-cn',
      'zh-TW': 'zh-tw', 'ar': 'ar', 'hi': 'hi', 'th': 'th', 'vi': 'vi',
      'tr': 'tr', 'nl': 'nl', 'sv': 'sv', 'no': 'no', 'da': 'da',
      'fi': 'fi', 'el': 'el', 'hu': 'hu', 'cs': 'cs', 'ro': 'ro',
      'bg': 'bg', 'hr': 'hr', 'uk': 'uk', 'pl': 'pl',

      // African languages - most supported by Google Translate TTS
      'af': 'af', 'am': 'am', 'ny': 'ny', 'st': 'st', 'sn': 'sn',
      'so': 'so', 'sw': 'sw', 'yo': 'yo', 'zu': 'zu', 'xh': 'xh',
      'rw': 'rw', 'lg': 'lg', 'mg': 'mg', 'ti': 'ti',

      // European languages
      'sq': 'sq', 'hy': 'hy', 'eu': 'eu', 'be': 'be', 'bs': 'bs',
      'ca': 'ca', 'ceb': 'ceb', 'et': 'et', 'gl': 'gl', 'ka': 'ka',
      'is': 'is', 'ga': 'ga', 'lv': 'lv', 'lt': 'lt', 'lb': 'lb',
      'mk': 'mk', 'mt': 'mt', 'gd': 'gd', 'sr': 'sr', 'sk': 'sk',
      'sl': 'sl', 'cy': 'cy', 'fo': 'fo', 'fy': 'fy', 'eo': 'eo',

      // Asian languages
      'lo': 'lo', 'km': 'km', 'my': 'my', 'tl': 'tl', 'id': 'id',
      'ms': 'ms', 'bn': 'bn', 'pa': 'pa', 'ur': 'ur', 'ta': 'ta',
      'te': 'te', 'mr': 'mr', 'gu': 'gu', 'kn': 'kn', 'ml': 'ml',
      'or': 'or', 'ne': 'ne', 'mai': 'mai', 'bho': 'bho', 'new': 'new',
      'taj': 'taj', 'si': 'si', 'dv': 'dv', 'as': 'as', 'bh': 'bh',
      'sa': 'sa', 'fa': 'fa', 'he': 'he', 'ps': 'ps', 'az': 'az',
      'kk': 'kk', 'ky': 'ky', 'tg': 'tg', 'tk': 'tk', 'uz': 'uz',
      'mn': 'mn', 'dz': 'dz',

      // Americas languages
      'ak': 'ak', 'ha': 'ha', 'ig': 'ig', 'la': 'la', 'mi': 'mi',
      'qu': 'qu', 'ay': 'ay', 'gn': 'gn', 'tet': 'tet', 'auto': 'en'
    };

    const targetLanguage = languageMap[language] || language;

    // Try multiple TTS services in order of preference

    // 1. Try Google Translate TTS (primary free option)
    try {
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(text)}&tl=${targetLanguage}&total=1&idx=0&textlen=${text.length}`;

      const response = await fetch(googleTtsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.byteLength,
        });
        return res.send(Buffer.from(audioBuffer));
      }
    } catch (googleError) {
      console.log('Google Translate TTS failed, trying alternatives...');
    }

    // 2. Try ElevenLabs TTS if key provided (with logging)
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        console.log('Attempting ElevenLabs TTS (speak endpoint)...');
        const elevenUrl = 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM';
        const resp = await fetch(elevenUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' })
        });
        console.log('ElevenLabs (speak) status:', resp.status, resp.statusText);
        const ct = resp.headers.get('content-type') || '';
        console.log('ElevenLabs (speak) content-type:', ct);
        if (resp.ok && ct.includes('audio')) {
          const buf = await resp.arrayBuffer();
          res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.byteLength });
          return res.send(Buffer.from(buf));
        } else {
          const errorBody = await resp.text();
          console.warn('ElevenLabs (speak) error body:', errorBody.substring(0, 2000));
        }
      } catch (e) {
        console.log('ElevenLabs TTS (speak) exception:', e && e.message);
      }
    }

    // 2. Try Google Cloud TTS if available
    if (textToSpeech) {
      try {
        const client = new textToSpeech.TextToSpeechClient();
        const request = {
          input: { text: text },
          voice: {
            languageCode: targetLanguage.split('-')[0],
            name: `${targetLanguage.replace('-', '-')}-Standard-A`,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.9,
            pitch: 0,
          },
        };

        const [response] = await client.synthesizeSpeech(request);
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': response.audioContent.length,
        });
        return res.send(response.audioContent);
      } catch (ttsError) {
        console.log('Google Cloud TTS failed, trying alternatives...');
      }
    }

    // 3. Try VoiceRSS (free tier available)
    try {
      const voiceRssUrl = `https://api.voicerss.org/?key=${process.env.VOICERSS_KEY || 'demo'}&hl=${targetLanguage}&src=${encodeURIComponent(text)}&f=48khz_16bit_mono`;

      const response = await fetch(voiceRssUrl);
      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.byteLength,
        });
        return res.send(Buffer.from(audioBuffer));
      }
    } catch (voiceRssError) {
      console.log('VoiceRSS failed, using browser fallback...');
    }

    // 4. Fallback to browser TTS guidance
    res.json({
      fallback: true,
      message: 'Server TTS services unavailable, using browser voices',
      language: targetLanguage
    });

  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Text-to-speech failed', details: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Expose minimal public config (supabase URL + anon key) for frontend
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    // Support both naming conventions to prevent configuration errors
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || null
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let localIP = 'unknown';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
      }
    }
  }
  console.log(`🌍 Languify running on http://localhost:${PORT}`);
  console.log(`📱 Mobile access: http://${localIP}:${PORT}`);
  console.log(`📝 Make sure your phone is on the same WiFi network!`);
});
