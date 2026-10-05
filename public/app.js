'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'?esc(u.href):'#';}catch{return '#';}};
  const photoUrl=v=>/^(photos\/[a-z0-9-]+\.webp|api\/media\/[a-f0-9-]{36})$/.test(v||'')?esc(v):'';
  const photos=window.FOOD_PHOTOS||{};
  let features=window.FOOD_COLLECTION?.features||[];
  const byId=new Map(features.map(f=>[f.properties.id,f]));
  const photosFor=p=>p.photos||photos[p.id]||[];
  const hasPoint=f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.length===2&&f.geometry.coordinates.every(Number.isFinite);
  const category=p=>String(p.category||p.district||'').replace(/^(正餐|轻食|饮品)\s*[\/／]\s*/,'').replace(/\s*[\/／]\s*/g,' · ');
  const dishesFor=p=>[...new Set((p.dishes||[]).map(d=>String(d).replace(/[（(][^）)]*(?:描述|原图|正文|菜单|核验|图称|图片名|实食|续加)[^）)]*[）)]/g,'').trim()).filter(Boolean))];
  const address=p=>String(p.externalAddress||p.address||'地点待补').split('；')[0];
  const negative=p=>p.isNegative===true;
  let map=null,selectedId=null,triggerOrigin='list',previewId=null,keyboardInput=false,skipFocusPreview=false,locator=null,userLocationLayer=null,currentLocation=null,listOrigin=null,listMode='all',locationBusy=false,locationAutoPan=true,programmaticMove=false,manualMove=false;
  const markers=new Map();let markerLayer=null,rangeLayer=null,rangeRenderer=null;
  function hidePreview(){markers.get(previewId)?.getElement()?.removeAttribute('aria-describedby');previewId=null;$('marker-preview').hidden=true;$('marker-preview').setAttribute('aria-hidden','true');}
  function showPreview(id){
    if(selectedId)return;
    const f=byId.get(id),photo=f&&photosFor(f.properties)[0];
    if(!map||!f||!photo||!hasPoint(f))return;
    const box=$('marker-preview'),p=f.properties;
    hidePreview();previewId=id;box.setAttribute('aria-hidden','false');markers.get(id)?.getElement()?.setAttribute('aria-describedby','marker-preview');box.innerHTML=`<img src="${photoUrl(photo.url)}" alt="${esc(photo.caption)}" width="248" height="160"><strong>${esc(p.name)}</strong>`;
    const width=Math.min(248,$('map-section').clientWidth-24);box.style.width=width+'px';box.hidden=false;
    const point=map.latLngToContainerPoint([f.geometry.coordinates[1],f.geometry.coordinates[0]]);
    const height=box.offsetHeight,mapWidth=$('map-section').clientWidth,mapHeight=$('map-section').clientHeight;
    const left=Math.max(12,Math.min(point.x-width/2,mapWidth-width-12));
    let top=point.y-height-58;if(top<12)top=point.y+12;
    top=Math.max(12,Math.min(top,mapHeight-height-12));
    box.style.left=left+'px';box.style.top=top+'px';
  }
  function renderList(){
    const visible=window.FOOD_MAP_HELPERS.representatives(features,selectedId);
    if(listOrigin)visible.sort((a,b)=>{const da=hasPoint(a)?window.FOOD_MAP_HELPERS.distanceMeters(listOrigin,a.geometry.coordinates):Infinity,db=hasPoint(b)?window.FOOD_MAP_HELPERS.distanceMeters(listOrigin,b.geometry.coordinates):Infinity;return da-db;});
    $('list-context').hidden=listMode==='all';$('list-context-label').textContent=listMode==='nearby'?'当前位置附近':'地图中心附近';
    $('result-list').innerHTML=visible.map(f=>{
      const p=f.properties,photo=photosFor(p)[0],dishes=dishesFor(p);
      const distance=listOrigin&&hasPoint(f)?window.FOOD_MAP_HELPERS.distanceMeters(listOrigin,f.geometry.coordinates):null;
      const distanceText=distance===null?'':distance<200?'约200米内':distance<1000?'约'+Math.round(distance/100)*100+'米':'约'+(distance/1000).toFixed(1)+'公里';
      return `<article class="shop-card${photo?' has-photo':''}${selectedId===p.id?' selected':''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="查看${esc(p.name)}的照片与菜品">${photo?`<img class="card-photo" src="${photoUrl(photo.url)}" alt="${esc(photo.caption)}" width="112" height="126" loading="lazy" decoding="async">`:''}<div class="card-content"><p class="card-category">${esc(category(p))}${distanceText?`<span class="card-distance">${esc(distanceText)}</span>`:''}${negative(p)?'<span class="taste-note">作者不推荐</span>':''}</p><h2>${esc(p.name)}</h2><p class="card-dishes">${dishes.slice(0,3).map(esc).join(' · ')}${dishes.length>3?'<span class="dish-more"> 等</span>':''}${p.listingType==='branch-directory'?'菜品资料待补 · 营业状态待确认':''}</p><p class="card-address">${esc(address(p))}</p></div></article>`;
    }).join('')||'<p class="empty-copy">暂时无法载入店铺，请刷新重试。</p>';
    $('result-list').querySelectorAll('[data-id]').forEach(el=>{
      el.addEventListener('click',()=>selectShop(el.dataset.id,'list'));
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectShop(el.dataset.id,'list');}});
    });
  }
  const pinSvg='<svg viewBox="0 0 48 56" aria-hidden="true"><path class="pin-body" d="M24 2C12 2 3 11 3 23c0 16 21 30 21 30s21-14 21-30C45 11 36 2 24 2Z"/><g class="pin-utensils" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 13v6c0 2 2 3 4 3s4-1 4-3v-6m-4 0v22"/><ellipse cx="32" cy="17" rx="3" ry="5"/><path d="M32 22v13"/></g></svg>';
  function renderMap(){
    if(!map)return;
    markerLayer.clearLayers();rangeLayer.clearLayers();markers.clear();
    const groups=window.FOOD_MAP_HELPERS.groupPoints(features,selectedId),byGroup=new Map(groups.map(g=>[g.key,g]));
    const chosen=byId.get(selectedId);if(chosen&&hasPoint(chosen)&&chosen.properties.locationAccuracy!=='exact'&&Number(chosen.properties.accuracyMeters)>0)L.circle([chosen.geometry.coordinates[1],chosen.geometry.coordinates[0]],{renderer:rangeRenderer,radius:Number(chosen.properties.accuracyMeters),color:'#4a776d',fillColor:'#68a28b',fillOpacity:.07,weight:1,dashArray:'4 5',interactive:false}).addTo(rangeLayer);
    L.geoJSON({type:'FeatureCollection',features:groups.map(g=>({type:'Feature',geometry:{type:'Point',coordinates:g.coordinates},properties:{groupKey:g.key}}))},{
      pointToLayer(f,latlng){
        const group=byGroup.get(f.properties.groupKey),active=group.recordIds.includes(selectedId),count=group.features.length,label=count>1?`此位置的${count}家店铺`:group.features[0].properties.name;
        return L.marker(latlng,{icon:L.divIcon({className:`food-map-marker${active?' marker-selected':''}`,html:pinSvg+(count>1?`<span class="pin-count">${count}</span>`:''),iconSize:[44,52],iconAnchor:[22,49]}),alt:label,keyboard:true,riseOnHover:true,zIndexOffset:active?1000:0});
      },
      onEachFeature(f,layer){
        const group=byGroup.get(f.properties.groupKey),p=group.features[0].properties,active=group.recordIds.includes(selectedId),label=group.features.length>1?`此位置的${group.features.length}家店铺`:p.name;
        group.recordIds.forEach(id=>markers.set(id,layer));
        const preview=()=>{showPreview(p.id);if(group.features.length>1&&!$('marker-preview').hidden)$('marker-preview').querySelector('strong').textContent=`这里有${group.features.length}家店 · 点击选择`;};
        const open=()=>{if(group.features.length===1){selectShop(p.id,'map');return;}hidePreview();locationAutoPan=false;const content=document.createElement('div');content.className='map-shop-options';const heading=document.createElement('p');heading.textContent='选择这处位置的店铺';content.append(heading);for(const feature of group.features){const item=document.createElement('button'),photo=photosFor(feature.properties)[0];item.type='button';item.className='map-shop-option';if(photo){const image=document.createElement('img');image.src=photo.url;image.alt='';image.width=52;image.height=58;item.append(image);}const text=document.createElement('span');text.textContent=feature.properties.name;item.append(text);item.onclick=()=>selectShop(feature.properties.id,'map');content.append(item);}L.popup({maxWidth:320,minWidth:230,closeButton:true}).setLatLng(layer.getLatLng()).setContent(content).openOn(map);};
        layer.on('mouseover',()=>{if(matchMedia('(hover: hover)').matches)preview();});
        layer.on('mouseout',hidePreview);layer.on('click',open);
        layer.on('add',()=>{
          const el=layer.getElement();el.setAttribute('aria-label',label);
          el.addEventListener('focus',()=>{layer.setZIndexOffset(1200);if(skipFocusPreview){skipFocusPreview=false;return;}if(keyboardInput)preview();});
          el.addEventListener('blur',()=>{layer.setZIndexOffset(active?1000:0);hidePreview();});
          el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open();}});
        });
      }
    }).addTo(markerLayer);
  }
  function fitAll(){hidePreview();if(!map)return;const points=features.filter(hasPoint).map(f=>[f.geometry.coordinates[1],f.geometry.coordinates[0]]);if(points.length)map.fitBounds(points,{paddingTopLeft:[40,65],paddingBottomRight:[40,65],maxZoom:12,animate:false});}
  function sourceCard(s){const when=s.activityAt?`${s.activityType==='edit'?'更新':'发布'} ${s.activityAt}`:s.displayDate||'';return `<a class="note-source-card" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer"><span class="source-avatar" aria-hidden="true">${esc(Array.from(s.authorName||'帖')[0])}</span><span><strong>${esc(s.title||'小红书原帖')}</strong><small>${esc([s.authorName,when].filter(Boolean).join(' · '))}</small></span></a>`;}
  function closeShop(restoreFocus=false){
    if(!selectedId)return;
    const id=selectedId,origin=triggerOrigin;selectedId=null;hidePreview();
    $('detail-panel').hidden=true;$('shop-backdrop').hidden=true;document.body.classList.remove('shop-open');renderList();renderMap();
    if(restoreFocus){const target=origin==='map'?markers.get(id)?.getElement():[...document.querySelectorAll('.shop-card[data-id]')].find(el=>el.dataset.id===id);skipFocusPreview=origin==='map';target?.focus({preventScroll:true});}
  }
  function selectShop(id,origin='list'){
    locator?.cancel();
    const f=byId.get(id);if(!f)return;map?.closePopup();hidePreview();selectedId=id;triggerOrigin=origin;
    const p=f.properties,images=photosFor(p),dishes=dishesFor(p),source=p.sources?.[0];
    const evidenceSources=[...(p.sources||[]),...(p.locationSources||[]).map(s=>({url:s.url,title:s.title,displayDate:s.checkedAt?'资料核对 '+s.checkedAt:'地点资料',authorName:'地点资料'}))];
    const amapEntry=window.FOOD_TRAVEL?.getAmapEntry(p,{userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
    const gallery=images.length?`<div class="shop-gallery">${images.map((photo,i)=>`<button class="shop-photo" data-photo="${photoUrl(photo.url)}" aria-label="放大${esc(photo.caption)}"><img src="${photoUrl(photo.url)}" alt="${esc(photo.caption)}" width="${photo.width}" height="${photo.height}" ${i?'loading="lazy"':''} decoding="async"></button>`).join('')}</div>`:'';
    $('detail-panel').innerHTML=`<div class="shop-close-rail"><button id="close-detail" class="detail-close" aria-label="关闭店铺详情">×</button></div>${gallery}<div class="shop-detail-header"><span class="shop-category">${esc(category(p))}${negative(p)?'<span class="taste-note">作者不推荐</span>':''}</span><h2 id="shop-title">${esc(p.name)}</h2></div><div class="detail-body"><div class="dish-chips">${dishes.map(d=>`<span>${esc(d)}</span>`).join('')}</div><div class="shop-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><p>${esc(address(p))}${!hasPoint(f)?'<small class="location-pending">地图位置待补</small>':''}</p></div>${source?`<a class="original-note-link" href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">打开小红书原帖</a>`:''}<details class="shop-evidence"><summary>资料出处</summary><div class="note-source-list">${(p.sources||[]).map(sourceCard).join('')}</div>${p.locationCaveat?`<p class="location-caveat">${esc(p.locationCaveat)}</p>`:''}</details></div>`;
    const sourceList=$('detail-panel').querySelector('.note-source-list');if(sourceList)sourceList.innerHTML=evidenceSources.map(sourceCard).join('');
    if(!evidenceSources.length)$('detail-panel').querySelector('.shop-evidence')?.remove();
    const body=$('detail-panel').querySelector('.detail-body'),actions=document.createElement('div');actions.className='shop-actions';
    if(p.listingType==='branch-directory'){const notice=document.createElement('p');notice.className='branch-directory-note';notice.textContent='分店地点资料 · 营业状态待确认，菜品和餐品图待补。';body.querySelector('.dish-chips').replaceWith(notice);}
    if(amapEntry){const link=document.createElement('a');link.className='amap-link';link.href=amapEntry.href;link.textContent=amapEntry.label;link.rel='noopener';actions.append(link);}
    const original=body.querySelector('.original-note-link');if(original)actions.append(original);actions.classList.toggle('has-source',!!original);
    body.querySelector('.shop-location').after(actions);
    if(amapEntry){const hint=document.createElement('p');hint.className='amap-hint';hint.innerHTML=`${esc(amapEntry.hint)} <a href="${esc(amapEntry.webHref)}" target="_blank" rel="noopener noreferrer">网页版</a>`;actions.after(hint);}
    const brand=p.brandId||p.brandName||p.name.split(/[（(]/)[0].trim(),otherBranches=window.FOOD_MAP_HELPERS.representatives(features,selectedId).filter(v=>(v.properties.branchId||v.properties.id)!==(p.branchId||p.id)&&(v.properties.brandId||v.properties.brandName||v.properties.name.split(/[（(]/)[0].trim())===brand);
    if(otherBranches.length){const section=document.createElement('details');section.className='shop-branches';const heading=document.createElement('summary');heading.textContent='同品牌分店（'+otherBranches.length+'）';section.append(heading);for(const branch of otherBranches){const button=document.createElement('button');button.type='button';button.textContent=branch.properties.name;button.onclick=()=>selectShop(branch.properties.id);section.append(button);}const all=document.createElement('a');all.href=window.FOOD_TRAVEL.buildAmapSearch({name:p.brandName||p.name.split(/[（(]/)[0]},{callNative:false});all.target='_blank';all.rel='noopener noreferrer';all.textContent='高德查看北京其他分店 ↗';section.append(all);body.append(section);}
    window.FOOD_QUEUE?.mount(p,body);
    window.FOOD_COMMUNITY?.mount(p,$('detail-panel').querySelector('.detail-body'));
    const queue=body.querySelector('.queue-feedback');if(queue)body.querySelector('.shop-location').after(queue);
    const evidence=body.querySelector('.shop-evidence');if(evidence)body.append(evidence);
    const panel=$('detail-panel'),mobile=matchMedia('(max-width: 720px)').matches;
    panel.hidden=false;panel.scrollTop=0;panel.setAttribute('role',mobile?'dialog':'region');panel.setAttribute('aria-modal',String(mobile));panel.setAttribute('aria-labelledby','shop-title');
    $('shop-backdrop').hidden=false;document.body.classList.add('shop-open');$('close-detail').addEventListener('click',()=>closeShop(true));renderList();renderMap();
    if(map&&hasPoint(f)){
      const point=map.project([f.geometry.coordinates[1],f.geometry.coordinates[0]],15);if(!mobile)point.x+=panel.getBoundingClientRect().width/2;
      programmaticMove=true;try{map.setView(map.unproject(point,15),15,{animate:false});}finally{programmaticMove=false;}
    }
    if(mobile||keyboardInput)$('close-detail').focus({preventScroll:true});
  }
  if(window.L){
    map=L.map('map',{preferCanvas:true,zoomControl:false,minZoom:9,maxZoom:18}).setView([39.925,116.425],matchMedia('(max-width: 720px)').matches?12:13);
    map.attributionControl.setPosition('bottomleft');
    const locationPane=map.createPane('user-location');locationPane.style.zIndex='625';locationPane.style.pointerEvents='none';userLocationLayer=L.layerGroup().addTo(map);
    L.control.zoom({position:'bottomright'}).addTo(map);markerLayer=L.layerGroup().addTo(map);rangeLayer=L.layerGroup().addTo(map);rangeRenderer=L.canvas({padding:.5});
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(map);
    let tileTimer=null;tiles.on('loading',()=>{clearTimeout(tileTimer);tileTimer=setTimeout(()=>{$('tile-status').textContent='地图背景加载较慢，店铺与定位仍可使用。';$('tile-status').hidden=false;},2500);});tiles.on('load',()=>{clearTimeout(tileTimer);if(document.querySelectorAll('.leaflet-tile-loaded').length)$('tile-status').hidden=true;});tiles.on('tileerror',()=>{$('tile-status').textContent='部分地图背景加载失败，可继续浏览店铺或打开高德。';$('tile-status').hidden=false;});
    map.on('movestart',hidePreview);map.on('dragstart zoomstart',()=>{hidePreview();if(!programmaticMove){manualMove=true;locationAutoPan=false;}});map.on('moveend',()=>{if(manualMove&&!programmaticMove&&!selectedId){manualMove=false;const center=map.getCenter();listOrigin=[center.lng,center.lat];listMode='area';renderList();}});new ResizeObserver(()=>{hidePreview();map.invalidateSize({pan:false});}).observe($('map'));
    map.getContainer().addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.target.closest('input,textarea,select,button,a')){manualMove=true;locationAutoPan=false;}});
  }else{$('tile-status').hidden=false;$('reset-map').disabled=true;$('locate-map').disabled=true;}
  function locationState({phase}){
    const button=$('locate-map'),label=button.querySelector('span'),status=$('location-status');locationBusy=['requesting','awaiting_permission','slow','refreshing'].includes(phase);button.disabled=false;button.setAttribute('aria-busy',String(locationBusy));button.setAttribute('aria-label',locationBusy?'取消当前定位请求':'获取当前位置并移动地图');label.textContent=locationBusy?'取消定位':'我的位置';
    const messages={requesting:'正在获取位置，可继续拖动地图浏览。',awaiting_permission:'请在浏览器提示中允许定位，授权前仍可手选区域。',slow:'获取位置较慢，可先拖动地图；位置返回后不会打断你的浏览。',refreshing:'已显示近期位置，正在后台更新。',refresh_failed:'已保留近期位置，暂时无法刷新。可重试或手选区域。',denied:'浏览器未允许定位。可在网站权限中开启，或直接拖动地图选择区域。',timeout:'定位等待较久，可重试或拖动地图选择区域。',unavailable:'暂时无法获取位置。可以重试，或直接拖动地图选择区域。',unsupported:'当前浏览器不支持定位，请拖动地图选择区域。',insecure:'定位需要安全连接，请使用 HTTPS 地址打开页面。'};
    if(phase==='located'||phase==='idle'){status.hidden=true;return;}
    status.textContent=messages[phase]||messages.unavailable;status.classList.toggle('is-warning',!locationBusy);status.hidden=false;
  }
  if(map&&window.FOOD_GEO){locator=window.FOOD_GEO.createLocator({getProvider:()=>navigator.geolocation,getPermission:()=>navigator.permissions?.query({name:'geolocation'}),isSecure:()=>window.isSecureContext===true,onState:locationState,onPosition({latitude,longitude,accuracy,source,timestamp}){
    currentLocation={latitude,longitude,accuracy,timestamp};
    userLocationLayer.clearLayers();const latlng=[latitude,longitude];
    const area=L.circle(latlng,{pane:'user-location',radius:Math.max(accuracy,1),color:'#3983b5',weight:1,fillColor:'#539dc9',fillOpacity:.08,interactive:false}).addTo(userLocationLayer);
    L.circleMarker(latlng,{pane:'user-location',radius:7,color:'#fff',weight:3,fillColor:'#287fb5',fillOpacity:1,interactive:false}).addTo(userLocationLayer);
    if(locationAutoPan){programmaticMove=true;try{if(accuracy<80)map.setView(latlng,15,{animate:false});else map.fitBounds(area.getBounds(),{padding:[38,38],maxZoom:15,animate:false});}finally{programmaticMove=false;}listOrigin=[longitude,latitude];listMode='nearby';renderList();}
    const status=$('location-status'),nearBeijing=latitude>=39.4&&latitude<=41.1&&longitude>=115.4&&longitude<=117.6;
    status.textContent=!nearBeijing?'已定位。食单目前收录北京，可点击北京全览查看店铺。':!locationAutoPan?'已更新蓝点，保留当前浏览视野。':source==='cached'?'已显示最近2分钟内的位置，并按大致距离排列店铺。':accuracy>1000?'已定位到大致区域，浅蓝圈是定位范围；店铺按参考距离排列。':'已定位，店铺已按大致距离排列。';status.classList.remove('is-warning');status.hidden=false;
  }});}
  $('locate-map').addEventListener('click',()=>{if(locationBusy){locator?.cancel();return;}closeShop(false);locationAutoPan=true;manualMove=false;locator?.locate();});
  $('reset-map').addEventListener('click',()=>{locator?.cancel();$('location-status').hidden=true;closeShop();listOrigin=null;listMode='all';manualMove=false;renderList();programmaticMove=true;try{fitAll();}finally{programmaticMove=false;}});$('shop-backdrop').addEventListener('click',()=>closeShop(true));
  $('show-all-shops').addEventListener('click',()=>{locationAutoPan=false;manualMove=false;listOrigin=null;listMode='all';renderList();});
  document.addEventListener('pointerdown',()=>{keyboardInput=false;});
  document.addEventListener('keydown',e=>{
    if(e.key==='Tab')keyboardInput=true;
    if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(selectedId)closeShop(true);else hidePreview();}
    if(e.key==='Tab'&&selectedId&&!document.querySelector('dialog[open]')&&matchMedia('(max-width: 720px)').matches){
      const nodes=[...$('detail-panel').querySelectorAll('a,button,summary,input,textarea,select')].filter(el=>!el.disabled&&el.getClientRects().length&&(!el.checkVisibility||el.checkVisibility()));
      if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}
      else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
    }
  });
  renderList();renderMap();
  window.FOOD_MAP={map,selectShop,closeShop,markers,getFeatures:()=>features,replaceFeatures(next){features=next;byId.clear();features.forEach(f=>byId.set(f.properties.id,f));renderList();renderMap();},getSelected:()=>selectedId};
})();
