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
  let map=null,selectedId=null,triggerOrigin='list',previewId=null,keyboardInput=false,skipFocusPreview=false;
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
    $('result-list').innerHTML=features.map(f=>{
      const p=f.properties,photo=photosFor(p)[0],dishes=dishesFor(p);
      return `<article class="shop-card${photo?' has-photo':''}${selectedId===p.id?' selected':''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="查看${esc(p.name)}的照片与菜品">${photo?`<img class="card-photo" src="${photoUrl(photo.url)}" alt="${esc(photo.caption)}" width="112" height="126" loading="lazy" decoding="async">`:''}<div class="card-content"><p class="card-category">${esc(category(p))}${negative(p)?'<span class="taste-note">作者不推荐</span>':''}</p><h2>${esc(p.name)}</h2><p class="card-dishes">${dishes.slice(0,3).map(esc).join(' · ')}${dishes.length>3?'<span class="dish-more"> 等</span>':''}</p><p class="card-address">${esc(address(p))}</p></div></article>`;
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
    const branchIds=new Set();
    L.geoJSON({type:'FeatureCollection',features:features.filter(f=>{const id=f.properties.branchId||f.properties.id;if(!hasPoint(f)||branchIds.has(id))return false;branchIds.add(id);return true;})},{
      pointToLayer(f,latlng){
        const p=f.properties;
        if(p.id===selectedId&&p.locationAccuracy!=='exact'&&Number(p.accuracyMeters)>0)L.circle(latlng,{renderer:rangeRenderer,radius:Number(p.accuracyMeters),color:'#4a776d',fillColor:'#68a28b',fillOpacity:.07,weight:1,dashArray:'4 5',interactive:false}).addTo(rangeLayer);
        return L.marker(latlng,{icon:L.divIcon({className:`food-map-marker${p.id===selectedId?' marker-selected':''}`,html:pinSvg,iconSize:[44,52],iconAnchor:[22,49]}),alt:p.name,keyboard:true,riseOnHover:true,zIndexOffset:p.id===selectedId?1000:0});
      },
      onEachFeature(f,layer){
        const p=f.properties;markers.set(p.id,layer);
        layer.on('mouseover',()=>{if(matchMedia('(hover: hover)').matches)showPreview(p.id);});
        layer.on('mouseout',hidePreview);layer.on('click',()=>selectShop(p.id,'map'));
        layer.on('add',()=>{
          const el=layer.getElement();el.setAttribute('aria-label',p.name);
          el.addEventListener('focus',()=>{layer.setZIndexOffset(1200);if(skipFocusPreview){skipFocusPreview=false;return;}if(keyboardInput)showPreview(p.id);});
          el.addEventListener('blur',()=>{layer.setZIndexOffset(p.id===selectedId?1000:0);hidePreview();});
          el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();selectShop(p.id,'map');}});
        });
      }
    }).addTo(markerLayer);
  }
  function fitAll(){hidePreview();if(!map)return;const points=features.filter(hasPoint).map(f=>[f.geometry.coordinates[1],f.geometry.coordinates[0]]);if(points.length)map.fitBounds(points,{paddingTopLeft:[40,65],paddingBottomRight:[40,65],maxZoom:12,animate:false});}
  function sourceCard(s){const when=s.activityAt?`${s.activityType==='edit'?'更新':'发布'} ${s.activityAt}`:s.displayDate||'';return `<a class="note-source-card" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer"><span class="source-avatar" aria-hidden="true">${esc(Array.from(s.authorName||'帖')[0])}</span><span><strong>${esc(s.title||'小红书原帖')}</strong><small>${esc([s.authorName,when].filter(Boolean).join(' · '))}</small></span></a>`;}
  function closeShop(restoreFocus=false){
    const id=selectedId,origin=triggerOrigin;selectedId=null;hidePreview();
    $('detail-panel').hidden=true;$('shop-backdrop').hidden=true;document.body.classList.remove('shop-open');renderList();renderMap();
    if(restoreFocus){const target=origin==='map'?markers.get(id)?.getElement():[...document.querySelectorAll('.shop-card[data-id]')].find(el=>el.dataset.id===id);skipFocusPreview=origin==='map';target?.focus({preventScroll:true});}
  }
  function selectShop(id,origin='list'){
    const f=byId.get(id);if(!f)return;hidePreview();selectedId=id;triggerOrigin=origin;
    const p=f.properties,images=photosFor(p),dishes=dishesFor(p),source=p.sources?.[0];
    const gallery=images.length?`<div class="shop-gallery">${images.map((photo,i)=>`<button class="shop-photo" data-photo="${photoUrl(photo.url)}" aria-label="放大${esc(photo.caption)}"><img src="${photoUrl(photo.url)}" alt="${esc(photo.caption)}" width="${photo.width}" height="${photo.height}" ${i?'loading="lazy"':''} decoding="async"></button>`).join('')}</div>`:'';
    $('detail-panel').innerHTML=`<div class="shop-close-rail"><button id="close-detail" class="detail-close" aria-label="关闭店铺详情">×</button></div>${gallery}<div class="shop-detail-header"><span class="shop-category">${esc(category(p))}${negative(p)?'<span class="taste-note">作者不推荐</span>':''}</span><h2 id="shop-title">${esc(p.name)}</h2></div><div class="detail-body"><div class="dish-chips">${dishes.map(d=>`<span>${esc(d)}</span>`).join('')}</div><div class="shop-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><p>${esc(address(p))}${!hasPoint(f)?'<small class="location-pending">地图位置待补</small>':''}</p></div>${source?`<a class="original-note-link" href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">打开小红书原帖</a>`:''}<details class="shop-evidence"><summary>原帖出处</summary><div class="note-source-list">${(p.sources||[]).map(sourceCard).join('')}</div>${p.locationCaveat?`<p class="location-caveat">${esc(p.locationCaveat)}</p>`:''}</details></div>`;
    if(!p.sources?.length)$('detail-panel').querySelector('.shop-evidence')?.remove();
    window.FOOD_COMMUNITY?.mount(p,$('detail-panel').querySelector('.detail-body'));
    const panel=$('detail-panel'),mobile=matchMedia('(max-width: 720px)').matches;
    panel.hidden=false;panel.scrollTop=0;panel.setAttribute('role',mobile?'dialog':'region');panel.setAttribute('aria-modal',String(mobile));panel.setAttribute('aria-labelledby','shop-title');
    $('shop-backdrop').hidden=false;document.body.classList.add('shop-open');$('close-detail').addEventListener('click',()=>closeShop(true));renderList();renderMap();
    if(map&&hasPoint(f)){
      const point=map.project([f.geometry.coordinates[1],f.geometry.coordinates[0]],15);if(!mobile)point.x+=panel.getBoundingClientRect().width/2;
      map.setView(map.unproject(point,15),15,{animate:false});
    }
    if(mobile||keyboardInput)$('close-detail').focus({preventScroll:true});
  }
  if(window.L){
    map=L.map('map',{preferCanvas:true,zoomControl:false,minZoom:9,maxZoom:18}).setView([39.929,116.434],12);
    L.control.zoom({position:'bottomright'}).addTo(map);markerLayer=L.layerGroup().addTo(map);rangeLayer=L.layerGroup().addTo(map);rangeRenderer=L.canvas({padding:.5});
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(map);
    let loaded=false;tiles.on('tileload',()=>{loaded=true;$('tile-status').hidden=true;});tiles.on('tileerror',()=>{if(!loaded)$('tile-status').hidden=false;});
    map.on('movestart zoomstart dragstart',hidePreview);new ResizeObserver(()=>{hidePreview();map.invalidateSize({pan:false});}).observe($('map'));
  }else{$('tile-status').hidden=false;$('reset-map').disabled=true;}
  $('reset-map').addEventListener('click',()=>{closeShop();fitAll();});$('shop-backdrop').addEventListener('click',()=>closeShop(true));
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
  renderList();renderMap();fitAll();
  window.FOOD_MAP={map,selectShop,closeShop,markers,getFeatures:()=>features,replaceFeatures(next){features=next;byId.clear();features.forEach(f=>byId.set(f.properties.id,f));renderList();renderMap();},getSelected:()=>selectedId};
})();
