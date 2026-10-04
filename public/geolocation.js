'use strict';
(() => {
  function createLocator({getProvider,isSecure,onState=()=>{},onPosition=()=>{},timeout=10000,maximumAge=30000,setTimer=setTimeout,clearTimer=clearTimeout}){
    let sequence=0,pending=false,timer=null;
    function stop(){sequence++;pending=false;if(timer!==null)clearTimer(timer);timer=null;}
    function cancel(){if(!pending)return;stop();onState({phase:'idle'});}
    function locate(){
      stop();const current=sequence;
      if(!isSecure()){onState({phase:'insecure'});return;}
      const provider=getProvider();
      if(!provider||typeof provider.getCurrentPosition!=='function'){onState({phase:'unsupported'});return;}
      pending=true;onState({phase:'requesting'});
      const fail=phase=>{if(current!==sequence||!pending)return;stop();onState({phase});};
      timer=setTimer(()=>fail('timeout'),timeout+5000);
      const success=position=>{
        if(current!==sequence||!pending)return;
        const coords=position?.coords,{latitude,longitude,accuracy}=coords||{};
        if(![latitude,longitude,accuracy].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0){fail('unavailable');return;}
        stop();onState({phase:'located'});onPosition({latitude,longitude,accuracy});
      };
      const failure=error=>fail(error?.code===1?'denied':error?.code===3?'timeout':'unavailable');
      try{provider.getCurrentPosition(success,failure,{enableHighAccuracy:false,timeout,maximumAge});}catch{fail('unavailable');}
    }
    return {locate,cancel};
  }
  window.FOOD_GEO={createLocator};
})();
