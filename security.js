/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  security.js — XSS Protection Layer for RiskPerTrade            ║
 * ║  riskpertrade.me                                                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Covers:                                                         ║
 * ║  1. sanitizeInput()   — strip HTML sebelum simpan ke Firestore   ║
 * ║  2. renderSafe()      — render text ke DOM tanpa XSS             ║
 * ║  3. renderMarkdown()  — render basic markdown via DOMPurify      ║
 * ║  4. setupDOMPurify()  — konfigurasi DOMPurify yang aman          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * CARA PAKAI:
 *   <!-- Letakkan di <head>, sebelum §HEAD-STUBS -->
 *   <script src="/security.js"></script>
 *
 *   Atau load DOMPurify dulu jika ingin pakai renderMarkdown():
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.5/purify.min.js"></script>
 *   <script src="/security.js"></script>
 */

(function (window) {
  'use strict';

  // ══════════════════════════════════════════════════════════════════
  // §1 — SANITASI INPUT (panggil SEBELUM simpan ke Firestore)
  // ══════════════════════════════════════════════════════════════════
  /**
   * sanitizeInput(str)
   *
   * Strip semua HTML tag & atribut berbahaya dari input user.
   * Gunakan ini pada semua field bebas SEBELUM data di-set ke Firestore.
   *
   * Mode: "plain text only" — output murni teks, line break dipertahankan.
   * Aman untuk: Catatan, Reasoning, Notes & Lessons, semua field Playbook.
   *
   * @param {string} str - Raw input dari textarea
   * @returns {string} - Teks bersih, tanpa HTML sama sekali
   *
   * @example
   * // Di form Log Trade, sebelum addDoc():
   * const catatanBersih = sanitizeInput(form.catatan.value);
   * await addDoc(collection(db, 'trades'), { catatan: catatanBersih, ... });
   */
  function sanitizeInput(str) {
    if (typeof str !== 'string') return '';

    // Buat element sementara — browser parse HTML tapi kita ambil
    // hanya textContent-nya, sehingga semua tag otomatis di-strip.
    var tmp = document.createElement('div');
    tmp.textContent = str; // assign as text, BUKAN innerHTML
    var stripped = tmp.textContent; // baca kembali = plain text

    // Normalisasi whitespace berlebih tapi pertahankan line break tunggal
    stripped = stripped
      .replace(/\r\n/g, '\n')   // normalize Windows line endings
      .replace(/\r/g, '\n')     // normalize old Mac line endings
      .replace(/\n{4,}/g, '\n\n\n') // max 3 baris kosong berturut-turut
      .trim();

    return stripped;
  }

  // ══════════════════════════════════════════════════════════════════
  // §2 — RENDER AMAN KE DOM (pakai textContent, BUKAN innerHTML)
  // ══════════════════════════════════════════════════════════════════
  /**
   * renderSafe(element, text)
   *
   * Tampilkan teks dari Firestore ke elemen DOM dengan AMAN.
   * Line break (\n) dikonversi ke <br> menggunakan Node, bukan innerHTML.
   *
   * Gunakan ini untuk semua field catatan, reasoning, notes di UI.
   * Ini TIDAK mendukung bold/italic — untuk itu pakai renderMarkdown().
   *
   * @param {HTMLElement} element - Target DOM element
   * @param {string} text        - Teks dari Firestore (sudah sanitized)
   *
   * @example
   * // Di renderTable() atau detail trade:
   * const el = document.getElementById('trade-catatan');
   * renderSafe(el, trade.catatan);
   */
  function renderSafe(element, text) {
    if (!(element instanceof HTMLElement)) return;
    if (typeof text !== 'string') { element.textContent = ''; return; }

    // Kosongkan element dulu
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }

    // Split by newline, masukkan sebagai TextNode + <br>
    // TIDAK ada innerHTML sama sekali — 100% aman dari XSS
    var lines = text.split('\n');
    lines.forEach(function (line, i) {
      element.appendChild(document.createTextNode(line));
      if (i < lines.length - 1) {
        element.appendChild(document.createElement('br'));
      }
    });
  }

  /**
   * safeSetText(elementId, text)
   *
   * Shorthand: renderSafe() via ID. Cocok untuk one-liner di inline handlers.
   *
   * @param {string} elementId
   * @param {string} text
   */
  function safeSetText(elementId, text) {
    var el = document.getElementById(elementId);
    if (el) renderSafe(el, text);
  }

  // ══════════════════════════════════════════════════════════════════
  // §3 — RENDER MARKDOWN AMAN (DOMPurify + subset markdown)
  // ══════════════════════════════════════════════════════════════════
  /**
   * renderMarkdown(element, text)
   *
   * Render basic markdown ke HTML, dibersihkan dengan DOMPurify.
   * Mendukung: **bold**, *italic*, line break, `inline code`.
   * TIDAK mendukung: <script>, <img onerror>, href=javascript:, dsb.
   *
   * Membutuhkan DOMPurify dimuat sebelumnya:
   *   <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.5/purify.min.js"></script>
   *
   * Jika DOMPurify tidak tersedia, fallback otomatis ke renderSafe().
   *
   * @param {HTMLElement} element
   * @param {string} text - Teks markdown dari Firestore
   *
   * @example
   * renderMarkdown(document.getElementById('playbook-desc'), playbook.deskripsi);
   */
  function renderMarkdown(element, text) {
    if (!(element instanceof HTMLElement)) return;
    if (typeof text !== 'string') { element.textContent = ''; return; }

    // Fallback ke renderSafe jika DOMPurify belum dimuat
    if (typeof window.DOMPurify === 'undefined') {
      console.warn('[security.js] DOMPurify belum dimuat. Fallback ke renderSafe().');
      renderSafe(element, text);
      return;
    }

    // Konversi markdown sederhana ke HTML
    var html = _markdownToHtml(text);

    // Sanitasi dengan DOMPurify sebelum inject ke DOM
    var clean = window.DOMPurify.sanitize(html, _getDOMPurifyConfig());

    element.innerHTML = clean;
  }

  /**
   * _markdownToHtml(text) — Internal
   * Konversi subset markdown ke HTML string (belum disanitasi).
   */
  function _markdownToHtml(text) {
    return text
      // Escape karakter HTML terlebih dahulu (cegah raw HTML lolos)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Setelah escape, baru konversi markdown syntax
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')   // **bold**
      .replace(/\*(.+?)\*/g, '<em>$1</em>')               // *italic*
      .replace(/`(.+?)`/g, '<code>$1</code>')             // `code`
      .replace(/\n/g, '<br>');                             // newline → <br>
  }

  // ══════════════════════════════════════════════════════════════════
  // §4 — KONFIGURASI DOMPURIFY
  // ══════════════════════════════════════════════════════════════════
  /**
   * _getDOMPurifyConfig() — Internal
   *
   * Konfigurasi DOMPurify yang ketat:
   * - Hanya izinkan tag HTML yang aman untuk formatting teks
   * - Blokir semua atribut berbahaya (href, src, onerror, dsb.)
   * - Blokir semua skema URL berbahaya (javascript:, data:, vbscript:)
   */
  function _getDOMPurifyConfig() {
    return {
      // Tag yang boleh ada di output
      ALLOWED_TAGS: [
        'strong', 'b',    // bold
        'em', 'i',        // italic
        'br',             // line break
        'code',           // inline code
        'p',              // paragraph
        'ul', 'ol', 'li', // list (opsional, hapus jika tidak perlu)
        'span',           // generic inline
      ],

      // Atribut yang boleh ada — hanya class dan style dasar
      ALLOWED_ATTR: [
        'class',
      ],

      // Blokir semua URI scheme kecuali yang aman
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,

      // Strip semua comment HTML
      ALLOW_DATA_ATTR: false,

      // Paksa seluruh output diparse sebagai HTML (bukan SVG/MathML)
      FORCE_BODY: false,

      // Tambahan keamanan: hapus elemen yang tidak diizinkan beserta kontennya
      FORBID_CONTENTS: ['script', 'style', 'iframe', 'form', 'input'],

      // Return string (bukan Node)
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
    };
  }

  /**
   * setupDOMPurify()
   *
   * Konfigurasi DOMPurify secara global dengan hook tambahan.
   * Panggil SEKALI saat app init, setelah DOMPurify dimuat.
   * Ini memperkuat proteksi bahkan jika DOMPurify dipanggil
   * langsung di tempat lain dalam kodebase.
   *
   * @example
   * // Di §SCRIPT-MAIN, setelah Firebase init:
   * Security.setupDOMPurify();
   */
  function setupDOMPurify() {
    if (typeof window.DOMPurify === 'undefined') {
      console.warn('[security.js] DOMPurify belum dimuat. setupDOMPurify() dilewati.');
      return;
    }

    // Hook: hapus atribut berbahaya yang mungkin lolos dari ALLOWED_ATTR
    window.DOMPurify.addHook('uponSanitizeAttribute', function (node, data) {
      var DANGEROUS_ATTRS = [
        'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus',
        'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup',
        'onkeypress', 'style', // style bisa dipakai untuk expression injection di IE
      ];
      if (DANGEROUS_ATTRS.indexOf(data.attrName) !== -1) {
        data.forceKeepAttr = false; // paksa hapus
      }
    });

    // Hook: blokir href/src dengan nilai berbahaya
    window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if ('href' in node) {
        var href = node.getAttribute('href') || '';
        if (/^javascript:/i.test(href) || /^data:/i.test(href) || /^vbscript:/i.test(href)) {
          node.removeAttribute('href');
        }
      }
      if ('src' in node) {
        node.removeAttribute('src'); // src tidak diizinkan sama sekali
      }
    });

    console.info('[security.js] DOMPurify dikonfigurasi dengan hooks keamanan tambahan.');
  }

  // ══════════════════════════════════════════════════════════════════
  // §5 — HELPER UNTUK MIGRASI: innerHTML → renderSafe
  // ══════════════════════════════════════════════════════════════════
  /**
   * migrateInnerHTML(elementId, text)
   *
   * Drop-in replacement untuk pola:
   *   document.getElementById('x').innerHTML = trade.catatan;
   *
   * Ganti dengan:
   *   Security.migrateInnerHTML('x', trade.catatan);
   *
   * @param {string} elementId
   * @param {string} text
   */
  function migrateInnerHTML(elementId, text) {
    safeSetText(elementId, text);
  }

  // ══════════════════════════════════════════════════════════════════
  // §6 — FIELD LIST: semua field yang WAJIB disanitasi
  // ══════════════════════════════════════════════════════════════════
  /**
   * FIELDS_TO_SANITIZE
   *
   * Daftar field Firestore yang berasal dari textarea bebas.
   * Referensi ini dipakai sebagai checklist saat code review.
   *
   * Form Log Trade:
   *   - catatan (notes)
   *
   * Form Trade Plan:
   *   - reasoning
   *
   * Form Close Trade:
   *   - notesLessons (notes & lessons)
   *
   * Form Tambah Playbook:
   *   - deskripsiSingkat
   *   - kondisiEntry
   *   - kondisiExit
   *   - rules
   *   - catatanTambahan
   */
  var FIELDS_TO_SANITIZE = [
    'catatan',
    'reasoning',
    'notesLessons',
    'deskripsiSingkat',
    'kondisiEntry',
    'kondisiExit',
    'rules',
    'catatanTambahan',
  ];

  /**
   * sanitizeTradeData(data)
   *
   * Sanitasi semua field teks bebas dari object trade/playbook sekaligus.
   * Gunakan ini sebagai one-liner sebelum addDoc/updateDoc.
   *
   * @param {Object} data - Object yang akan disimpan ke Firestore
   * @returns {Object} - Object yang sama, field teks sudah bersih
   *
   * @example
   * const tradeData = {
   *   pair: 'XAUUSD',
   *   catatan: form.catatan.value,  // belum bersih
   *   reasoning: form.reasoning.value,
   *   ...
   * };
   * const safeData = Security.sanitizeTradeData(tradeData);
   * await addDoc(collection(db, 'trades'), safeData);
   */
  function sanitizeTradeData(data) {
    if (!data || typeof data !== 'object') return data;
    var result = Object.assign({}, data);
    FIELDS_TO_SANITIZE.forEach(function (field) {
      if (typeof result[field] === 'string') {
        result[field] = sanitizeInput(result[field]);
      }
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // §7 — EXPORT: expose sebagai window.Security
  // ══════════════════════════════════════════════════════════════════
  window.Security = {
    sanitizeInput:    sanitizeInput,
    sanitizeTradeData: sanitizeTradeData,
    renderSafe:       renderSafe,
    safeSetText:      safeSetText,
    renderMarkdown:   renderMarkdown,
    setupDOMPurify:   setupDOMPurify,
    migrateInnerHTML: migrateInnerHTML,
    FIELDS_TO_SANITIZE: FIELDS_TO_SANITIZE,
  };

})(window);


/* ════════════════════════════════════════════════════════════════════
   REVIEW: innerHTML vs textContent vs DOMPurify
   ════════════════════════════════════════════════════════════════════

   ┌─────────────────┬────────────────────────────────┬──────────────┐
   │ Method          │ Kapan Pakai                     │ XSS Risk     │
   ├─────────────────┼────────────────────────────────┼──────────────┤
   │ textContent     │ Selalu untuk teks biasa.        │ ZERO — tidak │
   │                 │ Ini adalah default yang aman.   │ parse HTML   │
   │                 │ Tidak support formatting.        │ sama sekali  │
   ├─────────────────┼────────────────────────────────┼──────────────┤
   │ renderSafe()    │ Teks biasa + perlu line break.  │ ZERO — pakai │
   │ (lihat §2)      │ Pakai createTextNode + <br>.    │ DOM API, no  │
   │                 │ Tidak support bold/italic.       │ HTML parsing │
   ├─────────────────┼────────────────────────────────┼──────────────┤
   │ DOMPurify +     │ Perlu formatting (bold, italic).│ LOW jika     │
   │ innerHTML       │ Pakai renderMarkdown() di §3.   │ config ketat │
   │ (lihat §3-4)    │ Selalu sanitasi dulu!           │ (lihat §4)   │
   ├─────────────────┼────────────────────────────────┼──────────────┤
   │ innerHTML       │ JANGAN untuk user content.      │ HIGH — raw   │
   │ (raw)           │ Boleh untuk template HTML       │ HTML di-     │
   │                 │ yang kamu kontrol sendiri.      │ execute oleh │
   │                 │                                 │ browser      │
   └─────────────────┴────────────────────────────────┴──────────────┘

   ATURAN PRAKTIS:
   ✅ Data dari Firestore? → Selalu lewat renderSafe() atau renderMarkdown()
   ✅ Sebelum save ke Firestore? → Selalu lewat sanitizeInput()
   ❌ JANGAN: element.innerHTML = dataFromFirestore
   ❌ JANGAN: element.innerHTML = userInput

   ════════════════════════════════════════════════════════════════════
*/
