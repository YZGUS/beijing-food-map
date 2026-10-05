'use strict';
(() => {
  function createLocator({getProvider,isSecure,getPermission,onState=()=>{},onPosition=()=>{},timeout=10000,maximumAge=120000,slowAfter=5000,permissionTimeout=60000,unknownPermissionTimeout=30000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
    let sequence=0,pending=false,lastPosition=null,permissionCleanup=null;
    const timers=new Set();
    function clearWaits(){for(const timer of timers)clearTimer(timer);timers.clear();}
    function stop(){sequence++;pending=false;clearWaits();if(permissionCleanup)permissionCleanup();permissionCleanup=null;}
    function cancel(){if(!pending)return;stop();onState({phase:'idle'});}
    function locate(){
      stop();const current=sequence;
      if(!isSecure()){onState({phase:'insecure'});return;}
      const provider=getProvider();
      if(!provider||typeof provider.getCurrentPosition!=='function'){onState({phase:'unsupported'});return;}
      const cached=lastPosition&&now()-lastPosition.timestamp>=0&&now()-lastPosition.timestamp<=maximumAge?lastPosition:null;
      pending=true;onState({phase:cached?'refreshing':'requesting',hasPosition:!!cached});
      if(cached)onPosition({...cached,source:'cached'});
      const active=()=>current===sequence&&pending;
      const schedule=(callback,delay)=>{
        const timer=setTimer(()=>{timers.delete(timer);if(active())callback();},delay);timers.add(timer);return timer;
      };
      const fail=reason=>{
        if(!active())return;
        stop();onState(cached?{phase:'refresh_failed',reason,hasPosition:true,timestamp:cached.timestamp}:{phase:reason,hasPosition:false});
      };
      const acquisitionWait=(knownPermission,announce=false)=>{
        if(!active())return;
        clearWaits();if(announce)onState({phase:cached?'refreshing':'requesting',hasPosition:!!cached});
        schedule(()=>onState({phase:'slow',hasPosition:!!cached}),slowAfter);
        schedule(()=>fail('timeout'),knownPermission?timeout+5000:Math.max(timeout+5000,unknownPermissionTimeout));
      };
      const success=position=>{
        if(!active())return;
        const coords=position?.coords,{latitude,longitude,accuracy}=coords||{};
        if(![latitude,longitude,accuracy].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0){fail('unavailable');return;}
        const receivedAt=now(),capturedAt=position?.timestamp;
        const timestamp=typeof capturedAt==='number'&&Number.isFinite(capturedAt)&&capturedAt>0&&capturedAt<=receivedAt?capturedAt:receivedAt;
        lastPosition={latitude,longitude,accuracy,timestamp};
        const result={...lastPosition,source:receivedAt-timestamp>10000?'cached':'fresh'};
        stop();onState({phase:'located',hasPosition:true,timestamp});onPosition(result);
      };
      const failure=error=>fail(error?.code===1?'denied':error?.code===3?'timeout':'unavailable');
      let started=false;
      const start=permission=>{
        if(!active()||started)return;
        started=true;clearWaits();
        const state=typeof permission==='string'?permission:permission?.state;
        if(state==='denied'){fail('denied');return;}
        if(permission&&typeof permission.addEventListener==='function'&&typeof permission.removeEventListener==='function'){
          const changed=()=>{
            if(!active())return;
            if(permission.state==='denied')fail('denied');
            else if(permission.state==='granted')acquisitionWait(true,true);
          };
          permission.addEventListener('change',changed);
          permissionCleanup=()=>permission.removeEventListener('change',changed);
        }
        if(state==='prompt'){
          // Browser acquisition timeout excludes the time spent granting permission.
          onState({phase:'awaiting_permission',hasPosition:!!cached});
          schedule(()=>fail('timeout'),permissionTimeout);
        }else acquisitionWait(state==='granted');
        try{provider.getCurrentPosition(success,failure,{enableHighAccuracy:false,timeout,maximumAge});}catch{fail('unavailable');}
      };
      if(typeof getPermission!=='function'){start(null);return;}
      // A browser with a stalled or unsupported Permissions API still starts location.
      schedule(()=>start(null),1000);
      try{Promise.resolve(getPermission()).then(start,()=>start(null));}catch{start(null);}
    }
    return {locate,cancel};
  }
  window.FOOD_GEO={createLocator};
})();
