(async () => {
  try {
    const payload = {
      sourceText: 'Hello test from script',
      translatedText: 'Hola prueba desde script',
      sourceLang: 'en',
      targetLang: 'es',
      userId: 'script-test'
    };

    // Node 18+ has fetch built-in
    const res = await fetch('http://localhost:5000/api/save-translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Body:', text);
  } catch (err) {
    console.error('Request error:', err.message || err);
  }
})();
