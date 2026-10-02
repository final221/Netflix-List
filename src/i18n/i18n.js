import { NETFLIX_PRIMARY_UI_LOCALES, UI_MESSAGES } from './ui-messages.js';
import { LOG_MESSAGES } from './log-messages.js';

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

export function createI18n({ readLanguage }) {
    if (typeof readLanguage !== 'function') throw new TypeError('readLanguage must be a function');

    function getBaseLanguage(value) {
        const raw = String(value || '').trim().replace(/_/g, '-');
        const match = raw.match(/^([A-Za-z]{2,3})(?:-|$)/);
        return match ? match[1].toLowerCase() : '';
    }

    function getUiLocale() {
        const language = getBaseLanguage(readLanguage());
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

    function formatInitializationTime(elapsedMs) {
        if (!Number.isFinite(elapsedMs)) return tUi('initializing');
        const seconds = elapsedMs / 1000;
        return tUi('initTime', { seconds: formatUiNumber(seconds, 2) });
    }

    return Object.freeze({ getUiLocale, getLogLocale, tUi, tUiPlural, tLog, formatUiNumber, formatItemCount, formatInitializationTime });
}
