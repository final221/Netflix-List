import { test } from 'node:test';
import assert from 'node:assert/strict';

test('localization reads current language, normalizes regional forms and preserves diagnostic language rules', async () => {
    const { createI18n } = await import('../src/i18n/i18n.js');
    let language = 'de-DE';
    const i18n = createI18n({ readLanguage: () => language });
    assert.equal(i18n.getUiLocale(), 'de');
    assert.equal(i18n.getLogLocale(), 'en');
    assert.equal(i18n.tLog('scriptStarted'), 'Script started');
    language = ' Ja_jp ';
    assert.equal(i18n.getUiLocale(), 'ja');
    assert.equal(i18n.getLogLocale(), 'ja');
    assert.equal(i18n.tLog('scriptStarted'), '\u30b9\u30af\u30ea\u30d7\u30c8\u958b\u59cb');
    for (const [input, expected] of [['pt_BR', 'pt'], ['zh-Hant', 'zh'], ['fil-PH', 'fil'], ['unsupported', 'en'], ['', 'en']]) {
        language = input;
        assert.equal(i18n.getUiLocale(), expected);
    }
});

test('viewing controls retain translations for every supported Netflix UI locale', async () => {
    const { createI18n } = await import('../src/i18n/i18n.js');
    const { UI_MESSAGES, NETFLIX_PRIMARY_UI_LOCALES } = await import('../src/i18n/ui-messages.js');
    const keys = ['watchedCaughtUp', 'refreshViewingStatus', 'checkingViewingStatus', 'unknownViewingStatus', 'caughtUpMessage',
        'filterFilms', 'filterSeries', 'filterAll', 'titleTypeFilter', 'noMatchingTitles', 'unknownTitleTypes',
        'markWatched', 'markCaughtUp', 'moveBackToMyList', 'manualViewingChoice', 'manualViewingChoiceDescription',
        'viewingChoiceStorageFailed'];
    assert.equal(NETFLIX_PRIMARY_UI_LOCALES.size, 31);
    assert.deepEqual(new Set(Object.keys(UI_MESSAGES)), NETFLIX_PRIMARY_UI_LOCALES);
    for (const locale of NETFLIX_PRIMARY_UI_LOCALES) {
        const i18n = createI18n({ readLanguage: () => locale });
        for (const key of keys) {
            assert.equal(typeof UI_MESSAGES[locale][key], 'string', locale + ': ' + key);
            assert.ok(i18n.tUi(key, { count: 3 }), locale + ': ' + key);
        }
    }
    assert.equal(createI18n({ readLanguage: () => 'unsupported' }).tUi('watchedCaughtUp'), 'Watched / Caught up');
});

test('formatting preserves plurals, missing tokens, own parameters and unknown-key behavior', async () => {
    const { createI18n } = await import('../src/i18n/i18n.js');
    const i18n = createI18n({ readLanguage: () => 'en' });
    assert.equal(i18n.tUiPlural('itemCount', 1), '1 item');
    assert.equal(i18n.tUiPlural('itemCount', 2), '2 items');
    assert.equal(i18n.tUi('unknownViewingStatus'), 'Viewing status unavailable for {count} titles. They remain in the main list.');
    assert.equal(i18n.tUi('unknownViewingStatus', { count: 0 }), 'Viewing status unavailable for 0 titles. They remain in the main list.');
    assert.equal(i18n.tUi('unknownViewingStatus', Object.create({ count: 99 })), i18n.tUi('unknownViewingStatus'));
    assert.equal(i18n.tUi('no-such-ui-key'), '');
    assert.equal(i18n.tLog('no-such-diagnostic-key'), 'no-such-diagnostic-key');
});

test('count and time formatting preserve loading and missing-item presentation', async () => {
    const { createI18n } = await import('../src/i18n/i18n.js');
    const i18n = createI18n({ readLanguage: () => 'en' });
    assert.equal(i18n.formatItemCount(1, 3, false), '3 items');
    assert.equal(i18n.formatItemCount(1, 3, true), '3 items  Error-2');
    assert.equal(i18n.formatItemCount(3, 3, true), '3 items');
    assert.equal(i18n.formatItemCount(1, null, true), '1 item');
    assert.equal(i18n.formatUiNumber(1234.5, 2), '1,234.50');
    assert.equal(i18n.formatInitializationTime(null), 'Initializing...');
    assert.equal(i18n.formatInitializationTime(1234), 'Init 1.23s');
});

test('unavailable Intl constructors retain existing numeric and plural fallbacks', async t => {
    const { createI18n } = await import('../src/i18n/i18n.js');
    const i18n = createI18n({ readLanguage: () => 'en' });
    t.mock.method(Intl, 'NumberFormat', () => { throw new Error('unavailable'); });
    t.mock.method(Intl, 'PluralRules', () => { throw new Error('unavailable'); });
    assert.equal(i18n.formatUiNumber(3.456, 2), '3.46');
    assert.equal(i18n.tUiPlural('itemCount', 1), '1 items');
});
