// ==UserScript==
// @name         My List for Netflix
// @version      1.3.10
// @description  Displays your Netflix My List in an easy-to-browse grid.
// @author       final221
// @license      MIT
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @sandbox      raw
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @namespace local.netflix.mylist.grid
// ==/UserScript==

(() => {
    'use strict';

    const TARGET_PATH = '/browse/my-list';
    // Netflix-owned selectors used by discovery and card handling live here.
    const NETFLIX_DOM_SELECTORS = Object.freeze({
        browseSections: '[data-uia="browse-page-sections"]',
        progressCard: '[data-uia="progress-card"]',
        carouselRowZero: 'carousel-row-section-0',
        carouselRowOne: 'carousel-row-section-1',
        carouselRowOneSection: 'section[data-uia="carousel-row-section-1"]',
        emptyCarouselSection: 'empty-carousel-section',
        carouselScroller: '[data-uia="carousel-scroller"]',
        standardCard: 'a[data-uia="standard-card"]',
        standardCardWithHref: 'a[data-uia="standard-card"][href]',
        virtualSlot: '[data-virtual-slot]'
    });
    // Hawkins controls can apply a virtual-page transform after several paint
    // cycles when the source row is under load. Keep the observation window
    // longer than that deferred update so a legitimate move is not retried
    // while the first click is still settling.
    const PAGE_CHANGE_TIMEOUT_MS = 3000;
    const PAGE_CHANGE_OBSERVER_PRIMARY_MS = 320;
    const PAGE_STABLE_TIMEOUT_MS = 2000;
    const PARTIAL_PAGE_RECOVERY_TIMEOUT_MS = 2500;
    const FAST_RESTORE_VERIFY_TIMEOUT_MS = 260;
    const NATIVE_READY_TIMEOUT_MS = 3000;
    const NATIVE_SINGLE_PAGE_STABLE_MS = 700;
    const NATIVE_EMPTY_STABLE_MS = 1200;
    const NATIVE_READY_POLL_MS = 25;
    const NATIVE_LOGICAL_STABLE_MS = 120;
    const DELTA_MUTATION_TIMEOUT_MS = 1800;
    const UNDO_ENTRY_TTL_MS = 30000;
    const SCRIPT_MOVE_SETTLE_TIMEOUT_MS = 260;
    const HOVER_SOURCE_TIMEOUT_MS = 500;
    const HOVER_SOURCE_INTERVAL_MS = 10;
    const HOVER_ACTIVATION_DELAY_MS = 120;
    const HOVER_SCROLL_QUIET_MS = 180;
    const HOVER_RETRY_DELAY_MS = 180;
    const CANCELLED_MOVE_POLL_MS = 80;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    const LOGICAL_COLLECTION_TIMEOUT_MS = 120000;
    const TOTAL_COUNT_TIMEOUT_MS = 5000;
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = 10000;
    const GRAPHQL_COLLECTION_PAGE_SIZE = 75;
    const GRAPHQL_COLLECTION_MAX_PAGES = 8;
    const BUILD_CHUNK_MAX_ITEMS = 24;
    const BUILD_CHUNK_BUDGET_MS = 6;
    const VIEWING_TITLE_BATCH_SIZE = 50;
    const VIEWING_EPISODE_BATCH_SIZE = 200;
    const VIEWING_MAX_SEASONS = 40;
    const VIEWING_MAX_EPISODES = 500;
    const VIEWING_MAX_REQUESTS = 32;
    const VIEWING_MAX_PASSES = 3;
    // Controlled overlap experiment; compare completion timing and failures in Copy Logs.
    const VIEWING_REQUEST_CONCURRENCY = 2;
    const VIEWING_TIMEOUT_MS = 30000;
    const VIEWING_COMPLETION_RATIO = 0.90;
    // Read-only, on-demand Copy Logs samples; no work is added to scrolling.
    const THUMBNAIL_DIAGNOSTIC_LIMITS = Object.freeze({
        cards: 600, geometry: 24, resourceEntries: 2000
    });
    const IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES = 4000;

    const GRID_ID = 'tm-netflix-mylist-v15-grid';
    const STATUS_ID = 'tm-netflix-mylist-v15-status';
    const ORDER_MISMATCH_DIALOG_ID = 'tm-netflix-mylist-order-mismatch-dialog';
    const STYLE_ID = 'tm-netflix-mylist-v15-style';
    const SECTION_ATTR = 'data-tm-mylist-v15';
    const SOURCE_SCAN_CLASS = 'tm-netflix-mylist-v15-source-scan';
    const SOURCE_PARKED_CLASS = 'tm-netflix-mylist-v15-source-parked';
    const LOG_LINK_ID = 'tm-netflix-mylist-v20-log';
    const STATUS_TEXT_CLASS = 'tm-netflix-mylist-v20-status-text';
    const STATUS_LABEL_CLASS = 'tm-netflix-mylist-v23-status-label';
    const STATUS_META_CLASS = 'tm-netflix-mylist-v23-status-meta';
    const SCRIPT_NAME = 'My List for Netflix';
    const SCRIPT_VERSION = '1.3.10';
    const LOG_PREFIX = `[${SCRIPT_NAME} v${SCRIPT_VERSION}]`;
    const MAX_LOG_ENTRIES = 5000;
    // Enable temporarily when detailed source-card traces are needed for diagnosis.
    const VERBOSE_INTERACTION_LOGS = false;
    const FAST_MOVE_CLASS = 'tm-netflix-mylist-v22-fast-move';
    const ORIGINAL_HIDDEN_CLASS = 'tm-netflix-mylist-original-hidden';
    const ORIGINAL_VISIBILITY_ATTR = 'data-tm-original-mylist-visible';
    const ORIGINAL_HEADER_CLASS = 'tm-netflix-mylist-original-header';
    const SYNTHETIC_SECTION_ID = 'tm-netflix-mylist-empty-section';
    const LEGACY_EMPTY_STATE_ID = 'tm-netflix-mylist-v48-empty-state';
    const SETTINGS_STORAGE_KEY = 'legacyMyListForNetflix.settings.v3';
    const VIEWING_CHOICES_STORAGE_KEY = 'legacyMyListForNetflix.viewingChoices.v1.';
    const VIEWING_CACHE_STORAGE_KEY = 'legacyMyListForNetflix.viewingCache.v1.';
    const VIEWING_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
    /*
     * Localization rules:
     * 1. Keep these rules in the source so future changes inherit them.
     * 2. Functional behavior and element detection must never depend on
     *    localized display text or a specific display language.
     * 3. User-visible script strings must support the same primary display
     *    languages as Netflix. Unknown or unsupported locales fall back to English.
     * 4. CopyLogs and diagnostic log text support English and Japanese only;
     *    Japanese is used for ja, and English is the default for every other locale.
     * 5. The script name "My List for Netflix" is never localized.
     *
     * Localization architecture:
     * - UI_MESSAGES + tUi()/tUiPlural() are for user-visible script UI only.
     * - LOG_MESSAGES + tLog() are for CopyLogs/diagnostic text only.
     * - Localized strings must never be used for DOM identification, branching,
     *   state decisions, or any other functional detection.
     * - Runtime non-ASCII strings are stored with Unicode escapes.
     */

    const NETFLIX_PRIMARY_UI_LOCALES = new Set([
        'da',
        'de',
        'en',
        'es',
        'fil',
        'fr',
        'hr',
        'id',
        'it',
        'hu',
        'ms',
        'nl',
        'nb',
        'pl',
        'pt',
        'ro',
        'fi',
        'sv',
        'vi',
        'tr',
        'cs',
        'el',
        'ru',
        'uk',
        'he',
        'ar',
        'hi',
        'th',
        'zh',
        'ja',
        'ko'
    ]);

    const UI_MESSAGES = {
        'da': {
            legacyMyList: 'Klassisk Min liste',
            itemCount: { one: '{count} element', other: '{count} elementer' },
            initializing: 'Initialiserer...',
            orderChangedPrompt: "R\u00e6kkef\u00f8lgen i Min liste er \u00e6ndret. Initialiser igen.",
            orderChangedOk: "OK",
            orderChangedCancel: "Annuller",
            initTime: 'Init. {seconds}s',
            showOriginalMyList: 'Vis den oprindelige Min liste',
            hideOriginalMyList: 'Skjul den oprindelige Min liste',
            emptyMessage: 'Her finder du de film og serier, du har gemt.',
            relayoutInProgress: 'Omarrangerer...',
            relayoutFailed: 'Omarrangering mislykkedes',
            initializationFailed: 'Klassisk Min liste: fejl - {message}',
            noNativeCards: 'Kunne ikke hente de oprindelige Netflix-kort.',
            errorCount: 'Fejl-{count}',
        },
        'de': {
            legacyMyList: 'Klassische Meine Liste',
            itemCount: { one: '{count} Eintrag', other: '{count} Eintr\u00e4ge' },
            initializing: 'Wird initialisiert...',
            orderChangedPrompt: "Die Reihenfolge von \u201eMeine Liste\u201c hat sich ge\u00e4ndert. Bitte neu initialisieren.",
            orderChangedOk: "OK",
            orderChangedCancel: "Abbrechen",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Originale Meine Liste anzeigen',
            hideOriginalMyList: 'Originale Meine Liste ausblenden',
            emptyMessage: 'Hier findest du die Filme und Serien, die du gespeichert hast.',
            relayoutInProgress: 'Layout wird neu angeordnet...',
            relayoutFailed: 'Neuanordnung fehlgeschlagen',
            initializationFailed: 'Klassische Meine Liste: Fehler - {message}',
            noNativeCards: 'Die urspr\u00fcnglichen Netflix-Karten konnten nicht abgerufen werden.',
            errorCount: 'Fehler-{count}',
        },
        'en': {
            legacyMyList: 'Legacy My List',
            itemCount: { one: '{count} item', other: '{count} items' },
            initializing: 'Initializing...',
            orderChangedPrompt: "The order of My List has changed. Please initialize again.",
            orderChangedOk: "OK",
            orderChangedCancel: "Cancel",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Show original My List',
            hideOriginalMyList: 'Hide original My List',
            emptyMessage: 'You can find the movies and TV shows you\'ve saved here.',
            relayoutInProgress: 'Relayout in progress',
            relayoutFailed: 'Relayout failed',
            initializationFailed: 'Legacy My List: failed - {message}',
            noNativeCards: 'No native Netflix cards could be collected.',
            errorCount: 'Error-{count}',
        },
        'es': {
            legacyMyList: 'Mi lista cl\u00e1sica',
            itemCount: { one: '{count} elemento', other: '{count} elementos' },
            initializing: 'Inicializando...',
            orderChangedPrompt: "El orden de Mi lista ha cambiado. Vuelve a inicializar.",
            orderChangedOk: "Aceptar",
            orderChangedCancel: "Cancelar",
            initTime: 'Inicio {seconds}s',
            showOriginalMyList: 'Mostrar Mi lista original',
            hideOriginalMyList: 'Ocultar Mi lista original',
            emptyMessage: 'Aqu\u00ed encontrar\u00e1s las pel\u00edculas y series que hayas guardado.',
            relayoutInProgress: 'Reorganizando...',
            relayoutFailed: 'Error al reorganizar',
            initializationFailed: 'Mi lista cl\u00e1sica: error - {message}',
            noNativeCards: 'No se pudieron obtener las tarjetas originales de Netflix.',
            errorCount: 'Error-{count}',
        },
        'fil': {
            legacyMyList: 'Lumang Aking Listahan',
            itemCount: { one: '{count} item', other: '{count} mga item' },
            initializing: 'Nagsisimula...',
            orderChangedPrompt: "Nagbago ang pagkakasunod-sunod ng My List. Paki-initialize muli.",
            orderChangedOk: "OK",
            orderChangedCancel: "Kanselahin",
            initTime: 'Simula {seconds}s',
            showOriginalMyList: 'Ipakita ang orihinal na Aking Listahan',
            hideOriginalMyList: 'Itago ang orihinal na Aking Listahan',
            emptyMessage: 'Makikita rito ang mga pelikula at palabas sa TV na na-save mo.',
            relayoutInProgress: 'Inaayos muli...',
            relayoutFailed: 'Nabigo ang muling pag-aayos',
            initializationFailed: 'Lumang Aking Listahan: nabigo - {message}',
            noNativeCards: 'Hindi makuha ang mga orihinal na card ng Netflix.',
            errorCount: 'Error-{count}',
        },
        'fr': {
            legacyMyList: 'Ma liste classique',
            itemCount: { one: '{count} \u00e9l\u00e9ment', other: '{count} \u00e9l\u00e9ments' },
            initializing: 'Initialisation...',
            orderChangedPrompt: "L\u2019ordre de Ma liste a chang\u00e9. Veuillez r\u00e9initialiser.",
            orderChangedOk: "OK",
            orderChangedCancel: "Annuler",
            initTime: 'Init. {seconds}s',
            showOriginalMyList: 'Afficher Ma liste d\u2019origine',
            hideOriginalMyList: 'Masquer Ma liste d\u2019origine',
            emptyMessage: 'Vous trouverez ici les films et s\u00e9ries que vous avez enregistr\u00e9s.',
            relayoutInProgress: 'R\u00e9organisation en cours...',
            relayoutFailed: '\u00c9chec de la r\u00e9organisation',
            initializationFailed: 'Ma liste classique : \u00e9chec - {message}',
            noNativeCards: 'Impossible de r\u00e9cup\u00e9rer les cartes Netflix d\u2019origine.',
            errorCount: 'Erreur-{count}',
        },
        'hr': {
            legacyMyList: 'Klasi\u010dni Moj popis',
            itemCount: { one: '{count} stavka', few: '{count} stavke', other: '{count} stavki' },
            initializing: 'Pokretanje...',
            orderChangedPrompt: "Redoslijed Mojeg popisa se promijenio. Ponovno pokrenite inicijalizaciju.",
            orderChangedOk: "U redu",
            orderChangedCancel: "Odustani",
            initTime: 'Pokretanje {seconds}s',
            showOriginalMyList: 'Prika\u017ei izvorni Moj popis',
            hideOriginalMyList: 'Sakrij izvorni Moj popis',
            emptyMessage: 'Ovdje mo\u017eete prona\u0107i filmove i serije koje ste spremili.',
            relayoutInProgress: 'Promjena rasporeda...',
            relayoutFailed: 'Promjena rasporeda nije uspjela',
            initializationFailed: 'Klasi\u010dni Moj popis: pogre\u0161ka - {message}',
            noNativeCards: 'Nije mogu\u0107e dohvatiti izvorne Netflix kartice.',
            errorCount: 'Pogre\u0161ka-{count}',
        },
        'id': {
            legacyMyList: 'Daftar Saya Klasik',
            itemCount: { other: '{count} item' },
            initializing: 'Menginisialisasi...',
            orderChangedPrompt: "Urutan Daftar Saya telah berubah. Silakan inisialisasi ulang.",
            orderChangedOk: "OK",
            orderChangedCancel: "Batal",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Tampilkan Daftar Saya asli',
            hideOriginalMyList: 'Sembunyikan Daftar Saya asli',
            emptyMessage: 'Film dan acara TV yang Anda simpan dapat ditemukan di sini.',
            relayoutInProgress: 'Menata ulang...',
            relayoutFailed: 'Penataan ulang gagal',
            initializationFailed: 'Daftar Saya Klasik: gagal - {message}',
            noNativeCards: 'Kartu Netflix asli tidak dapat diambil.',
            errorCount: 'Galat-{count}',
        },
        'it': {
            legacyMyList: 'La mia lista classica',
            itemCount: { one: '{count} elemento', other: '{count} elementi' },
            initializing: 'Inizializzazione...',
            orderChangedPrompt: "L'ordine de La mia lista \u00e8 cambiato. Esegui di nuovo l'inizializzazione.",
            orderChangedOk: "OK",
            orderChangedCancel: "Annulla",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Mostra La mia lista originale',
            hideOriginalMyList: 'Nascondi La mia lista originale',
            emptyMessage: 'Qui trovi i film e le serie TV che hai salvato.',
            relayoutInProgress: 'Riorganizzazione in corso...',
            relayoutFailed: 'Riorganizzazione non riuscita',
            initializationFailed: 'La mia lista classica: errore - {message}',
            noNativeCards: 'Impossibile recuperare le schede Netflix originali.',
            errorCount: 'Errore-{count}',
        },
        'hu': {
            legacyMyList: 'Klasszikus Saj\u00e1t list\u00e1m',
            itemCount: { other: '{count} elem' },
            initializing: 'Inicializ\u00e1l\u00e1s...',
            orderChangedPrompt: "A Saj\u00e1t lista sorrendje megv\u00e1ltozott. Inicializ\u00e1lja \u00fajra.",
            orderChangedOk: "OK",
            orderChangedCancel: "M\u00e9gse",
            initTime: 'Ind\u00edt\u00e1s {seconds}s',
            showOriginalMyList: 'Eredeti Saj\u00e1t list\u00e1m megjelen\u00edt\u00e9se',
            hideOriginalMyList: 'Eredeti Saj\u00e1t list\u00e1m elrejt\u00e9se',
            emptyMessage: 'Itt tal\u00e1lod az elmentett filmeket \u00e9s sorozatokat.',
            relayoutInProgress: '\u00dajrarendez\u00e9s...',
            relayoutFailed: 'Az \u00fajrarendez\u00e9s sikertelen',
            initializationFailed: 'Klasszikus Saj\u00e1t list\u00e1m: hiba - {message}',
            noNativeCards: 'Nem siker\u00fclt bet\u00f6lteni az eredeti Netflix-k\u00e1rty\u00e1kat.',
            errorCount: 'Hiba-{count}',
        },
        'ms': {
            legacyMyList: 'Senarai Saya Klasik',
            itemCount: { other: '{count} item' },
            initializing: 'Memulakan...',
            orderChangedPrompt: "Susunan Senarai Saya telah berubah. Sila mulakan semula.",
            orderChangedOk: "OK",
            orderChangedCancel: "Batal",
            initTime: 'Mula {seconds}s',
            showOriginalMyList: 'Tunjukkan Senarai Saya asal',
            hideOriginalMyList: 'Sembunyikan Senarai Saya asal',
            emptyMessage: 'Filem dan rancangan TV yang anda simpan boleh didapati di sini.',
            relayoutInProgress: 'Menyusun semula...',
            relayoutFailed: 'Susun semula gagal',
            initializationFailed: 'Senarai Saya Klasik: gagal - {message}',
            noNativeCards: 'Kad Netflix asal tidak dapat diperoleh.',
            errorCount: 'Ralat-{count}',
        },
        'nl': {
            legacyMyList: 'Klassieke Mijn lijst',
            itemCount: { one: '{count} item', other: '{count} items' },
            initializing: 'Initialiseren...',
            orderChangedPrompt: "De volgorde van Mijn lijst is gewijzigd. Initialiseer opnieuw.",
            orderChangedOk: "OK",
            orderChangedCancel: "Annuleren",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Originele Mijn lijst tonen',
            hideOriginalMyList: 'Originele Mijn lijst verbergen',
            emptyMessage: 'Hier vind je de films en series die je hebt opgeslagen.',
            relayoutInProgress: 'Opnieuw indelen...',
            relayoutFailed: 'Opnieuw indelen mislukt',
            initializationFailed: 'Klassieke Mijn lijst: mislukt - {message}',
            noNativeCards: 'De oorspronkelijke Netflix-kaarten konden niet worden opgehaald.',
            errorCount: 'Fout-{count}',
        },
        'nb': {
            legacyMyList: 'Klassisk Min liste',
            itemCount: { one: '{count} element', other: '{count} elementer' },
            initializing: 'Initialiserer...',
            orderChangedPrompt: "Rekkef\u00f8lgen i Min liste er endret. Initialiser p\u00e5 nytt.",
            orderChangedOk: "OK",
            orderChangedCancel: "Avbryt",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Vis opprinnelig Min liste',
            hideOriginalMyList: 'Skjul opprinnelig Min liste',
            emptyMessage: 'Her finner du filmene og seriene du har lagret.',
            relayoutInProgress: 'Omorganiserer...',
            relayoutFailed: 'Omorganisering mislyktes',
            initializationFailed: 'Klassisk Min liste: feil - {message}',
            noNativeCards: 'Kunne ikke hente de opprinnelige Netflix-kortene.',
            errorCount: 'Feil-{count}',
        },
        'pl': {
            legacyMyList: 'Klasyczna Moja lista',
            itemCount: { one: '{count} element', few: '{count} elementy', many: '{count} element\u00f3w', other: '{count} elementu' },
            initializing: 'Inicjowanie...',
            orderChangedPrompt: "Kolejno\u015b\u0107 w Mojej li\u015bcie uleg\u0142a zmianie. Zainicjalizuj ponownie.",
            orderChangedOk: "OK",
            orderChangedCancel: "Anuluj",
            initTime: 'Start {seconds}s',
            showOriginalMyList: 'Poka\u017c oryginaln\u0105 Moj\u0105 list\u0119',
            hideOriginalMyList: 'Ukryj oryginaln\u0105 Moj\u0105 list\u0119',
            emptyMessage: 'Tutaj znajdziesz zapisane filmy i seriale.',
            relayoutInProgress: 'Ponowne rozmieszczanie...',
            relayoutFailed: 'Ponowne rozmieszczanie nie powiod\u0142o si\u0119',
            initializationFailed: 'Klasyczna Moja lista: b\u0142\u0105d - {message}',
            noNativeCards: 'Nie uda\u0142o si\u0119 pobra\u0107 oryginalnych kart Netflix.',
            errorCount: 'B\u0142\u0105d-{count}',
        },
        'pt': {
            legacyMyList: 'A minha lista cl\u00e1ssica',
            itemCount: { one: '{count} item', other: '{count} itens' },
            initializing: 'A inicializar...',
            orderChangedPrompt: "A ordem da Minha lista mudou. Inicialize novamente.",
            orderChangedOk: "OK",
            orderChangedCancel: "Cancelar",
            initTime: 'In\u00edcio {seconds}s',
            showOriginalMyList: 'Mostrar A minha lista original',
            hideOriginalMyList: 'Ocultar A minha lista original',
            emptyMessage: 'Aqui encontra os filmes e s\u00e9ries que guardou.',
            relayoutInProgress: 'A reorganizar...',
            relayoutFailed: 'Falha ao reorganizar',
            initializationFailed: 'A minha lista cl\u00e1ssica: falha - {message}',
            noNativeCards: 'N\u00e3o foi poss\u00edvel obter os cart\u00f5es originais da Netflix.',
            errorCount: 'Erro-{count}',
        },
        'ro': {
            legacyMyList: 'Lista mea clasic\u0103',
            itemCount: { one: '{count} element', few: '{count} elemente', other: '{count} elemente' },
            initializing: 'Se ini\u021bializeaz\u0103...',
            orderChangedPrompt: "Ordinea din Lista mea s-a schimbat. Reini\u021bializeaz\u0103.",
            orderChangedOk: "OK",
            orderChangedCancel: "Anulare",
            initTime: 'Ini\u021bializare {seconds}s',
            showOriginalMyList: 'Afi\u0219eaz\u0103 Lista mea original\u0103',
            hideOriginalMyList: 'Ascunde Lista mea original\u0103',
            emptyMessage: 'Aici g\u0103se\u0219ti filmele \u0219i serialele salvate.',
            relayoutInProgress: 'Se rearanjeaz\u0103...',
            relayoutFailed: 'Rearanjarea a e\u0219uat',
            initializationFailed: 'Lista mea clasic\u0103: eroare - {message}',
            noNativeCards: 'Nu s-au putut ob\u021bine cardurile Netflix originale.',
            errorCount: 'Eroare-{count}',
        },
        'fi': {
            legacyMyList: 'Klassinen Oma lista',
            itemCount: { one: '{count} kohde', other: '{count} kohdetta' },
            initializing: 'Alustetaan...',
            orderChangedPrompt: "Oma lista -j\u00e4rjestys on muuttunut. Alusta uudelleen.",
            orderChangedOk: "OK",
            orderChangedCancel: "Peruuta",
            initTime: 'Alustus {seconds}s',
            showOriginalMyList: 'N\u00e4yt\u00e4 alkuper\u00e4inen Oma lista',
            hideOriginalMyList: 'Piilota alkuper\u00e4inen Oma lista',
            emptyMessage: 'T\u00e4\u00e4lt\u00e4 l\u00f6yd\u00e4t tallentamasi elokuvat ja TV-sarjat.',
            relayoutInProgress: 'J\u00e4rjestell\u00e4\u00e4n uudelleen...',
            relayoutFailed: 'Uudelleenj\u00e4rjestely ep\u00e4onnistui',
            initializationFailed: 'Klassinen Oma lista: virhe - {message}',
            noNativeCards: 'Netflixin alkuper\u00e4isi\u00e4 kortteja ei voitu hakea.',
            errorCount: 'Virhe-{count}',
        },
        'sv': {
            legacyMyList: 'Klassiska Min lista',
            itemCount: { other: '{count} objekt' },
            initializing: 'Initierar...',
            orderChangedPrompt: "Ordningen i Min lista har \u00e4ndrats. Initiera om.",
            orderChangedOk: "OK",
            orderChangedCancel: "Avbryt",
            initTime: 'Init {seconds}s',
            showOriginalMyList: 'Visa ursprungliga Min lista',
            hideOriginalMyList: 'D\u00f6lj ursprungliga Min lista',
            emptyMessage: 'H\u00e4r hittar du filmerna och serierna du har sparat.',
            relayoutInProgress: 'Ordnar om...',
            relayoutFailed: 'Omordningen misslyckades',
            initializationFailed: 'Klassiska Min lista: fel - {message}',
            noNativeCards: 'Det gick inte att h\u00e4mta de ursprungliga Netflix-korten.',
            errorCount: 'Fel-{count}',
        },
        'vi': {
            legacyMyList: 'Danh s\u00e1ch c\u1ee7a t\u00f4i c\u1ed5 \u0111i\u1ec3n',
            itemCount: { other: '{count} m\u1ee5c' },
            initializing: '\u0110ang kh\u1edfi t\u1ea1o...',
            orderChangedPrompt: "Th\u1ee9 t\u1ef1 Danh s\u00e1ch c\u1ee7a t\u00f4i \u0111\u00e3 thay \u0111\u1ed5i. Vui l\u00f2ng kh\u1edfi t\u1ea1o l\u1ea1i.",
            orderChangedOk: "OK",
            orderChangedCancel: "H\u1ee7y",
            initTime: 'Kh\u1edfi t\u1ea1o {seconds}s',
            showOriginalMyList: 'Hi\u1ec7n Danh s\u00e1ch c\u1ee7a t\u00f4i g\u1ed1c',
            hideOriginalMyList: '\u1ea8n Danh s\u00e1ch c\u1ee7a t\u00f4i g\u1ed1c',
            emptyMessage: 'B\u1ea1n c\u00f3 th\u1ec3 t\u00ecm th\u1ea5y c\u00e1c phim v\u00e0 ch\u01b0\u01a1ng tr\u00ecnh truy\u1ec1n h\u00ecnh \u0111\u00e3 l\u01b0u \u1edf \u0111\u00e2y.',
            relayoutInProgress: '\u0110ang s\u1eafp x\u1ebfp l\u1ea1i...',
            relayoutFailed: 'S\u1eafp x\u1ebfp l\u1ea1i th\u1ea5t b\u1ea1i',
            initializationFailed: 'Danh s\u00e1ch c\u1ee7a t\u00f4i c\u1ed5 \u0111i\u1ec3n: l\u1ed7i - {message}',
            noNativeCards: 'Kh\u00f4ng th\u1ec3 l\u1ea5y c\u00e1c th\u1ebb Netflix g\u1ed1c.',
            errorCount: 'L\u1ed7i-{count}',
        },
        'tr': {
            legacyMyList: 'Klasik Listem',
            itemCount: { other: '{count} \u00f6\u011fe' },
            initializing: 'Ba\u015flat\u0131l\u0131yor...',
            orderChangedPrompt: "Listem'in s\u0131ras\u0131 de\u011fi\u015fti. L\u00fctfen yeniden ba\u015flat\u0131n.",
            orderChangedOk: "Tamam",
            orderChangedCancel: "\u0130ptal",
            initTime: 'Ba\u015flatma {seconds}s',
            showOriginalMyList: 'Orijinal Listem\u2019i g\u00f6ster',
            hideOriginalMyList: 'Orijinal Listem\u2019i gizle',
            emptyMessage: 'Kaydetti\u011finiz filmleri ve dizileri burada bulabilirsiniz.',
            relayoutInProgress: 'Yeniden d\u00fczenleniyor...',
            relayoutFailed: 'Yeniden d\u00fczenleme ba\u015far\u0131s\u0131z',
            initializationFailed: 'Klasik Listem: hata - {message}',
            noNativeCards: 'Orijinal Netflix kartlar\u0131 al\u0131namad\u0131.',
            errorCount: 'Hata-{count}',
        },
        'cs': {
            legacyMyList: 'Klasick\u00fd M\u016fj seznam',
            itemCount: { one: '{count} polo\u017eka', few: '{count} polo\u017eky', other: '{count} polo\u017eek' },
            initializing: 'Inicializace...',
            orderChangedPrompt: "Po\u0159ad\u00ed v M\u00e9m seznamu se zm\u011bnilo. Prove\u010fte inicializaci znovu.",
            orderChangedOk: "OK",
            orderChangedCancel: "Zru\u0161it",
            initTime: 'Inicializace {seconds}s',
            showOriginalMyList: 'Zobrazit p\u016fvodn\u00ed M\u016fj seznam',
            hideOriginalMyList: 'Skr\u00fdt p\u016fvodn\u00ed M\u016fj seznam',
            emptyMessage: 'Zde najdete ulo\u017een\u00e9 filmy a seri\u00e1ly.',
            relayoutInProgress: 'Prob\u00edh\u00e1 nov\u00e9 rozlo\u017een\u00ed...',
            relayoutFailed: 'Nov\u00e9 rozlo\u017een\u00ed se nezda\u0159ilo',
            initializationFailed: 'Klasick\u00fd M\u016fj seznam: chyba - {message}',
            noNativeCards: 'P\u016fvodn\u00ed karty Netflix se nepoda\u0159ilo na\u010d\u00edst.',
            errorCount: 'Chyba-{count}',
        },
        'el': {
            legacyMyList: '\u039a\u03bb\u03b1\u03c3\u03b9\u03ba\u03ae \u03bb\u03af\u03c3\u03c4\u03b1 \u03bc\u03bf\u03c5',
            itemCount: { one: '{count} \u03c3\u03c4\u03bf\u03b9\u03c7\u03b5\u03af\u03bf', other: '{count} \u03c3\u03c4\u03bf\u03b9\u03c7\u03b5\u03af\u03b1' },
            initializing: '\u0391\u03c1\u03c7\u03b9\u03ba\u03bf\u03c0\u03bf\u03af\u03b7\u03c3\u03b7...',
            orderChangedPrompt: "\u0397 \u03c3\u03b5\u03b9\u03c1\u03ac \u03c3\u03c4\u03b7 \u03bb\u03af\u03c3\u03c4\u03b1 \u03bc\u03bf\u03c5 \u03ac\u03bb\u03bb\u03b1\u03be\u03b5. \u0395\u03ba\u03c4\u03b5\u03bb\u03ad\u03c3\u03c4\u03b5 \u03be\u03b1\u03bd\u03ac \u03b1\u03c1\u03c7\u03b9\u03ba\u03bf\u03c0\u03bf\u03af\u03b7\u03c3\u03b7.",
            orderChangedOk: "OK",
            orderChangedCancel: "\u0391\u03ba\u03cd\u03c1\u03c9\u03c3\u03b7",
            initTime: '\u0388\u03bd\u03b1\u03c1\u03be\u03b7 {seconds}s',
            showOriginalMyList: '\u0395\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03b1\u03c1\u03c7\u03b9\u03ba\u03ae\u03c2 \u03bb\u03af\u03c3\u03c4\u03b1\u03c2 \u03bc\u03bf\u03c5',
            hideOriginalMyList: '\u0391\u03c0\u03cc\u03ba\u03c1\u03c5\u03c8\u03b7 \u03b1\u03c1\u03c7\u03b9\u03ba\u03ae\u03c2 \u03bb\u03af\u03c3\u03c4\u03b1\u03c2 \u03bc\u03bf\u03c5',
            emptyMessage: '\u0395\u03b4\u03ce \u03b8\u03b1 \u03b2\u03c1\u03b5\u03af\u03c4\u03b5 \u03c4\u03b9\u03c2 \u03c4\u03b1\u03b9\u03bd\u03af\u03b5\u03c2 \u03ba\u03b1\u03b9 \u03c4\u03b9\u03c2 \u03c3\u03b5\u03b9\u03c1\u03ad\u03c2 \u03c0\u03bf\u03c5 \u03ad\u03c7\u03b5\u03c4\u03b5 \u03b1\u03c0\u03bf\u03b8\u03b7\u03ba\u03b5\u03cd\u03c3\u03b5\u03b9.',
            relayoutInProgress: '\u0391\u03bd\u03b1\u03b4\u03b9\u03ac\u03c4\u03b1\u03be\u03b7...',
            relayoutFailed: '\u0397 \u03b1\u03bd\u03b1\u03b4\u03b9\u03ac\u03c4\u03b1\u03be\u03b7 \u03b1\u03c0\u03ad\u03c4\u03c5\u03c7\u03b5',
            initializationFailed: '\u039a\u03bb\u03b1\u03c3\u03b9\u03ba\u03ae \u03bb\u03af\u03c3\u03c4\u03b1 \u03bc\u03bf\u03c5: \u03c3\u03c6\u03ac\u03bb\u03bc\u03b1 - {message}',
            noNativeCards: '\u0394\u03b5\u03bd \u03ae\u03c4\u03b1\u03bd \u03b4\u03c5\u03bd\u03b1\u03c4\u03ae \u03b7 \u03bb\u03ae\u03c8\u03b7 \u03c4\u03c9\u03bd \u03b1\u03c1\u03c7\u03b9\u03ba\u03ce\u03bd \u03ba\u03b1\u03c1\u03c4\u03ce\u03bd Netflix.',
            errorCount: '\u03a3\u03c6\u03ac\u03bb\u03bc\u03b1-{count}',
        },
        'ru': {
            legacyMyList: '\u041a\u043b\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u00ab\u041c\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            itemCount: { one: '{count} \u044d\u043b\u0435\u043c\u0435\u043d\u0442', few: '{count} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430', many: '{count} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432', other: '{count} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430' },
            initializing: '\u0418\u043d\u0438\u0446\u0438\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f...',
            orderChangedPrompt: "\u041f\u043e\u0440\u044f\u0434\u043e\u043a \u0432 \u00ab\u041c\u043e\u0451\u043c \u0441\u043f\u0438\u0441\u043a\u0435\u00bb \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f. \u0412\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0438\u043d\u0438\u0446\u0438\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044e \u0441\u043d\u043e\u0432\u0430.",
            orderChangedOk: "OK",
            orderChangedCancel: "\u041e\u0442\u043c\u0435\u043d\u0430",
            initTime: '\u0418\u043d\u0438\u0446\u0438\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f {seconds}s',
            showOriginalMyList: '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u00ab\u041c\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            hideOriginalMyList: '\u0421\u043a\u0440\u044b\u0442\u044c \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u00ab\u041c\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            emptyMessage: '\u0417\u0434\u0435\u0441\u044c \u043d\u0430\u0445\u043e\u0434\u044f\u0442\u0441\u044f \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043d\u044b\u0435 \u0432\u0430\u043c\u0438 \u0444\u0438\u043b\u044c\u043c\u044b \u0438 \u0441\u0435\u0440\u0438\u0430\u043b\u044b.',
            relayoutInProgress: '\u041f\u0435\u0440\u0435\u043a\u043e\u043c\u043f\u043e\u043d\u043e\u0432\u043a\u0430...',
            relayoutFailed: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043a\u043e\u043c\u043f\u043e\u043d\u043e\u0432\u043a\u0443',
            initializationFailed: '\u041a\u043b\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u00ab\u041c\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb: \u043e\u0448\u0438\u0431\u043a\u0430 - {message}',
            noNativeCards: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 Netflix.',
            errorCount: '\u041e\u0448\u0438\u0431\u043a\u0430-{count}',
        },
        'uk': {
            legacyMyList: '\u041a\u043b\u0430\u0441\u0438\u0447\u043d\u0438\u0439 \u00ab\u041c\u0456\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            itemCount: { one: '{count} \u0435\u043b\u0435\u043c\u0435\u043d\u0442', few: '{count} \u0435\u043b\u0435\u043c\u0435\u043d\u0442\u0438', many: '{count} \u0435\u043b\u0435\u043c\u0435\u043d\u0442\u0456\u0432', other: '{count} \u0435\u043b\u0435\u043c\u0435\u043d\u0442\u0430' },
            initializing: '\u0406\u043d\u0456\u0446\u0456\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u044f...',
            orderChangedPrompt: "\u041f\u043e\u0440\u044f\u0434\u043e\u043a \u0443 \u00ab\u041c\u043e\u0454\u043c\u0443 \u0441\u043f\u0438\u0441\u043a\u0443\u00bb \u0437\u043c\u0456\u043d\u0438\u0432\u0441\u044f. \u0412\u0438\u043a\u043e\u043d\u0430\u0439\u0442\u0435 \u0456\u043d\u0456\u0446\u0456\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u044e \u0437\u043d\u043e\u0432\u0443.",
            orderChangedOk: "OK",
            orderChangedCancel: "\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438",
            initTime: '\u0406\u043d\u0456\u0446\u0456\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u044f {seconds}s',
            showOriginalMyList: '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u0438 \u043e\u0440\u0438\u0433\u0456\u043d\u0430\u043b\u044c\u043d\u0438\u0439 \u00ab\u041c\u0456\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            hideOriginalMyList: '\u0421\u0445\u043e\u0432\u0430\u0442\u0438 \u043e\u0440\u0438\u0433\u0456\u043d\u0430\u043b\u044c\u043d\u0438\u0439 \u00ab\u041c\u0456\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb',
            emptyMessage: '\u0422\u0443\u0442 \u0432\u0438 \u0437\u043d\u0430\u0439\u0434\u0435\u0442\u0435 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0456 \u0444\u0456\u043b\u044c\u043c\u0438 \u0442\u0430 \u0441\u0435\u0440\u0456\u0430\u043b\u0438.',
            relayoutInProgress: '\u041f\u0435\u0440\u0435\u043a\u043e\u043c\u043f\u043e\u043d\u0443\u0432\u0430\u043d\u043d\u044f...',
            relayoutFailed: '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u043c\u0456\u043d\u0438\u0442\u0438 \u043a\u043e\u043c\u043f\u043e\u043d\u0443\u0432\u0430\u043d\u043d\u044f',
            initializationFailed: '\u041a\u043b\u0430\u0441\u0438\u0447\u043d\u0438\u0439 \u00ab\u041c\u0456\u0439 \u0441\u043f\u0438\u0441\u043e\u043a\u00bb: \u043f\u043e\u043c\u0438\u043b\u043a\u0430 - {message}',
            noNativeCards: '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u043e\u0442\u0440\u0438\u043c\u0430\u0442\u0438 \u043e\u0440\u0438\u0433\u0456\u043d\u0430\u043b\u044c\u043d\u0456 \u043a\u0430\u0440\u0442\u043a\u0438 Netflix.',
            errorCount: '\u041f\u043e\u043c\u0438\u043b\u043a\u0430-{count}',
        },
        'he': {
            legacyMyList: '\u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9 \u05d4\u05e7\u05dc\u05d0\u05e1\u05d9\u05ea',
            itemCount: { one: '{count} \u05e4\u05e8\u05d9\u05d8', two: '{count} \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd', other: '{count} \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd' },
            initializing: '\u05de\u05d0\u05ea\u05d7\u05dc...',
            orderChangedPrompt: "\u05d4\u05e1\u05d3\u05e8 \u05d1\u05f4\u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9\u05f4 \u05d4\u05e9\u05ea\u05e0\u05d4. \u05d9\u05e9 \u05dc\u05d0\u05ea\u05d7\u05dc \u05de\u05d7\u05d3\u05e9.",
            orderChangedOk: "\u05d0\u05d9\u05e9\u05d5\u05e8",
            orderChangedCancel: "\u05d1\u05d9\u05d8\u05d5\u05dc",
            initTime: '\u05d0\u05ea\u05d7\u05d5\u05dc {seconds} \u05e9\u05e0\u05f3',
            showOriginalMyList: '\u05d4\u05e6\u05d2 \u05d0\u05ea \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9 \u05d4\u05de\u05e7\u05d5\u05e8\u05d9\u05ea',
            hideOriginalMyList: '\u05d4\u05e1\u05ea\u05e8 \u05d0\u05ea \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9 \u05d4\u05de\u05e7\u05d5\u05e8\u05d9\u05ea',
            emptyMessage: '\u05db\u05d0\u05df \u05d0\u05e4\u05e9\u05e8 \u05dc\u05de\u05e6\u05d5\u05d0 \u05d0\u05ea \u05d4\u05e1\u05e8\u05d8\u05d9\u05dd \u05d5\u05d4\u05e1\u05d3\u05e8\u05d5\u05ea \u05e9\u05e9\u05de\u05e8\u05ea.',
            relayoutInProgress: '\u05de\u05e1\u05d3\u05e8 \u05de\u05d7\u05d3\u05e9...',
            relayoutFailed: '\u05d4\u05e1\u05d9\u05d3\u05d5\u05e8 \u05de\u05d7\u05d3\u05e9 \u05e0\u05db\u05e9\u05dc',
            initializationFailed: '\u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9 \u05d4\u05e7\u05dc\u05d0\u05e1\u05d9\u05ea: \u05e9\u05d2\u05d9\u05d0\u05d4 - {message}',
            noNativeCards: '\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05d4\u05d9\u05d4 \u05dc\u05e7\u05d1\u05dc \u05d0\u05ea \u05db\u05e8\u05d8\u05d9\u05e1\u05d9 Netflix \u05d4\u05de\u05e7\u05d5\u05e8\u05d9\u05d9\u05dd.',
            errorCount: '\u05e9\u05d2\u05d9\u05d0\u05d4-{count}',
        },
        'ar': {
            legacyMyList: '\u0642\u0627\u0626\u0645\u062a\u064a \u0627\u0644\u0643\u0644\u0627\u0633\u064a\u0643\u064a\u0629',
            itemCount: { zero: '{count} \u0639\u0646\u0635\u0631', one: '{count} \u0639\u0646\u0635\u0631', two: '{count} \u0639\u0646\u0635\u0631\u0627\u0646', few: '{count} \u0639\u0646\u0627\u0635\u0631', many: '{count} \u0639\u0646\u0635\u0631\u064b\u0627', other: '{count} \u0639\u0646\u0635\u0631' },
            initializing: '\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0647\u064a\u0626\u0629...',
            orderChangedPrompt: "\u062a\u063a\u064a\u0651\u0631 \u062a\u0631\u062a\u064a\u0628 \u00ab\u0642\u0627\u0626\u0645\u062a\u064a\u00bb. \u064a\u064f\u0631\u062c\u0649 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u0647\u064a\u0626\u0629.",
            orderChangedOk: "\u0645\u0648\u0627\u0641\u0642",
            orderChangedCancel: "\u0625\u0644\u063a\u0627\u0621",
            initTime: '\u062a\u0647\u064a\u0626\u0629 {seconds}\u062b',
            showOriginalMyList: '\u0625\u0638\u0647\u0627\u0631 \u0642\u0627\u0626\u0645\u062a\u064a \u0627\u0644\u0623\u0635\u0644\u064a\u0629',
            hideOriginalMyList: '\u0625\u062e\u0641\u0627\u0621 \u0642\u0627\u0626\u0645\u062a\u064a \u0627\u0644\u0623\u0635\u0644\u064a\u0629',
            emptyMessage: '\u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0639\u062b\u0648\u0631 \u0647\u0646\u0627 \u0639\u0644\u0649 \u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0628\u0631\u0627\u0645\u062c \u0627\u0644\u062a\u0644\u0641\u0632\u064a\u0648\u0646\u064a\u0629 \u0627\u0644\u062a\u064a \u062d\u0641\u0638\u062a\u0647\u0627.',
            relayoutInProgress: '\u062c\u0627\u0631\u064d \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u0631\u062a\u064a\u0628...',
            relayoutFailed: '\u0641\u0634\u0644\u062a \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u0631\u062a\u064a\u0628',
            initializationFailed: '\u0642\u0627\u0626\u0645\u062a\u064a \u0627\u0644\u0643\u0644\u0627\u0633\u064a\u0643\u064a\u0629: \u062e\u0637\u0623 - {message}',
            noNativeCards: '\u062a\u0639\u0630\u0631 \u0627\u0644\u062d\u0635\u0648\u0644 \u0639\u0644\u0649 \u0628\u0637\u0627\u0642\u0627\u062a Netflix \u0627\u0644\u0623\u0635\u0644\u064a\u0629.',
            errorCount: '\u062e\u0637\u0623-{count}',
        },
        'hi': {
            legacyMyList: '\u0915\u094d\u0932\u093e\u0938\u093f\u0915 \u092e\u0947\u0930\u0940 \u0938\u0942\u091a\u0940',
            itemCount: { other: '{count} \u0906\u0907\u091f\u092e' },
            initializing: '\u0906\u0930\u0902\u092d \u0915\u093f\u092f\u093e \u091c\u093e \u0930\u0939\u093e \u0939\u0948...',
            orderChangedPrompt: "\u092e\u0947\u0930\u0940 \u0938\u0942\u091a\u0940 \u0915\u093e \u0915\u094d\u0930\u092e \u092c\u0926\u0932 \u0917\u092f\u093e \u0939\u0948\u0964 \u0915\u0943\u092a\u092f\u093e \u092b\u093f\u0930 \u0938\u0947 \u0906\u0930\u0902\u092d \u0915\u0930\u0947\u0902\u0964",
            orderChangedOk: "\u0920\u0940\u0915 \u0939\u0948",
            orderChangedCancel: "\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902",
            initTime: '\u0906\u0930\u0902\u092d {seconds}\u0938\u0947',
            showOriginalMyList: '\u092e\u0942\u0932 \u092e\u0947\u0930\u0940 \u0938\u0942\u091a\u0940 \u0926\u093f\u0916\u093e\u090f\u0901',
            hideOriginalMyList: '\u092e\u0942\u0932 \u092e\u0947\u0930\u0940 \u0938\u0942\u091a\u0940 \u091b\u093f\u092a\u093e\u090f\u0901',
            emptyMessage: '\u0906\u092a\u0928\u0947 \u091c\u094b \u092b\u093c\u093f\u0932\u094d\u092e\u0947\u0902 \u0914\u0930 \u091f\u0940\u0935\u0940 \u0936\u094b \u0938\u0939\u0947\u091c\u0947 \u0939\u0948\u0902, \u0935\u0947 \u092f\u0939\u093e\u0901 \u092e\u093f\u0932\u0947\u0902\u0917\u0947\u0964',
            relayoutInProgress: '\u092b\u093f\u0930 \u0938\u0947 \u0935\u094d\u092f\u0935\u0938\u094d\u0925\u093f\u0924 \u0915\u093f\u092f\u093e \u091c\u093e \u0930\u0939\u093e \u0939\u0948...',
            relayoutFailed: '\u092a\u0941\u0928\u0930\u094d\u0935\u094d\u092f\u0935\u0938\u094d\u0925\u093e \u0935\u093f\u092b\u0932',
            initializationFailed: '\u0915\u094d\u0932\u093e\u0938\u093f\u0915 \u092e\u0947\u0930\u0940 \u0938\u0942\u091a\u0940: \u0924\u094d\u0930\u0941\u091f\u093f - {message}',
            noNativeCards: '\u092e\u0942\u0932 Netflix \u0915\u093e\u0930\u094d\u0921 \u092a\u094d\u0930\u093e\u092a\u094d\u0924 \u0928\u0939\u0940\u0902 \u0915\u093f\u090f \u091c\u093e \u0938\u0915\u0947\u0964',
            errorCount: '\u0924\u094d\u0930\u0941\u091f\u093f-{count}',
        },
        'th': {
            legacyMyList: '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19\u0e41\u0e1a\u0e1a\u0e04\u0e25\u0e32\u0e2a\u0e2a\u0e34\u0e01',
            itemCount: { other: '{count} \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23' },
            initializing: '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e40\u0e23\u0e34\u0e48\u0e21\u0e15\u0e49\u0e19...',
            orderChangedPrompt: "\u0e25\u0e33\u0e14\u0e31\u0e1a\u0e43\u0e19\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e44\u0e1b \u0e42\u0e1b\u0e23\u0e14\u0e40\u0e23\u0e34\u0e48\u0e21\u0e15\u0e49\u0e19\u0e43\u0e2b\u0e21\u0e48\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07",
            orderChangedOk: "\u0e15\u0e01\u0e25\u0e07",
            orderChangedCancel: "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01",
            initTime: '\u0e40\u0e23\u0e34\u0e48\u0e21\u0e15\u0e49\u0e19 {seconds} \u0e27\u0e34\u0e19\u0e32\u0e17\u0e35',
            showOriginalMyList: '\u0e41\u0e2a\u0e14\u0e07\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19\u0e15\u0e49\u0e19\u0e09\u0e1a\u0e31\u0e1a',
            hideOriginalMyList: '\u0e0b\u0e48\u0e2d\u0e19\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19\u0e15\u0e49\u0e19\u0e09\u0e1a\u0e31\u0e1a',
            emptyMessage: '\u0e04\u0e38\u0e13\u0e08\u0e30\u0e1e\u0e1a\u0e20\u0e32\u0e1e\u0e22\u0e19\u0e15\u0e23\u0e4c\u0e41\u0e25\u0e30\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e17\u0e35\u0e27\u0e35\u0e17\u0e35\u0e48\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e27\u0e49\u0e44\u0e14\u0e49\u0e17\u0e35\u0e48\u0e19\u0e35\u0e48',
            relayoutInProgress: '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e08\u0e31\u0e14\u0e27\u0e32\u0e07\u0e43\u0e2b\u0e21\u0e48...',
            relayoutFailed: '\u0e08\u0e31\u0e14\u0e27\u0e32\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08',
            initializationFailed: '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19\u0e41\u0e1a\u0e1a\u0e04\u0e25\u0e32\u0e2a\u0e2a\u0e34\u0e01: \u0e02\u0e49\u0e2d\u0e1c\u0e34\u0e14\u0e1e\u0e25\u0e32\u0e14 - {message}',
            noNativeCards: '\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e14\u0e36\u0e07\u0e01\u0e32\u0e23\u0e4c\u0e14 Netflix \u0e15\u0e49\u0e19\u0e09\u0e1a\u0e31\u0e1a\u0e44\u0e14\u0e49',
            errorCount: '\u0e02\u0e49\u0e2d\u0e1c\u0e34\u0e14\u0e1e\u0e25\u0e32\u0e14-{count}',
        },
        'zh': {
            legacyMyList: '\u65e7\u7248\u201c\u6211\u7684\u7247\u5355\u201d',
            itemCount: { other: '{count}\u9879' },
            initializing: '\u6b63\u5728\u521d\u59cb\u5316...',
            orderChangedPrompt: "\u201c\u6211\u7684\u7247\u5355\u201d\u7684\u987a\u5e8f\u5df2\u66f4\u6539\u3002\u8bf7\u91cd\u65b0\u521d\u59cb\u5316\u3002",
            orderChangedOk: "\u786e\u5b9a",
            orderChangedCancel: "\u53d6\u6d88",
            initTime: '\u521d\u59cb\u5316 {seconds}\u79d2',
            showOriginalMyList: '\u663e\u793a\u539f\u59cb\u201c\u6211\u7684\u7247\u5355\u201d',
            hideOriginalMyList: '\u9690\u85cf\u539f\u59cb\u201c\u6211\u7684\u7247\u5355\u201d',
            emptyMessage: '\u4f60\u4fdd\u5b58\u7684\u7535\u5f71\u548c\u7535\u89c6\u8282\u76ee\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002',
            relayoutInProgress: '\u6b63\u5728\u91cd\u65b0\u5e03\u5c40...',
            relayoutFailed: '\u91cd\u65b0\u5e03\u5c40\u5931\u8d25',
            initializationFailed: '\u65e7\u7248\u201c\u6211\u7684\u7247\u5355\u201d\uff1a\u5931\u8d25 - {message}',
            noNativeCards: '\u65e0\u6cd5\u83b7\u53d6 Netflix \u539f\u59cb\u5361\u7247\u3002',
            errorCount: '\u9519\u8bef-{count}',
        },
        'ja': {
            legacyMyList: '\u65e7\u30de\u30a4\u30ea\u30b9\u30c8',
            itemCount: { other: '{count}\u4ef6' },
            initializing: '\u521d\u671f\u5316\u4e2d...',
            orderChangedPrompt: "\u30de\u30a4\u30ea\u30b9\u30c8\u306e\u4e26\u3073\u9806\u304c\u5909\u308f\u308a\u307e\u3057\u305f\u3002\u521d\u671f\u5316\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
            orderChangedOk: "OK",
            orderChangedCancel: "\u30ad\u30e3\u30f3\u30bb\u30eb",
            initTime: '\u521d\u671f\u5316 {seconds}\u79d2',
            showOriginalMyList: '\u30aa\u30ea\u30b8\u30ca\u30eb\u306e\u30de\u30a4\u30ea\u30b9\u30c8\u3092\u8868\u793a\u3059\u308b',
            hideOriginalMyList: '\u30aa\u30ea\u30b8\u30ca\u30eb\u306e\u30de\u30a4\u30ea\u30b9\u30c8\u3092\u975e\u8868\u793a\u306b\u3059\u308b',
            emptyMessage: '\u4fdd\u5b58\u3057\u305f\u6620\u753b\u3084\u30c9\u30e9\u30de\u3092\u3053\u3061\u3089\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002',
            relayoutInProgress: '\u518d\u914d\u7f6e\u4e2d',
            relayoutFailed: '\u518d\u914d\u7f6e\u5931\u6557',
            initializationFailed: '\u65e7\u30de\u30a4\u30ea\u30b9\u30c8: \u5931\u6557 - {message}',
            noNativeCards: 'Netflix\u7d14\u6b63\u30ab\u30fc\u30c9\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
            errorCount: 'Error-{count}',
        },
        'ko': {
            legacyMyList: '\uc774\uc804 \ubc84\uc804 \ub098\uc758 \ubaa9\ub85d',
            itemCount: { other: '{count}\uac1c' },
            initializing: '\ucd08\uae30\ud654 \uc911...',
            orderChangedPrompt: "\ub0b4 \ubaa9\ub85d\uc758 \uc21c\uc11c\uac00 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \ucd08\uae30\ud654\ud574 \uc8fc\uc138\uc694.",
            orderChangedOk: "\ud655\uc778",
            orderChangedCancel: "\ucde8\uc18c",
            initTime: '\ucd08\uae30\ud654 {seconds}\ucd08',
            showOriginalMyList: '\uc6d0\ubcf8 \ub098\uc758 \ubaa9\ub85d \ud45c\uc2dc',
            hideOriginalMyList: '\uc6d0\ubcf8 \ub098\uc758 \ubaa9\ub85d \uc228\uae30\uae30',
            emptyMessage: '\uc800\uc7a5\ud55c \uc601\ud654\uc640 TV \ud504\ub85c\uadf8\ub7a8\uc744 \uc5ec\uae30\uc5d0\uc11c \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.',
            relayoutInProgress: '\ub808\uc774\uc544\uc6c3 \uc870\uc815 \uc911...',
            relayoutFailed: '\ub808\uc774\uc544\uc6c3 \uc870\uc815 \uc2e4\ud328',
            initializationFailed: '\uc774\uc804 \ubc84\uc804 \ub098\uc758 \ubaa9\ub85d: \uc2e4\ud328 - {message}',
            noNativeCards: 'Netflix \uc6d0\ubcf8 \uce74\ub4dc\ub97c \uac00\uc838\uc62c \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
            errorCount: '\uc624\ub958-{count}',
        },
    };

    const VIEWING_UI_MESSAGES = {
        'en': ["Watched / Caught up", "Refresh viewing status", "Checking viewing status...", "Viewing status unavailable for {count} titles. They remain in the main list.", "You are caught up with everything in your list."],
        'de': ["Gesehen / Auf dem neuesten Stand", "Sehstatus aktualisieren", "Sehstatus wird gepr\u00fcft...", "Sehstatus f\u00fcr {count} Titel nicht verf\u00fcgbar. Sie bleiben in der Hauptliste.", "Du hast alle Titel in deiner Liste gesehen."],
        'da': ["Set / Ajour", "Opdater visningsstatus", "Kontrollerer visningsstatus...", "Visningsstatus er ikke tilg\u00e6ngelig for {count} titler. De bliver p\u00e5 hovedlisten.", "Du har set alt p\u00e5 din liste."],
        'es': ["Visto / Al d\u00eda", "Actualizar estado de visualizaci\u00f3n", "Comprobando el estado de visualizaci\u00f3n...", "Estado no disponible para {count} t\u00edtulos. Permanecen en la lista principal.", "Has visto todo lo que hay en tu lista."],
        'fil': ["Napanood / Updated", "I-refresh ang status ng panonood", "Sinusuri ang status ng panonood...", "Hindi available ang status ng {count} pamagat. Mananatili sila sa pangunahing listahan.", "Napanood mo na ang lahat sa iyong listahan."],
        'fr': ["Vu / \u00c0 jour", "Actualiser le statut de visionnage", "V\u00e9rification du statut de visionnage...", "Statut indisponible pour {count} titres. Ils restent dans la liste principale.", "Vous avez tout vu dans votre liste."],
        'hr': ["Pogledano / Sve pogledano", "Osvje\u017ei status gledanja", "Provjera statusa gledanja...", "Status nije dostupan za {count} naslova. Ostaju na glavnom popisu.", "Pogledali ste sve na svom popisu."],
        'id': ["Sudah ditonton / Sudah mengikuti semua episode", "Perbarui status tontonan", "Memeriksa status tontonan...", "Status tidak tersedia untuk {count} judul. Judul tetap ada di daftar utama.", "Kamu sudah menonton semua yang ada di daftar."],
        'it': ["Visto / In pari", "Aggiorna lo stato di visione", "Verifica dello stato di visione...", "Stato non disponibile per {count} titoli. Rimangono nella lista principale.", "Hai visto tutto ci\u00f2 che \u00e8 nella tua lista."],
        'hu': ["Megn\u00e9zve / Naprak\u00e9sz", "Megtekint\u00e9si \u00e1llapot friss\u00edt\u00e9se", "Megtekint\u00e9si \u00e1llapot ellen\u0151rz\u00e9se...", "{count} m\u0171sor \u00e1llapota nem \u00e9rhet\u0151 el. A f\u0151 list\u00e1ban maradnak.", "Mindent megn\u00e9zt\u00e9l a list\u00e1don."],
        'ms': ["Sudah ditonton / Sudah mengikuti semua episod", "Kemas kini status tontonan", "Menyemak status tontonan...", "Status tidak tersedia untuk {count} tajuk. Tajuk kekal dalam senarai utama.", "Anda sudah menonton semua dalam senarai anda."],
        'nl': ["Bekeken / Bij", "Kijkstatus vernieuwen", "Kijkstatus controleren...", "Kijkstatus niet beschikbaar voor {count} titels. Ze blijven in de hoofdlijst.", "Je hebt alles in je lijst bekeken."],
        'nb': ["Sett / Ajour", "Oppdater visningsstatus", "Kontrollerer visningsstatus...", "Visningsstatus er utilgjengelig for {count} titler. De blir i hovedlisten.", "Du har sett alt p\u00e5 listen din."],
        'pl': ["Obejrzane / Na bie\u017c\u0105co", "Od\u015bwie\u017c stan ogl\u0105dania", "Sprawdzanie stanu ogl\u0105dania...", "Stan {count} tytu\u0142\u00f3w jest niedost\u0119pny. Pozostaj\u0105 na g\u0142\u00f3wnej li\u015bcie.", "Wszystko na Twojej li\u015bcie jest obejrzane."],
        'pt': ["Visto / Em dia", "Atualizar estado de visualiza\u00e7\u00e3o", "A verificar o estado de visualiza\u00e7\u00e3o...", "Estado indispon\u00edvel para {count} t\u00edtulos. Permanecem na lista principal.", "J\u00e1 viu tudo na sua lista."],
        'ro': ["Vizionat / La zi", "Actualizeaz\u0103 starea vizion\u0103rii", "Se verific\u0103 starea vizion\u0103rii...", "Starea nu este disponibil\u0103 pentru {count} titluri. R\u0103m\u00e2n \u00een lista principal\u0103.", "Ai vizionat tot ce este \u00een lista ta."],
        'fi': ["Katsottu / Ajan tasalla", "P\u00e4ivit\u00e4 katselutila", "Tarkistetaan katselutilaa...", "{count} nimikkeen katselutila ei ole saatavilla. Ne pysyv\u00e4t p\u00e4\u00e4listassa.", "Olet katsonut kaiken listaltasi."],
        'sv': ["Sett / Ikapp", "Uppdatera visningsstatus", "Kontrollerar visningsstatus...", "Visningsstatus saknas f\u00f6r {count} titlar. De finns kvar i huvudlistan.", "Du har sett allt p\u00e5 din lista."],
        'vi': ["\u0110\u00e3 xem / \u0110\u00e3 xem h\u1ebft c\u00e1c t\u1eadp hi\u1ec7n c\u00f3", "C\u1eadp nh\u1eadt tr\u1ea1ng th\u00e1i xem", "\u0110ang ki\u1ec3m tra tr\u1ea1ng th\u00e1i xem...", "Kh\u00f4ng c\u00f3 tr\u1ea1ng th\u00e1i c\u1ee7a {count} t\u1ef1a phim. Ch\u00fang v\u1eabn \u1edf danh s\u00e1ch ch\u00ednh.", "B\u1ea1n \u0111\u00e3 xem h\u1ebft m\u1ecdi n\u1ed9i dung trong danh s\u00e1ch."],
        'tr': ["\u0130zlendi / G\u00fcncel b\u00f6l\u00fcmler izlendi", "\u0130zleme durumunu yenile", "\u0130zleme durumu kontrol ediliyor...", "{count} i\u00e7eri\u011fin durumu kullan\u0131lam\u0131yor. Ana listede kal\u0131rlar.", "Listenizdeki t\u00fcm i\u00e7erikleri izlediniz."],
        'cs': ["Zhl\u00e9dnuto / V\u0161echny d\u00edly zhl\u00e9dnuty", "Aktualizovat stav sledov\u00e1n\u00ed", "Kontrola stavu sledov\u00e1n\u00ed...", "Stav {count} titul\u016f nen\u00ed dostupn\u00fd. Z\u016fst\u00e1vaj\u00ed v hlavn\u00edm seznamu.", "Zhl\u00e9dli jste v\u0161e ve sv\u00e9m seznamu."],
        'el': ["\u03a0\u03c1\u03bf\u03b2\u03bb\u03ae\u03b8\u03b7\u03ba\u03b5 / \u038c\u03bb\u03b1 \u03c4\u03b1 \u03b4\u03b9\u03b1\u03b8\u03ad\u03c3\u03b9\u03bc\u03b1 \u03b5\u03c0\u03b5\u03b9\u03c3\u03cc\u03b4\u03b9\u03b1 \u03c0\u03c1\u03bf\u03b2\u03bb\u03ae\u03b8\u03b7\u03ba\u03b1\u03bd", "\u0391\u03bd\u03b1\u03bd\u03ad\u03c9\u03c3\u03b7 \u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7\u03c2 \u03c0\u03c1\u03bf\u03b2\u03bf\u03bb\u03ae\u03c2", "\u0388\u03bb\u03b5\u03b3\u03c7\u03bf\u03c2 \u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7\u03c2 \u03c0\u03c1\u03bf\u03b2\u03bf\u03bb\u03ae\u03c2...", "\u039c\u03b7 \u03b4\u03b9\u03b1\u03b8\u03ad\u03c3\u03b9\u03bc\u03b7 \u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7 \u03b3\u03b9\u03b1 {count} \u03c4\u03af\u03c4\u03bb\u03bf\u03c5\u03c2. \u03a0\u03b1\u03c1\u03b1\u03bc\u03ad\u03bd\u03bf\u03c5\u03bd \u03c3\u03c4\u03b7\u03bd \u03ba\u03cd\u03c1\u03b9\u03b1 \u03bb\u03af\u03c3\u03c4\u03b1.", "\u0388\u03c7\u03b5\u03c4\u03b5 \u03b4\u03b5\u03b9 \u03c4\u03b1 \u03c0\u03ac\u03bd\u03c4\u03b1 \u03c3\u03c4\u03b7 \u03bb\u03af\u03c3\u03c4\u03b1 \u03c3\u03b1\u03c2."],
        'ru': ["\u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043e / \u0412\u0441\u0435 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0441\u0435\u0440\u0438\u0438 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u044b", "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0443\u0441 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0430", "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0430...", "\u0421\u0442\u0430\u0442\u0443\u0441 {count} \u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0439 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d. \u041e\u043d\u0438 \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u0432 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u043c \u0441\u043f\u0438\u0441\u043a\u0435.", "\u0412\u044b \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043b\u0438 \u0432\u0441\u0451 \u0432 \u0441\u0432\u043e\u0451\u043c \u0441\u043f\u0438\u0441\u043a\u0435."],
        'uk': ["\u041f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u043e / \u0423\u0441\u0456 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0456 \u0441\u0435\u0440\u0456\u0457 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u043e", "\u041e\u043d\u043e\u0432\u0438\u0442\u0438 \u0441\u0442\u0430\u043d \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434\u0443", "\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0430 \u0441\u0442\u0430\u043d\u0443 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434\u0443...", "\u0421\u0442\u0430\u043d {count} \u043d\u0430\u0439\u043c\u0435\u043d\u0443\u0432\u0430\u043d\u044c \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0438\u0439. \u0412\u043e\u043d\u0438 \u0437\u0430\u043b\u0438\u0448\u0430\u044e\u0442\u044c\u0441\u044f \u0432 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u043c\u0443 \u0441\u043f\u0438\u0441\u043a\u0443.", "\u0412\u0438 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u043b\u0438 \u0432\u0441\u0435 \u0443 \u0441\u0432\u043e\u0454\u043c\u0443 \u0441\u043f\u0438\u0441\u043a\u0443."],
        'he': ["\u05e0\u05e6\u05e4\u05d4 / \u05db\u05dc \u05d4\u05e4\u05e8\u05e7\u05d9\u05dd \u05d4\u05d6\u05de\u05d9\u05e0\u05d9\u05dd \u05e0\u05e6\u05e4\u05d5", "\u05e8\u05e2\u05e0\u05d5\u05df \u05de\u05e6\u05d1 \u05e6\u05e4\u05d9\u05d9\u05d4", "\u05d1\u05d3\u05d9\u05e7\u05ea \u05de\u05e6\u05d1 \u05e6\u05e4\u05d9\u05d9\u05d4...", "\u05de\u05e6\u05d1 \u05d4\u05e6\u05e4\u05d9\u05d9\u05d4 \u05d0\u05d9\u05e0\u05d5 \u05d6\u05de\u05d9\u05df \u05e2\u05d1\u05d5\u05e8 {count} \u05db\u05d5\u05ea\u05e8\u05d9\u05dd. \u05d4\u05dd \u05e0\u05e9\u05d0\u05e8\u05d9\u05dd \u05d1\u05e8\u05e9\u05d9\u05de\u05d4 \u05d4\u05e8\u05d0\u05e9\u05d9\u05ea.", "\u05e6\u05e4\u05d9\u05ea \u05d1\u05db\u05dc \u05de\u05d4 \u05e9\u05d1\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05da."],
        'ar': ["\u062a\u0645\u062a \u0627\u0644\u0645\u0634\u0627\u0647\u062f\u0629 / \u062a\u0645\u062a \u0645\u0634\u0627\u0647\u062f\u0629 \u0643\u0644 \u0627\u0644\u062d\u0644\u0642\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629", "\u062a\u062d\u062f\u064a\u062b \u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0634\u0627\u0647\u062f\u0629", "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0634\u0627\u0647\u062f\u0629...", "\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0634\u0627\u0647\u062f\u0629 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629 \u0644\u0640 {count} \u0639\u0646\u0648\u0627\u0646\u064b\u0627. \u062a\u0628\u0642\u0649 \u0641\u064a \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629.", "\u0634\u0627\u0647\u062f\u062a \u0643\u0644 \u0645\u0627 \u0641\u064a \u0642\u0627\u0626\u0645\u062a\u0643."],
        'hi': ["\u0926\u0947\u0916 \u0932\u093f\u092f\u093e / \u0938\u092d\u0940 \u0909\u092a\u0932\u092c\u094d\u0927 \u090f\u092a\u093f\u0938\u094b\u0921 \u0926\u0947\u0916 \u0932\u093f\u090f", "\u0926\u0947\u0916\u0928\u0947 \u0915\u0940 \u0938\u094d\u0925\u093f\u0924\u093f \u0930\u0940\u092b\u093c\u094d\u0930\u0947\u0936 \u0915\u0930\u0947\u0902", "\u0926\u0947\u0916\u0928\u0947 \u0915\u0940 \u0938\u094d\u0925\u093f\u0924\u093f \u091c\u093e\u0901\u091a\u0940 \u091c\u093e \u0930\u0939\u0940 \u0939\u0948...", "{count} \u091f\u093e\u0907\u091f\u0932 \u0915\u0940 \u0938\u094d\u0925\u093f\u0924\u093f \u0909\u092a\u0932\u092c\u094d\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964 \u0935\u0947 \u092e\u0941\u0916\u094d\u092f \u0938\u0942\u091a\u0940 \u092e\u0947\u0902 \u0930\u0939\u0947\u0902\u0917\u0947\u0964", "\u0906\u092a\u0928\u0947 \u0905\u092a\u0928\u0940 \u0938\u0942\u091a\u0940 \u092e\u0947\u0902 \u0938\u092c \u0915\u0941\u091b \u0926\u0947\u0916 \u0932\u093f\u092f\u093e \u0939\u0948\u0964"],
        'th': ["\u0e14\u0e39\u0e41\u0e25\u0e49\u0e27 / \u0e14\u0e39\u0e04\u0e23\u0e1a\u0e17\u0e38\u0e01\u0e15\u0e2d\u0e19\u0e17\u0e35\u0e48\u0e21\u0e35\u0e41\u0e25\u0e49\u0e27", "\u0e23\u0e35\u0e40\u0e1f\u0e23\u0e0a\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e0a\u0e21", "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e0a\u0e21...", "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e0a\u0e21\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a {count} \u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07 \u0e08\u0e30\u0e41\u0e2a\u0e14\u0e07\u0e43\u0e19\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2b\u0e25\u0e31\u0e01\u0e15\u0e48\u0e2d\u0e44\u0e1b", "\u0e04\u0e38\u0e13\u0e14\u0e39\u0e17\u0e38\u0e01\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e43\u0e19\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e04\u0e23\u0e1a\u0e41\u0e25\u0e49\u0e27"],
        'zh': ["\u5df2\u89c2\u770b / \u5df2\u770b\u5b8c\u73b0\u6709\u5267\u96c6", "\u5237\u65b0\u89c2\u770b\u72b6\u6001", "\u6b63\u5728\u68c0\u67e5\u89c2\u770b\u72b6\u6001...", "{count} \u90e8\u4f5c\u54c1\u7684\u89c2\u770b\u72b6\u6001\u4e0d\u53ef\u7528\u3002\u5b83\u4eec\u5c06\u4fdd\u7559\u5728\u4e3b\u5217\u8868\u4e2d\u3002", "\u4f60\u5df2\u770b\u5b8c\u5217\u8868\u4e2d\u7684\u6240\u6709\u5185\u5bb9\u3002"],
        'ja': ["\u8996\u8074\u6e08\u307f / \u914d\u4fe1\u4e2d\u306e\u5168\u8a71\u3092\u8996\u8074\u6e08\u307f", "\u8996\u8074\u72b6\u6cc1\u3092\u66f4\u65b0", "\u8996\u8074\u72b6\u6cc1\u3092\u78ba\u8a8d\u4e2d...", "{count}\u4f5c\u54c1\u306e\u8996\u8074\u72b6\u6cc1\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u30e1\u30a4\u30f3\u30ea\u30b9\u30c8\u306b\u8868\u793a\u3057\u307e\u3059\u3002", "\u30ea\u30b9\u30c8\u5185\u306e\u3059\u3079\u3066\u306e\u4f5c\u54c1\u3092\u8996\u8074\u6e08\u307f\u3067\u3059\u3002"],
        'ko': ["\uc2dc\uccad \uc644\ub8cc / \uacf5\uac1c\ub41c \ubaa8\ub4e0 \ud68c\ucc28 \uc2dc\uccad \uc644\ub8cc", "\uc2dc\uccad \uc0c1\ud0dc \uc0c8\ub85c\uace0\uce68", "\uc2dc\uccad \uc0c1\ud0dc \ud655\uc778 \uc911...", "{count}\uac1c \uc791\ud488\uc758 \uc2dc\uccad \uc0c1\ud0dc\ub97c \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uae30\ubcf8 \ubaa9\ub85d\uc5d0 \uacc4\uc18d \ud45c\uc2dc\ub429\ub2c8\ub2e4.", "\ubaa9\ub85d\uc758 \ubaa8\ub4e0 \uc791\ud488\uc744 \uc2dc\uccad\ud588\uc2b5\ub2c8\ub2e4."],
    };
    for (const [locale, values] of Object.entries(VIEWING_UI_MESSAGES)) {
        const keys = ['watchedCaughtUp', 'refreshViewingStatus', 'checkingViewingStatus', 'unknownViewingStatus', 'caughtUpMessage'];
        keys.forEach((key, index) => { UI_MESSAGES[locale][key] = values[index]; });
    }

    const TYPE_FILTER_UI_MESSAGES = {
        "da": ["Film", "Serier", "Alle", "Filtrer efter titeltype", "Ingen titler matcher dette filter.", "Ukendt titeltype: {count}. V\u00e6lg Alle for at se dem."],
        "de": ["Filme", "Serien", "Alle", "Nach Titeltyp filtern", "Keine Titel passen zu diesem Filter.", "Unbekannter Titeltyp: {count}. W\u00e4hle Alle, um diese Titel zu sehen."],
        "en": ["Films", "Series", "All", "Filter by title type", "No titles match this filter.", "Type unavailable for {count} titles. Choose All to see them."],
        "es": ["Pel\u00edculas", "Series", "Todo", "Filtrar por tipo de t\u00edtulo", "Ning\u00fan t\u00edtulo coincide con este filtro.", "Tipo desconocido: {count}. Selecciona Todo para ver esos t\u00edtulos."],
        "fil": ["Mga pelikula", "Mga serye", "Lahat", "I-filter ayon sa uri", "Walang pamagat na tumutugma sa filter na ito.", "Hindi alam ang uri ng {count} pamagat. Piliin ang Lahat para makita ang mga ito."],
        "fr": ["Films", "S\u00e9ries", "Tout", "Filtrer par type de titre", "Aucun titre ne correspond \u00e0 ce filtre.", "Type inconnu pour {count} titres. S\u00e9lectionnez Tout pour les voir."],
        "hr": ["Filmovi", "Serije", "Sve", "Filtriraj prema vrsti naslova", "Nema naslova koji odgovaraju ovom filtru.", "Nepoznata vrsta za {count} naslova. Odaberi Sve za prikaz."],
        "id": ["Film", "Serial", "Semua", "Filter menurut jenis judul", "Tidak ada judul yang cocok dengan filter ini.", "Jenis tidak diketahui untuk {count} judul. Pilih Semua untuk melihatnya."],
        "it": ["Film", "Serie", "Tutti", "Filtra per tipo di titolo", "Nessun titolo corrisponde a questo filtro.", "Tipo sconosciuto per {count} titoli. Seleziona Tutti per vederli."],
        "hu": ["Filmek", "Sorozatok", "\u00d6sszes", "Sz\u0171r\u00e9s t\u00edpus szerint", "Egyetlen c\u00edm sem felel meg ennek a sz\u0171r\u0151nek.", "Ismeretlen t\u00edpus: {count}. Megjelen\u00edt\u00e9s\u00fckh\u00f6z v\u00e1laszd az \u00d6sszes lehet\u0151s\u00e9get."],
        "ms": ["Filem", "Siri", "Semua", "Tapis mengikut jenis tajuk", "Tiada tajuk sepadan dengan penapis ini.", "Jenis tidak diketahui untuk {count} tajuk. Pilih Semua untuk melihatnya."],
        "nl": ["Films", "Series", "Alles", "Filteren op titeltype", "Geen titels passen bij dit filter.", "Onbekend type voor {count} titels. Kies Alles om ze te zien."],
        "nb": ["Filmer", "Serier", "Alle", "Filtrer etter titteltype", "Ingen titler passer til dette filteret.", "Ukjent type for {count} titler. Velg Alle for \u00e5 se dem."],
        "pl": ["Filmy", "Seriale", "Wszystko", "Filtruj wed\u0142ug typu", "\u017baden tytu\u0142 nie pasuje do tego filtra.", "Nieznany typ: {count}. Wybierz Wszystko, aby zobaczy\u0107 te tytu\u0142y."],
        "pt": ["Filmes", "S\u00e9ries", "Tudo", "Filtrar por tipo de t\u00edtulo", "Nenhum t\u00edtulo corresponde a este filtro.", "Tipo desconhecido para {count} t\u00edtulos. Selecione Tudo para v\u00ea-los."],
        "ro": ["Filme", "Seriale", "Toate", "Filtreaz\u0103 dup\u0103 tip", "Niciun titlu nu corespunde acestui filtru.", "Tip necunoscut pentru {count} titluri. Selecteaz\u0103 Toate pentru a le vedea."],
        "fi": ["Elokuvat", "Sarjat", "Kaikki", "Suodata nimikkeen tyypin mukaan", "Yksik\u00e4\u00e4n nimike ei vastaa t\u00e4t\u00e4 suodatinta.", "Tuntematon tyyppi: {count}. N\u00e4et n\u00e4m\u00e4 nimikkeet valitsemalla Kaikki."],
        "sv": ["Filmer", "Serier", "Alla", "Filtrera efter titeltyp", "Inga titlar matchar detta filter.", "Ok\u00e4nd typ f\u00f6r {count} titlar. V\u00e4lj Alla f\u00f6r att se dem."],
        "vi": ["Phim", "Lo\u1ea1t phim", "T\u1ea5t c\u1ea3", "L\u1ecdc theo lo\u1ea1i n\u1ed9i dung", "Kh\u00f4ng c\u00f3 n\u1ed9i dung n\u00e0o ph\u00f9 h\u1ee3p v\u1edbi b\u1ed9 l\u1ecdc n\u00e0y.", "Kh\u00f4ng r\u00f5 lo\u1ea1i c\u1ee7a {count} n\u1ed9i dung. Ch\u1ecdn T\u1ea5t c\u1ea3 \u0111\u1ec3 xem."],
        "tr": ["Filmler", "Diziler", "T\u00fcm\u00fc", "\u0130\u00e7erik t\u00fcr\u00fcne g\u00f6re filtrele", "Bu filtreye uygun i\u00e7erik yok.", "T\u00fcr\u00fc bilinmeyen i\u00e7erik: {count}. G\u00f6rmek i\u00e7in T\u00fcm\u00fc se\u00e7ene\u011fini se\u00e7in."],
        "cs": ["Filmy", "Seri\u00e1ly", "V\u0161e", "Filtrovat podle typu", "Tomuto filtru neodpov\u00edd\u00e1 \u017e\u00e1dn\u00fd titul.", "Nezn\u00e1m\u00fd typ: {count}. Pro zobrazen\u00ed t\u011bchto titul\u016f vyberte V\u0161e."],
        "el": ["\u03a4\u03b1\u03b9\u03bd\u03af\u03b5\u03c2", "\u03a3\u03b5\u03b9\u03c1\u03ad\u03c2", "\u038c\u03bb\u03b1", "\u03a6\u03b9\u03bb\u03c4\u03c1\u03ac\u03c1\u03b9\u03c3\u03bc\u03b1 \u03b1\u03bd\u03ac \u03c4\u03cd\u03c0\u03bf \u03c4\u03af\u03c4\u03bb\u03bf\u03c5", "\u039a\u03b1\u03bd\u03ad\u03bd\u03b1\u03c2 \u03c4\u03af\u03c4\u03bb\u03bf\u03c2 \u03b4\u03b5\u03bd \u03b1\u03bd\u03c4\u03b9\u03c3\u03c4\u03bf\u03b9\u03c7\u03b5\u03af \u03c3\u03b5 \u03b1\u03c5\u03c4\u03cc \u03c4\u03bf \u03c6\u03af\u03bb\u03c4\u03c1\u03bf.", "\u0386\u03b3\u03bd\u03c9\u03c3\u03c4\u03bf\u03c2 \u03c4\u03cd\u03c0\u03bf\u03c2 \u03b3\u03b9\u03b1 {count} \u03c4\u03af\u03c4\u03bb\u03bf\u03c5\u03c2. \u0395\u03c0\u03b9\u03bb\u03ad\u03be\u03c4\u03b5 \u038c\u03bb\u03b1 \u03b3\u03b9\u03b1 \u03bd\u03b1 \u03c4\u03bf\u03c5\u03c2 \u03b4\u03b5\u03af\u03c4\u03b5."],
        "ru": ["\u0424\u0438\u043b\u044c\u043c\u044b", "\u0421\u0435\u0440\u0438\u0430\u043b\u044b", "\u0412\u0441\u0435", "\u0424\u0438\u043b\u044c\u0442\u0440 \u043f\u043e \u0442\u0438\u043f\u0443", "\u041d\u0435\u0442 \u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u0439, \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u0445 \u044d\u0442\u043e\u043c\u0443 \u0444\u0438\u043b\u044c\u0442\u0440\u0443.", "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0439 \u0442\u0438\u043f: {count}. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0412\u0441\u0435, \u0447\u0442\u043e\u0431\u044b \u0438\u0445 \u0443\u0432\u0438\u0434\u0435\u0442\u044c."],
        "uk": ["\u0424\u0456\u043b\u044c\u043c\u0438", "\u0421\u0435\u0440\u0456\u0430\u043b\u0438", "\u0423\u0441\u0456", "\u0424\u0456\u043b\u044c\u0442\u0440 \u0437\u0430 \u0442\u0438\u043f\u043e\u043c", "\u041d\u0435\u043c\u0430\u0454 \u043d\u0430\u0439\u043c\u0435\u043d\u0443\u0432\u0430\u043d\u044c, \u0449\u043e \u0432\u0456\u0434\u043f\u043e\u0432\u0456\u0434\u0430\u044e\u0442\u044c \u0446\u044c\u043e\u043c\u0443 \u0444\u0456\u043b\u044c\u0442\u0440\u0443.", "\u041d\u0435\u0432\u0456\u0434\u043e\u043c\u0438\u0439 \u0442\u0438\u043f: {count}. \u0412\u0438\u0431\u0435\u0440\u0456\u0442\u044c \u0423\u0441\u0456, \u0449\u043e\u0431 \u0457\u0445 \u043f\u043e\u0431\u0430\u0447\u0438\u0442\u0438."],
        "he": ["\u05e1\u05e8\u05d8\u05d9\u05dd", "\u05e1\u05d3\u05e8\u05d5\u05ea", "\u05d4\u05db\u05d5\u05dc", "\u05e1\u05d9\u05e0\u05d5\u05df \u05dc\u05e4\u05d9 \u05e1\u05d5\u05d2 \u05db\u05d5\u05ea\u05e8", "\u05d0\u05d9\u05df \u05db\u05d5\u05ea\u05e8\u05d9\u05dd \u05d4\u05ea\u05d5\u05d0\u05de\u05d9\u05dd \u05dc\u05de\u05e1\u05e0\u05df \u05d4\u05d6\u05d4.", "\u05e1\u05d5\u05d2 \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2 \u05e2\u05d1\u05d5\u05e8 {count} \u05db\u05d5\u05ea\u05e8\u05d9\u05dd. \u05d1\u05d7\u05e8\u05d5 \u05d4\u05db\u05d5\u05dc \u05db\u05d3\u05d9 \u05dc\u05e8\u05d0\u05d5\u05ea \u05d0\u05d5\u05ea\u05dd."],
        "ar": ["\u0623\u0641\u0644\u0627\u0645", "\u0645\u0633\u0644\u0633\u0644\u0627\u062a", "\u0627\u0644\u0643\u0644", "\u062a\u0635\u0641\u064a\u0629 \u062d\u0633\u0628 \u0646\u0648\u0639 \u0627\u0644\u0639\u0646\u0648\u0627\u0646", "\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0646\u0627\u0648\u064a\u0646 \u062a\u0637\u0627\u0628\u0642 \u0647\u0630\u0627 \u0627\u0644\u0641\u0644\u062a\u0631.", "\u0646\u0648\u0639 \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641 \u0644\u0640 {count} \u0639\u0646\u0648\u0627\u0646\u064b\u0627. \u0627\u062e\u062a\u0631 \u0627\u0644\u0643\u0644 \u0644\u0639\u0631\u0636\u0647\u0627."],
        "hi": ["\u092b\u093c\u093f\u0932\u094d\u092e\u0947\u0902", "\u0938\u0940\u0930\u0940\u091c\u093c", "\u0938\u092d\u0940", "\u091f\u093e\u0907\u091f\u0932 \u0915\u0947 \u092a\u094d\u0930\u0915\u093e\u0930 \u0938\u0947 \u092b\u093c\u093f\u0932\u094d\u091f\u0930 \u0915\u0930\u0947\u0902", "\u0907\u0938 \u092b\u093c\u093f\u0932\u094d\u091f\u0930 \u0938\u0947 \u0915\u094b\u0908 \u091f\u093e\u0907\u091f\u0932 \u092e\u0947\u0932 \u0928\u0939\u0940\u0902 \u0916\u093e\u0924\u093e.", "{count} \u091f\u093e\u0907\u091f\u0932 \u0915\u093e \u092a\u094d\u0930\u0915\u093e\u0930 \u0909\u092a\u0932\u092c\u094d\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948. \u0907\u0928\u094d\u0939\u0947\u0902 \u0926\u0947\u0916\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0938\u092d\u0940 \u091a\u0941\u0928\u0947\u0902."],
        "th": ["\u0e20\u0e32\u0e1e\u0e22\u0e19\u0e15\u0e23\u0e4c", "\u0e0b\u0e35\u0e23\u0e35\u0e2a\u0e4c", "\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14", "\u0e01\u0e23\u0e2d\u0e07\u0e15\u0e32\u0e21\u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32", "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32\u0e17\u0e35\u0e48\u0e15\u0e23\u0e07\u0e01\u0e31\u0e1a\u0e15\u0e31\u0e27\u0e01\u0e23\u0e2d\u0e07\u0e19\u0e35\u0e49", "\u0e44\u0e21\u0e48\u0e17\u0e23\u0e32\u0e1a\u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17\u0e02\u0e2d\u0e07\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32 {count} \u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07 \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e14\u0e39"],
        "zh": ["\u7535\u5f71", "\u5267\u96c6", "\u5168\u90e8", "\u6309\u4f5c\u54c1\u7c7b\u578b\u7b5b\u9009", "\u6ca1\u6709\u7b26\u5408\u6b64\u7b5b\u9009\u6761\u4ef6\u7684\u4f5c\u54c1\u3002", "{count} \u90e8\u4f5c\u54c1\u7684\u7c7b\u578b\u4e0d\u660e\u3002\u9009\u62e9\u5168\u90e8\u4ee5\u67e5\u770b\u3002"],
        "ja": ["\u6620\u753b", "\u30b7\u30ea\u30fc\u30ba", "\u3059\u3079\u3066", "\u4f5c\u54c1\u306e\u7a2e\u985e\u3067\u7d5e\u308a\u8fbc\u3080", "\u3053\u306e\u6761\u4ef6\u306b\u5408\u3046\u4f5c\u54c1\u306f\u3042\u308a\u307e\u305b\u3093\u3002", "{count}\u4f5c\u54c1\u306e\u7a2e\u985e\u304c\u4e0d\u660e\u3067\u3059\u3002\u3059\u3079\u3066\u3092\u9078\u629e\u3059\u308b\u3068\u8868\u793a\u3067\u304d\u307e\u3059\u3002"],
        "ko": ["\uc601\ud654", "\uc2dc\ub9ac\uc988", "\uc804\uccb4", "\uc791\ud488 \uc720\ud615\ubcc4 \ud544\ud130", "\uc774 \ud544\ud130\uc5d0 \ub9de\ub294 \uc791\ud488\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", "\uc720\ud615\uc744 \uc54c \uc218 \uc5c6\ub294 \uc791\ud488\uc774 {count}\uac1c \uc788\uc2b5\ub2c8\ub2e4. \uc804\uccb4\ub97c \uc120\ud0dd\ud558\uba74 \ubcfc \uc218 \uc788\uc2b5\ub2c8\ub2e4."],
    };
    for (const [locale, values] of Object.entries(TYPE_FILTER_UI_MESSAGES)) {
        const keys = ['filterFilms', 'filterSeries', 'filterAll', 'titleTypeFilter', 'noMatchingTitles', 'unknownTitleTypes'];
        keys.forEach((key, index) => { UI_MESSAGES[locale][key] = values[index]; });
    }

    const MANUAL_VIEWING_UI_MESSAGES = {
        "da": ["Mark\u00e9r som set","Mark\u00e9r som ajour","Tilbage til Min liste","Brug automatisk status","Kunne ikke gemme visningsvalg. Genindl\u00e6s og pr\u00f8v igen."],
        "de": ["Als gesehen markieren","Als aufgeholt markieren","Zur\u00fcck zu Meine Liste","Automatischen Status verwenden","Auswahl konnte nicht gespeichert werden. Neu laden und erneut versuchen."],
        "en": ["Mark watched","Mark caught up","Move back to My List","Use automatic status","Could not save viewing choices. Reload and try again."],
        "es": ["Marcar como visto","Marcar como al d\u00eda","Volver a Mi lista","Usar estado autom\u00e1tico","No se pudieron guardar tus cambios. Recarga e int\u00e9ntalo de nuevo."],
        "fil": ["Markahang napanood","Markahang napapanahon","Ibalik sa Listahan Ko","Gamitin ang awtomatikong status","Hindi ma-save ang mga pagbabago. I-reload at subukan muli."],
        "fr": ["Marquer comme vu","Marquer comme \u00e0 jour","Remettre dans Ma liste","Utiliser le statut automatique","Impossible d\u2019enregistrer les choix. Rechargez et r\u00e9essayez."],
        "hr": ["Ozna\u010di kao pogledano","Ozna\u010di sve kao pogledano","Vrati na Moj popis","Koristi automatski status","Nije mogu\u0107e spremiti odabire. Ponovno u\u010ditaj i poku\u0161aj."],
        "id": ["Tandai sudah ditonton","Tandai sudah mengikuti","Kembali ke Daftar Saya","Gunakan status otomatis","Pilihan tidak dapat disimpan. Muat ulang dan coba lagi."],
        "it": ["Segna come visto","Segna come in pari","Riporta in La mia lista","Usa lo stato automatico","Impossibile salvare le scelte. Ricarica e riprova."],
        "hu": ["Megn\u00e9zettnek jel\u00f6l\u00e9s","Naprak\u00e9sznek jel\u00f6l\u00e9s","Vissza a Saj\u00e1t list\u00e1mra","Automatikus \u00e1llapot haszn\u00e1lata","A v\u00e1laszt\u00e1sok ment\u00e9se sikertelen. T\u00f6ltsd \u00fajra \u00e9s pr\u00f3b\u00e1ld meg ism\u00e9t."],
        "ms": ["Tandakan sudah ditonton","Tandakan sudah mengikuti","Kembali ke Senarai Saya","Gunakan status automatik","Pilihan tidak dapat disimpan. Muat semula dan cuba lagi."],
        "nl": ["Markeer als bekeken","Markeer als bijgewerkt","Terug naar Mijn lijst","Automatische status gebruiken","Keuzes konden niet worden opgeslagen. Herlaad en probeer opnieuw."],
        "nb": ["Merk som sett","Merk som \u00e0 jour","Tilbake til Min liste","Bruk automatisk status","Kunne ikke lagre valgene. Last inn p\u00e5 nytt og pr\u00f8v igjen."],
        "pl": ["Oznacz jako obejrzane","Oznacz jako na bie\u017c\u0105co","Przenie\u015b do Mojej listy","U\u017cyj automatycznego statusu","Nie uda\u0142o si\u0119 zapisa\u0107 wybor\u00f3w. Od\u015bwie\u017c i spr\u00f3buj ponownie."],
        "pt": ["Marcar como visto","Marcar como atualizado","Voltar para Minha lista","Usar status autom\u00e1tico","N\u00e3o foi poss\u00edvel salvar as escolhas. Recarregue e tente novamente."],
        "ro": ["Marcheaz\u0103 ca vizionat","Marcheaz\u0103 ca la zi","\u00cenapoi \u00een Lista mea","Folose\u0219te starea automat\u0103","Nu s-au putut salva alegerile. Re\u00eencarc\u0103 \u0219i \u00eencearc\u0103 din nou."],
        "fi": ["Merkitse katsotuksi","Merkitse ajan tasalla olevaksi","Takaisin Omaan listaan","K\u00e4yt\u00e4 automaattista tilaa","Valintoja ei voitu tallentaa. Lataa uudelleen ja yrit\u00e4 uudestaan."],
        "sv": ["Markera som sedd","Markera som ikapp","Tillbaka till Min lista","Anv\u00e4nd automatisk status","Kunde inte spara valen. Ladda om och f\u00f6rs\u00f6k igen."],
        "vi": ["\u0110\u00e1nh d\u1ea5u \u0111\u00e3 xem","\u0110\u00e1nh d\u1ea5u \u0111\u00e3 xem h\u1ebft","Tr\u1edf l\u1ea1i Danh s\u00e1ch c\u1ee7a t\u00f4i","D\u00f9ng tr\u1ea1ng th\u00e1i t\u1ef1 \u0111\u1ed9ng","Kh\u00f4ng th\u1ec3 l\u01b0u l\u1ef1a ch\u1ecdn. T\u1ea3i l\u1ea1i v\u00e0 th\u1eed l\u1ea1i."],
        "tr": ["\u0130zlendi olarak i\u015faretle","G\u00fcncel olarak i\u015faretle","Listeme geri ta\u015f\u0131","Otomatik durumu kullan","Se\u00e7imler kaydedilemedi. Yeniden y\u00fckleyip tekrar dene."],
        "cs": ["Ozna\u010dit jako zhl\u00e9dnut\u00e9","Ozna\u010dit jako dokoukan\u00e9","Zp\u011bt do M\u00e9ho seznamu","Pou\u017e\u00edt automatick\u00fd stav","Volby nelze ulo\u017eit. Na\u010dti str\u00e1nku znovu a zkus to znovu."],
        "el": ["\u03a3\u03ae\u03bc\u03b1\u03bd\u03c3\u03b7 \u03c9\u03c2 \u03c0\u03c1\u03bf\u03b2\u03bb\u03b7\u03b8\u03ad\u03bd","\u03a3\u03ae\u03bc\u03b1\u03bd\u03c3\u03b7 \u03c9\u03c2 \u03b5\u03bd\u03b7\u03bc\u03b5\u03c1\u03c9\u03bc\u03ad\u03bd\u03bf","\u0395\u03c0\u03b9\u03c3\u03c4\u03c1\u03bf\u03c6\u03ae \u03c3\u03c4\u03b7 \u039b\u03af\u03c3\u03c4\u03b1 \u03bc\u03bf\u03c5","\u03a7\u03c1\u03ae\u03c3\u03b7 \u03b1\u03c5\u03c4\u03cc\u03bc\u03b1\u03c4\u03b7\u03c2 \u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7\u03c2","\u0394\u03b5\u03bd \u03b1\u03c0\u03bf\u03b8\u03b7\u03ba\u03b5\u03cd\u03c4\u03b7\u03ba\u03b1\u03bd \u03bf\u03b9 \u03b5\u03c0\u03b9\u03bb\u03bf\u03b3\u03ad\u03c2. \u0391\u03bd\u03b1\u03bd\u03b5\u03ce\u03c3\u03c4\u03b5 \u03ba\u03b1\u03b9 \u03b4\u03bf\u03ba\u03b9\u03bc\u03ac\u03c3\u03c4\u03b5 \u03be\u03b1\u03bd\u03ac."],
        "ru": ["\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043d\u044b\u043c","\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u0432\u0441\u0435 \u0441\u0435\u0440\u0438\u0438 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043d\u044b\u043c\u0438","\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u0432 \u041c\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a","\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0441\u0442\u0430\u0442\u0443\u0441","\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0432\u044b\u0431\u043e\u0440. \u041f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435."],
        "uk": ["\u041f\u043e\u0437\u043d\u0430\u0447\u0438\u0442\u0438 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u0438\u043c","\u041f\u043e\u0437\u043d\u0430\u0447\u0438\u0442\u0438 \u0432\u0441\u0456 \u0441\u0435\u0440\u0456\u0457 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u0438\u043c\u0438","\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u0438 \u0434\u043e \u041c\u043e\u0433\u043e \u0441\u043f\u0438\u0441\u043a\u0443","\u0412\u0438\u043a\u043e\u0440\u0438\u0441\u0442\u043e\u0432\u0443\u0432\u0430\u0442\u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u0438\u0439 \u0441\u0442\u0430\u043d","\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432\u0438\u0431\u0456\u0440. \u041f\u0435\u0440\u0435\u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0442\u0435 \u0439 \u043f\u043e\u0432\u0442\u043e\u0440\u0456\u0442\u044c."],
        "he": ["\u05e1\u05d9\u05de\u05d5\u05df \u05db\u05e0\u05e6\u05e4\u05d4","\u05e1\u05d9\u05de\u05d5\u05df \u05db\u05dc \u05d4\u05e4\u05e8\u05e7\u05d9\u05dd \u05db\u05e0\u05e6\u05e4\u05d5","\u05d7\u05d6\u05e8\u05d4 \u05dc\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9","\u05e9\u05d9\u05de\u05d5\u05e9 \u05d1\u05de\u05e6\u05d1 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9","\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8 \u05d0\u05ea \u05d4\u05d1\u05d7\u05d9\u05e8\u05d5\u05ea. \u05d9\u05e9 \u05dc\u05d8\u05e2\u05d5\u05df \u05de\u05d7\u05d3\u05e9 \u05d5\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1."],
        "ar": ["\u062a\u062d\u062f\u064a\u062f \u0643\u0645\u064f\u0634\u0627\u0647\u062f","\u062a\u062d\u062f\u064a\u062f \u0643\u0645\u064f\u062a\u0627\u0628\u064e\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644","\u0625\u0639\u0627\u062f\u0629 \u0625\u0644\u0649 \u0642\u0627\u0626\u0645\u062a\u064a","\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u0644\u0642\u0627\u0626\u064a\u0629","\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0627\u0644\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a. \u0623\u0639\u062f \u0627\u0644\u062a\u062d\u0645\u064a\u0644 \u0648\u062d\u0627\u0648\u0644 \u0645\u062c\u062f\u062f\u064b\u0627."],
        "hi": ["\u0926\u0947\u0916\u093e \u0939\u0941\u0906 \u091a\u093f\u0939\u094d\u0928\u093f\u0924 \u0915\u0930\u0947\u0902","\u0938\u092d\u0940 \u0909\u092a\u0932\u092c\u094d\u0927 \u090f\u092a\u093f\u0938\u094b\u0921 \u0926\u0947\u0916\u0947 \u091a\u093f\u0939\u094d\u0928\u093f\u0924 \u0915\u0930\u0947\u0902","\u092e\u0947\u0930\u0940 \u0932\u093f\u0938\u094d\u091f \u092e\u0947\u0902 \u0935\u093e\u092a\u0938 \u0930\u0916\u0947\u0902","\u0938\u094d\u0935\u091a\u093e\u0932\u093f\u0924 \u0938\u094d\u0925\u093f\u0924\u093f \u0915\u093e \u0909\u092a\u092f\u094b\u0917 \u0915\u0930\u0947\u0902","\u091a\u0941\u0928\u093e\u0935 \u0938\u0939\u0947\u091c\u0947 \u0928\u0939\u0940\u0902 \u091c\u093e \u0938\u0915\u0947\u0964 \u092b\u093f\u0930 \u0938\u0947 \u0932\u094b\u0921 \u0915\u0930\u0915\u0947 \u092a\u094d\u0930\u092f\u093e\u0938 \u0915\u0930\u0947\u0902\u0964"],
        "th": ["\u0e17\u0e33\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2b\u0e21\u0e32\u0e22\u0e27\u0e48\u0e32\u0e14\u0e39\u0e41\u0e25\u0e49\u0e27","\u0e17\u0e33\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2b\u0e21\u0e32\u0e22\u0e27\u0e48\u0e32\u0e14\u0e39\u0e04\u0e23\u0e1a\u0e41\u0e25\u0e49\u0e27","\u0e22\u0e49\u0e32\u0e22\u0e01\u0e25\u0e31\u0e1a\u0e44\u0e1b\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19","\u0e43\u0e0a\u0e49\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34","\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e15\u0e31\u0e27\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49 \u0e42\u0e2b\u0e25\u0e14\u0e43\u0e2b\u0e21\u0e48\u0e41\u0e25\u0e49\u0e27\u0e25\u0e2d\u0e07\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07"],
        "zh": ["\u6807\u8bb0\u4e3a\u5df2\u89c2\u770b","\u6807\u8bb0\u4e3a\u5df2\u770b\u5b8c\u73b0\u6709\u5267\u96c6","\u79fb\u56de\u6211\u7684\u7247\u5355","\u4f7f\u7528\u81ea\u52a8\u72b6\u6001","\u65e0\u6cd5\u4fdd\u5b58\u9009\u62e9\u3002\u8bf7\u91cd\u65b0\u52a0\u8f7d\u540e\u518d\u8bd5\u3002"],
        "ja": ["\u8996\u8074\u6e08\u307f\u306b\u3059\u308b","\u914d\u4fe1\u4e2d\u306e\u5168\u8a71\u3092\u8996\u8074\u6e08\u307f\u306b\u3059\u308b","\u30de\u30a4\u30ea\u30b9\u30c8\u306b\u623b\u3059","\u81ea\u52d5\u5224\u5b9a\u306b\u623b\u3059","\u9078\u629e\u3092\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3002\u518d\u8aad\u307f\u8fbc\u307f\u3057\u3066\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002"],
        "ko": ["\uc2dc\uccad \uc644\ub8cc\ub85c \ud45c\uc2dc","\uacf5\uac1c\ub41c \ubaa8\ub4e0 \ud68c\ucc28 \uc2dc\uccad \uc644\ub8cc\ub85c \ud45c\uc2dc","\ub0b4\uac00 \ucc1c\ud55c \ub9ac\uc2a4\ud2b8\ub85c \uc774\ub3d9","\uc790\ub3d9 \uc0c1\ud0dc \uc0ac\uc6a9","\uc120\ud0dd\uc744 \uc800\uc7a5\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68 \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud558\uc138\uc694."],
    };
    for (const [locale, values] of Object.entries(MANUAL_VIEWING_UI_MESSAGES)) {
        const keys = ['markWatched', 'markCaughtUp', 'moveBackToMyList', 'useAutomaticViewingStatus', 'viewingChoiceStorageFailed'];
        keys.forEach((key, index) => { UI_MESSAGES[locale][key] = values[index]; });
    }

    const LOG_MESSAGES = {
        viewingStatusStarted: { en: 'Viewing status collection started', ja: '\u8996\u8074\u72b6\u6cc1\u306e\u53d6\u5f97\u958b\u59cb' },
        viewingStatusCompleted: { en: 'Viewing status collection completed', ja: '\u8996\u8074\u72b6\u6cc1\u306e\u53d6\u5f97\u5b8c\u4e86' },
        viewingStatusUnavailable: { en: 'Viewing status unavailable; uncertain titles stay visible', ja: '\u8996\u8074\u72b6\u6cc1\u4e0d\u660e\u306e\u4f5c\u54c1\u306f\u8868\u793a\u3092\u7d99\u7d9a' },
        undoEntriesExpired: { en: 'Expired Undo entries released', ja: '\u671f\u9650\u5207\u308c\u306eUndo\u9805\u76ee\u3092\u89e3\u653e' },
        targetSessionSuspended: { en: 'Target session suspended', ja: '\u5bfe\u8c61\u30bb\u30c3\u30b7\u30e7\u30f3\u4e2d\u65ad' },
        targetSessionStarted: { en: 'Target session started', ja: '\u5bfe\u8c61\u30bb\u30c3\u30b7\u30e7\u30f3\u958b\u59cb' },
        routeChangeDetected: { en: 'Route change detected', ja: '\u30da\u30fc\u30b8\u9077\u79fb\u691c\u51fa' },
        clipboardFallback: { en: 'Clipboard API failed; using fallback', ja: '\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9API\u306b\u5931\u6557\u3002fallback\u3078\u79fb\u884c' },
        execCommandCopyFailed: { en: 'execCommand(copy) failed.', ja: 'execCommand(copy) \u304c\u5931\u6557\u3057\u307e\u3057\u305f\u3002' },
        copyLogsTooltip: { en: 'Copy the My List for Netflix log to the clipboard', ja: '\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306bMy List for Netflix\u306e\u30ed\u30b0\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3059' },
        copied: { en: 'Copied.', ja: '\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f\u3002' },
        copyLogsRequested: { en: 'CopyLogs requested', ja: 'CopyLogs\u8981\u6c42' },
        copyLogsCompleted: { en: 'CopyLogs completed', ja: 'CopyLogs\u5b8c\u4e86' },
        copyLogsFailed: { en: 'CopyLogs failed', ja: 'CopyLogs\u5931\u6557' },
        viewingChoiceApplied: { en: 'Manual viewing choice applied', ja: '\u624b\u52d5\u306e\u8996\u8074\u72b6\u614b\u3092\u9069\u7528' },
        nativeInitializationRecovered: { en: 'Retrying initialization with a verified native-source replacement', ja: '\u7d14\u6b63\u30bd\u30fc\u30b9\u306e\u7f6e\u63db\u3092\u78ba\u8a8d\u3057\u521d\u671f\u5316\u3092\u518d\u8a66\u884c' },
        nativeInitializationRecoveryExhausted: { en: 'Native initialization replacement recovery exhausted', ja: '\u7d14\u6b63\u30bd\u30fc\u30b9\u7f6e\u63db\u306e\u521d\u671f\u5316\u518d\u8a66\u884c\u4e0a\u9650' },
        sourceAlignmentRestoreFailed: { en: 'Native source geometry restoration failed', ja: '\u7d14\u6b63\u30bd\u30fc\u30b9\u5ea7\u6a19\u306e\u5fa9\u5143\u306b\u5931\u6557' },
        emptyLegacyListFinalized: { en: 'Empty legacy list finalized', ja: '\u65e7\u30de\u30a4\u30ea\u30b9\u30c8 0\u4ef6\u3092\u78ba\u5b9a' },
        totalCountDetected: { en: 'totalCount detected', ja: 'totalCount\u53d6\u5f97' },
        legacyFrameMovedToEmptyAnchor: { en: 'Legacy frame moved to empty anchor', ja: '\u65e7\u30de\u30a4\u30ea\u30b9\u30c8\u3092\u7a7a\u30a2\u30f3\u30ab\u30fc\u3078\u79fb\u52d5' },
        nativeMyListSourceAdoptedWithoutRescan: { en: 'Native My List source adopted without rescan', ja: '\u7d14\u6b63\u30de\u30a4\u30ea\u30b9\u30c8\u5143\u3092\u518d\u8d70\u67fb\u306a\u3057\u3067\u63a1\u7528' },
        populatedNativeMyListDetectedAfterEmpty: { en: 'Populated native My List detected after empty finalization; restarting initialization', ja: '\u7a7a\u78ba\u5b9a\u5f8c\u306b\u4f5c\u54c1\u3042\u308a\u306e\u7d14\u6b63\u30de\u30a4\u30ea\u30b9\u30c8\u3092\u691c\u51fa\u3002\u521d\u671f\u5316\u3092\u518d\u958b' },
        nativeEmptyMyListSectionAdopted: { en: 'Native empty My List section adopted', ja: '\u7a7a\u306e\u7d14\u6b63\u30de\u30a4\u30ea\u30b9\u30c8\u4f4d\u7f6e\u3092\u63a1\u7528' },
        legacyItemRemovedByDifferentialUpdate: { en: 'Legacy item removed by differential update', ja: '\u5dee\u5206\u66f4\u65b0\u3067\u65e7\u30de\u30a4\u30ea\u30b9\u30c8\u304b\u3089\u524a\u9664' },
        legacyItemAddedByDifferentialUpdate: { en: 'Legacy item added by differential update', ja: '\u5dee\u5206\u66f4\u65b0\u3067\u65e7\u30de\u30a4\u30ea\u30b9\u30c8\u3078\u8ffd\u52a0' },
        legacyVisibleOrderAligned: { en: 'Legacy visible order aligned', ja: '\u65e7\u30de\u30a4\u30ea\u30b9\u30c8\u306e\u8868\u793a\u4e2d\u9806\u5e8f\u3092\u540c\u671f' },
        nativeMyListBindingRefreshed: { en: 'Native My List binding refreshed', ja: '\u7d14\u6b63\u30de\u30a4\u30ea\u30b9\u30c8DOM\u53c2\u7167\u3092\u518d\u7d50\u5408' },
        differentialUpdateTimedOutWaitingForAUsableCardSnapshot: { en: 'Differential update timed out waiting for a usable card snapshot', ja: '\u5dee\u5206\u66f4\u65b0\u3067\u5229\u7528\u53ef\u80fd\u306a\u30ab\u30fc\u30c9\u60c5\u5831\u3092\u5f85\u3064\u9593\u306b\u30bf\u30a4\u30e0\u30a2\u30a6\u30c8\u3057\u307e\u3057\u305f' },
        myListMutationQueued: { en: 'My List mutation queued', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u5909\u66f4\u3092\u5dee\u5206\u30ad\u30e5\u30fc\u3078\u767b\u9332' },
        carouselMoveCancelledBeforeStart: { en: 'Carousel move cancelled before start', ja: '\u30ab\u30eb\u30fc\u30bb\u30eb\u79fb\u52d5\u3092\u958b\u59cb\u524d\u306b\u4e2d\u6b62' },
        carouselMoveControlNotFound: { en: 'Carousel move control not found', ja: '\u30ab\u30eb\u30fc\u30bb\u30eb\u79fb\u52d5\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u306a\u3057' },
        carouselDomProfileDetected: { en: 'Native carousel DOM profile detected', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30ebDOM\u4e16\u4ee3\u691c\u51fa' },
        logicalCarouselEdgeDetected: { en: 'Logical carousel edge detected', ja: '\u8ad6\u7406\u30ab\u30eb\u30fc\u30bb\u30eb\u7aef\u3092\u691c\u51fa' },
        logicalCarouselPagesFinalized: { en: 'Logical carousel pages finalized', ja: '\u8ad6\u7406\u30ab\u30eb\u30fc\u30bb\u30eb\u30da\u30fc\u30b8\u78ba\u5b9a' },
        logicalCarouselCycleDetected: { en: 'Logical carousel cycle detected', ja: '\u8ad6\u7406\u30ab\u30eb\u30fc\u30bb\u30eb\u5faa\u74b0\u691c\u51fa' },
        logicalPageModelSynchronizedAfterDelta: { en: 'Logical page model synchronized after My List delta', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u5dee\u5206\u5f8c\u306e\u8ad6\u7406\u30da\u30fc\u30b8\u30e2\u30c7\u30eb\u540c\u671f' },
        operationTimedOut: { en: 'Operation timed out', ja: '\u51e6\u7406\u304c\u30bf\u30a4\u30e0\u30a2\u30a6\u30c8' },
        fullCollectionIncomplete: { en: 'Full collection did not complete', ja: '\u5168\u4ef6\u53d6\u5f97\u304c\u5b8c\u4e86\u3057\u307e\u305b\u3093\u3067\u3057\u305f' },
        carouselMoveStarted: { en: 'Carousel move started', ja: '\u30ab\u30eb\u30fc\u30bb\u30eb\u79fb\u52d5\u958b\u59cb' },
        carouselMoveCompleted: { en: 'Carousel move completed', ja: '\u30ab\u30eb\u30fc\u30bb\u30eb\u79fb\u52d5\u5b8c\u4e86' },
        pageMoveRequested: { en: 'Page move requested', ja: '\u30da\u30fc\u30b8\u79fb\u52d5\u8981\u6c42' },
        pageMoveResult: { en: 'Page move result', ja: '\u30da\u30fc\u30b8\u79fb\u52d5\u7d50\u679c' },
        waitingForNativeCarouselInitialization: { en: 'Waiting for native carousel initialization', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u521d\u671f\u5316\u5f85\u3061\u958b\u59cb' },
        nativeCarouselInitializationReady: { en: 'Native carousel initialization ready', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u521d\u671f\u5316\u5b8c\u4e86' },
        nativeCarouselInitializationIsStillIncompleteInitializationDeferred: { en: 'Native carousel initialization is still incomplete; initialization deferred', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u521d\u671f\u5316\u304c\u672a\u5b8c\u4e86\u306e\u305f\u3081\u521d\u671f\u5316\u3092\u4fdd\u7559' },
        nativePageByPageRestorationStarted: { en: 'Native page-by-page restoration started', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6bb5\u968e\u5fa9\u5e30\u958b\u59cb' },
        nativePageRestorationMoveFailed: { en: 'Native page restoration move failed', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u5fa9\u5e30\u79fb\u52d5\u5931\u6557' },
        nativeRestorationPageStabilized: { en: 'Native restoration page stabilized', ja: '\u7d14\u6b63\u5fa9\u5e30\u30da\u30fc\u30b8\u5b89\u5b9a' },
        nativeRestorationStoppedBecauseTheTargetPageDidNotFullyMount: { en: 'Native restoration stopped because the target page did not fully mount', ja: '\u5bfe\u8c61\u30da\u30fc\u30b8\u304c\u5b8c\u5168\u306b\u30de\u30a6\u30f3\u30c8\u3055\u308c\u306a\u3044\u305f\u3081\u7d14\u6b63\u5fa9\u5e30\u3092\u4e2d\u6b62' },
        nativePageByPageRestorationCompleted: { en: 'Native page-by-page restoration completed', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6bb5\u968e\u5fa9\u5e30\u5b8c\u4e86' },
        nativeFastRestorationPhaseRepairStarted: { en: 'Native fast restoration phase repair started', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u88dc\u6b63\u958b\u59cb' },
        nativeFastRestorationPhaseRepairMoveFailed: { en: 'Native fast restoration phase repair move failed', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u88dc\u6b63\u79fb\u52d5\u5931\u6557' },
        nativeFastRestorationPhaseRepairAdjacentPageVerified: { en: 'Native fast restoration phase repair adjacent page verified', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u88dc\u6b63\u96a3\u63a5\u30da\u30fc\u30b8\u691c\u8a3c' },
        nativeFastRestorationPhaseRepairAdjacentPageDidNotStabilize: { en: 'Native fast restoration phase repair adjacent page did not stabilize', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u88dc\u6b63\u3067\u96a3\u63a5\u30da\u30fc\u30b8\u304c\u5b89\u5b9a\u3057\u307e\u305b\u3093\u3067\u3057\u305f' },
        nativeFastRestorationPhaseRepairCompleted: { en: 'Native fast restoration phase repair completed', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u88dc\u6b63\u5b8c\u4e86' },
        nativeFastRestorationStarted: { en: 'Native fast restoration started', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u958b\u59cb' },
        nativeFastRestorationMoveFailed: { en: 'Native fast restoration move failed', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u79fb\u52d5\u5931\u6557' },
        nativeFastRestorationPhaseDiagnosis: { en: 'Native fast restoration phase diagnosis', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u306e\u4f4d\u76f8\u8a3a\u65ad' },
        nativeFastRestorationCompleted: { en: 'Native fast restoration completed', ja: '\u7d14\u6b63\u9ad8\u901f\u5fa9\u5e30\u5b8c\u4e86' },
        fastRestorationVerificationFailedUsingV49PageByPageFallback: { en: 'Fast restoration verification failed; using v4.9 page-by-page fallback', ja: '\u9ad8\u901f\u5fa9\u5e30\u306e\u691c\u8a3c\u306b\u5931\u6557\u3057\u305f\u305f\u3081v4.9\u65b9\u5f0f\u306e\u6bb5\u968e\u5fa9\u5e30\u3092\u4f7f\u7528' },
        fullCollectionStarted: { en: 'Full collection started', ja: '\u5168\u4ef6\u53d6\u5f97\u958b\u59cb' },
        collectionPageStabilized: { en: 'Collection page stabilized', ja: '\u53d6\u5f97\u30da\u30fc\u30b8\u5b89\u5b9a' },
        collectionStoppedBecauseThePageNeverReachedTheExpectedStableState: { en: 'Collection stopped because the page never reached the expected stable state', ja: '\u30da\u30fc\u30b8\u304c\u671f\u5f85\u3059\u308b\u5b89\u5b9a\u72b6\u614b\u306b\u9054\u3057\u306a\u3044\u305f\u3081\u53d6\u5f97\u3092\u4e2d\u6b62' },
        collectionPageResult: { en: 'Collection page result', ja: '\u53d6\u5f97\u30da\u30fc\u30b8\u7d50\u679c' },
        couldNotAdvanceDuringFullCollection: { en: 'Could not advance during full collection', ja: '\u5168\u4ef6\u53d6\u5f97\u4e2d\u306b\u6b21\u30da\u30fc\u30b8\u3078\u9032\u3081\u307e\u305b\u3093' },
        nativeRestorationBaselineCaptured: { en: 'Native restoration baseline captured', ja: '\u7d14\u6b63\u5fa9\u5e30\u306e\u57fa\u6e96\u72b6\u614b' },
        nativeRestorationResult: { en: 'Native restoration result', ja: '\u7d14\u6b63\u5fa9\u5e30\u7d50\u679c' },
        fullCollectionCompleted: { en: 'Full collection completed', ja: '\u5168\u4ef6\u53d6\u5f97\u5b8c\u4e86' },
        fiberGraftFailed: { en: 'Fiber graft failed', ja: 'Fiber\u79fb\u690d\u5931\u6557' },
        propsGraftFailed: { en: 'Props graft failed', ja: 'Props\u79fb\u690d\u5931\u6557' },
        hoverSourceSearchStarted: { en: 'Hover source search started', ja: '\u30db\u30d0\u30fc\u5143\u63a2\u7d22\u958b\u59cb' },
        hoverSourceSearchPage: { en: 'Hover source search page', ja: '\u30db\u30d0\u30fc\u5143\u63a2\u7d22\u30da\u30fc\u30b8' },
        hoverSourceSearchCancelled: { en: 'Hover source search cancelled', ja: '\u30db\u30d0\u30fc\u5143\u63a2\u7d22\u4e2d\u6b62' },
        itemPageMappingCorrected: { en: 'Item page mapping corrected', ja: '\u4f5c\u54c1\u30da\u30fc\u30b8\u88dc\u6b63' },
        hoverSourceFound: { en: 'Hover source found', ja: '\u30db\u30d0\u30fc\u5143\u63a2\u7d22\u6210\u529f' },
        hoverSourceSearchFailed: { en: 'Hover source search failed', ja: '\u30db\u30d0\u30fc\u5143\u63a2\u7d22\u5931\u6557' },
        hoverExpectedPageMatch: { en: 'Hover target found within expected native page', ja: '\u30db\u30d0\u30fc\u5bfe\u8c61\u3092\u7d14\u6b63\u306e\u60f3\u5b9a\u30da\u30fc\u30b8\u5185\u3067\u78ba\u8a8d' },
        hoverExpectedPageMismatch: { en: 'Hover target not found within expected native page', ja: '\u30db\u30d0\u30fc\u5bfe\u8c61\u304c\u7d14\u6b63\u306e\u60f3\u5b9a\u30da\u30fc\u30b8\u5185\u306b\u5b58\u5728\u3057\u307e\u305b\u3093' },
        hoverExpectedPageUnknown: { en: 'Hover expected-page check was inconclusive', ja: '\u30db\u30d0\u30fc\u306e\u60f3\u5b9a\u30da\u30fc\u30b8\u78ba\u8a8d\u306f\u5224\u5b9a\u4fdd\u7559' },
        orderMismatchPromptShown: { en: 'My List order-change prompt shown', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u9806\u5e8f\u5909\u66f4\u30c0\u30a4\u30a2\u30ed\u30b0\u3092\u8868\u793a' },
        orderMismatchPromptAccepted: { en: 'My List order-change prompt accepted', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u9806\u5e8f\u5909\u66f4\u30c0\u30a4\u30a2\u30ed\u30b0\u3067OK' },
        orderMismatchPromptCancelled: { en: 'My List order-change prompt cancelled', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u9806\u5e8f\u5909\u66f4\u30c0\u30a4\u30a2\u30ed\u30b0\u3092\u30ad\u30e3\u30f3\u30bb\u30eb' },
        manualReinitializationRequested: { en: 'Manual reinitialization requested after My List order change', ja: '\u30de\u30a4\u30ea\u30b9\u30c8\u9806\u5e8f\u5909\u66f4\u306b\u3088\u308a\u30e6\u30fc\u30b6\u30fc\u64cd\u4f5c\u3067\u518d\u521d\u671f\u5316' },
        nativeHoverReplayCancelled: { en: 'Native hover replay cancelled', ja: '\u7d14\u6b63\u30db\u30d0\u30fc\u518d\u9001\u3092\u4e2d\u6b62' },
        nativeHoverReplayedFromLiveSource: { en: 'Native hover replayed from live source', ja: '\u751f\u304d\u3066\u3044\u308b\u7d14\u6b63\u30ab\u30fc\u30c9\u304b\u3089\u30db\u30d0\u30fc\u518d\u9001' },
        nativePagePreparationFailed: { en: 'Native page preparation failed', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u5931\u6557' },
        nativePagePreparationStarted: { en: 'Native page preparation started', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u958b\u59cb' },
        nativePagePreparationCancelled: { en: 'Native page preparation cancelled', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u4e2d\u6b62' },
        nativePagePreparationPositionResolved: { en: 'Native page preparation position resolved', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u4f4d\u7f6e\u78ba\u5b9a' },
        nativePageClonesUpdated: { en: 'Native page clones updated', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u8907\u88fd\u66f4\u65b0' },
        hoverCoordinatesProxied: { en: 'Hover coordinates proxied', ja: '\u30db\u30d0\u30fc\u5ea7\u6a19\u4ee3\u7406' },
        nativePagePreparationCompleted: { en: 'Native page preparation completed', ja: '\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u5b8c\u4e86' },
        hoverWaitingResponsiveRefreshInProgress: { en: 'Hover waiting: responsive refresh in progress', ja: '\u30db\u30d0\u30fc\u5f85\u6a5f: \u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u66f4\u65b0\u4e2d' },
        hoverCancelled: { en: 'Hover cancelled', ja: '\u30db\u30d0\u30fc\u4e2d\u6b62' },
        hoverReusedImmediately: { en: 'Hover reused immediately', ja: '\u30db\u30d0\u30fc\u5373\u6642\u518d\u5229\u7528' },
        hoverRequestedNativePagePreparation: { en: 'Hover requested native page preparation', ja: '\u30db\u30d0\u30fc\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u8981\u6c42' },
        hoverNativePagePreparationResult: { en: 'Hover native page preparation result', ja: '\u30db\u30d0\u30fc\u7d14\u6b63\u30da\u30fc\u30b8\u6e96\u5099\u7d50\u679c' },
        liveClonePreparationFailed: { en: 'Live clone preparation failed', ja: 'live\u8907\u88fd\u6e96\u5099\u5931\u6557' },
        legacyCardHoverInput: { en: 'Legacy card hover input', ja: '\u65e7\u30ab\u30fc\u30c9\u30db\u30d0\u30fc\u5165\u529b' },
        legacyCardHoverReusedMountedNativeSource: { en: 'Legacy card hover reused mounted native source', ja: '\u65e7\u30ab\u30fc\u30c9\u30db\u30d0\u30fc\u65e2\u5b58\u7d14\u6b63\u5229\u7528' },
        pendingHoverCancelledOnLeave: { en: 'Pending hover cancelled on leave', ja: '\u30de\u30a6\u30b9\u96e2\u8131\u3067\u5f85\u6a5f\u4e2d\u30db\u30d0\u30fc\u3092\u4e2d\u6b62' },
        hoverCoordinateProxyReleased: { en: 'Hover coordinate proxy released', ja: '\u30db\u30d0\u30fc\u5ea7\u6a19\u4ee3\u7406\u89e3\u9664' },
        legacyGridBuilt: { en: 'Legacy grid built', ja: '\u30b0\u30ea\u30c3\u30c9\u751f\u6210\u5b8c\u4e86' },
        responsiveStatusNote: { en: 'Responsive status note', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u72b6\u614b\u30e1\u30e2' },
        responsiveItemPageMappingRecalculatedWithoutNativeCarouselScan: { en: 'Responsive item-page mapping rebuilt from native first-page anchor', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u4f5c\u54c1\u30da\u30fc\u30b8\u5bfe\u5fdc\u3092\u7d14\u6b63\u5148\u982d\u30a2\u30f3\u30ab\u30fc\u57fa\u6e96\u3067\u518d\u69cb\u6210' },
        responsiveRefreshStarted: { en: 'Responsive refresh started', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u66f4\u65b0\u958b\u59cb' },
        responsiveMeasurementResolved: { en: 'Responsive measurement resolved', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u5b9f\u6e2c\u78ba\u5b9a' },
        responsivePageMappingUpdatedWithoutNativeCarouselMovement: { en: 'Responsive page mapping rebuilt after native anchor synchronization', ja: '\u7d14\u6b63\u30a2\u30f3\u30ab\u30fc\u540c\u671f\u5f8c\u306b\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u30da\u30fc\u30b8\u5bfe\u5fdc\u3092\u518d\u69cb\u6210' },
        responsiveRefreshCompleted: { en: 'Responsive refresh completed', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u66f4\u65b0\u5b8c\u4e86' },
        responsiveRelayoutFailed: { en: 'Responsive relayout failed', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u518d\u914d\u7f6e\u5931\u6557' },
        responsiveRemeasurementNoShapeChange: { en: 'Responsive remeasurement: no shape change', ja: '\u30ec\u30b9\u30dd\u30f3\u30b7\u30d6\u518d\u6e2c\u5b9a\u30fb\u5f62\u72b6\u5909\u66f4\u306a\u3057' },
        windowResizeDetected: { en: 'window resize detected', ja: 'window resize\u691c\u51fa' },
        visualViewportResizeDetected: { en: 'visualViewport resize detected', ja: 'visualViewport resize\u691c\u51fa' },
        nativeSourceWaitFailed: { en: 'Native source wait failed', ja: '\u7d14\u6b63\u30bd\u30fc\u30b9\u5f85\u3061\u5931\u6557' },
        nativeCarouselReadinessCheckFailed: { en: 'Native carousel readiness check failed', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u521d\u671f\u5316\u78ba\u8a8d\u5931\u6557' },
        initializationStarted: { en: 'Initialization started', ja: '\u521d\u671f\u5316\u958b\u59cb' },
        initialLayoutMeasured: { en: 'Initial layout measured', ja: '\u521d\u671f\u30ec\u30a4\u30a2\u30a6\u30c8\u5b9f\u6e2c' },
        nativeCarouselScanModeStarted: { en: 'Native carousel scan mode started', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u53d6\u5f97\u30e2\u30fc\u30c9\u958b\u59cb' },
        noNativeNetflixCardsCouldBeCollected: { en: 'No native Netflix cards could be collected.', ja: 'Netflix\u7d14\u6b63\u30ab\u30fc\u30c9\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002' },
        fullCollectionResultFinalized: { en: 'Full collection result finalized', ja: '\u5168\u4ef6\u53d6\u5f97\u7d50\u679c\u78ba\u5b9a' },
        nativeCarouselStandbyMode: { en: 'Native carousel standby mode', ja: '\u7d14\u6b63\u30ab\u30eb\u30fc\u30bb\u30eb\u5f85\u6a5f\u30e2\u30fc\u30c9' },
        initialHoverPreparationDeferred: { en: 'Initial hover preparation deferred', ja: '\u521d\u671f\u30db\u30d0\u30fc\u6e96\u5099\u3092\u9045\u5ef6' },
        collectedCountDoesNotMatchTotalCount: { en: 'Collected count does not match totalCount', ja: '\u53d6\u5f97\u4ef6\u6570\u304c\u5b9f\u6570\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093' },
        initializationCompleted: { en: 'Initialization completed', ja: '\u521d\u671f\u5316\u5b8c\u4e86' },
        initializationCancelledByRouteChange: { en: 'Initialization cancelled by route change', ja: '\u30da\u30fc\u30b8\u9077\u79fb\u306b\u3088\u308a\u521d\u671f\u5316\u4e2d\u6b62' },
        initializationFailed: { en: 'Initialization failed', ja: '\u521d\u671f\u5316\u5931\u6557' },
        scriptStarted: { en: 'Script started', ja: '\u30b9\u30af\u30ea\u30d7\u30c8\u958b\u59cb' },
        originalMyListVisibilityChanged: { en: 'Original My List visibility changed', ja: '\u7d14\u6b63\u30de\u30a4\u30ea\u30b9\u30c8\u8868\u793a\u72b6\u614b\u5909\u66f4' },
        copyFailed: { en: 'Copy failed: {message}', ja: '\u30b3\u30d4\u30fc\u5931\u6557: {message}' },
    };

    function getHtmlLanguage() {
        return (document.documentElement?.getAttribute('lang') || '').trim();
    }

    function getNetflixLanguage() {
        return getHtmlLanguage() || navigator.language || '';
    }

    function getBaseLanguage(value) {
        const raw = String(value || '').trim().replace(/_/g, '-');
        const match = raw.match(/^([A-Za-z]{2,3})(?:-|$)/);
        return match ? match[1].toLowerCase() : '';
    }

    function getUiLocale() {
        const language = getBaseLanguage(getNetflixLanguage());
        return NETFLIX_PRIMARY_UI_LOCALES.has(language) ? language : 'en';
    }

    function getLogLocale() {
        return getUiLocale() === 'ja' ? 'ja' : 'en';
    }

    function formatMessage(template, params = {}) {
        return String(template || '').replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) =>
            Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`
        );
    }

    function tUi(key, params = {}) {
        const locale = getUiLocale();
        const localizedValue = UI_MESSAGES[locale]?.[key];
        const fallbackValue = UI_MESSAGES.en?.[key];
        const template = typeof localizedValue === 'string' ? localizedValue : fallbackValue;
        return formatMessage(template, params);
    }

    function tUiPlural(key, count, params = {}) {
        const locale = getUiLocale();
        const localizedForms = UI_MESSAGES[locale]?.[key];
        const fallbackForms = UI_MESSAGES.en?.[key];
        if (!localizedForms || typeof localizedForms !== 'object') return tUi(key, params);
        let category = 'other';
        try {
            category = new Intl.PluralRules(locale).select(count);
        } catch (_) {}
        const template = localizedForms[category] || localizedForms.other ||
            fallbackForms?.[category] || fallbackForms?.other || String(count);
        return formatMessage(template, { count, ...params });
    }

    function tLog(key, params = {}) {
        const entry = LOG_MESSAGES[key];
        if (!entry) return key;
        const template = entry[getLogLocale()] || entry.en || key;
        return formatMessage(template, params);
    }

    function formatUiNumber(value, fractionDigits = 0) {
        try {
            return new Intl.NumberFormat(getUiLocale(), {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits
            }).format(value);
        } catch (_) {
            return Number(value).toFixed(fractionDigits);
        }
    }

    function formatItemCount(current, total, finalized = false) {
        const maximum = Number.isFinite(total) ? total : current;
        const base = tUiPlural('itemCount', maximum, { count: formatUiNumber(maximum) });
        if (!finalized || !Number.isFinite(total)) return base;

        const missing = Math.max(0, total - current);
        return missing > 0 ? `${base}  ${tUi('errorCount', { count: formatUiNumber(missing) })}` : base;
    }

    function formatInitializationErrorMeta(error, fallbackTotalCount = null) {
        const details = error?.details || {};
        const rawCollected = Number(
            details.collected ??
            details.actual ??
            sourceState?.collectedCount ??
            0
        );
        const collected = Number.isFinite(rawCollected) && rawCollected >= 0 ? rawCollected : 0;
        const itemText = tUiPlural('itemCount', collected, { count: formatUiNumber(collected) });

        const rawTotal = Number(
            details.totalCount ??
            details.expected ??
            fallbackTotalCount
        );
        if (!Number.isFinite(rawTotal) || rawTotal < collected) {
            return `${itemText} ${tUi('errorCount', { count: '' })}`;
        }

        const missing = Math.max(0, rawTotal - collected);
        const missingText = tUiPlural('itemCount', missing, { count: formatUiNumber(missing) });
        return `${itemText} ${tUi('errorCount', { count: missingText })}`;
    }

    function formatInitializationTime(elapsedMs) {
        if (!Number.isFinite(elapsedMs)) return tUi('initializing');
        const seconds = elapsedMs / 1000;
        return tUi('initTime', { seconds: formatUiNumber(seconds, 2) });
    }

    function formatHeaderParts(current, total, elapsedMs = null, finalized = false) {
        if (finalized && sourceState?.watchStatus && current === sourceState.items?.length && total === current) {
            const watch = sourceState.watchStatus;
            current = Number.isFinite(watch.visibleCount) ? watch.visibleCount
                : Math.max(0, current - (watch.completedCount || 0));
            total = current;
        }
        return {
            label: tUi('legacyMyList'),
            meta: `${formatItemCount(current, total, finalized)}  ${formatInitializationTime(elapsedMs)}`
        };
    }



    const OLD_IDS = [
        'tm-netflix-mylist-clone-demo-row',
        'tm-netflix-mylist-grid',
        'tm-netflix-mylist-grid-loading',
        'tm-netflix-mylist-100-demo-grid',
        'tm-netflix-mylist-100-demo-status',
        'tm-netflix-mylist-v14-grid',
        'tm-netflix-mylist-v14-status',
        'tm-netflix-mylist-v45-empty-state',
        'tm-netflix-mylist-v46-empty-state',
        'tm-netflix-mylist-v47-empty-state'
    ];
    const OLD_STYLE_IDS = [
        'tm-netflix-mylist-clone-demo-style',
        'tm-netflix-mylist-grid-style',
        'tm-netflix-mylist-100-demo-style',
        'tm-netflix-mylist-v14-style'
    ];

    let running = false;
    let runningSessionToken = null;
    let completedSection = null;
    let scheduled = false;
    let scheduledSessionToken = null;
    let scheduledRunTimer = null;
    let scheduledRunDueAt = 0;
    let sourceState = null;
    let resizeObserver = null;
    let hoverToken = 0;
    let orderMismatchDismissed = false;
    let orderMismatchDialogOpen = false;
    let orderMismatchReinitializing = false;
    let activeVideoId = null;
    let activePage = null;
    let activeClone = null;
    let activeSourceSlot = null;
    let activeGeometryProxy = null;
    let activeNativeHover = null;
    let responsiveRefreshTimer = null;
    let responsiveRefreshPromise = null;
    let responsiveRefreshing = false;
    let activeResponsiveReason = '';
    let myListCountConvergencePending = false;
    let mutationSourceRecoveryPending = false;
    let lastResponsiveSignature = '';
    let lastPageShape = '';
    let lastPointerX = -1;
    let lastPointerY = -1;
    let lastTargetScrollAt = -Infinity;
    let hoverNeedsPointerMove = false;
    let pendingGridHoverClone = null;
    let pageMoveSequence = 0;
    let carouselMoveQueue = Promise.resolve();
    let carouselDomRuntime = new WeakMap();
    let nativeReadScope = null;
    const graftedGridClones = new Set();
    let hoverSequence = 0;
    let responsiveSequence = 0;
    let lastResponsiveReason = '';
    let lastObservedUrl = location.href;
    let routeChangeSequence = 0;
    let routeSessionToken = 0;
    const routeFetchControllers = new Map();
    let targetSessionActive = false;
    let targetSessionEntryKind = 'initial';
    let targetSessionReason = 'route:initial';
    let targetListenersActive = false;
    let targetDocumentObserver = null;
    let targetMutationFrame = null;
    let targetObservedBrowseHost = null;
    let targetObservedMyListSection = null;
    let targetObservedAncestors = [];
    let targetDocumentDiscoveryActive = false;
    let activeCarouselStyleCleanup = null;
    let viewOriginalMyList = true;
    let viewOriginalMenuId = null;
    let logFeedbackTimer = null;
    let missingSectionSince = 0;
    let myListGraphqlKey = null;
    let pendingMyListMutations = new Map();
    let recentRemovedMyListItems = new Map();
    let undoExpiryTimer = null;
    let myListMutationSequence = 0;
    let waitingForNativeEmpty = false;
    let cachedNativeEmptyContent = null;
    let cachedNativeEmptyMessage = '';
    let initializationBlockedSessionToken = null;
    let nativeInitializationFailure = null;
    let performanceDiagnostics = createPerformanceDiagnostics();
    let imageResourceObserver = null;
    const investigationLog = [];
    let investigationLogStart = 0;

    function createPerformanceDiagnostics() {
        return {
            viewingGroups: { syncs: 0, fullSyncs: 0, cardsConsidered: 0, controlsUpdated: 0, categoryMoves: 0,
                hoverPreserved: 0, hoverCancelled: 0, lastReason: '' },
            hoverPreparation: { calls: 0, slotsConsidered: 0, clonesRebuilt: 0, neighborsSkipped: 0 },
            hoverLifecycle: { replayAttempts: 0, replaysDispatched: 0, replayCancelled: 0, replayFailed: 0,
                exitsDispatched: 0, exitSkipped: 0, exitFailed: 0, scrollBursts: 0, scrollExits: 0,
                lastExitReason: '', boundaryDetoursAvoided: 0, duplicateAlignmentsAvoided: 0 },
            hoverTiming: { queueSamples: 0, queueTotalMs: 0, queueMaxMs: 0,
                moveSamples: 0, moveTotalMs: 0, moveMaxMs: 0,
                graftSamples: 0, graftTotalMs: 0, graftMaxMs: 0,
                alignmentSamples: 0, alignmentTotalMs: 0, alignmentMaxMs: 0,
                replaySamples: 0, replayTotalMs: 0, replayMaxMs: 0,
                exitSamples: 0, exitTotalMs: 0, exitMaxMs: 0 },
            resize: { events: 0, checks: 0, unchanged: 0, refreshes: 0, hoverPreserved: 0, hoverCancelled: 0 },
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0, alignmentRestores: 0, alignmentRestoreFailures: 0 },
            undoRetention: { remembered: 0, expired: 0, consumed: 0, cleared: 0, schedules: 0, expiryCallbacks: 0 },
            membershipReuse: { attempts: 0, reused: 0, rejected: 0, itemsCaptured: 0, requestsAvoided: 0 },
            nativeCollection: { metadataReads: 0, snapshotsCaptured: 0, duplicateSnapshotsAvoided: 0,
                invalidMetadata: 0, consistencyFailures: 0 },
            imageResources: { scope: 'page-images-during-list-route', supported: false, active: false, stopReason: '',
                limit: IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES, batches: 0, entriesExamined: 0, beforeRouteOrInvalid: 0,
                skippedAtLimit: 0, imageEntries: 0, startedAfterViewingScan: 0, durationSamples: 0,
                totalFetchMs: 0, maxFetchMs: 0, lastImageStartOffsetMs: null, cacheDelivery: 0,
                transferBytesReported: 0, zeroTransferSizeEntries: 0, disconnectFailures: 0 }
        };
    }

    function collectPerformanceDiagnostics() {
        return Object.fromEntries(Object.entries(performanceDiagnostics).map(([key, counters]) => [key, { ...counters }]));
    }

    function recordHoverTiming(counters, phase, started) {
        if (performanceDiagnostics.hoverTiming !== counters) return;
        const elapsed = Math.max(0, Math.round((performance.now() - started) * 10) / 10);
        counters[`${phase}Samples`]++;
        counters[`${phase}TotalMs`] = Math.round((counters[`${phase}TotalMs`] + elapsed) * 10) / 10;
        counters[`${phase}MaxMs`] = Math.max(counters[`${phase}MaxMs`], elapsed);
    }

    function stopImageResourceDiagnostics(reason = 'route-leave') {
        const owner = imageResourceObserver;
        if (!owner) return;
        imageResourceObserver = null;
        owner.counters.active = false;
        owner.counters.stopReason = reason;
        try { owner.observer?.disconnect(); } catch (_) { owner.counters.disconnectFailures++; }
    }

    function recordImageResourceEntries(owner, entries) {
        if (imageResourceObserver !== owner || !isRouteSessionActive(owner.sessionToken) ||
            performanceDiagnostics.imageResources !== owner.counters) return;
        const counters = owner.counters;
        counters.batches++;
        const count = Math.min(entries.length, IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES - counters.entriesExamined);
        const scanFinishedAt = sourceState?.watchStatus?.network?.finishedAt;
        for (let index = 0; index < count; index++) {
            const entry = entries[index];
            counters.entriesExamined++;
            if (!Number.isFinite(entry.startTime) || entry.startTime < owner.startedAt) {
                counters.beforeRouteOrInvalid++; continue;
            }
            if (entry.initiatorType !== 'img') continue;
            counters.imageEntries++;
            if (Number.isFinite(scanFinishedAt) && entry.startTime >= scanFinishedAt) counters.startedAfterViewingScan++;
            counters.lastImageStartOffsetMs = Math.max(counters.lastImageStartOffsetMs ?? 0, Math.round(entry.startTime - owner.startedAt));
            if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                counters.durationSamples++;
                counters.totalFetchMs += Math.round(entry.duration);
                counters.maxFetchMs = Math.max(counters.maxFetchMs, Math.round(entry.duration));
            }
            if (entry.deliveryType === 'cache') counters.cacheDelivery++;
            if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) counters.transferBytesReported += entry.transferSize;
            else if (entry.transferSize === 0) counters.zeroTransferSizeEntries++;
        }
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) {
            counters.skippedAtLimit += entries.length - count;
            stopImageResourceDiagnostics('entry-limit');
        }
        // No URL is read or retained. These include native Netflix images as well as grid thumbnails.
    }

    function startImageResourceDiagnostics(sessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        const counters = performanceDiagnostics.imageResources;
        if (imageResourceObserver?.sessionToken === sessionToken && imageResourceObserver.counters === counters) return;
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) return;
        stopImageResourceDiagnostics('replaced');
        if (typeof PerformanceObserver !== 'function') {
            counters.stopReason = 'unsupported'; return;
        }
        const owner = { sessionToken, counters, startedAt: performance.now(), observer: null };
        try {
            const supportedTypes = PerformanceObserver.supportedEntryTypes;
            if (Array.isArray(supportedTypes) && !supportedTypes.includes('resource')) {
                counters.stopReason = 'unsupported'; return;
            }
            owner.observer = new PerformanceObserver(list => {
                if (imageResourceObserver !== owner || !isRouteSessionActive(sessionToken) ||
                    performanceDiagnostics.imageResources !== counters) return;
                try { recordImageResourceEntries(owner, list.getEntries()); }
                catch (_) { stopImageResourceDiagnostics('read-failed'); }
            });
            imageResourceObserver = owner;
            // Subscribe only to future entries. Do not enlarge or clear Netflix's saved timing buffer.
            owner.observer.observe({ entryTypes: ['resource'] });
            counters.supported = true;
            counters.active = true;
            counters.stopReason = '';
        } catch (_) {
            if (imageResourceObserver === owner) stopImageResourceDiagnostics('observe-failed');
            else counters.stopReason = 'observe-failed';
        }
    }

    function createNativeReadScope() {
        return { profiles: new WeakMap(), indicators: new WeakMap(), filled: new WeakMap(),
            slots: new WeakMap(), rects: new WeakMap(), indices: new WeakMap() };
    }

    function withNativeReadScope(read) {
        if (nativeReadScope) return read();
        // Only synchronous reads belong here. Never retain state across a frame,
        // await, or Netflix render; the next sample must discover fresh native data.
        nativeReadScope = createNativeReadScope();
        try { return read(); } finally { nativeReadScope = null; }
    }

    function invalidateNativeReadScope() {
        if (nativeReadScope) nativeReadScope = createNativeReadScope();
    }

    function nativeRect(node) {
        if (!nativeReadScope) return node.getBoundingClientRect();
        if (!nativeReadScope.rects.has(node)) nativeReadScope.rects.set(node, node.getBoundingClientRect());
        return nativeReadScope.rects.get(node);
    }

    function nativeFilledSlots(track) {
        if (!nativeReadScope) return netflixDom.filledSlots(track);
        if (!nativeReadScope.filled.has(track)) nativeReadScope.filled.set(track, netflixDom.filledSlots(track));
        return nativeReadScope.filled.get(track);
    }

    function nativeIndicatorItems(section) {
        if (!section) return [];
        if (!nativeReadScope) return [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')];
        if (!nativeReadScope.indicators.has(section)) {
            nativeReadScope.indicators.set(section, [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')]);
        }
        return nativeReadScope.indicators.get(section);
    }

    function isTargetPage() {
        return location.origin === 'https://www.netflix.com' && location.pathname === TARGET_PATH;
    }

    function isRouteSessionActive(sessionToken) {
        return sessionToken === routeSessionToken && targetSessionActive && isTargetPage();
    }

    function createRouteSessionCancelledError() {
        const error = new Error('Target route session cancelled');
        error.code = 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED';
        return error;
    }

    function isRouteSessionCancelledError(error) {
        return error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED';
    }

    function assertRouteSession(sessionToken) {
        if (sessionToken === null || sessionToken === undefined) return;
        if (!isRouteSessionActive(sessionToken)) throw createRouteSessionCancelledError();
    }

    function createRouteFetch(sessionToken) {
        assertRouteSession(sessionToken);
        const controller = new AbortController();
        if (sessionToken !== null && sessionToken !== undefined) {
            let controllers = routeFetchControllers.get(sessionToken);
            if (!controllers) routeFetchControllers.set(sessionToken, controllers = new Set());
            controllers.add(controller);
        }
        const timeoutId = setTimeout(() => controller.abort(), FRESH_MY_LIST_FETCH_TIMEOUT_MS);
        return { controller, timeoutId, sessionToken };
    }

    function finishRouteFetch(request) {
        clearTimeout(request.timeoutId);
        // An HTTP failure can leave its response body unread. Close it along
        // with the request scope; completed/previously aborted requests are safe.
        request.controller.abort();
        const controllers = routeFetchControllers.get(request.sessionToken);
        controllers?.delete(request.controller);
        if (controllers?.size === 0) routeFetchControllers.delete(request.sessionToken);
    }

    function abortObsoleteRouteFetches() {
        for (const [sessionToken, controllers] of routeFetchControllers) {
            if (isRouteSessionActive(sessionToken)) continue;
            routeFetchControllers.delete(sessionToken);
            for (const controller of controllers) controller.abort();
        }
    }

    function hoverPreparationCancelled(token) {
        return token !== null && token !== undefined && token !== hoverToken;
    }

    function clearRunningSession(sessionToken, retryMutations = true) {
        if (runningSessionToken !== sessionToken) return;
        running = false;
        runningSessionToken = null;
        if (retryMutations) retryPendingMyListMutations('after-initialization');
    }

    function registerActiveCarouselStyleCleanup(cleanup) {
        activeCarouselStyleCleanup = cleanup;
    }

    function unregisterActiveCarouselStyleCleanup(cleanup) {
        if (activeCarouselStyleCleanup === cleanup) activeCarouselStyleCleanup = null;
    }

    function restoreActiveCarouselStyles() {
        const cleanup = activeCarouselStyleCleanup;
        activeCarouselStyleCleanup = null;
        try { cleanup?.(); } catch (_) {}
    }

    function resetDetachedTargetState() {
        if (completedSection?.isConnected && document.getElementById(GRID_ID)) return;

        clearSourceAlignment();
        restoreActiveCarouselStyles();
        hoverToken++;
        invalidateGridReact();
        cancelPendingGridHover();
        completedSection = null;
        if (sourceState?.section && !sourceState.section.isConnected) {
            sourceState = null;
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        activeResponsiveReason = '';
        myListCountConvergencePending = false;
        mutationSourceRecoveryPending = false;
        lastResponsiveSignature = '';
        lastPageShape = '';
        activeVideoId = null;
        activePage = null;
        activeClone = null;
        activeSourceSlot = null;
        activeGeometryProxy = null;
        missingSectionSince = 0;
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        clearPendingMyListMutations();
        clearUndoEntries();
        myListGraphqlKey = null;
        waitingForNativeEmpty = false;
        cachedNativeEmptyContent = null;
        cachedNativeEmptyMessage = '';
    }

    function cleanupTargetSessionDom() {
        restoreActiveCarouselStyles();
        clearSourceAlignment();
        invalidateGridReact();

        const section = sourceState?.section;
        const scroller = sourceState?.scroller;
        const track = sourceState?.track;

        document.getElementById(GRID_ID)?.remove();
        document.getElementById(STATUS_ID)?.remove();
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        document.getElementById(ORDER_MISMATCH_DIALOG_ID)?.remove();
        orderMismatchDialogOpen = false;
        document.getElementById(STYLE_ID)?.remove();

        if (section) {
            section.classList.remove(FAST_MOVE_CLASS, ORIGINAL_HIDDEN_CLASS);
            section.removeAttribute(SECTION_ATTR);
            section.removeAttribute(ORIGINAL_VISIBILITY_ATTR);
            for (const node of section.querySelectorAll(`.${ORIGINAL_HEADER_CLASS}`)) {
                node.classList.remove(ORIGINAL_HEADER_CLASS);
            }
        }
        if (scroller) scroller.classList.remove(SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS);
        if (track) track.classList.remove('tm-netflix-mylist-v15-track');

        const synthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        if (synthetic) synthetic.remove();
    }

    function suspendTargetSession(reason = 'route-leave') {
        const hadSession = targetSessionActive || running || sourceState || completedSection || scheduled;
        const previousToken = routeSessionToken;
        routeSessionToken++;
        targetSessionActive = false;
        abortObsoleteRouteFetches();
        stopImageResourceDiagnostics();

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduledRunTimer = null;
        scheduled = false;
        scheduledSessionToken = null;
        scheduledRunDueAt = 0;

        hoverToken++;
        cleanupTargetSessionDom();
        stopTargetEventListeners();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        activeResponsiveReason = '';
        myListCountConvergencePending = false;
        carouselMoveQueue = Promise.resolve();
        carouselDomRuntime = new WeakMap();
        clearPendingMyListMutations();
        clearUndoEntries();

        running = false;
        runningSessionToken = null;
        completedSection = null;
        sourceState = null;
        activeVideoId = null;
        activePage = null;
        activeClone = null;
        activeSourceSlot = null;
        activeGeometryProxy = null;
        lastResponsiveSignature = '';
        lastPageShape = '';
        missingSectionSince = 0;
        myListGraphqlKey = null;
        waitingForNativeEmpty = false;
        cachedNativeEmptyContent = null;
        cachedNativeEmptyMessage = '';
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        orderMismatchDismissed = false;
        orderMismatchDialogOpen = false;
        orderMismatchReinitializing = false;

        if (hadSession) {
            log(tLog('targetSessionSuspended'), {
                reason,
                previousToken,
                nextToken: routeSessionToken,
                url: location.href
            });
        }
    }

    function startTargetSession(reason = 'route-enter') {
        routeSessionToken++;
        targetSessionActive = true;
        abortObsoleteRouteFetches();
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        performanceDiagnostics = createPerformanceDiagnostics();
        startImageResourceDiagnostics(routeSessionToken);
        targetSessionEntryKind = reason === 'route:initial' ? 'initial' : 'spa';
        targetSessionReason = reason;
        const sessionToken = routeSessionToken;
        resetDetachedTargetState();
        startTargetEventListeners();
        log(tLog('targetSessionStarted'), {
            reason,
            sessionToken,
            url: location.href
        });
        scheduleRun(0, sessionToken);
    }

    function handleRouteChange(source = 'unknown') {
        const currentUrl = location.href;
        const changed = currentUrl !== lastObservedUrl;
        if (!changed && source !== 'initial') return;

        const previousUrl = lastObservedUrl;
        lastObservedUrl = currentUrl;
        const seq = ++routeChangeSequence;
        const target = isTargetPage();

        log(tLog('routeChangeDetected'), {
            seq,
            source,
            previousUrl,
            currentUrl,
            target
        });

        if (!target) {
            suspendTargetSession(`route:${source}`);
            return;
        }

        if (!targetSessionActive) {
            startTargetSession(`route:${source}`);
            return;
        }

        resetDetachedTargetState();
        scheduleRun(0, routeSessionToken);
    }

    function installSpaNavigationHooks() {
        for (const methodName of ['pushState', 'replaceState']) {
            const original = history[methodName];
            if (typeof original !== 'function') continue;
            history[methodName] = function (...args) {
                const result = original.apply(this, args);
                queueMicrotask(() => handleRouteChange(`history.${methodName}`));
                return result;
            };
        }

        window.addEventListener('popstate', () => handleRouteChange('popstate'), true);
        window.addEventListener('hashchange', () => handleRouteChange('hashchange'), true);
    }

    function formatLogValue(value) {
        if (value instanceof Error) {
            return JSON.stringify({
                name: value.name,
                message: value.message,
                stack: value.stack || ''
            });
        }
        if (value instanceof Element) {
            const tag = value.tagName.toLowerCase();
            const id = value.id ? `#${value.id}` : '';
            const cls = value.classList?.length ? `.${[...value.classList].join('.')}` : '';
            return `<${tag}${id}${cls}>`;
        }
        if (typeof value === 'string') return value;
        try {
            const seen = new WeakSet();
            return JSON.stringify(value, (key, item) => {
                if (item instanceof Element) return formatLogValue(item);
                if (item instanceof Error) {
                    return { name: item.name, message: item.message, stack: item.stack || '' };
                }
                if (item && typeof item === 'object') {
                    if (seen.has(item)) return '[Circular]';
                    seen.add(item);
                }
                return item;
            });
        } catch (_) {
            return String(value);
        }
    }

    function formatSystemTimestamp(date = new Date()) {
        const pad = (value, width = 2) => String(value).padStart(width, '0');
        const offsetMinutes = -date.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const absoluteOffset = Math.abs(offsetMinutes);
        const offsetHours = pad(Math.floor(absoluteOffset / 60));
        const offsetMins = pad(absoluteOffset % 60);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
            `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
            `${sign}${offsetHours}:${offsetMins}`;
    }

    function appendInvestigationLog(level, args) {
        const body = args.map(formatLogValue).join(' ');
        const entry = `[${formatSystemTimestamp()}] ${level.padEnd(5, ' ')} ${body}`;
        if (investigationLog.length < MAX_LOG_ENTRIES) {
            investigationLog.push(entry);
        } else {
            investigationLog[investigationLogStart] = entry;
            investigationLogStart = (investigationLogStart + 1) % MAX_LOG_ENTRIES;
        }
    }

    function retainedInvestigationLog() {
        return investigationLog.slice(investigationLogStart).concat(investigationLog.slice(0, investigationLogStart));
    }

    function trace(buildArgs) {
        if (VERBOSE_INTERACTION_LOGS) log(...buildArgs());
    }

    function log(...args) {
        appendInvestigationLog('INFO', args);
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        appendInvestigationLog('WARN', args);
        console.warn(LOG_PREFIX, ...args);
    }

    function initializationError(code, stage, message, details = {}) {
        const error = new Error(message || code || 'Initialization failed');
        error.code = code || 'INITIALIZATION_FAILED';
        error.stage = stage || 'unknown';
        error.details = details;
        return error;
    }

    function initializationTimeoutError(stage, timeoutMs, details = {}) {
        return initializationError(
            'INITIALIZATION_TIMEOUT',
            stage,
            `Timeout at ${stage} after ${timeoutMs} ms`,
            { timeoutMs, ...details }
        );
    }

    function logOperationTimeout(stage, timeoutMs, details = {}) {
        const payload = { stage, timeoutMs, ...details };
        warn(tLog('operationTimedOut'), payload);
        return payload;
    }

    function rectSummary(rect) {
        if (!rect) return null;
        return {
            left: Math.round(rect.left * 10) / 10,
            top: Math.round(rect.top * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            bottom: Math.round(rect.bottom * 10) / 10
        };
    }

    function slotDescriptor(slot) {
        if (!slot) return null;
        const card = slot.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
        const href = card?.href || card?.getAttribute?.('href') || '';
        const itemIndex = netflixItemIndexFromSlot(slot);
        const logicalIndex = normalizeNetflixLogicalIndex(itemIndex, sourceState?.totalCount);
        return {
            slot: slot.getAttribute?.('data-virtual-slot') || '',
            itemIndex,
            logicalIndex,
            videoId: videoIdFromHref(href),
            href,
            ariaLabel: card?.getAttribute?.('aria-label') || '',
            tabindex: card?.getAttribute?.('tabindex') || '',
            connected: Boolean(slot.isConnected),
            inlineTransform: slot.style?.getPropertyValue?.('transform') || '',
            rect: rectSummary(slot.getBoundingClientRect ? nativeRect(slot) : null)
        };
    }

    function itemSummary(item) {
        if (!item) return null;
        return {
            videoId: item.videoId || '',
            page: item.page,
            href: item.href || '',
            ariaLabel: item.ariaLabel || ''
        };
    }

    function layoutSummary(layout) {
        if (!layout) return null;
        return {
            columns: layout.columns,
            cardWidth: Math.round((layout.cardWidth || 0) * 10) / 10,
            gap: Math.round((layout.gap || 0) * 10) / 10,
            rowGap: Math.round((layout.rowGap || 0) * 10) / 10,
            gridLeft: Math.round((layout.gridLeft || 0) * 10) / 10,
            gridWidth: Math.round((layout.gridWidth || 0) * 10) / 10,
            sidePadding: Math.round((layout.sidePadding || 0) * 10) / 10,
            sidePaddingLeft: Math.round((layout.sidePaddingLeft ?? layout.sidePadding ?? 0) * 10) / 10,
            sidePaddingRight: Math.round((layout.sidePaddingRight ?? layout.sidePadding ?? 0) * 10) / 10,
            scrollerWidth: Math.round((layout.scrollerWidth || 0) * 10) / 10,
            scrollerHeight: Math.round((layout.scrollerHeight || 0) * 10) / 10,
            widthRatio: Number.isFinite(layout.widthRatio)
                ? Math.round(layout.widthRatio * 100000) / 100000
                : null,
            formulaBased: Boolean(layout.formulaBased)
        };
    }

    function collectRuntimeSnapshot() {
        const section = sourceState?.section || findMyListSection();
        const scroller = sourceState?.scroller || section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = sourceState?.track || (scroller && netflixDom.findTrack(scroller));
        const grid = document.getElementById(GRID_ID);
        const statusNode = document.getElementById(STATUS_ID);
        const statusLabel = statusNode?.querySelector?.(`.${STATUS_LABEL_CLASS}`)?.textContent || '';
        const statusMeta = statusNode?.querySelector?.(`.${STATUS_META_CLASS}`)?.textContent || '';
        const statusText = [statusLabel, statusMeta].filter(Boolean).join('  ') || statusNode?.textContent || '';

        return {
            url: location.href,
            browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(),
            netflixLanguage: getNetflixLanguage(),
            displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            status: statusText,
            running,
            runningSessionToken,
            targetSessionActive,
            routeSessionToken,
            completed: Boolean(completedSection && completedSection.isConnected),
            selectedPage: section ? selectedPage(section) : null,
            pageCount: section ? pageCount(section) : null,
            carouselDom: section ? carouselDomProfileSummary(section) : null,
            totalCount: sourceState?.totalCount ?? null,
            collectedItems: sourceState?.items?.length ?? 0,
            sourceSlots: track ? netflixDom.directSlots(track).length : 0,
            sourceCards: track ? netflixDom.filledSlots(track).length : 0,
            currentPageCards: scroller && track ? currentPageSlots(scroller, track).length : 0,
            gridCards: sourceState?.cloneMap?.size ?? 0,
            performanceWork: collectPerformanceDiagnostics(),
            undoRetention: { entries: recentRemovedMyListItems.size, expiryScheduled: Boolean(undoExpiryTimer),
                nextExpiryInMs: undoExpiryTimer ? Math.max(0, Math.round(undoExpiryTimer.dueAt - performance.now())) : null },
            viewingStatus: sourceState?.watchStatus ? {
                completed: sourceState.watchStatus.completedCount,
                unknown: sourceState.watchStatus.unknownCount,
                loading: sourceState.watchStatus.loading,
                requests: sourceState.watchStatus.requests,
                passes: sourceState.watchStatus.passes,
                failure: sourceState.watchStatus.failure,
                network: collectViewingNetworkDiagnostics(sourceState.watchStatus.network)
            } : null,
            sourceScan: Boolean(scroller?.classList?.contains(SOURCE_SCAN_CLASS)),
            sourceParked: Boolean(scroller?.classList?.contains(SOURCE_PARKED_CLASS)),
            sourceGeometryProxy: Boolean(activeGeometryProxy),
            nativeHoverOwned: Boolean(activeNativeHover),
            viewOriginalMyList,
            myListSyncMode: 'event-driven',
            pendingMyListMutations: [...pendingMyListMutations.values()].map(entry => ({
                videoId: entry.videoId,
                action: entry.action,
                ageMs: Math.round(performance.now() - entry.detectedAt),
                source: entry.source || '',
                observerActive: Boolean(entry.observer)
            })),
            layout: layoutSummary(sourceState?.layout),
            activeVideoId,
            activePage,
            activeClone: activeClone ? {
                videoId: activeClone.getAttribute('data-tm-item-video-id') || '',
                page: activeClone.getAttribute('data-tm-item-page') || '',
                backedPage: activeClone.getAttribute('data-tm-backed-page') || '',
                hoverReady: activeClone.getAttribute('data-tm-hover-ready') === 'true',
                connected: Boolean(activeClone.isConnected),
                rect: rectSummary(activeClone.getBoundingClientRect?.())
            } : null,
            activeSourceSlot: slotDescriptor(activeSourceSlot),
            hoverToken,
            responsiveRefreshing,
            responsiveSignature: lastResponsiveSignature,
            responsivePageShape: lastPageShape,
            responsiveReason: lastResponsiveReason,
            resizeViewportSignature: sourceState?.resizeViewportSignature || '',
            pointer: { x: lastPointerX, y: lastPointerY }
        };
    }

    function collectThumbnailDiagnostics(state = sourceState) {
        const grid = state?.grid;
        if (!state || state !== sourceState || !grid?.isConnected || !(state.cloneMap instanceof Map) ||
            !isRouteSessionActive(routeSessionToken)) return { available: false, reason: 'no-current-grid' };
        const started = performance.now();
        const report = {
            available: true, scope: 'first-image-per-owned-card', limits: { ...THUMBNAIL_DIAGNOSTIC_LIMITS },
            mappedCards: state.cloneMap.size, cardsExamined: 0, truncated: state.cloneMap.size > THUMBNAIL_DIAGNOSTIC_LIMITS.cards,
            detachedCards: 0, cardsWithoutImage: 0, duplicateImagesSkipped: 0, images: 0,
            loading: { lazy: 0, eager: 0, other: 0 }, decoding: { async: 0, sync: 0, other: 0 },
            pixels: { ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 },
            sourceSelection: { current: 0, srcFallback: 0, unresolved: 0, invalidUrl: 0,
                graphqlAssigned: 0, graphqlSelectionMatches: 0, graphqlSelectionDiffers: 0, graphqlSelectionUnresolved: 0 },
            dimensionAttributes: { paired: 0, missingOrPartial: 0 },
            visibility: { renderEligible: 0, filterHidden: 0, collapsedWatched: 0, otherHidden: 0 }
        };
        const seen = new Set();
        const urls = new Set();
        const eligible = [];
        try {
            for (const clone of state.cloneMap.values()) {
                if (report.cardsExamined >= THUMBNAIL_DIAGNOSTIC_LIMITS.cards) break;
                report.cardsExamined++;
                if (!clone?.isConnected || !grid.contains(clone)) { report.detachedCards++; continue; }
                const image = clone.querySelector('img');
                if (!image) { report.cardsWithoutImage++; continue; }
                if (seen.has(image)) { report.duplicateImagesSkipped++; continue; }
                seen.add(image);
                report.images++;
                report.loading[['lazy', 'eager'].includes(image.loading) ? image.loading : 'other']++;
                report.decoding[['async', 'sync'].includes(image.decoding) ? image.decoding : 'other']++;
                const current = image.currentSrc || '';
                const src = image.src || image.getAttribute('src') || '';
                if (image.getAttribute('data-tm-graphql-image') === 'true') {
                    report.sourceSelection.graphqlAssigned++;
                    report.sourceSelection[!current ? 'graphqlSelectionUnresolved' : current === src ?
                        'graphqlSelectionMatches' : 'graphqlSelectionDiffers']++;
                }
                const hasSource = Boolean(current || src || image.getAttribute('srcset'));
                // Complete with intrinsic dimensions does not establish decode/paint completion.
                const status = !hasSource ? 'noSource' : image.complete !== true ? 'pending' :
                    image.naturalWidth > 0 && image.naturalHeight > 0 ? 'ready' : 'completeWithoutPixels';
                report.pixels[status]++;
                report.sourceSelection[current ? 'current' : src ? 'srcFallback' : 'unresolved']++;
                if (current || src) {
                    try {
                        const url = new URL(current || src, location.href);
                        if (url.protocol === 'https:' || url.protocol === 'http:') urls.add(url.href);
                    } catch (_) { report.sourceSelection.invalidUrl++; }
                }
                const width = Number(image.getAttribute('width'));
                const height = Number(image.getAttribute('height'));
                report.dimensionAttributes[Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ?
                    'paired' : 'missingOrPartial']++;
                if (gridOwnsClone(clone, grid)) {
                    report.visibility.renderEligible++;
                    eligible.push({ image, status });
                } else if (clone.getAttribute('data-tm-type-hidden') === 'true') report.visibility.filterHidden++;
                else if (clone.parentElement?.getAttribute('data-tm-watch-grid') === 'true' &&
                    clone.parentElement.parentElement?.open !== true) report.visibility.collapsedWatched++;
                else report.visibility.otherHidden++;
            }
        } catch (_) {
            return { ...report, available: false, reason: 'card-read-failed', elapsedMs: Math.round(performance.now() - started) };
        }
        report.geometry = sampleThumbnailGeometry(eligible);
        report.resourceTiming = collectThumbnailResourceTiming(urls, state.initializationStartedAt);
        report.elapsedMs = Math.round(performance.now() - started);
        // URLs and DOM references stay inside this call; only copied scalar summaries leave it.
        return report;
    }

    function sampleThumbnailGeometry(records) {
        const positions = () => ({ images: 0, ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 });
        const viewport = window.visualViewport;
        const bounds = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
            width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
        const report = {
            available: true, positionAt: 'copy-time', bounds, eligibleImages: records.length, sampleCount: 0, rectReads: 0,
            styleAvailable: typeof getComputedStyle === 'function',
            inViewport: positions(), aboveViewport: positions(), belowViewport: positions(), outsideViewport: positions(), zeroArea: positions(),
            pendingWithImageBox: 0, pendingWithParentBox: 0, imageAspectRatioHint: 0, parentAspectRatioHint: 0, parentBlockPadding: 0,
            imageWidth: { min: null, max: null }, imageHeight: { min: null, max: null }
        };
        const count = Math.min(records.length, THUMBNAIL_DIAGNOSTIC_LIMITS.geometry);
        try {
            for (let index = 0; index < count; index++) {
                // Spread the fixed sample across eligible cards, including both ends of the list.
                const record = records[count === 1 ? 0 : Math.floor(index * (records.length - 1) / (count - 1))];
                report.rectReads++;
                const rect = record.image.getBoundingClientRect();
                const parent = record.image.parentElement;
                let parentRect = null;
                if (parent) { report.rectReads++; parentRect = parent.getBoundingClientRect(); }
                const hasBox = rect.width > 0 && rect.height > 0;
                const position = !hasBox ? 'zeroArea' : rect.bottom <= bounds.top ? 'aboveViewport' :
                    rect.top >= bounds.top + bounds.height ? 'belowViewport' :
                    rect.right > bounds.left && rect.left < bounds.left + bounds.width ? 'inViewport' : 'outsideViewport';
                report[position].images++;
                report[position][record.status]++;
                if (record.status === 'pending') {
                    if (hasBox) report.pendingWithImageBox++;
                    if (parentRect?.width > 0 && parentRect.height > 0) report.pendingWithParentBox++;
                }
                for (const [key, size] of [['imageWidth', rect.width], ['imageHeight', rect.height]]) {
                    if (!Number.isFinite(size)) continue;
                    const value = Math.round(size * 10) / 10;
                    report[key].min = report[key].min === null ? value : Math.min(report[key].min, value);
                    report[key].max = report[key].max === null ? value : Math.max(report[key].max, value);
                }
                if (report.styleAvailable) {
                    const imageStyle = getComputedStyle(record.image);
                    const parentStyle = parent ? getComputedStyle(parent) : null;
                    if (imageStyle?.aspectRatio && imageStyle.aspectRatio !== 'auto') report.imageAspectRatioHint++;
                    if (parentStyle?.aspectRatio && parentStyle.aspectRatio !== 'auto') report.parentAspectRatioHint++;
                    if (parseFloat(parentStyle?.paddingTop) > 0 || parseFloat(parentStyle?.paddingBottom) > 0) report.parentBlockPadding++;
                }
                report.sampleCount++;
            }
        } catch (_) { report.available = false; report.reason = 'read-failed'; }
        // A parent box or dimension hint is evidence to inspect, not proof of reserved artwork space or a layout shift.
        return report;
    }

    function collectThumbnailResourceTiming(urls, initializationStartedAt) {
        const report = {
            available: false, bufferedEntries: 0, examinedEntries: 0, truncated: false, imageEntriesExamined: 0,
            sourcesConsidered: urls.size, matchedEntries: 0, uniqueSourceMatches: 0, sourcesWithoutEntry: urls.size,
            entriesBeforeInitializationSkipped: 0,
            initializationStartKnown: Number.isFinite(initializationStartedAt), cacheDelivery: 0,
            positiveTransferSizeEntries: 0, zeroTransferSizeEntries: 0, unreportedTransferSizeEntries: 0, transferBytesReported: 0,
            fetchDurationMs: { samples: 0, total: 0, mean: null, max: null },
            positionAtRequestKnown: false, imageDecodeMeasured: false, layoutShiftsMeasured: false
        };
        if (typeof performance.getEntriesByType !== 'function') return { ...report, reason: 'unsupported' };
        try {
            const entries = performance.getEntriesByType('resource');
            report.bufferedEntries = entries.length;
            report.truncated = entries.length > THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries;
            const matched = new Set();
            const first = Math.max(0, entries.length - THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries);
            for (let index = entries.length - 1; index >= first; index--) {
                const entry = entries[index];
                report.examinedEntries++;
                if (entry.initiatorType !== 'img') continue;
                report.imageEntriesExamined++;
                if (!urls.has(entry.name)) continue;
                if (report.initializationStartKnown && entry.startTime < initializationStartedAt) {
                    report.entriesBeforeInitializationSkipped++; continue;
                }
                report.matchedEntries++;
                matched.add(entry.name);
                if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                    report.fetchDurationMs.samples++;
                    report.fetchDurationMs.total += entry.duration;
                    report.fetchDurationMs.max = Math.max(report.fetchDurationMs.max ?? 0, entry.duration);
                }
                if (entry.deliveryType === 'cache') report.cacheDelivery++;
                if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) {
                    report.positiveTransferSizeEntries++;
                    report.transferBytesReported += entry.transferSize;
                } else if (entry.transferSize === 0) report.zeroTransferSizeEntries++;
                else report.unreportedTransferSizeEntries++;
            }
            report.uniqueSourceMatches = matched.size;
            report.sourcesWithoutEntry = urls.size - matched.size;
            const durations = report.fetchDurationMs;
            durations.mean = durations.samples ? Math.round(durations.total / durations.samples * 10) / 10 : null;
            durations.total = Math.round(durations.total * 10) / 10;
            if (durations.max !== null) durations.max = Math.round(durations.max * 10) / 10;
            report.available = true;
        } catch (_) { report.reason = 'read-failed'; }
        // Resource history can be incomplete and cross-origin byte fields can be hidden.
        // Fetch duration is not decode/paint time; zero bytes does not establish a cache hit.
        return report;
    }

    function buildInvestigationLogText() {
        const snapshot = collectRuntimeSnapshot();
        return [
            'My List for Netflix Diagnostic Log',
            `version: ${SCRIPT_VERSION}`,
            `copiedAt: ${formatSystemTimestamp()}`,
            `url: ${location.href}`,
            `userAgent: ${navigator.userAgent}`,
            `browserLanguage: ${navigator.language || ''}`,
            `htmlLanguage: ${getHtmlLanguage()}`,
            `netflixLanguage: ${getNetflixLanguage()}`,
            `displayLanguage: ${getUiLocale()}`,
            `logLanguage: ${getLogLocale()}`,
            `viewport: ${window.innerWidth}x${window.innerHeight}`,
            `devicePixelRatio: ${window.devicePixelRatio}`,
            `entries: ${investigationLog.length}`,
            `snapshot: ${formatLogValue(snapshot)}`,
            `seriesViewing: ${formatLogValue(collectViewingSeriesDiagnostics(sourceState))}`,
            `thumbnailDiagnostics: ${formatLogValue(collectThumbnailDiagnostics(sourceState))}`,
            '---',
            ...retainedInvestigationLog()
        ].join('\n') + '\n';
    }

    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return 'navigator.clipboard';
            } catch (error) {
                warn(tLog('clipboardFallback'), error);
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-100000px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        if (!ok) throw new Error(tLog('execCommandCopyFailed'));
        return 'execCommand';
    }

    function copyLogsTooltip() {
        return tLog('copyLogsTooltip');
    }

    function showLogCopiedFeedback(link) {
        clearTimeout(logFeedbackTimer);
        link.textContent = tLog('copied');
        link.title = tLog('copied');
        logFeedbackTimer = setTimeout(() => {
            if (!link?.isConnected) return;
            link.textContent = 'CopyLogs';
            link.title = copyLogsTooltip();
        }, 2500);
    }

    async function handleLogClick(event) {
        event.preventDefault();
        const link = event.currentTarget;
        log(tLog('copyLogsRequested'), collectRuntimeSnapshot());
        try {
            const method = await copyTextToClipboard(buildInvestigationLogText());
            showLogCopiedFeedback(link);
            log(tLog('copyLogsCompleted'), { method, entries: investigationLog.length });
        } catch (error) {
            warn(tLog('copyLogsFailed'), error);
            link.title = tLog('copyFailed', { message: error?.message || error });
        }
    }

    function loadSettings() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
            if (typeof parsed.viewOriginalMyList === 'boolean') viewOriginalMyList = parsed.viewOriginalMyList;
            // Rewrite the settings object so obsolete options from older releases are removed.
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ viewOriginalMyList }));
        } catch (_) {}
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ viewOriginalMyList }));
        } catch (_) {}
    }

    function unregisterMenuCommandSafe(id) {
        if (id === null || id === undefined) return;
        try {
            if (typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(id);
        } catch (_) {}
    }

    function refreshMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        unregisterMenuCommandSafe(viewOriginalMenuId);

        viewOriginalMenuId = GM_registerMenuCommand(
            viewOriginalMyList ? tUi('hideOriginalMyList') : tUi('showOriginalMyList'),
            () => {
                viewOriginalMyList = !viewOriginalMyList;
                saveSettings();
                refreshMenuCommands();
                applyOriginalMyListVisibility();
                log(tLog('originalMyListVisibilityChanged'), { enabled: viewOriginalMyList });
            }
        );
    }

    function markOriginalHeader(section) {
        if (!section) return null;

        const emptyTitle = section.querySelector(':scope > [data-uia="empty-carousel-section+title"]');
        if (emptyTitle) {
            const emptyContent = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
            emptyTitle.classList.add(ORIGINAL_HEADER_CLASS);
            emptyContent?.classList.add(ORIGINAL_HEADER_CLASS);
            return emptyContent || emptyTitle;
        }

        const heading = section.querySelector('h2');
        if (!heading) return null;
        let container = heading;
        while (container.parentElement && container.parentElement !== section) {
            container = container.parentElement;
        }
        if (container.parentElement === section) {
            container.classList.add(ORIGINAL_HEADER_CLASS);
            return container;
        }
        return null;
    }

    function applyOriginalMyListVisibility() {
        const section = sourceState?.section || (isTargetPage() ? findMyListSection() : null);
        if (!section) return;
        markOriginalHeader(section);
        section.classList.toggle(ORIGINAL_HIDDEN_CLASS, !viewOriginalMyList);
        section.setAttribute(ORIGINAL_VISIBILITY_ATTR, viewOriginalMyList ? 'true' : 'false');
        if (sourceState?.status) {
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0}px`);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function cleanupOldArtifacts() {
        for (const id of OLD_IDS) document.getElementById(id)?.remove();
        for (const id of OLD_STYLE_IDS) document.getElementById(id)?.remove();

        for (const section of document.querySelectorAll('[data-tm-mylist-v14], [data-tm-mylist-100-demo], [data-tm-mylist-clone-demo]')) {
            section.removeAttribute('data-tm-mylist-v14');
            section.removeAttribute('data-tm-mylist-100-demo');
            section.removeAttribute('data-tm-mylist-clone-demo');
            section.style.removeProperty('--tm-source-width');
        }

        for (const scroller of document.querySelectorAll('.tm-netflix-mylist-v14-source, .tm-netflix-mylist-100-demo-source, .tm-netflix-mylist-100-demo-source-parked')) {
            scroller.classList.remove('tm-netflix-mylist-v14-source', 'tm-netflix-mylist-100-demo-source', 'tm-netflix-mylist-100-demo-source-parked');
            scroller.style.removeProperty('--tm-source-width');
            scroller.style.removeProperty('--slot-width');
            scroller.style.removeProperty('--sp-slot-width');
        }

        for (const slot of document.querySelectorAll('[data-tm-source-aligned], [data-tm-source-proxied]')) {
            slot.style.removeProperty('transform');
            slot.style.removeProperty('transform-origin');
            slot.style.removeProperty('z-index');
            slot.removeAttribute('data-tm-source-aligned');
            slot.removeAttribute('data-tm-source-proxied');
        }
    }

    function addStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${SECTION_ATTR}="true"] {
                position: relative !important;
                overflow: visible !important;
            }

            /* Keep the native carousel visible and fully interactive. */
            [${SECTION_ATTR}="true"] > .${SOURCE_SCAN_CLASS},
            [${SECTION_ATTR}="true"] > .${SOURCE_PARKED_CLASS} {
                opacity: 1 !important;
                pointer-events: auto !important;
                overflow: visible !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} > .${ORIGINAL_HEADER_CLASS},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] > .${ORIGINAL_HEADER_CLASS} {
                display: none !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} > .${SOURCE_PARKED_CLASS},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] > .${SOURCE_PARKED_CLASS} {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 1px !important;
                min-height: 0 !important;
                margin: 0 !important;
                opacity: 0 !important;
                pointer-events: none !important;
                overflow: visible !important;
                z-index: -1 !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} #${STATUS_ID},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] #${STATUS_ID} {
                --tm-row-gap: 0px !important;
            }

            /* Suppress native slide animation only for script-driven moves. */
            [${SECTION_ATTR}="true"].${FAST_MOVE_CLASS} .tm-netflix-mylist-v15-track {
                transition: none !important;
                animation: none !important;
            }

            #${STATUS_ID} {
                box-sizing: border-box;
                position: relative;
                z-index: 5;
                margin: var(--tm-row-gap, 24px) 0 10px;
                padding: 0;
                min-height: 17px;
                color: rgba(255,255,255,.72);
                font-size: inherit;
                line-height: normal;
                pointer-events: auto;
                display: flex;
                align-items: baseline;
                flex-wrap: nowrap;
                white-space: nowrap;
                gap: 8px;
                overflow: visible;
            }

            #${STATUS_ID} .${STATUS_TEXT_CLASS} {
                display: flex;
                align-items: baseline;
                gap: 8px;
                white-space: nowrap;
                flex: 0 0 auto;
            }

            #${STATUS_ID} .${STATUS_LABEL_CLASS} {
                font: inherit;
                color: inherit;
                white-space: nowrap;
            }

            #${STATUS_ID} .${STATUS_META_CLASS},
            #${LOG_LINK_ID} {
                font-size: .80em;
                font-weight: 400;
                line-height: 1.2;
            }

            #${LOG_LINK_ID} {
                margin-left: 0;
                flex: 0 0 auto;
                align-self: baseline;
                color: rgba(255,255,255,.88);
                text-decoration: underline;
                text-underline-offset: 2px;
                cursor: pointer;
                white-space: nowrap;
            }

            #${ORDER_MISMATCH_DIALOG_ID} {
                box-sizing: border-box;
                position: fixed !important;
                left: 50% !important;
                bottom: 14vh !important;
                transform: translateX(-50%) !important;
                z-index: 2147483647 !important;
                width: max-content;
                max-width: min(760px, calc(100vw - 48px));
                padding: 18px 22px;
                border-radius: 4px;
                background: rgba(38,38,38,.98);
                color: #fff;
                box-shadow: 0 4px 18px rgba(0,0,0,.55);
                font-family: "Netflix Sans", "Helvetica Neue", "Segoe UI", sans-serif;
                font-size: 16px;
                line-height: 1.45;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 14px;
                text-align: center;
                pointer-events: auto !important;
            }

            #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-message] {
                min-width: 0;
                max-width: 520px;
            }

            #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-actions] {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                flex: 0 0 auto;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button {
                box-sizing: border-box;
                min-width: 88px;
                min-height: 36px;
                padding: 7px 14px;
                border-radius: 3px;
                border: 1px solid rgba(255,255,255,.72);
                background: transparent;
                color: #fff;
                font: inherit;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.2;
                cursor: pointer;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button[data-tm-order-ok] {
                border-color: #fff;
                background: #fff;
                color: #181818;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button:hover {
                opacity: .86;
            }

            @media (max-width: 700px) {
                #${ORDER_MISMATCH_DIALOG_ID} {
                    width: calc(100vw - 32px);
                    max-width: none;
                    padding: 16px 18px;
                    gap: 14px;
                    align-items: stretch;
                }

                #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-actions] {
                    justify-content: flex-end;
                }
            }

            #${GRID_ID}[data-tm-responsive-refreshing="true"] {
                pointer-events: none !important;
            }

            #${GRID_ID}[data-tm-empty="true"] {
                display: none !important;
            }

            #${LEGACY_EMPTY_STATE_ID} {
                position: relative;
                z-index: 0;
                box-sizing: border-box;
            }

            #${LEGACY_EMPTY_STATE_ID}[data-tm-empty-source="provisional-fallback"] {
                min-height: 116px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: rgba(255,255,255,.72);
                text-align: center;
            }

            #${LEGACY_EMPTY_STATE_ID}[data-tm-empty-source="provisional-fallback"] > p {
                margin: 0;
                font: inherit;
            }

            #${GRID_ID} {
                --tm-cols: 5;
                --tm-gap: 8px;
                --tm-grid-width: 1000px;
                --tm-grid-left: 0px;
                display: grid;
                grid-template-columns: repeat(var(--tm-cols), minmax(0, 1fr));
                gap: var(--tm-gap);
                box-sizing: border-box;
                width: var(--tm-grid-width);
                max-width: var(--tm-grid-width);
                margin: 0 0 0 var(--tm-grid-left);
                padding: 0;
                overflow: visible;
                position: relative;
                z-index: 0;
            }

            #${GRID_ID} > [data-virtual-slot],
            #${GRID_ID} [data-tm-watch-grid] > [data-virtual-slot] {
                min-width: 0 !important;
                width: auto !important;
                max-width: none !important;
                flex: none !important;
                transform: none !important;
                translate: none !important;
                overflow: visible !important;
                position: relative !important;
            }

            #${GRID_ID} [data-uia="standard-card"] {
                display: block;
                width: 100%;
                pointer-events: auto !important;
            }

            #${GRID_ID} img {
                display: block;
                width: 100%;
                max-width: 100%;
                height: auto;
            }

            #${GRID_ID} [data-tm-viewing-actions] {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                padding-top: 6px;
                position: relative;
                z-index: 1;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button {
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 5px;
                padding: 5px 8px;
                background: #242424;
                color: rgba(255,255,255,.85);
                font: inherit;
                font-size: 12px;
                line-height: 1.3;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button:hover,
            #${GRID_ID} [data-tm-viewing-actions] > button:focus-visible {
                border-color: #fff;
                color: #fff;
                outline: 2px solid #fff;
                outline-offset: 2px;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button:disabled { opacity: .45; cursor: default; }
            #${GRID_ID} [data-tm-viewing-actions] > button[hidden] { display: none; }

            #${GRID_ID} > [data-tm-watch-section],
            #${GRID_ID} > [data-tm-type-filter],
            #${GRID_ID} > [data-tm-watch-controls],
            #${GRID_ID} > [data-tm-watch-empty] {
                grid-column: 1 / -1;
                min-width: 0;
                margin: 12px 0;
                color: rgba(255,255,255,.8);
                font: inherit;
            }

            #${GRID_ID} [data-tm-watch-grid] {
                display: grid;
                grid-template-columns: repeat(var(--tm-cols), minmax(0, 1fr));
                gap: var(--tm-gap);
                margin-top: 16px;
            }

            #${GRID_ID} [data-tm-watch-section]:not([open]) > :not(summary),
            #${GRID_ID} [data-tm-type-hidden="true"] {
                display: none !important;
            }

            #${GRID_ID} [data-tm-type-filter] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
                padding: 5px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 12px;
                background: rgba(255,255,255,.035);
                width: fit-content;
                max-width: 100%;
                box-sizing: border-box;
                margin: 4px 0 18px;
            }

            #${GRID_ID} [data-tm-type-filter] > button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                min-height: 40px;
                padding: 8px 16px;
                border: 1px solid transparent;
                border-radius: 8px;
                background: transparent;
                color: rgba(255,255,255,.7);
                font: inherit;
                font-size: .9em;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-type-filter] > button:hover {
                background: rgba(255,255,255,.08);
                color: #fff;
            }

            #${GRID_ID} [data-tm-type-filter] > button[aria-pressed="true"] {
                background: #e50914;
                color: #fff;
                font-weight: 600;
            }

            #${GRID_ID} [data-tm-type-filter] > button:focus-visible {
                outline: 2px solid #fff;
                outline-offset: 3px;
            }

            #${GRID_ID} [data-tm-type-count] {
                min-width: 1.5em;
                padding: 2px 6px;
                border-radius: 5px;
                background: rgba(255,255,255,.1);
                font-size: .8em;
                font-variant-numeric: tabular-nums;
                text-align: center;
            }

            #${GRID_ID} [data-tm-watch-section] {
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 12px;
                padding: 12px 18px;
                background: rgba(255,255,255,.025);
            }

            #${GRID_ID} [data-tm-watch-section] > summary {
                cursor: pointer;
                padding: 8px 0;
                font-size: 1.15em;
                font-weight: 600;
            }

            #${GRID_ID} [data-tm-watch-section] > [data-tm-type-filter] {
                margin-top: 14px;
            }

            #${GRID_ID} [data-tm-watch-controls] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                font-size: .9em;
            }

            #${GRID_ID} [data-tm-watch-controls] > button {
                border: 1px solid rgba(255,255,255,.4);
                border-radius: 4px;
                background: transparent;
                color: inherit;
                font: inherit;
                padding: 6px 10px;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-watch-controls] > button:disabled {
                opacity: .6;
                cursor: default;
            }

            #${GRID_ID} [data-tm-watch-empty][hidden] {
                display: none !important;
            }

        `;
        document.head.appendChild(style);
    }

    function measureNativeCarouselGap(section) {
        if (!section) return Math.max(20, Math.min(56, window.innerWidth * 0.02));
        const values = [];
        const sectionRect = section.getBoundingClientRect();
        const siblings = [...section.parentElement?.children || []].filter(node =>
            node instanceof HTMLElement && node !== section && node.matches('section') && node.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller)
        );
        const index = [...section.parentElement?.children || []].indexOf(section);
        const previous = [...section.parentElement?.children || []].slice(0, index).reverse().find(node => siblings.includes(node));
        const next = [...section.parentElement?.children || []].slice(index + 1).find(node => siblings.includes(node));

        if (previous) {
            const gap = sectionRect.top - previous.getBoundingClientRect().bottom;
            if (gap >= 8 && gap <= 180) values.push(gap);
            const margin = Number.parseFloat(getComputedStyle(previous).marginBottom || '0');
            if (margin >= 8 && margin <= 180) values.push(margin);
        }
        if (next) {
            const gap = next.getBoundingClientRect().top - sectionRect.bottom;
            if (gap >= 8 && gap <= 180) values.push(gap);
            const margin = Number.parseFloat(getComputedStyle(next).marginTop || '0');
            if (margin >= 8 && margin <= 180) values.push(margin);
        }
        const ownMargin = Number.parseFloat(getComputedStyle(section).marginBottom || '0');
        if (ownMargin >= 8 && ownMargin <= 180) values.push(ownMargin);
        return values.length ? median(values) : Math.max(20, Math.min(56, window.innerWidth * 0.02));
    }

    function graphqlData() {
        const candidates = [
            window,
            window?.wrappedJSObject,
            document.defaultView,
            document.defaultView?.wrappedJSObject
        ];
        for (const root of candidates) {
            try {
                const data = root?.netflix?.reactContext?.models?.graphql?.data;
                if (data && typeof data === 'object') return data;
            } catch (_) {}
        }
        return null;
    }

    function isMyListGraphqlSection(value) {
        if (!value || value.__typename !== 'PinotCarouselSection') return false;
        const listeners = Array.isArray(value.eventListeners) ? value.eventListeners : [];
        const types = new Set(listeners.map(listener => listener?.__typename).filter(Boolean));
        const hasPlaylistMutationListeners = types.has('PinotAddToPlaylistEventListener') &&
            types.has('PinotRemoveFromPlaylistEventListener');
        const hasPlaylistNotification = listeners.some(listener =>
            listener?.notificationMessageRegex === 'UPDATE_PLAYLIST'
        );
        return hasPlaylistMutationListeners || hasPlaylistNotification;
    }

    function graphqlCarouselCandidates(data) {
        return Object.entries(data || {}).filter(([, value]) =>
            value &&
            value.__typename === 'PinotCarouselSection' &&
            value.entities &&
            Number.isFinite(Number(value.entities.totalCount))
        );
    }

    function findMyListGraphqlEntry() {
        const data = graphqlData();
        if (!data) return null;

        if (myListGraphqlKey) {
            const cached = data[myListGraphqlKey];
            if (cached && cached.__typename === 'PinotCarouselSection' &&
                Number.isFinite(Number(cached.entities?.totalCount))) {
                return { key: myListGraphqlKey, value: cached, reason: 'cached-key' };
            }
            myListGraphqlKey = null;
        }

        const candidates = graphqlCarouselCandidates(data);
        for (const [key, value] of candidates) {
            if (!isMyListGraphqlSection(value)) continue;
            myListGraphqlKey = key;
            return { key, value, reason: 'playlist-event-listeners' };
        }

        // Generation 2 fallback: match the live My List row to the GraphQL section.
        // Do not rely on translated heading text or on the removed page indicators.
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        const domSection = host?.querySelector?.(`:scope > ${NETFLIX_DOM_SELECTORS.carouselRowOneSection}`) || null;
        const domSectionId = String(domSection?.id || '');
        if (domSectionId) {
            const matched = candidates.find(([, value]) => String(value?.id || '') === domSectionId);
            if (matched) {
                myListGraphqlKey = matched[0];
                return { key: matched[0], value: matched[1], reason: 'native-section-id' };
            }
        }

        if (domSection) {
            const domIds = netflixDom.sectionVideoIds(domSection);
            if (domIds.size) {
                let best = null;
                let bestOverlap = 0;
                for (const [key, value] of candidates) {
                    const ids = graphqlSectionVideoIds(value);
                    let overlap = 0;
                    for (const id of ids) if (domIds.has(id)) overlap++;
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        best = { key, value };
                    }
                }
                if (best && bestOverlap >= Math.min(2, domIds.size)) {
                    myListGraphqlKey = best.key;
                    return { ...best, reason: 'native-card-overlap', overlap: bestOverlap };
                }
            }
        }
        return null;
    }

    function graphqlSectionVideoIds(value) {
        const ids = new Set();
        for (const edge of value?.entities?.edges || []) {
            const ref = String(edge?.node?.__ref || '');
            const match = ref.match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
            if (match) ids.add(match[1]);
        }
        return ids;
    }

    // This adapter owns Netflix's browse-row and virtual-carousel DOM contracts.
    const netflixDom = Object.freeze({
        selectors: NETFLIX_DOM_SELECTORS,

        sectionVideoIds(section) {
            const ids = new Set();
            for (const card of section?.querySelectorAll?.(this.selectors.standardCardWithHref) || []) {
                const id = videoIdFromHref(card.getAttribute('href') || card.href || '');
                if (id) ids.add(String(id));
            }
            return ids;
        },

        isSyntheticSection(section) {
            return !section ||
                section.id === SYNTHETIC_SECTION_ID ||
                section.getAttribute('data-tm-synthetic-mylist') === 'true';
        },

        nativeSections(host) {
            if (!host) return [];
            return [...host.querySelectorAll(':scope > section')].filter(section => !this.isSyntheticSection(section));
        },

        nextNativeSection(section, host) {
            if (!section || !host) return null;
            let node = section.nextElementSibling;
            while (node) {
                if (node.matches?.('section') && !this.isSyntheticSection(node)) return node;
                node = node.nextElementSibling;
            }
            return null;
        },

        findContinueWatchingSection(host) {
            const sections = this.nativeSections(host);
            if (!sections.length) return null;

            // Non-empty Continue Watching has progress cards. Its row index is also
            // exposed as a language-neutral Uia. When the row is empty Netflix uses
            // the generic empty-carousel-section Uia, so the first native section on
            // /browse/my-list remains the structural anchor.
            const progressSection = sections.find(section => section.querySelector(this.selectors.progressCard));
            if (progressSection) return progressSection;

            const rowZero = sections.find(section => section.getAttribute('data-uia') === this.selectors.carouselRowZero);
            if (rowZero) return rowZero;

            const first = sections[0];
            if (first?.getAttribute('data-uia') === this.selectors.emptyCarouselSection) return first;
            return null;
        },

        findStructuralMyListSection(host) {
            if (!host) return null;
            const nativeSections = this.nativeSections(host);
            const alreadyBound = nativeSections.find(section => section.getAttribute(SECTION_ATTR) === 'true');
            if (alreadyBound) return alreadyBound;

            // On /browse/my-list Netflix assigns the native My List carousel row the
            // language-neutral structural Uia for row 1. This remains available even
            // when Continue Watching is empty, which has no progress-card elements.
            const indexedMyList = nativeSections.find(section =>
                section.getAttribute('data-uia') === this.selectors.carouselRowOne
            );
            if (indexedMyList) return indexedMyList;

            // Empty My List has the generic empty-carousel-section Uia. In that case
            // use the page structure: My List immediately follows Continue Watching.
            // nextNativeSection() deliberately skips our synthetic placeholder.
            const continueWatching = this.findContinueWatchingSection(host);
            const adjacent = this.nextNativeSection(continueWatching, host);
            if (adjacent) return adjacent;

            return null;
        },

        findSectionByGraphqlIdentity(host, graphqlIdentity) {
            if (!host || !graphqlIdentity) return null;
            const graphqlSectionId = graphqlIdentity.sectionId;
            const byGraphqlId = graphqlSectionId ? document.getElementById(graphqlSectionId) : null;
            if (byGraphqlId?.matches?.('section') && byGraphqlId.parentElement === host &&
                !this.isSyntheticSection(byGraphqlId)) {
                return byGraphqlId;
            }

            const expectedIds = new Set(graphqlIdentity.videoIds);
            if (expectedIds.size) {
                let bestSection = null;
                let bestOverlap = 0;
                for (const section of nativeSections) {
                    const ids = this.sectionVideoIds(section);
                    let overlap = 0;
                    for (const id of ids) if (expectedIds.has(id)) overlap++;
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        bestSection = section;
                    }
                }
                if (bestSection && bestOverlap >= Math.min(2, expectedIds.size)) return bestSection;
            }

            return null;
        },

        findTrack(scroller) {
            if (!scroller) return null;
            for (const div of scroller.querySelectorAll('div')) {
                if (div.querySelector(`:scope > ${this.selectors.virtualSlot}`)) return div;
            }
            return null;
        },

        directSlots(track) {
            return track ? [...track.querySelectorAll(`:scope > ${this.selectors.virtualSlot}`)] : [];
        },

        filledSlots(track) {
            return this.directSlots(track).filter(slot => slot.querySelector(this.selectors.standardCard));
        },

        positionSyntheticSection(section, host) {
            if (!section || !host) return;

            // On the My List browse page Netflix places the My List rail immediately
            // after Continue Watching. A synthetic empty/loading rail must occupy that
            // same slot; prepending it to the sections host makes it jump above all
            // native rows while Netflix is still building the page.
            const continueWatching = this.findContinueWatchingSection(host);
            if (continueWatching) {
                if (continueWatching.nextElementSibling !== section) {
                    continueWatching.insertAdjacentElement('afterend', section);
                }
                return;
            }

            const firstNativeSection = [...host.querySelectorAll(':scope > section')].find(node => node !== section);
            if (firstNativeSection) {
                if (firstNativeSection.nextElementSibling !== section) {
                    firstNativeSection.insertAdjacentElement('afterend', section);
                }
                return;
            }

            if (section.parentElement !== host) host.appendChild(section);
        },

        ensureSyntheticMyListSection() {
            const host = document.querySelector(this.selectors.browseSections);
            if (!host) return null;

            let section = document.getElementById(SYNTHETIC_SECTION_ID);
            const nativeSections = [...host.querySelectorAll(':scope > section')].filter(node => node !== section);
            // Do not guess a position before Netflix has rendered at least one native row.
            // The MutationObserver/poll will call us again as soon as the row stack exists.
            if (!nativeSections.length) return null;

            if (!section) {
                section = document.createElement('section');
                section.id = SYNTHETIC_SECTION_ID;
                section.setAttribute('data-tm-synthetic-mylist', 'true');
            }
            this.positionSyntheticSection(section, host);
            return section;
        }
    });

    // Joins structural DOM discovery with GraphQL identity as the last fallback.
    function findMyListSection() {
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        if (!host) return null;
        return netflixDom.findStructuralMyListSection(host) ||
            netflixDom.findSectionByGraphqlIdentity(host, netflixGraphql.myListDomIdentity());
    }

    function median(values) {
        const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!nums.length) return 0;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }

    function parseSlotLayoutFormula(track) {
        const slot = netflixDom.directSlots(track).find(node => node.getAttribute('style')?.includes('calc('));
        if (!slot) return null;

        const style = slot.getAttribute('style') || '';
        const match = style.match(/calc\(\(\s*100%\s*-\s*([0-9.]+)px\s*\)\s*\/\s*([0-9]+)\s*\)/i);
        if (!match) return null;

        const subtractPx = Number(match[1]);
        const columns = Number(match[2]);
        if (!Number.isFinite(subtractPx) || !Number.isFinite(columns) || columns < 1) return null;

        const computedTrack = getComputedStyle(track);
        const gap = Number.parseFloat(computedTrack.columnGap || computedTrack.gap || '8') || 8;
        const paddingLeft = Math.max(0, Number.parseFloat(computedTrack.paddingLeft || '0') || 0);
        const paddingRight = Math.max(0, Number.parseFloat(computedTrack.paddingRight || '0') || 0);
        const formulaSidePadding = Math.max(0, (subtractPx - gap * Math.max(0, columns - 1)) / 2);

        return { columns, subtractPx, gap, paddingLeft, paddingRight, formulaSidePadding };
    }

    function measureVisibleLayout(section, scroller, track) {
        const sectionRect = nativeRect(section);
        const scrollerRect = nativeRect(scroller);
        const formula = parseSlotLayoutFormula(track);

        if (formula) {
            const { columns, gap, paddingLeft, paddingRight, formulaSidePadding } = formula;
            // Netflix has two native slot formulas. Multi-page rows may include the
            // side padding in calc(), while a genuine one-page row uses track padding
            // plus a gap-only calc((100% - 40px) / 6). Prefer the actual computed
            // track padding whenever it is present so the legacy cards share the exact
            // native x coordinates in both cases.
            const explicitPadding = paddingLeft > 0.5 || paddingRight > 0.5;
            const sidePaddingLeft = explicitPadding ? paddingLeft : formulaSidePadding;
            const sidePaddingRight = explicitPadding ? paddingRight : formulaSidePadding;
            const sidePadding = (sidePaddingLeft + sidePaddingRight) / 2;
            const gridWidth = Math.max(1, scrollerRect.width - sidePaddingLeft - sidePaddingRight);
            const cardWidth = Math.max(1, (gridWidth - gap * Math.max(0, columns - 1)) / columns);
            const gridLeft = Math.max(0, scrollerRect.left - sectionRect.left + sidePaddingLeft);

            return {
                columns,
                cardWidth,
                gap,
                gridLeft,
                gridWidth,
                sidePadding,
                sidePaddingLeft,
                sidePaddingRight,
                scrollerWidth: Math.max(1, scrollerRect.width),
                scrollerHeight: Math.max(1, scrollerRect.height),
                widthRatio: cardWidth / gridWidth,
                formulaBased: true
            };
        }

        // Fallback: prefer the current page card count instead of the number visible in the viewport.
        const activeSlots = netflixDom.filledSlots(track).filter(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.getAttribute('tabindex') === '0';
        });
        const sample = activeSlots.length ? activeSlots : netflixDom.filledSlots(track);
        const rects = sample
            .map(slot => nativeRect(slot))
            .filter(rect => rect.width > 1)
            .sort((a, b) => a.left - b.left);

        const columns = Math.max(1, activeSlots.length || rects.length || 5);
        const cardWidth = Math.max(1, median(rects.map(rect => rect.width)) || scrollerRect.width / columns);
        const gaps = [];
        for (let i = 1; i < rects.length; i++) {
            const g = rects[i].left - rects[i - 1].right;
            if (g >= 0 && g < 100) gaps.push(g);
        }
        const gap = gaps.length ? median(gaps) : 8;
        const sidePadding = Math.max(0, (scrollerRect.width - (cardWidth * columns + gap * Math.max(0, columns - 1))) / 2);
        const gridWidth = Math.max(1, scrollerRect.width - sidePadding * 2);
        const gridLeft = Math.max(0, scrollerRect.left - sectionRect.left + sidePadding);

        return {
            columns,
            cardWidth,
            gap,
            gridLeft,
            gridWidth,
            sidePadding,
            sidePaddingLeft: sidePadding,
            sidePaddingRight: sidePadding,
            scrollerWidth: Math.max(1, scrollerRect.width),
            scrollerHeight: Math.max(1, scrollerRect.height),
            widthRatio: cardWidth / gridWidth,
            formulaBased: false
        };
    }

    function measureEmptyLayout(section) {
        const sectionRect = section.getBoundingClientRect();
        const content = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const heading = section.querySelector(':scope > [data-uia="empty-carousel-section+title"], :scope > h2');
        const reference = content || heading;
        const referenceRect = reference?.getBoundingClientRect?.();

        let gridLeft = 0;
        let gridWidth = 0;
        let sidePaddingLeft = 0;
        let sidePaddingRight = 0;

        const hasNativeReference = Boolean(
            referenceRect &&
            Number.isFinite(referenceRect.left) &&
            Number.isFinite(referenceRect.right) &&
            Number.isFinite(referenceRect.width) &&
            referenceRect.width > 1 &&
            sectionRect.width > 1 &&
            referenceRect.left >= sectionRect.left - 1 &&
            referenceRect.right <= sectionRect.right + 1
        );

        const nativeEmptySection = section.matches?.('[data-uia="empty-carousel-section"]');
        const originalHiddenByScript = nativeEmptySection && (
            section.classList.contains(ORIGINAL_HIDDEN_CLASS) ||
            section.getAttribute(ORIGINAL_VISIBILITY_ATTR) === 'false'
        );

        if (hasNativeReference) {
            // Empty Netflix sections are already horizontally inset. Using the
            // viewport fallback here would subtract the same padding twice.
            gridLeft = Math.max(0, referenceRect.left - sectionRect.left);
            gridWidth = Math.max(1, referenceRect.width);
            sidePaddingLeft = gridLeft;
            sidePaddingRight = Math.max(0, sectionRect.right - referenceRect.right);
        } else if (originalHiddenByScript && sectionRect.width > 1) {
            // When Original My List is hidden, our CSS sets the native empty title
            // and content to display:none. Their rects therefore collapse to zero.
            // The native empty section itself already carries Netflix's responsive
            // horizontal inset, so using the viewport fallback would inset it again
            // (48px -> 96px at the desktop breakpoint) and shrink the legacy frame.
            gridLeft = 0;
            gridWidth = Math.max(1, sectionRect.width);
            sidePaddingLeft = 0;
            sidePaddingRight = 0;
        } else {
            // Synthetic loading/empty sections have no native child geometry.
            // Reproduce the responsive Netflix page padding only in that case.
            let fallbackPadding;
            if (window.innerWidth >= 2560) fallbackPadding = 72;
            else if (window.innerWidth >= 1600) fallbackPadding = 60;
            else if (window.innerWidth >= 1280) fallbackPadding = 48;
            else if (window.innerWidth >= 600) fallbackPadding = 36;
            else fallbackPadding = 24;

            sidePaddingLeft = fallbackPadding;
            sidePaddingRight = fallbackPadding;
            gridLeft = sidePaddingLeft;
            gridWidth = Math.max(1, sectionRect.width - sidePaddingLeft - sidePaddingRight);
        }

        const columns = Math.max(1, Math.round(gridWidth / 290));
        const gap = 8;
        const cardWidth = Math.max(1, (gridWidth - gap * Math.max(0, columns - 1)) / columns);
        return {
            columns,
            cardWidth,
            gap,
            gridLeft,
            gridWidth,
            sidePadding: (sidePaddingLeft + sidePaddingRight) / 2,
            sidePaddingLeft,
            sidePaddingRight,
            scrollerWidth: Math.max(1, sectionRect.width),
            scrollerHeight: 1,
            widthRatio: cardWidth / gridWidth,
            formulaBased: false
        };
    }

    function placeLegacyFrame(section, scroller, layout, { elapsedMs = null, finalized = false, totalCount = null } = {}) {
        section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(section);

        let grid = document.getElementById(GRID_ID);
        if (!grid) {
            grid = document.createElement('div');
            grid.id = GRID_ID;
            grid.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        }
        if (!grid.children.length) grid.setAttribute('data-tm-empty', 'true');

        const geometry = applyGridGeometry(section, grid, layout);
        const status = updateStatus(formatHeaderParts(0, totalCount, elapsedMs, finalized));
        const header = section.querySelector(`:scope > .${ORIGINAL_HEADER_CLASS}`) || markOriginalHeader(section);
        const emptyContent = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const anchor = scroller?.isConnected ? scroller : (emptyContent?.isConnected ? emptyContent : header);
        if (anchor) anchor.insertAdjacentElement('afterend', status);
        else section.prepend(status);
        syncStatusTypography(section, status);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        status.insertAdjacentElement('afterend', grid);
        grid.style.marginTop = '0px';

        return { status, grid, geometry };
    }

    function clearLegacyEmptyState({ restoreGrid = true } = {}) {
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        if (!restoreGrid) return;
        const status = sourceState?.status || document.getElementById(STATUS_ID);
        const grid = sourceState?.grid || document.getElementById(GRID_ID);
        if (status?.isConnected && grid?.isConnected && status.nextElementSibling !== grid) {
            status.insertAdjacentElement('afterend', grid);
        }
    }

    function sanitizeLegacyEmptyClone(clone, source) {
        if (!clone) return null;
        clone.id = LEGACY_EMPTY_STATE_ID;
        clone.classList.remove(ORIGINAL_HEADER_CLASS);
        clone.removeAttribute('data-uia');
        clone.setAttribute('data-tm-legacy-empty-state', 'true');
        clone.setAttribute('data-tm-empty-source', source);
        for (const node of clone.querySelectorAll('[id], [data-uia]')) {
            node.removeAttribute('id');
            node.removeAttribute('data-uia');
            node.classList?.remove?.(ORIGINAL_HEADER_CLASS);
        }
        return clone;
    }

    function cloneNativeEmptyContent(section) {
        const original = section?.querySelector?.(':scope > [data-uia="empty-carousel-section+content"]');
        if (!original) return null;

        const message = normalizeNetflixUiText(
            original.querySelector('[data-uia="empty-carousel-section+message"]')?.textContent || ''
        );
        if (message) cachedNativeEmptyMessage = message;
        cachedNativeEmptyContent = original.cloneNode(true);

        return sanitizeLegacyEmptyClone(original.cloneNode(true), 'native');
    }

    function provisionalMyListEmptyMessage() {
        if (cachedNativeEmptyMessage) return cachedNativeEmptyMessage;
        return tUi('emptyMessage');
    }

    function cloneProvisionalEmptyContent() {
        if (cachedNativeEmptyContent) {
            return sanitizeLegacyEmptyClone(cachedNativeEmptyContent.cloneNode(true), 'provisional-cached');
        }

        const shell = [...document.querySelectorAll('[data-uia="empty-carousel-section+content"]')]
            .find(node => !node.closest(`[${SECTION_ATTR}="true"]`));
        if (shell) {
            const clone = shell.cloneNode(true);
            clone.querySelector('[data-uia="empty-carousel-section+pictogram"]')?.remove();
            const messageNode = clone.querySelector('[data-uia="empty-carousel-section+message"]');
            if (messageNode) {
                messageNode.textContent = provisionalMyListEmptyMessage();
            } else {
                const p = document.createElement('p');
                p.textContent = provisionalMyListEmptyMessage();
                clone.appendChild(p);
            }
            return sanitizeLegacyEmptyClone(clone, 'provisional-shell');
        }

        const fallback = document.createElement('div');
        const message = document.createElement('p');
        message.textContent = provisionalMyListEmptyMessage();
        fallback.appendChild(message);
        return sanitizeLegacyEmptyClone(fallback, 'provisional-fallback');
    }

    function applyLegacyEmptyStateGeometry(section, layout) {
        const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
        if (!emptyState?.isConnected || !section || !layout) return;
        const geometry = currentGridGeometry(section, layout);
        emptyState.style.marginLeft = `${geometry.left}px`;
        emptyState.style.width = `${geometry.width}px`;
        emptyState.style.maxWidth = `${geometry.width}px`;
    }

    function syncLegacyEmptyState(section, { allowProvisional = false } = {}) {
        clearLegacyEmptyState({ restoreGrid: false });
        const status = sourceState?.status || document.getElementById(STATUS_ID);
        const grid = sourceState?.grid || document.getElementById(GRID_ID);
        if (!status?.isConnected || !grid?.isConnected) return false;

        const clone = cloneNativeEmptyContent(section) || (allowProvisional ? cloneProvisionalEmptyContent() : null);
        if (!clone) {
            if (status.nextElementSibling !== grid) status.insertAdjacentElement('afterend', grid);
            return false;
        }

        status.insertAdjacentElement('afterend', clone);
        clone.insertAdjacentElement('afterend', grid);
        const layout = sourceState?.layout;
        if (layout) applyLegacyEmptyStateGeometry(section, layout);
        return true;
    }

    async function waitForNativeSource(section, timeout = NATIVE_READY_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        while (performance.now() - started < timeout) {
            assertRouteSession(sessionToken);
            if (section.id === SYNTHETIC_SECTION_ID) {
                const nativeSection = findMyListSection();
                if (nativeSection && nativeSection !== section) {
                    return { found: false, nativeSection, elapsedMs: Math.round(performance.now() - started) };
                }
            }

            const scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
            const track = scroller && netflixDom.findTrack(scroller);
            if (scroller && track) return { found: true, scroller, track, elapsedMs: Math.round(performance.now() - started) };
            await sleep(NATIVE_READY_POLL_MS);
        }
        assertRouteSession(sessionToken);
        return {
            found: false,
            empty: false,
            reason: 'timeout',
            stage: 'native-source',
            timeoutMs: timeout,
            elapsedMs: Math.round(performance.now() - started)
        };
    }

    function finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, reason = 'empty') {
        document.getElementById(GRID_ID)?.replaceChildren();
        const elapsedMs = performance.now() - initializationStarted;
        const frame = placeLegacyFrame(section, scroller, layout, { elapsedMs, finalized: true, totalCount: 0 });
        frame.grid.setAttribute('data-tm-empty', 'true');
        if (scroller && track) {
            track.classList.add('tm-netflix-mylist-v15-track');
            scroller.classList.add(SOURCE_PARKED_CLASS);
        }
        sourceState = {
            section,
            scroller: scroller || null,
            track: track || null,
            layout,
            items: [],
            totalCount: 0,
            grid: frame.grid,
            status: frame.status,
            cloneMap: new Map(),
            itemMap: new Map(),
            empty: true,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        };
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(section, { allowProvisional: true });
        completedSection = section;
        if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
            performanceDiagnostics.nativeRecovery.completed++;
        }
        resetOrderMismatchStateAfterInitialization();
        applyOriginalMyListVisibility();
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!frame.grid.isConnected) return;
            if (sourceState?.empty) {
                const nextLayout = sourceState.scroller && sourceState.track
                    ? measureVisibleLayout(section, sourceState.scroller, sourceState.track)
                    : measureEmptyLayout(section);
                nextLayout.rowGap = measureNativeCarouselGap(section);
                sourceState.layout = nextLayout;
                const geometry = applyGridGeometry(section, frame.grid, nextLayout);
                frame.status.style.marginLeft = `${geometry.left}px`;
                frame.status.style.width = `${geometry.width}px`;
                applyLegacyEmptyStateGeometry(section, nextLayout);
            }
        });
        resizeObserver.observe(section);
        if (scroller) resizeObserver.observe(scroller);
        log(tLog('emptyLegacyListFinalized'), {
            reason,
            elapsedMs: Math.round(elapsedMs),
            layout: layoutSummary(layout)
        });
    }

    function extractFreshMyListBootstrap(html) {
        const text = String(html || '');
        const notificationMarker = '"notificationMessageRegex":"UPDATE_PLAYLIST"';
        const sectionMarker = '"__typename":"PinotCarouselSection"';
        let from = 0;

        while (from < text.length) {
            const notificationIndex = text.indexOf(notificationMarker, from);
            if (notificationIndex < 0) break;
            const sectionStart = text.lastIndexOf(sectionMarker, notificationIndex);
            if (sectionStart >= 0 && notificationIndex - sectionStart <= 50000) {
                const block = text.slice(sectionStart, notificationIndex + notificationMarker.length + 1024);
                const totalMatch = block.match(/"entities":\{"totalCount":(\d+)/);
                if (totalMatch) {
                    const firstVideoMatch = block.match(/standardBoxshot_Video:(\d+)/);
                    return {
                        totalCount: Number(totalMatch[1]),
                        firstVideoId: firstVideoMatch?.[1] || '',
                        sectionStart,
                        notificationIndex
                    };
                }
            }
            from = notificationIndex + notificationMarker.length;
        }
        return null;
    }

    function netflixModelData(name) {
        const roots = [
            window,
            window?.wrappedJSObject,
            document.defaultView,
            document.defaultView?.wrappedJSObject
        ];
        for (const root of roots) {
            try {
                const appContext = root?.netflix?.appContext;
                if (appContext && typeof appContext.getModelData === 'function') {
                    const value = appContext.getModelData(name);
                    if (value != null) return value;
                }
            } catch (_) {}
            try {
                const value = root?.netflix?.reactContext?.models?.[name]?.data;
                if (value != null) return value;
            } catch (_) {}
        }
        return null;
    }

    // Viewing status is read separately from native card markup. A shared card
    // template or membership in Continue Watching cannot establish completion.
    function unwrapViewingAtom(value) {
        if (value?.$type === 'error') return undefined;
        return value?.$type === 'atom' ? value.value : value;
    }

    function readViewingGraph(graph, path) {
        let value = graph;
        const resolve = input => {
            let node = unwrapViewingAtom(input);
            const visited = new Set();
            while (node?.$type === 'ref') {
                const reference = node.value;
                if (!Array.isArray(reference) || reference.length > 12) return undefined;
                const key = JSON.stringify(reference);
                if (visited.has(key) || visited.size >= 12) return undefined;
                visited.add(key);
                node = readViewingGraphReference(graph, reference);
                node = unwrapViewingAtom(node);
            }
            return node;
        };
        for (const key of path) {
            value = resolve(value);
            if (!value || typeof value !== 'object') return undefined;
            value = value[key];
        }
        return resolve(value);
    }

    function readViewingGraphReference(graph, path) {
        let value = graph;
        for (const key of path) {
            value = unwrapViewingAtom(value);
            if (!value || typeof value !== 'object') return undefined;
            value = value[key];
        }
        return value;
    }

    function viewingNumber(value) {
        const unwrapped = unwrapViewingAtom(value);
        return typeof unwrapped === 'number' && Number.isFinite(unwrapped) && unwrapped >= 0
            ? unwrapped : null;
    }

    function viewingCount(value) {
        const unwrapped = unwrapViewingAtom(value);
        // Missing counts can be recovered from covered lists; malformed counts
        // must not become permission to ignore inconsistent metadata.
        if (unwrapped == null) return null;
        return Number.isSafeInteger(unwrapped) && unwrapped >= 0 ? unwrapped : NaN;
    }

    function viewingVideoRecord(graph, videoId, type = '') {
        const video = readViewingGraph(graph, ['videos', String(videoId)]);
        if (!video || typeof video !== 'object') return null;
        const field = key => video[key]?.$type === 'ref'
            ? readViewingGraph(graph, ['videos', String(videoId), key]) : unwrapViewingAtom(video[key]);
        const summary = field('summary');
        return {
            videoId: String(videoId),
            type: type || (typeof summary?.type === 'string' ? summary.type.toLowerCase() : ''),
            watched: field('watched'),
            bookmark: viewingNumber(field('bookmarkPosition')),
            runtime: viewingNumber(field('runtime')),
            creditsOffset: viewingNumber(field('creditsOffset')),
            seasonCount: viewingCount(field('seasonCount')),
            episodeCount: viewingCount(field('episodeCount'))
        };
    }

    function viewingFieldKind(value, depth = 0) {
        if (value === undefined) return 'missing';
        if (value === null) return 'null';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return !Number.isFinite(value) ? 'invalid-number'
            : value < 0 ? 'negative-number' : value === 0 ? 'zero' : 'positive-number';
        if (typeof value === 'string') return 'string';
        if (value?.$type === 'error') return 'error';
        if (value?.$type === 'ref') return 'reference';
        if (value?.$type === 'atom' && depth < 2) return 'atom:' + viewingFieldKind(value.value, depth + 1);
        return 'object';
    }

    function recordViewingFieldKinds(graph, id, counts) {
        const video = readViewingGraph(graph, ['videos', String(id)]);
        const kinds = {};
        for (const [key, field] of [['watched', 'watched'], ['bookmark', 'bookmarkPosition'], ['runtime', 'runtime']]) {
            const kind = viewingFieldKind(video?.[field]);
            kinds[key] = kind;
            counts[key][kind] = (counts[key][kind] || 0) + 1;
        }
        return kinds;
    }

    function classifyViewingVideo(record) {
        if (!record || !['movie', 'episode'].includes(record.type)) return 'unknown';
        if (record.watched === true) return 'complete';
        // Stopping at the credits can leave Netflix's flag false. Accept enough
        // playback independently of that flag, with a small allowance for credits.
        if (record.runtime > 0 && record.bookmark !== null) {
            const creditsBoundary = record.creditsOffset > 0 && record.creditsOffset <= record.runtime
                ? record.creditsOffset : record.runtime;
            const boundary = Math.min(creditsBoundary, record.runtime * VIEWING_COMPLETION_RATIO);
            if (record.bookmark >= boundary) return 'complete';
        }
        if (record.bookmark > 0) return 'in-progress';
        if (record.watched === false && record.bookmark === 0) return 'not-started';
        return 'unknown';
    }

    function viewingReferenceId(reference, kind) {
        const value = unwrapViewingAtom(reference);
        const path = Array.isArray(value) ? value : (value?.$type === 'ref' ? value.value : null);
        return Array.isArray(path) && path.length === 2 && path[0] === kind && /^\d+$/.test(String(path[1]))
            ? String(path[1]) : '';
    }

    function viewingSeasonPlan(graph, record) {
        const count = record.seasonCount ?? viewingCount(readViewingGraph(graph, ['videos', record.videoId, 'seasonList', 'length']));
        const expected = record.episodeCount;
        if (!Number.isSafeInteger(count) || count < 1 || count > VIEWING_MAX_SEASONS ||
            (expected !== null && (!Number.isSafeInteger(expected) || expected < 1 || expected > VIEWING_MAX_EPISODES))) return null;
        const list = readViewingGraph(graph, ['videos', record.videoId, 'seasonList']);
        if (!list || typeof list !== 'object') return null;
        if (Object.keys(list).some(key => /^\d+$/.test(key) && Number(key) >= count)) return null;
        const seasons = [];
        const seen = new Set();
        let total = 0;
        for (let index = 0; index < count; index++) {
            const id = viewingReferenceId(list[index], 'seasons');
            const summary = id ? readViewingGraph(graph, ['seasons', id, 'summary']) : null;
            const length = viewingCount(summary?.length ?? readViewingGraph(graph, ['seasons', id, 'length']));
            if (!id || seen.has(id) || !Number.isSafeInteger(length) || length > VIEWING_MAX_EPISODES) return null;
            seen.add(id);
            total += length;
            if (total > VIEWING_MAX_EPISODES || (expected !== null && total > expected)) return null;
            seasons.push({ id, count: length, episodes: new Map() });
        }
        return total > 0 && (expected === null || total === expected)
            ? { videoId: record.videoId, expected: total, seasons } : null;
    }

    function classifyViewingSeries(plan) {
        if (!plan) return 'unknown';
        const ids = new Set();
        const statuses = [];
        for (const season of plan.seasons) {
            for (let index = 0; index < season.count; index++) {
                const episode = season.episodes.get(index);
                if (!episode?.id || ids.has(episode.id) || episode.status === 'unknown') return 'unknown';
                ids.add(episode.id);
                statuses.push(episode.status);
            }
        }
        if (statuses.length !== plan.expected || !statuses.length) return 'unknown';
        if (statuses.every(status => status === 'complete')) return 'complete';
        return statuses.every(status => status === 'not-started') ? 'not-started' : 'in-progress';
    }

    function viewingLatestEpisode(plan) {
        for (let seasonIndex = plan.seasons.length - 1; seasonIndex >= 0; seasonIndex--) {
            const season = plan.seasons[seasonIndex];
            if (season.count > 0) return { season, seasonNumber: seasonIndex + 1, index: season.count - 1,
                episode: season.episodes.get(season.count - 1) };
        }
        return null;
    }

    function viewingProgressSummary(record) {
        const status = classifyViewingVideo(record);
        const percent = record?.runtime > 0 && record.bookmark !== null
            ? Math.round(Math.min(100, record.bookmark / record.runtime * 100) * 10) / 10 : null;
        const creditsReached = Boolean(record?.runtime > 0 && record.creditsOffset > 0 &&
            record.creditsOffset <= record.runtime && record.bookmark !== null && record.bookmark >= record.creditsOffset);
        return { status, percent, thresholdPercent: VIEWING_COMPLETION_RATIO * 100,
            watched: typeof record?.watched === 'boolean' ? record.watched : null, creditsReached,
            reason: status === 'complete' ? record.watched === true ? 'watched-flag'
                : creditsReached ? 'credits-reached' : 'completion-threshold'
                : percent === null ? 'progress-unavailable' : 'below-completion-threshold' };
    }

    function viewingSeriesResult(plan) {
        const latest = viewingLatestEpisode(plan)?.episode;
        const ids = plan.seasons.flatMap(season => [...season.episodes.values()]).filter(episode => episode.id).map(episode => episode.id);
        // The user selected this inference even when older progress is absent or
        // reset. A validated season plan identifies the latest returned episode.
        if (latest?.id && latest.status === 'complete' && new Set(ids).size === ids.length) return 'complete';
        return classifyViewingSeries(plan);
    }

    function viewingRequestContext() {
        const user = netflixModelData('userInfo');
        // guid is the account owner's profile; userGuid is the active profile.
        const profileGuid = user?.userGuid;
        const authURL = user?.authURL;
        const services = netflixModelData('services');
        const build = netflixModelData('serverDefs')?.BUILD_IDENTIFIER;
        let base = services?.memberapi;
        let endpointType = 'string';
        if (base == null || base === '') {
            base = typeof build === 'string' && build ? '/api/shakti/' + encodeURIComponent(build) : '';
            endpointType = 'build';
        } else if (typeof base === 'object') {
            // Netflix also exposes memberapi as a URL descriptor. Stringifying
            // that object sends requests to /[object Object]/pathEvaluator.
            const { protocol, hostname, path } = base;
            if (typeof protocol !== 'string' || !/^https:?$/i.test(protocol) ||
                typeof hostname !== 'string' || !hostname ||
                !Array.isArray(path) || !path.length ||
                !path.every(part => typeof part === 'string' && part.length > 0)) return null;
            base = protocol.replace(/:$/, '') + '://' + hostname + '/' + path.join('/').replace(/^\/+/, '');
            endpointType = 'descriptor';
        }
        if (typeof profileGuid !== 'string' || !profileGuid || typeof authURL !== 'string' || !authURL ||
            typeof base !== 'string' || !base) return null;
        try {
            const url = new URL(base, location.origin);
            if (url.origin !== location.origin || url.protocol !== 'https:' ||
                url.username || url.password || url.search || url.hash || url.pathname === '/') return null;
            url.pathname = url.pathname.replace(/\/+$/, '') + '/pathEvaluator';
            url.searchParams.set('falcor_server', '0.1.0');
            url.searchParams.set('withSize', 'false');
            url.searchParams.set('materialize', 'false');
            url.searchParams.set('original_path', '/shakti/mre/pathEvaluator');
            return { profileGuid, authURL, url: url.href, endpointType, endpointPath: url.pathname };
        } catch (_) {
            return null;
        }
    }

    function assertViewingJob(job) {
        assertRouteSession(job.sessionToken);
        if (sourceState !== job.state || job.state.watchStatus !== job.watch ||
            !job.state.grid?.isConnected || netflixModelData('userInfo')?.userGuid !== job.context.profileGuid) {
            throw createRouteSessionCancelledError();
        }
    }

    function createViewingNetworkDiagnostics() {
        const now = performance.now();
        return { startedAt: now, lastChangeAt: now, finishedAt: null, concurrencyLimit: VIEWING_REQUEST_CONCURRENCY,
            inFlight: 0, peakInFlight: 0, succeeded: 0, failed: 0, rateLimited: 0, aborted: 0,
            totalRequestMs: 0, maxRequestMs: 0, overlapMs: 0 };
    }

    function collectViewingNetworkDiagnostics(network) {
        if (!network) return null;
        const now = network.finishedAt ?? performance.now();
        const requests = network.succeeded + network.failed;
        return { concurrencyLimit: network.concurrencyLimit, started: requests + network.inFlight,
            inFlight: network.inFlight, peakInFlight: network.peakInFlight,
            elapsedMs: Math.round(now - network.startedAt), succeeded: network.succeeded, failed: network.failed,
            rateLimited: network.rateLimited, aborted: network.aborted,
            totalRequestMs: Math.round(network.totalRequestMs), maxRequestMs: Math.round(network.maxRequestMs),
            meanRequestMs: requests ? Math.round(network.totalRequestMs / requests) : 0,
            overlapMs: Math.round(network.overlapMs + (network.inFlight > 1 ? now - network.lastChangeAt : 0)) };
    }

    async function fetchViewingGraph(paths, job) {
        assertViewingJob(job);
        if (job.collectionFailure) throw job.collectionFailure;
        const now = performance.now();
        const remaining = job.deadline - now;
        if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
        if (job.passRequests >= VIEWING_MAX_REQUESTS) {
            if (job.passes >= VIEWING_MAX_PASSES) throw new Error('VIEWING_STATUS_BUDGET');
            // Continue the same finite queue, including partial episode coverage.
            // Do not restart title requests or retry failed HTTP responses.
            job.passes++;
            job.passRequests = 0;
        }
        job.passRequests++;
        job.requests++;
        const request = createRouteFetch(job.sessionToken);
        const controllers = job.controllers ||= new Set();
        controllers.add(request.controller);
        const network = job.network ||= createViewingNetworkDiagnostics();
        if (network.inFlight > 1) network.overlapMs += now - network.lastChangeAt;
        network.lastChangeAt = now;
        network.inFlight++;
        network.peakInFlight = Math.max(network.peakInFlight, network.inFlight);
        let succeeded = false;
        clearTimeout(request.timeoutId);
        request.timeoutId = setTimeout(() => request.controller.abort(), Math.min(8000, remaining));
        try {
            const body = new URLSearchParams();
            for (const path of paths) body.append('path', JSON.stringify(path));
            body.set('authURL', job.context.authURL);
            const response = await fetch(job.context.url, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-netflix.nq.stack': 'prod',
                    'x-netflix.request.client.user.guid': job.context.profileGuid
                },
                body: body.toString(), signal: request.controller.signal
            });
            assertViewingJob(job);
            if (!response.ok) {
                if (response.status === 429) network.rateLimited++;
                throw new Error('VIEWING_STATUS_HTTP_' + response.status);
            }
            const payload = await response.json();
            assertViewingJob(job);
            if (!payload?.jsonGraph || typeof payload.jsonGraph !== 'object' || payload.status === 'error') {
                throw new Error('VIEWING_STATUS_RESPONSE');
            }
            succeeded = true;
            return payload.jsonGraph;
        } catch (error) {
            if (error?.name === 'AbortError') network.aborted++;
            assertViewingJob(job);
            if (performance.now() >= job.deadline) throw new Error('VIEWING_STATUS_BUDGET');
            throw error;
        } finally {
            const finishedAt = performance.now();
            const elapsed = finishedAt - now;
            if (network.inFlight > 1) network.overlapMs += finishedAt - network.lastChangeAt;
            network.lastChangeAt = finishedAt;
            network.inFlight--;
            network.totalRequestMs += elapsed;
            network.maxRequestMs = Math.max(network.maxRequestMs, elapsed);
            if (succeeded) network.succeeded++;
            else network.failed++;
            controllers.delete(request.controller);
            finishRouteFetch(request);
        }
    }

    async function runViewingBatches(batches, job, collectBatch, requestsPerBatch = 1) {
        for (let offset = 0; offset < batches.length;) {
            assertViewingJob(job);
            if (job.collectionFailure) throw job.collectionFailure;
            const remaining = VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES - job.requests;
            if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
            // Near the cap, leave enough quota to finish a series chain rather
            // than spending its last two requests on two metadata-only chains.
            const width = Math.min(VIEWING_REQUEST_CONCURRENCY, Math.max(1, Math.floor(remaining / requestsPerBatch)));
            const wave = batches.slice(offset, offset + width);
            offset += wave.length;
            await Promise.allSettled(wave.map(async batch => {
                try {
                    await collectBatch(batch);
                } catch (error) {
                    job.collectionFailure ||= error;
                    if (isRouteSessionCancelledError(error)) {
                        for (const controller of job.controllers || []) controller.abort();
                    }
                    throw error;
                }
            }));
            // Drain allocated reads before finalizing partial results. A valid
            // peer may still publish, but a known failure stops new requests.
            if (job.collectionFailure) throw job.collectionFailure;
        }
    }

    function readViewingCache(state, profile) {
        const cached = { results: new Map(), types: new Map() };
        if (!profile || typeof GM_getValue !== 'function') return cached;
        try {
            const stored = GM_getValue(VIEWING_CACHE_STORAGE_KEY + encodeURIComponent(profile), null);
            const age = Date.now() - stored?.savedAt;
            if (stored?.version !== 1 || stored.completionRatio !== VIEWING_COMPLETION_RATIO ||
                !Number.isFinite(stored.savedAt) || age < 0 || age > VIEWING_CACHE_MAX_AGE_MS ||
                !stored.entries || typeof stored.entries !== 'object' || Array.isArray(stored.entries) ||
                Object.keys(stored.entries).length > 5000) return cached;
            for (const item of state.items || []) {
                const id = String(item.videoId);
                const entry = stored.entries[id];
                if (!/^\d+$/.test(id) || !Array.isArray(entry) || entry.length !== 2 ||
                    !['movie', 'series'].includes(entry[0]) ||
                    !['complete', 'in-progress', 'not-started', 'unknown'].includes(entry[1])) continue;
                cached.types.set(id, entry[0]);
                cached.results.set(id, entry[1]);
            }
        } catch (_) { /* Optional startup reuse must not block the grid. */ }
        return cached;
    }

    function clearCachedViewingStatus(watch) {
        watch.cachedResults?.clear();
        watch.cachedTypes?.clear();
    }

    function writeViewingCache(job) {
        if (typeof GM_setValue !== 'function') return;
        try {
            assertViewingJob(job);
            const entries = {};
            for (const item of job.state.items || []) {
                const id = String(item.videoId);
                const type = job.types.get(id);
                if (/^\d+$/.test(id) && ['movie', 'series'].includes(type)) {
                    entries[id] = [type, job.results.get(id) || 'unknown'];
                }
            }
            if (Object.keys(entries).length > 5000) return;
            // Save only fresh scan data once, never extending unverified cache
            // entries or persisting a manual choice as an automatic result.
            GM_setValue(VIEWING_CACHE_STORAGE_KEY + encodeURIComponent(job.context.profileGuid),
                { version: 1, completionRatio: VIEWING_COMPLETION_RATIO, savedAt: Date.now(), entries });
        } catch (_) { /* A cache failure leaves fresh grouping and corrections usable. */ }
    }

    function publishViewingProgress(job, changedIds) {
        assertViewingJob(job);
        job.watch.results = job.results;
        job.watch.types = job.types;
        job.watch.seriesDetails = job.seriesDetails;
        job.watch.requests = job.requests;
        job.watch.passes = job.passes;
        job.watch.publications++;
        syncWatchGroups(job.state, changedIds, 'scan-batch');
    }

    async function collectViewingStatuses(job) {
        const fields = ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset', 'seasonCount', 'episodeCount'];
        const ids = [...new Set(job.state.items.map(item => String(item.videoId)).filter(id => /^\d+$/.test(id)))];
        const seriesById = new Map();
        const titleBatches = [];
        for (let offset = 0; offset < ids.length; offset += VIEWING_TITLE_BATCH_SIZE) {
            titleBatches.push(ids.slice(offset, offset + VIEWING_TITLE_BATCH_SIZE));
        }
        await runViewingBatches(titleBatches, job, async batch => {
            const graph = await fetchViewingGraph([['videos', batch, fields]], job);
            for (const id of batch) {
                const record = viewingVideoRecord(graph, id);
                let pendingSeries = false;
                job.watch.cachedTypes.delete(id);
                if (record?.type === 'movie') job.types.set(id, 'movie');
                else if (['show', 'series', 'tvshow', 'episode'].includes(record?.type)) job.types.set(id, 'series');
                if (record && ['show', 'series', 'tvshow'].includes(record.type)) {
                    job.seriesStats.found++;
                    if ((record.seasonCount === null || (Number.isSafeInteger(record.seasonCount) &&
                        record.seasonCount > 0 && record.seasonCount <= VIEWING_MAX_SEASONS)) &&
                        (record.episodeCount === null || (Number.isSafeInteger(record.episodeCount) &&
                        record.episodeCount > 0 && record.episodeCount <= VIEWING_MAX_EPISODES))) {
                        seriesById.set(id, record);
                        job.seriesStats.eligible++;
                        pendingSeries = true;
                    }
                }
                // A show-level flag cannot replace a cached finale result.
                // Keep that provisional result only until its episode check.
                if (!pendingSeries) {
                    job.watch.cachedResults.delete(id);
                    job.results.set(id, classifyViewingVideo(record));
                }
            }
            publishViewingProgress(job, batch);
        });
        // Response arrival cannot change native order or budget priority.
        const series = ids.map(id => seriesById.get(id)).filter(Boolean);
        const seriesBatches = [];
        for (let offset = 0; offset < series.length;) {
            const batch = [];
            let episodes = 0, seasons = 0;
            while (offset < series.length && batch.length < VIEWING_TITLE_BATCH_SIZE) {
                const record = series[offset];
                const seasonCost = record.seasonCount ?? VIEWING_MAX_SEASONS;
                if (batch.length && (episodes + 1 > VIEWING_EPISODE_BATCH_SIZE ||
                    seasons + seasonCost > VIEWING_EPISODE_BATCH_SIZE)) break;
                batch.push(record);
                episodes++;
                seasons += seasonCost;
                offset++;
            }
            // Only the latest episode determines the selected caught-up rule.
            // Bound season metadata and finale checks, not historical runtimes.
            seriesBatches.push(batch);
        }
        await runViewingBatches(seriesBatches, job, batch => collectViewingSeriesBatch(batch, job), 2);
        // Preserve the complete ordinary scan before spending its remaining
        // budget on incomplete nested responses. Already verified titles win.
        await recheckViewingSeries(job);
    }

    async function collectViewingSeriesBatch(records, job) {
        const paths = records.flatMap(record => {
            const paths = [['videos', record.videoId, 'seasonList',
                { from: 0, to: (record.seasonCount ?? VIEWING_MAX_SEASONS) - 1 }, ['summary', 'length']]];
            if (record.seasonCount === null) paths.push(['videos', record.videoId, 'seasonList', 'length']);
            return paths;
        });
        const graph = await fetchViewingGraph(paths, job);
        const plans = records.map(record => viewingSeasonPlan(graph, record)).filter(Boolean);
        job.seriesStats.planned += plans.length;
        job.seriesStats.unplanned += records.length - plans.length;
        const plannedIds = new Set(plans.map(plan => plan.videoId));
        for (const record of records) {
            if (!plannedIds.has(record.videoId)) {
                job.watch.cachedResults.delete(record.videoId);
                job.results.set(record.videoId, 'unknown');
                job.seriesDetails.set(record.videoId, { reason: 'season-metadata-incomplete-or-inconsistent' });
            }
        }
        for (const plan of plans) job.watch.seriesCoverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
        // Coverage can expire a manual correction even before the finale arrives.
        const metadataChanges = records.filter(record => !plannedIds.has(record.videoId) || job.watch.manualChoices.has(record.videoId));
        if (metadataChanges.length) publishViewingProgress(job, metadataChanges.map(record => record.videoId));
        await collectViewingEpisodePlans(plans, job);
    }

    async function collectViewingEpisodePlans(plans, job) {
        const segments = [];
        for (const plan of plans) {
            const latest = viewingLatestEpisode(plan);
            if (latest && !latest.episode) segments.push({ plan, season: latest.season, from: latest.index, to: latest.index });
        }
        // Request one episode per series. Older progress cannot change the
        // latest-episode inference, including when the finale is unavailable.
        for (let offset = 0; offset < segments.length;) {
            const batch = [];
            let size = 0;
            while (offset < segments.length) {
                const segment = segments[offset];
                if (segment.plan.finished) { offset++; continue; }
                const length = segment.to - segment.from + 1;
                if (batch.length && size + length > VIEWING_EPISODE_BATCH_SIZE) break;
                batch.push(segment);
                size += length;
                offset++;
            }
            if (!batch.length) continue;
            const paths = batch.map(({ season, from, to }) => ['seasons', season.id, 'episodes',
                { from, to }, ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset']]);
            const graph = await fetchViewingGraph(paths, job);
            for (const { plan, season, from, to } of batch) {
                const episodes = readViewingGraph(graph, ['seasons', season.id, 'episodes']);
                const latest = viewingLatestEpisode(plan);
                for (let index = from; index <= to; index++) {
                    const id = viewingReferenceId(episodes?.[index], 'videos');
                    const fetched = id ? viewingVideoRecord(graph, id) : null;
                    const record = fetched && (!fetched.type || fetched.type === 'episode') ? { ...fetched, type: 'episode' } : null;
                    const status = classifyViewingVideo(record);
                    season.episodes.set(index, { id, status, ...(status === 'unknown' ? { record } : {}) });
                    if (latest?.season === season && latest.index === index) season.episodes.get(index).progress = viewingProgressSummary(record);
                    job.seriesStats.episodesChecked++;
                    if (!id) job.seriesStats.missingEpisodeRefs++;
                    if (status === 'unknown') {
                        job.seriesStats.episodesUnknown++;
                        season.episodes.get(index).kinds = recordViewingFieldKinds(graph, id, job.recheckStats.initialUnknownFields);
                    }
                    else if (status !== 'complete') job.seriesStats.episodesIncomplete++;
                }
            }
            // Keep each fully checked result even if a later request fails or
            // reaches the scan budget. Unfinished coverage remains unknown.
            for (const plan of new Set(batch.map(segment => segment.plan))) {
                if (plan.finished) continue;
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
                const result = viewingSeriesResult(plan);
                if (result === 'complete' || full || observed.some(episode => !episode.id || episode.status !== 'complete')) {
                    const status = result === 'complete' ? result : full ? result
                        : observed.some(episode => !episode.id || episode.status === 'unknown') ? 'unknown' : 'in-progress';
                    finishViewingSeriesPlan(plan, status, job);
                } else saveViewingSeriesDetails(plan, job);
            }
            publishViewingProgress(job, batch.map(segment => segment.plan.videoId));
        }
    }

    function finishViewingSeriesPlan(plan, status, job) {
        const bucket = value => value === 'complete' ? 'complete' : value === 'unknown' ? 'unknown' : 'incomplete';
        if (plan.status === undefined) job.seriesStats.checked++;
        else job.seriesStats[bucket(plan.status)]--;
        job.seriesStats[bucket(status)]++;
        plan.status = status;
        plan.finished = true;
        job.watch.cachedResults.delete(plan.videoId);
        job.results.set(plan.videoId, status);
        saveViewingSeriesDetails(plan, job);
        if (status === 'unknown') {
            const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
            const latest = viewingLatestEpisode(plan)?.episode;
            if ((latest?.id && latest.status === 'unknown') ||
                (observed.every(episode => episode.id && ['complete', 'unknown'].includes(episode.status)) &&
                new Set(observed.map(episode => episode.id)).size === observed.length)) {
                if (!job.unresolvedSeries.has(plan)) job.recheckStats.candidates++;
                job.unresolvedSeries.add(plan);
            }
        }
    }

    function saveViewingSeriesDetails(plan, job) {
        const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
        const complete = observed.filter(episode => episode.status === 'complete').length;
        const unfinished = observed.filter(episode => ['not-started', 'in-progress'].includes(episode.status)).length;
        const unknown = observed.filter(episode => episode.status === 'unknown').length;
        const missing = observed.filter(episode => !episode.id).length;
        const duplicates = observed.length - new Set(observed.filter(episode => episode.id).map(episode => episode.id)).size - missing;
        const fields = { watched: {}, bookmark: {}, runtime: {} };
        for (const episode of observed) {
            if (episode.status !== 'unknown' || !episode.kinds) continue;
            for (const [key, kind] of Object.entries(episode.kinds)) fields[key][kind] = (fields[key][kind] || 0) + 1;
        }
        const latest = viewingLatestEpisode(plan);
        const reason = plan.status === 'complete' ? classifyViewingSeries(plan) === 'complete'
            ? 'verified-complete' : 'latest-episode-complete' : unfinished ? 'unfinished-episodes'
            : missing || duplicates ? 'invalid-episode-references' : unknown ? 'unavailable-episode-progress' : 'episode-coverage-incomplete';
        job.seriesDetails.set(plan.videoId, { reason, seasons: plan.seasons.length, expectedEpisodes: plan.expected,
            checkedEpisodes: observed.length, completeEpisodes: complete, unfinishedEpisodes: unfinished,
            unknownEpisodes: unknown, missingEpisodeRefs: missing, duplicateEpisodeRefs: duplicates,
            latestEpisode: latest ? { season: latest.seasonNumber, episode: latest.index + 1,
                ...(latest.episode?.progress || { status: 'unknown', percent: null, thresholdPercent: VIEWING_COMPLETION_RATIO * 100,
                    reason: latest.episode ? 'episode-reference-unavailable' : 'not-checked' }),
                ...(latest.episode?.kinds ? { fields: latest.episode.kinds } : {}) } : null,
            ...(unknown ? { unknownFields: fields } : {}) });
    }

    function collectViewingSeriesDiagnostics(state) {
        const watch = state?.watchStatus;
        if (!watch) return [];
        // Only Copy Logs expands these compact per-series summaries. Ordinary
        // runtime snapshots, scroll and hover never build title-level reports.
        return (state.items || []).filter(item => viewingTitleType(watch, String(item.videoId)) === 'series').map(item => {
            const id = String(item.videoId);
            return { title: item.ariaLabel || '(untitled)', status: effectiveViewingStatus(watch, id),
                automaticStatus: watch.results.get(id) || watch.cachedResults?.get(id) || 'unknown',
                cachedStatus: !watch.results.has(id) && Boolean(watch.cachedResults?.has(id)),
                manualChoice: watch.manualChoices.get(id)?.status || null,
                ...(watch.seriesDetails.get(id) || { reason: watch.loading ? 'checking' : 'series-metadata-unavailable-or-unprocessed' }) };
        });
    }

    async function recheckViewingSeries(job) {
        const attempted = new Set();
        for (;;) {
            assertViewingJob(job);
            const targets = new Map();
            for (const plan of job.unresolvedSeries) {
                if (plan.status !== 'unknown' || plan.recheckBlocked) continue;
                const latest = viewingLatestEpisode(plan)?.episode;
                const onlyLatest = plan.seasons.some(season => [...season.episodes.values()].some(episode =>
                    ['not-started', 'in-progress'].includes(episode.status)));
                for (const season of plan.seasons) {
                    for (const episode of season.episodes.values()) {
                        if (onlyLatest && episode !== latest) continue;
                        if (episode.status !== 'unknown' || attempted.has(episode.id)) continue;
                        if (!targets.has(episode.id)) {
                            if (targets.size >= VIEWING_EPISODE_BATCH_SIZE) continue;
                            targets.set(episode.id, []);
                        }
                        targets.get(episode.id).push({ plan, episode });
                    }
                }
            }
            if (!targets.size) return;
            // The reference supplied the episode ID. Ask the same read-only
            // video path directly, rather than guessing from a resume label.
            const beforeRequests = job.requests;
            let graph;
            try {
                graph = await fetchViewingGraph([['videos', [...targets.keys()],
                    ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset']]], job);
            } finally {
                job.recheckStats.requests += job.requests - beforeRequests;
            }
            const affected = new Set();
            for (const [id, entries] of targets) {
                attempted.add(id);
                job.recheckStats.episodes++;
                const fetched = viewingVideoRecord(graph, id);
                const direct = fetched && (!fetched.type || fetched.type === 'episode') ? { ...fetched, type: 'episode' } : null;
                for (const { plan, episode } of entries) {
                    affected.add(plan);
                    const previous = episode.record;
                    const record = direct ? {
                        ...direct,
                        watched: typeof direct.watched === 'boolean' ? direct.watched : previous?.watched,
                        bookmark: direct.bookmark ?? previous?.bookmark ?? null,
                        runtime: direct.runtime > 0 ? direct.runtime : previous?.runtime ?? null,
                        creditsOffset: direct.creditsOffset ?? previous?.creditsOffset ?? null
                    } : previous;
                    episode.status = classifyViewingVideo(record);
                    if (episode === viewingLatestEpisode(plan)?.episode) episode.progress = viewingProgressSummary(record);
                    if (episode.status === 'unknown') {
                        job.recheckStats.unknownEpisodes++;
                        episode.kinds = recordViewingFieldKinds(graph, id, job.recheckStats.remainingUnknownFields);
                    } else job.recheckStats.recoveredEpisodes++;
                    if (episode.status !== 'complete') plan.recheckBlocked = true;
                    if (episode.status === 'unknown') episode.record = record;
                    else { delete episode.record; delete episode.kinds; }
                }
            }
            for (const plan of affected) {
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const result = viewingSeriesResult(plan);
                if (result === 'complete' || full) finishViewingSeriesPlan(plan, result, job);
                saveViewingSeriesDetails(plan, job);
                if (plan.status === 'complete') job.recheckStats.recoveredSeries++;
            }
            publishViewingProgress(job, [...affected].map(plan => plan.videoId));
        }
    }

    function validViewingCoverage(value) {
        return Array.isArray(value) && value.length > 0 && value.length <= VIEWING_MAX_SEASONS &&
            value.every(pair => Array.isArray(pair) && pair.length === 2 && /^\d+$/.test(pair[0]) &&
                Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= VIEWING_MAX_EPISODES) &&
            new Set(value.map(pair => pair[0])).size === value.length &&
            value.reduce((sum, pair) => sum + pair[1], 0) > 0 &&
            value.reduce((sum, pair) => sum + pair[1], 0) <= VIEWING_MAX_EPISODES;
    }

    function readManualViewingChoices(profile) {
        if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') throw new Error('storage-unavailable');
        const choices = new Map();
        const stored = GM_getValue(VIEWING_CHOICES_STORAGE_KEY + encodeURIComponent(profile), null);
        if (stored == null) return choices;
        if (stored.version !== 1 || !stored.choices || typeof stored.choices !== 'object' ||
            Array.isArray(stored.choices) || Object.keys(stored.choices).length > 5000) throw new Error('invalid-storage');
        for (const [id, choice] of Object.entries(stored.choices)) {
            if (!/^\d+$/.test(id) || !choice || !['complete', 'main'].includes(choice.status) ||
                !['movie', 'series', 'unknown'].includes(choice.type) ||
                (choice.coverage !== null && !validViewingCoverage(choice.coverage))) continue;
            choices.set(id, { status: choice.status, type: choice.type, coverage: choice.coverage });
        }
        return choices;
    }

    function syncManualViewingProfile(watch) {
        const profile = netflixModelData('userInfo')?.userGuid;
        const active = typeof profile === 'string' && profile ? profile : null;
        if (watch.manualProfileGuid === active) return false;
        if (watch.manualProfileGuid !== undefined) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.seriesCoverage = new Map();
        }
        watch.manualProfileGuid = active;
        watch.manualChoices = new Map();
        watch.manualFailure = false;
        if (!active) return true;
        try { watch.manualChoices = readManualViewingChoices(active); }
        catch (_) { watch.manualFailure = true; }
        return true;
    }

    function saveManualViewingChoices(watch, changes, conditional = false) {
        try {
            if (!watch.manualProfileGuid || netflixModelData('userInfo')?.userGuid !== watch.manualProfileGuid) throw new Error('storage-unavailable');
            // Apply only this action's changes to the newest saved map, so an
            // older tab does not erase unrelated corrections from another tab.
            const choices = readManualViewingChoices(watch.manualProfileGuid);
            let applied = false;
            for (const [id, choice] of changes) {
                if (conditional && JSON.stringify(choices.get(id)) !== JSON.stringify(watch.manualChoices.get(id))) continue;
                if (choice) choices.set(id, choice);
                else choices.delete(id);
                applied = true;
            }
            if (choices.size > 5000) throw new Error('storage-full');
            if (applied) GM_setValue(VIEWING_CHOICES_STORAGE_KEY + encodeURIComponent(watch.manualProfileGuid),
                { version: 1, choices: Object.fromEntries(choices) });
            watch.manualFailure = false;
            return choices;
        } catch (_) { watch.manualFailure = true; return null; }
    }

    function changedManualViewingIds(previous, next) {
        const changed = new Set();
        for (const id of new Set([...previous.keys(), ...next.keys()])) {
            if (JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id))) changed.add(id);
        }
        return changed;
    }

    function reconcileManualViewingCoverage(watch, ids = null) {
        const changes = new Map();
        const candidates = ids === null ? watch.manualChoices.keys() : ids;
        for (const id of candidates) {
            const choice = watch.manualChoices.get(id);
            if (!choice) continue;
            if (choice.status !== 'complete') continue;
            const coverage = watch.seriesCoverage.get(id);
            if (!coverage) continue;
            if (!choice.coverage) {
                changes.set(id, { ...choice, type: 'series', coverage });
            } else {
                const previous = new Map(choice.coverage);
                if (coverage.some(([season, count]) => count > 0 && (!previous.has(season) || count > previous.get(season)))) {
                    changes.set(id, null);
                }
            }
        }
        if (changes.size) {
            const previous = watch.manualChoices;
            const saved = saveManualViewingChoices(watch, changes, true);
            if (saved) watch.manualChoices = saved;
            else for (const [id, choice] of changes) {
                // New episodes must remain visible even if saving the expiry fails.
                if (choice) watch.manualChoices.set(id, choice);
                else watch.manualChoices.delete(id);
            }
            return saved ? changedManualViewingIds(previous, saved) : new Set(changes.keys());
        }
        return new Set();
    }

    function effectiveViewingStatus(watch, id) {
        const manual = watch.manualChoices.get(id);
        return manual ? manual.status === 'complete' ? 'complete' : 'in-progress'
            : watch.results.get(id) || watch.cachedResults?.get(id) || 'unknown';
    }

    function viewingTitleType(watch, id) {
        return watch.types.get(id) || watch.cachedTypes?.get(id) || watch.manualChoices.get(id)?.type;
    }

    function ensureManualViewingControls(clone) {
        let controls = clone.__tmViewingControls;
        if (!controls || controls.root.parentElement !== clone) {
            // Snapshot clones can contain copied controls without their JS state.
            for (const child of [...clone.children]) {
                if (child.getAttribute('data-tm-viewing-actions') === 'true') child.remove();
            }
            const root = document.createElement('div');
            root.setAttribute('data-tm-viewing-actions', 'true');
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.setAttribute('data-tm-viewing-action', 'toggle');
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.setAttribute('data-tm-viewing-action', 'reset');
            root.appendChild(toggle);
            root.appendChild(reset);
            clone.appendChild(root);
            controls = clone.__tmViewingControls = { root, toggle, reset };
        }
        return controls;
    }

    function syncManualViewingCard(state, clone, item, status) {
        const watch = state.watchStatus;
        const controls = ensureManualViewingControls(clone);
        const id = String(item.videoId);
        const type = viewingTitleType(watch, id);
        const label = status === 'complete' ? tUi('moveBackToMyList')
            : tUi(type === 'series' ? 'markCaughtUp' : 'markWatched');
        if (controls.toggle.textContent !== label) controls.toggle.textContent = label;
        const toggleLabel = label + ': ' + (item.ariaLabel || id);
        if (controls.toggle.getAttribute('aria-label') !== toggleLabel) controls.toggle.setAttribute('aria-label', toggleLabel);
        const disabled = !watch.manualProfileGuid || watch.manualFailure;
        if (controls.toggle.disabled !== disabled) controls.toggle.disabled = disabled;
        const resetLabel = tUi('useAutomaticViewingStatus');
        if (controls.reset.textContent !== resetLabel) controls.reset.textContent = resetLabel;
        const resetAriaLabel = resetLabel + ': ' + (item.ariaLabel || id);
        if (controls.reset.getAttribute('aria-label') !== resetAriaLabel) controls.reset.setAttribute('aria-label', resetAriaLabel);
        const hidden = !watch.manualChoices.has(id);
        if (controls.reset.hidden !== hidden) controls.reset.hidden = hidden;
        if (controls.reset.disabled !== disabled) controls.reset.disabled = disabled;
    }

    function ensureManualViewingBehavior(state) {
        const grid = state.grid;
        if (grid.__tmViewingBehaviorInstalled) return;
        grid.__tmViewingBehaviorInstalled = true;
        grid.addEventListener('click', event => {
            let button = event.target instanceof Element ? event.target : event.target?.parentElement;
            while (button && button !== grid && !button.getAttribute('data-tm-viewing-action')) button = button.parentElement;
            if (!button || button === grid) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (button.disabled) return;
            if (sourceState !== state || state.grid !== grid || !grid.isConnected || !isRouteSessionActive(state.watchStatus.sessionToken)) return;
            let clone = button.parentElement;
            while (clone && clone !== grid && !clone.__tmMyListItem) clone = clone.parentElement;
            if (!clone || !gridOwnsClone(clone, grid) || state.cloneMap.get(itemKey(clone.__tmMyListItem)) !== clone) return;
            const watch = state.watchStatus;
            if (netflixModelData('userInfo')?.userGuid !== watch.manualProfileGuid) {
                syncWatchGroups(state);
                return;
            }
            syncManualViewingProfile(watch);
            const id = String(clone.__tmMyListItem.videoId);
            const changes = new Map();
            if (button.getAttribute('data-tm-viewing-action') === 'reset') changes.set(id, null);
            else {
                const status = effectiveViewingStatus(watch, id) === 'complete' ? 'main' : 'complete';
                changes.set(id, { status, type: viewingTitleType(watch, id) || 'unknown',
                    coverage: status === 'complete' ? watch.seriesCoverage.get(id) || null : null });
            }
            const saved = saveManualViewingChoices(watch, changes);
            const changed = saved ? changedManualViewingIds(watch.manualChoices, saved) : new Set();
            if (saved) watch.manualChoices = saved;
            const beforeWork = { ...performanceDiagnostics.viewingGroups };
            syncWatchGroups(state, changed, 'manual-choice');
            log(tLog('viewingChoiceApplied'), {
                saved: Boolean(saved), action: button.getAttribute('data-tm-viewing-action'),
                changedTitles: changed.size, completed: watch.completedCount,
                work: Object.fromEntries(Object.entries(performanceDiagnostics.viewingGroups)
                    .filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, value - beforeWork[key]]))
            });
            if (!gridOwnsClone(clone, grid)) watch.ui.summary.focus?.({ preventScroll: true });
        }, true);
    }

    function gridOwnsClone(clone, grid) {
        if (!grid || !clone || clone.getAttribute('data-tm-type-hidden') === 'true') return false;
        if (clone.parentElement === grid) return true;
        const parent = clone.parentElement;
        const details = parent?.parentElement;
        return parent?.getAttribute('data-tm-watch-grid') === 'true' &&
            details?.parentElement === grid && details.open === true;
    }

    function createWatchTypeFilter(state, group) {
        const grid = state.grid;
        const root = document.createElement('div');
        root.setAttribute('data-tm-type-filter', group);
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', tUi(group === 'main' ? 'legacyMyList' : 'watchedCaughtUp') + ': ' + tUi('titleTypeFilter'));
        const buttons = new Map();
        for (const [type, key] of [['movie', 'filterFilms'], ['series', 'filterSeries'], ['all', 'filterAll']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('data-tm-filter-value', type);
            const label = document.createElement('span');
            label.textContent = tUi(key);
            const count = document.createElement('span');
            count.setAttribute('data-tm-type-count', 'true');
            button.appendChild(label);
            button.appendChild(count);
            button.addEventListener('click', () => {
                if (sourceState !== state || state.grid !== grid || state.watchStatus?.ui?.grid !== grid ||
                    !grid.isConnected || state.watchStatus.filters[group] === type) return;
                state.watchStatus.filters[group] = type;
                syncWatchGroups(state, [], 'type-filter');
            });
            root.appendChild(button);
            buttons.set(type, { button, count, key });
        }
        return { root, buttons };
    }

    function syncWatchTypeFilter(control, selected, counts) {
        for (const [type, { button, count, key }] of control.buttons) {
            const pressed = String(type === selected);
            if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
            const value = formatUiNumber(counts[type]);
            if (count.textContent !== value) count.textContent = value;
            const label = tUi(key) + ': ' + formatItemCount(counts[type]);
            if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        }
    }

    function ensureWatchGroupUi(state) {
        const watch = state.watchStatus;
        if (watch.ui?.grid === state.grid) return watch.ui;
        ensureManualViewingBehavior(state);
        const details = document.createElement('details');
        details.setAttribute('data-tm-watch-section', 'true');
        details.open = watch.expanded;
        const summary = document.createElement('summary');
        const watchedGrid = document.createElement('div');
        watchedGrid.setAttribute('data-tm-watch-grid', 'true');
        details.appendChild(summary);
        const mainFilter = createWatchTypeFilter(state, 'main');
        const watchedFilter = createWatchTypeFilter(state, 'watched');
        const watchedEmpty = document.createElement('p');
        watchedEmpty.setAttribute('data-tm-watch-empty', 'true');
        watchedEmpty.textContent = tUi('noMatchingTitles');
        details.appendChild(watchedFilter.root);
        details.appendChild(watchedEmpty);
        details.appendChild(watchedGrid);
        const empty = document.createElement('p');
        empty.setAttribute('data-tm-watch-empty', 'true');
        empty.textContent = tUi('caughtUpMessage');
        const controls = document.createElement('div');
        controls.setAttribute('data-tm-watch-controls', 'true');
        const note = document.createElement('span');
        note.setAttribute('role', 'status');
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = tUi('refreshViewingStatus');
        refresh.addEventListener('click', () => refreshViewingStatus(state));
        controls.appendChild(note);
        controls.appendChild(refresh);
        details.addEventListener('toggle', () => {
            if (sourceState !== state || watch.ui?.details !== details) return;
            watch.expanded = details.open;
            cancelPendingGridHover();
            hoverToken++;
            clearSourceAlignment();
            activeClone = null;
            activeVideoId = null;
            activePage = null;
            invalidateGridReact();
        });
        return watch.ui = { grid: state.grid, details, summary, watchedGrid, empty, controls, note, refresh,
            mainFilter, watchedFilter, watchedEmpty };
    }

    function syncWatchChildOrder(parent, children) {
        let reference = parent.firstElementChild;
        for (const child of children) {
            if (child !== reference) parent.insertBefore(child, reference);
            reference = child.nextElementSibling;
        }
    }

    function syncWatchGroups(state, changedIds = null, reason = 'reconcile') {
        if (sourceState !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus;
        const profileChanged = syncManualViewingProfile(watch);
        const ui = ensureWatchGroupUi(state);
        const previousIndex = watch.groupIndex?.grid === state.grid ? watch.groupIndex : null;
        const full = changedIds === null || profileChanged || !previousIndex;
        const ids = full ? null : new Set([...changedIds].map(String));
        for (const id of reconcileManualViewingCoverage(watch, ids)) ids?.add(id);
        const index = full ? {
            grid: state.grid, entries: new Map(), order: [], unknown: 0,
            counts: { main: { movie: 0, series: 0, all: 0 }, watched: { movie: 0, series: 0, all: 0 } }
        } : previousIndex;
        const disabled = !watch.manualProfileGuid || watch.manualFailure;
        const locale = getUiLocale();
        let candidates = state.items || [];
        if (!full) {
            const selected = new Map();
            for (const id of ids) {
                const entry = previousIndex.entries.get(id);
                if (entry) selected.set(id, entry.item);
            }
            if (previousIndex.disabled !== disabled || previousIndex.locale !== locale ||
                previousIndex.filters.main !== watch.filters.main || previousIndex.filters.watched !== watch.filters.watched) {
                for (const entry of previousIndex.entries.values()) {
                    if (previousIndex.disabled !== disabled || previousIndex.locale !== locale ||
                        previousIndex.filters[entry.group] !== watch.filters[entry.group]) selected.set(entry.id, entry.item);
                }
            }
            candidates = [...selected.values()];
        }
        const updates = [];
        const work = performanceDiagnostics.viewingGroups;
        work.syncs++;
        work.lastReason = reason;
        if (full) work.fullSyncs++;
        const countEntry = (entry, delta) => {
            index.counts[entry.group].all += delta;
            if (entry.type === 'movie' || entry.type === 'series') index.counts[entry.group][entry.type] += delta;
            if (entry.status === 'unknown') index.unknown += delta;
        };
        for (const item of candidates) {
            const id = String(item.videoId);
            const previous = previousIndex?.entries.get(id);
            const status = !full && !ids.has(id) ? previous.status : effectiveViewingStatus(watch, id);
            const type = !full && !ids.has(id) ? previous.type : viewingTitleType(watch, id);
            const clone = state.cloneMap?.get(itemKey(item));
            if (!clone) continue;
            work.cardsConsidered++;
            const group = status === 'complete' ? 'watched' : 'main';
            const hidden = watch.filters[group] !== 'all' && watch.filters[group] !== type;
            const manual = watch.manualChoices.has(id);
            if (!full && previous.clone === clone && previous.status === status && previous.type === type &&
                previous.group === group && previous.hidden === hidden && previous.disabled === disabled &&
                previous.locale === locale && previous.title === item.ariaLabel && previous.manual === manual &&
                clone.parentElement === (group === 'main' ? state.grid : ui.watchedGrid)) continue;
            const entry = { id, item, clone, status, type, group, hidden, disabled, locale,
                title: item.ariaLabel, manual, order: full ? index.order.length : previous.order };
            const controlsChanged = !previous || previous.clone !== clone || previous.group !== group ||
                previous.type !== type || previous.disabled !== disabled || previous.locale !== locale ||
                previous.title !== entry.title || previous.manual !== entry.manual;
            const visibilityChanged = hidden !== (clone.getAttribute('data-tm-type-hidden') === 'true');
            const moved = Boolean(previous && previous.group !== group) ||
                clone.parentElement !== (group === 'main' ? state.grid : ui.watchedGrid);
            if (!full) countEntry(previous, -1);
            countEntry(entry, 1);
            index.entries.set(id, entry);
            if (full) index.order.push(id);
            updates.push({ entry, controlsChanged, visibilityChanged, moved });
        }

        const counts = index.counts;
        const visibleCount = counts.main[watch.filters.main];
        const visibleCompleted = counts.watched[watch.filters.watched];
        const uiSignature = JSON.stringify([counts, index.unknown, watch.filters, watch.loading, watch.manualFailure,
            locale, state.items.length, state.totalCount, state.initializationElapsedMs]);
        const uiChanged = uiSignature !== previousIndex?.uiSignature;
        const targets = [...new Set([activeClone, pendingGridHoverClone].filter(Boolean))];
        const beforeRects = new Map();
        if (uiChanged || full || updates.some(update => update.moved || update.visibilityChanged || update.controlsChanged)) {
            for (const clone of targets) beforeRects.set(clone, clone.getBoundingClientRect());
        }
        for (const { entry, controlsChanged, visibilityChanged, moved } of updates) {
            if (controlsChanged) {
                syncManualViewingCard(state, entry.clone, entry.item, entry.status);
                work.controlsUpdated++;
            }
            if (visibilityChanged) {
                if (entry.hidden) entry.clone.setAttribute('data-tm-type-hidden', 'true');
                else entry.clone.removeAttribute('data-tm-type-hidden');
            }
            if (moved || visibilityChanged) releaseGridReact(entry.clone);
            if (moved && !full) {
                const parent = entry.group === 'main' ? state.grid : ui.watchedGrid;
                let reference = entry.group === 'main' ? ui.empty : null;
                for (let offset = entry.order + 1; offset < index.order.length; offset++) {
                    const next = index.entries.get(index.order[offset]);
                    if (next.group === entry.group && next.clone.parentElement === parent) {
                        reference = next.clone;
                        break;
                    }
                }
                parent.insertBefore(entry.clone, reference);
                work.categoryMoves++;
            }
        }
        if (full) {
            const remaining = [], completed = [];
            for (const entry of index.entries.values()) (entry.group === 'watched' ? completed : remaining).push(entry.clone);
            const mainOrder = [ui.mainFilter.root, ...remaining, ui.empty, ui.controls, ui.details];
            work.categoryMoves += updates.filter(update => update.moved).length;
            syncWatchChildOrder(ui.watchedGrid, completed);
            syncWatchChildOrder(state.grid, mainOrder);
        }
        watch.completedCount = counts.watched.all;
        watch.unknownCount = index.unknown;
        watch.visibleCount = visibleCount;
        if (uiChanged) {
            syncWatchTypeFilter(ui.mainFilter, watch.filters.main, counts.main);
            syncWatchTypeFilter(ui.watchedFilter, watch.filters.watched, counts.watched);
            ui.empty.hidden = visibleCount > 0;
            const emptyText = watch.loading ? tUi('checkingViewingStatus')
                : !counts.main.all && counts.watched.all ? tUi('caughtUpMessage') : tUi('noMatchingTitles');
            if (ui.empty.textContent !== emptyText) ui.empty.textContent = emptyText;
            ui.watchedEmpty.hidden = visibleCompleted > 0;
            ui.refresh.disabled = watch.loading;
            const label = tUi('watchedCaughtUp') + ' (' + formatUiNumber(counts.watched.all) + ')';
            if (ui.summary.textContent !== label) ui.summary.textContent = label;
            let note = watch.loading ? tUi('checkingViewingStatus')
                : index.unknown ? tUi('unknownViewingStatus', { count: formatUiNumber(index.unknown) }) : '';
            const unknownTypes = counts.main.all - counts.main.movie - counts.main.series;
            if (unknownTypes && watch.filters.main !== 'all') {
                note += (note ? ' ' : '') + tUi('unknownTitleTypes', { count: formatUiNumber(unknownTypes) });
            }
            if (watch.manualFailure) note += (note ? ' ' : '') + tUi('viewingChoiceStorageFailed');
            if (ui.note.textContent !== note) ui.note.textContent = note;
            state.status = updateStatus(formatHeaderParts(state.items.length, state.totalCount,
                state.initializationElapsedMs, true));
        }
        index.filters = { ...watch.filters };
        index.disabled = disabled;
        index.locale = locale;
        index.uiSignature = uiSignature;
        watch.groupIndex = index;
        const hoverChanged = targets.some(clone => {
            if (!clone.isConnected || !gridOwnsClone(clone, state.grid)) return true;
            const before = beforeRects.get(clone);
            if (!before) return false;
            const after = clone.getBoundingClientRect();
            return ['left', 'top', 'width', 'height'].some(key => Math.abs(before[key] - after[key]) > 0.5);
        }) || Boolean(activeSourceSlot && !activeSourceSlot.isConnected);
        if (hoverChanged) {
            cancelPendingGridHover();
            hoverToken++;
            clearSourceAlignment();
            activeClone = null;
            activeVideoId = null;
            activePage = null;
            invalidateGridReact();
            work.hoverCancelled++;
        } else if (targets.length) {
            work.hoverPreserved++;
        }
    }

    function initializeWatchGroups(state, sessionToken) {
        const active = netflixModelData('userInfo')?.userGuid;
        const profile = typeof active === 'string' && active ? active : null;
        const cached = readViewingCache(state, profile);
        state.watchStatus = {
            sessionToken, results: new Map(), types: new Map(), seriesDetails: new Map(), filters: { main: 'movie', watched: 'movie' },
            cachedResults: cached.results, cachedTypes: cached.types, cachedTitles: cached.types.size, publications: 0,
            seriesCoverage: new Map(), manualChoices: new Map(), manualProfileGuid: undefined, manualFailure: false,
            completedCount: 0, unknownCount: state.items.length, visibleCount: 0,
            loading: false, expanded: false, ui: null, promise: null, requests: 0, passes: 0, failure: null, profileGuid: profile,
            network: null
        };
        syncWatchGroups(state);
        refreshViewingStatus(state);
    }

    async function refreshViewingStatus(state) {
        if (sourceState !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus;
        if (watch.loading) return watch.promise;
        const context = viewingRequestContext();
        if (!context || !isRouteSessionActive(watch.sessionToken)) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.seriesCoverage = new Map();
            watch.failure = 'VIEWING_STATUS_CONTEXT';
            syncWatchGroups(state);
            log(tLog('viewingStatusUnavailable'), { reason: watch.failure });
            return;
        }
        if (watch.profileGuid !== context.profileGuid) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
        } else {
            // Keep the current grouping while refreshing unresolved series,
            // using the same provisional fallback as a warm list entry.
            for (const [id, status] of watch.results) watch.cachedResults.set(id, status);
            for (const [id, type] of watch.types) watch.cachedTypes.set(id, type);
        }
        watch.profileGuid = context.profileGuid;
        watch.loading = true;
        watch.seriesCoverage = new Map();
        watch.failure = null;
        watch.publications = 0;
        syncWatchGroups(state, [], 'scan-start');
        const job = {
            state, watch, context, sessionToken: watch.sessionToken, results: new Map(), types: new Map(), seriesDetails: new Map(),
            requests: 0, passRequests: 0, passes: 1, deadline: performance.now() + VIEWING_TIMEOUT_MS * VIEWING_MAX_PASSES,
            unresolvedSeries: new Set(), controllers: new Set(), collectionFailure: null, network: createViewingNetworkDiagnostics(),
            recheckStats: { candidates: 0, requests: 0, episodes: 0, recoveredEpisodes: 0, recoveredSeries: 0, unknownEpisodes: 0,
                initialUnknownFields: { watched: {}, bookmark: {}, runtime: {} },
                remainingUnknownFields: { watched: {}, bookmark: {}, runtime: {} } },
            seriesStats: { found: 0, eligible: 0, planned: 0, checked: 0, complete: 0, unknown: 0,
                incomplete: 0, unplanned: 0, episodesChecked: 0, episodesIncomplete: 0, episodesUnknown: 0, missingEpisodeRefs: 0 }
        };
        watch.network = job.network;
        log(tLog('viewingStatusStarted'), {
            titles: state.items.length, endpointType: context.endpointType, endpointPath: context.endpointPath,
            completionRatio: VIEWING_COMPLETION_RATIO, maxPasses: VIEWING_MAX_PASSES,
            maxRequests: VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES, cachedTitles: watch.cachedTypes.size,
            concurrencyLimit: VIEWING_REQUEST_CONCURRENCY
        });
        watch.promise = (async () => {
            try {
                await collectViewingStatuses(job);
                assertViewingJob(job);
            } catch (error) {
                if (isRouteSessionCancelledError(error)) {
                    job.network.finishedAt = performance.now();
                    log(tLog('viewingStatusUnavailable'), { reason: 'VIEWING_STATUS_CANCELLED', requests: job.requests,
                        network: collectViewingNetworkDiagnostics(job.network) });
                    // A profile switch in the same grid invalidates old results.
                    if (sourceState === state && state.watchStatus === watch && isRouteSessionActive(job.sessionToken)) {
                        clearCachedViewingStatus(watch);
                        watch.results = new Map();
                        watch.types = new Map();
                        watch.seriesDetails = new Map();
                        watch.loading = false;
                        watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED';
                        syncWatchGroups(state);
                    }
                    return;
                }
                watch.failure = /^VIEWING_STATUS_[A-Z0-9_]+$/.test(error?.message || '')
                    ? error.message : 'VIEWING_STATUS_FAILED';
                warn(tLog('viewingStatusUnavailable'), { reason: watch.failure, requests: job.requests,
                    network: collectViewingNetworkDiagnostics(job.network) });
            }
            job.network.finishedAt = performance.now();
            if (sourceState !== state || state.watchStatus !== watch || !isRouteSessionActive(job.sessionToken)) return;
            if (netflixModelData('userInfo')?.userGuid !== context.profileGuid) {
                job.results.clear();
                job.types.clear();
                job.seriesDetails.clear();
                watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED';
            }
            watch.results = job.results;
            watch.types = job.types;
            watch.seriesDetails = job.seriesDetails;
            watch.requests = job.requests;
            watch.passes = job.passes;
            watch.loading = false;
            const unresolvedCachedIds = new Set([...watch.cachedResults.keys(), ...watch.cachedTypes.keys()]);
            clearCachedViewingStatus(watch);
            syncWatchGroups(state, unresolvedCachedIds, 'scan-complete');
            writeViewingCache(job);
            log(tLog('viewingStatusCompleted'), {
                completed: watch.completedCount, unknown: watch.unknownCount,
                requests: watch.requests, passes: watch.passes, failure: watch.failure, publications: watch.publications,
                series: { ...job.seriesStats, pending: job.seriesStats.eligible - job.seriesStats.checked - job.seriesStats.unplanned },
                recheck: job.recheckStats,
                network: collectViewingNetworkDiagnostics(job.network),
                work: collectPerformanceDiagnostics()
            });
        })().catch(() => {
            // Optional grouping must never reject Netflix's grid initialization.
            if (sourceState !== state || state.watchStatus !== watch) return;
            watch.loading = false;
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.failure = 'VIEWING_STATUS_FAILED';
            syncWatchGroups(state);
        });
        return watch.promise;
    }

    function carouselArtworkVariables() {
        const standard = { width: 342, height: 192 };
        const standardHighRes = { width: 665, height: 375 };
        const formats = ['WEBP', 'JPG', 'PNG'];
        const dir = document.querySelector('[data-uia="loc"]')?.getAttribute('dir') || document.documentElement.dir || 'ltr';
        return {
            imageParamsForStandardBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { enableLockBadgeChecks: true, fallbackStrategy: 'STILL' }
            },
            imageParamsForStandardBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL', enableLockBadgeChecks: true }
            },
            imageParamsForPodcastEpisodicStill: {
                artworkType: 'SEGMENT_STILL',
                dimension: { ...standard, scaleStrategy: 'COVER' },
                features: { graybox: false }
            },
            imageParamsForPodcastEpisodicStillHighRes: {
                artworkType: 'SEGMENT_STILL',
                dimension: { ...standardHighRes, scaleStrategy: 'COVER' },
                features: { graybox: false }
            },
            imageParamsForPodcastEpisodicLogo: {
                artworkType: 'LOGO_HORIZONTAL_CROPPED',
                dimension: { width: 800, height: 126, scaleStrategy: 'CONTAIN' },
                features: { tone: 'LIGHT' }
            },
            imageParamsForRankedBoxart: {
                artworkType: 'BOXSHOT',
                dimension: { width: 426, height: 607 },
                features: { fallbackStrategy: 'STILL', suppressTop10Badge: true }
            },
            imageParamsForContinueWatchingBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForContinueWatchingBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForCloudGameBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForCloudGameBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForMobileGameBoxart: {
                artworkType: 'APP_ICON',
                dimension: { width: 200, height: 200 },
                formats
            },
            imageParamsForCharacterCircle: {
                artworkType: 'SQUAREHEADSHOT_1000x1000',
                dimension: { width: 200, height: 200 },
                formats
            },
            imageParamsForChannel: {
                artworkType: dir === 'rtl' ? 'CHANNEL_TILE_BACKGROUND_RTL' : 'CHANNEL_TILE_BACKGROUND',
                dimension: standard,
                formats
            },
            imageParamsForChannelLogo: {
                artworkType: 'CHANNEL_LOGO_COLOR_CROPPED',
                dimension: { height: 44 },
                formats: ['WEBP', 'PNG']
            },
            imageParamsForEntryPointBackground: {
                artworkType: dir === 'rtl' ? 'MLP_ENTRY_POINT_BACKGROUND_RTL' : 'MLP_ENTRY_POINT_BACKGROUND',
                dimension: { width: 1024 },
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForEntryPointLogo: {
                artworkType: 'LOGO_STACKED_CROPPED',
                dimension: { height: 260 },
                formats
            }
        };
    }

    function firstVideoIdFromCarouselNode(node) {
        const first = node?.entities?.edges?.[0]?.node;
        if (!first || typeof first !== 'object') return '';
        const seen = new Set();
        const stack = [first];
        while (stack.length) {
            const value = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value);
            const direct = value.videoId;
            if (Number.isFinite(Number(direct)) && Number(direct) > 0) return String(direct);
            const id = typeof value.id === 'string' ? value.id : '';
            const match = id.match(/(?:standardBoxshot_)?Video:(\d+)/);
            if (match) return match[1];
            for (const child of Object.values(value)) {
                if (child && typeof child === 'object') stack.push(child);
            }
        }
        return '';
    }

    function videoIdFromGraphqlNode(node) {
        if (!node || typeof node !== 'object') return '';
        const seen = new Set();
        const stack = [node];
        while (stack.length) {
            const value = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value);
            const direct = value.videoId;
            if (Number.isFinite(Number(direct)) && Number(direct) > 0) return String(direct);
            const id = typeof value.id === 'string' ? value.id : '';
            const match = id.match(/(?:standardBoxshot_)?Video:(\d+)/);
            if (match) return match[1];
            for (const child of Object.values(value)) {
                if (child && typeof child === 'object') stack.push(child);
            }
        }
        return '';
    }

    function firstGraphqlText(value, depth = 0, seen = new Set()) {
        if (depth > 5 || value === null || value === undefined) return '';
        if (typeof value === 'string') {
            const text = value.trim();
            if (!text || /^https?:\/\//i.test(text) || text.length > 240) return '';
            return text;
        }
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        for (const key of ['text', 'value', 'title', 'name', 'label', 'displayString']) {
            const result = firstGraphqlText(value[key], depth + 1, seen);
            if (result) return result;
        }
        for (const child of Object.values(value)) {
            const result = firstGraphqlText(child, depth + 1, seen);
            if (result) return result;
        }
        return '';
    }

    function firstGraphqlImageUrl(value, depth = 0, seen = new Set()) {
        if (depth > 7 || value === null || value === undefined) return '';
        if (typeof value === 'string') {
            const text = value.trim();
            if (/^https?:\/\//i.test(text) && (/(?:\.webp|\.jpe?g|\.png)(?:[?#]|$)/i.test(text) || /nflxso\.net|nflximg\.net/i.test(text))) {
                return text;
            }
            return '';
        }
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        for (const key of ['url', 'imageUrl', 'artwork', 'image', 'src', 'uri']) {
            const result = firstGraphqlImageUrl(value[key], depth + 1, seen);
            if (result) return result;
        }
        for (const child of Object.values(value)) {
            const result = firstGraphqlImageUrl(child, depth + 1, seen);
            if (result) return result;
        }
        return '';
    }

    async function runConstructionChunks(count, buildItem, assertActive) {
        assertActive();
        let chunkStarted = performance.now();
        let chunkItems = 0;
        for (let index = 0; index < count; index++) {
            if (buildItem(index) === false) return false;
            chunkItems++;
            if (index + 1 < count && (chunkItems >= BUILD_CHUNK_MAX_ITEMS ||
                performance.now() - chunkStarted >= BUILD_CHUNK_BUDGET_MS)) {
                // A timer yields to a new task, allowing input/rendering and route
                // cleanup to run. Promise-only yielding would remain in microtasks.
                await sleep(0);
                assertActive();
                chunkStarted = performance.now();
                chunkItems = 0;
            }
        }
        assertActive();
        return true;
    }

    async function buildGraphqlMyListItems(edges, totalCount, columns, templateSlot, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (!Array.isArray(edges) || !templateSlot || !Number.isFinite(totalCount)) return null;
        // Netflix may recycle this live slot while we yield. Keep one detached
        // template shared by compact items until the complete grid is published.
        const template = templateSlot.cloneNode(true);
        if (!template.querySelector(NETFLIX_DOM_SELECTORS.standardCard)) return null;
        const items = [];
        const seen = new Set();
        const complete = await runConstructionChunks(edges.length, index => {
            const edge = edges[index];
            const node = edge?.node;
            const videoId = videoIdFromGraphqlNode(node);
            if (!videoId || seen.has(videoId)) return;
            const href = `${location.origin}/browse?jbv=${encodeURIComponent(videoId)}`;
            const title = firstGraphqlText(node?.displayString) || firstGraphqlText(node) || `Netflix ${videoId}`;
            const imageUrl = firstGraphqlImageUrl(node?.contextualArtwork) || firstGraphqlImageUrl(node);
            const itemIndex = items.length;
            items.push({
                href,
                videoId,
                page: Math.floor(itemIndex / Math.max(1, columns)),
                logicalIndex: itemIndex,
                ariaLabel: title,
                cardTemplate: template,
                imageUrl,
                graphql: true
            });
            seen.add(videoId);
        }, () => assertRouteSession(sessionToken));
        assertRouteSession(sessionToken);
        return complete && items.length === totalCount ? items : null;
    }

    async function fetchMyListCarouselPage(request, cursor, signal, sessionToken) {
        assertRouteSession(sessionToken);
        const body = { ...request.body, variables: { ...request.body.variables, carouselAfterCursor: cursor } };
        const response = await fetch('https://web.prod.cloud.netflix.com/graphql', {
            method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
            headers: request.headers, body: JSON.stringify(body), signal
        });
        assertRouteSession(sessionToken);
        if (!response.ok) {
            throw initializationError('FRESH_MY_LIST_CAROUSEL_HTTP_ERROR', 'fresh-my-list-carousel',
                'Netflix CarouselPage returned HTTP ' + response.status,
                { status: response.status, statusText: response.statusText, responseUrl: response.url });
        }
        const text = await response.text();
        assertRouteSession(sessionToken);
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (error) {
            throw initializationError('FRESH_MY_LIST_CAROUSEL_PARSE_ERROR', 'fresh-my-list-carousel',
                'Netflix CarouselPage returned invalid JSON',
                { responseUrl: response.url, responseBytes: text.length, errorMessage: error?.message || String(error) });
        }
        const node = payload?.data?.node;
        const countValue = node?.entities?.totalCount;
        const totalCount = Number(countValue);
        const countPresent = typeof countValue === 'number' ||
            (typeof countValue === 'string' && countValue.trim() !== '');
        if (node?.__typename !== 'PinotCarouselSection' || !countPresent ||
            !Number.isSafeInteger(totalCount) || totalCount < 0) {
            throw initializationError('FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE', 'fresh-my-list-carousel',
                'Could not read the current Netflix My List totalCount from CarouselPage', {
                    responseUrl: response.url, responseBytes: text.length, typename: node?.__typename || null,
                    graphqlErrors: Array.isArray(payload?.errors) ? payload.errors.map(item => item?.message || String(item)) : []
                });
        }
        return {
            totalCount,
            edges: Array.isArray(node?.entities?.edges) ? node.entities.edges : [],
            hasNextPage: Boolean(node?.entities?.pageInfo?.hasNextPage),
            endCursor: node?.entities?.pageInfo?.endCursor || null,
            responseUrl: response.url,
            responseBytes: text.length
        };
    }

    function carouselFetchError(error, sessionToken) {
        // Route aborts must never become a timeout warning or start a fallback.
        assertRouteSession(sessionToken);
        if (isRouteSessionCancelledError(error) || (error?.code && error?.stage)) return error;
        const aborted = error?.name === 'AbortError';
        return initializationError(
            aborted ? 'FRESH_MY_LIST_CAROUSEL_TIMEOUT' : 'FRESH_MY_LIST_CAROUSEL_FAILED',
            'fresh-my-list-carousel',
            aborted
                ? 'Netflix CarouselPage timed out after ' + FRESH_MY_LIST_FETCH_TIMEOUT_MS + ' ms'
                : 'Netflix CarouselPage failed: ' + (error?.message || error),
            {
                timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                errorName: error?.name || null,
                errorMessage: error?.message || String(error || '')
            }
        );
    }

    async function fetchFreshMyListBootstrapViaCarousel(sessionToken = null) {
        assertRouteSession(sessionToken);
        const entry = findMyListGraphqlEntry();
        const rowId = entry?.value?._id;
        if (!rowId) {
            throw initializationError('FRESH_MY_LIST_CAROUSEL_ID_UNAVAILABLE', 'fresh-my-list-carousel',
                'Could not identify the current Netflix My List carousel id',
                { graphqlKey: entry?.key || null, detectionReason: entry?.reason || null });
        }
        const request = {
            body: {
                operationName: 'CarouselPage',
                variables: {
                    rowId, ...carouselArtworkVariables(), carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                    carouselAfterCursor: null, eddEnabled: false, fetchHighResCards: false
                },
                extensions: { persistedQuery: { id: 'a4ec8877-bccc-49bd-930b-34eaa1d3b7e0', version: 102 } }
            },
            headers: {
                'content-type': 'application/json',
                'x-netflix.context.ui-flavor': 'akira',
                'x-netflix.context.operation-name': 'CarouselPage',
                'X-Netflix.Request.Originating.Url': location.href
            }
        };
        const appVersion = netflixModelData('serverDefs')?.BUILD_IDENTIFIER;
        if (appVersion) request.headers['x-netflix.context.app-version'] = String(appVersion);
        const locale = netflixModelData('geo')?.locale?.id || document.documentElement.lang;
        if (locale) request.headers['x-netflix.context.locales'] = String(locale).toLowerCase();

        const fetchState = createRouteFetch(sessionToken);
        const started = performance.now();
        try {
            // Count and first-title bootstrap needs one page in every mode.
            // Keep its continuation for logical collection after native readiness.
            const page = await fetchMyListCarouselPage(request, null, fetchState.controller.signal, sessionToken);
            assertRouteSession(sessionToken);
            const fresh = {
                totalCount: page.totalCount,
                firstVideoId: firstVideoIdFromCarouselNode({ entities: { edges: page.edges } }),
                graphqlEdges: page.edges,
                graphqlPageCount: 1,
                graphqlHasNextPage: page.hasNextPage,
                graphqlEndCursor: page.endCursor,
                graphqlRequest: request
            };
            log('Fresh Netflix My List carousel bootstrap fetched', {
                totalCount: fresh.totalCount, firstVideoId: fresh.firstVideoId || null,
                graphqlKey: entry?.key || null, responseUrl: page.responseUrl,
                responseBytes: page.responseBytes, elapsedMs: Math.round(performance.now() - started),
                operationName: 'CarouselPage', carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                graphqlPageCount: 1, graphqlEdgeCount: fresh.graphqlEdges.length,
                hasNextPage: fresh.graphqlHasNextPage
            });
            return fresh;
        } catch (error) {
            throw carouselFetchError(error, sessionToken);
        } finally {
            finishRouteFetch(fetchState);
        }
    }

    async function collectFreshMyListCarouselItems(bootstrap, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (!bootstrap?.graphqlHasNextPage) return bootstrap;
        const fetchState = createRouteFetch(sessionToken);
        const started = performance.now();
        try {
            const edges = [...bootstrap.graphqlEdges];
            const seenCursors = new Set();
            let cursor = bootstrap.graphqlEndCursor;
            let hasNextPage = true;
            let graphqlPageCount = bootstrap.graphqlPageCount;
            while (hasNextPage) {
                assertRouteSession(sessionToken);
                if (graphqlPageCount >= GRAPHQL_COLLECTION_MAX_PAGES) {
                    throw initializationError('FRESH_MY_LIST_CAROUSEL_PAGE_LIMIT', 'fresh-my-list-carousel',
                        'Netflix CarouselPage exceeded the configured GraphQL page limit',
                        { totalCount: bootstrap.totalCount, graphqlPageCount, maxPages: GRAPHQL_COLLECTION_MAX_PAGES, edgeCount: edges.length });
                }
                if (!cursor || seenCursors.has(cursor)) {
                    throw initializationError('FRESH_MY_LIST_CAROUSEL_CURSOR_INVALID', 'fresh-my-list-carousel',
                        'Netflix CarouselPage returned a missing or repeated pagination cursor',
                        { graphqlPageCount, edgeCount: edges.length });
                }
                seenCursors.add(cursor);
                const page = await fetchMyListCarouselPage(bootstrap.graphqlRequest, cursor, fetchState.controller.signal, sessionToken);
                if (page.totalCount !== bootstrap.totalCount) {
                    throw initializationError('FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE', 'fresh-my-list-carousel',
                        'Netflix CarouselPage returned inconsistent My List pagination data',
                        { responseUrl: page.responseUrl, totalCount: bootstrap.totalCount, nextTotalCount: page.totalCount });
                }
                edges.push(...page.edges);
                graphqlPageCount++;
                hasNextPage = page.hasNextPage;
                cursor = page.endCursor;
            }
            assertRouteSession(sessionToken);
            log('Fresh Netflix My List logical collection fetched', {
                totalCount: bootstrap.totalCount, graphqlPageCount, graphqlEdgeCount: edges.length,
                elapsedMs: Math.round(performance.now() - started)
            });
            return {
                ...bootstrap, graphqlEdges: edges, graphqlPageCount,
                graphqlHasNextPage: false, graphqlEndCursor: cursor, graphqlRequest: null
            };
        } catch (error) {
            throw carouselFetchError(error, sessionToken);
        } finally {
            finishRouteFetch(fetchState);
        }
    }

    async function fetchFreshMyListBootstrapViaPage(sessionToken = null) {
        assertRouteSession(sessionToken);
        const requestUrl = new URL('/browse/my-list', location.origin);
        requestUrl.searchParams.set('_tm_legacy_mylist_refresh', `${Date.now()}-${sessionToken ?? 0}`);
        const fetchState = createRouteFetch(sessionToken);
        const started = performance.now();

        try {
            const response = await fetch(requestUrl.href, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                signal: fetchState.controller.signal
            });
            assertRouteSession(sessionToken);
            if (!response.ok) {
                throw initializationError(
                    'FRESH_MY_LIST_HTTP_ERROR',
                    'fresh-my-list-fetch',
                    `Netflix My List refresh returned HTTP ${response.status}`,
                    { status: response.status, statusText: response.statusText, responseUrl: response.url }
                );
            }

            const html = await response.text();
            assertRouteSession(sessionToken);
            const fresh = extractFreshMyListBootstrap(html);
            if (!fresh || !Number.isFinite(fresh.totalCount) || fresh.totalCount < 0) {
                throw initializationError(
                    'FRESH_MY_LIST_TOTAL_COUNT_UNAVAILABLE',
                    'fresh-my-list-parse',
                    'Could not read the current Netflix My List totalCount from the fresh page response',
                    { responseUrl: response.url, responseBytes: html.length }
                );
            }

            log('Fresh Netflix My List bootstrap fetched', {
                totalCount: fresh.totalCount,
                firstVideoId: fresh.firstVideoId || null,
                responseUrl: response.url,
                responseBytes: html.length,
                elapsedMs: Math.round(performance.now() - started),
                cacheMode: 'no-store',
                fallback: true
            });
            return fresh;
        } catch (error) {
            assertRouteSession(sessionToken);
            if (isRouteSessionCancelledError(error)) throw error;
            if (error?.code && error?.stage) throw error;
            const aborted = error?.name === 'AbortError';
            throw initializationError(
                aborted ? 'FRESH_MY_LIST_FETCH_TIMEOUT' : 'FRESH_MY_LIST_FETCH_FAILED',
                'fresh-my-list-fetch',
                aborted
                    ? `Netflix My List refresh timed out after ${FRESH_MY_LIST_FETCH_TIMEOUT_MS} ms`
                    : `Netflix My List refresh failed: ${error?.message || error}`,
                {
                    timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                    errorName: error?.name || null,
                    errorMessage: error?.message || String(error || '')
                }
            );
        } finally {
            finishRouteFetch(fetchState);
        }
    }

    async function fetchFreshMyListBootstrap(sessionToken = null) {
        assertRouteSession(sessionToken);
        try {
            const fresh = await fetchFreshMyListBootstrapViaCarousel(sessionToken);
            assertRouteSession(sessionToken);
            return fresh;
        } catch (error) {
            assertRouteSession(sessionToken);
            if (isRouteSessionCancelledError(error)) throw error;
            warn('Fresh Netflix My List carousel fetch failed; falling back to page bootstrap', {
                code: error?.code || null,
                stage: error?.stage || null,
                message: error?.message || String(error || '')
            });
            return fetchFreshMyListBootstrapViaPage(sessionToken);
        }
    }

    // Owns Netflix cache reads, fresh bootstrap fallbacks, and response normalization.
    const netflixGraphql = Object.freeze({
        isAvailable() {
            return Boolean(graphqlData());
        },

        myListDomIdentity() {
            const entry = findMyListGraphqlEntry();
            return {
                sectionId: String(entry?.value?.id || ''),
                videoIds: [...graphqlSectionVideoIds(entry?.value)]
            };
        },

        readMyListTotalCount() {
            try {
                const count = Number(findMyListGraphqlEntry()?.value?.entities?.totalCount);
                return Number.isFinite(count) && count >= 0 ? count : null;
            } catch (_) {
                return null;
            }
        },

        detectMyListTotalCount() {
            const entry = findMyListGraphqlEntry();
            const count = Number(entry?.value?.entities?.totalCount);
            if (!Number.isFinite(count) || count < 0) return null;
            log(tLog('totalCountDetected'), {
                totalCount: count,
                graphqlKey: entry?.key || null,
                detectionReason: entry?.reason || null
            });
            return count;
        },

        firstMyListVideoId() {
            const entry = findMyListGraphqlEntry();
            for (const edge of entry?.value?.entities?.edges || []) {
                const ref = String(edge?.node?.__ref || '');
                const match = ref.match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
                if (match) return match[1];
            }
            return '';
        },

        fetchBootstrap(sessionToken = null) {
            return fetchFreshMyListBootstrap(sessionToken);
        },

        async collectLogicalItems({ bootstrap, totalCount, columns, templateSlot, sessionToken = null }) {
            let freshBootstrap = bootstrap;
            try {
                assertRouteSession(sessionToken);
                if (freshBootstrap?.source === 'mounted-single-page-fast-path') {
                    const reuse = collectMountedSinglePageItems(freshBootstrap, totalCount, columns, sessionToken);
                    const work = performanceDiagnostics.membershipReuse;
                    work.attempts++;
                    if (reuse.items) {
                        work.reused++;
                        work.itemsCaptured += reuse.items.length;
                        work.requestsAvoided++;
                        return { bootstrap: freshBootstrap, items: reuse.items, collectionSource: 'mounted-single-page' };
                    }
                    work.rejected++;
                    log('Mounted single-page membership reuse rejected; using fresh collection', {
                        collectionSource: 'mounted-single-page', reason: reuse.reason, totalCount
                    });
                }
                if (!Array.isArray(freshBootstrap?.graphqlEdges)) {
                    freshBootstrap = await fetchFreshMyListBootstrapViaCarousel(sessionToken);
                }
                assertRouteSession(sessionToken);
                // The mounted count remains authoritative. A different fresh count
                // must use the native scan, not publish a matching-length prefix.
                if (freshBootstrap.totalCount !== totalCount) return { bootstrap: freshBootstrap, items: null };
                freshBootstrap = await collectFreshMyListCarouselItems(freshBootstrap, sessionToken);
                assertRouteSession(sessionToken);
                const items = await buildGraphqlMyListItems(
                    freshBootstrap?.graphqlEdges,
                    totalCount,
                    columns,
                    templateSlot,
                    sessionToken
                );
                assertRouteSession(sessionToken);
                return { bootstrap: freshBootstrap, items };
            } catch (error) {
                assertRouteSession(sessionToken);
                if (isRouteSessionCancelledError(error)) throw error;
                // Optional item collection cannot discard the valid first-page
                // count/anchor or trigger the page-HTML bootstrap fallback.
                return { bootstrap: freshBootstrap, items: null, error };
            }
        }
    });

    async function waitForMyListTotalCount(timeout = TOTAL_COUNT_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        let lastGraphqlAvailable = false;
        while (performance.now() - started < timeout) {
            assertRouteSession(sessionToken);
            lastGraphqlAvailable = netflixGraphql.isAvailable();
            const n = netflixGraphql.detectMyListTotalCount();
            if (Number.isFinite(n) && n >= 0) return n;
            await sleep(NATIVE_READY_POLL_MS);
        }
        assertRouteSession(sessionToken);
        const details = {
            graphqlAvailable: lastGraphqlAvailable,
            graphqlKey: myListGraphqlKey,
            domGeneration: sourceState?.section ? detectCarouselDomProfile(sourceState.section).generation : null
        };
        logOperationTimeout('total-count-detection', timeout, details);
        throw initializationTimeoutError('total-count-detection', timeout, details);
    }

    function nativeCardIdentity(slot) {
        const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return '';
        const href = card.href || card.getAttribute('href') || '';
        return videoIdFromHref(href) || href || card.getAttribute('aria-label') || '';
    }

    function readNativeMyListDomState() {
        if (!nativeReadScope) return withNativeReadScope(() => readNativeMyListDomState());
        const section = findMyListSection();
        if (!section) {
            const graphqlCount = netflixGraphql.readMyListTotalCount();
            return {
                section: null,
                scroller: null,
                track: null,
                pages: 0,
                selectedPage: 0,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: null,
                graphqlCount,
                exactCount: Number.isFinite(graphqlCount) ? graphqlCount : null,
                fingerprint: `none|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = scroller && netflixDom.findTrack(scroller);
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const pages = pageCount(section);
        const page = selectedPage(section);
        const pageTopologyKnown = profile.pageMode === 'indicator'
            ? profile.indicatorCount > 0
            : Boolean(runtime?.pageCountFinalized);
        const graphqlCount = netflixGraphql.readMyListTotalCount();

        if (!scroller || !track) {
            return {
                section,
                scroller: scroller || null,
                track: track || null,
                pages,
                selectedPage: page,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: pageTopologyKnown && pages === 1 ? 0 : null,
                graphqlCount,
                exactCount: pageTopologyKnown && pages === 1 ? 0 : (Number.isFinite(graphqlCount) ? graphqlCount : null),
                fingerprint: `${pages}|${page}|0|0||${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const current = currentPageSlots(scroller, track);
        const identities = current.map(nativeCardIdentity).filter(Boolean);
        const uniqueIdentities = [...new Set(identities)];
        const pageSignature = uniqueIdentities.join('|');
        const domExactCount = pageTopologyKnown && pages === 1 ? uniqueIdentities.length : null;
        // For one-page lists the live DOM is authoritative. Netflix's GraphQL cache can
        // remain stale after an in-page add/remove, so only use GraphQL as a fallback.
        const exactCount = Number.isFinite(domExactCount)
            ? domExactCount
            : (Number.isFinite(graphqlCount) ? graphqlCount : null);
        const sourceSlots = netflixDom.directSlots(track).length;
        const sourceCards = nativeFilledSlots(track).length;

        return {
            section,
            scroller,
            track,
            pages,
            selectedPage: page,
            pageSignature,
            pageTopologyKnown,
            currentPageCount: uniqueIdentities.length,
            sourceSlots,
            sourceCards,
            domExactCount,
            graphqlCount,
            exactCount,
            fingerprint: `${pages}|${page}|${uniqueIdentities.length}|${sourceSlots}|${sourceCards}|${pageSignature}|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
        };
    }

    function decodeTrackingContext(node) {
        const raw = node?.getAttribute?.('data-ui-tracking-context') || '';
        if (!raw) return null;
        for (const candidate of [raw, (() => {
            try { return decodeURIComponent(raw); } catch (_) { return raw; }
        })()]) {
            try {
                const parsed = JSON.parse(candidate);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (_) {}
        }
        return null;
    }

    function videoIdFromToggleContext(button, trackingContext) {
        const direct = trackingContext?.video_id ?? trackingContext?.videoId;
        if (direct !== undefined && direct !== null && String(direct)) return String(direct);
        const unified = String(trackingContext?.unifiedEntityId || '');
        const unifiedMatch = unified.match(/Video:(\d+)/i);
        if (unifiedMatch) return unifiedMatch[1];

        const slot = button?.closest?.(NETFLIX_DOM_SELECTORS.virtualSlot);
        if (slot) {
            for (const anchor of slot.querySelectorAll('a[href]')) {
                const videoId = videoIdFromHref(anchor.href || anchor.getAttribute('href') || '');
                if (videoId) return videoId;
            }
        }

        const modal = button?.closest?.('[role="dialog"], .previewModal--container, .previewModal--wrapper');
        if (modal) {
            for (const anchor of modal.querySelectorAll('a[href]')) {
                const videoId = videoIdFromHref(anchor.href || anchor.getAttribute('href') || '');
                if (videoId) return videoId;
            }
            if (activeVideoId) return String(activeVideoId);
        }
        return '';
    }

    function describeMyListToggleClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest?.('button');
        if (!button) return null;

        const uia = button.getAttribute('data-uia') || '';
        const tracker = button.closest('.ptrack-content[data-ui-tracking-context]');
        const trackingContext = decodeTrackingContext(tracker);
        const trackedAsMyList = trackingContext?.appView === 'addToMyListButton';
        const uiaIsMyList = /(?:^|-)add-to-my-list|remove-from-my-list/i.test(uia);
        if (!trackedAsMyList && !uiaIsMyList) return null;

        const videoId = videoIdFromToggleContext(button, trackingContext);
        if (!videoId) return null;

        // Netflix can expose remove-from-my-list-with-undo even on a click that
        // results in an add. The legacy list is synchronized at initialization,
        // so its current membership is the reliable pre-click state.
        const wasInLegacy = Boolean(sourceState?.itemMap?.has(`v:${videoId}`));
        const action = wasInLegacy ? 'remove' : 'add';
        const uiaAction = /remove-from-my-list/i.test(uia)
            ? 'remove'
            : (/add-to-my-list/i.test(uia) ? 'add' : 'unknown');

        return { button, videoId, action, uiaAction, wasInLegacy, uia, trackingContext };
    }

    function normalizeNetflixUiText(value) {
        return String(value || '')
            .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    function clearUndoExpiryTimer() {
        if (undoExpiryTimer) clearTimeout(undoExpiryTimer.id);
        undoExpiryTimer = null;
    }

    function clearUndoEntries() {
        clearUndoExpiryTimer();
        performanceDiagnostics.undoRetention.cleared += recentRemovedMyListItems.size;
        recentRemovedMyListItems.clear();
    }

    function scheduleUndoExpiry() {
        let dueAt = Infinity;
        for (const entry of recentRemovedMyListItems.values()) {
            if (Number.isFinite(entry?.removedAt)) dueAt = Math.min(dueAt, entry.removedAt + UNDO_ENTRY_TTL_MS);
        }
        if (!Number.isFinite(dueAt) || !isRouteSessionActive(routeSessionToken)) {
            clearUndoExpiryTimer();
            return;
        }
        if (undoExpiryTimer?.dueAt === dueAt && undoExpiryTimer.sessionToken === routeSessionToken) return;
        clearUndoExpiryTimer();
        // Capture only the timer owner, never a card or a removed-entry array.
        const owner = { id: null, sessionToken: routeSessionToken, dueAt };
        undoExpiryTimer = owner;
        performanceDiagnostics.undoRetention.schedules++;
        owner.id = setTimeout(() => {
            if (undoExpiryTimer !== owner) return;
            undoExpiryTimer = null;
            if (!isRouteSessionActive(owner.sessionToken)) return;
            performanceDiagnostics.undoRetention.expiryCallbacks++;
            pruneUndoEntries();
        }, Math.max(0, dueAt - performance.now()));
    }

    function forgetUndoEntry(videoId) {
        if (!recentRemovedMyListItems.delete(String(videoId))) return;
        performanceDiagnostics.undoRetention.consumed++;
        scheduleUndoExpiry();
    }

    function pruneUndoEntries(now = performance.now()) {
        let expired = 0, pendingFallbacksPreserved = 0;
        for (const [videoId, entry] of recentRemovedMyListItems.entries()) {
            if (!Number.isFinite(entry?.removedAt) || now - entry.removedAt >= UNDO_ENTRY_TTL_MS) {
                if (entry?.item && pendingMyListMutations.get(videoId)?.fallbackItem === entry.item) pendingFallbacksPreserved++;
                // Drop this cache's ownership only. A queued Undo mutation may
                // still own the same item and needs its snapshot to finish.
                recentRemovedMyListItems.delete(videoId);
                expired++;
            }
        }
        performanceDiagnostics.undoRetention.expired += expired;
        scheduleUndoExpiry();
        if (expired) log(tLog('undoEntriesExpired'), { expired, remaining: recentRemovedMyListItems.size, pendingFallbacksPreserved });
    }

    function rememberUndoEntry(item, index) {
        if (!item?.videoId || !item.snapshot) return;
        pruneUndoEntries();
        recentRemovedMyListItems.set(String(item.videoId), {
            videoId: String(item.videoId),
            item,
            index: Math.max(0, Number.isFinite(index) ? Math.floor(index) : 0),
            title: normalizeNetflixUiText(item.ariaLabel || ''),
            removedAt: performance.now()
        });
        performanceDiagnostics.undoRetention.remembered++;
        scheduleUndoExpiry();
    }

    function describeMyListUndoClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest?.('button');
        if (!button) return null;
        const toast = button.closest('#toastRoot [aria-label="toast"], #toastRoot [role="alert"]');
        if (!toast) return null;

        const toastButtons = [...toast.querySelectorAll('button')];
        if (toastButtons.length !== 1 || toastButtons[0] !== button) return null;

        pruneUndoEntries();
        let entry = null;
        for (const candidate of recentRemovedMyListItems.values()) {
            if (!entry || candidate.removedAt > entry.removedAt) entry = candidate;
        }
        if (!entry) return null;

        // A single action button inside a recent-removal toast is treated as Undo.
        // The most recent remembered removal identifies the affected video. No
        // localized toast text participates in detection or state decisions.
        return {
            button,
            videoId: entry.videoId,
            action: 'add',
            uiaAction: 'undo',
            wasInLegacy: false,
            uia: 'toast-undo',
            trackingContext: null,
            fallbackItem: entry.item,
            preferredIndex: entry.index,
            undo: true
        };
    }

    function findNativeMyListItemByVideoId(videoId, liveState = null) {
        const live = liveState || readNativeMyListDomState();
        const track = live.track;
        if (!track) return null;
        for (const slot of netflixDom.directSlots(track)) {
            const item = itemFromSlot(slot, live.selectedPage || 0, false);
            if (item?.videoId === String(videoId)) {
                item.snapshot = slot.cloneNode(true);
                return item;
            }
        }
        return null;
    }

    function findAnyStandardCardItemByVideoId(videoId) {
        const wanted = String(videoId);
        for (const card of document.querySelectorAll(NETFLIX_DOM_SELECTORS.standardCardWithHref)) {
            if (card.closest(`#${GRID_ID}`)) continue;
            const href = card.href || card.getAttribute('href') || '';
            if (videoIdFromHref(href) !== wanted) continue;
            const slot = card.closest(NETFLIX_DOM_SELECTORS.virtualSlot);
            if (!slot) continue;
            const item = itemFromSlot(slot, 0);
            if (item?.videoId === wanted) return item;
        }
        return null;
    }

    function installEmptyFrameResizeObserver(section) {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!sourceState?.empty || !sourceState.grid?.isConnected || !sourceState.status?.isConnected) return;
            const nextLayout = measureEmptyLayout(section);
            nextLayout.rowGap = measureNativeCarouselGap(section);
            sourceState.layout = nextLayout;
            const geometry = applyGridGeometry(section, sourceState.grid, nextLayout);
            sourceState.status.style.marginLeft = `${geometry.left}px`;
            sourceState.status.style.width = `${geometry.width}px`;
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (nextLayout.rowGap || 0) : 0}px`);
            applyLegacyEmptyStateGeometry(section, nextLayout);
        });
        resizeObserver.observe(section);
    }

    function moveLegacyFrameToSyntheticEmpty() {
        if (!sourceState) return false;
        const live = readNativeMyListDomState();
        if (live.section && !live.scroller && !live.track) {
            return adoptLiveEmptyMyListSection(live);
        }
        const synthetic = netflixDom.ensureSyntheticMyListSection();
        if (!synthetic) return false;
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        synthetic.setAttribute(SECTION_ATTR, 'true');
        clearLegacyEmptyState({ restoreGrid: false });
        synthetic.appendChild(status);
        status.insertAdjacentElement('afterend', grid);
        const layout = measureEmptyLayout(synthetic);
        layout.rowGap = measureNativeCarouselGap(synthetic);
        sourceState.section = synthetic;
        sourceState.scroller = null;
        sourceState.track = null;
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        grid.setAttribute('data-tm-empty', 'true');
        const geometry = applyGridGeometry(synthetic, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', '0px');
        syncLegacyEmptyState(synthetic, { allowProvisional: true });
        completedSection = synthetic;
        applyOriginalMyListVisibility();
        installEmptyFrameResizeObserver(synthetic);
        log(tLog('legacyFrameMovedToEmptyAnchor'), {
            items: sourceState.items?.length ?? 0
        });
        return true;
    }

    function adoptLiveMyListSection(live) {
        if (!sourceState || !live?.section || !live?.scroller || !live?.track) return false;
        if (sourceState.section === live.section && sourceState.scroller === live.scroller && sourceState.track === live.track) return false;

        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        clearSourceAlignment();
        invalidateGridReact();
        const oldSynthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        clearLegacyEmptyState({ restoreGrid: false });
        live.section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(live.section);
        const layout = measureVisibleLayout(live.section, live.scroller, live.track);
        layout.rowGap = measureNativeCarouselGap(live.section);
        parkSource(live.scroller);
        live.scroller.insertAdjacentElement('afterend', status);
        status.insertAdjacentElement('afterend', grid);
        sourceState.section = live.section;
        sourceState.scroller = live.scroller;
        sourceState.track = live.track;
        sourceState.layout = layout;
        sourceState.status = status;
        sourceState.grid = grid;
        sourceState.empty = (sourceState.items?.length ?? 0) === 0;
        if (!sourceState.empty) waitingForNativeEmpty = false;
        const geometry = applyGridGeometry(live.section, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        syncStatusTypography(live.section, status);
        completedSection = live.section;
        if (oldSynthetic && oldSynthetic !== live.section) oldSynthetic.remove();
        applyOriginalMyListVisibility();

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!grid.isConnected || responsiveRefreshing) return;
            scheduleResponsiveRefresh(140, 'ResizeObserver');
        });
        resizeObserver.observe(live.section);
        resizeObserver.observe(live.scroller);

        log(tLog('nativeMyListSourceAdoptedWithoutRescan'), {
            pages: live.pages,
            selectedPage: live.selectedPage,
            layout: layoutSummary(layout)
        });
        invalidateNativeReadScope();
        return true;
    }

    function adoptLiveEmptyMyListSection(live) {
        if (!sourceState || !live?.section || live.scroller || live.track) return false;
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        clearSourceAlignment();
        invalidateGridReact();
        const oldSynthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        live.section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(live.section);

        const layout = measureEmptyLayout(live.section);
        layout.rowGap = measureNativeCarouselGap(live.section);
        const emptyContent = live.section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const originalAnchor = emptyContent || markOriginalHeader(live.section);
        if (originalAnchor) originalAnchor.insertAdjacentElement('afterend', status);
        else live.section.prepend(status);
        status.insertAdjacentElement('afterend', grid);

        sourceState.section = live.section;
        sourceState.scroller = null;
        sourceState.track = null;
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        grid.setAttribute('data-tm-empty', 'true');
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(live.section, { allowProvisional: true });

        const geometry = applyGridGeometry(live.section, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        applyLegacyEmptyStateGeometry(live.section, layout);
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        syncStatusTypography(live.section, status);

        completedSection = live.section;
        if (oldSynthetic && oldSynthetic !== live.section) oldSynthetic.remove();
        applyOriginalMyListVisibility();
        installEmptyFrameResizeObserver(live.section);

        log(tLog('nativeEmptyMyListSectionAdopted'), {
            layout: layoutSummary(layout),
            originalVisible: viewOriginalMyList
        });
        invalidateNativeReadScope();
        return true;
    }

    function syncLogicalPageModelAfterDelta(reason = 'delta-reindex') {
        if (!sourceState?.section || !sourceState?.scroller || !sourceState?.track) return false;
        const runtime = getCarouselDomRuntime(sourceState.section);
        if (!runtime || runtime.profile.pageMode !== 'logical') return false;

        const columns = Math.max(1, sourceState.layout?.columns || 1);
        const items = sourceState.items || [];
        const estimatedPages = Math.max(1, Math.ceil(Math.max(items.length, 1) / columns));
        const slots = currentPageSlots(sourceState.scroller, sourceState.track);
        const signature = visibleSignature(slots);

        // Hawkins page boundaries can retain a native phase across a responsive
        // column-count change or a My List delta. Recomputing every item.page as
        // floor(index / columns) fabricates page boundaries that may be one page
        // away from the live carousel. Preserve the last native-observed pages and
        // re-anchor only the page that is actually visible now.
        const votes = new Map();
        for (const slot of slots) {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const videoId = card ? videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
            const item = videoId ? sourceState.itemMap?.get(`v:${videoId}`) : null;
            if (!Number.isFinite(item?.page)) continue;
            votes.set(item.page, (votes.get(item.page) || 0) + 1);
        }

        const nativePageState = nativeLogicalPageState(
            sourceState.scroller,
            sourceState.track,
            items.length,
            columns
        );
        let currentPage = Number.isFinite(nativePageState.page)
            ? nativePageState.page
            : Math.max(0, Math.min(estimatedPages - 1, runtime.currentPage || 0));
        if (!Number.isFinite(nativePageState.page) && votes.size) {
            currentPage = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
            currentPage = Math.max(0, Math.min(estimatedPages - 1, currentPage));
        }

        myListCountConvergencePending = true;
        runtime.signatureToPage.clear();
        runtime.pageToSignature.clear();
        runtime.knownPageCount = estimatedPages;
        runtime.pageCountFinalized = true;
        runtime.cycleDetected = false;
        runtime.pageMappingStale = true;
        runtime.currentPage = currentPage;
        if (signature) registerLogicalPageSignature(sourceState.section, signature, currentPage);

        log(tLog('logicalPageModelSynchronizedAfterDelta'), {
            reason,
            currentPage,
            knownPageCount: runtime.knownPageCount,
            pageCountFinalized: runtime.pageCountFinalized,
            pageMappingStale: runtime.pageMappingStale,
            visibleSignature: signature,
            visibleIds: slots.map(slot => videoIdFromHref(slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || '')).filter(Boolean),
            itemIndices: nativePageState.itemIndices,
            logicalIndices: nativePageState.logicalIndices,
            totalCount: items.length
        });
        return true;
    }

    function reindexLegacyItemsAfterDelta(reason = 'delta-reindex') {
        if (!sourceState) return;
        const items = sourceState.items || [];
        const columns = Math.max(1, sourceState.layout?.columns || 1);
        const runtime = sourceState.section ? getCarouselDomRuntime(sourceState.section) : null;
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const resetLogicalPages = reason === 'mutation-reindex';
        sourceState.itemMap = new Map();
        items.forEach((item, index) => {
            // Generation 1 retains authoritative native indicators. Generation 2
            // keeps the last page observed from the live Hawkins carousel during
            // order alignment. An add/remove changes every later page boundary,
            // so mutation reindexing must reset all logical pages from the new
            // item order before the native carousel converges.
            if (!logicalMode || resetLogicalPages || !Number.isFinite(item.page)) {
                item.page = Math.floor(index / columns);
            }
            const key = itemKey(item);
            sourceState.itemMap.set(key, item);
            const clone = sourceState.cloneMap?.get(key);
            if (clone?.isConnected) copyItemAttributes(clone, item, index);
        });
        sourceState.totalCount = items.length;
        sourceState.empty = items.length === 0;
        if (logicalMode) {
            syncLogicalPageModelAfterDelta(reason);
            if (items.length) scheduleResponsiveRefresh(140, 'my-list-delta');
        }
        if (sourceState.grid) {
            if (items.length) sourceState.grid.removeAttribute('data-tm-empty');
            else sourceState.grid.setAttribute('data-tm-empty', 'true');
        }
        if (items.length) {
            waitingForNativeEmpty = false;
            clearLegacyEmptyState();
        } else {
            waitingForNativeEmpty = true;
            syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
        }
        invalidateGridReact();
        if (sourceState.watchStatus) syncWatchGroups(sourceState);
        const elapsed = sourceState.initializationElapsedMs;
        sourceState.status = updateStatus(formatHeaderParts(items.length, items.length, elapsed, true));
        if (sourceState.status && sourceState.layout) {
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList && !sourceState.empty ? (sourceState.layout.rowGap || 0) : 0}px`);
        }
    }

    function applyLegacyRemoval(videoId, reason = 'click-delta') {
        if (!sourceState?.items) return false;
        const key = `v:${videoId}`;
        const index = sourceState.items.findIndex(item => itemKey(item) === key);
        if (index < 0) return false;

        const [removed] = sourceState.items.splice(index, 1);
        const clone = sourceState.cloneMap?.get(key);
        if (activeVideoId === String(videoId) || activeClone === clone) {
            hoverToken++;
            clearSourceAlignment();
            activeVideoId = null;
            activeClone = null;
            activePage = null;
        }
        releaseGridReact(clone);
        clone?.remove();
        // Reuse the removed tree for Undo instead of keeping another full tree
        // for every item throughout its lifetime in the displayed grid.
        if (clone) removed.snapshot = clone;
        rememberUndoEntry(removed, index);
        sourceState.cloneMap?.delete(key);
        sourceState.itemMap?.delete(key);
        reindexLegacyItemsAfterDelta('mutation-reindex');
        mutationSourceRecoveryPending = true;
        if (!sourceState.items.length) {
            // Do not inject a synthetic section into Netflix's React-managed section
            // stack during the last-item transition. Netflix owns the native My List
            // carousel -> empty-section replacement; we only wait for and adopt it.
            waitingForNativeEmpty = true;
        }
        log(tLog('legacyItemRemovedByDifferentialUpdate'), {
            reason,
            removed: itemSummary(removed),
            remaining: sourceState.items.length
        });
        return true;
    }

    function applyLegacyAddition(item, preferredIndex = 0, reason = 'click-delta') {
        if (!sourceState || !item?.videoId || !cardSourceForItem(item)) return false;
        const key = itemKey(item);
        if (sourceState.itemMap?.has(key) || sourceState.items?.some(existing => itemKey(existing) === key)) return false;

        const items = sourceState.items || (sourceState.items = []);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!grid) return false;
        ensureGridHoverBehavior(grid);
        const index = Math.max(0, Math.min(items.length, Number.isFinite(preferredIndex) ? Math.floor(preferredIndex) : 0));
        const clone = createItemClone(item);
        item.page = Math.floor(index / Math.max(1, sourceState.layout?.columns || 1));
        normalizeClone(clone);
        copyItemAttributes(clone, item, index);
        associateGridHoverItem(item, clone);
        const before = sourceState.watchStatus ? null : (grid.children[index] || null);
        grid.insertBefore(clone, before);
        items.splice(index, 0, item);
        sourceState.cloneMap ||= new Map();
        sourceState.cloneMap.set(key, clone);
        sourceState.itemMap ||= new Map();
        sourceState.itemMap.set(key, item);
        releaseItemCardSnapshot(item);
        forgetUndoEntry(item.videoId);
        waitingForNativeEmpty = false;
        sourceState.empty = false;
        grid.removeAttribute('data-tm-empty');
        reindexLegacyItemsAfterDelta('mutation-reindex');
        mutationSourceRecoveryPending = true;
        log(tLog('legacyItemAddedByDifferentialUpdate'), {
            reason,
            index,
            added: itemSummary(item),
            total: sourceState.items.length
        });
        return true;
    }

    function visibleNativeItems(live) {
        if (!live?.scroller || !live?.track) return [];
        return currentPageSlots(live.scroller, live.track)
            .map(slot => itemFromSlot(slot, live.selectedPage || 0, false))
            .filter(item => item?.videoId);
    }

    function preferredIndexForNativeItem(videoId, live) {
        const items = visibleNativeItems(live);
        const position = items.findIndex(item => item.videoId === String(videoId));
        if (position < 0) return 0;
        const columns = Math.max(1, sourceState?.layout?.columns || items.length || 1);
        return Math.min(sourceState?.items?.length ?? 0, (live.selectedPage || 0) * columns + position);
    }

    function alignLegacyVisiblePageOrder(live) {
        if (!sourceState?.items?.length || !live?.pageSignature) return false;
        const nativeItems = visibleNativeItems(live);
        const nativeIds = nativeItems.map(item => item.videoId);
        if (!nativeIds.length || nativeIds.some(id => !sourceState.itemMap?.has(`v:${id}`))) return false;

        const columns = Math.max(1, sourceState.layout?.columns || nativeIds.length);
        const base = Math.min(sourceState.items.length, (live.selectedPage || 0) * columns);
        const currentIds = sourceState.items.slice(base, base + nativeIds.length).map(item => item.videoId);
        if (currentIds.join('|') === nativeIds.join('|')) return false;

        const nativeSet = new Set(nativeIds);
        const ordered = nativeIds.map(id => sourceState.itemMap.get(`v:${id}`)).filter(Boolean);
        const remaining = sourceState.items.filter(item => !nativeSet.has(item.videoId));
        const insertion = Math.min(base, remaining.length);
        sourceState.items = [...remaining.slice(0, insertion), ...ordered, ...remaining.slice(insertion)];

        const grid = sourceState.grid;
        if (grid && !sourceState.watchStatus) {
            // Only move the visible native page worth of clones. The remaining clones
            // keep their relative order, so DOM work stays O(columns), not O(all items).
            for (let i = 0; i < ordered.length; i++) {
                const clone = sourceState.cloneMap?.get(itemKey(ordered[i]));
                if (!clone) continue;
                const targetIndex = insertion + i;
                const reference = grid.children[targetIndex] || null;
                if (reference !== clone) grid.insertBefore(clone, reference);
            }
        }
        reindexLegacyItemsAfterDelta();
        log(tLog('legacyVisibleOrderAligned'), {
            page: live.selectedPage,
            ids: nativeIds
        });
        return true;
    }

    function disposeMyListMutation(videoId, expected = null) {
        const key = String(videoId || '');
        const mutation = pendingMyListMutations.get(key);
        if (!mutation || (expected && mutation !== expected)) return;
        try { mutation.observer?.disconnect(); } catch (_) {}
        if (mutation.timeoutId !== null && mutation.timeoutId !== undefined) clearTimeout(mutation.timeoutId);
        pendingMyListMutations.delete(key);
    }

    function scheduleMyListMutationTimeout(mutation) {
        if (!mutation || pendingMyListMutations.get(mutation.videoId) !== mutation) return;
        if (mutation.timeoutId !== null && mutation.timeoutId !== undefined) clearTimeout(mutation.timeoutId);
        mutation.timeoutId = setTimeout(() => {
            if (pendingMyListMutations.get(mutation.videoId) !== mutation) return;
            mutation.timeoutId = null;

            const applied = tryApplyMyListMutation(mutation, 'observer-timeout');
            if (applied || pendingMyListMutations.get(mutation.videoId) !== mutation) return;
            if (running || responsiveRefreshing) {
                mutation.deferredWhileBusy = true;
                return;
            }

            warn(tLog('differentialUpdateTimedOutWaitingForAUsableCardSnapshot'), {
                seq: mutation.seq,
                videoId: mutation.videoId,
                action: mutation.action,
                timeoutMs: DELTA_MUTATION_TIMEOUT_MS
            });
            disposeMyListMutation(mutation.videoId, mutation);
        }, DELTA_MUTATION_TIMEOUT_MS);
    }

    function retryPendingMyListMutations(reason) {
        if (running || responsiveRefreshing || !isTargetPage()) return;

        for (const mutation of [...pendingMyListMutations.values()]) {
            if (!mutation.deferredWhileBusy) continue;
            mutation.deferredWhileBusy = false;
            const applied = tryApplyMyListMutation(mutation, reason);
            if (!applied && pendingMyListMutations.get(mutation.videoId) === mutation) {
                scheduleMyListMutationTimeout(mutation);
            }
        }
    }

    function clearPendingMyListMutations() {
        for (const [videoId, mutation] of [...pendingMyListMutations.entries()]) {
            disposeMyListMutation(videoId, mutation);
        }
        pendingMyListMutations = new Map();
    }

    function nativeBindingChanged(live) {
        if (!sourceState || !live?.section || !live?.scroller || !live?.track) return false;
        return sourceState.section !== live.section ||
            sourceState.scroller !== live.scroller ||
            sourceState.track !== live.track ||
            !sourceState.section?.isConnected ||
            !sourceState.scroller?.isConnected ||
            !sourceState.track?.isConnected;
    }

    function restartInitializationForPopulatedNativeMyList(live, reason = 'late-populated-source') {
        if (!sourceState?.empty || !live?.section || !live?.scroller || !live?.track) return false;
        const visibleItems = visibleNativeItems(live);
        if (!visibleItems.length) return false;

        log(tLog('populatedNativeMyListDetectedAfterEmpty'), {
            reason,
            pages: live.pages,
            selectedPage: live.selectedPage,
            visibleItems: visibleItems.length
        });

        const sessionToken = routeSessionToken;
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        completedSection = null;
        sourceState = null;
        waitingForNativeEmpty = false;
        missingSectionSince = 0;
        lastResponsiveSignature = '';
        lastPageShape = '';
        scheduleRun(0, sessionToken);
        return true;
    }

    function ensureLiveNativeBinding(reason = 'live-check', bindingOnly = false) {
        if (!sourceState || !isTargetPage()) return null;
        if (bindingOnly && !waitingForNativeEmpty && !sourceState.empty) {
            // Observer callbacks need element identity, not page geometry, React
            // indices, or counts when Netflix still owns the same mounted source.
            const section = findMyListSection();
            const scroller = section?.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) || null;
            const track = scroller && netflixDom.findTrack(scroller);
            const binding = { section, scroller, track };
            if (section && scroller && track && !nativeBindingChanged(binding)) return binding;
        }
        let live = readNativeMyListDomState();

        if (waitingForNativeEmpty && (sourceState.items?.length ?? 0) === 0) {
            if (live.section && !live.scroller && !live.track) {
                const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
                const alreadyNative = (
                    sourceState.section === live.section &&
                    !sourceState.scroller &&
                    !sourceState.track &&
                    emptyState?.getAttribute('data-tm-empty-source') === 'native'
                );
                if (!alreadyNative) adoptLiveEmptyMyListSection(live);
                live = readNativeMyListDomState();
                return live;
            }

            if (!live.section) {
                // During a 1 -> 0 transition Netflix can briefly remove the native My
                // List section before mounting its empty section. Do not insert our own
                // section into the React-managed sibling list; that can interfere with
                // Netflix's reconciliation and make the native empty frame disappear.
                return live;
            }

            // Netflix can leave the last native card mounted briefly after the click.
            // Do not re-adopt that stale populated carousel over the immediate 0-item
            // legacy presentation. The document observer will call us again as soon as
            // the native empty section replaces it.
            const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
            if (!emptyState?.isConnected) {
                syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
            }
            return live;
        }

        if (live.section && live.scroller && live.track &&
            sourceState.empty && (sourceState.items?.length ?? 0) === 0) {
            if (restartInitializationForPopulatedNativeMyList(live, reason)) return live;
        }

        if (live.section && live.scroller && live.track && nativeBindingChanged(live)) {
            const previous = {
                sectionConnected: Boolean(sourceState.section?.isConnected),
                scrollerConnected: Boolean(sourceState.scroller?.isConnected),
                trackConnected: Boolean(sourceState.track?.isConnected),
                sameSection: sourceState.section === live.section,
                sameScroller: sourceState.scroller === live.scroller,
                sameTrack: sourceState.track === live.track
            };
            if (adoptLiveMyListSection(live)) {
                log(tLog('nativeMyListBindingRefreshed'), {
                    reason,
                    pages: live.pages,
                    selectedPage: live.selectedPage,
                    previous
                });
            }
            live = readNativeMyListDomState();
        } else if (live.section && !live.scroller && !live.track && (sourceState.items?.length ?? 0) === 0) {
            const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
            const alreadyNative = (
                sourceState.section === live.section &&
                !sourceState.scroller &&
                !sourceState.track &&
                emptyState?.getAttribute('data-tm-empty-source') === 'native'
            );
            if (!alreadyNative) {
                adoptLiveEmptyMyListSection(live);
                live = readNativeMyListDomState();
            }
        } else if (!live.section && (sourceState.items?.length ?? 0) === 0 && sourceState.section?.id !== SYNTHETIC_SECTION_ID) {
            if (!waitingForNativeEmpty) {
                moveLegacyFrameToSyntheticEmpty();
                live = readNativeMyListDomState();
            }
        }
        return live;
    }

    function refreshNativeSectionAfterDelta() {
        return ensureLiveNativeBinding('delta-refresh');
    }

    function tryApplyMyListMutation(mutation, reason = 'event') {
        if (!mutation || pendingMyListMutations.get(mutation.videoId) !== mutation) return false;
        if (!sourceState || !isTargetPage()) return false;
        if (running || responsiveRefreshing || (nativeInitializationFailure?.sessionToken === routeSessionToken &&
            initializationBlockedSessionToken === routeSessionToken)) {
            mutation.deferredWhileBusy = true;
            return false;
        }
        mutation.deferredWhileBusy = false;

        const videoId = mutation.videoId;
        let live = refreshNativeSectionAfterDelta() || readNativeMyListDomState();

        if (mutation.action === 'remove') {
            const changed = applyLegacyRemoval(videoId, reason);
            if (!changed && !sourceState.itemMap?.has(`v:${videoId}`)) {
                disposeMyListMutation(videoId, mutation);
                return true;
            }
            if (changed) {
                live = refreshNativeSectionAfterDelta() || live;
                if (live?.track) alignLegacyVisiblePageOrder(live);
                disposeMyListMutation(videoId, mutation);
                return true;
            }
            return false;
        }

        if (sourceState.itemMap?.has(`v:${videoId}`)) {
            disposeMyListMutation(videoId, mutation);
            return true;
        }

        const nativeItem = findNativeMyListItemByVideoId(videoId, live);
        const candidate = nativeItem || mutation.fallbackItem || findAnyStandardCardItemByVideoId(videoId);
        if (!cardSourceForItem(candidate)) return false;

        const preferredIndex = nativeItem
            ? preferredIndexForNativeItem(videoId, live)
            : (Number.isFinite(mutation.preferredIndex) ? mutation.preferredIndex : 0);
        const changed = applyLegacyAddition(candidate, preferredIndex, nativeItem ? `${reason}-native` : `${reason}-captured`);
        if (changed || sourceState.itemMap?.has(`v:${videoId}`)) {
            live = refreshNativeSectionAfterDelta() || live;
            if (live?.track) alignLegacyVisiblePageOrder(live);
            disposeMyListMutation(videoId, mutation);
            return true;
        }
        return false;
    }

    function queueMyListMutation(descriptor) {
        if (!descriptor?.videoId || !sourceState) return;
        const videoId = String(descriptor.videoId);
        disposeMyListMutation(videoId);

        const fallbackItem = descriptor.action === 'add'
            ? (descriptor.fallbackItem || findAnyStandardCardItemByVideoId(videoId))
            : null;
        const seq = ++myListMutationSequence;
        const mutation = {
            seq,
            videoId,
            action: descriptor.action,
            uia: descriptor.uia || '',
            uiaAction: descriptor.uiaAction || 'unknown',
            source: 'user-click',
            detectedAt: performance.now(),
            fallbackItem,
            preferredIndex: Number.isFinite(descriptor.preferredIndex) ? Math.max(0, Math.floor(descriptor.preferredIndex)) : null,
            undo: Boolean(descriptor.undo),
            observer: null,
            timeoutId: null,
            deferredWhileBusy: false
        };
        pendingMyListMutations.set(videoId, mutation);

        // Register before Netflix handles the click. This catches synchronous React
        // mutations from every carousel and MiniModal without a periodic poll.
        const root = document.body || document.documentElement;
        if (root) {
            mutation.observer = new MutationObserver(() => {
                tryApplyMyListMutation(mutation, 'mutation-observer');
            });
            mutation.observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['data-uia', 'class', 'aria-label', 'href']
            });
        }

        // A one-shot timeout bounds ordinary waiting. If the script is busy,
        // defer disposal until the busy operation ends and retry then.
        scheduleMyListMutationTimeout(mutation);

        log(tLog('myListMutationQueued'), {
            seq,
            videoId,
            action: descriptor.action,
            uiaAction: descriptor.uiaAction || 'unknown',
            uia: descriptor.uia || '',
            syncMode: 'event-driven',
            undo: Boolean(mutation.undo),
            preferredIndex: mutation.preferredIndex,
            hasFallbackSnapshot: Boolean(cardSourceForItem(fallbackItem))
        });

        // Capture runs before Netflix's handler; a microtask runs after the click
        // dispatch completes. Most removals and visible-card additions finish here.
        queueMicrotask(() => {
            tryApplyMyListMutation(mutation, 'post-click');
        });
    }

    function handleObservedMyListToggleClick(event) {
        if (!isTargetPage() || !sourceState) return;
        const descriptor = describeMyListToggleClick(event) || describeMyListUndoClick(event);
        if (!descriptor) return;
        queueMyListMutation(descriptor);
    }

    function updateStatus(content) {
        let node = document.getElementById(STATUS_ID);
        if (!node) {
            node = document.createElement('div');
            node.id = STATUS_ID;
        }

        let textNode = node.querySelector(`.${STATUS_TEXT_CLASS}`);
        if (!textNode) {
            textNode = document.createElement('span');
            textNode.className = STATUS_TEXT_CLASS;
            node.appendChild(textNode);
        }

        let labelNode = textNode.querySelector(`.${STATUS_LABEL_CLASS}`);
        if (!labelNode) {
            labelNode = document.createElement('span');
            labelNode.className = STATUS_LABEL_CLASS;
            textNode.appendChild(labelNode);
        }

        let metaNode = textNode.querySelector(`.${STATUS_META_CLASS}`);
        if (!metaNode) {
            metaNode = document.createElement('span');
            metaNode.className = STATUS_META_CLASS;
            textNode.appendChild(metaNode);
        }

        const label = content && typeof content === 'object' ? content.label || '' : String(content ?? '');
        const meta = content && typeof content === 'object' ? content.meta || '' : '';
        if (labelNode.textContent !== label) labelNode.textContent = label;
        if (metaNode.textContent !== meta) metaNode.textContent = meta;

        let link = node.querySelector(`#${LOG_LINK_ID}`);
        if (!link) {
            link = document.createElement('a');
            link.id = LOG_LINK_ID;
            link.href = '#';
            link.textContent = 'CopyLogs';
            link.title = copyLogsTooltip();
            link.addEventListener('click', handleLogClick);
            node.appendChild(link);
        }

        return node;
    }

    function hideOrderMismatchDialog() {
        document.getElementById(ORDER_MISMATCH_DIALOG_ID)?.remove();
        orderMismatchDialogOpen = false;
    }

    function resetOrderMismatchStateAfterInitialization() {
        hideOrderMismatchDialog();
        orderMismatchDismissed = false;
        orderMismatchReinitializing = false;
    }

    async function reinitializeAfterOrderMismatch() {
        if (orderMismatchReinitializing || running || !isTargetPage() || !targetSessionActive) return;
        const sessionToken = routeSessionToken;
        orderMismatchReinitializing = true;
        orderMismatchDismissed = true;
        hideOrderMismatchDialog();

        hoverToken++;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;

        log(tLog('manualReinitializationRequested'), {
            selectedPage: sourceState?.section ? selectedPage(sourceState.section) : null,
            items: sourceState?.items?.length ?? null
        });

        try {
            try { await Promise.resolve(responsiveRefreshPromise); } catch (_) {}
            try { await carouselMoveQueue; } catch (_) {}
            if (!isRouteSessionActive(sessionToken)) return;

            // Reinitialization must begin from Netflix's first native My List page.
            // Keep the current source state alive until page 0 is confirmed so the
            // logical carousel can still resolve its native page number correctly.
            const section = sourceState?.section;
            const scroller = sourceState?.scroller;
            if (!section?.isConnected || !scroller?.isConnected) {
                throw initializationError(
                    'REINITIALIZATION_SOURCE_UNAVAILABLE',
                    'return-native-my-list-to-start',
                    'The native My List carousel is unavailable before reinitialization'
                );
            }

            const fromPage = selectedPage(section);
            const returnedPage = await goToPage(section, scroller, 0, null, sessionToken);
            assertRouteSession(sessionToken);
            if (returnedPage !== 0 || selectedPage(section) !== 0) {
                throw initializationError(
                    'REINITIALIZATION_START_PAGE_NOT_REACHED',
                    'return-native-my-list-to-start',
                    'Could not return the native My List carousel to the first page',
                    { fromPage, returnedPage, selectedPage: selectedPage(section) }
                );
            }

            // Fully discard the existing My List for Netflix session using the same
            // teardown path as a route leave, then start a fresh normal session.
            suspendTargetSession('order-mismatch-reinitialize');
            if (!isTargetPage()) return;
            startTargetSession('order-mismatch-reinitialize');
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                orderMismatchDismissed = false;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || 'order-mismatch-reinitialize',
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, sourceState?.totalCount ?? null));
            }
        } finally {
            orderMismatchReinitializing = false;
        }
    }

    function showOrderMismatchDialog(item, expectedPage, visibleIds = []) {
        if (orderMismatchDismissed || orderMismatchDialogOpen || orderMismatchReinitializing) return;

        orderMismatchDialogOpen = true;
        const dialog = document.createElement('div');
        dialog.id = ORDER_MISMATCH_DIALOG_ID;
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'false');
        dialog.setAttribute('aria-label', tUi('orderChangedPrompt'));

        const message = document.createElement('div');
        message.setAttribute('data-tm-order-message', 'true');
        message.textContent = tUi('orderChangedPrompt');

        const actions = document.createElement('div');
        actions.setAttribute('data-tm-order-actions', 'true');

        const okButton = document.createElement('button');
        okButton.type = 'button';
        okButton.setAttribute('data-tm-order-ok', 'true');
        okButton.textContent = tUi('orderChangedOk');

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.setAttribute('data-tm-order-cancel', 'true');
        cancelButton.textContent = tUi('orderChangedCancel');

        okButton.addEventListener('click', () => {
            log(tLog('orderMismatchPromptAccepted'), {
                item: itemSummary(item),
                expectedPage,
                visibleIds
            });
            void reinitializeAfterOrderMismatch();
        }, { once: true });

        cancelButton.addEventListener('click', () => {
            orderMismatchDismissed = true;
            hideOrderMismatchDialog();
            log(tLog('orderMismatchPromptCancelled'), {
                item: itemSummary(item),
                expectedPage,
                visibleIds
            });
        }, { once: true });

        actions.append(okButton, cancelButton);
        dialog.append(message, actions);
        (document.body || document.documentElement).appendChild(dialog);

        log(tLog('orderMismatchPromptShown'), {
            item: itemSummary(item),
            expectedPage,
            visibleIds
        });
    }

    function syncStatusTypography(section, status) {
        const heading = section?.querySelector('h2') || document.querySelector(`${NETFLIX_DOM_SELECTORS.browseSections} section h2`);
        if (!heading || !status) return;

        const style = getComputedStyle(heading);
        for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']) {
            const value = style.getPropertyValue(property);
            if (value) status.style.setProperty(property, value);
        }
        status.style.color = style.color || 'rgb(255, 255, 255)';
    }

    function detectCarouselDomProfile(section) {
        if (section && nativeReadScope?.profiles.has(section)) return nativeReadScope.profiles.get(section);
        const legacyLeft = section?.querySelector?.('[data-uia="carousel-left-button"]') || null;
        const legacyRight = section?.querySelector?.('[data-uia="carousel-right-button"]') || null;
        const hawkinsLeft = section?.querySelector?.('[data-uia="carousel-hawkins-left-button"]') || null;
        const hawkinsRight = section?.querySelector?.('[data-uia="carousel-hawkins-right-button"]') || null;
        const indicatorItems = nativeIndicatorItems(section);
        const legacyControls = Boolean(legacyLeft || legacyRight);
        const hawkinsControls = Boolean(hawkinsLeft || hawkinsRight);
        const generation = legacyControls && hawkinsControls
            ? 'hybrid'
            : legacyControls
                ? 'generation1'
                : hawkinsControls
                    ? 'generation2'
                    : 'unknown';
        const navigationMode = legacyControls ? 'legacy' : (hawkinsControls ? 'hawkins' : 'none');
        const pageMode = legacyControls && indicatorItems.length > 0 ? 'indicator' :
            ((legacyControls || hawkinsControls) ? 'logical' : 'unknown');
        const profile = {
            generation,
            navigationMode,
            pageMode,
            capabilities: {
                legacyControls,
                hawkinsControls,
                pageIndicators: indicatorItems.length > 0,
                selectedIndicator: indicatorItems.some(x => x.getAttribute('data-indicator-selected') === 'true'),
                virtualSlots: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.virtualSlot)),
                standardCards: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard))
            },
            indicatorCount: indicatorItems.length
        };
        if (section && nativeReadScope) nativeReadScope.profiles.set(section, profile);
        return profile;
    }

    function getCarouselDomRuntime(section) {
        if (!section) return null;
        let state = carouselDomRuntime.get(section);
        if (!state) {
            state = {
                profile: detectCarouselDomProfile(section),
                currentPage: 0,
                knownPageCount: null,
                pageCountFinalized: false,
                cycleDetected: false,
                pageMappingStale: false,
                signatureToPage: new Map(),
                pageToSignature: new Map(),
                profileLogSignature: ''
            };
            carouselDomRuntime.set(section, state);
        } else {
            state.profile = detectCarouselDomProfile(section);
        }
        return state;
    }

    function resetCarouselDomRuntime(section) {
        if (!section) return null;
        invalidateNativeReadScope();
        carouselDomRuntime.delete(section);
        return getCarouselDomRuntime(section);
    }

    function carouselDomProfileSummary(section) {
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return null;
        return {
            generation: runtime.profile.generation,
            navigationMode: runtime.profile.navigationMode,
            pageMode: runtime.profile.pageMode,
            indicatorCount: runtime.profile.indicatorCount,
            knownPageCount: runtime.knownPageCount,
            pageCountFinalized: Boolean(runtime.pageCountFinalized),
            cycleDetected: Boolean(runtime.cycleDetected),
            pageMappingStale: Boolean(runtime.pageMappingStale),
            logicalPage: runtime.currentPage,
            capabilities: { ...runtime.profile.capabilities }
        };
    }

    function logCarouselDomProfile(section, reason = 'unknown') {
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return;
        const summary = carouselDomProfileSummary(section);
        const signature = JSON.stringify(summary);
        if (signature === runtime.profileLogSignature) return;
        runtime.profileLogSignature = signature;
        log(tLog('carouselDomProfileDetected'), { reason, ...summary });
    }

    function logicalVisibleSignature(section) {
        const scroller = sourceState?.scroller?.isConnected
            ? sourceState.scroller
            : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = sourceState?.track?.isConnected ? sourceState.track : (scroller && netflixDom.findTrack(scroller));
        if (!scroller || !track) return '';
        return visibleSignature(currentPageSlots(scroller, track));
    }

    function registerLogicalPageSignature(section, signature, page = null) {
        if (!section || !signature) return null;
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return null;

        if (runtime.signatureToPage.has(signature)) {
            const existing = runtime.signatureToPage.get(signature);
            runtime.currentPage = existing;
            return existing;
        }

        const resolvedPage = Number.isFinite(page) ? Math.max(0, page) : Math.max(0, runtime.currentPage);
        const previousSignature = runtime.pageToSignature.get(resolvedPage);
        if (previousSignature && previousSignature !== signature) {
            runtime.signatureToPage.delete(previousSignature);
        }
        runtime.signatureToPage.set(signature, resolvedPage);
        runtime.pageToSignature.set(resolvedPage, signature);
        runtime.currentPage = resolvedPage;
        return resolvedPage;
    }

    function normalizeLogicalPages(section) {
        const runtime = getCarouselDomRuntime(section);
        if (!runtime || !runtime.signatureToPage.size) return 0;
        const pages = [...runtime.signatureToPage.values()].filter(Number.isFinite);
        if (!pages.length) return 0;
        const minimum = Math.min(...pages);
        if (minimum === 0) return 0;
        const shifted = new Map();
        for (const [signature, page] of runtime.signatureToPage.entries()) {
            shifted.set(signature, page - minimum);
        }
        runtime.signatureToPage = shifted;
        runtime.pageToSignature = new Map([...shifted.entries()].map(([signature, page]) => [page, signature]));
        runtime.currentPage = Math.max(0, runtime.currentPage - minimum);
        return -minimum;
    }

    function selectedPage(section) {
        if (!nativeReadScope) return withNativeReadScope(() => selectedPage(section));
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            const items = nativeIndicatorItems(section);
            const index = items.findIndex(x => x.getAttribute('data-indicator-selected') === 'true');
            return index >= 0 ? index : 0;
        }
        if (profile.pageMode === 'logical' && runtime) {
            const scroller = sourceState?.section === section && sourceState?.scroller?.isConnected
                ? sourceState.scroller
                : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
            const track = sourceState?.section === section && sourceState?.track?.isConnected
                ? sourceState.track
                : (scroller && netflixDom.findTrack(scroller));
            const totalCount = sourceState?.section === section ? sourceState?.totalCount : null;
            const columns = sourceState?.section === section
                ? Math.max(1, sourceState?.layout?.columns || 1)
                : 0;
            if (scroller && track && Number.isFinite(totalCount) && totalCount > 0 && columns > 0) {
                const nativeState = nativeLogicalPageState(scroller, track, totalCount, columns);
                if (Number.isFinite(nativeState.page)) {
                    const signature = visibleSignature(nativeState.slots);
                    if (signature) forceLogicalPageSignature(section, signature, nativeState.page);
                    runtime.currentPage = nativeState.page;
                    return runtime.currentPage;
                }
            }
            const signature = logicalVisibleSignature(section);
            if (signature && runtime.signatureToPage.has(signature)) {
                runtime.currentPage = runtime.signatureToPage.get(signature);
            }
            return runtime.currentPage;
        }
        return 0;
    }

    function pageCount(section) {
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            return nativeIndicatorItems(section).length || 1;
        }
        if (profile.pageMode === 'logical' && runtime) {
            if (runtime.pageCountFinalized && Number.isFinite(runtime.knownPageCount)) {
                return Math.max(1, runtime.knownPageCount);
            }
            const knownPages = [...runtime.signatureToPage.values()].filter(Number.isFinite);
            if (knownPages.length) return Math.max(1, Math.max(...knownPages) + 1);
        }
        return 1;
    }

    function carouselMoveButton(section, scroller, direction) {
        const profile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);
        const side = direction < 0 ? 'left' : 'right';
        const selectors = profile.navigationMode === 'legacy'
            ? [`[data-uia="carousel-${side}-button"]`, `[data-uia="carousel-hawkins-${side}-button"]`]
            : [`[data-uia="carousel-hawkins-${side}-button"]`, `[data-uia="carousel-${side}-button"]`];
        for (const selector of selectors) {
            const button = scroller?.querySelector?.(selector) || section?.querySelector?.(selector);
            if (button) return { button, selector };
        }
        return { button: null, selector: selectors.join(' | ') };
    }

    function carouselMoveButtonDisabled(button) {
        if (!button) return false;
        return button.disabled === true ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.getAttribute('tabindex') === '-1';
    }

    async function waitLogicalPageChange(section, scroller, track, beforePage, direction, beforeTransform, beforeSignature, timeout = PAGE_CHANGE_TIMEOUT_MS, sessionToken = null, token = null) {
        const runtime = getCarouselDomRuntime(section);
        const started = performance.now();
        let lastTransform = beforeTransform;
        let lastSignature = beforeSignature;
        while (performance.now() - started < timeout) {
            // A click cannot be undone. Keep its acknowledgement serialized, but
            // stop spending every animation frame on an obsolete hover request.
            if (hoverPreparationCancelled(token)) await sleep(CANCELLED_MOVE_POLL_MS);
            else await new Promise(resolve => requestAnimationFrame(resolve));
            assertRouteSession(sessionToken);
            const transform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
            const signature = visibleSignature(currentPageSlots(scroller, track));
            const signatureChanged = Boolean(signature) && signature !== beforeSignature;
            lastTransform = transform;
            lastSignature = signature;
            if (!signatureChanged) continue;

            const existingPage = runtime?.signatureToPage.get(signature);
            const proposedPage = Math.max(0, beforePage + (direction < 0 ? -1 : 1));
            const mapped = Number.isFinite(existingPage)
                ? existingPage
                : registerLogicalPageSignature(section, signature, proposedPage);
            if (runtime) {
                runtime.currentPage = mapped;
                runtime.cycleDetected = Number.isFinite(existingPage) && existingPage !== beforePage;
            }
            return {
                page: mapped,
                changed: true,
                transform,
                signature,
                transformChanged: transform !== beforeTransform,
                signatureChanged: true,
                cycleDetected: Boolean(runtime?.cycleDetected)
            };
        }
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) {
            return { page: beforePage, changed: false, transform: lastTransform, signature: lastSignature };
        }
        const details = {
            direction: direction < 0 ? 'left' : 'right',
            beforePage,
            beforeTransform,
            lastTransform,
            beforeSignature,
            lastSignature,
            domGeneration: runtime?.profile?.generation || null,
            navigationMode: runtime?.profile?.navigationMode || null,
            pageMode: runtime?.profile?.pageMode || null
        };
        logOperationTimeout('logical-page-change', timeout, details);
        throw initializationTimeoutError('logical-page-change', timeout, details);
    }

    async function waitPageByPolling(section, before, timeout, sessionToken = null, token = null) {
        const start = performance.now();
        while (performance.now() - start < timeout) {
            await sleep(hoverPreparationCancelled(token) ? CANCELLED_MOVE_POLL_MS : 12);
            assertRouteSession(sessionToken);
            const now = selectedPage(section);
            if (now !== before) return now;
        }
        assertRouteSession(sessionToken);
        return selectedPage(section);
    }

    async function waitPage(section, before, timeout = PAGE_CHANGE_TIMEOUT_MS, sessionToken = null, token = null) {
        assertRouteSession(sessionToken);
        const immediate = selectedPage(section);
        if (immediate !== before) return immediate;
        if (timeout <= 0) return immediate;

        // Page-indicator mutations are the primary signal. A short legacy polling
        // window remains as a fallback in case Netflix changes the indicator in a
        // way that does not trigger the expected mutation record.
        if (typeof MutationObserver !== 'function') {
            return waitPageByPolling(section, before, timeout, sessionToken, token);
        }

        const started = performance.now();
        const observerBudget = Math.min(timeout, PAGE_CHANGE_OBSERVER_PRIMARY_MS);
        const observedPage = await new Promise(resolve => {
            let observer = null;
            let timer = null;
            let finished = false;

            const finish = value => {
                if (finished) return;
                finished = true;
                if (timer !== null) clearTimeout(timer);
                observer?.disconnect();
                resolve(value);
            };

            const check = () => {
                const now = selectedPage(section);
                if (now !== before) finish(now);
            };

            observer = new MutationObserver(check);
            observer.observe(section, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['data-indicator-selected']
            });

            check();
            timer = setTimeout(() => finish(null), observerBudget);
        });

        assertRouteSession(sessionToken);
        if (observedPage !== null) return observedPage;

        const elapsed = performance.now() - started;
        const remaining = Math.max(0, timeout - elapsed);
        return waitPageByPolling(section, before, remaining, sessionToken, token);
    }

    function captureInlineStyleProperty(element, property) {
        return {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
        };
    }

    function restoreInlineStyleProperty(element, property, saved) {
        if (!saved.value) {
            element.style.removeProperty(property);
            return;
        }
        element.style.setProperty(property, saved.value, saved.priority || '');
    }

    async function waitForScriptMoveSettle(scroller, track, beforeTransform, beforeSignature, timeout = SCRIPT_MOVE_SETTLE_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        let currentTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
        let currentSignature = visibleSignature(currentPageSlots(scroller, track));
        let observedChange = currentTransform !== beforeTransform ||
            (Boolean(beforeSignature) && Boolean(currentSignature) && currentSignature !== beforeSignature);
        let stableFrames = 0;
        let previousSignature = currentSignature;

        while (performance.now() - started < timeout) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            assertRouteSession(sessionToken);
            currentTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
            currentSignature = visibleSignature(currentPageSlots(scroller, track));

            if (currentTransform !== beforeTransform ||
                (Boolean(beforeSignature) && Boolean(currentSignature) && currentSignature !== beforeSignature)) {
                observedChange = true;
            }

            if (observedChange && currentSignature && currentSignature === previousSignature) {
                stableFrames++;
                if (stableFrames >= 2) break;
            } else {
                stableFrames = 0;
            }
            previousSignature = currentSignature;
        }

        // Keep suppression through one additional paint opportunity after the native
        // content settles so a deferred Netflix transform write cannot animate.
        await new Promise(resolve => requestAnimationFrame(resolve));
        assertRouteSession(sessionToken);
        return {
            transform: currentTransform,
            signature: currentSignature,
            observedChange
        };
    }

    async function moveOnePage(section, scroller, direction, token = null, sessionToken = null) {
        const hoverTiming = token === null ? null : performanceDiagnostics.hoverTiming;
        const queueStarted = hoverTiming ? performance.now() : 0;
        let moveStarted = null;
        const previousMove = carouselMoveQueue;
        let releaseMove;
        carouselMoveQueue = new Promise(resolve => { releaseMove = resolve; });

        try {
            await previousMove.catch(() => {});
            if (hoverTiming) recordHoverTiming(hoverTiming, 'queue', queueStarted);
            assertRouteSession(sessionToken);

            if (token !== null && token !== hoverToken) {
                log(tLog('carouselMoveCancelledBeforeStart'), {
                    token,
                    hoverToken,
                    direction: direction < 0 ? 'left' : 'right',
                    selectedPage: selectedPage(section)
                });
                return selectedPage(section);
            }

            const seq = ++pageMoveSequence;
            const before = selectedPage(section);
            const runtime = getCarouselDomRuntime(section);
            const profile = runtime?.profile || detectCarouselDomProfile(section);
            const { button, selector } = carouselMoveButton(section, scroller, direction);
            const track = sourceState?.track?.isConnected ? sourceState.track : netflixDom.findTrack(scroller);
            if (!button || !track) {
                warn(tLog('carouselMoveControlNotFound'), {
                    seq,
                    direction,
                    before,
                    selector,
                    buttonFound: Boolean(button),
                    trackFound: Boolean(track)
                });
                return before;
            }

            if (profile.pageMode === 'logical' && carouselMoveButtonDisabled(button)) {
                return before;
            }

            const started = performance.now();
            moveStarted = started;
            const beforeTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
            const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
            const sharedFastMode = section.classList.contains(FAST_MOVE_CLASS);
            const savedTransition = sharedFastMode ? null : captureInlineStyleProperty(track, 'transition');
            const savedAnimation = sharedFastMode ? null : captureInlineStyleProperty(track, 'animation');
            let after = before;
            let afterTransform = beforeTransform;
            let afterSignature = beforeSignature;
            let settleObservedChange = false;

            log(tLog('carouselMoveStarted'), {
                seq,
                direction: direction < 0 ? 'left' : 'right',
                before,
                pages: pageCount(section),
                animationDisabled: true,
                sharedFastMode,
                beforeTransform,
                nativeTransition: sharedFastMode ? 'suppressed-by-scan' : savedTransition.value,
                token
            });

            const restoreMoveStyles = () => {
                if (sharedFastMode) return;
                section.classList.remove(FAST_MOVE_CLASS);
                restoreInlineStyleProperty(track, 'transition', savedTransition);
                restoreInlineStyleProperty(track, 'animation', savedAnimation);
                void track.offsetWidth;
            };

            try {
                if (!sharedFastMode) {
                    // Use both a temporary CSS override and inline suppression. The CSS class
                    // remains effective even if Netflix rewrites the track style during React updates.
                    section.classList.add(FAST_MOVE_CLASS);
                    track.style.setProperty('transition', 'none', 'important');
                    track.style.setProperty('animation', 'none', 'important');
                    void track.offsetWidth;
                    registerActiveCarouselStyleCleanup(restoreMoveStyles);
                }

                assertRouteSession(sessionToken);
                button.click();
                if (profile.pageMode === 'logical') {
                    const logicalMove = await waitLogicalPageChange(
                        section,
                        scroller,
                        track,
                        before,
                        direction,
                        beforeTransform,
                        beforeSignature,
                        PAGE_CHANGE_TIMEOUT_MS,
                        sessionToken,
                        token
                    );
                    after = logicalMove.page;
                    afterTransform = logicalMove.transform;
                    afterSignature = logicalMove.signature;
                    settleObservedChange = logicalMove.changed;
                } else {
                    after = await waitPage(section, before, PAGE_CHANGE_TIMEOUT_MS, sessionToken, token);
                }
                assertRouteSession(sessionToken);
                if (sharedFastMode) {
                    // Logical moves already wait until Netflix exposes the new logical page.
                    // The caller immediately runs waitStableCurrentPage(), so another frame
                    // here duplicates that stabilization. Keep the frame for indicator mode,
                    // whose waitPage() only observes the selected indicator.
                    if (profile.pageMode !== 'logical') {
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        assertRouteSession(sessionToken);
                    }
                    afterTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
                    afterSignature = visibleSignature(currentPageSlots(scroller, track));
                    settleObservedChange = settleObservedChange || after !== before;
                } else {
                    const settled = await waitForScriptMoveSettle(scroller, track, beforeTransform, beforeSignature, SCRIPT_MOVE_SETTLE_TIMEOUT_MS, sessionToken);
                    afterTransform = settled.transform;
                    afterSignature = settled.signature;
                    settleObservedChange = settled.observedChange;
                }
            } finally {
                restoreMoveStyles();
                unregisterActiveCarouselStyleCleanup(restoreMoveStyles);
            }

            log(tLog('carouselMoveCompleted'), {
                seq,
                direction: direction < 0 ? 'left' : 'right',
                before,
                after,
                changed: after !== before,
                transformChanged: afterTransform !== beforeTransform,
                contentChanged: Boolean(beforeSignature) && Boolean(afterSignature) && afterSignature !== beforeSignature,
                settleObservedChange,
                sharedFastMode,
                beforeTransform,
                afterTransform,
                elapsedMs: Math.round(performance.now() - started),
                animationRestored: sharedFastMode ? false : (!section.classList.contains(FAST_MOVE_CLASS) &&
                    track.style.getPropertyValue('transition') === savedTransition.value &&
                    track.style.getPropertyPriority('transition') === savedTransition.priority),
                token
            });
            return after;
        } finally {
            if (hoverTiming && moveStarted !== null) recordHoverTiming(hoverTiming, 'move', moveStarted);
            releaseMove();
        }
    }

    async function goToPage(section, scroller, target, token = null, sessionToken = null, preferCyclicShortest = false) {
        assertRouteSession(sessionToken);
        const total = pageCount(section);
        target = Math.max(0, Math.min(total - 1, target));
        const startPage = selectedPage(section);
        const profile = getCarouselDomRuntime(section)?.profile;
        const cyclicShortestUsed = preferCyclicShortest &&
            !(profile?.navigationMode === 'hawkins' && profile.pageMode === 'logical');
        if (preferCyclicShortest && !cyclicShortestUsed && startPage !== target) {
            const rightDistance = (target - startPage + total) % total;
            const leftDistance = (startPage - target + total) % total;
            if ((rightDistance <= leftDistance ? 1 : -1) !== (startPage < target ? 1 : -1)) {
                performanceDiagnostics.hoverLifecycle.boundaryDetoursAvoided++;
            }
        }

        if (startPage !== target) {
            log(tLog('pageMoveRequested'), { from: startPage, target, total, token, preferCyclicShortest, cyclicShortestUsed });
        }

        let guard = total + 5;
        let cancelled = false;
        let forcedDirection = null;
        let pageChangeRetryCount = 0;
        while (selectedPage(section) !== target && guard-- > 0) {
            assertRouteSession(sessionToken);
            if (token !== null && token !== hoverToken) {
                cancelled = true;
                break;
            }
            const current = selectedPage(section);
            let direction = forcedDirection ?? (current < target ? 1 : -1);
            if (forcedDirection === null && cyclicShortestUsed && total > 1) {
                const rightDistance = (target - current + total) % total;
                const leftDistance = (current - target + total) % total;
                if (rightDistance !== 0 || leftDistance !== 0) {
                    direction = rightDistance <= leftDistance ? 1 : -1;
                }
            }
            let next;
            try {
                next = await moveOnePage(section, scroller, direction, token, sessionToken);
                pageChangeRetryCount = 0;
            } catch (error) {
                if (isRouteSessionCancelledError(error)) throw error;
                if (error?.code === 'INITIALIZATION_TIMEOUT' && pageChangeRetryCount < 1) {
                    pageChangeRetryCount++;
                    log('Retrying logical page move after transient timeout', {
                        current,
                        target,
                        direction: direction < 0 ? 'left' : 'right',
                        token
                    });
                    await sleep(120);
                    continue;
                }
                throw error;
            }
            assertRouteSession(sessionToken);
            if (token !== null && token !== hoverToken) {
                cancelled = true;
                break;
            }
            if (next === current && cyclicShortestUsed && total > 1) {
                // Preserve a direct fallback for other/unknown carousel profiles
                // whose requested cyclic step turns out to stop at an edge.
                const directDirection = current < target ? 1 : -1;
                if (directDirection !== direction) {
                    log('Logical page boundary fallback', {
                        current,
                        target,
                        attemptedDirection: direction < 0 ? 'left' : 'right',
                        fallbackDirection: directDirection < 0 ? 'left' : 'right',
                        token
                    });
                    const retried = await moveOnePage(section, scroller, directDirection, token, sessionToken);
                    assertRouteSession(sessionToken);
                    if (token !== null && token !== hoverToken) {
                        cancelled = true;
                        break;
                    }
                    if (retried !== current) {
                        // Keep using the direct direction after the boundary
                        // fallback; recomputing the cyclic shortest direction
                        // would oscillate between the two edge pages.
                        forcedDirection = directDirection;
                        continue;
                    }
                }
                break;
            }
            if (next === current) break;
        }

        const result = selectedPage(section);
        if (startPage !== target || result !== target || cancelled) {
            log(tLog('pageMoveResult'), {
                from: startPage,
                target,
                result,
                reached: result === target,
                cancelled,
                token,
                hoverToken,
                preferCyclicShortest,
                cyclicShortestUsed,
                guardRemaining: guard
            });
        }
        return result;
    }

    function currentPageSlots(scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => currentPageSlots(scroller, track));
        let byTrack = nativeReadScope.slots.get(scroller);
        if (!byTrack) nativeReadScope.slots.set(scroller, byTrack = new WeakMap());
        if (byTrack.has(track)) return byTrack.get(track);
        const all = nativeFilledSlots(track);
        if (!all.length) {
            byTrack.set(track, []);
            return byTrack.get(track);
        }

        const sr = nativeRect(scroller);
        const visible = all
            .map(slot => ({ slot, rect: nativeRect(slot) }))
            .filter(x => {
                const cx = x.rect.left + x.rect.width / 2;
                return x.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            })
            .sort((a, b) => a.rect.left - b.rect.left)
            .map(x => x.slot);

        const active = all.filter(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.getAttribute('tabindex') === '0';
        });
        let current = visible;
        if (active.length) {
            // During Hawkins virtual-window hydration Netflix can leave only
            // the first card tabbable while the remaining visible cards exist.
            // Prefer the complete geometric viewport window in that state.
            if (visible.length <= active.length) current = active.sort((a, b) => nativeRect(a).left - nativeRect(b).left);
        }

        byTrack.set(track, current);
        return current;
    }

    function visibleSignature(slots) {
        return slots.map(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.href || card?.getAttribute('href') || '';
        }).filter(Boolean).join('|');
    }

    function nativeCarouselReadiness(section, scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeCarouselReadiness(section, scroller, track));
        const slots = netflixDom.directSlots(track);
        const cards = nativeFilledSlots(track);
        const currentSlots = currentPageSlots(scroller, track);
        const pages = pageCount(section);
        const formula = parseSlotLayoutFormula(track);
        const columns = Math.max(1, formula?.columns || currentSlots.length || cards.length || 1);
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const leftControl = carouselMoveButton(section, scroller, -1).button;
        const rightControl = carouselMoveButton(section, scroller, 1).button;
        const controlsPresent = Boolean(leftControl || rightControl);
        const controlsEnabled =
            leftControl?.getAttribute('tabindex') === '0' ||
            rightControl?.getAttribute('tabindex') === '0';
        const inlineTransform = track.style.getPropertyValue('transform') || '';
        const inlineDisplay = track.style.getPropertyValue('display') || '';
        const inlineWillChange = track.style.getPropertyValue('will-change') || '';
        const trackInitialized =
            inlineDisplay === 'flex' ||
            (inlineTransform && inlineTransform !== 'none') ||
            /\btransform\b/i.test(inlineWillChange);
        const signature = [
            pages,
            slots.length,
            cards.length,
            currentSlots.length,
            columns,
            controlsPresent ? 1 : 0,
            controlsEnabled ? 1 : 0,
            trackInitialized ? 1 : 0,
            profile.generation,
            profile.navigationMode,
            profile.pageMode,
            visibleSignature(currentSlots)
        ].join('||');

        return {
            connected: section.isConnected && scroller.isConnected && track.isConnected,
            pages,
            slots: slots.length,
            cards: cards.length,
            currentCards: currentSlots.length,
            columns,
            controlsPresent,
            controlsEnabled,
            trackInitialized,
            domGeneration: profile.generation,
            navigationMode: profile.navigationMode,
            pageMode: profile.pageMode,
            capabilities: { ...profile.capabilities },
            signature
        };
    }

    function readMountedSinglePageMembership(section, scroller, track) {
        if (!section || !scroller || !track) return null;
        return withNativeReadScope(() => {
            const state = nativeCarouselReadiness(section, scroller, track);
            const countState = nativeReactCarouselTotalCount(scroller, track);
            const totalCount = countState.totalCount;
            const slots = currentPageSlots(scroller, track);
            const itemIndices = slots.map(netflixItemIndexFromSlot);
            const videoIds = slots.map(nativeCardIdentity).filter(Boolean);
            if (!state.connected || state.pageMode !== 'logical' || state.pages !== 1 ||
                !Number.isSafeInteger(totalCount) || totalCount <= 0 || totalCount > state.columns ||
                state.slots !== totalCount || state.cards !== totalCount || state.currentCards !== totalCount ||
                countState.slots !== totalCount || countState.uniqueReadings.length !== 1 ||
                countState.uniqueReadings[0] !== totalCount || itemIndices.length !== totalCount ||
                !itemIndices.every((value, index) => value === index) || videoIds.length !== slots.length ||
                new Set(videoIds).size !== videoIds.length) return null;
            const signature = [totalCount, state.signature, itemIndices.join(','), videoIds.join('|')].join('||');
            return { state, totalCount, slots, itemIndices, videoIds, signature };
        });
    }

    function collectMountedSinglePageItems(bootstrap, totalCount, columns, sessionToken = null) {
        assertRouteSession(sessionToken);
        const proof = bootstrap.mountedSinglePageProof;
        if (!proof || targetSessionEntryKind !== 'spa' || !targetSessionReason.startsWith('route:') ||
            !isRouteSessionActive(proof.sessionToken) || proof.sessionToken !== routeSessionToken ||
            bootstrap.totalCount !== totalCount || !Number.isSafeInteger(columns) || totalCount > columns) {
            return { items: null, reason: 'proof-or-entry-no-longer-valid' };
        }
        const { section, scroller, track } = proof;
        if (sourceState?.section !== section || sourceState.scroller !== scroller || sourceState.track !== track ||
            findMyListSection() !== section || section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) !== scroller ||
            netflixDom.findTrack(scroller) !== track) return { items: null, reason: 'native-source-replaced' };
        return withNativeReadScope(() => {
            const sample = readMountedSinglePageMembership(section, scroller, track);
            if (!sample || sample.totalCount !== totalCount || sample.signature !== proof.signature) {
                return { items: null, reason: 'native-membership-or-layout-changed' };
            }
            // Validate every identity before capturing native variants in the
            // same synchronous sample. No navigation or await is needed here.
            const items = sample.slots.map(slot => itemFromSlot(slot, 0, false));
            if (!items.every((item, index) => item?.videoId === sample.videoIds[index])) {
                return { items: null, reason: 'native-card-metadata-incomplete' };
            }
            items.forEach((item, index) => { item.snapshot = sample.slots[index].cloneNode(true); });
            return { items, reason: null };
        });
    }

    async function tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken = null) {
        assertRouteSession(sessionToken);

        // Only a normal SPA route entry may bypass the fresh-network bootstrap.
        // Manual order-mismatch reinitialization must keep the authoritative fresh
        // first-item check because it may start from a shifted native window.
        if (targetSessionEntryKind !== 'spa' || !targetSessionReason.startsWith('route:')) return null;
        if (!section || !scroller || !track) return null;

        const started = performance.now();
        let previousSignature = '';

        // Require two frame-separated identical samples. More importantly, require
        // Netflix's mounted React metadata to agree on totalCount and itemIndex 0..N-1.
        // A transient partial window from a larger list therefore cannot qualify.
        for (let sample = 0; sample < 2; sample++) {
            assertRouteSession(sessionToken);
            const membership = readMountedSinglePageMembership(section, scroller, track);
            if (!membership) return null;
            const { state, totalCount, itemIndices, videoIds, signature } = membership;
            if (previousSignature && signature === previousSignature) {
                const result = {
                    totalCount,
                    firstVideoId: videoIds[0] || null,
                    source: 'mounted-single-page-fast-path',
                    elapsedMs: Math.round(performance.now() - started),
                    mountedSinglePageProof: { section, scroller, track, signature, sessionToken: routeSessionToken }
                };
                log('Mounted single-page My List fast bootstrap confirmed', {
                    totalCount, firstVideoId: result.firstVideoId, source: result.source, elapsedMs: result.elapsedMs,
                    slots: state.slots,
                    cards: state.cards,
                    currentCards: state.currentCards,
                    columns: state.columns,
                    itemIndices
                });
                return result;
            }

            previousSignature = signature;
            await new Promise(resolve => requestAnimationFrame(resolve));
            assertRouteSession(sessionToken);
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        return null;
    }

    async function waitForNativeCarouselReady(section, scroller, track, sessionToken = null, options = {}) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        const fastSinglePageTotalCount = Number.isSafeInteger(options.fastSinglePageTotalCount)
            ? options.fastSinglePageTotalCount
            : null;
        let lastSignature = '';
        let stableSince = started;
        let lastState = nativeCarouselReadiness(section, scroller, track);

        log(tLog('waitingForNativeCarouselInitialization'), {
            pages: lastState.pages,
            slots: lastState.slots,
            cards: lastState.cards,
            currentCards: lastState.currentCards,
            columns: lastState.columns,
            controlsPresent: lastState.controlsPresent,
            controlsEnabled: lastState.controlsEnabled,
            trackInitialized: lastState.trackInitialized,
            domGeneration: lastState.domGeneration,
            navigationMode: lastState.navigationMode,
            pageMode: lastState.pageMode,
            capabilities: lastState.capabilities
        });

        while (performance.now() - started < NATIVE_READY_TIMEOUT_MS) {
            assertRouteSession(sessionToken);
            const state = nativeCarouselReadiness(section, scroller, track);
            lastState = state;
            if (!state.connected) {
                return { ready: false, reason: 'detached', elapsedMs: Math.round(performance.now() - started), state };
            }

            const now = performance.now();
            if (state.signature !== lastSignature) {
                lastSignature = state.signature;
                stableSince = now;
            }

            const stableMs = now - stableSince;
            const multiPageReady =
                state.pages > 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                (state.controlsEnabled || state.trackInitialized || state.slots >= state.columns);

            const logicalCarouselReady =
                state.pageMode === 'logical' &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.controlsPresent &&
                state.trackInitialized &&
                stableMs >= NATIVE_LOGICAL_STABLE_MS;

            // A genuine short list can legitimately have one page and fewer cards than
            // the responsive column count. Do not accept that state immediately: the
            // same shape also appears briefly while Netflix is still building a larger
            // virtual carousel. Let it remain unchanged before treating it as complete.
            const fastSinglePageReady =
                Number.isSafeInteger(fastSinglePageTotalCount) &&
                fastSinglePageTotalCount > 0 &&
                fastSinglePageTotalCount <= state.columns &&
                state.pageMode === 'logical' &&
                state.pages === 1 &&
                state.cards === fastSinglePageTotalCount &&
                state.currentCards === fastSinglePageTotalCount &&
                state.slots === fastSinglePageTotalCount;

            const singlePageReady =
                state.pages === 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.slots === state.cards &&
                (fastSinglePageReady || stableMs >= NATIVE_SINGLE_PAGE_STABLE_MS);

            const emptyPageReady =
                state.pages === 1 &&
                state.cards === 0 &&
                state.slots === 0 &&
                stableMs >= NATIVE_EMPTY_STABLE_MS;

            if (emptyPageReady) {
                return {
                    ready: true,
                    empty: true,
                    reason: 'stable-empty-page',
                    elapsedMs: Math.round(performance.now() - started),
                    state
                };
            }

            if (logicalCarouselReady || multiPageReady || singlePageReady) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                assertRouteSession(sessionToken);
                await new Promise(resolve => requestAnimationFrame(resolve));
                assertRouteSession(sessionToken);
                const confirmed = nativeCarouselReadiness(section, scroller, track);
                if (confirmed.connected && confirmed.signature === state.signature) {
                    const result = {
                        ready: true,
                        reason: logicalCarouselReady
                            ? 'logical-carousel'
                            : (multiPageReady ? 'multi-page' : (fastSinglePageReady ? 'fast-single-page' : 'stable-single-page')),
                        elapsedMs: Math.round(performance.now() - started),
                        state: confirmed
                    };
                    log(tLog('nativeCarouselInitializationReady'), result);
                    return result;
                }
                lastSignature = confirmed.signature;
                stableSince = performance.now();
                lastState = confirmed;
            }

            await sleep(NATIVE_READY_POLL_MS);
            assertRouteSession(sessionToken);
        }

        assertRouteSession(sessionToken);
        const finalState = nativeCarouselReadiness(section, scroller, track);
        const result = {
            ready: false,
            reason: 'timeout',
            stage: 'native-carousel-readiness',
            timeoutMs: NATIVE_READY_TIMEOUT_MS,
            elapsedMs: Math.round(performance.now() - started),
            state: finalState
        };
        logOperationTimeout(result.stage, result.timeoutMs, {
            elapsedMs: result.elapsedMs,
            state: finalState
        });
        warn(tLog('nativeCarouselInitializationIsStillIncompleteInitializationDeferred'), result);
        return result;
    }

    async function waitStableCurrentPage(scroller, track, options = {}) {
        const timeout = options.timeout ?? PAGE_STABLE_TIMEOUT_MS;
        const previousSignature = options.previousSignature ?? '';
        const requiredStableFrames = options.requiredStableFrames ?? 2;
        const minimumSlots = Math.max(0, options.minimumSlots ?? 0);
        const minimumNewItems = Math.max(0, options.minimumNewItems ?? 0);
        const seenKeys = options.seenKeys instanceof Set ? options.seenKeys : null;
        const requiredKeys = options.requiredKeys instanceof Set ? options.requiredKeys : null;
        const sessionToken = options.sessionToken ?? null;
        const token = options.hoverToken ?? null;
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return [];
        const start = performance.now();
        let lastSignature = '';
        let stableFrames = 0;
        let best = [];
        let bestNewItems = 0;
        let bestRequiredMatches = 0;
        let freshContentSeen = !previousSignature;

        const slotKeys = slots => {
            const keys = new Set();
            for (const slot of slots) {
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const key = itemKeyFromCard(card);
                if (key) keys.add(key);
            }
            return keys;
        };

        const countRequiredMatches = slots => {
            if (!requiredKeys || requiredKeys.size === 0) return 0;
            const keys = slotKeys(slots);
            let matches = 0;
            for (const key of requiredKeys) {
                if (keys.has(key)) matches++;
            }
            return matches;
        };

        const countNewItems = slots => {
            if (!seenKeys || minimumNewItems <= 0) return 0;
            const keys = new Set();
            for (const slot of slots) {
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const key = itemKeyFromCard(card);
                if (key && !seenKeys.has(key)) keys.add(key);
            }
            return keys.size;
        };

        while (performance.now() - start < timeout) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            assertRouteSession(sessionToken);
            if (hoverPreparationCancelled(token)) return [];
            const slots = currentPageSlots(scroller, track);
            const newItems = countNewItems(slots);
            const requiredMatches = countRequiredMatches(slots);
            if (requiredMatches > bestRequiredMatches ||
                (requiredMatches === bestRequiredMatches &&
                    (slots.length > best.length || (slots.length === best.length && newItems >= bestNewItems)))) {
                best = slots;
                bestNewItems = newItems;
                bestRequiredMatches = requiredMatches;
            }

            const signature = visibleSignature(slots);
            if (!signature) continue;

            if (!freshContentSeen && signature !== previousSignature) {
                freshContentSeen = true;
                stableFrames = 0;
                lastSignature = '';
            }
            if (!freshContentSeen) continue;

            const slotCountReady = slots.length >= minimumSlots;
            const newItemCountReady = !seenKeys || minimumNewItems <= 0 || newItems >= minimumNewItems;
            const requiredKeysReady = !requiredKeys || requiredKeys.size === 0 || requiredMatches >= requiredKeys.size;
            if (!slotCountReady || !newItemCountReady || !requiredKeysReady) {
                stableFrames = 0;
                lastSignature = signature;
                continue;
            }

            if (signature === lastSignature) {
                stableFrames++;
                if (stableFrames >= requiredStableFrames) return slots;
            } else {
                lastSignature = signature;
                stableFrames = 1;
                if (requiredStableFrames <= 1) return slots;
            }
        }
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return [];
        return best;
    }

    function videoIdFromHref(href) {
        try {
            const url = new URL(href, location.href);
            const jbv = url.searchParams.get('jbv');
            if (jbv) return jbv;
            const m = url.pathname.match(/\/title\/(\d+)/);
            return m ? m[1] : '';
        } catch (_) {
            return '';
        }
    }

    function itemFromSlot(slot, page, captureSnapshot = true) {
        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return null;

        const href = card.href || card.getAttribute('href') || '';
        if (!href) return null;

        return {
            href,
            videoId: videoIdFromHref(href),
            page,
            ariaLabel: card.getAttribute('aria-label') || '',
            snapshot: captureSnapshot ? slot.cloneNode(true) : null
        };
    }

    function cardSourceForItem(item) {
        if (!item) return null;
        if (item.snapshot) return item.snapshot;
        const key = itemKey(item);
        // A removed/recollected item with the same title id must not borrow a
        // different item's tree. Published items use only their current clone.
        if (sourceState?.itemMap?.get(key) === item) {
            const clone = sourceState.cloneMap?.get(key);
            if (clone) return clone;
        }
        return item.cardTemplate || null;
    }

    function createItemClone(item) {
        const source = cardSourceForItem(item);
        if (!source) throw new Error(`No card markup available for ${itemKey(item)}`);
        const clone = source.cloneNode(true);
        if (source === item.cardTemplate) {
            const card = clone.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            card.setAttribute('href', item.href);
            card.href = item.href;
            card.setAttribute('aria-label', item.ariaLabel);
            const image = clone.querySelector('img');
            if (item.imageUrl && image) {
                image.src = item.imageUrl;
                image.removeAttribute('srcset');
                image.setAttribute('data-tm-graphql-image', 'true');
            }
        }
        // cloneNode copies attributes, but not grafted React properties or the
        // activation state. Rebuild/Undo must prepare its own fresh live source.
        for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted',
            'data-tm-preparing', 'data-tm-hover-token']) clone.removeAttribute(name);
        return clone;
    }

    function releaseItemCardSnapshot(item) {
        // Clear references without deleting properties from frequently read items.
        if (item.snapshot) item.snapshot = null;
        if (item.cardTemplate) item.cardTemplate = null;
        if (item.imageUrl) item.imageUrl = '';
    }

    function itemKey(item) {
        return item.videoId ? `v:${item.videoId}` : `h:${item.href}`;
    }

    function itemKeyFromCard(card) {
        const href = card?.href || card?.getAttribute?.('href') || '';
        if (!href) return '';
        const videoId = videoIdFromHref(href);
        return videoId ? `v:${videoId}` : `h:${href}`;
    }

    function pageItemKeys(items, page) {
        return new Set(
            items
                .filter(item => item.page === page)
                .map(itemKey)
                .filter(Boolean)
        );
    }

    function mountedItemKeys(slots) {
        const keys = new Set();
        for (const slot of slots) {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const key = itemKeyFromCard(card);
            if (key) keys.add(key);
        }
        return keys;
    }

    function trackTransformValue(track) {
        if (!track) return '';
        return track.style.getPropertyValue('transform') || getComputedStyle(track).transform || '';
    }

    function immediateRestoredPageState(scroller, track, items, targetPage) {
        const requiredPageKeys = pageItemKeys(items, targetPage);
        const slots = currentPageSlots(scroller, track);
        const mountedKeys = mountedItemKeys(slots);
        const missingKeys = [...requiredPageKeys].filter(key => !mountedKeys.has(key));
        return {
            expectedKeys: requiredPageKeys.size,
            mountedKeys: requiredPageKeys.size - missingKeys.length,
            slots: slots.length,
            missingKeys
        };
    }

    async function verifyRestoredPage(section, scroller, track, items, expectedPageSlots, targetPage, previousSignature = '', timeout = PAGE_STABLE_TIMEOUT_MS, sessionToken = null) {
        const requiredPageKeys = pageItemKeys(items, targetPage);
        const started = performance.now();
        const restoredSlots = await waitStableCurrentPage(scroller, track, {
            previousSignature,
            minimumSlots: Math.min(expectedPageSlots, Math.max(1, requiredPageKeys.size)),
            requiredKeys: requiredPageKeys,
            requiredStableFrames: 2,
            timeout,
            sessionToken
        });
        assertRouteSession(sessionToken);
        const restoredKeys = mountedItemKeys(restoredSlots);
        const missingKeys = [...requiredPageKeys].filter(key => !restoredKeys.has(key));

        return {
            ok: selectedPage(section) === targetPage && missingKeys.length === 0,
            selectedPage: selectedPage(section),
            expectedKeys: requiredPageKeys.size,
            mountedKeys: requiredPageKeys.size - missingKeys.length,
            slots: restoredSlots.length,
            missingKeys,
            elapsedMs: Math.round(performance.now() - started)
        };
    }

    async function restoreNativePageByPage(section, scroller, track, items, expectedPageSlots, targetPage, sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        let currentRestorePage = selectedPage(section);
        let restorationComplete = true;

        // If the target indicator is already selected but its virtual cards did not
        // mount correctly, force one adjacent round-trip before using the strict
        // v4.9 page-by-page verification path.
        if (currentRestorePage === targetPage) {
            const directCheck = await verifyRestoredPage(
                section,
                scroller,
                track,
                items,
                expectedPageSlots,
                targetPage,
                '',
                PAGE_STABLE_TIMEOUT_MS,
                sessionToken
            );
            if (directCheck.ok) return { complete: true, elapsedMs: directCheck.elapsedMs };

            const total = pageCount(section);
            const repairDirection = targetPage < total - 1 ? 1 : (targetPage > 0 ? -1 : 0);
            if (repairDirection !== 0) {
                const moved = await moveOnePage(section, scroller, repairDirection, null, sessionToken);
                if (moved !== targetPage + repairDirection) {
                    return { complete: false, elapsedMs: Math.round(performance.now() - started) };
                }
                currentRestorePage = moved;
            } else {
                return { complete: false, elapsedMs: Math.round(performance.now() - started) };
            }
        }

        const direction = targetPage < currentRestorePage ? -1 : 1;

        log(tLog('nativePageByPageRestorationStarted'), {
            from: currentRestorePage,
            target: targetPage,
            direction: direction < 0 ? 'left' : 'right'
        });

        while (currentRestorePage !== targetPage) {
            assertRouteSession(sessionToken);
            const nextPage = currentRestorePage + direction;
            const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
            const stepStarted = performance.now();
            const movedPage = await moveOnePage(section, scroller, direction, null, sessionToken);

            if (movedPage !== nextPage) {
                restorationComplete = false;
                warn(tLog('nativePageRestorationMoveFailed'), {
                    from: currentRestorePage,
                    target: nextPage,
                    result: movedPage
                });
                break;
            }

            const verification = await verifyRestoredPage(
                section,
                scroller,
                track,
                items,
                expectedPageSlots,
                nextPage,
                beforeSignature,
                PAGE_STABLE_TIMEOUT_MS,
                sessionToken
            );

            log(tLog('nativeRestorationPageStabilized'), {
                requestedPage: nextPage,
                selectedPage: verification.selectedPage,
                expectedKeys: verification.expectedKeys,
                mountedKeys: verification.mountedKeys,
                slots: verification.slots,
                missingKeys: verification.missingKeys,
                elapsedMs: Math.round(performance.now() - stepStarted)
            });

            if (!verification.ok) {
                restorationComplete = false;
                warn(tLog('nativeRestorationStoppedBecauseTheTargetPageDidNotFullyMount'), {
                    requestedPage: nextPage,
                    selectedPage: verification.selectedPage,
                    missingKeys: verification.missingKeys,
                    timeoutMs: PAGE_STABLE_TIMEOUT_MS
                });
                break;
            }

            currentRestorePage = nextPage;
        }

        const complete = restorationComplete && selectedPage(section) === targetPage;
        log(tLog('nativePageByPageRestorationCompleted'), {
            target: targetPage,
            selectedPage: selectedPage(section),
            complete,
            elapsedMs: Math.round(performance.now() - started)
        });
        return { complete, elapsedMs: Math.round(performance.now() - started) };
    }

    async function repairFastRestoredPage(section, scroller, track, items, expectedPageSlots, targetPage, canonicalTargetTransform = '', reason = 'verification-failed', sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        const total = pageCount(section);
        const repairDirection = targetPage < total - 1 ? 1 : (targetPage > 0 ? -1 : 0);
        if (repairDirection === 0) {
            return {
                complete: false,
                verification: null,
                elapsedMs: Math.round(performance.now() - started)
            };
        }

        const adjacentPage = targetPage + repairDirection;
        const beforeTransform = trackTransformValue(track);
        const beforeState = immediateRestoredPageState(scroller, track, items, targetPage);
        log(tLog('nativeFastRestorationPhaseRepairStarted'), {
            reason,
            target: targetPage,
            adjacentPage,
            direction: repairDirection < 0 ? 'left' : 'right',
            selectedPage: selectedPage(section),
            canonicalTargetTransform,
            beforeTransform,
            transformMatchesCanonical: Boolean(canonicalTargetTransform) && beforeTransform === canonicalTargetTransform,
            expectedKeys: beforeState.expectedKeys,
            mountedKeys: beforeState.mountedKeys,
            missingKeys: beforeState.missingKeys
        });

        const outwardSignature = visibleSignature(currentPageSlots(scroller, track));
        const movedOut = await moveOnePage(section, scroller, repairDirection, null, sessionToken);
        if (movedOut !== adjacentPage) {
            warn(tLog('nativeFastRestorationPhaseRepairMoveFailed'), {
                reason,
                from: targetPage,
                target: adjacentPage,
                result: movedOut,
                transform: trackTransformValue(track)
            });
            return {
                complete: false,
                verification: null,
                elapsedMs: Math.round(performance.now() - started)
            };
        }

        const adjacentVerification = await verifyRestoredPage(
            section,
            scroller,
            track,
            items,
            expectedPageSlots,
            adjacentPage,
            outwardSignature,
            FAST_RESTORE_VERIFY_TIMEOUT_MS,
            sessionToken
        );
        const adjacentTransform = trackTransformValue(track);
        log(tLog('nativeFastRestorationPhaseRepairAdjacentPageVerified'), {
            reason,
            requestedPage: adjacentPage,
            selectedPage: adjacentVerification.selectedPage,
            complete: adjacentVerification.ok,
            expectedKeys: adjacentVerification.expectedKeys,
            mountedKeys: adjacentVerification.mountedKeys,
            missingKeys: adjacentVerification.missingKeys,
            transform: adjacentTransform,
            verificationElapsedMs: adjacentVerification.elapsedMs
        });
        if (!adjacentVerification.ok) {
            warn(tLog('nativeFastRestorationPhaseRepairAdjacentPageDidNotStabilize'), {
                requestedPage: adjacentPage,
                selectedPage: adjacentVerification.selectedPage,
                expectedKeys: adjacentVerification.expectedKeys,
                mountedKeys: adjacentVerification.mountedKeys,
                missingKeys: adjacentVerification.missingKeys
            });
            return {
                complete: false,
                verification: adjacentVerification,
                elapsedMs: Math.round(performance.now() - started)
            };
        }

        const returnSignature = visibleSignature(currentPageSlots(scroller, track));
        const movedBack = await moveOnePage(section, scroller, -repairDirection, null, sessionToken);
        if (movedBack !== targetPage) {
            warn(tLog('nativeFastRestorationPhaseRepairMoveFailed'), {
                reason,
                from: adjacentPage,
                target: targetPage,
                result: movedBack,
                transform: trackTransformValue(track)
            });
            return {
                complete: false,
                verification: null,
                elapsedMs: Math.round(performance.now() - started)
            };
        }

        const targetVerification = await verifyRestoredPage(
            section,
            scroller,
            track,
            items,
            expectedPageSlots,
            targetPage,
            returnSignature,
            FAST_RESTORE_VERIFY_TIMEOUT_MS,
            sessionToken
        );
        const complete = targetVerification.ok;
        const finalTransform = trackTransformValue(track);

        log(tLog('nativeFastRestorationPhaseRepairCompleted'), {
            reason,
            target: targetPage,
            selectedPage: targetVerification.selectedPage,
            complete,
            expectedKeys: targetVerification.expectedKeys,
            mountedKeys: targetVerification.mountedKeys,
            missingKeys: targetVerification.missingKeys,
            canonicalTargetTransform,
            finalTransform,
            transformMatchesCanonical: Boolean(canonicalTargetTransform) && finalTransform === canonicalTargetTransform,
            adjacentVerificationElapsedMs: adjacentVerification.elapsedMs,
            targetVerificationElapsedMs: targetVerification.elapsedMs,
            elapsedMs: Math.round(performance.now() - started)
        });

        return {
            complete,
            verification: targetVerification,
            elapsedMs: Math.round(performance.now() - started)
        };
    }

    async function restoreNativePageFast(section, scroller, track, items, expectedPageSlots, targetPage, canonicalTargetTransform = '', sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        const originalFromPage = selectedPage(section);
        const pages = pageCount(section);
        const adjacentDirection = targetPage < originalFromPage ? -1 : 1;
        const adjacentMoveCount = Math.abs(originalFromPage - targetPage);
        let direction = adjacentDirection;
        let moveCount = adjacentMoveCount;
        let restorationStrategy = 'adjacent';
        let currentPage = originalFromPage;
        let previousSignature = '';
        let fastComplete = true;
        let verification = null;
        let completionPath = 'strict-verify';
        let phaseMismatchDetected = false;
        let initialVerificationWaitSkipped = false;
        let cycleShortcutAttempted = false;
        let cycleShortcutSucceeded = false;

        // Netflix's logical My List carousel wraps from its final page back to page 0
        // with one native right move. Prefer that O(1) restoration after a complete
        // forward scan, but keep the 1.6.6 adjacent-page restoration as fallback.
        const cycleShortcutEligible =
            pages > 1 &&
            targetPage === 0 &&
            originalFromPage === pages - 1;

        log(tLog('nativeFastRestorationStarted'), {
            from: originalFromPage,
            target: targetPage,
            direction: cycleShortcutEligible ? 'right' : (direction < 0 ? 'left' : 'right'),
            strategy: cycleShortcutEligible ? 'cycle-right-once-preferred' : 'adjacent',
            cycleShortcutEligible,
            pages,
            pageCountParity: pages % 2 === 0 ? 'even' : 'odd',
            moveCount: cycleShortcutEligible ? 1 : moveCount,
            moveCountParity: (cycleShortcutEligible ? 1 : moveCount) % 2 === 0 ? 'even' : 'odd',
            canonicalTargetTransform
        });

        if (cycleShortcutEligible) {
            const rightControl = carouselMoveButton(section, scroller, 1);
            if (rightControl.button && !carouselMoveButtonDisabled(rightControl.button)) {
                cycleShortcutAttempted = true;
                previousSignature = visibleSignature(currentPageSlots(scroller, track));
                try {
                    const movedPage = await moveOnePage(section, scroller, 1, null, sessionToken);
                    assertRouteSession(sessionToken);
                    if (movedPage === targetPage && selectedPage(section) === targetPage) {
                        cycleShortcutSucceeded = true;
                        restorationStrategy = 'cycle-right-once';
                        direction = 1;
                        moveCount = 1;
                        currentPage = targetPage;
                    } else {
                        warn(tLog('nativeFastRestorationMoveFailed'), {
                            strategy: 'cycle-right-once',
                            from: originalFromPage,
                            target: targetPage,
                            result: movedPage,
                            selectedPage: selectedPage(section)
                        });
                    }
                } catch (error) {
                    if (isRouteSessionCancelledError(error)) throw error;
                    warn(tLog('nativeFastRestorationMoveFailed'), {
                        strategy: 'cycle-right-once',
                        from: originalFromPage,
                        target: targetPage,
                        selectedPage: selectedPage(section),
                        error
                    });
                }

                if (!cycleShortcutSucceeded && selectedPage(section) !== originalFromPage) {
                    try {
                        await goToPage(section, scroller, originalFromPage, null, sessionToken);
                        assertRouteSession(sessionToken);
                    } catch (error) {
                        if (isRouteSessionCancelledError(error)) throw error;
                        warn(tLog('nativeFastRestorationMoveFailed'), {
                            strategy: 'cycle-restage-before-adjacent-fallback',
                            from: selectedPage(section),
                            target: originalFromPage,
                            error
                        });
                    }
                }
                currentPage = selectedPage(section);
                previousSignature = '';
            }
        }

        if (!cycleShortcutSucceeded) {
            direction = targetPage < currentPage ? -1 : 1;
            moveCount = Math.abs(currentPage - targetPage);
            restorationStrategy = cycleShortcutAttempted ? 'adjacent-after-cycle-fallback' : 'adjacent';
        }

        while (!cycleShortcutSucceeded && currentPage !== targetPage) {
            assertRouteSession(sessionToken);
            const nextPage = currentPage + direction;
            previousSignature = visibleSignature(currentPageSlots(scroller, track));
            const movedPage = await moveOnePage(section, scroller, direction, null, sessionToken);
            if (movedPage !== nextPage) {
                fastComplete = false;
                completionPath = 'move-failed';
                warn(tLog('nativeFastRestorationMoveFailed'), {
                    strategy: restorationStrategy,
                    from: currentPage,
                    target: nextPage,
                    result: movedPage
                });
                break;
            }
            currentPage = nextPage;
        }

        if (fastComplete && selectedPage(section) === targetPage) {
            const diagnosisStarted = performance.now();
            const immediateState = immediateRestoredPageState(scroller, track, items, targetPage);
            const arrivalTransform = trackTransformValue(track);
            const hasCanonicalTransform = Boolean(canonicalTargetTransform);
            const transformMatchesCanonical = !hasCanonicalTransform || arrivalTransform === canonicalTargetTransform;
            phaseMismatchDetected = hasCanonicalTransform &&
                !transformMatchesCanonical &&
                immediateState.missingKeys.length > 0;

            log(tLog('nativeFastRestorationPhaseDiagnosis'), {
                from: originalFromPage,
                target: targetPage,
                selectedPage: selectedPage(section),
                pages: pageCount(section),
                pageCountParity: pageCount(section) % 2 === 0 ? 'even' : 'odd',
                moveCount,
                moveCountParity: moveCount % 2 === 0 ? 'even' : 'odd',
                canonicalTargetTransform,
                arrivalTransform,
                transformMatchesCanonical,
                expectedKeys: immediateState.expectedKeys,
                mountedKeys: immediateState.mountedKeys,
                missingKeys: immediateState.missingKeys,
                phaseMismatchDetected,
                diagnosisElapsedMs: Math.round(performance.now() - diagnosisStarted)
            });

            if (phaseMismatchDetected) {
                initialVerificationWaitSkipped = true;
                completionPath = 'phase-repair-before-timeout';
                const repair = await repairFastRestoredPage(
                    section,
                    scroller,
                    track,
                    items,
                    expectedPageSlots,
                    targetPage,
                    canonicalTargetTransform,
                    'transform-mismatch-with-missing-target-keys',
                    sessionToken
                );
                verification = repair.verification;
                fastComplete = repair.complete;
            } else {
                verification = await verifyRestoredPage(
                    section,
                    scroller,
                    track,
                    items,
                    expectedPageSlots,
                    targetPage,
                    previousSignature,
                    FAST_RESTORE_VERIFY_TIMEOUT_MS,
                    sessionToken
                );
                fastComplete = verification.ok;

                if (!fastComplete && selectedPage(section) === targetPage) {
                    completionPath = 'phase-repair-after-verification';
                    const repair = await repairFastRestoredPage(
                        section,
                        scroller,
                        track,
                        items,
                        expectedPageSlots,
                        targetPage,
                        canonicalTargetTransform,
                        'strict-verification-failed',
                        sessionToken
                    );
                    verification = repair.verification || verification;
                    fastComplete = repair.complete;
                }
            }
        }

        const finalTransform = trackTransformValue(track);
        log(tLog('nativeFastRestorationCompleted'), {
            from: originalFromPage,
            target: targetPage,
            selectedPage: selectedPage(section),
            complete: fastComplete,
            strategy: restorationStrategy,
            cycleShortcutAttempted,
            cycleShortcutSucceeded,
            completionPath,
            phaseMismatchDetected,
            initialVerificationWaitSkipped,
            expectedKeys: verification?.expectedKeys ?? null,
            mountedKeys: verification?.mountedKeys ?? null,
            missingKeys: verification?.missingKeys ?? [],
            canonicalTargetTransform,
            finalTransform,
            transformMatchesCanonical: Boolean(canonicalTargetTransform) && finalTransform === canonicalTargetTransform,
            elapsedMs: Math.round(performance.now() - started)
        });

        if (fastComplete) return true;

        warn(tLog('fastRestorationVerificationFailedUsingV49PageByPageFallback'), {
            from: originalFromPage,
            target: targetPage,
            selectedPage: selectedPage(section),
            strategy: restorationStrategy,
            cycleShortcutAttempted,
            cycleShortcutSucceeded,
            completionPath,
            phaseMismatchDetected,
            canonicalTargetTransform,
            finalTransform
        });

        // Re-stage the scan ending page when possible, then run the strict v4.9
        // restoration path that validates every intermediate page. If re-staging
        // cannot reach the original ending page, the strict fallback starts from
        // whichever page is currently selected.
        if (selectedPage(section) !== originalFromPage) {
            await goToPage(section, scroller, originalFromPage, null, sessionToken);
        }
        const fallback = await restoreNativePageByPage(
            section,
            scroller,
            track,
            items,
            expectedPageSlots,
            targetPage,
            sessionToken
        );
        return fallback.complete;
    }

    function currentPageVideoIds(scroller, track) {
        return currentPageSlots(scroller, track)
            .map(slot => {
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                return card ? videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
            })
            .filter(Boolean);
    }

    async function ensureFreshIndicatorPageZeroAnchor(section, scroller, track, firstVideoId, sessionToken = null) {
        assertRouteSession(sessionToken);
        const expectedFirstVideoId = String(firstVideoId || '');
        if (!expectedFirstVideoId) return true;

        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile?.pageMode !== 'indicator') return true;

        if (selectedPage(section) !== 0) {
            const returned = await goToPage(section, scroller, 0, null, sessionToken, false);
            assertRouteSession(sessionToken);
            if (returned !== 0 || selectedPage(section) !== 0) {
                throw initializationError(
                    'NATIVE_PAGE_ZERO_NOT_REACHED',
                    'normalize-native-page-zero',
                    'Could not return the native My List carousel to page 0 before reinitialization',
                    { returnedPage: returned, selectedPage: selectedPage(section), expectedFirstVideoId }
                );
            }
        }

        let visibleIds = currentPageVideoIds(scroller, track);
        if (visibleIds[0] === expectedFirstVideoId) {
            log('Fresh Netflix My List page-0 anchor confirmed', {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pageMode: profile.pageMode
            });
            return true;
        }

        log('Fresh Netflix My List page-0 anchor mismatch; refreshing native page 0', {
            expectedFirstVideoId,
            visibleIds,
            selectedPage: selectedPage(section),
            pages: pageCount(section),
            pageMode: profile.pageMode
        });

        // A remove/add at index 0 can leave Netflix's legacy/indicator carousel with
        // page 0 selected while the mounted six-card window is shifted by one item.
        // Do one normal adjacent-page round trip before source-scan mode is enabled so
        // React can repopulate the canonical page-0 window. Do not use FAST_MOVE here.
        if (pageCount(section) > 1) {
            const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
            const adjacent = await moveOnePage(section, scroller, 1, null, sessionToken);
            assertRouteSession(sessionToken);
            if (adjacent !== 0) {
                await waitStableCurrentPage(scroller, track, {
                    previousSignature: beforeSignature,
                    minimumSlots: Math.max(1, sourceState?.layout?.columns || currentPageSlots(scroller, track).length || 1),
                    timeout: 900,
                    sessionToken
                });
                await moveOnePage(section, scroller, -1, null, sessionToken);
                assertRouteSession(sessionToken);
            }
        }

        const requiredKey = `v:${expectedFirstVideoId}`;
        await waitStableCurrentPage(scroller, track, {
            minimumSlots: Math.max(1, sourceState?.layout?.columns || currentPageSlots(scroller, track).length || 1),
            requiredKeys: new Set([requiredKey]),
            requiredStableFrames: 2,
            timeout: 1200,
            sessionToken
        });
        assertRouteSession(sessionToken);

        visibleIds = currentPageVideoIds(scroller, track);
        if (selectedPage(section) === 0 && visibleIds[0] === expectedFirstVideoId) {
            log('Fresh Netflix My List page-0 anchor restored', {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pageMode: profile.pageMode
            });
            return true;
        }

        throw initializationError(
            'NATIVE_PAGE_ZERO_ANCHOR_MISMATCH',
            'normalize-native-page-zero',
            'Netflix My List page 0 is selected but its first mounted card does not match the fresh My List first item',
            {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pages: pageCount(section),
                pageMode: profile.pageMode
            }
        );
    }

    // Reads the private React props needed to order and validate Netflix's logical carousel.
    const netflixReactCarousel = Object.freeze({
        fiberForNode(node) {
            if (!node) return null;
            for (const key of Object.getOwnPropertyNames(node)) {
                if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
                const fiber = node[key];
                if (fiber && typeof fiber === 'object') return fiber;
            }
            return null;
        },

        typeName(fiber) {
            const type = fiber?.elementType || fiber?.type;
            if (typeof type === 'string') return type;
            if (typeof type === 'function') return type.displayName || type.name || '(anonymous)';
            if (type && typeof type === 'object') {
                return String(type.displayName || type.name || type.$$typeof || '(object)');
            }
            return type == null ? '' : String(type);
        },

        readFiberProp(roots, property, isValid) {
            for (const root of roots) {
                let fiber = this.fiberForNode(root);
                const visited = new Set();
                let depth = 0;
                while (fiber && typeof fiber === 'object' && depth < 16 && !visited.has(fiber)) {
                    visited.add(fiber);
                    const sources = [
                        ['memoizedProps', fiber.memoizedProps],
                        ['pendingProps', fiber.pendingProps],
                        ['alternate.memoizedProps', fiber.alternate?.memoizedProps],
                        ['alternate.pendingProps', fiber.alternate?.pendingProps]
                    ];
                    for (const [source, props] of sources) {
                        const value = props?.[property];
                        if (isValid(value)) {
                            return {
                                value,
                                depth,
                                source,
                                fiberKey: fiber.key ?? null,
                                typeName: this.typeName(fiber)
                            };
                        }
                    }
                    fiber = fiber.return;
                    depth++;
                }
            }
            return { value: null, depth: null, source: null, fiberKey: null, typeName: '' };
        },

        readItemIndex(slot) {
            const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard) || null;
            return this.readFiberProp(
                [slot?.firstElementChild || null, card?.parentElement || null, card],
                'itemIndex',
                Number.isSafeInteger
            );
        },

        readCarouselTotalCount(slot) {
            const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard) || null;
            const reading = this.readFiberProp(
                [slot, slot?.firstElementChild || null, card?.parentElement || null, card],
                'totalCount',
                value => Number.isSafeInteger(value) && value >= 0
            );
            return reading.value;
        }
    });

    function diagnosticPrimitiveProps(props) {
        if (!props || typeof props !== 'object') return null;
        const keys = Object.keys(props);
        const interesting = {};
        const pattern = /(index|offset|position|slot|page|item|cursor|count|first|last|key|raw|virtual)/i;
        for (const key of keys) {
            if (!pattern.test(key)) continue;
            const value = props[key];
            if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
                interesting[key] = value;
            }
            if (Object.keys(interesting).length >= 24) break;
        }
        return { keys: keys.slice(0, 40), interesting };
    }

    function diagnosticFiberChain(node, maxDepth = 16) {
        const fiber = netflixReactCarousel.fiberForNode(node);
        const chain = [];
        let current = fiber;
        const visited = new Set();
        let depth = 0;
        while (current && typeof current === 'object' && depth < maxDepth && !visited.has(current)) {
            visited.add(current);
            const stateNode = current.stateNode;
            chain.push({
                depth,
                tag: current.tag ?? null,
                key: current.key ?? null,
                alternateKey: current.alternate?.key ?? null,
                typeName: netflixReactCarousel.typeName(current),
                stateNodeName: stateNode instanceof Element ? stateNode.tagName.toLowerCase() : '',
                stateVirtualSlot: stateNode instanceof Element ? (stateNode.getAttribute('data-virtual-slot') || '') : '',
                memoizedProps: diagnosticPrimitiveProps(current.memoizedProps),
                pendingProps: diagnosticPrimitiveProps(current.pendingProps)
            });
            current = current.return;
            depth++;
        }
        return chain;
    }

    function diagnosticReactNode(node, label) {
        if (!(node instanceof Element)) return { label, available: false };
        const ownKeys = Object.getOwnPropertyNames(node);
        return {
            label,
            available: true,
            tagName: node.tagName.toLowerCase(),
            virtualSlot: node.getAttribute('data-virtual-slot') || '',
            reactKeys: ownKeys.filter(key => key.startsWith('__react')).slice(0, 20),
            fiberChain: diagnosticFiberChain(node)
        };
    }

    function logVirtualRawIndexDiagnostic(slots, totalCount, columns, stage) {
        const entries = slots.slice(0, Math.min(slots.length, 6)).map((slot, index) => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const child = slot.firstElementChild;
            const cardParent = card?.parentElement || null;
            return {
                index,
                descriptor: slotDescriptor(slot),
                nodes: [
                    diagnosticReactNode(slot, 'slot'),
                    diagnosticReactNode(child, 'slot-first-child'),
                    diagnosticReactNode(cardParent, 'card-parent'),
                    diagnosticReactNode(card, 'card')
                ]
            };
        });
        warn('Netflix itemIndex diagnostic', {
            stage,
            totalCount,
            columns,
            slotCount: slots.length,
            entries
        });
    }

    function nativeReactCarouselTotalCount(scroller, track) {
        const slots = currentPageSlots(scroller, track);
        const readings = slots.map(slot => netflixReactCarousel.readCarouselTotalCount(slot));
        const finiteReadings = readings.filter(value => Number.isSafeInteger(value) && value >= 0);
        const unique = [...new Set(finiteReadings)];
        return {
            totalCount: unique.length === 1 ? unique[0] : null,
            readings,
            slots: slots.length,
            uniqueReadings: unique
        };
    }

    function isResizeResponsiveReason(reason) {
        return reason === 'ResizeObserver' || reason === 'responsive-resize-retry';
    }

    function orderMismatchPromptSuppressionState() {
        const resizePending =
            isResizeResponsiveReason(lastResponsiveReason) &&
            responsiveRefreshTimer !== null;
        const resizeRunning =
            responsiveRefreshing &&
            isResizeResponsiveReason(activeResponsiveReason);

        let nativeCountState = null;
        let nativeCountConverged = false;
        if (myListCountConvergencePending && sourceState?.scroller?.isConnected && sourceState?.track?.isConnected) {
            nativeCountState = nativeReactCarouselTotalCount(sourceState.scroller, sourceState.track);
            nativeCountConverged =
                Number.isSafeInteger(nativeCountState.totalCount) &&
                nativeCountState.totalCount === (sourceState.items?.length ?? sourceState.totalCount ?? 0);
            if (nativeCountConverged) myListCountConvergencePending = false;
        }

        return {
            suppress: Boolean(resizePending || resizeRunning || myListCountConvergencePending),
            resizePending,
            resizeRunning,
            myListCountConvergencePending,
            nativeCountConverged,
            legacyTotalCount: sourceState?.items?.length ?? sourceState?.totalCount ?? null,
            nativeTotalCount: nativeCountState?.totalCount ?? null,
            nativeCountReadings: nativeCountState?.readings || [],
            nativeCountUniqueReadings: nativeCountState?.uniqueReadings || []
        };
    }

    function requireNativeReactCarouselTotalCount(scroller, track, provisionalTotalCount = null) {
        const state = nativeReactCarouselTotalCount(scroller, track);
        if (Number.isSafeInteger(state.totalCount) && state.totalCount >= 0) return state;
        throw initializationError(
            'NATIVE_TOTAL_COUNT_UNAVAILABLE',
            'native-react-total-count',
            'Could not read a consistent Netflix My List totalCount from the mounted carousel',
            {
                provisionalTotalCount,
                slots: state.slots,
                readings: state.readings,
                uniqueReadings: state.uniqueReadings
            }
        );
    }

    function netflixItemIndexFromSlot(slot) {
        if (!nativeReadScope || !slot) return netflixReactCarousel.readItemIndex(slot).value;
        if (!nativeReadScope.indices.has(slot)) {
            nativeReadScope.indices.set(slot, netflixReactCarousel.readItemIndex(slot).value);
        }
        return nativeReadScope.indices.get(slot);
    }

    function normalizeNetflixLogicalIndex(itemIndex, totalCount) {
        if (!Number.isSafeInteger(itemIndex) || !Number.isFinite(totalCount) || totalCount <= 0) return null;
        if (itemIndex < 0 || itemIndex >= totalCount) return null;
        return itemIndex;
    }

    function logicalSlotPositions(slots, totalCount) {
        return slots.map(slot => {
            const itemIndex = netflixItemIndexFromSlot(slot);
            return {
                slot,
                itemIndex,
                logicalIndex: normalizeNetflixLogicalIndex(itemIndex, totalCount)
            };
        });
    }

    function expectedLogicalIndicesForPage(totalCount, columns, page) {
        const count = Math.max(0, Math.floor(totalCount));
        const width = Math.max(1, Math.floor(columns));
        if (count <= 0) return [];
        const pages = Math.max(1, Math.ceil(count / width));
        const normalizedPage = Math.max(0, Math.min(pages - 1, Math.floor(page)));
        const visibleCount = Math.min(width, count);
        let start = normalizedPage * width;
        if (pages > 1 && normalizedPage === pages - 1 && count % width !== 0) {
            start = Math.max(0, count - width);
        }
        return Array.from({ length: visibleCount }, (_, index) => start + index);
    }

    function logicalPageFromSlotPositions(positions, totalCount, columns) {
        if (!positions.length || positions.some(position => !Number.isSafeInteger(position.logicalIndex))) return null;
        const actual = [...new Set(positions.map(position => position.logicalIndex))].sort((a, b) => a - b);
        if (actual.length !== positions.length) return null;
        const width = Math.max(1, Math.floor(columns));
        const pages = Math.max(1, Math.ceil(totalCount / width));
        // A full window starts at a page boundary, except the overlapping last
        // page. Still require exact membership; never accept partial hydration.
        const candidates = [...new Set([Math.floor(actual[0] / width), pages - 1])].sort((a, b) => a - b);
        for (const page of candidates) {
            if (page < 0 || page >= pages) continue;
            const expected = expectedLogicalIndicesForPage(totalCount, columns, page);
            if (expected.length !== actual.length) continue;
            if (expected.every((value, index) => value === actual[index])) return page;
        }
        return null;
    }

    function nativeLogicalPageState(scroller, track, totalCount, columns) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeLogicalPageState(scroller, track, totalCount, columns));
        const slots = currentPageSlots(scroller, track);
        const positions = logicalSlotPositions(slots, totalCount);
        const page = logicalPageFromSlotPositions(positions, totalCount, columns);
        return {
            slots,
            positions,
            page,
            itemIndices: positions.map(position => position.itemIndex),
            logicalIndices: positions.map(position => position.logicalIndex)
        };
    }

    function forceLogicalPageSignature(section, signature, page) {
        if (!section || !signature || !Number.isFinite(page)) return null;
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return null;
        const resolvedPage = Math.max(0, Math.floor(page));
        const oldPage = runtime.signatureToPage.get(signature);
        if (Number.isFinite(oldPage) && oldPage !== resolvedPage) {
            if (runtime.pageToSignature.get(oldPage) === signature) runtime.pageToSignature.delete(oldPage);
        }
        const oldSignature = runtime.pageToSignature.get(resolvedPage);
        if (oldSignature && oldSignature !== signature) runtime.signatureToPage.delete(oldSignature);
        runtime.signatureToPage.set(signature, resolvedPage);
        runtime.pageToSignature.set(resolvedPage, signature);
        runtime.currentPage = resolvedPage;
        return resolvedPage;
    }

    function requireNativeLogicalPageState(scroller, track, totalCount, columns, stage = 'logical-item-index-detection') {
        const state = nativeLogicalPageState(scroller, track, totalCount, columns);
        if (state.positions.length && state.positions.every(position => Number.isSafeInteger(position.itemIndex)) && Number.isFinite(state.page)) {
            return state;
        }
        logVirtualRawIndexDiagnostic(state.slots, totalCount, columns, stage);
        throw initializationError(
            'NATIVE_LOGICAL_INDEX_UNAVAILABLE',
            stage,
            'Could not read a complete Netflix itemIndex page from the current My List carousel',
            {
                totalCount,
                columns,
                slots: state.slots.length,
                itemIndices: state.itemIndices,
                logicalIndices: state.logicalIndices,
                resolvedPage: state.page
            }
        );
    }

    async function collectAllItemsLogical(section, scroller, track, totalCount, sessionToken = null) {
        assertRouteSession(sessionToken);
        const snapshotWork = performanceDiagnostics.nativeCollection;
        if (!Number.isFinite(totalCount) || totalCount < 0) {
            throw initializationError(
                'TOTAL_COUNT_REQUIRED',
                'total-count-detection',
                'Generation 2 collection requires a known My List totalCount',
                { totalCount, carouselDom: carouselDomProfileSummary(section) }
            );
        }

        let runtime = resetCarouselDomRuntime(section);
        runtime.profile = detectCarouselDomProfile(section);
        runtime.pageCountFinalized = false;
        runtime.cycleDetected = false;
        const goal = totalCount;
        const itemsByLogicalIndex = new Map();
        const videoIndex = new Map();
        const seenKeys = new Set();
        const visitedSignatures = new Set();
        const responsiveColumns = sourceState?.layout?.columns || currentPageSlots(scroller, track).length || 1;
        const estimatedPages = Math.max(1, Math.ceil(totalCount / Math.max(1, responsiveColumns)));
        const started = performance.now();
        const scanSavedTransition = captureInlineStyleProperty(track, 'transition');
        const scanSavedAnimation = captureInlineStyleProperty(track, 'animation');
        const stablePageTransforms = new Map();
        let initialPage = null;
        let endingPage = 0;
        let completionReason = '';

        const collectedCount = () => itemsByLogicalIndex.size;

        const ensureCollectionTime = stage => {
            const elapsedMs = performance.now() - started;
            if (elapsedMs < LOGICAL_COLLECTION_TIMEOUT_MS) return;
            const details = {
                stage,
                elapsedMs: Math.round(elapsedMs),
                collected: collectedCount(),
                totalCount,
                missing: Math.max(0, totalCount - collectedCount()),
                logicalPage: runtime.currentPage,
                carouselDom: carouselDomProfileSummary(section)
            };
            logOperationTimeout('logical-full-collection', LOGICAL_COLLECTION_TIMEOUT_MS, details);
            throw initializationTimeoutError('logical-full-collection', LOGICAL_COLLECTION_TIMEOUT_MS, details);
        };

        const incomplete = (stage, reason, details = {}) => {
            const payload = {
                stage,
                reason,
                collected: collectedCount(),
                totalCount,
                missing: Math.max(0, totalCount - collectedCount()),
                logicalPage: runtime.currentPage,
                cycleDetected: runtime.cycleDetected,
                snapshotWork: { ...snapshotWork },
                carouselDom: carouselDomProfileSummary(section),
                ...details
            };
            warn(tLog('fullCollectionIncomplete'), payload);
            throw initializationError('COLLECTION_INCOMPLETE', stage, `Collection incomplete at ${stage}: ${reason}`, payload);
        };

        log(tLog('fullCollectionStarted'), {
            totalCount,
            goal,
            domGeneration: runtime.profile.generation,
            navigationMode: runtime.profile.navigationMode,
            pageMode: runtime.profile.pageMode,
            selectedPage: selectedPage(section),
            currentPageCards: currentPageSlots(scroller, track).length,
            expectedPageSlots: responsiveColumns,
            internalIndicator: 'netflix-react-item-index'
        });

        const restoreScanStyles = () => {
            section.classList.remove(FAST_MOVE_CLASS);
            restoreInlineStyleProperty(track, 'transition', scanSavedTransition);
            restoreInlineStyleProperty(track, 'animation', scanSavedAnimation);
            void track.offsetWidth;
        };

        section.classList.add(FAST_MOVE_CLASS);
        track.style.setProperty('transition', 'none', 'important');
        track.style.setProperty('animation', 'none', 'important');
        void track.offsetWidth;
        registerActiveCarouselStyleCleanup(restoreScanStyles);

        try {
            let guard = estimatedPages * 3 + 12;
            let previousPageSignature = '';

            while (guard-- > 0 && collectedCount() < goal) {
                ensureCollectionTime('collect-page');
                const beforeCount = collectedCount();
                const remaining = Math.max(0, goal - beforeCount);
                const expectedSlots = Math.max(1, Math.min(responsiveColumns, remaining));
                const stabilizeStarted = performance.now();
                const slots = await waitStableCurrentPage(scroller, track, {
                    previousSignature: previousPageSignature,
                    minimumSlots: expectedSlots,
                    minimumNewItems: 1,
                    seenKeys,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                let stabilizedSignature = visibleSignature(slots);
                let stabilizedTransform = trackTransformValue(track);
                let pageState = nativeLogicalPageState(
                    scroller,
                    track,
                    totalCount,
                    responsiveColumns
                );
                const initialLogicalPageStateValid =
                    pageState.positions.length > 0 &&
                    pageState.positions.every(position => Number.isSafeInteger(position.itemIndex)) &&
                    Number.isFinite(pageState.page);

                if (!initialLogicalPageStateValid) {
                    const fullWindowSlots = Math.max(1, Math.min(responsiveColumns, totalCount));
                    log('Transient partial logical page detected; waiting for native window completion', {
                        totalCount,
                        columns: responsiveColumns,
                        requestedMinimumSlots: expectedSlots,
                        recoveryMinimumSlots: fullWindowSlots,
                        slots: pageState.slots.length,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        resolvedPage: pageState.page
                    });
                    const recoveredSlots = await waitStableCurrentPage(scroller, track, {
                        previousSignature: '',
                        minimumSlots: fullWindowSlots,
                        minimumNewItems: 1,
                        seenKeys,
                        requiredStableFrames: 2,
                        timeout: PARTIAL_PAGE_RECOVERY_TIMEOUT_MS,
                        sessionToken
                    });
                    assertRouteSession(sessionToken);
                    stabilizedSignature = visibleSignature(recoveredSlots);
                    stabilizedTransform = trackTransformValue(track);
                    pageState = requireNativeLogicalPageState(
                        scroller,
                        track,
                        totalCount,
                        responsiveColumns,
                        'logical-item-index-detection-retry'
                    );
                } else {
                    pageState = requireNativeLogicalPageState(
                        scroller,
                        track,
                        totalCount,
                        responsiveColumns,
                        'logical-item-index-detection'
                    );
                }
                if (visibleSignature(pageState.slots) !== stabilizedSignature) {
                    incomplete('collect-page', 'raw-index-page-changed-during-stabilization', {
                        stabilizedSignature,
                        currentSignature: visibleSignature(pageState.slots),
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices
                    });
                }
                const page = pageState.page;
                runtime.currentPage = page;
                forceLogicalPageSignature(section, stabilizedSignature, page);
                stablePageTransforms.set(page, stabilizedTransform);
                if (initialPage === null) {
                    initialPage = page;
                    if (sourceState) sourceState.initialPage = initialPage;
                    log('Logical My List native position located', {
                        page,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        signature: stabilizedSignature
                    });
                }

                if (visitedSignatures.has(stabilizedSignature) && collectedCount() < goal) {
                    runtime.cycleDetected = true;
                    incomplete('collect-page', 'known-signature-cycle-before-total-count', {
                        page,
                        signature: stabilizedSignature,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices
                    });
                }
                visitedSignatures.add(stabilizedSignature);

                const newKeys = new Set();
                for (const position of pageState.positions) {
                    const card = position.slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const key = itemKeyFromCard(card);
                    if (key && !seenKeys.has(key)) newKeys.add(key);
                }

                log(tLog('collectionPageStabilized'), {
                    requestedPage: page,
                    actualPage: page,
                    slots: pageState.slots.length,
                    minimumSlots: expectedSlots,
                    newItemsReady: newKeys.size,
                    minimumNewItems: 1,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    itemIndices: pageState.itemIndices,
                    logicalIndices: pageState.logicalIndices,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted),
                    pageMode: 'logical'
                });

                if (pageState.slots.length < expectedSlots || newKeys.size < 1 || !stabilizedSignature) {
                    const details = {
                        requestedPage: page,
                        actualPage: page,
                        slots: pageState.slots.length,
                        minimumSlots: expectedSlots,
                        newItemsReady: newKeys.size,
                        minimumNewItems: 1,
                        signaturePresent: Boolean(stabilizedSignature),
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        pageMode: 'logical'
                    };
                    logOperationTimeout('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                    throw initializationTimeoutError('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                }

                const added = [];
                for (const position of pageState.positions) {
                    const logicalIndex = position.logicalIndex;
                    if (!Number.isSafeInteger(logicalIndex) || logicalIndex < 0 || logicalIndex >= totalCount) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'invalid-logical-index', {
                            page,
                            itemIndex: position.itemIndex,
                            logicalIndex
                        });
                    }
                    const canonicalPage = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                    snapshotWork.metadataReads++;
                    const item = itemFromSlot(position.slot, canonicalPage, false);
                    if (!item) { snapshotWork.invalidMetadata++; continue; }
                    const key = itemKey(item);
                    const existingAtIndex = itemsByLogicalIndex.get(logicalIndex);
                    if (existingAtIndex && itemKey(existingAtIndex) !== key) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'logical-index-content-changed-during-scan', {
                            page,
                            logicalIndex,
                            previous: itemSummary(existingAtIndex),
                            current: itemSummary(item)
                        });
                    }
                    const existingIndex = videoIndex.get(key);
                    if (Number.isSafeInteger(existingIndex) && existingIndex !== logicalIndex) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'video-id-moved-during-scan', {
                            page,
                            key,
                            previousLogicalIndex: existingIndex,
                            currentLogicalIndex: logicalIndex
                        });
                    }
                    if (existingAtIndex) { snapshotWork.duplicateSnapshotsAvoided++; continue; }
                    // Capture only after identity/index consistency checks in
                    // this synchronous sample, before native navigation resumes.
                    item.snapshot = position.slot.cloneNode(true);
                    snapshotWork.snapshotsCaptured++;
                    item.logicalIndex = logicalIndex;
                    itemsByLogicalIndex.set(logicalIndex, item);
                    videoIndex.set(key, logicalIndex);
                    seenKeys.add(key);
                    added.push(item);
                }

                log(tLog('collectionPageResult'), {
                    actualPage: page,
                    added: added.length,
                    total: collectedCount(),
                    goal,
                    missing: Math.max(0, goal - collectedCount()),
                    pageMode: 'logical',
                    snapshotWork: { ...snapshotWork },
                    items: added.map(itemSummary)
                });
                if (sourceState) sourceState.collectedCount = collectedCount();
                updateStatus(formatHeaderParts(collectedCount(), totalCount, null));

                endingPage = page;
                if (collectedCount() >= goal) {
                    completionReason = 'total-count-and-logical-index-range-reached';
                    break;
                }

                previousPageSignature = stabilizedSignature;
                const rightControl = carouselMoveButton(section, scroller, 1);
                if (!rightControl.button) {
                    incomplete('advance-right', 'right-control-not-found', { selector: rightControl.selector, page });
                }
                if (carouselMoveButtonDisabled(rightControl.button)) {
                    incomplete('advance-right', 'right-edge-before-total-count', { page });
                }

                const beforeSignature = stabilizedSignature;
                await moveOnePage(section, scroller, 1, null, sessionToken);
                assertRouteSession(sessionToken);
                const afterSignature = visibleSignature(currentPageSlots(scroller, track));
                if (!afterSignature || afterSignature === beforeSignature) {
                    incomplete('advance-right', 'enabled-control-did-not-change-page', {
                        page,
                        beforeSignature,
                        afterSignature
                    });
                }
            }

            if (collectedCount() !== totalCount) {
                incomplete('validate-count', guard <= 0 ? 'guard-exhausted' : 'collected-count-mismatch', {
                    expected: totalCount,
                    actual: collectedCount()
                });
            }

            const missingLogicalIndices = [];
            for (let index = 0; index < totalCount; index++) {
                if (!itemsByLogicalIndex.has(index)) missingLogicalIndices.push(index);
            }
            if (missingLogicalIndices.length) {
                incomplete('validate-logical-index-range', 'logical-index-gap', {
                    missingLogicalIndices
                });
            }

            const items = Array.from({ length: totalCount }, (_, logicalIndex) => {
                const item = itemsByLogicalIndex.get(logicalIndex);
                item.logicalIndex = logicalIndex;
                item.page = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                return item;
            });
            const uniqueKeys = new Set(items.map(itemKey).filter(Boolean));
            if (uniqueKeys.size !== totalCount) {
                incomplete('validate-logical-index-range', 'duplicate-item-key-across-logical-indices', {
                    expected: totalCount,
                    uniqueKeys: uniqueKeys.size
                });
            }

            completionReason = completionReason || 'total-count-and-logical-index-range-reached';
            runtime.knownPageCount = estimatedPages;
            runtime.pageCountFinalized = true;
            runtime.pageMappingStale = false;
            runtime.cycleDetected = false;
            initialPage = Number.isFinite(initialPage) ? initialPage : 0;
            if (sourceState) sourceState.initialPage = initialPage;
            forceLogicalPageSignature(section, visibleSignature(currentPageSlots(scroller, track)), endingPage);
            log(tLog('logicalCarouselPagesFinalized'), {
                pageCount: runtime.knownPageCount,
                pageCountFinalized: runtime.pageCountFinalized,
                endingPage,
                initialPage,
                signatures: runtime.signatureToPage.size,
                totalCount,
                collected: items.length,
                completionReason,
                cycleDetected: runtime.cycleDetected,
                indexCoverage: `${itemsByLogicalIndex.size}/${totalCount}`
            });

            if (endingPage !== initialPage) {
                const restorationStarted = performance.now();
                const canonicalTargetTransform = stablePageTransforms.get(initialPage) || '';
                const restorationComplete = await restoreNativePageFast(
                    section,
                    scroller,
                    track,
                    items,
                    responsiveColumns,
                    initialPage,
                    canonicalTargetTransform,
                    sessionToken
                );
                log(tLog('nativeRestorationResult'), {
                    from: endingPage,
                    target: initialPage,
                    selectedPage: selectedPage(section),
                    complete: restorationComplete && selectedPage(section) === initialPage,
                    elapsedMs: Math.round(performance.now() - restorationStarted),
                    pageMode: 'logical'
                });
                if (!restorationComplete || selectedPage(section) !== initialPage) {
                    incomplete('restore-initial-page', 'native-restoration-incomplete', {
                        from: endingPage,
                        target: initialPage,
                        selectedPage: selectedPage(section)
                    });
                }
            }

            assertRouteSession(sessionToken);
            log(tLog('fullCollectionCompleted'), {
                collected: items.length,
                totalCount,
                goal,
                completionReason,
                cycleDetected: runtime.cycleDetected,
                elapsedMs: Math.round(performance.now() - started),
                endingPage,
                restoredPage: selectedPage(section),
                initialPage: sourceState?.initialPage ?? 0,
                pageMode: 'logical',
                domGeneration: runtime.profile.generation,
                snapshotWork: { ...snapshotWork },
                ids: items.map(item => item.videoId || item.href)
            });
            return items;
        } finally {
            restoreScanStyles();
            unregisterActiveCarouselStyleCleanup(restoreScanStyles);
        }
    }

    async function collectAllItems(section, scroller, track, totalCount, sessionToken = null) {
        const profile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'logical') {
            return collectAllItemsLogical(section, scroller, track, totalCount, sessionToken);
        }
        assertRouteSession(sessionToken);
        const snapshotWork = performanceDiagnostics.nativeCollection;
        const items = [];
        const seen = new Set();
        const pages = pageCount(section);
        const goal = Number.isFinite(totalCount) ? totalCount : Infinity;
        const initialCurrentSlots = currentPageSlots(scroller, track);
        const responsiveColumns = sourceState?.layout?.columns || initialCurrentSlots.length || 1;
        // A genuine one-page My List may contain fewer cards than the responsive
        // column count. waitForNativeCarouselReady() has already required that
        // one-page shape to remain stable, so use its actual mounted card count
        // as the completion target instead of waiting forever for nonexistent slots.
        const expectedPageSlots = pages === 1
            ? Math.max(1, initialCurrentSlots.length)
            : Math.max(
                1,
                Math.min(
                    responsiveColumns,
                    Number.isFinite(totalCount) ? totalCount : responsiveColumns
                )
            );
        const started = performance.now();
        const initialPage = selectedPage(section);
        if (sourceState) sourceState.initialPage = initialPage;

        log(tLog('fullCollectionStarted'), {
            totalCount,
            goal,
            pages,
            selectedPage: selectedPage(section),
            currentPageCards: currentPageSlots(scroller, track).length,
            expectedPageSlots
        });

        const scanSavedTransition = captureInlineStyleProperty(track, 'transition');
        const scanSavedAnimation = captureInlineStyleProperty(track, 'animation');
        const stablePageTransforms = new Map();
        let endingPage = initialPage;

        // Keep animation suppression active for the whole scan. This avoids paying a
        // second DOM-settle wait in moveOnePage() while still preventing native slide animation.
        const restoreScanStyles = () => {
            section.classList.remove(FAST_MOVE_CLASS);
            restoreInlineStyleProperty(track, 'transition', scanSavedTransition);
            restoreInlineStyleProperty(track, 'animation', scanSavedAnimation);
            void track.offsetWidth;
        };

        section.classList.add(FAST_MOVE_CLASS);
        track.style.setProperty('transition', 'none', 'important');
        track.style.setProperty('animation', 'none', 'important');
        void track.offsetWidth;
        registerActiveCarouselStyleCleanup(restoreScanStyles);

        try {
            assertRouteSession(sessionToken);
            const signatureBeforeStartMove = visibleSignature(currentPageSlots(scroller, track));
            await goToPage(section, scroller, 0, null, sessionToken);
            assertRouteSession(sessionToken);
            let previousPageSignature = initialPage === 0 ? '' : signatureBeforeStartMove;

            for (let page = 0; page < pages && (!Number.isFinite(goal) || items.length < goal); page++) {
                const actualPage = selectedPage(section);
                const beforeCount = items.length;
                const remaining = Number.isFinite(goal) ? Math.max(0, goal - items.length) : Infinity;
                const singlePageList = pages === 1;
                const minimumNewItems = singlePageList
                    ? expectedPageSlots
                    : (page < pages - 1
                        ? Math.min(expectedPageSlots, remaining)
                        : (Number.isFinite(remaining) ? Math.min(expectedPageSlots, remaining) : 1));
                const minimumSlots = singlePageList
                    ? expectedPageSlots
                    : (page < pages - 1
                        ? expectedPageSlots
                        : (Number.isFinite(remaining) ? Math.min(expectedPageSlots, Math.max(1, remaining)) : expectedPageSlots));
                const stabilizeStarted = performance.now();
                const slots = await waitStableCurrentPage(scroller, track, {
                    previousSignature: previousPageSignature,
                    minimumSlots,
                    minimumNewItems,
                    seenKeys: seen,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                const stabilizedSignature = visibleSignature(slots);
                const stabilizedTransform = trackTransformValue(track);
                stablePageTransforms.set(actualPage, stabilizedTransform);
                const newKeys = new Set();
                for (const slot of slots) {
                    const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const key = itemKeyFromCard(card);
                    if (key && !seen.has(key)) newKeys.add(key);
                }

                log(tLog('collectionPageStabilized'), {
                    requestedPage: page,
                    actualPage,
                    slots: slots.length,
                    minimumSlots,
                    newItemsReady: newKeys.size,
                    minimumNewItems,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted)
                });

                if (slots.length < minimumSlots || newKeys.size < minimumNewItems) {
                    warn(tLog('collectionStoppedBecauseThePageNeverReachedTheExpectedStableState'), {
                        requestedPage: page,
                        actualPage,
                        slots: slots.length,
                        minimumSlots,
                        newItemsReady: newKeys.size,
                        minimumNewItems,
                        timeoutMs: PAGE_STABLE_TIMEOUT_MS
                    });
                    break;
                }

                for (const slot of slots) {
                    if (Number.isFinite(goal) && items.length >= goal) break;
                    snapshotWork.metadataReads++;
                    const item = itemFromSlot(slot, actualPage, false);
                    if (!item) { snapshotWork.invalidMetadata++; continue; }
                    const key = itemKey(item);
                    if (seen.has(key)) { snapshotWork.duplicateSnapshotsAvoided++; continue; }
                    item.snapshot = slot.cloneNode(true);
                    snapshotWork.snapshotsCaptured++;
                    seen.add(key);
                    items.push(item);
                }

                const added = items.slice(beforeCount);
                log(tLog('collectionPageResult'), {
                    actualPage,
                    added: added.length,
                    total: items.length,
                    goal,
                    snapshotWork: { ...snapshotWork },
                    items: added.map(itemSummary)
                });

                if (sourceState) sourceState.collectedCount = items.length;
                updateStatus(formatHeaderParts(items.length, totalCount, null));

                if ((Number.isFinite(goal) && items.length >= goal) || actualPage >= pages - 1) break;
                previousPageSignature = stabilizedSignature;
                const next = await moveOnePage(section, scroller, 1, null, sessionToken);
                if (next === actualPage) {
                    warn(tLog('couldNotAdvanceDuringFullCollection'), {
                        actualPage,
                        items: items.length,
                        goal
                    });
                    break;
                }
            }

            endingPage = selectedPage(section);
            if (endingPage !== initialPage) {
                const restorationStarted = performance.now();
                const canonicalTargetTransform = stablePageTransforms.get(initialPage) || '';
                log(tLog('nativeRestorationBaselineCaptured'), {
                    from: endingPage,
                    target: initialPage,
                    pages,
                    pageCountParity: pages % 2 === 0 ? 'even' : 'odd',
                    moveCount: Math.abs(endingPage - initialPage),
                    moveCountParity: Math.abs(endingPage - initialPage) % 2 === 0 ? 'even' : 'odd',
                    canonicalTargetTransform
                });
                const restorationComplete = await restoreNativePageFast(
                    section,
                    scroller,
                    track,
                    items,
                    expectedPageSlots,
                    initialPage,
                    canonicalTargetTransform,
                    sessionToken
                );

                log(tLog('nativeRestorationResult'), {
                    from: endingPage,
                    target: initialPage,
                    selectedPage: selectedPage(section),
                    complete: restorationComplete && selectedPage(section) === initialPage,
                    elapsedMs: Math.round(performance.now() - restorationStarted)
                });

                // Keep suppression through two more paints after the expected original
                // page is mounted so deferred Netflix writes cannot animate on release.
                if (restorationComplete && selectedPage(section) === initialPage) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    assertRouteSession(sessionToken);
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    assertRouteSession(sessionToken);
                }
            }
        } finally {
            restoreScanStyles();
            unregisterActiveCarouselStyleCleanup(restoreScanStyles);
        }

        assertRouteSession(sessionToken);
        log(tLog('fullCollectionCompleted'), {
            collected: items.length,
            totalCount,
            goal,
            elapsedMs: Math.round(performance.now() - started),
            endingPage,
            restoredPage: selectedPage(section),
            initialPage,
            snapshotWork: { ...snapshotWork },
            ids: items.map(item => item.videoId || item.href)
        });
        return items;
    }

    function normalizeClone(slot) {
        slot.style.removeProperty('flex');
        slot.style.removeProperty('width');
        slot.style.removeProperty('min-width');
        slot.style.removeProperty('max-width');
        slot.style.removeProperty('transform');
        slot.style.removeProperty('translate');
        slot.style.removeProperty('opacity');
        slot.style.removeProperty('visibility');
        slot.style.removeProperty('pointer-events');

        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (card) {
            card.tabIndex = 0;
            card.setAttribute('data-tm-clone-card', 'true');
        }

        for (const image of slot.querySelectorAll('img')) {
            image.loading = 'lazy';
            image.decoding = 'async';
        }
        // Allocate the small action row inside the existing construction chunks.
        ensureManualViewingControls(slot);
    }

    function currentGridGeometry(section, layout) {
        const sectionRect = nativeRect(section);
        const left = Math.max(0, layout.gridLeft);
        const viewportRight = Math.min(window.innerWidth, sectionRect.right);
        const available = Math.max(layout.cardWidth, viewportRight - sectionRect.left - left);
        const width = Math.max(layout.cardWidth, Math.min(layout.gridWidth, available));

        // Use the currently measured native Netflix column count instead of recalculating from the startup ratio.
        return { width, left, columns: Math.max(1, layout.columns) };
    }

    function applyGridGeometry(section, grid, layout) {
        const geometry = currentGridGeometry(section, layout);
        const properties = {
            '--tm-cols': String(geometry.columns),
            '--tm-grid-width': `${geometry.width}px`,
            '--tm-grid-left': `${geometry.left}px`,
            '--tm-gap': `${layout.gap}px`
        };
        for (const [property, value] of Object.entries(properties)) {
            if (grid.style.getPropertyValue(property) !== value) grid.style.setProperty(property, value);
        }
        grid.__tmAppliedGeometry = geometry;
        return geometry;
    }

    function pairDomTrees(sourceRoot, cloneRoot) {
        const domMap = new Map();
        const pairs = [];

        function walk(source, clone) {
            if (!(source instanceof Element) || !(clone instanceof Element)) return;
            domMap.set(source, clone);
            pairs.push([source, clone]);

            const sourceChildren = source.children;
            const cloneChildren = clone.children;
            const count = Math.min(sourceChildren.length, cloneChildren.length);
            for (let i = 0; i < count; i++) walk(sourceChildren[i], cloneChildren[i]);
        }

        walk(sourceRoot, cloneRoot);
        return { domMap, pairs };
    }

    // Contains the private React-key graft used only to make cloned cards hoverable.
    const netflixReactHover = Object.freeze({
        clearClone(root) {
            const nodes = [root, ...root.querySelectorAll('*')];
            for (const node of nodes) {
                for (const key of Object.getOwnPropertyNames(node)) {
                    if (!key.startsWith('__react')) continue;
                    if (key.startsWith('__reactContainer$')) continue;
                    try { delete node[key]; } catch (_) {}
                }
            }
        },

        graftTreeToClone(sourceRoot, cloneRoot) {
            const { domMap, pairs } = pairDomTrees(sourceRoot, cloneRoot);
            const fiberMap = new Map();
            let fiberAssignments = 0;
            let propsAssignments = 0;

            function reactKeysForNode(node) {
                const keys = Object.getOwnPropertyNames(node);
                return {
                    fiberKeys: keys.filter(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')),
                    propsKeys: keys.filter(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')),
                    otherKeys: keys.filter(k =>
                        k.startsWith('__react') &&
                        !k.startsWith('__reactFiber$') &&
                        !k.startsWith('__reactInternalInstance$') &&
                        !k.startsWith('__reactProps$') &&
                        !k.startsWith('__reactEventHandlers$')
                    )
                };
            }

            function cloneFiberChain(sourceFiber) {
                if (!sourceFiber || typeof sourceFiber !== 'object') return sourceFiber;
                if (fiberMap.has(sourceFiber)) return fiberMap.get(sourceFiber);

                const clonedFiber = Object.assign(
                    Object.create(Object.getPrototypeOf(sourceFiber) || Object.prototype),
                    sourceFiber
                );
                fiberMap.set(sourceFiber, clonedFiber);

                if (sourceFiber.stateNode instanceof Node && domMap.has(sourceFiber.stateNode)) {
                    clonedFiber.stateNode = domMap.get(sourceFiber.stateNode);
                }

                // Preserve the structure that produced working hover behavior in legacy 1.2.0.
                clonedFiber.return = cloneFiberChain(sourceFiber.return);
                return clonedFiber;
            }

            for (const [source, clone] of pairs) {
                const { fiberKeys, propsKeys, otherKeys } = reactKeysForNode(source);

                for (const key of fiberKeys) {
                    try {
                        clone[key] = cloneFiberChain(source[key]);
                        fiberAssignments++;
                    } catch (error) {
                        warn(tLog('fiberGraftFailed'), key, error);
                    }
                }

                for (const key of propsKeys) {
                    try {
                        clone[key] = source[key];
                        propsAssignments++;
                    } catch (error) {
                        warn(tLog('propsGraftFailed'), key, error);
                    }
                }

                for (const key of otherKeys) {
                    if (key.startsWith('__reactContainer$')) continue;
                    try { clone[key] = source[key]; } catch (_) {}
                }
            }

            cloneRoot.setAttribute('data-tm-react-grafted', 'true');
            return { fiberAssignments, propsAssignments, clonedFibers: fiberMap.size };
        }
    });

    function findMountedSourceSlot(track, item, activeOnly = false) {
        let candidates;
        if (activeOnly && sourceState?.scroller) {
            candidates = currentPageSlots(sourceState.scroller, track);
        } else {
            candidates = netflixDom.filledSlots(track);
        }

        return candidates.find(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            if (!card) return false;
            const href = card.href || card.getAttribute('href') || '';
            if (href === item.href) return true;
            const id = videoIdFromHref(href);
            return item.videoId && id === item.videoId;
        }) || null;
    }

    function findActiveSourceSlot(item) {
        ensureLiveNativeBinding('hover-source-direct');
        if (!sourceState?.track?.isConnected || !sourceState?.scroller?.isConnected) return null;
        return findMountedSourceSlot(sourceState.track, item, true);
    }

    async function waitForMountedSourceItem(item, timeout = HOVER_SOURCE_TIMEOUT_MS, activeOnly = true, sessionToken = null, token = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-source-wait');
        let track = sourceState?.track;
        const start = performance.now();
        let slot = null;
        while (performance.now() - start < timeout) {
            assertRouteSession(sessionToken);
            if (hoverPreparationCancelled(token)) return null;
            if (!track?.isConnected || sourceState?.track !== track) {
                ensureLiveNativeBinding('hover-source-wait-disconnected');
                track = sourceState?.track;
            }
            if (!track) return null;
            slot = findMountedSourceSlot(track, item, activeOnly);
            if (slot) return slot;
            await sleep(HOVER_SOURCE_INTERVAL_MS);
            assertRouteSession(sessionToken);
        }
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-source-wait-final');
        track = sourceState?.track;
        return track ? findMountedSourceSlot(track, item, activeOnly) : null;
    }

    function viewportPageSlots(scroller, track, columns = sourceState?.layout?.columns || 1) {
        const all = netflixDom.filledSlots(track);
        if (!all.length) return [];
        const count = Math.max(1, columns || 1);
        const sr = scroller.getBoundingClientRect();
        const visible = all
            .map(slot => ({ slot, rect: slot.getBoundingClientRect() }))
            .filter(entry => {
                const cx = entry.rect.left + entry.rect.width / 2;
                return entry.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            })
            .sort((a, b) => a.rect.left - b.rect.left)
            .map(entry => entry.slot);

        if (visible.length) return visible.slice(0, count);

        const fallback = currentPageSlots(scroller, track)
            .slice()
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        return fallback.slice(0, count);
    }

    async function resolveExpectedPageSourceItem(item, expectedPage = item.page, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
        ensureLiveNativeBinding('hover-expected-page-start');
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        let { section, scroller, track } = sourceState || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            return { status: 'unknown', reason: 'native-binding-unavailable' };
        }

        const columns = Math.max(1, sourceState?.layout?.columns || 1);
        const legacyItemCount = sourceState?.items?.length ?? 0;
        const expectedPageCount = Math.max(1, Math.ceil(Math.max(legacyItemCount, 1) / columns));
        const nativePageCount = pageCount(section);
        if (nativePageCount !== expectedPageCount || expectedPage < 0 || expectedPage >= nativePageCount) {
            log(tLog('hoverExpectedPageUnknown'), {
                reason: 'page-count-not-converged',
                item: itemSummary(item),
                expectedPage,
                nativePageCount,
                expectedPageCount,
                legacyItemCount,
                columns
            });
            return { status: 'unknown', reason: 'page-count-not-converged' };
        }

        const selectedBefore = selectedPage(section);
        const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
        await goToPage(section, scroller, expectedPage, token, sessionToken, true);
        if (token !== null && token !== hoverToken) {
            return { status: 'unknown', reason: 'token-changed-after-page-move' };
        }

        ensureLiveNativeBinding('hover-expected-page-after-move');
        ({ section, scroller, track } = sourceState || {});
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            return { status: 'unknown', reason: 'native-binding-lost-after-page-move' };
        }
        if (selectedPage(section) !== expectedPage) {
            log(tLog('hoverExpectedPageUnknown'), {
                reason: 'expected-page-not-reached',
                item: itemSummary(item),
                expectedPage,
                selectedPage: selectedPage(section)
            });
            return { status: 'unknown', reason: 'expected-page-not-reached' };
        }

        let pageSlots = viewportPageSlots(scroller, track, columns);
        let slot = pageSlots.find(sourceSlot => {
            const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return itemKeyFromCard(card) === itemKey(item);
        }) || null;
        if (slot) {
            trace(() => [tLog('hoverExpectedPageMatch'), {
                item: itemSummary(item),
                expectedPage,
                selectedPage: selectedPage(section),
                source: slotDescriptor(slot)
            }]);
            return { status: 'found', slot, page: expectedPage, slots: pageSlots };
        }

        const expectedPageItemCount = pageItemKeys(sourceState?.items || [], expectedPage).size;
        const minimumSlots = Math.min(columns, Math.max(1, expectedPageItemCount));
        const stableSlots = await waitStableCurrentPage(scroller, track, {
            previousSignature: selectedBefore === expectedPage ? '' : beforeSignature,
            requiredStableFrames: 2,
            minimumSlots,
            requiredKeys: new Set([itemKey(item)]),
            timeout: 650,
            sessionToken,
            hoverToken: token
        });
        if (token !== null && token !== hoverToken) {
            return { status: 'unknown', reason: 'token-changed-after-stability-wait' };
        }
        if (selectedPage(section) !== expectedPage) {
            return { status: 'unknown', reason: 'page-changed-during-stability-wait' };
        }

        pageSlots = viewportPageSlots(scroller, track, columns);
        slot = pageSlots.find(sourceSlot => {
            const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return itemKeyFromCard(card) === itemKey(item);
        }) || null;
        if (slot) {
            trace(() => [tLog('hoverExpectedPageMatch'), {
                item: itemSummary(item),
                expectedPage,
                selectedPage: selectedPage(section),
                source: slotDescriptor(slot),
                afterStabilityWait: true
            }]);
            return { status: 'found', slot, page: expectedPage, slots: pageSlots };
        }

        const visibleSlots = pageSlots.length ? pageSlots : (stableSlots?.length ? stableSlots.slice(0, columns) : []);
        const visibleIds = visibleSlots
            .map(sourceSlot => videoIdFromHref(sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || ''))
            .filter(Boolean);
        if (visibleSlots.length < minimumSlots || visibleIds.length < minimumSlots) {
            log(tLog('hoverExpectedPageUnknown'), {
                reason: 'expected-page-not-fully-mounted',
                item: itemSummary(item),
                expectedPage,
                minimumSlots,
                slots: visibleSlots.length,
                visibleIds
            });
            return { status: 'unknown', reason: 'expected-page-not-fully-mounted', visibleIds };
        }

        const positionMismatch = firstVisibleNativePositionMismatch(visibleSlots);
        if (positionMismatch) {
            log('Native My List position mismatch detected before source search', {
                item: itemSummary(positionMismatch.item),
                expectedPage,
                expectedIndex: positionMismatch.deviation.expectedIndex,
                actualIndex: positionMismatch.deviation.actualIndex,
                delta: positionMismatch.deviation.delta,
                threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
                visibleIds
            });
            return {
                status: 'mismatch',
                reason: 'position-deviation-before-source-search',
                visibleIds,
                positionMismatch
            };
        }

        log(tLog('hoverExpectedPageMismatch'), {
            item: itemSummary(item),
            expectedPage,
            visibleIds
        });
        return { status: 'mismatch', reason: 'target-not-in-expected-page', visibleIds };
    }

    function nativePositionDeviation(item, slot) {
        if (!item || !slot || !sourceState?.items?.length) return null;
        const expectedIndexFromItems = sourceState.items.indexOf(item);
        const expectedIndex = Number.isSafeInteger(expectedIndexFromItems) && expectedIndexFromItems >= 0
            ? expectedIndexFromItems
            : item.logicalIndex;
        const actualIndex = netflixReactCarousel.readItemIndex(slot).value;
        if (!Number.isSafeInteger(expectedIndex) || expectedIndex < 0 ||
            !Number.isSafeInteger(actualIndex) || actualIndex < 0) {
            return null;
        }
        return {
            expectedIndex,
            actualIndex,
            delta: actualIndex - expectedIndex,
            absoluteDelta: Math.abs(actualIndex - expectedIndex)
        };
    }

    function firstVisibleNativePositionMismatch(slots) {
        for (const slot of slots || []) {
            const visibleItem = findItemForSourceSlot(slot);
            const deviation = nativePositionDeviation(visibleItem, slot);
            if (!deviation || deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) continue;
            return { item: visibleItem, slot, deviation };
        }
        return null;
    }

    function rejectLargeNativePositionDeviation(item, slot, expectedPage, visibleIds = []) {
        const deviation = nativePositionDeviation(item, slot);
        if (!deviation || deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) return false;
        const actualVideoId = videoIdFromHref(slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || '');
        const diagnostic = {
            item: itemSummary(item),
            expectedPage,
            expectedIndex: deviation.expectedIndex,
            actualIndex: deviation.actualIndex,
            delta: deviation.delta,
            threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
            source: slotDescriptor(slot)
        };
        warn('Native My List position deviates beyond order-mismatch threshold', diagnostic);
        showOrderMismatchDialog(
            item,
            expectedPage,
            [...new Set([...visibleIds, actualVideoId].filter(Boolean))]
        );
        return true;
    }

    async function refreshStaleSourceOnPreferredPage(item, preferredPage = item.page, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        const rebound = ensureLiveNativeBinding('hover-stale-refresh-start');
        let section = rebound?.section || sourceState?.section;
        let scroller = rebound?.scroller || sourceState?.scroller;
        let track = rebound?.track || sourceState?.track;
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;

        const total = pageCount(section);
        if (total <= 0) return null;
        await goToPage(section, scroller, preferredPage, token, sessionToken, true);
        if (token !== null && token !== hoverToken) return null;

        let slot = findMountedSourceSlot(track, item, true);
        if (slot) return { slot, page: selectedPage(section), refreshed: false };

        // A My List delta can leave the preferred Hawkins page temporarily empty
        // even though its logical page number is already selected. Nudge the ring by
        // one page and return immediately; this is enough to make React commit the
        // new virtual itemIndex set without scanning the whole carousel.
        if (total > 1 && selectedPage(section) === preferredPage) {
            const from = selectedPage(section);
            const moved = await moveOnePage(section, scroller, 1, token, sessionToken);
            if (token !== null && token !== hoverToken) return null;
            if (moved !== from) {
                await moveOnePage(section, scroller, -1, token, sessionToken);
                if (token !== null && token !== hoverToken) return null;
            }
        }

        const live = ensureLiveNativeBinding('hover-stale-refresh-after-pulse');
        section = live?.section || sourceState?.section;
        scroller = live?.scroller || sourceState?.scroller;
        track = live?.track || sourceState?.track;
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;

        await goToPage(section, scroller, preferredPage, token, sessionToken, true);
        if (token !== null && token !== hoverToken) return null;
        slot = await waitForMountedSourceItem(item, 700, true, sessionToken, token);
        if (token !== null && token !== hoverToken) return null;
        if (!slot) return null;

        trace(() => ['Hover stale logical page refreshed without full carousel scan', {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            source: slotDescriptor(slot)
        }]);
        return { slot, page: selectedPage(section), refreshed: true };
    }

    async function locateActiveSourceItem(item, preferredPage = item.page, token = null, sessionToken = null, repairLogicalMapping = true, maxRadius = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-locate-start');
        let { section, scroller, track } = sourceState || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;
        const total = pageCount(section);
        const tried = new Set();
        const order = [];

        const push = p => {
            if (p < 0 || p >= total || tried.has(p)) return;
            tried.add(p);
            order.push(p);
        };

        push(preferredPage);
        const radiusLimit = Number.isFinite(maxRadius)
            ? Math.min(Math.max(0, Math.floor(maxRadius)), Math.max(0, total - 1))
            : Math.max(0, total - 1);
        for (let delta = 1; delta <= radiusLimit; delta++) {
            push(preferredPage + delta);
            push(preferredPage - delta);
        }

        log(tLog('hoverSourceSearchStarted'), {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            pages: total,
            order
        });

        for (const page of order) {
            assertRouteSession(sessionToken);
            if (hoverPreparationCancelled(token)) return null;
            const rebound = ensureLiveNativeBinding('hover-locate-page');
            if (rebound?.section && rebound?.scroller && rebound?.track) {
                section = rebound.section;
                scroller = rebound.scroller;
                track = rebound.track;
            }
            if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;
            const beforeSig = visibleSignature(currentPageSlots(scroller, track));
            log(tLog('hoverSourceSearchPage'), {
                item: itemSummary(item),
                page,
                selectedBefore: selectedPage(section)
            });

            await goToPage(section, scroller, page, token, sessionToken, true);
            if (token !== null && token !== hoverToken) {
                log(tLog('hoverSourceSearchCancelled'), { reason: 'token-changed-after-page-move', token, hoverToken });
                return null;
            }

            let slot = await waitForMountedSourceItem(
                item,
                page === preferredPage ? HOVER_SOURCE_TIMEOUT_MS : 280,
                true,
                sessionToken,
                token
            );
            if (token !== null && token !== hoverToken) {
                log(tLog('hoverSourceSearchCancelled'), { reason: 'token-changed-after-mount-wait', token, hoverToken });
                return null;
            }

            if (!slot) {
                await waitStableCurrentPage(scroller, track, {
                    previousSignature: beforeSig,
                    minElapsed: 120,
                    timeout: 520,
                    sessionToken,
                    hoverToken: token
                });
                if (hoverPreparationCancelled(token)) return null;
                slot = findMountedSourceSlot(track, item, true);
            }

            if (slot) {
                const actual = selectedPage(section);
                const runtime = getCarouselDomRuntime(section);
                const visibleSlots = viewportPageSlots(scroller, track, Math.max(1, sourceState?.layout?.columns || 1));
                const signature = visibleSignature(visibleSlots);
                if (repairLogicalMapping && runtime?.profile?.pageMode === 'logical' && signature) {
                    registerLogicalPageSignature(section, signature, actual);
                }
                if (repairLogicalMapping) {
                    for (const visibleSlot of visibleSlots) {
                        const visibleItem = findItemForSourceSlot(visibleSlot);
                        if (!visibleItem) continue;
                        const oldPage = visibleItem.page;
                        if (oldPage === actual) continue;
                        visibleItem.page = actual;
                        const visibleClone = findGridClone(visibleItem);
                        if (visibleClone) visibleClone.setAttribute('data-tm-item-page', String(actual));
                        log(tLog('itemPageMappingCorrected'), {
                            item: itemSummary(visibleItem),
                            oldPage,
                            actualPage: actual,
                            reason: 'logical-visible-page-repair'
                        });
                    }
                }
                trace(() => [tLog('hoverSourceFound'), {
                    item: itemSummary(item),
                    actualPage: actual,
                    source: slotDescriptor(slot)
                }]);
                return { slot, page: actual };
            }
        }

        warn(tLog('hoverSourceSearchFailed'), {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            pages: total
        });
        return null;
    }

    function copyItemAttributes(target, item, index = null) {
        if (index !== null) target.setAttribute('data-tm-item-order', String(index));
        target.setAttribute('data-tm-item-page', String(item.page));
        target.setAttribute('data-tm-item-video-id', item.videoId || '');
        target.__tmMyListItem = item;
    }

    function findGridClone(item) {
        return sourceState?.cloneMap?.get(itemKey(item)) || null;
    }

    function setGridClone(item, clone) {
        if (!sourceState?.cloneMap) return;
        const previous = findGridClone(item);
        if (previous && previous !== clone) releaseGridReact(previous);
        sourceState.cloneMap.set(itemKey(item), clone);
        if (sourceState.watchStatus) {
            syncManualViewingCard(sourceState, clone, item, effectiveViewingStatus(sourceState.watchStatus, String(item.videoId)));
            const entry = sourceState.watchStatus.groupIndex?.entries.get(String(item.videoId));
            if (entry) entry.clone = clone;
        }
        if (clone?.getAttribute('data-tm-react-grafted') === 'true') graftedGridClones.add(clone);
    }

    function findItemForSourceSlot(slot) {
        const card = slot?.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card || !sourceState?.itemMap) return null;
        return sourceState.itemMap.get(itemKeyFromCard(card)) || null;
    }

    function releaseGridReact(clone) {
        if (!clone || !graftedGridClones.delete(clone)) return;
        netflixReactHover.clearClone(clone);
        clone.removeAttribute('data-tm-hover-ready');
        clone.removeAttribute('data-tm-backed-page');
        clone.removeAttribute('data-tm-react-grafted');
    }

    function invalidateGridReact(except = null) {
        for (const clone of graftedGridClones) {
            if (clone !== except || !clone.isConnected) releaseGridReact(clone);
        }
    }

    function restoreGeometryProxy() {
        const proxy = activeGeometryProxy;
        if (!proxy) return;
        let failures = 0;

        for (const entry of proxy.entries) {
            for (const method of ['getBoundingClientRect', 'getClientRects']) {
                const descriptor = entry.descriptors[method];
                try {
                    if (descriptor) {
                        Object.defineProperty(entry.source, method, descriptor);
                    } else {
                        if (!delete entry.source[method]) failures++;
                    }
                } catch (_) { failures++; }
            }
        }

        proxy.sourceSlot.removeAttribute('data-tm-source-proxied');
        activeGeometryProxy = null;
        performanceDiagnostics.nativeRecovery.alignmentRestores++;
        if (failures) {
            performanceDiagnostics.nativeRecovery.alignmentRestoreFailures += failures;
            warn(tLog('sourceAlignmentRestoreFailed'), { methods: failures, nodes: proxy.entries.length });
        }
    }

    function clearSourceAlignment(slot = activeSourceSlot, reason = 'source-release', relatedTarget = null) {
        releaseNativeHover(reason, relatedTarget);
        invalidateNativeReadScope();
        restoreGeometryProxy();
        if (slot?.hasAttribute?.('data-tm-source-aligned')) {
            // Clean up transforms left by legacy 2.1 when updating the script without a full page reload.
            slot.style.removeProperty('transform');
            slot.style.removeProperty('transform-origin');
            slot.style.removeProperty('z-index');
            slot.removeAttribute('data-tm-source-aligned');
        }
        if (!slot || slot === activeSourceSlot) activeSourceSlot = null;
    }

    function makeClientRectList(rect) {
        const list = [rect];
        list.item = index => list[index] || null;
        return list;
    }

    function releaseNativeHover(reason = 'source-release', relatedTarget = null) {
        const owner = activeNativeHover;
        if (!owner) return;
        // Clear ownership first: native exit handlers can synchronously cause another cleanup.
        activeNativeHover = null;
        const { counters, timing, card, coordinates } = owner;
        const started = performance.now();
        counters.lastExitReason = reason;
        try {
            if (!nativeHoverSourceMatches(owner)) {
                counters.exitSkipped++;
                return;
            }
            // React derives leave events from bubbling out events. Send them while
            // the source still has grid geometry, before removing its coordinate proxy.
            const common = { ...coordinates, relatedTarget };
            let dispatched = false;
            if (typeof PointerEvent === 'function') {
                try {
                    card.dispatchEvent(new PointerEvent('pointerout', { ...common,
                        pointerId: 1, pointerType: 'mouse', isPrimary: true }));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            }
            if (nativeHoverSourceMatches(owner) && activeNativeHover === null) {
                try {
                    card.dispatchEvent(new MouseEvent('mouseout', common));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            } else counters.exitSkipped++;
            if (dispatched) {
                counters.exitsDispatched++;
                if (reason === 'scroll') counters.scrollExits++;
            }
        } catch (_) { counters.exitFailed++; }
        finally { recordHoverTiming(timing, 'exit', started); }
    }

    function nativeHoverSourceMatches(owner) {
        return owner.card.isConnected && owner.sourceSlot.isConnected && Boolean(owner.videoId) &&
            owner.sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) === owner.card &&
            videoIdFromHref(owner.card.href || owner.card.getAttribute('href') || '') === owner.videoId;
    }

    function alignSourceSlotToClone(sourceSlot, clone) {
        if (!sourceSlot?.isConnected || !clone?.isConnected) return false;

        const sourceItem = findItemForSourceSlot(sourceSlot);
        if (!sourceItem || findActiveSourceSlot(sourceItem) !== sourceSlot) return false;

        clearSourceAlignment();

        const { pairs } = pairDomTrees(sourceSlot, clone);
        const entries = [];
        for (const [source, target] of pairs) {
            if (!(source instanceof Element) || !(target instanceof Element)) continue;

            const descriptors = {
                getBoundingClientRect: Object.getOwnPropertyDescriptor(source, 'getBoundingClientRect') || null,
                getClientRects: Object.getOwnPropertyDescriptor(source, 'getClientRects') || null
            };

            try {
                Object.defineProperty(source, 'getBoundingClientRect', {
                    configurable: true,
                    value: () => target.getBoundingClientRect()
                });
                Object.defineProperty(source, 'getClientRects', {
                    configurable: true,
                    value: () => makeClientRectList(target.getBoundingClientRect())
                });
                entries.push({ source, descriptors });
            } catch (_) {
                for (const method of ['getBoundingClientRect', 'getClientRects']) {
                    try {
                        if (descriptors[method]) Object.defineProperty(source, method, descriptors[method]);
                        else delete source[method];
                    } catch (_) {}
                }
            }
        }

        if (!entries.length) return false;

        sourceSlot.setAttribute('data-tm-source-proxied', 'true');
        activeGeometryProxy = { sourceSlot, clone, entries };
        activeSourceSlot = sourceSlot;
        return true;
    }

    function replayHoverOnNativeSource(sourceSlot, triggerEvent) {
        if (!sourceSlot?.isConnected) return false;
        const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) || sourceSlot;
        const rect = card.getBoundingClientRect();
        const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        const currentPointer = lastPointerX !== -1 && lastPointerY !== -1 && inside(lastPointerX, lastPointerY);
        const originalPointer = inside(triggerEvent?.clientX, triggerEvent?.clientY);
        const x = currentPointer ? lastPointerX : originalPointer ? triggerEvent.clientX : rect.left + rect.width / 2;
        const y = currentPointer ? lastPointerY : originalPointer ? triggerEvent.clientY : rect.top + rect.height / 2;

        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            screenX: Number.isFinite(triggerEvent?.screenX) && Number.isFinite(triggerEvent?.clientX)
                ? triggerEvent.screenX + x - triggerEvent.clientX : x,
            screenY: Number.isFinite(triggerEvent?.screenY) && Number.isFinite(triggerEvent?.clientY)
                ? triggerEvent.screenY + y - triggerEvent.clientY : y,
            relatedTarget: null
        };

        const owner = { card, sourceSlot, coordinates: common, token: hoverToken, sessionToken: routeSessionToken,
            videoId: videoIdFromHref(card.href || card.getAttribute('href') || ''),
            counters: performanceDiagnostics.hoverLifecycle, timing: performanceDiagnostics.hoverTiming };
        releaseNativeHover('replaced');
        activeNativeHover = owner;
        const stillActive = () => activeNativeHover === owner && !hoverPreparationCancelled(owner.token) &&
            isRouteSessionActive(owner.sessionToken) && nativeHoverSourceMatches(owner);
        try {
            card.dispatchEvent(new PointerEvent('pointerover', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            if (!stillActive()) return false;
            card.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mouseover', common));
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mousemove', common));
        return stillActive();
    }

    function releaseFailedGridHover(clone, token) {
        if (!clone || token !== hoverToken || activeClone !== clone) return;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
    }

    function scheduleNativeHoverReplay(sourceSlot, item, clone, triggerEvent, actualPage, reason,
        token = hoverToken, sessionToken = routeSessionToken) {
        const generation = clone?.__tmHoverActivationGeneration;
        const counters = performanceDiagnostics.hoverLifecycle;
        const timing = performanceDiagnostics.hoverTiming;
        return new Promise(resolve => requestAnimationFrame(() => {
            const finish = success => {
                if (!success) releaseFailedGridHover(clone, token);
                resolve(success);
            };
            try {
                if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    !gridHoverTargetActive(clone, generation) ||
                    activeClone !== clone || activeVideoId !== item.videoId) {
                    counters.replayCancelled++;
                    return finish(false);
                }
                counters.replayAttempts++;
                if (!sourceSlot?.isConnected) { counters.replayFailed++; return finish(false); }

                const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const sourceVideoId = videoIdFromHref(card?.href || card?.getAttribute?.('href') || '');
                // Native visibility/page reads need original source geometry, not
                // the grid rectangles installed for Netflix's popup placement.
                clearSourceAlignment();
                const alignmentStarted = performance.now();
                let failureReason;
                try {
                    failureReason = withNativeReadScope(() => {
                        if (!sourceVideoId || sourceVideoId !== item.videoId) return 'source-video-id-mismatch';
                        if (findActiveSourceSlot(item) !== sourceSlot) return 'source-no-longer-active';
                        return alignSourceSlotToClone(sourceSlot, clone) ? '' : 'source-alignment-failed';
                    });
                } finally { recordHoverTiming(timing, 'alignment', alignmentStarted); }
                if (failureReason) {
                    counters.replayFailed++;
                    warn(tLog('nativeHoverReplayCancelled'), {
                        reason: failureReason,
                        targetVideoId: item.videoId,
                        sourceVideoId,
                        source: slotDescriptor(sourceSlot)
                    });
                    return finish(false);
                }

                const replayStarted = performance.now();
                let replayed;
                try { replayed = replayHoverOnNativeSource(sourceSlot, triggerEvent); }
                finally { recordHoverTiming(timing, 'replay', replayStarted); }
                if (replayed) counters.replaysDispatched++;
                else counters.replayCancelled++;
                if (replayed) trace(() => [tLog('nativeHoverReplayedFromLiveSource'), {
                    item: itemSummary(item),
                    actualPage,
                    reason,
                    triggerEvent: triggerEvent?.type || '',
                    source: slotDescriptor(sourceSlot)
                }]);
                finish(Boolean(replayed));
            } catch (error) {
                counters.replayFailed++;
                warn(tLog('nativeHoverReplayCancelled'), { reason: 'replay-failed', item: itemSummary(item), error });
                finish(false);
            }
        }));
    }

    function makeLiveClone(sourceSlot, item, oldClone, actualPage) {
        // Keep the legacy 1.2.0 order: clone the live source, graft React data, then insert into the DOM.
        const fresh = sourceSlot.cloneNode(true);
        const stats = netflixReactHover.graftTreeToClone(sourceSlot, fresh);
        normalizeClone(fresh);

        const order = oldClone?.getAttribute('data-tm-item-order');
        copyItemAttributes(fresh, item, order === null || order === undefined ? null : Number(order));
        fresh.setAttribute('data-tm-hover-ready', String(Boolean(stats?.fiberAssignments || stats?.propsAssignments)));
        fresh.setAttribute('data-tm-backed-page', String(actualPage));
        fresh.__tmHoverActivationGeneration = oldClone?.__tmHoverActivationGeneration;
        if (oldClone?.getAttribute('data-tm-type-hidden') === 'true') fresh.setAttribute('data-tm-type-hidden', 'true');
        else fresh.removeAttribute('data-tm-type-hidden');
        if (oldClone?.getAttribute('data-tm-preparing') === 'true' &&
            oldClone.getAttribute('data-tm-hover-token') === String(hoverToken)) {
            fresh.setAttribute('data-tm-preparing', 'true');
            fresh.setAttribute('data-tm-hover-token', String(hoverToken));
        }
        ensureGridHoverBehavior(sourceState.grid);
        associateGridHoverItem(item, fresh);
        return { fresh, stats };
    }

    async function prepareMountedPage(page, targetItem = null, triggerEvent = null, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        performanceDiagnostics.hoverPreparation.calls++;
        const hoverTiming = performanceDiagnostics.hoverTiming;
        ensureLiveNativeBinding('hover-prepare-start');
        const { section, scroller, track } = sourceState || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'native-binding-unavailable',
                targetItem: itemSummary(targetItem),
                requestedPage: page
            });
            return null;
        }
        const beforeSignature = targetItem ? '' : visibleSignature(currentPageSlots(scroller, track));
        const started = performance.now();

        log(tLog('nativePagePreparationStarted'), {
            requestedPage: page,
            targetItem: itemSummary(targetItem),
            triggerEvent: triggerEvent?.type || '',
            token,
            hoverToken
        });

        let targetSourceSlot = null;
        let resolvedPageSlots = null;
        let actualPage = page;
        let staleSourceRecovery = false;

        if (targetItem) {
            let located = await resolveExpectedPageSourceItem(targetItem, page, token, sessionToken);
            if (token !== null && token !== hoverToken) {
                log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-expected-page-check', token, hoverToken });
                return null;
            }

            if (located?.status === 'mismatch') {
                if (located.positionMismatch) {
                    warn('Native My List position mismatch escalated without source search', {
                        targetItem: itemSummary(targetItem),
                        mismatchItem: itemSummary(located.positionMismatch.item),
                        requestedPage: page,
                        expectedIndex: located.positionMismatch.deviation.expectedIndex,
                        actualIndex: located.positionMismatch.deviation.actualIndex,
                        delta: located.positionMismatch.deviation.delta,
                        threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
                        visibleIds: located.visibleIds || []
                    });
                    showOrderMismatchDialog(
                        located.positionMismatch.item || targetItem,
                        page,
                        located.visibleIds || []
                    );
                    return null;
                }
                // Immediately after a manual reinitialization, Hawkins can expose a
                // stable adjacent-page window for one render cycle. Give the target
                // one bounded re-resolution before treating it as a real order change.
                log('Retrying expected native page after transient page mismatch', {
                    targetItem: itemSummary(targetItem),
                    requestedPage: page,
                    visibleIds: located.visibleIds || []
                });
                await sleep(120);
                located = await resolveExpectedPageSourceItem(targetItem, page, token, sessionToken);
                if (token !== null && token !== hoverToken) {
                    log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-mismatch-retry', token, hoverToken });
                    return null;
                }
                if (located?.positionMismatch) {
                    warn('Native My List position mismatch escalated without source search', {
                        targetItem: itemSummary(targetItem),
                        mismatchItem: itemSummary(located.positionMismatch.item),
                        requestedPage: page,
                        expectedIndex: located.positionMismatch.deviation.expectedIndex,
                        actualIndex: located.positionMismatch.deviation.actualIndex,
                        delta: located.positionMismatch.deviation.delta,
                        threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
                        visibleIds: located.visibleIds || []
                    });
                    showOrderMismatchDialog(
                        located.positionMismatch.item || targetItem,
                        page,
                        located.visibleIds || []
                    );
                    return null;
                }
            }

            if (located?.status === 'found' && located.slot) {
                if (rejectLargeNativePositionDeviation(targetItem, located.slot, page)) return null;
                mutationSourceRecoveryPending = false;
                targetSourceSlot = located.slot;
                resolvedPageSlots = located.slots || null;
                actualPage = located.page;
            } else {
                const runtime = getCarouselDomRuntime(section);
                const staleLogicalMapping = runtime?.profile?.pageMode === 'logical' && runtime.pageMappingStale;
                const mutationRecoveryPending = mutationSourceRecoveryPending;
                const expectedPageMismatch = located?.status === 'mismatch';
                if (staleLogicalMapping || mutationRecoveryPending || expectedPageMismatch) {
                    log('Hover expected-page mapping is stale; searching live native source', {
                        targetItem: itemSummary(targetItem),
                        requestedPage: page,
                        locatedStatus: located?.status || null,
                        locatedReason: located?.reason || null,
                        mutationRecoveryPending,
                        expectedPageMismatch,
                        visibleIds: located?.visibleIds || []
                    });
                    let repaired = await refreshStaleSourceOnPreferredPage(targetItem, page, token, sessionToken);
                    if (token !== null && token !== hoverToken) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-refresh', token, hoverToken });
                        return null;
                    }
                    if (!repaired?.slot) {
                        repaired = await locateActiveSourceItem(
                            targetItem,
                            page,
                            token,
                            sessionToken,
                            expectedPageMismatch || mutationRecoveryPending,
                            mutationSourceRecoveryPending ? null : 2
                        );
                    }
                    if (token !== null && token !== hoverToken) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-search', token, hoverToken });
                        return null;
                    }
                    if (repaired?.slot) {
                        if (rejectLargeNativePositionDeviation(targetItem, repaired.slot, page, located?.visibleIds || [])) return null;
                        mutationSourceRecoveryPending = false;
                        staleSourceRecovery = true;
                        targetSourceSlot = repaired.slot;
                        actualPage = repaired.page;
                        const liveScroller = sourceState?.scroller || scroller;
                        const liveTrack = sourceState?.track || track;
                        resolvedPageSlots = viewportPageSlots(
                            liveScroller,
                            liveTrack,
                            Math.max(1, sourceState?.layout?.columns || 1)
                        );
                        trace(() => ['Hover source recovered from stale logical page mapping', {
                            targetItem: itemSummary(targetItem),
                            requestedPage: page,
                            actualPage,
                            source: slotDescriptor(targetSourceSlot)
                        }]);
                    } else {
                        const promptSuppression = orderMismatchPromptSuppressionState();
                        if (promptSuppression.suppress) {
                            log(tLog('nativePagePreparationCancelled'), {
                                reason: 'logical-page-mapping-stale-source-not-found-transient',
                                targetItem: itemSummary(targetItem),
                                requestedPage: page,
                                locatedReason: located?.reason || null,
                                visibleIds: located?.visibleIds || [],
                                promptSuppression
                            });
                            return null;
                        }

                        log('Stale logical page recovery exhausted; escalating to reinitialization prompt', {
                            targetItem: itemSummary(targetItem),
                            requestedPage: page,
                            locatedReason: located?.reason || null,
                            visibleIds: located?.visibleIds || [],
                            promptSuppression
                        });
                        showOrderMismatchDialog(targetItem, page, located?.visibleIds || []);
                        return null;
                    }
                } else {
                    log(tLog('nativePagePreparationCancelled'), {
                        reason: located?.reason || 'expected-page-check-inconclusive',
                        targetItem: itemSummary(targetItem),
                        requestedPage: page
                    });
                    return null;
                }
            }
        } else {
            await goToPage(section, scroller, page, token, sessionToken, true);
            if (token !== null && token !== hoverToken) return null;
            await waitStableCurrentPage(scroller, track, {
                previousSignature: beforeSignature,
                minElapsed: 160,
                sessionToken,
                hoverToken: token
            });
            if (hoverPreparationCancelled(token)) return null;
            actualPage = selectedPage(section);
        }

        trace(() => [tLog('nativePagePreparationPositionResolved'), {
            requestedPage: page,
            actualPage,
            selectedPage: selectedPage(section),
            currentSlots: (resolvedPageSlots || currentPageSlots(scroller, track)).length,
            targetSource: slotDescriptor(targetSourceSlot)
        }]);

        invalidateGridReact();
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = actualPage;

        const slots = resolvedPageSlots || currentPageSlots(scroller, track);
        const runtime = getCarouselDomRuntime(section);
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const logicalPositions = logicalMode
            ? logicalSlotPositions(slots, sourceState?.items?.length || 0)
            : [];
        const wrappedTail = logicalMode
            ? wrappedTailLogicalPageInfo(logicalPositions, sourceState?.items?.length || 0, Math.max(1, sourceState?.layout?.columns || 1))
            : null;
        const wrappedTailBufferStart = wrappedTail && actualPage === wrappedTail.page
            ? wrappedTail.wrapIndex
            : -1;

        let freshTarget = null;
        let refreshedCount = 0;
        let fiberAssignments = 0;
        let propsAssignments = 0;
        let neighborsSkipped = 0;

        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            const sourceSlot = slots[slotIndex];
            performanceDiagnostics.hoverPreparation.slotsConsidered++;

            // A wrapped Hawkins tail can temporarily append page-0 cards after
            // totalCount-1 (for example 32,33,34,35,36,0). Those slots are ring
            // buffers, not members of the logical last page. Never re-page or graft
            // them into the legacy grid as if they belonged to actualPage.
            if (wrappedTailBufferStart >= 0 && slotIndex >= wrappedTailBufferStart) continue;

            const pageItem = findItemForSourceSlot(sourceSlot);
            if (!pageItem) continue;

            if (!staleSourceRecovery && pageItem.page !== actualPage) {
                pageItem.page = actualPage;
                const mappedClone = findGridClone(pageItem);
                if (mappedClone?.isConnected) mappedClone.setAttribute('data-tm-item-page', String(actualPage));
            }

            if (targetItem && itemKey(pageItem) !== itemKey(targetItem)) {
                neighborsSkipped++;
                performanceDiagnostics.hoverPreparation.neighborsSkipped++;
                continue;
            }

            const oldClone = findGridClone(pageItem);
            if (!oldClone?.isConnected) continue;

            const graftStarted = performance.now();
            let fresh, stats;
            try { ({ fresh, stats } = makeLiveClone(sourceSlot, pageItem, oldClone, actualPage)); }
            finally { recordHoverTiming(hoverTiming, 'graft', graftStarted); }
            refreshedCount++;
            performanceDiagnostics.hoverPreparation.clonesRebuilt++;
            fiberAssignments += stats?.fiberAssignments || 0;
            propsAssignments += stats?.propsAssignments || 0;
            fresh.setAttribute('data-tm-item-page', String(pageItem.page));
            fresh.setAttribute('data-tm-backed-page', String(actualPage));
            oldClone.replaceWith(fresh);
            setGridClone(pageItem, fresh);

            if (targetItem && itemKey(pageItem) === itemKey(targetItem)) {
                freshTarget = fresh;
                targetSourceSlot = sourceSlot;
            }
        }

        log(tLog('nativePageClonesUpdated'), {
            actualPage,
            refreshedCount,
            preparationScope: targetItem ? 'target-card' : 'mounted-page',
            slotsConsidered: slots.length,
            neighborsSkipped,
            fiberAssignments,
            propsAssignments,
            targetItem: itemSummary(targetItem),
            targetFound: Boolean(freshTarget && targetSourceSlot)
        });

        if (targetItem && !freshTarget) {
            // Do not use off-screen slots from adjacent pages as hover sources.
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'target-not-in-current-page-slots',
                targetItem: itemSummary(targetItem),
                actualPage,
                slots: slots.map(slotDescriptor)
            });
            return null;
        }

        if (targetItem && freshTarget && targetSourceSlot) {
            // Align once, in the replay frame after source identity/visibility is revalidated.
            performanceDiagnostics.hoverLifecycle.duplicateAlignmentsAvoided++;
            activeVideoId = targetItem.videoId;
            activeClone = freshTarget;

            const replayed = await scheduleNativeHoverReplay(
                targetSourceSlot,
                targetItem,
                freshTarget,
                triggerEvent,
                actualPage,
                'prepared-page',
                token,
                sessionToken
            );
            if (!replayed) return null;
        }

        log(tLog('nativePagePreparationCompleted'), {
            requestedPage: page,
            actualPage,
            targetItem: itemSummary(targetItem),
            targetReady: Boolean(freshTarget),
            elapsedMs: Math.round(performance.now() - started)
        });
        return freshTarget;
    }

    async function activateClone(item, clone, triggerEvent = null, generation = clone?.__tmHoverActivationGeneration) {
        if (!gridHoverTargetActive(clone, generation)) return;
        const seq = ++hoverSequence;
        const started = performance.now();

        if (orderMismatchDialogOpen || orderMismatchReinitializing) {
            log(tLog('hoverCancelled'), {
                seq,
                reason: orderMismatchDialogOpen ? 'order-mismatch-dialog-open' : 'order-mismatch-reinitializing',
                item: itemSummary(item)
            });
            return;
        }

        if (responsiveRefreshPromise) {
            log(tLog('hoverWaitingResponsiveRefreshInProgress'), { seq, item: itemSummary(item) });
            try { await responsiveRefreshPromise; } catch (_) {}
            if (!gridHoverTargetActive(clone, generation)) return;
        }
        if (!clone?.isConnected) {
            warn(tLog('hoverCancelled'), { seq, reason: 'clone-disconnected', item: itemSummary(item) });
            return;
        }
        if (clone.getAttribute('data-tm-preparing') === 'true') {
            const preparingTokenText = clone.getAttribute('data-tm-hover-token');
            const preparingToken = preparingTokenText === null ? NaN : Number(preparingTokenText);
            if (Number.isFinite(preparingToken) && preparingToken !== hoverToken) {
                // The previous hover was already cancelled (typically by pointerleave),
                // but its async cleanup has not reached finally yet. Clear only that
                // stale marker so a new hover can start immediately; the old token will
                // make the previous async path self-cancel at its next checkpoint.
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            } else {
                log(tLog('hoverCancelled'), { seq, reason: 'already-preparing', item: itemSummary(item) });
                return;
            }
        }

        const token = ++hoverToken;
        const sessionToken = routeSessionToken;
        clone.setAttribute('data-tm-hover-token', String(token));
        clone.setAttribute('data-tm-preparing', 'true');
        let fresh = null;
        try {
            assertRouteSession(sessionToken);
            // One recovery attempt for this intent, including failed ready-source
            // replay. Follow the current card after preparation replaces its DOM.
            for (let attempt = 0; attempt < 2; attempt++) {
                if (attempt) await sleep(HOVER_RETRY_DELAY_MS);
                const current = attempt ? findGridClone(item) : clone;
                if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    orderMismatchDialogOpen || orderMismatchReinitializing ||
                    !gridHoverTargetActive(current, generation) ||
                    current.getAttribute('data-tm-hover-token') !== String(token)) break;

                clearSourceAlignment();
                const { selected, backedPage, sourceSlot } = withNativeReadScope(() => {
                    if (!attempt && current.getAttribute('data-tm-hover-ready') === 'true') {
                        ensureLiveNativeBinding('hover-reuse');
                    }
                    const selected = selectedPage(sourceState.section);
                    const backedPage = Number(current.getAttribute('data-tm-backed-page'));
                    const sourceSlot = !attempt && current.getAttribute('data-tm-hover-ready') === 'true' &&
                        Number.isFinite(backedPage) && selected === backedPage ? findActiveSourceSlot(item) : null;
                    return { selected, backedPage, sourceSlot };
                });
                if (attempt) {
                    log('Retrying native page preparation after transient hydration', {
                        seq,
                        item: itemSummary(item),
                        token,
                        selectedPage: selected
                    });
                }

                let reused = false;
                if (!attempt && sourceSlot) {
                    performanceDiagnostics.hoverLifecycle.duplicateAlignmentsAvoided++;
                    reused = true;
                    activePage = selected;
                    activeVideoId = item.videoId;
                    activeClone = current;
                    log(tLog('hoverReusedImmediately'), {
                        seq,
                        item: itemSummary(item),
                        selectedPage: selected,
                        backedPage,
                        elapsedMs: Math.round(performance.now() - started)
                    });
                    const replayed = await scheduleNativeHoverReplay(
                        sourceSlot, item, current, triggerEvent, selected, 'immediate-reuse', token, sessionToken
                    );
                    fresh = replayed ? current : null;
                }
                if (!reused) {
                    log(tLog('hoverRequestedNativePagePreparation'), {
                        seq,
                        item: itemSummary(item),
                        selectedPage: selected,
                        targetPage: item.page,
                        backedPage: Number.isFinite(backedPage) ? backedPage : null,
                        hoverReady: current.getAttribute('data-tm-hover-ready') === 'true',
                        token,
                        triggerEvent: triggerEvent?.type || ''
                    });
                    fresh = await prepareMountedPage(item.page, item, triggerEvent, token, sessionToken);
                }
                if (fresh || hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    orderMismatchDialogOpen || orderMismatchReinitializing) break;
            }
            if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken)) return;
            log(tLog('hoverNativePagePreparationResult'), {
                seq,
                item: itemSummary(item),
                success: Boolean(fresh),
                replayDispatched: Boolean(fresh),
                activePage,
                activeVideoId,
                elapsedMs: Math.round(performance.now() - started)
            });
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('liveClonePreparationFailed'), { seq, item: itemSummary(item), error });
            }
        } finally {
            if (!fresh) releaseFailedGridHover(activeClone, token);
            const current = findGridClone(item);
            if (current?.isConnected && current.getAttribute('data-tm-hover-token') === String(token)) {
                current.removeAttribute('data-tm-preparing');
                current.removeAttribute('data-tm-hover-token');
            }
            if (clone?.isConnected && clone.getAttribute('data-tm-hover-token') === String(token)) {
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            }
        }
    }

    function gridCloneFromPointerEvent(event, grid, includeViewingControls = false) {
        let node = event.target instanceof Element ? event.target : event.target?.parentElement;
        while (node && node !== grid) {
            if (!includeViewingControls && node.getAttribute('data-tm-viewing-actions') === 'true') return null;
            if (node.__tmMyListItem && gridOwnsClone(node, grid)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function gridHoverSuppressed() {
        return hoverNeedsPointerMove || performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS;
    }

    function gridHoverTargetActive(clone, generation) {
        return !gridHoverSuppressed() && Boolean(sourceState?.grid?.isConnected) &&
            Boolean(clone?.isConnected) && gridOwnsClone(clone, sourceState.grid) &&
            !clone.__tmViewingControlHovered &&
            generation === clone.__tmHoverActivationGeneration &&
            clone.matches(':hover');
    }

    function cancelPendingGridHover() {
        const clone = pendingGridHoverClone;
        pendingGridHoverClone = null;
        if (!clone) return;
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clearTimeout(clone.__tmHoverActivationTimer);
        clone.__tmHoverActivationTimer = null;
    }

    function handleGridClonePointerOver(event, clone, item, physicalMove = false) {
        if (orderMismatchDialogOpen || orderMismatchReinitializing) return;
        if (event.relatedTarget && clone.contains(event.relatedTarget)) return;
        if (!sourceState?.section || (gridHoverSuppressed() && !physicalMove)) return;
        if (pendingGridHoverClone === clone || activeClone === clone) return;
        if (clone.getAttribute('data-tm-preparing') === 'true' &&
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) return;

        // All preparation, including ready-source reuse, goes through the dwell.
        // Physical intent received just after a scroll survives the quiet period.
        // Boundary events alone still cannot prepare a stationary scroll target.
        cancelPendingGridHover();
        const generation = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clone.__tmHoverActivationGeneration = generation;
        pendingGridHoverClone = clone;
        clone.__tmHoverActivationTimer = setTimeout(() => {
            clone.__tmHoverActivationTimer = null;
            if (pendingGridHoverClone === clone) pendingGridHoverClone = null;
            if (physicalMove && sourceState?.grid?.isConnected && clone.isConnected &&
                gridOwnsClone(clone, sourceState.grid) && generation === clone.__tmHoverActivationGeneration &&
                clone.matches(':hover') && performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) {
                hoverNeedsPointerMove = false;
            }
            if (!gridHoverTargetActive(clone, generation)) return;
            activateClone(item, clone, event, generation);
        }, Math.max(HOVER_ACTIVATION_DELAY_MS, HOVER_SCROLL_QUIET_MS - (performance.now() - lastTargetScrollAt)));
    }

    function handleGridClonePointerLeave(clone, item, relatedTarget = null) {
        if (pendingGridHoverClone === clone) cancelPendingGridHover();
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        if (clone.__tmHoverActivationTimer !== null && clone.__tmHoverActivationTimer !== undefined) {
            clearTimeout(clone.__tmHoverActivationTimer);
            clone.__tmHoverActivationTimer = null;
        }

        const cloneTokenText = clone.getAttribute('data-tm-hover-token');
        const cloneToken = cloneTokenText === null ? NaN : Number(cloneTokenText);
        if (Number.isFinite(cloneToken) && cloneToken === hoverToken) {
            hoverToken++;
            clone.removeAttribute('data-tm-hover-token');
            clone.removeAttribute('data-tm-preparing');
            log(tLog('pendingHoverCancelledOnLeave'), {
                item: itemSummary(item),
                token: cloneToken,
                hoverToken
            });
        }
        if (activeClone !== clone) return;
        clearSourceAlignment(undefined, 'pointer-leave', relatedTarget);
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        log(tLog('hoverCoordinateProxyReleased'), { item: itemSummary(item) });
    }

    function associateGridHoverItem(item, clone) {
        clone.__tmMyListItem = item;
    }

    function ensureGridHoverBehavior(grid) {
        if (!grid || grid.__tmHoverBehaviorInstalled) return;
        grid.__tmHoverBehaviorInstalled = true;
        grid.addEventListener('pointerover', event => {
            const clone = gridCloneFromPointerEvent(event, grid);
            if (clone) {
                clone.__tmViewingControlHovered = false;
                handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
            } else {
                const controlClone = gridCloneFromPointerEvent(event, grid, true);
                if (controlClone) {
                    controlClone.__tmViewingControlHovered = true;
                    handleGridClonePointerLeave(controlClone, controlClone.__tmMyListItem, event.target);
                } else cancelPendingGridHover();
            }
        }, { capture: true, passive: true });
        grid.addEventListener('pointerout', event => {
            const clone = gridCloneFromPointerEvent(event, grid);
            if (!clone || (event.relatedTarget && clone.contains(event.relatedTarget))) return;
            handleGridClonePointerLeave(clone, clone.__tmMyListItem, event.relatedTarget);
        }, { capture: true, passive: true });
    }

    async function buildGrid(section, scroller, items, layout, totalCount, sessionToken = routeSessionToken) {
        const buildState = sourceState;
        const track = buildState?.track;
        const assertBuildActive = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== buildState) throw createRouteSessionCancelledError();
            if (!section.isConnected || !scroller.isConnected || !track?.isConnected ||
                buildState.section !== section || buildState.scroller !== scroller || buildState.track !== track) {
                throw initializationError('GRID_BUILD_SOURCE_REPLACED', 'grid-construction',
                    'Native My List source changed during grid construction');
            }
        };
        assertBuildActive();
        const grid = document.createElement('div');
        grid.id = GRID_ID;
        grid.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        grid.removeAttribute('data-tm-empty');
        ensureGridHoverBehavior(grid);

        const cloneMap = new Map();
        const itemMap = new Map();

        await runConstructionChunks(items.length, index => {
            const item = items[index];
            const clone = createItemClone(item);
            normalizeClone(clone);
            copyItemAttributes(clone, item, index);
            associateGridHoverItem(item, clone);
            grid.appendChild(clone);
            const key = itemKey(item);
            cloneMap.set(key, clone);
            itemMap.set(key, item);
        }, assertBuildActive);
        assertBuildActive();

        // Publish the complete tree and maps together. A cancelled/failed build
        // never removes the current frame or exposes a partial clone map.
        clearLegacyEmptyState({ restoreGrid: false });
        invalidateGridReact();
        document.getElementById(GRID_ID)?.remove();
        buildState.cloneMap = cloneMap;
        buildState.itemMap = itemMap;

        const geometry = applyGridGeometry(section, grid, layout);
        const status = updateStatus(formatHeaderParts(items.length, totalCount, null));

        // Place the legacy-grid header and grid below the native carousel.
        scroller.insertAdjacentElement('afterend', status);
        syncStatusTypography(section, status);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        status.insertAdjacentElement('afterend', grid);
        grid.style.marginTop = '0px';

        sourceState.items = items;
        sourceState.totalCount = totalCount;
        sourceState.grid = grid;
        sourceState.status = status;
        sourceState.layout = layout;
        if (sourceState.watchStatus) syncWatchGroups(sourceState);
        // The displayed trees now own the markup. Release captured native trees
        // and the shared GraphQL template only after successful publication.
        items.forEach(releaseItemCardSnapshot);

        lastResponsiveSignature = responsiveSignature(layout);
        lastPageShape = responsivePageShape(layout);

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!grid.isConnected || responsiveRefreshing) return;
            scheduleResponsiveRefresh(140, 'ResizeObserver');
        });
        resizeObserver.observe(section);
        resizeObserver.observe(scroller);

        log(tLog('legacyGridBuilt'), {
            items: items.length,
            totalCount,
            geometry,
            layout: layoutSummary(layout),
            gridCards: cloneMap.size
        });

        return grid;
    }

    function responsiveSignature(layout) {
        if (!sourceState) return '';
        return [
            Math.max(1, layout.columns),
            pageCount(sourceState.section),
            Math.round(layout.cardWidth),
            Math.round(layout.gridWidth),
            Math.round(layout.gridLeft),
            Math.round(layout.sidePadding || 0),
            Math.round(layout.scrollerWidth)
        ].join('|');
    }

    function responsiveViewportSignature() {
        const viewport = typeof window === 'undefined' ? {} : window;
        const visual = viewport.visualViewport;
        return [viewport.innerWidth, viewport.innerHeight, viewport.devicePixelRatio,
            visual?.width, visual?.height, visual?.scale, visual?.offsetLeft, visual?.offsetTop].join('|');
    }

    function responsiveLayoutMatches(previous, next) {
        if (!previous) return false;
        return ['columns', 'cardWidth', 'gridWidth', 'gridLeft', 'sidePadding', 'sidePaddingLeft',
            'sidePaddingRight', 'scrollerWidth', 'scrollerHeight', 'gap', 'rowGap']
            .every(key => Math.abs((previous[key] || 0) - (next[key] || 0)) <= 0.5);
    }

    function cancelResizeHover() {
        cancelPendingGridHover();
        hoverToken++;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        invalidateGridReact();
        performanceDiagnostics.resize.hoverCancelled++;
    }

    function responsivePageShape(layout) {
        if (!sourceState) return '';
        return `${Math.max(1, layout.columns)}|${pageCount(sourceState.section)}`;
    }

    function updateResponsiveStatus(layout, note = '') {
        if (!sourceState?.status || !sourceState?.items) return;
        const geometry = applyGridGeometry(sourceState.section, sourceState.grid, layout);
        sourceState.status.style.marginLeft = `${geometry.left}px`;
        sourceState.status.style.width = `${geometry.width}px`;
        sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || sourceState.layout?.rowGap || 0) : 0}px`);
        updateStatus(formatHeaderParts(
            sourceState.items.length,
            sourceState.totalCount,
            sourceState.initializationElapsedMs,
            true
        ));
        sourceState.grid.style.marginTop = '0px';

        if (note) {
            log(tLog('responsiveStatusNote'), { note });
        }
    }

    async function waitResponsiveLayoutSettled(timeout = 1200, sessionToken = null) {
        assertRouteSession(sessionToken);
        const state = sourceState;
        const { section, scroller, track } = state;
        const start = performance.now();
        let previous = '';
        let stable = 0;
        let latest = sourceState.layout;

        while (performance.now() - start < timeout) {
            await sleep(80);
            assertRouteSession(sessionToken);
            if (sourceState !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || !state.grid?.isConnected) {
                throw createRouteSessionCancelledError();
            }
            latest = measureVisibleLayout(section, scroller, track);
            latest.rowGap = sourceState?.layout?.rowGap || measureNativeCarouselGap(section);
            const sig = responsiveSignature(latest);
            if (sig === previous) {
                stable++;
                if (stable >= 2) return latest;
            } else {
                previous = sig;
                stable = 0;
            }
        }
        assertRouteSession(sessionToken);
        return latest;
    }

    function wrappedTailLogicalPageInfo(positions, totalCount, columns) {
        const count = Math.max(0, Math.floor(totalCount));
        const width = Math.max(1, Math.floor(columns));
        if (count <= 1 || count % width === 0 || !positions.length) return null;

        const expectedVisibleCount = Math.min(width, count);
        if (positions.length !== expectedVisibleCount) return null;

        const itemIndices = positions.map(position => position.itemIndex);
        if (!itemIndices.every(index => Number.isSafeInteger(index) && index >= 0 && index < count)) return null;
        if (new Set(itemIndices).size !== itemIndices.length) return null;

        let wrapIndex = -1;
        for (let index = 1; index < itemIndices.length; index++) {
            const previous = itemIndices[index - 1];
            const current = itemIndices[index];
            if (current !== (previous + 1) % count) return null;
            if (previous === count - 1 && current === 0) {
                if (wrapIndex !== -1) return null;
                wrapIndex = index;
            }
        }
        if (wrapIndex <= 0 || !itemIndices.includes(count - 1)) return null;

        const pages = Math.max(1, Math.ceil(count / width));
        const lastPage = pages - 1;
        const expectedTail = new Set(expectedLogicalIndicesForPage(count, width, lastPage));
        if (!itemIndices.slice(0, wrapIndex).every(index => expectedTail.has(index))) return null;

        return { page: lastPage, wrapIndex, itemIndices };
    }

    function wrappedTailLogicalPageForRebuild(positions, totalCount, columns, previousRuntime) {
        const info = wrappedTailLogicalPageInfo(positions, totalCount, columns);
        if (!info) return null;

        const pages = Math.max(1, Math.ceil(Math.max(0, Math.floor(totalCount)) / Math.max(1, Math.floor(columns))));
        const previousCurrentPage = Number.isFinite(previousRuntime?.currentPage)
            ? Math.max(0, Math.floor(previousRuntime.currentPage))
            : null;
        const previousKnownPageCount = previousRuntime?.pageCountFinalized && Number.isFinite(previousRuntime?.knownPageCount)
            ? Math.max(1, Math.floor(previousRuntime.knownPageCount))
            : null;

        const wasAtCompatibleTail = previousCurrentPage === info.page || (
            previousKnownPageCount !== null &&
            previousCurrentPage === previousKnownPageCount - 1 &&
            (previousKnownPageCount === pages || previousKnownPageCount === pages + 1)
        );
        return wasAtCompatibleTail ? info : null;
    }

    async function rebuildLogicalPageModelFromNativePosition(layout, reason = 'responsive-remap', sessionToken = routeSessionToken) {
        assertRouteSession(sessionToken);
        const live = ensureLiveNativeBinding('logical-page-model-rebuild-start') || sourceState;
        const section = live?.section || sourceState?.section;
        const scroller = live?.scroller || sourceState?.scroller;
        const track = live?.track || sourceState?.track;
        const items = sourceState?.items || [];
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            throw new Error('Native carousel binding is unavailable during logical page model rebuild');
        }

        const columns = Math.max(1, layout?.columns || sourceState?.layout?.columns || 1);
        const pages = Math.max(1, Math.ceil(Math.max(items.length, 1) / columns));
        const savedTransition = captureInlineStyleProperty(track, 'transition');
        const savedAnimation = captureInlineStyleProperty(track, 'animation');
        const restoreFastStyles = () => {
            section.classList.remove(FAST_MOVE_CLASS);
            restoreInlineStyleProperty(track, 'transition', savedTransition);
            restoreInlineStyleProperty(track, 'animation', savedAnimation);
            void track.offsetWidth;
        };

        let runtime = getCarouselDomRuntime(section);
        runtime.pageMappingStale = true;

        try {
            try { await carouselMoveQueue; } catch (_) {}
            assertRouteSession(sessionToken);

            // Keep the finalized runtime until the current Hawkins page has been
            // validated. A My List mutation can briefly expose a wrapped virtual
            // tail; a transient read must not collapse pageCount() for hover.
            section.classList.add(FAST_MOVE_CLASS);
            track.style.setProperty('transition', 'none', 'important');
            track.style.setProperty('animation', 'none', 'important');
            void track.offsetWidth;
            registerActiveCarouselStyleCleanup(restoreFastStyles);

            const nativeCountState = nativeReactCarouselTotalCount(scroller, track);
            const nativeCountHasReadings = nativeCountState.uniqueReadings.length > 0;
            const nativeCountConverged =
                Number.isSafeInteger(nativeCountState.totalCount) &&
                nativeCountState.totalCount === items.length;
            if (nativeCountConverged) myListCountConvergencePending = false;
            if (!nativeCountHasReadings || !nativeCountConverged) {
                runtime.logicalRemapRetryCount = (runtime.logicalRemapRetryCount || 0) + 1;
                log('Logical My List page-model rebuild deferred until native delta converges', {
                    reason,
                    legacyTotalCount: items.length,
                    nativeTotalCount: nativeCountState.totalCount,
                    readings: nativeCountState.readings,
                    uniqueReadings: nativeCountState.uniqueReadings,
                    selectedPage: selectedPage(section),
                    pageMappingStale: runtime.pageMappingStale,
                    retryCount: runtime.logicalRemapRetryCount
                });
                return null;
            }

            let pageState = nativeLogicalPageState(scroller, track, items.length, columns);
            const strictPageStateValid =
                pageState.positions.length > 0 &&
                pageState.positions.every(position => Number.isSafeInteger(position.itemIndex)) &&
                Number.isFinite(pageState.page);

            if (!strictPageStateValid) {
                const wrappedTail = wrappedTailLogicalPageForRebuild(
                    pageState.positions,
                    items.length,
                    columns,
                    runtime
                );
                if (wrappedTail) {
                    pageState = { ...pageState, page: wrappedTail.page };
                    log('Logical My List wrapped tail accepted for current-page recovery', {
                        reason,
                        page: wrappedTail.page,
                        wrapIndex: wrappedTail.wrapIndex,
                        totalCount: items.length,
                        columns,
                        itemIndices: pageState.itemIndices
                    });
                } else {
                    logVirtualRawIndexDiagnostic(pageState.slots, items.length, columns, 'logical-page-model-rebuild');
                    runtime.logicalRemapRetryCount = (runtime.logicalRemapRetryCount || 0) + 1;
                    log('Logical My List page-model rebuild deferred for non-canonical native window', {
                        reason,
                        totalCount: items.length,
                        columns,
                        slots: pageState.slots.length,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        resolvedPage: pageState.page,
                        retryCount: runtime.logicalRemapRetryCount
                    });
                    return null;
                }
            }

            const signature = visibleSignature(pageState.slots);
            if (!signature) {
                runtime.logicalRemapRetryCount = (runtime.logicalRemapRetryCount || 0) + 1;
                log('Logical My List page-model rebuild deferred because native signature is unavailable', {
                    reason,
                    totalCount: items.length,
                    columns,
                    retryCount: runtime.logicalRemapRetryCount
                });
                return null;
            }

            runtime = resetCarouselDomRuntime(section);
            runtime.profile = detectCarouselDomProfile(section);
            runtime.knownPageCount = pages;
            runtime.pageCountFinalized = true;
            runtime.cycleDetected = false;
            runtime.pageMappingStale = false;
            runtime.logicalRemapRetryCount = 0;
            runtime.currentPage = pageState.page;
            forceLogicalPageSignature(section, signature, pageState.page);

            let changed = 0;
            items.forEach((item, index) => {
                const page = Math.min(pages - 1, Math.floor(index / columns));
                item.logicalIndex = index;
                if (item.page !== page) changed++;
                item.page = page;
                const clone = sourceState?.cloneMap?.get(itemKey(item));
                if (clone?.isConnected) clone.setAttribute('data-tm-item-page', String(page));
            });
            if (sourceState) sourceState.initialPage = pageState.page;

            log(tLog('logicalPageModelSynchronizedAfterDelta'), {
                reason,
                currentPage: runtime.currentPage,
                knownPageCount: runtime.knownPageCount,
                pageCountFinalized: runtime.pageCountFinalized,
                pageMappingStale: runtime.pageMappingStale,
                visibleSignature: signature,
                visibleIds: currentPageVideoIds(scroller, track),
                itemIndices: pageState.itemIndices,
                logicalIndices: pageState.logicalIndices,
                columns,
                changed,
                totalCount: items.length
            });
            return changed;
        } finally {
            restoreFastStyles();
            unregisterActiveCarouselStyleCleanup(restoreFastStyles);
        }
    }

    async function remapItemsByOrder(layout, sessionToken = routeSessionToken) {
        const { section, items, cloneMap } = sourceState;
        const columns = Math.max(1, layout.columns);
        const runtime = getCarouselDomRuntime(section);
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const pages = logicalMode
            ? Math.max(1, Math.ceil(items.length / columns))
            : Math.max(1, pageCount(section));
        let changed = 0;

        if (logicalMode) {
            changed = await rebuildLogicalPageModelFromNativePosition(layout, 'responsive-remap', sessionToken);
        } else {
            items.forEach((item, index) => {
                const page = Math.min(pages - 1, Math.floor(index / columns));
                if (item.page !== page) changed++;
                item.page = page;
                const clone = cloneMap?.get(itemKey(item));
                if (clone) clone.setAttribute('data-tm-item-page', String(page));
            });
        }

        const updatedRuntime = getCarouselDomRuntime(section);
        log(tLog('responsiveItemPageMappingRecalculatedWithoutNativeCarouselScan'), {
            columns,
            pages,
            changed,
            total: items.length,
            selectedPage: selectedPage(section),
            pageMode: updatedRuntime?.profile?.pageMode || null,
            reanchoredLogicalPages: logicalMode,
            pageMappingStale: Boolean(updatedRuntime?.pageMappingStale)
        });

        return changed;
    }

    async function refreshResponsiveLayout(sessionToken = routeSessionToken) {
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected || responsiveRefreshing) return;
        const state = sourceState;
        const { section, scroller, track } = state;
        responsiveRefreshing = true;
        let deferredLogicalRemap = false;
        const seq = ++responsiveSequence;
        const reason = lastResponsiveReason || 'unspecified';
        activeResponsiveReason = reason;
        const started = performance.now();
        const grid = state.grid;
        const assertOwner = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || state.grid !== grid || !grid.isConnected) {
                throw createRouteSessionCancelledError();
            }
        };
        log(tLog('responsiveRefreshStarted'), {
            seq,
            reason,
            beforeLayout: layoutSummary(sourceState.layout),
            selectedPage: selectedPage(sourceState.section),
            pages: pageCount(sourceState.section)
        });
        grid.setAttribute('data-tm-responsive-refreshing', 'true');
        performanceDiagnostics.resize.refreshes++;
        cancelResizeHover();

        try {
            const liveLayout = await waitResponsiveLayoutSettled(1200, sessionToken);
            assertOwner();
            const signature = responsiveSignature(liveLayout);
            const pageShape = responsivePageShape(liveLayout);

            sourceState.layout = liveLayout;
            updateResponsiveStatus(liveLayout, tUi('relayoutInProgress'));

            const pageShapeChanged = pageShape !== lastPageShape;
            const logicalMappingStale = Boolean(getCarouselDomRuntime(sourceState.section)?.pageMappingStale);
            log(tLog('responsiveMeasurementResolved'), {
                seq,
                reason,
                liveLayout: layoutSummary(liveLayout),
                signature,
                pageShape,
                previousPageShape: lastPageShape,
                pageShapeChanged,
                logicalMappingStale
            });
            if (pageShapeChanged || logicalMappingStale) {
                const changed = await remapItemsByOrder(liveLayout, sessionToken);
                assertOwner();
                deferredLogicalRemap = changed === null;
                if (deferredLogicalRemap) {
                    log('Responsive logical page remap deferred', {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: pageCount(sourceState.section),
                        total: sourceState.items.length,
                        retryCount: getCarouselDomRuntime(sourceState.section)?.logicalRemapRetryCount || 0
                    });
                } else {
                    log(tLog('responsivePageMappingUpdatedWithoutNativeCarouselMovement'), {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: pageCount(sourceState.section),
                        changed,
                        total: sourceState.items.length
                    });
                }
            } else {
                // Geometry-only resize: keep the native carousel exactly where the user left it.
                realignActiveSource();
            }

            const finalSignature = responsiveSignature(liveLayout);
            const finalPageShape = responsivePageShape(liveLayout);
            lastResponsiveSignature = finalSignature;
            lastPageShape = finalPageShape;
            updateResponsiveStatus(liveLayout);
            log(tLog('responsiveRefreshCompleted'), {
                seq,
                reason,
                layout: layoutSummary(liveLayout),
                elapsedMs: Math.round(performance.now() - started),
                selectedPage: selectedPage(sourceState.section),
                finalSignature,
                finalPageShape
            });
        } catch (error) {
            if (isRouteSessionCancelledError(error)) return;
            warn(tLog('responsiveRelayoutFailed'), {
                seq,
                reason,
                error,
                elapsedMs: Math.round(performance.now() - started),
                snapshot: collectRuntimeSnapshot()
            });
            updateResponsiveStatus(sourceState.layout, tUi('relayoutFailed'));
        } finally {
            grid.removeAttribute('data-tm-responsive-refreshing');
            if (isRouteSessionActive(sessionToken) && responsiveSequence === seq) {
                responsiveRefreshing = false;
                activeResponsiveReason = '';
                retryPendingMyListMutations('after-responsive-refresh');
                const runtime = sourceState?.section ? getCarouselDomRuntime(sourceState.section) : null;
                if (deferredLogicalRemap && runtime?.pageMappingStale && (runtime.logicalRemapRetryCount || 0) === 1) {
                    scheduleResponsiveRefresh(
                        400,
                        isResizeResponsiveReason(reason) ? 'responsive-resize-retry' : 'logical-page-model-retry'
                    );
                }
            }

            // Resize may fast-reanchor the hidden/native carousel to rebuild the logical
            // indicator, but it never starts MiniModal hover preparation by itself.
        }
    }

    function scheduleResponsiveRefresh(delay = 140, reason = 'unknown') {
        const sessionToken = routeSessionToken;
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected) return;
        const state = sourceState;
        lastResponsiveReason = reason;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = setTimeout(() => {
            responsiveRefreshTimer = null;
            if (!isRouteSessionActive(sessionToken) || responsiveRefreshing || sourceState !== state || !state.grid?.isConnected) return;
            performanceDiagnostics.resize.checks++;
            if (state.empty && (!state.scroller || !state.track)) {
                const layout = measureEmptyLayout(state.section);
                layout.rowGap = measureNativeCarouselGap(state.section);
                if (responsiveLayoutMatches(state.layout, layout)) {
                    performanceDiagnostics.resize.unchanged++;
                    return;
                }
                state.layout = layout;
                const geometry = applyGridGeometry(state.section, state.grid, layout);
                state.status.style.marginLeft = `${geometry.left}px`;
                state.status.style.width = `${geometry.width}px`;
                return;
            }
            ensureLiveNativeBinding('responsive-check');
            if (sourceState !== state || !state.section?.isConnected || !state.scroller?.isConnected || !state.track?.isConnected) return;

            // Skip the expensive rescan when measured geometry has not changed.
            // Keep active-slot alignment here and clear it only when the responsive state actually changes.
            const sample = withNativeReadScope(() => {
                const measured = measureVisibleLayout(state.section, state.scroller, state.track);
                measured.rowGap = state.layout?.rowGap || measureNativeCarouselGap(state.section);
                return { measured, signature: responsiveSignature(measured), geometry: currentGridGeometry(state.section, measured) };
            });
            const measured = sample.measured;
            const sig = sample.signature;
            const logicalMappingStale = Boolean(getCarouselDomRuntime(sourceState.section)?.pageMappingStale);
            const applied = state.grid.__tmAppliedGeometry;
            const geometryUnchanged = responsiveLayoutMatches(state.layout, measured) && applied &&
                ['width', 'left', 'columns'].every(key => Math.abs(applied[key] - sample.geometry[key]) <= 0.5);
            if (sig === lastResponsiveSignature && geometryUnchanged && !logicalMappingStale) {
                sourceState.layout = measured;
                realignActiveSource();
                performanceDiagnostics.resize.unchanged++;
                if (activeClone || pendingGridHoverClone) performanceDiagnostics.resize.hoverPreserved++;
                trace(() => [tLog('responsiveRemeasurementNoShapeChange'), {
                    reason: lastResponsiveReason,
                    signature: sig,
                    layout: layoutSummary(measured)
                }]);
                return;
            }

            // Netflix can change only the carousel page count after a My List removal
            // settles (for example, after the Undo window) without changing responsive
            // geometry. Treat that as content-state convergence, not a responsive relayout,
            // so an active hover is not invalidated unnecessarily.
            if (lastResponsiveReason === 'ResizeObserver') {
                const previousParts = String(lastResponsiveSignature || '').split('|');
                const currentParts = String(sig || '').split('|');
                const pageCountOnlyChanged =
                    previousParts.length === 7 &&
                    currentParts.length === 7 &&
                    previousParts[1] !== currentParts[1] &&
                    previousParts.every((part, index) => index === 1 || part === currentParts[index]);

                if (pageCountOnlyChanged && geometryUnchanged && !logicalMappingStale) {
                    const previousSignature = lastResponsiveSignature;
                    sourceState.layout = measured;
                    lastResponsiveSignature = sig;
                    lastPageShape = responsivePageShape(measured);
                    realignActiveSource();
                    performanceDiagnostics.resize.unchanged++;
                    if (activeClone || pendingGridHoverClone) performanceDiagnostics.resize.hoverPreserved++;
                    log(tLog('responsiveRemeasurementNoShapeChange'), {
                        reason: lastResponsiveReason,
                        signature: sig,
                        previousSignature,
                        pageCountOnlyChange: true,
                        layout: layoutSummary(measured)
                    });
                    return;
                }
            }

            const refreshPromise = refreshResponsiveLayout(sessionToken);
            responsiveRefreshPromise = refreshPromise;
            Promise.resolve(refreshPromise).finally(() => {
                if (responsiveRefreshPromise === refreshPromise) responsiveRefreshPromise = null;
            });
        }, delay);
    }

    function beginSourceScan(section, scroller, track) {
        section.setAttribute(SECTION_ATTR, 'true');
        scroller.classList.add(SOURCE_SCAN_CLASS);
        track.classList.add('tm-netflix-mylist-v15-track');
    }

    function parkSource(scroller) {
        scroller.classList.remove(SOURCE_SCAN_CLASS);
        scroller.classList.add(SOURCE_PARKED_CLASS);

    }

    function realignActiveSource() {
        if (!activeGeometryProxy) return;
        if (!activeGeometryProxy.sourceSlot.isConnected || !activeGeometryProxy.clone.isConnected) {
            clearSourceAlignment();
        }
    }

    function handleTargetPointerMove(event) {
        // Synthetic native replay must not overwrite the latest physical position.
        if (!event.isTrusted) return;
        const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        if (!moved) return;
        const grid = sourceState?.grid;
        if (!grid?.isConnected) return;
        const clone = gridCloneFromPointerEvent(event, grid);
        if (performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) hoverNeedsPointerMove = false;
        if (clone) handleGridClonePointerOver(event, clone, clone.__tmMyListItem, true);
        else cancelPendingGridHover();
    }

    function handleTargetScroll() {
        const now = performance.now();
        const starting = now - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS;
        lastTargetScrollAt = now;
        hoverNeedsPointerMove = true;
        cancelPendingGridHover();
        if (!starting) return;
        performanceDiagnostics.hoverLifecycle.scrollBursts++;
        hoverToken++;
        clearSourceAlignment(undefined, 'scroll');
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        // Grafted React props also receive Netflix's delegated mouse events.
        // Clear them once per scroll burst so they cannot bypass the script guard.
        invalidateGridReact();
    }

    function handleTargetWindowResize() {
        handleTargetResize('window.resize');
    }

    function handleTargetVisualViewportResize() {
        handleTargetResize('visualViewport.resize');
    }

    function handleTargetResize(reason) {
        if (!sourceState?.grid?.isConnected) return;
        performanceDiagnostics.resize.events++;
        const signature = responsiveViewportSignature();
        if (sourceState.resizeViewportSignature !== signature) {
            // Real bounds/zoom/offset changes can invalidate native popup placement
            // even when the column count is unchanged. Duplicate events cannot.
            cancelResizeHover();
            log(tLog(reason === 'window.resize' ? 'windowResizeDetected' : 'visualViewportResizeDetected'), {
                previousSignature: sourceState.resizeViewportSignature || '', signature,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                hoverCancelled: true
            });
            sourceState.resizeViewportSignature = signature;
        }
        scheduleResponsiveRefresh(140, reason);
    }

    function targetDocumentObserverAncestors(host) {
        const ancestors = [];
        for (let node = host?.parentElement; node; node = node.parentElement) {
            ancestors.push(node);
        }
        return ancestors;
    }

    function bindTargetDocumentObserver(host, section) {
        if (!targetDocumentObserver) return false;

        const ancestors = host ? targetDocumentObserverAncestors(host) : [];
        const sameAncestors = ancestors.length === targetObservedAncestors.length &&
            ancestors.every((ancestor, index) => ancestor === targetObservedAncestors[index]);
        const isAlreadyWatchingDiscovery = !host && targetDocumentDiscoveryActive && !targetObservedBrowseHost;
        if (isAlreadyWatchingDiscovery) return false;

        if (host === targetObservedBrowseHost &&
            section === targetObservedMyListSection &&
            sameAncestors &&
            !targetDocumentDiscoveryActive) {
            return false;
        }

        targetDocumentObserver.disconnect();
        targetObservedBrowseHost = null;
        targetObservedMyListSection = null;
        targetObservedAncestors = [];
        targetDocumentDiscoveryActive = false;

        if (!host) {
            if (document.documentElement) {
                // Watch broadly only until Netflix mounts the browse sections host.
                targetDocumentObserver.observe(document.documentElement, { childList: true, subtree: true });
                targetDocumentDiscoveryActive = true;
            }
            return true;
        }

        // The host's direct children identify/reorder carousel rows. Observe the
        // selected My List row deeply, plus only direct child changes along the
        // host's ancestor path so replacement of the host is still detected.
        targetDocumentObserver.observe(host, { childList: true, subtree: !section });
        if (section?.isConnected) {
            targetDocumentObserver.observe(section, { childList: true, subtree: true });
        }
        for (const ancestor of ancestors) {
            targetDocumentObserver.observe(ancestor, { childList: true });
        }

        targetObservedBrowseHost = host;
        targetObservedMyListSection = section?.isConnected ? section : null;
        targetObservedAncestors = ancestors;
        return true;
    }

    function handleRelevantTargetDocumentMutation() {
        if (completedSection || (waitingForNativeEmpty && sourceState?.empty)) {
            if (targetMutationFrame !== null) return;
            const sessionToken = routeSessionToken;
            targetMutationFrame = requestAnimationFrame(() => {
                targetMutationFrame = null;
                if (!isRouteSessionActive(sessionToken)) return;
                if (sourceState?.grid?.isConnected) {
                    ensureLiveNativeBinding('document-mutation', true);
                } else {
                    scheduleRun(40, sessionToken);
                }
            });
            return;
        }
        scheduleRun(40, routeSessionToken);
    }

    function isScriptOwnedMyListNode(node) {
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        return Boolean(element?.closest?.(`#${GRID_ID}, #${STATUS_ID}, #${LEGACY_EMPTY_STATE_ID}, #${ORDER_MISMATCH_DIALOG_ID}`));
    }

    function mutationOnlyChangesScriptUi(mutation) {
        if (isScriptOwnedMyListNode(mutation.target)) return true;
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length > 0 && changedNodes.every(isScriptOwnedMyListNode);
    }

    function mutationChangesObservedAncestorPath(mutation) {
        const ancestorIndex = targetObservedAncestors.indexOf(mutation.target);
        if (ancestorIndex < 0) return false;

        const branch = ancestorIndex === 0
            ? targetObservedBrowseHost
            : targetObservedAncestors[ancestorIndex - 1];
        if (!branch) return false;

        return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
            node === branch || (node.nodeType === 1 && node.contains(branch))
        );
    }

    function handleTargetDocumentMutation(mutations = []) {
        if (location.href !== lastObservedUrl) {
            handleRouteChange('MutationObserver-url');
        }
        if (!targetSessionActive || !isTargetPage() || !targetDocumentObserver) return;
        if (initializationBlockedSessionToken === routeSessionToken) {
            if (mutations.some(mutation => !mutationOnlyChangesScriptUi(mutation))) {
                recoverNativeInitialization(routeSessionToken, 'document-mutation');
            }
            return;
        }
        // External removal of our whole grid still needs recovery, even though
        // mutations wholly inside the connected script UI are otherwise ignored.
        if (completedSection && sourceState?.grid && !sourceState.grid.isConnected) {
            handleRelevantTargetDocumentMutation();
        }
        mutations = mutations.filter(mutation => !mutationOnlyChangesScriptUi(mutation));
        if (!mutations.length) return;

        let relevantMutation = false;
        if (targetDocumentDiscoveryActive) {
            // This is the only phase that watches the full document. Switch to
            // the browse host once it appears, then narrow to My List when found.
            const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
            if (!host) return;
            const section = findMyListSection();
            relevantMutation = bindTargetDocumentObserver(host, section);
        } else {
            const ancestorChanged = mutations.some(mutationChangesObservedAncestorPath);
            const hostChanged = mutations.some(mutation => mutation.target === targetObservedBrowseHost);
            const hostDiscoveryChanged = Boolean(targetObservedBrowseHost && !targetObservedMyListSection) &&
                mutations.some(mutation => targetObservedBrowseHost.contains(mutation.target));
            const sectionChanged = mutations.some(mutation =>
                targetObservedMyListSection && targetObservedMyListSection.contains(mutation.target)
            );

            if (ancestorChanged || hostChanged) {
                const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
                const section = host ? findMyListSection() : null;
                const bindingChanged = bindTargetDocumentObserver(host, section);
                relevantMutation = bindingChanged || hostChanged || sectionChanged;
            } else if (hostDiscoveryChanged) {
                const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
                const section = host ? findMyListSection() : null;
                relevantMutation = bindTargetDocumentObserver(host, section) || hostDiscoveryChanged;
            } else {
                relevantMutation = sectionChanged;
            }
        }

        if (relevantMutation) handleRelevantTargetDocumentMutation();
    }

    function startTargetEventListeners() {
        if (targetListenersActive) return;
        targetListenersActive = true;
        document.addEventListener('pointermove', handleTargetPointerMove, { passive: true, capture: true });
        document.addEventListener('wheel', handleTargetScroll, { passive: true, capture: true });
        document.addEventListener('scroll', handleTargetScroll, { passive: true, capture: true });
        document.addEventListener('click', handleObservedMyListToggleClick, { capture: true, passive: true });
        window.addEventListener('resize', handleTargetWindowResize, { passive: true });
        window.visualViewport?.addEventListener('resize', handleTargetVisualViewportResize, { passive: true });
        targetDocumentObserver = new MutationObserver(handleTargetDocumentMutation);
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        bindTargetDocumentObserver(host, host ? findMyListSection() : null);
    }

    function stopTargetEventListeners() {
        if (!targetListenersActive && !targetDocumentObserver) return;
        targetListenersActive = false;
        cancelPendingGridHover();
        lastTargetScrollAt = -Infinity;
        hoverNeedsPointerMove = false;
        lastPointerX = -1;
        lastPointerY = -1;
        if (targetMutationFrame !== null) cancelAnimationFrame(targetMutationFrame);
        targetMutationFrame = null;
        document.removeEventListener('pointermove', handleTargetPointerMove, true);
        document.removeEventListener('wheel', handleTargetScroll, true);
        document.removeEventListener('scroll', handleTargetScroll, true);
        document.removeEventListener('click', handleObservedMyListToggleClick, true);
        window.removeEventListener('resize', handleTargetWindowResize);
        window.visualViewport?.removeEventListener('resize', handleTargetVisualViewportResize);
        targetDocumentObserver?.disconnect();
        targetDocumentObserver = null;
        targetObservedBrowseHost = null;
        targetObservedMyListSection = null;
        targetObservedAncestors = [];
        targetDocumentDiscoveryActive = false;
    }

    function recoverNativeInitialization(sessionToken, reason) {
        const failure = nativeInitializationFailure;
        if (!failure || failure.sessionToken !== sessionToken || !isRouteSessionActive(sessionToken)) return false;
        if (performanceDiagnostics.nativeRecovery.attempts >= 1) {
            if (!failure.exhaustedReported) {
                failure.exhaustedReported = true;
                performanceDiagnostics.nativeRecovery.exhausted++;
                log(tLog('nativeInitializationRecoveryExhausted'), { sessionToken, reason, maxAttempts: 1 });
            }
            return false;
        }
        const section = findMyListSection();
        const scroller = section?.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = scroller && netflixDom.findTrack(scroller);
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected ||
            !section.contains(scroller) || !scroller.contains(track) ||
            (section === failure.section && scroller === failure.scroller && track === failure.track)) return false;

        performanceDiagnostics.nativeRecovery.attempts++;
        for (const mutation of pendingMyListMutations.values()) mutation.deferredWhileBusy = true;
        hoverToken++;
        cancelPendingGridHover();
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        sourceState = null;
        completedSection = null;
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        clearRunningSession(sessionToken, false);
        bindTargetDocumentObserver(document.querySelector(NETFLIX_DOM_SELECTORS.browseSections), section);
        // A replacement may have a different membership/count. Use the existing
        // fresh SPA bootstrap rather than an old initial-page cache on this retry.
        targetSessionEntryKind = 'spa';
        log(tLog('nativeInitializationRecovered'), {
            sessionToken, reason, attempt: performanceDiagnostics.nativeRecovery.attempts,
            pendingMutations: pendingMyListMutations.size
        });
        scheduleRun(40, sessionToken);
        return true;
    }

    async function runScript(sessionToken = routeSessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        if (initializationBlockedSessionToken === sessionToken) {
            recoverNativeInitialization(sessionToken, 'run');
            return;
        }
        if (running && runningSessionToken === sessionToken) return;
        let section = findMyListSection();
        if (!section) {
            if (waitingForNativeEmpty && sourceState?.empty) {
                return;
            }
            const now = performance.now();
            if (!missingSectionSince) missingSectionSince = now;
            const elapsed = now - missingSectionSince;
            if (elapsed < NATIVE_EMPTY_STABLE_MS) {
                scheduleRun(Math.max(40, NATIVE_EMPTY_STABLE_MS - elapsed), sessionToken);
                return;
            }
            section = netflixDom.ensureSyntheticMyListSection();
            if (!section) {
                scheduleRun(120, sessionToken);
                return;
            }
        } else {
            missingSectionSince = 0;
            const synthetic = document.getElementById(SYNTHETIC_SECTION_ID);
            if (synthetic && synthetic !== section) synthetic.remove();
        }
        if (completedSection === section && document.getElementById(GRID_ID) && !sourceState?.empty) return;

        cleanupOldArtifacts();
        addStyle();
        section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(section);

        const initializationStarted = performance.now();
        let scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        let track = scroller && netflixDom.findTrack(scroller);
        let provisionalLayout = scroller && track ? measureVisibleLayout(section, scroller, track) : measureEmptyLayout(section);
        provisionalLayout.rowGap = measureNativeCarouselGap(section);
        const provisionalFrame = placeLegacyFrame(section, scroller, provisionalLayout, { elapsedMs: null, finalized: false, totalCount: null });
        sourceState = {
            section,
            scroller: scroller || null,
            track: track || null,
            layout: provisionalLayout,
            items: [],
            collectedCount: 0,
            totalCount: null,
            grid: provisionalFrame.grid,
            status: provisionalFrame.status,
            cloneMap: new Map(),
            itemMap: new Map(),
            empty: false,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted
        };
        applyOriginalMyListVisibility();

        running = true;
        runningSessionToken = sessionToken;
        assertRouteSession(sessionToken);
        let earlyTotalCount;
        let freshMyListBootstrap = null;
        let mountedSinglePageFastBootstrap = false;
        let fastItems = null;
        let fastCollectionSource = 'graphql';
        let parallelReadinessPromise = null;
        let carouselProfileLoggedForReadiness = false;
        const startParallelReadiness = () => {
            if (parallelReadinessPromise || !scroller || !track) return;
            resetCarouselDomRuntime(section);
            logCarouselDomProfile(section, 'before-readiness');
            carouselProfileLoggedForReadiness = true;
            parallelReadinessPromise = waitForNativeCarouselReady(section, scroller, track, sessionToken)
                .then(value => ({ value, error: null }), error => ({ value: null, error }));
        };
        try {
            if (targetSessionEntryKind === 'initial') {
                earlyTotalCount = await waitForMyListTotalCount(TOTAL_COUNT_TIMEOUT_MS, sessionToken);
                freshMyListBootstrap = {
                    totalCount: earlyTotalCount,
                    firstVideoId: netflixGraphql.firstMyListVideoId()
                };
            } else {
                const mountedFast = scroller && track
                    ? await tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken)
                    : null;
                if (mountedFast) {
                    freshMyListBootstrap = mountedFast;
                    mountedSinglePageFastBootstrap = true;
                    earlyTotalCount = mountedFast.totalCount;
                    log(tLog('totalCountDetected'), {
                        totalCount: earlyTotalCount,
                        detectionReason: mountedFast.source,
                        firstVideoId: mountedFast.firstVideoId || null,
                        elapsedMs: mountedFast.elapsedMs
                    });
                } else {
                    // When a non-empty native carousel is already mounted, readiness and
                    // the authoritative fresh count are independent read-only checks. Run
                    // them together instead of serializing their latency.
                    if (scroller && track && currentPageSlots(scroller, track).length > 0) {
                        startParallelReadiness();
                    }
                    freshMyListBootstrap = await netflixGraphql.fetchBootstrap(sessionToken);
                    earlyTotalCount = freshMyListBootstrap.totalCount;
                    log(tLog('totalCountDetected'), {
                        totalCount: earlyTotalCount,
                        detectionReason: 'fresh-netflix-my-list-carousel',
                        firstVideoId: freshMyListBootstrap.firstVideoId || null
                    });
                }
            }
            assertRouteSession(sessionToken);
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                initializationBlockedSessionToken = sessionToken;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || 'total-count-detection',
                    timeoutMs: error?.details?.timeoutMs ?? TOTAL_COUNT_TIMEOUT_MS,
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, null));
            }
            clearRunningSession(sessionToken);
            return;
        }
        if (earlyTotalCount === 0) {
            finalizeEmptyLegacyList(section, scroller, track, provisionalLayout, initializationStarted, 'totalCount-0');
            clearRunningSession(sessionToken);
            return;
        }

        // The My List heading can exist before the carousel itself. totalCount is
        // already authoritative here: a positive count must produce a native source,
        // otherwise initialization fails instead of being mistaken for an empty list.
        if (!scroller || !track) {
            let sourceWait;
            try {
                sourceWait = await waitForNativeSource(section, NATIVE_READY_TIMEOUT_MS, sessionToken);
            } catch (error) {
                if (!isRouteSessionCancelledError(error)) {
                    warn(tLog('nativeSourceWaitFailed'), error);
                }
                clearRunningSession(sessionToken);
                return;
            }
            assertRouteSession(sessionToken);
            if (sourceWait.nativeSection) {
                invalidateGridReact();
                document.getElementById(GRID_ID)?.remove();
                document.getElementById(STATUS_ID)?.remove();
                if (section.id === SYNTHETIC_SECTION_ID) section.remove();
                sourceState = null;
                completedSection = null;
                clearRunningSession(sessionToken);
                scheduleRun(0, sessionToken);
                return;
            }
            if (!sourceWait.found) {
                const error = initializationTimeoutError(sourceWait.stage || 'native-source', sourceWait.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: sourceWait.elapsedMs,
                    totalCount: earlyTotalCount
                });
                initializationBlockedSessionToken = sessionToken;
                nativeInitializationFailure = { section, scroller, track, sessionToken };
                warn(tLog('initializationFailed'), {
                    code: error.code,
                    stage: error.stage,
                    timeoutMs: error.details?.timeoutMs ?? null,
                    details: error.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                clearRunningSession(sessionToken, false);
                recoverNativeInitialization(sessionToken, 'native-source-wait');
                return;
            }
            scroller = sourceWait.scroller;
            track = sourceWait.track;
            sourceState.scroller = scroller;
            sourceState.track = track;
        }

        // Netflix can expose the My List section before its virtual carousel has finished
        // building. Do not alter the carousel (especially transition/animation styles)
        // until the native page/slot structure has settled.
        if (!carouselProfileLoggedForReadiness) {
            resetCarouselDomRuntime(section);
            logCarouselDomProfile(section, 'before-readiness');
            carouselProfileLoggedForReadiness = true;
        }
        let readiness;
        try {
            if (parallelReadinessPromise) {
                const parallelReadiness = await parallelReadinessPromise;
                if (parallelReadiness.error) throw parallelReadiness.error;
                readiness = parallelReadiness.value;
            } else {
                readiness = await waitForNativeCarouselReady(section, scroller, track, sessionToken, {
                    fastSinglePageTotalCount: mountedSinglePageFastBootstrap ? earlyTotalCount : null
                });
            }
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('nativeCarouselReadinessCheckFailed'), error);
            }
            clearRunningSession(sessionToken);
            return;
        }
        if (!readiness.ready) {
            initializationBlockedSessionToken = sessionToken;
            nativeInitializationFailure = { section, scroller, track, sessionToken };
            clearRunningSession(sessionToken, false);
            if (recoverNativeInitialization(sessionToken, 'readiness-' + readiness.reason)) return;
            const readinessError = readiness.reason === 'timeout'
                ? initializationTimeoutError(readiness.stage || 'native-carousel-readiness', readiness.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: readiness.elapsedMs,
                    state: readiness.state
                })
                : initializationError('NATIVE_CAROUSEL_NOT_READY', 'native-carousel-readiness', `Native carousel not ready: ${readiness.reason}`, readiness);
            warn(tLog('initializationFailed'), {
                code: readinessError.code,
                stage: readinessError.stage,
                timeoutMs: readinessError.details?.timeoutMs ?? null,
                error: readinessError,
                snapshot: collectRuntimeSnapshot()
            });
            updateStatus(formatInitializationErrorMeta(readinessError, earlyTotalCount));
            return;
        }
        if (readiness.empty) {
            const emptyLayout = measureVisibleLayout(section, scroller, track);
            emptyLayout.rowGap = measureNativeCarouselGap(section);
            finalizeEmptyLegacyList(section, scroller, track, emptyLayout, initializationStarted, readiness.reason);
            clearRunningSession(sessionToken);
            return;
        }
        const mountedProfile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);

        // A manual/order-mismatch reinitialization can start while Netflix still has
        // page 0 selected with a one-card-shifted mounted window after a My List delta.
        // The fresh CarouselPage response gives us an authoritative first video ID.
        // Normalize only legacy/indicator SPA sessions, before source-scan mode starts,
        // so normal initial-load performance and logical/Hawkins behavior are untouched.
        if (targetSessionEntryKind !== 'initial' &&
            mountedProfile.pageMode === 'indicator' &&
            freshMyListBootstrap?.firstVideoId) {
            try {
                await ensureFreshIndicatorPageZeroAnchor(
                    section,
                    scroller,
                    track,
                    freshMyListBootstrap.firstVideoId,
                    sessionToken
                );
            } catch (error) {
                if (!isRouteSessionCancelledError(error)) {
                    initializationBlockedSessionToken = sessionToken;
                    warn(tLog('initializationFailed'), {
                        code: error?.code || null,
                        stage: error?.stage || 'normalize-native-page-zero',
                        timeoutMs: error?.details?.timeoutMs ?? null,
                        details: error?.details || null,
                        error,
                        snapshot: collectRuntimeSnapshot()
                    });
                    updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                }
                clearRunningSession(sessionToken);
                return;
            }
        }

        if (mountedProfile.pageMode === 'logical') {
            try {
                const mountedCountState = requireNativeReactCarouselTotalCount(scroller, track, earlyTotalCount);
                const mountedTotalCount = mountedCountState.totalCount;
                if (mountedTotalCount !== earlyTotalCount) {
                    warn('Netflix My List totalCount reconciled from mounted carousel', {
                        provisionalTotalCount: earlyTotalCount,
                        mountedTotalCount,
                        readings: mountedCountState.readings,
                        entryKind: targetSessionEntryKind,
                        provisionalSource: targetSessionEntryKind === 'initial'
                            ? 'graphql-cache'
                            : 'fresh-netflix-my-list-carousel'
                    });
                } else {
                    log('Netflix My List mounted totalCount confirmed', {
                        totalCount: mountedTotalCount,
                        readings: mountedCountState.readings,
                        entryKind: targetSessionEntryKind
                    });
                }
                earlyTotalCount = mountedTotalCount;
                if (sourceState) sourceState.totalCount = mountedTotalCount;
            } catch (error) {
                if (!isRouteSessionCancelledError(error)) {
                    initializationBlockedSessionToken = sessionToken;
                    warn(tLog('initializationFailed'), {
                        code: error?.code || null,
                        stage: error?.stage || 'native-react-total-count',
                        timeoutMs: error?.details?.timeoutMs ?? null,
                        details: error?.details || null,
                        error,
                        snapshot: collectRuntimeSnapshot()
                    });
                    updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                }
                clearRunningSession(sessionToken);
                return;
            }
        }

        if (mountedProfile.pageMode === 'logical') {
            try {
                const graphqlLayout = measureVisibleLayout(section, scroller, track);
                const templateSlot = currentPageSlots(scroller, track)[0] || netflixDom.filledSlots(track)[0];
                const graphqlCollection = await netflixGraphql.collectLogicalItems({
                    bootstrap: freshMyListBootstrap,
                    totalCount: earlyTotalCount,
                    columns: graphqlLayout.columns,
                    templateSlot,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                freshMyListBootstrap = graphqlCollection.bootstrap;
                fastItems = graphqlCollection.items;
                fastCollectionSource = graphqlCollection.collectionSource || 'graphql';
                if (graphqlCollection.error) throw graphqlCollection.error;
                if (fastItems) {
                    const runtime = getCarouselDomRuntime(section);
                    runtime.knownPageCount = Math.max(1, Math.ceil(earlyTotalCount / Math.max(1, graphqlLayout.columns)));
                    runtime.pageCountFinalized = true;
                    log(fastCollectionSource === 'mounted-single-page'
                        ? 'Mounted single-page My List fast collection prepared' : 'GraphQL My List fast collection prepared', {
                        collectionSource: fastCollectionSource,
                        avoidedMembershipRequests: fastCollectionSource === 'mounted-single-page' ? 1 : 0,
                        totalCount: earlyTotalCount,
                        collected: fastItems.length,
                        graphqlPageCount: freshMyListBootstrap.graphqlPageCount || null,
                        columns: graphqlLayout.columns,
                        knownPageCount: runtime.knownPageCount
                    });
                } else {
                    warn('GraphQL My List fast collection was incomplete; falling back to native scan', {
                        totalCount: earlyTotalCount,
                        bootstrapTotalCount: freshMyListBootstrap?.totalCount,
                        graphqlEdgeCount: freshMyListBootstrap?.graphqlEdges?.length || 0,
                        graphqlPageCount: freshMyListBootstrap?.graphqlPageCount || null,
                        columns: graphqlLayout.columns
                    });
                }
            } catch (error) {
                if (isRouteSessionCancelledError(error)) {
                    clearRunningSession(sessionToken);
                    return;
                }
                warn('GraphQL My List fast collection failed; falling back to native scan', {
                    code: error?.code || null,
                    stage: error?.stage || 'graphql-fast-collection',
                    error
                });
            }
        }

        log(tLog('initializationStarted'), {
            version: SCRIPT_VERSION,
            browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(),
            netflixLanguage: getNetflixLanguage(),
            displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            selectedPage: selectedPage(section),
            pages: pageCount(section),
            sourceSlots: netflixDom.directSlots(track).length,
            sourceCards: netflixDom.filledSlots(track).length,
            carouselDom: carouselDomProfileSummary(section)
        });

        let retryGridBuild = false;
        try {
            const layout = measureVisibleLayout(section, scroller, track);
            layout.rowGap = measureNativeCarouselGap(section);
            const totalCount = earlyTotalCount;
            const initialPages = pageCount(section);
            log(tLog('initialLayoutMeasured'), {
                layout: layoutSummary(layout),
                totalCount,
                initialPages,
                selectedPage: selectedPage(section),
                currentPageCards: currentPageSlots(scroller, track).length
            });

            const status = updateStatus(formatHeaderParts(0, totalCount, null));
            scroller.insertAdjacentElement('afterend', status);
            syncStatusTypography(section, status);
            const initialStatusGeometry = currentGridGeometry(section, layout);
            status.style.marginLeft = `${initialStatusGeometry.left}px`;
            status.style.width = `${initialStatusGeometry.width}px`;
            status.style.setProperty('--tm-row-gap', `${layout.rowGap}px`);

            // Fast collection skips beginSourceScan(), but hover-driven native
            // moves still need the track marker used by the animation suppression CSS.
            track.classList.add('tm-netflix-mylist-v15-track');
            waitingForNativeEmpty = false;
            sourceState = { section, scroller, track, layout, initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount };
            let items;
            if (fastItems?.length === totalCount) {
                items = fastItems;
                log(fastCollectionSource === 'mounted-single-page'
                    ? 'Mounted single-page My List fast collection used' : 'GraphQL My List fast collection used', {
                    collectionSource: fastCollectionSource,
                    collected: items.length,
                    totalCount,
                    pages: pageCount(section),
                    sourceCards: netflixDom.filledSlots(track).length,
                    carouselDom: carouselDomProfileSummary(section)
                });
            } else {
                // Keep the native carousel in place while scanning so Netflix layout and
                // tabindex/current-slot detection continue to reflect native state.
                beginSourceScan(section, scroller, track);
                log(tLog('nativeCarouselScanModeStarted'), {
                    selectedPage: selectedPage(section),
                    pages: pageCount(section),
                    sourceSlots: netflixDom.directSlots(track).length,
                    sourceCards: netflixDom.filledSlots(track).length,
                    carouselDom: carouselDomProfileSummary(section)
                });
                items = await collectAllItems(section, scroller, track, totalCount, sessionToken);
            }
            if (!items.length) {
                const nowState = nativeCarouselReadiness(section, scroller, track);
                if (nowState.pages === 1 && nowState.cards === 0) {
                    finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, 'collection-confirmed-empty');
                    return;
                }
                const noCardsError = new Error(tLog('noNativeNetflixCardsCouldBeCollected'));
                noCardsError.code = 'NO_NATIVE_CARDS';
                throw noCardsError;
            }

            if (Number.isFinite(totalCount) && items.length !== totalCount) {
                const countError = initializationError(
                    'COLLECTION_COUNT_MISMATCH',
                    'validate-count',
                    `Collected ${items.length} of ${totalCount} My List items`,
                    { collected: items.length, totalCount, endingPage: selectedPage(section) }
                );
                warn(tLog('collectedCountDoesNotMatchTotalCount'), {
                    collected: items.length,
                    totalCount,
                    stage: countError.stage,
                    code: countError.code
                });
                throw countError;
            }

            log(tLog('fullCollectionResultFinalized'), {
                collected: items.length,
                totalCount,
                endingPage: selectedPage(section),
                items: items.map(itemSummary)
            });

            // Keep the native carousel at its normal position and size for React resynchronization.
            parkSource(scroller);
            log(tLog('nativeCarouselStandbyMode'), {
                selectedPage: selectedPage(section),
                parked: scroller.classList.contains(SOURCE_PARKED_CLASS)
            });
            await buildGrid(section, scroller, items, layout, totalCount, sessionToken);
            assertRouteSession(sessionToken);
            sourceState.empty = false;
            applyOriginalMyListVisibility();

            // Defer React-backed hover preparation until the first actual hover.
            // The live native card is resolved on demand, keeping initialization off the hover path.
            log(tLog('initialHoverPreparationDeferred'), {
                selectedPage: selectedPage(section),
                currentPageCards: currentPageSlots(scroller, track).length
            });
            if (sourceState) { sourceState.collectedCount = items.length; sourceState.totalCount = totalCount; }
            completedSection = section;
            if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
                performanceDiagnostics.nativeRecovery.completed++;
            }
            resetOrderMismatchStateAfterInitialization();
            sourceState.initializationElapsedMs = performance.now() - initializationStarted;
            updateStatus(formatHeaderParts(items.length, totalCount, sourceState.initializationElapsedMs, true));

            initializeWatchGroups(sourceState, sessionToken);

            log(tLog('initializationCompleted'), {
                collected: items.length,
                totalCount,
                    initialPages,
                initialColumns: layout.columns,
                initialCardWidth: layout.cardWidth,
                initializationElapsedMs: Math.round(sourceState.initializationElapsedMs),
                snapshot: collectRuntimeSnapshot()
            });
        } catch (error) {
            if (isRouteSessionCancelledError(error)) {
                log(tLog('initializationCancelledByRouteChange'), {
                    sessionToken,
                    url: location.href
                });
            } else if (error?.code === 'GRID_BUILD_SOURCE_REPLACED') {
                log('Grid construction discarded after native source replacement', { sessionToken });
                cleanupTargetSessionDom();
                sourceState = null;
                completedSection = null;
                retryGridBuild = true;
            } else {
                initializationBlockedSessionToken = sessionToken;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || null,
                    timeoutMs: error?.details?.timeoutMs ?? null,
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
            }
        } finally {
            // Keep queued deltas deferred until the replacement source has a
            // complete grid, rather than applying them to an incomplete frame.
            clearRunningSession(sessionToken, !retryGridBuild);
            if (retryGridBuild && isRouteSessionActive(sessionToken)) runScript(sessionToken);
        }
    }

    function scheduleRun(delayMs = 40, sessionToken = routeSessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        if (initializationBlockedSessionToken === sessionToken) return;

        const normalizedDelay = Math.max(0, delayMs);
        const dueAt = performance.now() + normalizedDelay;
        if (scheduled && scheduledSessionToken === sessionToken) {
            // Keep an existing earlier/equal run, but allow a DOM mutation to pull a
            // long fallback wait (notably the native-section 1200 ms wait) forward.
            if (scheduledRunDueAt > 0 && scheduledRunDueAt <= dueAt + 1) return;
        }

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduled = true;
        scheduledSessionToken = sessionToken;
        scheduledRunDueAt = dueAt;
        scheduledRunTimer = setTimeout(() => {
            scheduledRunTimer = null;
            if (scheduledSessionToken === sessionToken) {
                scheduled = false;
                scheduledSessionToken = null;
                scheduledRunDueAt = 0;
            }
            if (!isRouteSessionActive(sessionToken)) return;
            runScript(sessionToken);
        }, normalizedDelay);
    }

    loadSettings();
    refreshMenuCommands();
    installSpaNavigationHooks();
    log(tLog('scriptStarted'), {
        version: SCRIPT_VERSION,
        url: location.href,
        userAgent: navigator.userAgent,
        browserLanguage: navigator.language || '',
        htmlLanguage: getHtmlLanguage(),
        netflixLanguage: getNetflixLanguage(),
        displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio
    });
    handleRouteChange('initial');
})();
