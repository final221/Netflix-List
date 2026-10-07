const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../src/app/responsive.js'), 'utf8');
const imageSource = fs.readFileSync(path.join(__dirname, '../../src/grid/image-diagnostics.js'), 'utf8');
const names = [...source.matchAll(/^    (?:async )?function (\w+)\(/gm)].map(match => match[1]).filter(name => !['start','observe','dispose','acceptLayout','createCounters'].includes(name));
const imageNames = [...imageSource.matchAll(/^    (?:async )?function (\w+)\(/gm)].map(match => match[1]).filter(name => name !== 'createCounters');
const fields = ['resizeObserver','responsiveRefreshTimer','responsiveRefreshPromise','responsiveRefreshing','responsiveDeferral','activeResponsiveReason','lastResponsiveReason','lastResponsiveSignature','lastPageShape','myListCountConvergencePending','responsiveSequence'];
const descriptors = names => names.map(name => `${name}:{get:()=>${name},set:value=>{${name}=value;}}`).join(',');
function factory(text, exported, marker, inspected) {
    return vm.runInNewContext(text.replace('export function','function').replace(marker,
        `    options.inspect(Object.defineProperties({}, {${descriptors(inspected)}}));\n${marker}`) + `\n${exported};`, { Object, Set, Map, Promise, URL });
}
function install(c) {
    let responsivePrivate, imagePrivate;
    const dependencies = source.match(/const \{ ([^}]+) \} = options;/)[1].split(', ');
    const objects = new Set(['window','performance','nativeCarousel','gridView','hover','listMutations']);
    const options = Object.fromEntries(dependencies.map(name => [name, objects.has(name) ? new Proxy({}, {
        get: (_, key) => typeof c[name]?.[key] === 'function' ? (...args) => c[name][key](...args) : c[name]?.[key]
    }) : (...args) => c[name]?.(...args)]));
    options.readState = () => c.sourceState; options.readSessionToken = () => c.sessionScope.token;
    options.readOriginalVisibility = () => c.viewOriginalMyList;
    options.ResizeObserver = function(...args) { return new c.ResizeObserver(...args); };
    options.inspect = value => { responsivePrivate = value; };
    c.responsive = factory(source, 'createResponsive', '    // Public capability:', [...names,...fields,'counters','createCounters'])(options);
    const imageOptions = { ...options, location: new Proxy({}, {get:(_,key)=>c.location?.[key]}),
        get getComputedStyle() { return c.getComputedStyle; }, gridOwnsClone: (...args) => c.gridOwnsClone(...args),
        readScanFinishedAt: () => c.sourceState?.watchStatus ? c.viewing.diagnostics(c.sourceState.watchStatus).network?.finishedAt : null,
        get PerformanceObserver() { return c.PerformanceObserver; }, inspect: value => { imagePrivate = value; } };
    // Observer support can change in characterization fixtures after construction.
    const imageFactory = factory(imageSource.replace('PerformanceObserver, getComputedStyle, ','').replace(/typeof getComputedStyle/g,'typeof options.getComputedStyle').replace(/getComputedStyle\(/g,'options.getComputedStyle(').replace(/typeof PerformanceObserver/g,'typeof options.PerformanceObserver').replace(/PerformanceObserver\.supported/g,'options.PerformanceObserver.supported').replace(/new PerformanceObserver/g,'new options.PerformanceObserver'),
        'createImageDiagnostics', '    // Public provider', [...imageNames,'imageResourceObserver','resourceCounters','createCounters']);
    c.fixtureImages = imageFactory(imageOptions);
    c.fixtureResponsiveOriginal = Object.fromEntries(names.map(name=>[name,responsivePrivate[name]]));
    c.fixtureImagesOriginal = Object.fromEntries(imageNames.map(name=>[name,imagePrivate[name]]));
    for (const [owner, list] of [[responsivePrivate,[...names,...fields]],[imagePrivate,[...imageNames,'imageResourceObserver']]]) {
        for (const name of list) {
            const initial = c[name];
            Object.defineProperty(c,name,{configurable:true,get:()=>owner[name],set:value=>{owner[name]=value;}});
            if (initial !== undefined) owner[name] = initial;
        }
    }
    const prior = Object.getOwnPropertyDescriptor(c,'performanceDiagnostics');
    Object.defineProperty(c,'performanceDiagnostics',{configurable:true,get:()=>prior.get(),set:value=>{
        prior.set(value); responsivePrivate.counters=value.resize; imagePrivate.resourceCounters=value.imageResources;
    }});
    c.createResponsiveCounters = () => responsivePrivate.createCounters();
    c.createImageCounters = () => imagePrivate.createCounters();
    c.fixtureResponsivePrivate = responsivePrivate;
}
module.exports = { install, names, imageNames };
