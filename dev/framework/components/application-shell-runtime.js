(()=> {
  'use strict';
  const root=document.documentElement;
  const body=document.body;
  const CONFIG=window.NLabAppShellConfig||{};
  const STORE=CONFIG.storageKey||'nlab:application-shell:prefs:v1';
  const WINSTORE=CONFIG.windowStorageKey||STORE+':windows';
  const defaults={
    theme:'auto',dominant_color:'',view:'cards',
    header:{visible:true,shadow:true,compact:false,auto_hide:false,mode:'sticky'},
    folds:{}
  };
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const clone=v=>JSON.parse(JSON.stringify(v));
  const load=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):clone(fallback)}catch(_){return clone(fallback)}};
  const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch(_){}};
  let prefs=Object.assign(clone(defaults),load(STORE,{}));
  prefs.header=Object.assign(clone(defaults.header),prefs.header||{});
  prefs.folds=Object.assign({},prefs.folds||{});
  let z=Number(CONFIG.baseZIndex||120);

  const effectiveTheme=()=>prefs.theme==='auto'
    ?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
    :prefs.theme;

  function apply(){
    root.dataset.theme=effectiveTheme();
    body.dataset.shellView=prefs.view||'cards';
    body.dataset.shellHeaderMode=prefs.header.mode||'sticky';
    body.classList.toggle('nlab-shell-header-hidden',prefs.header.visible===false);
    body.classList.toggle('nlab-shell-header-no-shadow',prefs.header.shadow===false);
    body.classList.toggle('nlab-shell-header-compact',!!prefs.header.compact);
    if(prefs.dominant_color)root.style.setProperty('--nlab-brand',prefs.dominant_color);
    qa('[data-shell-view]').forEach(el=>el.classList.toggle('active',el.dataset.shellView===prefs.view));
    qa('[data-shell-pref]').forEach(el=>{
      const key=el.dataset.shellPref;
      const value=readPref(key);
      if(el.type==='checkbox')el.checked=!!value; else if(value!=null)el.value=String(value);
    });
    qa('[data-shell-fold-id]').forEach(el=>{
      const id=el.dataset.shellFoldId;
      if(Object.hasOwn(prefs.folds,id))el.open=!!prefs.folds[id];
    });
  }

  function readPref(path){
    return String(path||'').split('.').reduce((v,k)=>v&&v[k],prefs);
  }
  function writePref(path,value){
    const parts=String(path||'').split('.');
    let node=prefs;
    while(parts.length>1){const k=parts.shift();node[k]=node[k]&&typeof node[k]==='object'?node[k]:{};node=node[k]}
    node[parts[0]]=value;save(STORE,prefs);apply();
  }

  function bindPreferences(){
    qa('[data-shell-pref]').forEach(el=>{
      if(el.dataset.nlabReady)return;el.dataset.nlabReady='1';
      el.addEventListener('change',()=>{
        const key=el.dataset.shellPref;
        const value=el.type==='checkbox'?el.checked:el.value;
        writePref(key,value);
      });
    });
    qa('[data-shell-view]').forEach(el=>{
      if(el.dataset.nlabReady)return;el.dataset.nlabReady='1';
      el.addEventListener('click',()=>writePref('view',el.dataset.shellView));
    });
    qa('[data-shell-header-restore]').forEach(el=>el.addEventListener('click',()=>writePref('header.visible',true)));
    qa('[data-shell-pref-reset]').forEach(el=>el.addEventListener('click',()=>{
      prefs=clone(defaults);save(STORE,prefs);try{localStorage.removeItem(WINSTORE)}catch(_){}
      qa('[data-nlab-floating-window]').forEach(resetWindow);apply();
    }));
  }

  function bindFoldables(){
    qa('[data-shell-fold-id]').forEach(el=>{
      if(el.dataset.nlabFoldReady)return;el.dataset.nlabFoldReady='1';
      const id=el.dataset.shellFoldId;
      if(Object.hasOwn(prefs.folds,id))el.open=!!prefs.folds[id];
      el.addEventListener('toggle',()=>{prefs.folds[id]=el.open;save(STORE,prefs)});
    });
    qa('[data-shell-fold-action]').forEach(el=>el.addEventListener('click',()=>{
      const open=el.dataset.shellFoldAction==='expand';
      qa('[data-shell-fold-id]').forEach(d=>{d.open=open;prefs.folds[d.dataset.shellFoldId]=open});
      save(STORE,prefs);
    }));
  }

  const windowState=()=>load(WINSTORE,{});
  function bringFront(w){w.style.zIndex=String(++z)}
  function saveWindow(w){
    const all=windowState(),r=w.getBoundingClientRect();
    all[w.dataset.nlabFloatingWindow||w.id]={
      left:r.left,top:r.top,width:r.width,height:r.height,locked:w.classList.contains('locked')
    };
    save(WINSTORE,all);
  }
  function restoreWindow(w){
    const st=windowState()[w.dataset.nlabFloatingWindow||w.id];if(!st)return;
    w.style.left=Math.max(8,Math.min(innerWidth-280,Number(st.left)||8))+'px';
    w.style.top=Math.max(8,Math.min(innerHeight-100,Number(st.top)||8))+'px';
    w.style.right='auto';w.style.bottom='auto';
    if(st.width)w.style.width=Math.min(innerWidth-16,Number(st.width))+'px';
    if(st.height)w.style.height=Math.min(innerHeight-16,Number(st.height))+'px';
    w.classList.toggle('locked',!!st.locked);
  }
  function resetWindow(w){
    ['left','top','right','bottom','width','height','zIndex'].forEach(k=>w.style[k]='');
    w.classList.remove('locked');saveWindow(w);
  }
  function initWindow(w){
    if(w.dataset.nlabReady)return;w.dataset.nlabReady='1';restoreWindow(w);
    const head=q('[data-window-handle]',w)||q('.nlab-window-head',w)||w.firstElementChild;
    const lock=q('[data-window-lock]',w),reset=q('[data-window-reset]',w),close=q('[data-window-close]',w);
    let drag=null;
    head?.addEventListener('pointerdown',e=>{
      if(e.target.closest('button,a,input,select,textarea')||w.classList.contains('locked'))return;
      bringFront(w);const r=w.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};
      head.setPointerCapture?.(e.pointerId);
    });
    head?.addEventListener('pointermove',e=>{
      if(!drag)return;
      const x=Math.max(6,Math.min(innerWidth-w.offsetWidth-6,e.clientX-drag.x));
      const y=Math.max(6,Math.min(innerHeight-54,e.clientY-drag.y));
      Object.assign(w.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
    });
    head?.addEventListener('pointerup',e=>{if(!drag)return;drag=null;try{head.releasePointerCapture?.(e.pointerId)}catch(_){}saveWindow(w)});
    lock?.addEventListener('click',()=>{w.classList.toggle('locked');saveWindow(w);w.dispatchEvent(new CustomEvent('nlab:window-lock',{detail:{locked:w.classList.contains('locked')}}))});
    reset?.addEventListener('click',()=>resetWindow(w));
    close?.addEventListener('click',()=>w.classList.remove('open'));
    w.addEventListener('pointerdown',()=>bringFront(w));
    if('ResizeObserver' in window)new ResizeObserver(()=>{clearTimeout(w._nlabResize);w._nlabResize=setTimeout(()=>saveWindow(w),250)}).observe(w);
  }

  function bindWindows(){
    qa('[data-nlab-floating-window]').forEach(initWindow);
    qa('[data-shell-window-open]').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.shellWindowOpen;
      const w=q('[data-nlab-floating-window="'+CSS.escape(id)+'"]')||document.getElementById(id);
      if(w){w.classList.add('open');bringFront(w)}
    }));
  }

  function bindAutoHide(){
    let last=scrollY;
    addEventListener('scroll',()=>{
      if(!prefs.header.auto_hide||prefs.header.mode==='static'||prefs.header.visible===false){
        body.classList.remove('nlab-shell-header-auto-hidden');last=scrollY;return;
      }
      const y=scrollY,down=y>last+5;
      body.classList.toggle('nlab-shell-header-auto-hidden',down&&y>80);last=y;
    },{passive:true});
  }

  function bindKeyboard(){
    addEventListener('keydown',e=>{if(e.key==='Escape')qa('[data-nlab-floating-window].open').forEach(w=>w.classList.remove('open'))});
  }

  function boot(){
    apply();bindPreferences();bindFoldables();bindWindows();bindAutoHide();bindKeyboard();
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(prefs.theme==='auto')apply()});
    document.dispatchEvent(new CustomEvent('nlab:application-shell-ready',{detail:{prefs}}));
  }

  window.NLabApplicationShell={boot,apply,get preferences(){return clone(prefs)},setPreference:writePref,resetWindow};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();