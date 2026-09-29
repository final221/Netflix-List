// ==UserScript==
// @name         My List for Netflix
// @version      1.0.8
// @description  Displays your Netflix My List in an easy-to-browse grid.
// @author       final221
// @license      MIT
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @sandbox      raw
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
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
    const CANCELLED_MOVE_POLL_MS = 80;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    const LOGICAL_COLLECTION_TIMEOUT_MS = 120000;
    const TOTAL_COUNT_TIMEOUT_MS = 5000;
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = 10000;
    const GRAPHQL_COLLECTION_PAGE_SIZE = 75;
    const GRAPHQL_COLLECTION_MAX_PAGES = 8;

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
    const SCRIPT_VERSION = '1.0.8';
    const LOG_PREFIX = `[${SCRIPT_NAME} v${SCRIPT_VERSION}]`;
    const MAX_LOG_ENTRIES = 5000;
    const FAST_MOVE_CLASS = 'tm-netflix-mylist-v22-fast-move';
    const ORIGINAL_HIDDEN_CLASS = 'tm-netflix-mylist-original-hidden';
    const ORIGINAL_VISIBILITY_ATTR = 'data-tm-original-mylist-visible';
    const ORIGINAL_HEADER_CLASS = 'tm-netflix-mylist-original-header';
    const SYNTHETIC_SECTION_ID = 'tm-netflix-mylist-empty-section';
    const LEGACY_EMPTY_STATE_ID = 'tm-netflix-mylist-v48-empty-state';
    const SETTINGS_STORAGE_KEY = 'legacyMyListForNetflix.settings.v3';
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

    const LOG_MESSAGES = {
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
    let hoverSequence = 0;
    let responsiveSequence = 0;
    let lastResponsiveReason = '';
    let lastObservedUrl = location.href;
    let routeChangeSequence = 0;
    let routeSessionToken = 0;
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
    let myListMutationSequence = 0;
    let waitingForNativeEmpty = false;
    let cachedNativeEmptyContent = null;
    let cachedNativeEmptyMessage = '';
    let initializationBlockedSessionToken = null;
    const investigationLog = [];

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

    function hoverPreparationCancelled(token) {
        return token !== null && token !== undefined && token !== hoverToken;
    }

    function clearRunningSession(sessionToken) {
        if (runningSessionToken !== sessionToken) return;
        running = false;
        runningSessionToken = null;
        retryPendingMyListMutations('after-initialization');
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
        recentRemovedMyListItems.clear();
        myListGraphqlKey = null;
        waitingForNativeEmpty = false;
        cachedNativeEmptyContent = null;
        cachedNativeEmptyMessage = '';
    }

    function cleanupTargetSessionDom() {
        restoreActiveCarouselStyles();
        clearSourceAlignment();

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
        recentRemovedMyListItems.clear();

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
        initializationBlockedSessionToken = null;
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
        investigationLog.push(
            `[${formatSystemTimestamp()}] ${level.padEnd(5, ' ')} ${body}`
        );
        if (investigationLog.length > MAX_LOG_ENTRIES) {
            investigationLog.splice(0, investigationLog.length - MAX_LOG_ENTRIES);
        }
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
            rect: rectSummary(slot.getBoundingClientRect?.())
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
            gridCards: grid ? grid.querySelectorAll(':scope > [data-virtual-slot]').length : 0,
            sourceScan: Boolean(scroller?.classList?.contains(SOURCE_SCAN_CLASS)),
            sourceParked: Boolean(scroller?.classList?.contains(SOURCE_PARKED_CLASS)),
            sourceGeometryProxy: Boolean(activeGeometryProxy),
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
            pointer: { x: lastPointerX, y: lastPointerY }
        };
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
            '---',
            ...investigationLog
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

            #${GRID_ID} > [data-virtual-slot] {
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
        const sectionRect = section.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
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
            .map(slot => slot.getBoundingClientRect())
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
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        };
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(section, { allowProvisional: true });
        completedSection = section;
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

    function buildGraphqlMyListItems(edges, totalCount, columns, templateSlot) {
        if (!Array.isArray(edges) || !templateSlot || !Number.isFinite(totalCount)) return null;
        const items = [];
        const seen = new Set();
        for (const edge of edges) {
            const node = edge?.node;
            const videoId = videoIdFromGraphqlNode(node);
            if (!videoId || seen.has(videoId)) continue;
            const snapshot = templateSlot.cloneNode(true);
            const card = snapshot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            if (!card) return null;
            const href = `${location.origin}/browse?jbv=${encodeURIComponent(videoId)}`;
            const title = firstGraphqlText(node?.displayString) || firstGraphqlText(node) || `Netflix ${videoId}`;
            const imageUrl = firstGraphqlImageUrl(node?.contextualArtwork) || firstGraphqlImageUrl(node);
            card.setAttribute('href', href);
            card.href = href;
            card.setAttribute('aria-label', title);
            const image = snapshot.querySelector('img');
            if (imageUrl && image) {
                image.src = imageUrl;
                image.removeAttribute('srcset');
                image.setAttribute('data-tm-graphql-image', 'true');
            }
            const index = items.length;
            items.push({
                href,
                videoId,
                page: Math.floor(index / Math.max(1, columns)),
                logicalIndex: index,
                ariaLabel: title,
                snapshot,
                graphql: true
            });
            seen.add(videoId);
        }
        return items.length === totalCount ? items : null;
    }

    async function fetchFreshMyListBootstrapViaCarousel(sessionToken = null) {
        assertRouteSession(sessionToken);
        const entry = findMyListGraphqlEntry();
        const rowId = entry?.value?._id;
        if (!rowId) {
            throw initializationError(
                'FRESH_MY_LIST_CAROUSEL_ID_UNAVAILABLE',
                'fresh-my-list-carousel',
                'Could not identify the current Netflix My List carousel id',
                { graphqlKey: entry?.key || null, detectionReason: entry?.reason || null }
            );
        }

        const variables = {
            rowId,
            ...carouselArtworkVariables(),
            carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
            carouselAfterCursor: null,
            eddEnabled: false,
            fetchHighResCards: false
        };
        const body = {
            operationName: 'CarouselPage',
            variables,
            extensions: {
                persistedQuery: {
                    id: 'a4ec8877-bccc-49bd-930b-34eaa1d3b7e0',
                    version: 102
                }
            }
        };
        const headers = {
            'content-type': 'application/json',
            'x-netflix.context.ui-flavor': 'akira',
            'x-netflix.context.operation-name': 'CarouselPage',
            'X-Netflix.Request.Originating.Url': location.href
        };
        const serverDefs = netflixModelData('serverDefs');
        const appVersion = serverDefs?.BUILD_IDENTIFIER;
        if (appVersion) headers['x-netflix.context.app-version'] = String(appVersion);
        const geo = netflixModelData('geo');
        const locale = geo?.locale?.id || document.documentElement.lang;
        if (locale) headers['x-netflix.context.locales'] = String(locale).toLowerCase();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FRESH_MY_LIST_FETCH_TIMEOUT_MS);
        const started = performance.now();
        try {
            const response = await fetch('https://web.prod.cloud.netflix.com/graphql', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal
            });
            assertRouteSession(sessionToken);
            if (!response.ok) {
                throw initializationError(
                    'FRESH_MY_LIST_CAROUSEL_HTTP_ERROR',
                    'fresh-my-list-carousel',
                    `Netflix CarouselPage returned HTTP ${response.status}`,
                    { status: response.status, statusText: response.statusText, responseUrl: response.url }
                );
            }
            const text = await response.text();
            assertRouteSession(sessionToken);
            let payload;
            try {
                payload = JSON.parse(text);
            } catch (error) {
                throw initializationError(
                    'FRESH_MY_LIST_CAROUSEL_PARSE_ERROR',
                    'fresh-my-list-carousel',
                    'Netflix CarouselPage returned invalid JSON',
                    { responseUrl: response.url, responseBytes: text.length, errorMessage: error?.message || String(error) }
                );
            }
            let node = payload?.data?.node;
            const totalCount = Number(node?.entities?.totalCount);
            if (node?.__typename !== 'PinotCarouselSection' || !Number.isFinite(totalCount) || totalCount < 0) {
                throw initializationError(
                    'FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE',
                    'fresh-my-list-carousel',
                    'Could not read the current Netflix My List totalCount from CarouselPage',
                    {
                        responseUrl: response.url,
                        responseBytes: text.length,
                        typename: node?.__typename || null,
                        graphqlErrors: Array.isArray(payload?.errors) ? payload.errors.map(item => item?.message || String(item)) : []
                    }
                );
            }
            const edges = [...(node?.entities?.edges || [])];
            let cursor = node?.entities?.pageInfo?.endCursor || null;
            let graphqlPageCount = 1;
            while (node?.entities?.pageInfo?.hasNextPage && cursor && graphqlPageCount < GRAPHQL_COLLECTION_MAX_PAGES) {
                assertRouteSession(sessionToken);
                const nextBody = {
                    ...body,
                    variables: { ...variables, carouselAfterCursor: cursor }
                };
                const nextResponse = await fetch('https://web.prod.cloud.netflix.com/graphql', {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    redirect: 'follow',
                    headers,
                    body: JSON.stringify(nextBody),
                    signal: controller.signal
                });
                assertRouteSession(sessionToken);
                if (!nextResponse.ok) {
                    throw initializationError(
                        'FRESH_MY_LIST_CAROUSEL_HTTP_ERROR',
                        'fresh-my-list-carousel',
                        `Netflix CarouselPage returned HTTP ${nextResponse.status}`,
                        { status: nextResponse.status, statusText: nextResponse.statusText, responseUrl: nextResponse.url }
                    );
                }
                const nextText = await nextResponse.text();
                assertRouteSession(sessionToken);
                let nextPayload;
                try {
                    nextPayload = JSON.parse(nextText);
                } catch (error) {
                    throw initializationError(
                        'FRESH_MY_LIST_CAROUSEL_PARSE_ERROR',
                        'fresh-my-list-carousel',
                        'Netflix CarouselPage returned invalid JSON',
                        { responseUrl: nextResponse.url, responseBytes: nextText.length, errorMessage: error?.message || String(error) }
                    );
                }
                node = nextPayload?.data?.node;
                const nextTotalCount = Number(node?.entities?.totalCount);
                if (node?.__typename !== 'PinotCarouselSection' || nextTotalCount !== totalCount) {
                    throw initializationError(
                        'FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE',
                        'fresh-my-list-carousel',
                        'Netflix CarouselPage returned inconsistent My List pagination data',
                        { responseUrl: nextResponse.url, totalCount, nextTotalCount, typename: node?.__typename || null }
                    );
                }
                edges.push(...(node?.entities?.edges || []));
                cursor = node?.entities?.pageInfo?.endCursor || null;
                graphqlPageCount++;
            }
            if (node?.entities?.pageInfo?.hasNextPage) {
                throw initializationError(
                    'FRESH_MY_LIST_CAROUSEL_PAGE_LIMIT',
                    'fresh-my-list-carousel',
                    'Netflix CarouselPage exceeded the configured GraphQL page limit',
                    { totalCount, graphqlPageCount, maxPages: GRAPHQL_COLLECTION_MAX_PAGES, edgeCount: edges.length }
                );
            }
            const fresh = {
                totalCount,
                firstVideoId: firstVideoIdFromCarouselNode({ entities: { edges } }),
                graphqlEdges: edges,
                graphqlPageCount
            };
            log('Fresh Netflix My List carousel fetched', {
                totalCount: fresh.totalCount,
                firstVideoId: fresh.firstVideoId || null,
                graphqlKey: entry?.key || null,
                responseUrl: response.url,
                responseBytes: text.length,
                elapsedMs: Math.round(performance.now() - started),
                operationName: 'CarouselPage',
                carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                graphqlPageCount: fresh.graphqlPageCount,
                graphqlEdgeCount: fresh.graphqlEdges.length
            });
            return fresh;
        } catch (error) {
            if (isRouteSessionCancelledError(error)) throw error;
            if (error?.code && error?.stage) throw error;
            const aborted = error?.name === 'AbortError';
            throw initializationError(
                aborted ? 'FRESH_MY_LIST_CAROUSEL_TIMEOUT' : 'FRESH_MY_LIST_CAROUSEL_FAILED',
                'fresh-my-list-carousel',
                aborted
                    ? `Netflix CarouselPage timed out after ${FRESH_MY_LIST_FETCH_TIMEOUT_MS} ms`
                    : `Netflix CarouselPage failed: ${error?.message || error}`,
                {
                    timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                    errorName: error?.name || null,
                    errorMessage: error?.message || String(error || '')
                }
            );
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function fetchFreshMyListBootstrapViaPage(sessionToken = null) {
        assertRouteSession(sessionToken);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FRESH_MY_LIST_FETCH_TIMEOUT_MS);
        const requestUrl = new URL('/browse/my-list', location.origin);
        requestUrl.searchParams.set('_tm_legacy_mylist_refresh', `${Date.now()}-${sessionToken ?? 0}`);
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
                signal: controller.signal
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
            clearTimeout(timeoutId);
        }
    }

    async function fetchFreshMyListBootstrap(sessionToken = null) {
        assertRouteSession(sessionToken);
        try {
            return await fetchFreshMyListBootstrapViaCarousel(sessionToken);
        } catch (error) {
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
            const freshBootstrap = bootstrap?.graphqlEdges?.length
                ? bootstrap
                : await fetchFreshMyListBootstrapViaCarousel(sessionToken);
            return {
                bootstrap: freshBootstrap,
                items: buildGraphqlMyListItems(
                    freshBootstrap?.graphqlEdges,
                    totalCount,
                    columns,
                    templateSlot
                )
            };
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
        const sourceCards = netflixDom.filledSlots(track).length;

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

    function pruneUndoEntries(now = performance.now()) {
        for (const [videoId, entry] of recentRemovedMyListItems.entries()) {
            if (!entry || now - entry.removedAt > UNDO_ENTRY_TTL_MS) {
                recentRemovedMyListItems.delete(videoId);
            }
        }
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
            const item = itemFromSlot(slot, live.selectedPage || 0);
            if (item?.videoId === String(videoId)) return item;
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
        return true;
    }

    function adoptLiveEmptyMyListSection(live) {
        if (!sourceState || !live?.section || live.scroller || live.track) return false;
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

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
        rememberUndoEntry(removed, index);
        const clone = sourceState.cloneMap?.get(key);
        if (activeVideoId === String(videoId) || activeClone === clone) {
            hoverToken++;
            clearSourceAlignment();
            activeVideoId = null;
            activeClone = null;
            activePage = null;
        }
        clone?.remove();
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
        if (!sourceState || !item?.videoId || !item.snapshot) return false;
        const key = itemKey(item);
        if (sourceState.itemMap?.has(key) || sourceState.items?.some(existing => itemKey(existing) === key)) return false;

        const items = sourceState.items || (sourceState.items = []);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!grid) return false;
        ensureGridHoverBehavior(grid);
        const index = Math.max(0, Math.min(items.length, Number.isFinite(preferredIndex) ? Math.floor(preferredIndex) : 0));
        item.page = Math.floor(index / Math.max(1, sourceState.layout?.columns || 1));
        items.splice(index, 0, item);

        const clone = item.snapshot.cloneNode(true);
        normalizeClone(clone);
        copyItemAttributes(clone, item, index);
        associateGridHoverItem(item, clone);
        const before = grid.children[index] || null;
        grid.insertBefore(clone, before);
        sourceState.cloneMap ||= new Map();
        sourceState.cloneMap.set(key, clone);
        sourceState.itemMap ||= new Map();
        sourceState.itemMap.set(key, item);
        recentRemovedMyListItems.delete(String(item.videoId));
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
            .map(slot => itemFromSlot(slot, live.selectedPage || 0))
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
        if (grid) {
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
        if (running || responsiveRefreshing) {
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
        if (!candidate?.snapshot) return false;

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
            hasFallbackSnapshot: Boolean(fallbackItem?.snapshot)
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
        const legacyLeft = section?.querySelector?.('[data-uia="carousel-left-button"]') || null;
        const legacyRight = section?.querySelector?.('[data-uia="carousel-right-button"]') || null;
        const hawkinsLeft = section?.querySelector?.('[data-uia="carousel-hawkins-left-button"]') || null;
        const hawkinsRight = section?.querySelector?.('[data-uia="carousel-hawkins-right-button"]') || null;
        const indicatorItems = section ? [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')] : [];
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
        return {
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
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            const items = [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')];
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
            return section.querySelectorAll('[data-uia="carousel-page-indicator-item"]').length || 1;
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
        const previousMove = carouselMoveQueue;
        let releaseMove;
        carouselMoveQueue = new Promise(resolve => { releaseMove = resolve; });

        try {
            await previousMove.catch(() => {});
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
            releaseMove();
        }
    }

    async function goToPage(section, scroller, target, token = null, sessionToken = null, preferCyclicShortest = false) {
        assertRouteSession(sessionToken);
        const total = pageCount(section);
        target = Math.max(0, Math.min(total - 1, target));
        const startPage = selectedPage(section);

        if (startPage !== target) {
            log(tLog('pageMoveRequested'), { from: startPage, target, total, token, preferCyclicShortest });
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
            if (forcedDirection === null && preferCyclicShortest && total > 1) {
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
            if (next === current && preferCyclicShortest && total > 1) {
                // Hawkins logical pages stop at both ends; they do not wrap even
                // when the shortest cyclic direction would cross a boundary.
                // Retry once in the direct direction so the target page remains
                // reachable from either edge.
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
                guardRemaining: guard
            });
        }
        return result;
    }

    function currentPageSlots(scroller, track) {
        const all = netflixDom.filledSlots(track);
        if (!all.length) return [];

        const sr = scroller.getBoundingClientRect();
        const visible = all
            .map(slot => ({ slot, rect: slot.getBoundingClientRect() }))
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
        if (active.length) {
            // During Hawkins virtual-window hydration Netflix can leave only
            // the first card tabbable while the remaining visible cards exist.
            // Prefer the complete geometric viewport window in that state.
            if (visible.length > active.length) return visible;
            return active.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        }

        return visible;
    }

    function visibleSignature(slots) {
        return slots.map(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.href || card?.getAttribute('href') || '';
        }).filter(Boolean).join('|');
    }

    function nativeCarouselReadiness(section, scroller, track) {
        const slots = netflixDom.directSlots(track);
        const cards = netflixDom.filledSlots(track);
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
            const state = nativeCarouselReadiness(section, scroller, track);
            const countState = nativeReactCarouselTotalCount(scroller, track);
            const totalCount = countState.totalCount;
            const slots = currentPageSlots(scroller, track);
            const itemIndices = slots.map(netflixItemIndexFromSlot);
            const videoIds = slots.map(nativeCardIdentity).filter(Boolean);
            const expectedIndices = Number.isSafeInteger(totalCount)
                ? Array.from({ length: totalCount }, (_, index) => index)
                : [];
            const indicesComplete =
                itemIndices.length === expectedIndices.length &&
                itemIndices.every((value, index) => value === expectedIndices[index]);
            const identitiesComplete =
                videoIds.length === slots.length &&
                new Set(videoIds).size === videoIds.length;
            const eligible =
                state.connected &&
                state.pageMode === 'logical' &&
                state.pages === 1 &&
                Number.isSafeInteger(totalCount) &&
                totalCount > 0 &&
                totalCount <= state.columns &&
                state.slots === totalCount &&
                state.cards === totalCount &&
                state.currentCards === totalCount &&
                countState.slots === totalCount &&
                countState.uniqueReadings.length === 1 &&
                countState.uniqueReadings[0] === totalCount &&
                indicesComplete &&
                identitiesComplete;

            if (!eligible) return null;

            const signature = [
                totalCount,
                state.signature,
                itemIndices.join(','),
                videoIds.join('|')
            ].join('||');
            if (previousSignature && signature === previousSignature) {
                const result = {
                    totalCount,
                    firstVideoId: videoIds[0] || null,
                    source: 'mounted-single-page-fast-path',
                    elapsedMs: Math.round(performance.now() - started)
                };
                log('Mounted single-page My List fast bootstrap confirmed', {
                    ...result,
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

    function itemFromSlot(slot, page) {
        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return null;

        const href = card.href || card.getAttribute('href') || '';
        if (!href) return null;

        const snapshot = slot.cloneNode(true);
        return {
            href,
            videoId: videoIdFromHref(href),
            page,
            ariaLabel: card.getAttribute('aria-label') || '',
            snapshot
        };
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
        return netflixReactCarousel.readItemIndex(slot).value;
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
        const pages = Math.max(1, Math.ceil(totalCount / Math.max(1, columns)));
        for (let page = 0; page < pages; page++) {
            const expected = expectedLogicalIndicesForPage(totalCount, columns, page);
            if (expected.length !== actual.length) continue;
            if (expected.every((value, index) => value === actual[index])) return page;
        }
        return null;
    }

    function nativeLogicalPageState(scroller, track, totalCount, columns) {
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
                        incomplete('collect-page', 'invalid-logical-index', {
                            page,
                            itemIndex: position.itemIndex,
                            logicalIndex
                        });
                    }
                    const canonicalPage = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                    const item = itemFromSlot(position.slot, canonicalPage);
                    if (!item) continue;
                    const key = itemKey(item);
                    const existingAtIndex = itemsByLogicalIndex.get(logicalIndex);
                    if (existingAtIndex && itemKey(existingAtIndex) !== key) {
                        incomplete('collect-page', 'logical-index-content-changed-during-scan', {
                            page,
                            logicalIndex,
                            previous: itemSummary(existingAtIndex),
                            current: itemSummary(item)
                        });
                    }
                    const existingIndex = videoIndex.get(key);
                    if (Number.isSafeInteger(existingIndex) && existingIndex !== logicalIndex) {
                        incomplete('collect-page', 'video-id-moved-during-scan', {
                            page,
                            key,
                            previousLogicalIndex: existingIndex,
                            currentLogicalIndex: logicalIndex
                        });
                    }
                    if (existingAtIndex) continue;
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
                    const item = itemFromSlot(slot, actualPage);
                    if (!item) continue;
                    const key = itemKey(item);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    items.push(item);
                }

                const added = items.slice(beforeCount);
                log(tLog('collectionPageResult'), {
                    actualPage,
                    added: added.length,
                    total: items.length,
                    goal,
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
    }

    function currentGridGeometry(section, layout) {
        const sectionRect = section.getBoundingClientRect();
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
            log(tLog('hoverExpectedPageMatch'), {
                item: itemSummary(item),
                expectedPage,
                selectedPage: selectedPage(section),
                source: slotDescriptor(slot)
            });
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
            log(tLog('hoverExpectedPageMatch'), {
                item: itemSummary(item),
                expectedPage,
                selectedPage: selectedPage(section),
                source: slotDescriptor(slot),
                afterStabilityWait: true
            });
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

        log('Hover stale logical page refreshed without full carousel scan', {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            source: slotDescriptor(slot)
        });
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
                log(tLog('hoverSourceFound'), {
                    item: itemSummary(item),
                    actualPage: actual,
                    source: slotDescriptor(slot)
                });
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
        sourceState.cloneMap.set(itemKey(item), clone);
    }

    function findItemForSourceSlot(slot) {
        const card = slot?.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card || !sourceState?.itemMap) return null;
        return sourceState.itemMap.get(itemKeyFromCard(card)) || null;
    }

    function invalidateGridReact(except = null) {
        const grid = document.getElementById(GRID_ID);
        if (!grid) return;
        for (const clone of grid.querySelectorAll(':scope > [data-virtual-slot]')) {
            if (clone === except) continue;
            if (clone.getAttribute('data-tm-hover-ready') === 'true') {
                netflixReactHover.clearClone(clone);
                clone.removeAttribute('data-tm-hover-ready');
                clone.removeAttribute('data-tm-backed-page');
            }
        }
    }

    function restoreGeometryProxy() {
        const proxy = activeGeometryProxy;
        if (!proxy) return;

        for (const entry of proxy.entries) {
            for (const method of ['getBoundingClientRect', 'getClientRects']) {
                const descriptor = entry.descriptors[method];
                try {
                    if (descriptor) {
                        Object.defineProperty(entry.source, method, descriptor);
                    } else {
                        delete entry.source[method];
                    }
                } catch (_) {}
            }
        }

        proxy.sourceSlot.removeAttribute('data-tm-source-proxied');
        activeGeometryProxy = null;
    }

    function clearSourceAlignment(slot = activeSourceSlot) {
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
        if (!sourceSlot?.isConnected) return;
        const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) || sourceSlot;
        const rect = card.getBoundingClientRect();
        const x = Number.isFinite(triggerEvent?.clientX) ? triggerEvent.clientX : rect.left + rect.width / 2;
        const y = Number.isFinite(triggerEvent?.clientY) ? triggerEvent.clientY : rect.top + rect.height / 2;

        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            screenX: Number.isFinite(triggerEvent?.screenX) ? triggerEvent.screenX : x,
            screenY: Number.isFinite(triggerEvent?.screenY) ? triggerEvent.screenY : y,
            relatedTarget: null
        };

        try {
            card.dispatchEvent(new PointerEvent('pointerover', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            card.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        card.dispatchEvent(new MouseEvent('mouseover', common));
        card.dispatchEvent(new MouseEvent('mousemove', common));
    }

    function scheduleNativeHoverReplay(sourceSlot, item, clone, triggerEvent, actualPage, reason) {
        requestAnimationFrame(() => {
            if (gridHoverSuppressed()) return;
            if (!sourceSlot?.isConnected || !clone?.isConnected) return;
            if (activeClone !== clone || activeVideoId !== item.videoId) return;

            const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const sourceVideoId = videoIdFromHref(card?.href || card?.getAttribute?.('href') || '');
            if (!sourceVideoId || sourceVideoId !== item.videoId) {
                warn(tLog('nativeHoverReplayCancelled'), {
                    reason: 'source-video-id-mismatch',
                    targetVideoId: item.videoId,
                    sourceVideoId,
                    source: slotDescriptor(sourceSlot)
                });
                clearSourceAlignment();
                activeVideoId = null;
                activeClone = null;
                activePage = null;
                return;
            }

            log(tLog('nativeHoverReplayedFromLiveSource'), {
                item: itemSummary(item),
                actualPage,
                reason,
                triggerEvent: triggerEvent?.type || '',
                source: slotDescriptor(sourceSlot)
            });
            replayHoverOnNativeSource(sourceSlot, triggerEvent);
        });
    }

    function makeLiveClone(sourceSlot, item, oldClone) {
        // Keep the legacy 1.2.0 order: clone the live source, graft React data, then insert into the DOM.
        const fresh = sourceSlot.cloneNode(true);
        const stats = netflixReactHover.graftTreeToClone(sourceSlot, fresh);
        normalizeClone(fresh);

        const order = oldClone?.getAttribute('data-tm-item-order');
        copyItemAttributes(fresh, item, order === null || order === undefined ? null : Number(order));
        fresh.setAttribute('data-tm-hover-ready', 'true');
        fresh.setAttribute('data-tm-backed-page', String(selectedPage(sourceState.section)));
        ensureGridHoverBehavior(sourceState.grid);
        associateGridHoverItem(item, fresh);
        return { fresh, stats };
    }

    async function prepareMountedPage(page, targetItem = null, triggerEvent = null, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
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
        const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
        const started = performance.now();

        log(tLog('nativePagePreparationStarted'), {
            requestedPage: page,
            selectedPage: selectedPage(section),
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
                        log('Hover source recovered from stale logical page mapping', {
                            targetItem: itemSummary(targetItem),
                            requestedPage: page,
                            actualPage,
                            source: slotDescriptor(targetSourceSlot)
                        });
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

        log(tLog('nativePagePreparationPositionResolved'), {
            requestedPage: page,
            actualPage,
            selectedPage: selectedPage(section),
            currentSlots: (resolvedPageSlots || currentPageSlots(scroller, track)).length,
            targetSource: slotDescriptor(targetSourceSlot)
        });

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

        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            const sourceSlot = slots[slotIndex];

            // A wrapped Hawkins tail can temporarily append page-0 cards after
            // totalCount-1 (for example 32,33,34,35,36,0). Those slots are ring
            // buffers, not members of the logical last page. Never re-page or graft
            // them into the legacy grid as if they belonged to actualPage.
            if (wrappedTailBufferStart >= 0 && slotIndex >= wrappedTailBufferStart) continue;

            const pageItem = findItemForSourceSlot(sourceSlot);
            if (!pageItem) continue;

            if (!staleSourceRecovery && pageItem.page !== actualPage) pageItem.page = actualPage;

            const oldClone = findGridClone(pageItem);
            if (!oldClone?.isConnected) continue;

            const { fresh, stats } = makeLiveClone(sourceSlot, pageItem, oldClone);
            refreshedCount++;
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
            const aligned = alignSourceSlotToClone(targetSourceSlot, freshTarget);
            log(tLog('hoverCoordinatesProxied'), {
                item: itemSummary(targetItem),
                actualPage,
                aligned,
                source: slotDescriptor(targetSourceSlot),
                cloneRect: rectSummary(freshTarget.getBoundingClientRect())
            });
            if (!aligned) return freshTarget;
            activeVideoId = targetItem.videoId;
            activeClone = freshTarget;

            scheduleNativeHoverReplay(
                targetSourceSlot,
                targetItem,
                freshTarget,
                triggerEvent,
                actualPage,
                'prepared-page'
            );
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

        const selected = selectedPage(sourceState.section);
        const backedPage = Number(clone.getAttribute('data-tm-backed-page'));
        if (clone.getAttribute('data-tm-hover-ready') === 'true' &&
            Number.isFinite(backedPage) && selected === backedPage) {
            const sourceSlot = findActiveSourceSlot(item);
            if (sourceSlot && alignSourceSlotToClone(sourceSlot, clone)) {
                activePage = selected;
                activeVideoId = item.videoId;
                activeClone = clone;
                log(tLog('hoverReusedImmediately'), {
                    seq,
                    item: itemSummary(item),
                    selectedPage: selected,
                    backedPage,
                    source: slotDescriptor(sourceSlot),
                    elapsedMs: Math.round(performance.now() - started)
                });
                scheduleNativeHoverReplay(sourceSlot, item, clone, triggerEvent, selected, 'immediate-reuse');
                return;
            }
        }

        const token = ++hoverToken;
        const sessionToken = routeSessionToken;
        assertRouteSession(sessionToken);
        clone.setAttribute('data-tm-hover-token', String(token));
        clone.setAttribute('data-tm-preparing', 'true');
        log(tLog('hoverRequestedNativePagePreparation'), {
            seq,
            item: itemSummary(item),
            selectedPage: selected,
            targetPage: item.page,
            backedPage: Number.isFinite(backedPage) ? backedPage : null,
            hoverReady: clone.getAttribute('data-tm-hover-ready') === 'true',
            token,
            triggerEvent: triggerEvent?.type || ''
        });

        try {
            let fresh = await prepareMountedPage(item.page, item, triggerEvent, token, sessionToken);
            if (!fresh &&
                token === hoverToken &&
                clone.isConnected &&
                clone.matches(':hover')) {
                // A Hawkins page can finish its virtual-card hydration immediately
                // after the first preparation attempt returns. Retry once while the
                // pointer is still on the same clone so the initial hover does not
                // require a second user hover.
                await sleep(180);
                if (token === hoverToken && clone.isConnected && clone.matches(':hover')) {
                    log('Retrying native page preparation after transient hydration', {
                        seq,
                        item: itemSummary(item),
                        token,
                        selectedPage: selectedPage(sourceState.section)
                    });
                    fresh = await prepareMountedPage(item.page, item, triggerEvent, token, sessionToken);
                }
            }
            log(tLog('hoverNativePagePreparationResult'), {
                seq,
                item: itemSummary(item),
                success: Boolean(fresh),
                selectedPage: selectedPage(sourceState.section),
                activeVideoId,
                elapsedMs: Math.round(performance.now() - started)
            });
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('liveClonePreparationFailed'), { seq, item: itemSummary(item), error });
            }
        } finally {
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

    function gridCloneFromPointerEvent(event, grid) {
        let node = event.target instanceof Element ? event.target : event.target?.parentElement;
        while (node && node !== grid) {
            if (node.parentElement === grid && node.__tmMyListItem) return node;
            node = node.parentElement;
        }
        return null;
    }

    function gridHoverSuppressed() {
        return hoverNeedsPointerMove || performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS;
    }

    function gridHoverTargetActive(clone, generation) {
        return !gridHoverSuppressed() && Boolean(sourceState?.grid?.isConnected) &&
            Boolean(clone?.isConnected) && generation === clone.__tmHoverActivationGeneration &&
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

    function handleGridClonePointerOver(event, clone, item) {
        if (orderMismatchDialogOpen || orderMismatchReinitializing) return;
        if (event.relatedTarget && clone.contains(event.relatedTarget)) return;
        if (!sourceState?.section || gridHoverSuppressed()) return;
        if (pendingGridHoverClone === clone || activeClone === clone) return;
        if (clone.getAttribute('data-tm-preparing') === 'true' &&
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) return;

        // All preparation, including ready-source reuse, goes through the dwell.
        // Keep only the latest target and do not read native layout on entry.
        cancelPendingGridHover();
        const generation = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clone.__tmHoverActivationGeneration = generation;
        pendingGridHoverClone = clone;
        clone.__tmHoverActivationTimer = setTimeout(() => {
            clone.__tmHoverActivationTimer = null;
            if (pendingGridHoverClone === clone) pendingGridHoverClone = null;
            if (!gridHoverTargetActive(clone, generation)) return;
            activateClone(item, clone, event, generation);
        }, HOVER_ACTIVATION_DELAY_MS);
    }

    function handleGridClonePointerLeave(clone, item) {
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
        clearSourceAlignment();
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
            if (clone) handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
        }, { capture: true, passive: true });
        grid.addEventListener('pointerout', event => {
            const clone = gridCloneFromPointerEvent(event, grid);
            if (!clone || (event.relatedTarget && clone.contains(event.relatedTarget))) return;
            handleGridClonePointerLeave(clone, clone.__tmMyListItem);
        }, { capture: true, passive: true });
    }

    function buildGrid(section, scroller, items, layout, totalCount) {
        clearLegacyEmptyState({ restoreGrid: false });
        document.getElementById(GRID_ID)?.remove();

        const grid = document.createElement('div');
        grid.id = GRID_ID;
        grid.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        grid.removeAttribute('data-tm-empty');
        ensureGridHoverBehavior(grid);

        sourceState.cloneMap = new Map();
        sourceState.itemMap = new Map(items.map(item => [itemKey(item), item]));

        items.forEach((item, index) => {
            const clone = item.snapshot.cloneNode(true);
            normalizeClone(clone);
            copyItemAttributes(clone, item, index);
            associateGridHoverItem(item, clone);
            grid.appendChild(clone);
            setGridClone(item, clone);
        });

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
            gridCards: grid.querySelectorAll(':scope > [data-virtual-slot]').length
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
        const { section, scroller, track } = sourceState;
        const start = performance.now();
        let previous = '';
        let stable = 0;
        let latest = sourceState.layout;

        while (performance.now() - start < timeout) {
            await sleep(80);
            assertRouteSession(sessionToken);
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
        responsiveRefreshing = true;
        let deferredLogicalRemap = false;
        const seq = ++responsiveSequence;
        const reason = lastResponsiveReason || 'unspecified';
        activeResponsiveReason = reason;
        const started = performance.now();
        const grid = sourceState.grid;
        log(tLog('responsiveRefreshStarted'), {
            seq,
            reason,
            beforeLayout: layoutSummary(sourceState.layout),
            selectedPage: selectedPage(sourceState.section),
            pages: pageCount(sourceState.section)
        });
        grid.setAttribute('data-tm-responsive-refreshing', 'true');
        hoverToken++;
        invalidateGridReact();
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;

        try {
            const liveLayout = await waitResponsiveLayoutSettled(1200, sessionToken);
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
            if (isRouteSessionActive(sessionToken)) {
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

            if (!isRouteSessionActive(sessionToken)) activeResponsiveReason = '';

            // Resize may fast-reanchor the hidden/native carousel to rebuild the logical
            // indicator, but it never starts MiniModal hover preparation by itself.
        }
    }

    function scheduleResponsiveRefresh(delay = 140, reason = 'unknown') {
        const sessionToken = routeSessionToken;
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected) return;
        if (sourceState.empty && (!sourceState.scroller || !sourceState.track)) {
            const layout = measureEmptyLayout(sourceState.section);
            layout.rowGap = measureNativeCarouselGap(sourceState.section);
            sourceState.layout = layout;
            const geometry = applyGridGeometry(sourceState.section, sourceState.grid, layout);
            sourceState.status.style.marginLeft = `${geometry.left}px`;
            sourceState.status.style.width = `${geometry.width}px`;
            return;
        }
        lastResponsiveReason = reason;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = setTimeout(() => {
            responsiveRefreshTimer = null;
            if (!isRouteSessionActive(sessionToken) || responsiveRefreshing) return;

            // Skip the expensive rescan when measured geometry has not changed.
            // Keep active-slot alignment here and clear it only when the responsive state actually changes.
            const measured = measureVisibleLayout(sourceState.section, sourceState.scroller, sourceState.track);
            measured.rowGap = sourceState.layout?.rowGap || measureNativeCarouselGap(sourceState.section);
            const sig = responsiveSignature(measured);
            const logicalMappingStale = Boolean(getCarouselDomRuntime(sourceState.section)?.pageMappingStale);
            if (sig === lastResponsiveSignature && !logicalMappingStale) {
                sourceState.layout = measured;
                updateResponsiveStatus(measured);
                realignActiveSource();
                log(tLog('responsiveRemeasurementNoShapeChange'), {
                    reason: lastResponsiveReason,
                    signature: sig,
                    layout: layoutSummary(measured)
                });
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

                if (pageCountOnlyChanged && !logicalMappingStale) {
                    const previousSignature = lastResponsiveSignature;
                    sourceState.layout = measured;
                    lastResponsiveSignature = sig;
                    lastPageShape = responsivePageShape(measured);
                    updateResponsiveStatus(measured);
                    realignActiveSource();
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
        const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        // Native hover replay emits synthetic moves. Only physical movement can
        // restore hover intent after scrolling, and scrolling never auto-replays it.
        if (!moved || !event.isTrusted || performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS) return;
        hoverNeedsPointerMove = false;
        const grid = sourceState?.grid;
        if (!grid?.isConnected) return;
        const clone = gridCloneFromPointerEvent(event, grid);
        if (clone) handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
    }

    function handleTargetScroll() {
        const now = performance.now();
        const starting = now - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS;
        lastTargetScrollAt = now;
        hoverNeedsPointerMove = true;
        cancelPendingGridHover();
        if (!starting) return;
        hoverToken++;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        // Grafted React props also receive Netflix's delegated mouse events.
        // Clear them once per scroll burst so they cannot bypass the script guard.
        invalidateGridReact();
    }

    function handleTargetWindowResize() {
        cancelPendingGridHover();
        hoverToken++;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        log(tLog('windowResizeDetected'), {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio
        });
        scheduleResponsiveRefresh(140, 'window.resize');
    }

    function handleTargetVisualViewportResize() {
        cancelPendingGridHover();
        hoverToken++;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        log(tLog('visualViewportResizeDetected'), {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            visualViewport: {
                width: window.visualViewport?.width,
                height: window.visualViewport?.height,
                scale: window.visualViewport?.scale
            },
            devicePixelRatio: window.devicePixelRatio
        });
        scheduleResponsiveRefresh(140, 'visualViewport.resize');
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
        if (initializationBlockedSessionToken === routeSessionToken) return;
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

    async function runScript(sessionToken = routeSessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        if (initializationBlockedSessionToken === sessionToken) return;
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
            initializationStartedAt: initializationStarted
        };
        applyOriginalMyListVisibility();

        running = true;
        runningSessionToken = sessionToken;
        assertRouteSession(sessionToken);
        let earlyTotalCount;
        let freshMyListBootstrap = null;
        let mountedSinglePageFastBootstrap = false;
        let graphqlItems = null;
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
                warn(tLog('initializationFailed'), {
                    code: error.code,
                    stage: error.stage,
                    timeoutMs: error.details?.timeoutMs ?? null,
                    details: error.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                clearRunningSession(sessionToken);
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
            initializationBlockedSessionToken = sessionToken;
            updateStatus(formatInitializationErrorMeta(readinessError, earlyTotalCount));
            clearRunningSession(sessionToken);
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
                freshMyListBootstrap = graphqlCollection.bootstrap;
                graphqlItems = graphqlCollection.items;
                if (graphqlItems) {
                    const runtime = getCarouselDomRuntime(section);
                    runtime.knownPageCount = Math.max(1, Math.ceil(earlyTotalCount / Math.max(1, graphqlLayout.columns)));
                    runtime.pageCountFinalized = true;
                    log('GraphQL My List fast collection prepared', {
                        totalCount: earlyTotalCount,
                        collected: graphqlItems.length,
                        graphqlPageCount: freshMyListBootstrap.graphqlPageCount || null,
                        columns: graphqlLayout.columns,
                        knownPageCount: runtime.knownPageCount
                    });
                } else {
                    warn('GraphQL My List fast collection was incomplete; falling back to native scan', {
                        totalCount: earlyTotalCount,
                        graphqlEdgeCount: freshMyListBootstrap?.graphqlEdges?.length || 0,
                        graphqlPageCount: freshMyListBootstrap?.graphqlPageCount || null,
                        columns: graphqlLayout.columns
                    });
                }
            } catch (error) {
                if (isRouteSessionCancelledError(error)) throw error;
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

            // The GraphQL fast path skips beginSourceScan(), but hover-driven native
            // moves still need the track marker used by the animation suppression CSS.
            track.classList.add('tm-netflix-mylist-v15-track');
            waitingForNativeEmpty = false;
            sourceState = { section, scroller, track, layout, initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount };
            let items;
            if (graphqlItems?.length === totalCount) {
                items = graphqlItems;
                log('GraphQL My List fast collection used', {
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
            buildGrid(section, scroller, items, layout, totalCount);
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
            resetOrderMismatchStateAfterInitialization();
            sourceState.initializationElapsedMs = performance.now() - initializationStarted;
            updateStatus(formatHeaderParts(items.length, totalCount, sourceState.initializationElapsedMs, true));

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
            clearRunningSession(sessionToken);
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
