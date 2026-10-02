// Retained for the application lifetime, independently of route diagnostic counters.
const MAX_LOG_ENTRIES = 5000;

export function createLogger({ name, version, Element, console, now = () => new Date(), isTraceEnabled = () => false }) {
    const LOG_PREFIX = `[${name} v${version}]`;
    const investigationLog = [];
    let investigationLogStart = 0;

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

    function formatSystemTimestamp(date = now()) {
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
        if (isTraceEnabled()) log(...buildArgs());
    }

    function log(...args) {
        appendInvestigationLog('INFO', args);
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        appendInvestigationLog('WARN', args);
        console.warn(LOG_PREFIX, ...args);
    }

    return Object.freeze({ log, warn, trace, entries: retainedInvestigationLog,
        size: () => investigationLog.length, formatValue: formatLogValue, formatTimestamp: formatSystemTimestamp });
}
