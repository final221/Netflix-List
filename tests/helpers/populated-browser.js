import { Element } from './dom.js';
import { carouselPayload, pageBootstrapHtml } from './fixtures.js';

// Native DOM and wire inputs only; application and bundle tests run real owners.
export function mountPopulatedMyList(b, { count = 2, nativeAll = false } = {}) {
    const section = b.mountMyList();
    const scroller=section.appendChild(new Element()),track=scroller.appendChild(new Element());
    scroller.setAttribute('data-uia','carousel-scroller');
    const control=section.appendChild(new Element('button'));control.setAttribute('data-uia','carousel-right-button');
    const rect=(left,width)=>({left,top:0,right:left+width,bottom:60,width,height:60});
    section.getBoundingClientRect=scroller.getBoundingClientRect=()=>rect(0,600);
    for(let i=0;i<(nativeAll?count:Math.min(6,count));i++){
        const slot=track.appendChild(new Element()),card=slot.appendChild(new Element('a'));
        slot.setAttribute('data-virtual-slot',String(i));
        const width=nativeAll?600/count:100;
        slot.getBoundingClientRect=card.getBoundingClientRect=()=>rect(i*width,width);
        card.setAttribute('data-uia','standard-card');card.href=`https://www.netflix.com/browse?jbv=${i+1}`;card.setAttribute('href',card.href);
        card.setAttribute('aria-label',`Title ${i+1}`);
    }
    for(let page=0;page<(nativeAll?1:Math.ceil(count/6));page++){
        const indicator=section.appendChild(new Element());indicator.setAttribute('data-uia','carousel-page-indicator-item');
        if(page===0)indicator.setAttribute('data-indicator-selected','true');
    }
    const payload=carouselPayload(count,Array.from({length:count},(_,i)=>String(i+1))).data.node;
    payload.eventListeners=[{notificationMessageRegex:'UPDATE_PLAYLIST'}];
    b.window.netflix={reactContext:{models:{graphql:{data:{list:payload}}}}};
    b.context.fetch=async()=>({ok:true,status:200,url:b.location.href,text:async()=>pageBootstrapHtml(count),
        json:async()=>carouselPayload(count,Array.from({length:count},(_,i)=>String(i+1)))});
    return { section, scroller, track };
}
