// Small offline DOM for lifecycle tests. It models ownership and structure, not layout engines.
export class EventTarget {
    listeners = new Map();
    addEventListener(type, listener) {
        let listeners = this.listeners.get(type);
        if (!listeners) this.listeners.set(type, listeners = new Set());
        listeners.add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
    listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

export class Element extends EventTarget {
    constructor(tag = 'div') {
        super();
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.attributes = new Map();
        this.children = [];
        this.parentElement = null;
        this.textContent = '';
        const stylePriorities = new Map();
        this.style = {
            setProperty(name, value, priority = '') { this[name] = String(value); stylePriorities.set(name, priority); },
            removeProperty(name) { delete this[name]; stylePriorities.delete(name); },
            getPropertyValue(name) { return this[name] || ''; },
            getPropertyPriority(name) { return stylePriorities.get(name) || ''; }
        };
        this.classList = {
            add: (...names) => { this.className = [...new Set([...this.classList, ...names])].join(' '); },
            remove: (...names) => { this.className = [...this.classList].filter(name => !names.includes(name)).join(' '); },
            contains: name => [...this.classList].includes(name),
            toggle: (name, enabled) => {
                const present = enabled ?? !this.classList.contains(name);
                this.classList[present ? 'add' : 'remove'](name);
                return present;
            },
            [Symbol.iterator]: () => (this.className || '').split(/\s+/).filter(Boolean)[Symbol.iterator]()
        };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get parentNode() { return this.parentElement; }
    get isConnected() { return this.tagName === 'HTML' || Boolean(this.parentElement?.isConnected); }
    get nextElementSibling() {
        const siblings = this.parentElement?.children || [];
        return siblings[siblings.indexOf(this) + 1] || null;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
    remove() {
        if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
    }
    insertAdjacentElement(position, node) {
        if (position !== 'afterend') throw new Error('Unsupported fixture insertion: ' + position);
        const parent = this.parentElement;
        node.remove();
        node.parentElement = parent;
        parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
        return selector.split(',').some(part => {
            const simple = part.trim();
            if (simple.startsWith('#')) return this.id === simple.slice(1);
            if (/^\.[\w-]+$/.test(simple)) return this.classList.contains(simple.slice(1));
            const compound = /^(\w+)?((?:\.[\w-]+)*)(\[[\w-]+(?:="[^"]*")?\](?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(simple);
            if (compound) {
                if (compound[1] && this.tagName.toLowerCase() !== compound[1]) return false;
                if (compound[2].split('.').filter(Boolean).some(name => !this.classList.contains(name))) return false;
                return [...compound[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
                    this.attributes.has(name) && (value === undefined || this.getAttribute(name) === value));
            }
            return this.tagName.toLowerCase() === simple;
        });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
        const found = new Set();
        for (const part of selector.split(',')) {
            const direct = /^\s*:scope\s*>\s*/.test(part);
            const simple = part.replace(/^\s*:scope\s*>\s*/, '').trim();
            for (const child of this.children) {
                if (child.matches(simple)) found.add(child);
                if (!direct) child.querySelectorAll(simple).forEach(node => found.add(node));
            }
        }
        return [...found];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    cloneNode(deep = false) {
        const clone = new Element(this.tagName);
        clone.attributes = new Map(this.attributes);
        clone.textContent = this.textContent;
        for (const name of ['href', 'src', 'loading', 'decoding', 'tabIndex']) {
            if (Object.hasOwn(this, name)) clone[name] = this[name];
        }
        if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
        return clone;
    }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1200, bottom: 100, width: 1200, height: 100 }; }
}

export function createDocument() {
    const document = new EventTarget();
    document.documentElement = new Element('html');
    document.documentElement.setAttribute('lang', 'en');
    document.head = document.documentElement.appendChild(new Element('head'));
    document.body = document.documentElement.appendChild(new Element('body'));
    document.visibilityState = 'visible';
    document.createElement = tag => new Element(tag);
    document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
    document.querySelector = selector => document.documentElement.querySelector(selector);
    document.getElementById = id => document.querySelector('#' + id);
    return document;
}
