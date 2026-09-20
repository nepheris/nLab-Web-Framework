(()=>{
  'use strict';
  const state={apiUrl:'',clientId:'',sessionKey:'nlab:session'};
  const readSession=()=>{try{return JSON.parse(sessionStorage.getItem(state.sessionKey)||'null')}catch(_){return null}};
  const writeSession=s=>sessionStorage.setItem(state.sessionKey,JSON.stringify(s));
  const clearSession=()=>sessionStorage.removeItem(state.sessionKey);

  async function post(body){
    if(!state.apiUrl)throw new Error('NLAB security apiUrl is not configured');
    const res=await fetch(state.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),redirect:'follow'});
    const data=await res.json();
    if(!data.ok){
      const err=new Error(data?.error?.message||'API error');
      err.code=data?.error?.code||'api_error';
      err.status=data?.error?.status||res.status;
      err.details=data?.error?.details||null;
      if(err.status===401)clearSession();
      throw err;
    }
    return data;
  }

  async function exchangeGoogleCredential(idToken){
    const data=await post({action:'auth.login',id_token:idToken});
    const s={token:data.session_token,expiresAt:Date.now()+Number(data.expires_in||0)*1000,principal:data.principal};
    writeSession(s);return s;
  }

  async function api(action,payload){
    const s=readSession();
    if(!s?.token)throw Object.assign(new Error('Authentication required'),{code:'session_missing',status:401});
    return post({action,session_token:s.token,payload:payload||{}});
  }

  async function me(){const r=await api('auth.me',{});const s=readSession();if(s){s.principal=r.principal;writeSession(s)}return r.principal}
  async function logout(){const s=readSession();try{if(s?.token)await post({action:'auth.logout',session_token:s.token})}finally{clearSession()}}
  function configure(opts){Object.assign(state,opts||{});return {...state}}
  function session(){return readSession()}

  window.NLabSecurityClient={configure,exchangeGoogleCredential,api,me,logout,session,clearSession};
})();
