export function createGomokuGridLines() {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  svg.classList.add('gomoku-grid-lines');svg.setAttribute('viewBox','0 0 15 15');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  // Each line spans the entire board instead of joining 15 independently rounded cells.
  path.setAttribute('d',Array.from({length:15},(_,i)=>{const p=i+.5;return `M .5 ${p} H 14.5 M ${p} .5 V 14.5`;}).join(' '));
  path.setAttribute('vector-effect','non-scaling-stroke');svg.append(path);return svg;
}

export function showGomokuBanner(element,text) {
  element.getAnimations().forEach(animation=>animation.cancel());
  const turn=text==='你的回合！',still=turn||matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.dataset.kind=turn?'turn':'message';element.textContent=text;element.hidden=false;
  const animation=element.animate([
    {opacity:0,transform:still?'translateX(-50%)':'translate(-50%,-6px)'},
    {opacity:1,transform:'translate(-50%,0)',offset:turn?.1:.18},
    {opacity:1,transform:'translate(-50%,0)',offset:turn?.84:.65},
    {opacity:0,transform:still?'translateX(-50%)':'translate(-50%,4px)'}
  ],{duration:turn?3500:1500,easing:'ease-out',fill:'both'});
  // Retain the transparent final frame until hidden, even if the browser delays this callback.
  animation.finished.then(()=>{if(element.getAnimations().includes(animation))element.hidden=true;}).catch(()=>{});
  return animation;
}
