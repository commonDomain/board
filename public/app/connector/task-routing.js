// Deterministic, bounded curve choices: reduce crossings without moving tasks
// or storing generated control points as user-authored waypoints.
let lastSignature = '', lastResult = new Map();
function points(curve) {
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    return { x: u*u*u*curve.start.x + 3*u*u*t*curve.a.x + 3*u*t*t*curve.b.x + t*t*t*curve.end.x,
      y: u*u*u*curve.start.y + 3*u*u*t*curve.a.y + 3*u*t*t*curve.b.y + t*t*t*curve.end.y };
  });
}
const length = path => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x-path[i].x,p.y-path[i].y), 0);
function crossings(path, other) {
  const side = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  let count = 0;
  for (let i=1;i<path.length;i++) for(let j=1;j<other.length;j++) {
    const a=path[i-1],b=path[i],c=other[j-1],d=other[j];
    if(side(a,b,c)*side(a,b,d)<-0.01 && side(c,d,a)*side(c,d,b)<-0.01) count++;
  }
  return count;
}
function separateTaskCurves(entries) {
  entries = [...entries].sort((a,b)=>a.start.y-b.start.y || a.id.localeCompare(b.id));
  const signature = JSON.stringify(entries);
  if(signature===lastSignature)return lastResult;
  const result=new Map(), accepted=[];
  for(const entry of entries) {
    const base=points(entry), baseLength=length(base);
    let best=entry, bestPath=base, bestScore=accepted.reduce((n,p)=>n+crossings(base,p),0)*10000+baseLength;
    for(const shift of [-48,-24,24,48]) for(const scale of [0.65,1,1.35]) {
      const candidate={...entry,a:{x:entry.a.x,y:entry.a.y+shift},
        b:{x:entry.end.x+(entry.b.x-entry.end.x)*scale,y:entry.end.y+(entry.b.y-entry.end.y)*scale}};
      const path=points(candidate), size=length(path);
      if(size>baseLength*1.15+16)continue;
      const score=accepted.reduce((n,p)=>n+crossings(path,p),0)*10000+size+Math.abs(shift)*0.1;
      if(score<bestScore){best=candidate;bestPath=path;bestScore=score;}
    }
    result.set(entry.id,{a:best.a,b:best.b});accepted.push(bestPath);
  }
  const total = paths => paths.reduce((sum,path,i)=>sum+paths.slice(0,i).reduce((n,other)=>n+crossings(path,other),0),0);
  if(total(accepted)>total(entries.map(points))) {
    for(const entry of entries)result.set(entry.id,{a:entry.a,b:entry.b});
  }
  lastSignature=signature;lastResult=result;
  return result;
}
export { separateTaskCurves, points, crossings };
