'use strict';
(() => {
  function searchText(properties){
    const name=typeof properties?.name==='string'?properties.name.trim():'';
    const address=typeof properties?.externalAddress==='string'?properties.externalAddress.trim():typeof properties?.address==='string'?properties.address.trim():'';
    return name||address;
  }
  function buildAmapSearch(properties,{callNative=true}={}){
    const keyword=searchText(properties);if(!keyword)return null;
    const url=new URL('https://uri.amap.com/search');
    url.search=new URLSearchParams({keyword,city:'北京',view:'map',src:'beijing-food-map',callnative:callNative?'1':'0'}).toString();
    return url.href;
  }
  function buildAmapAppSearch(properties,{platform='android'}={}){
    const keyword=searchText(properties);if(!keyword||!['android','ios'].includes(platform))return null;
    const query=keyword.includes('北京')?keyword:'北京 '+keyword;
    return `${platform==='ios'?'iosamap':'androidamap'}://poi?sourceApplication=beijing-food-map&${platform==='ios'?'name':'keywords'}=${encodeURIComponent(query)}`;
  }
  function getAmapEntry(properties,{userAgent='',platform='',maxTouchPoints=0}={}){
    const webHref=buildAmapSearch(properties,{callNative:false});if(!webHref)return null;
    const ua=String(userAgent),ios=/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&maxTouchPoints>1);
    if(ios)return {href:buildAmapAppSearch(properties,{platform:'ios'}),webHref,mode:'ios',label:'打开高德 App',hint:'未打开 App？'};
    if(/Android/i.test(ua)){
      const appHref=buildAmapAppSearch(properties),intentBrowser=/Chrome\/|Chromium\/|EdgA\//.test(ua)&&!/MicroMessenger|\bQQ\/|\bwv\b|Version\/4\.0|SamsungBrowser|UCBrowser|HuaweiBrowser|MiuiBrowser|OPR\//i.test(ua);
      if(intentBrowser)return {href:appHref.replace('androidamap://','intent://')+`#Intent;scheme=androidamap;package=com.autonavi.minimap;S.browser_fallback_url=${encodeURIComponent(webHref)};end`,webHref,mode:'android-intent',label:'打开高德 App',hint:'未安装时将打开网页 ·'};
      return {href:appHref,webHref,mode:'android',label:'打开高德 App',hint:'未打开 App？'};
    }
    return {href:webHref,webHref,mode:'web',label:'高德地图查看',hint:'确认分店后规划路线 ·'};
  }
  window.FOOD_TRAVEL={buildAmapSearch,buildAmapAppSearch,getAmapEntry};
})();
