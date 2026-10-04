'use strict';
(() => {
  function buildAmapSearch(properties,{callNative=true}={}){
    const name=typeof properties?.name==='string'?properties.name.trim():'';
    const address=typeof properties?.externalAddress==='string'?properties.externalAddress.trim():typeof properties?.address==='string'?properties.address.trim():'';
    const keyword=name||address;if(!keyword)return null;
    const url=new URL('https://uri.amap.com/search');
    url.search=new URLSearchParams({keyword,city:'北京',view:'map',src:'beijing-food-map',callnative:callNative?'1':'0'}).toString();
    return url.href;
  }
  window.FOOD_TRAVEL={buildAmapSearch};
})();
