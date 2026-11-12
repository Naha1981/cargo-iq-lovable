import * as THREE from 'three';
import {SparkRenderer,SplatMesh} from '../splat-sample/lib/spark.module.js';
import {OrbitControls} from '../splat-sample/lib/OrbitControls.js';
const host=document.querySelector('#view'),status=document.querySelector('#status'),capture=document.querySelector('#capture');
let renderer,scene,camera,controls,manifest,frames=0,ready=false;
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
try{
 manifest=await (await fetch('./manifest.json')).json();const bytes=await (await fetch('./yvig-tree.splat')).arrayBuffer();
 if(await sha(bytes)!==manifest.sha256)throw Error('Scene integrity check failed');
 document.querySelector('#hash').textContent='Scene SHA-256: '+manifest.sha256;
 renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x172c35);host.append(renderer.domElement);
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(10,10,13).multiplyScalar(host.clientWidth<500?1.55:1);
 controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,3,0);controls.enableDamping=true;controls.update();
 status.textContent='Scene hash verified. Starting renderer...';scene.add(new SparkRenderer({renderer}));const model=new SplatMesh({url:'./yvig-tree.splat'});scene.add(model);status.textContent='Loading Gaussian data...';await model.initialized;status.textContent='Gaussian data loaded...';
 const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()};new ResizeObserver(resize).observe(host);resize();
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);frames++;if(!ready && frames%10===0){const gl=renderer.getContext(),pixel=new Uint8Array(4);for(const [x,y] of [[.5,.5],[.4,.4],[.6,.4],[.5,.3]]){gl.readPixels(Math.floor(gl.drawingBufferWidth*x),Math.floor(gl.drawingBufferHeight*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(Math.abs(pixel[0]-23)+Math.abs(pixel[1]-44)+Math.abs(pixel[2]-53)>35){ready=true;status.textContent=manifest.gaussians.toLocaleString()+' Gaussians rendered / drag to rotate';capture.disabled=false;break}}if(!ready && frames>=300)status.textContent='Scene is still preparing. Your device may not support this renderer.'}});
 document.querySelector('#reset').onclick=()=>{camera.position.set(10,10,13).multiplyScalar(host.clientWidth<500?1.55:1);controls.target.set(0,3,0);controls.update()};
 capture.onclick=async()=>{renderer.render(scene,camera);const image=renderer.domElement.toDataURL('image/jpeg',.85);const jpeg=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));const item={kind:'GAUSSIAN_SPLAT_VIEW',classification:'EXTERNAL_REAL_PLACE_REFERENCE',source:manifest.source,sourceUrl:location.origin+location.pathname+'yvig-tree.splat',licence:manifest.licence,acquiredAt:null,capturedAt:new Date().toISOString(),sceneSha256:manifest.sha256,imageSha256:await sha(jpeg),camera:{position:camera.position.toArray(),target:controls.target.toArray()},limitations:manifest.limitations,imageJpeg:image};window.cargoSplatCapture=item;document.querySelector('#preview').src=image;document.querySelector('#preview').style.display='block';document.querySelector('#captureStatus').textContent='Viewpoint captured. Real-world reference scene, not cargo evidence. Not saved into a case.';parent.postMessage({type:'cargo-splat-proposal',item},location.origin)};
 window.cargoSplatTest={get frames(){return frames},get capture(){return window.cargoSplatCapture},manifest};
}catch(e){status.textContent='Viewer unavailable: '+e.message;status.setAttribute('role','alert');console.error(e)}
