(()=>{
  'use strict';
  const providers=new Map();
  let active='nlab-line';
  const fallback='command';

  providers.set('nlab-line',{
    has:id=>!!(window.NLabIcons&&window.NLabIcons.has&&window.NLabIcons.has(id)),
    get:id=>window.NLabIcons&&window.NLabIcons.get?window.NLabIcons.get(id):''
  });

  function validId(id){return typeof id==='string'&&/^[a-z0-9_]+$/.test(id)}
  function register(themeId,overrides={}){
    if(typeof themeId!=='string'||!/^[a-z0-9_-]+$/.test(themeId))throw new Error('INVALID_ICON_THEME_ID');
    const map={...overrides};
    providers.set(themeId,{
      has:id=>Object.prototype.hasOwnProperty.call(map,id),
      get:id=>map[id]||''
    });
    return api;
  }
  function setTheme(themeId){
    active=providers.has(themeId)?themeId:'nlab-line';
    document.documentElement.dataset.iconTheme=active;
    document.dispatchEvent(new CustomEvent('nlab:icon-theme-change',{detail:{theme:active}}));
    return active;
  }
  function get(id){
    if(!validId(id))return '';
    const p=providers.get(active);
    if(active!=='nlab-line'&&p&&p.has(id))return p.get(id);
    const base=providers.get('nlab-line');
    if(base&&base.has(id))return base.get(id);
    return base&&base.has(fallback)?base.get(fallback):'';
  }
  function escAttr(v){return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}
  function escText(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
  function render(id,options={}){
    const className=options.className||'nlab-icon';
    const label=options.label||null;
    const title=options.title||null;
    const raw=get(id); if(!raw)return '';
    let svg=String(raw);
    if(!/^\s*<svg\b/i.test(svg))return svg;
    svg=svg.replace(/<svg\b([^>]*)>/i,function(_m,attrs){
      const clean=attrs.replace(/\sclass="[^"]*"/i,'').replace(/\saria-hidden="[^"]*"/i,'').replace(/\srole="[^"]*"/i,'');
      const accessibility=label?' role="img" aria-label="'+escAttr(label)+'"':' aria-hidden="true"';
      return '<svg class="'+escAttr(className)+'"'+accessibility+clean+'>';
    });
    if(title)svg=svg.replace(/(<svg\b[^>]*>)/i,'$1<title>'+escText(title)+'</title>');
    return svg;
  }
  const api=Object.freeze({
    register:register,
    setTheme:setTheme,
    get:get,
    render:render,
    has:id=>!!get(id),
    get activeTheme(){return active},
    themes:()=>[...providers.keys()]
  });
  window.NLabIconTheme=api;
})();
