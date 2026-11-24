// Injected by the loopback test server ONLY. No probe strings enter a priced
// build. Observe the real context, field upload, raw and limited FBO; the
// display-plane check independently samples Chrome's composited screenshot.
const workerProbe = `
const tell=(key,value)=>postMessage({probe:[key,value]});
const get=OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext=function(...args){
 const gl=get.apply(this,args);
 if(gl){
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  tell('context',[gl.getParameter(gl.VERSION),ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),this.width,this.height]);
  const upload=gl.texSubImage2D, draw=gl.drawArrays;
  gl.texSubImage2D=function(...a){upload.apply(gl,a);tell('upload',a.at(-1)[198])};
  gl.drawArrays=function(...a){
   draw.apply(gl,a);
   const [, ,w,h]=gl.getParameter(gl.VIEWPORT),p=new Uint8Array(4);
   gl.readPixels(Math.floor(w*6.5/32),Math.floor(h*6.5/32),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);
   tell('draw',p[0]);
  };
 }
 return gl;
};`

export function probe(mode: 'clock' | 'timeout') {
  const prefix =
    mode === 'clock'
      ? workerProbe
      : `addEventListener('message',e=>e.stopImmediatePropagation());`
  return `<script>
const nativeRAF=requestAnimationFrame.bind(window),queue=[];
window.results={context:[],draw:[],upload:[],ack:0,terminated:0};
window.advance=(t)=>queue.splice(0).forEach(fn=>fn(t));
window.requestAnimationFrame=fn=>queue.push(fn);
window.paint=()=>new Promise(r=>nativeRAF(()=>nativeRAF(()=>nativeRAF(r))));
window.Blob=class extends Blob{
 constructor(parts,opts){super(opts?.type==='text/javascript'?[${JSON.stringify(prefix)},...parts]:parts,opts)}
};
window.Worker=class extends Worker{
 constructor(...args){super(...args);this.start=performance.now();this.addEventListener('message',e=>{
   if(e.data.probe){e.stopImmediatePropagation();const [k,v]=e.data.probe;results[k].push(v)}
   else if(e.data===true){if(!results.ack)results.readyMs=performance.now()-this.start;results.ack++}
 })}
 terminate(){results.terminated=performance.now()-this.start;super.terminate()}
};
</script>`
}
