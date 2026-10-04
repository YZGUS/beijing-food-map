'use strict';
(() => {
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let user=null,sessionReady=false;const drafts=new Map();
 async function api(path,options={}){
  path=path.replace(/^\//,'');
  const headers={'X-Food-Request':'1',...(options.headers||{})};
  if(options.body&&!(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  const response=await fetch(path,{...options,headers,credentials:'same-origin'});
  let data;try{data=await response.json();}catch{throw new Error('暂时无法连接，请稍后重试');}
  if(!response.ok){const e=new Error(data.error||'暂时无法连接，请稍后重试');e.status=response.status;throw e;}return data;
 }
 function signinCopy(){return '<a class="signin-link" href="login" target="_top">登录后继续</a>';}
 function notice(message){$('food-toast').textContent=message;$('food-toast').hidden=false;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('food-toast').hidden=true,4500);}
 document.body.insertAdjacentHTML('beforeend',`<div id="food-toast" class="food-toast" role="status" hidden></div>
 <dialog id="photo-viewer" class="photo-viewer"><button id="close-photo" class="dialog-close" aria-label="关闭照片">×</button><img id="full-photo" alt="菜品照片"></dialog>
 <dialog id="record-dialog" class="record-dialog" aria-labelledby="record-title"><div class="recorder-heading"><div><p class="eyebrow">添一笔自己的食单</p><h2 id="record-title">记录一餐</h2></div><button id="close-record" class="dialog-close" type="button" aria-label="关闭录入">×</button></div>
 <div id="record-login" hidden><p>浏览无需登录。记录新的一餐时，请先登录以保存照片和食单。</p>${signinCopy()}</div>
 <form id="record-form"><label class="field-label" for="record-name">店铺名称<span>含分店名</span></label><input id="record-name" name="name" required maxlength="120" autocomplete="off" list="known-shops" placeholder="例如：炒豆合作社（东四总店）"><datalist id="known-shops"></datalist>
 <label class="field-label" for="record-address">位置</label><input id="record-address" name="address" required maxlength="250" placeholder="街道、门牌号或商场楼层"><details id="position-details" class="position-details"><summary>在地图上标一下 <span id="position-status">可选</span></summary><p class="form-hint">点击地图选点，或拖动标记调整。填写地址后也可直接保存。</p><div id="entry-map" aria-label="点击地图选择店铺位置"></div><button id="clear-position" class="quiet-button" type="button">清除选点</button></details>
 <label class="field-label" for="record-dishes">菜品</label><input id="record-dishes" name="dishes" required maxlength="600" placeholder="例如：肉串、黑椒土豆泥"><p class="form-hint">多道菜用顿号或逗号隔开。</p>
 <div class="field-label">菜品图片 <span>1–3 张</span></div><label class="photo-upload" for="record-photos"><span class="upload-symbol">＋</span><strong>添加这餐的照片</strong><small>JPG、PNG、WebP · 每张 5MB 以内</small><input id="record-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="photo-previews" class="photo-previews"></div>
 <details class="record-optionals"><summary>再写一点 <span>选填</span></summary><label class="field-label" for="record-experience">用餐感受</label><textarea id="record-experience" maxlength="1000" rows="3" placeholder="口味、份量，或想分享的小建议"></textarea><div class="optional-grid"><div><label class="field-label" for="record-amount">人均（元）</label><input id="record-amount" type="number" min="0" max="10000" step="0.01" placeholder="例如 45"></div><div><label class="field-label" for="record-date">用餐日期</label><input id="record-date" type="date"></div></div><label class="field-label" for="record-source">来源链接</label><input id="record-source" type="url" placeholder="有的话可以贴在这里"></details>
 <p id="record-error" class="form-error" role="alert" hidden></p><div class="record-footer"><p id="record-progress" class="form-hint" role="status">分享一道值得记录的菜。</p><button id="submit-record" class="primary-button" type="submit">保存到食单</button></div></form></dialog>`);
 const viewer=$('photo-viewer');$('close-photo').onclick=()=>viewer.close();viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close();});
 const heart='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 4.8a5.3 5.3 0 0 0-7.5 0L12 5.9l-1.1-1.1a5.3 5.3 0 0 0-7.5 7.5L12 21l8.6-8.7a5.3 5.3 0 0 0-.1-7.5Z"/></svg>';
 async function mount(p,container){
  const id=p.entryId||'seed:'+p.id, draft=drafts.get(id)||{text:'',ate:false,key:crypto.randomUUID()};drafts.set(id,draft);
  const entryDetails=document.createElement('div');entryDetails.className='record-context';
  if(p.provenance==='user')entryDetails.innerHTML=`${p.experience?`<p class="meal-experience">${esc(p.experience)}</p>`:''}<p class="meal-meta">${esc([p.creatorName&&p.creatorName+' 的记录',p.amount!==null&&p.amount!==undefined?'人均 ¥'+p.amount:'',p.mealDate].filter(Boolean).join(' · '))}</p>${p.sourceUrl?`<a class="source-text-link" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>`:''}`;
  if(entryDetails.innerHTML)container.querySelector('.shop-location').after(entryDetails);
  const related=window.FOOD_MAP.getFeatures().filter(f=>(f.properties.branchId||f.properties.id)===(p.branchId||p.id)&&f.properties.id!==p.id);
  if(related.length){const el=document.createElement('div');el.className='related-records';el.innerHTML=`<span>这家店的其他记录</span>${related.slice(0,5).map(f=>`<button type="button" data-record="${esc(f.properties.id)}">${esc(f.properties.creatorName||'收藏食单')} · ${esc((f.properties.dishes||[])[0]||'用餐记录')}</button>`).join('')}`;el.querySelectorAll('button').forEach(b=>b.onclick=()=>window.FOOD_MAP.selectShop(b.dataset.record));container.append(el);}
  const section=document.createElement('section');section.className='community';section.setAttribute('aria-label','点赞与评价');section.dataset.entry=id;
  section.innerHTML=`<div class="community-actions"><button class="like-button" type="button" aria-pressed="false" disabled>${heart}<span class="like-label">有帮助</span><span class="like-count"></span></button><button type="button" class="review-toggle">写评价</button></div><p class="feedback-status form-hint" role="status">正在载入反馈…</p><div class="review-editor" hidden><form class="review-form"><label class="sr-only" for="review-text">写下评价或留言</label><textarea id="review-text" maxlength="1000" rows="3" placeholder="分享口味、份量，或留下你的问题">${esc(draft.text)}</textarea><div class="review-controls"><label class="ate-check"><input type="checkbox" ${draft.ate?'checked':''}>我实际到店吃过</label><button type="submit" class="primary-button">发布评价</button></div><p class="review-error form-error" role="alert" hidden></p></form></div><div class="comment-list"></div>`;
  container.append(section);
  container.closest('#detail-panel').querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>{$('full-photo').src=b.dataset.photo;viewer.showModal();});
  const like=section.querySelector('.like-button'),status=section.querySelector('.feedback-status'),editor=section.querySelector('.review-editor'),toggle=section.querySelector('.review-toggle'),form=section.querySelector('.review-form'),text=form.querySelector('textarea'),ate=form.querySelector('input'),error=form.querySelector('.review-error');
  let currentFeedback=null;
  function render(data){
   currentFeedback=data;like.disabled=false;like.setAttribute('aria-pressed',String(data.liked));like.querySelector('.like-label').textContent=data.liked?'已赞':'有帮助';like.querySelector('.like-count').textContent=data.likeCount||'';
   status.textContent=data.comments.length?'':'还没有评价，分享你的第一印象。';
   section.querySelector('.comment-list').innerHTML=data.comments.map(c=>`<article class="comment"><div class="comment-byline"><strong>${esc(c.name)}</strong>${c.ate?'<span class="ate-badge">到店体验 · 自述</span>':''}<time>${new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(new Date(c.createdAt))}</time>${c.mine?`<button class="delete-comment" data-comment="${esc(c.id)}" type="button" aria-label="删除自己的评价">删除</button>`:''}</div><p>${esc(c.body)}</p></article>`).join('');
   section.querySelectorAll('.delete-comment').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/comments/'+b.dataset.comment,{method:'DELETE'});if(section.isConnected)render(await api('/api/entries/'+encodeURIComponent(id)+'/feedback'));}catch(e){status.textContent=e.message;b.disabled=false;}});
  }
  toggle.onclick=()=>{editor.hidden=!editor.hidden;if(!editor.hidden){if(sessionReady&&!user){status.innerHTML=signinCopy();editor.hidden=true;}else text.focus();}};
  text.oninput=()=>{draft.text=text.value;draft.key=crypto.randomUUID();};ate.onchange=()=>{draft.ate=ate.checked;draft.key=crypto.randomUUID();};
  like.onclick=async()=>{
   if(sessionReady&&!user){status.innerHTML=signinCopy();return;}if(!currentFeedback)return;like.disabled=true;
   try{const data=await api('/api/entries/'+encodeURIComponent(id)+'/like',{method:currentFeedback.liked?'DELETE':'PUT'});if(section.isConnected)render(data);}catch(e){if(section.isConnected){like.disabled=false;status.textContent=e.message;if(e.status===401)status.insertAdjacentHTML('beforeend',signinCopy());}}
  };
  form.onsubmit=async e=>{
   e.preventDefault();if(!text.value.trim()){error.hidden=false;error.textContent='先写一点内容再发布吧。';text.focus();return;}
   const submit=form.querySelector('button[type=submit]');submit.disabled=true;error.hidden=true;
   try{const data=await api('/api/entries/'+encodeURIComponent(id)+'/comments',{method:'POST',body:{body:text.value.trim(),ate:ate.checked,requestKey:draft.key}});draft.text='';draft.ate=false;draft.key=crypto.randomUUID();if(section.isConnected){text.value='';ate.checked=false;render(data);editor.hidden=true;notice('评价已发布');}}
   catch(e){if(section.isConnected){error.hidden=false;error.textContent=e.message;}}
   finally{if(section.isConnected)submit.disabled=false;}
  };
  try{const data=await api('/api/entries/'+encodeURIComponent(id)+'/feedback');if(section.isConnected)render(data);}catch(e){if(section.isConnected){status.textContent=e.message;const retry=document.createElement('button');retry.className='quiet-button';retry.textContent='重新载入';retry.onclick=async()=>{retry.disabled=true;try{render(await api('/api/entries/'+encodeURIComponent(id)+'/feedback'));retry.remove();}catch(e){status.firstChild.textContent=e.message;retry.disabled=false;}};status.append(retry);}}
 }
 window.FOOD_COMMUNITY={mount};
 let entryMap=null,pointMarker=null,position=null,branchId=null,files=[],busy=false,requestKey=crypto.randomUUID();
 const dialog=$('record-dialog'),recordForm=$('record-form');
 function updateKnownShops(){const unique=new Map(window.FOOD_MAP.getFeatures().map(f=>[f.properties.branchId||f.properties.id,f]));$('known-shops').innerHTML=[...unique.values()].map(f=>`<option value="${esc(f.properties.name)}"></option>`).join('');}
 function setPosition(lat,lng){requestKey=crypto.randomUUID();position={lat,lng};$('position-status').textContent='已选点';if(entryMap){if(!pointMarker){pointMarker=L.marker([lat,lng],{draggable:true,alt:'选中的店铺位置',icon:L.divIcon({className:'entry-position-marker',html:'<span aria-hidden="true"></span>',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(entryMap);pointMarker.on('dragend',()=>{const v=pointMarker.getLatLng();setPosition(v.lat,v.lng);});}else pointMarker.setLatLng([lat,lng]);}}
 function clearPosition(){requestKey=crypto.randomUUID();position=null;$('position-status').textContent='可选';if(pointMarker){pointMarker.remove();pointMarker=null;}}
 $('position-details').addEventListener('toggle',()=>{if(!$('position-details').open)return;if(!entryMap&&window.L){entryMap=L.map('entry-map',{minZoom:9,maxZoom:18}).setView([39.925,116.42],12);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(entryMap);entryMap.on('click',e=>{branchId=null;setPosition(e.latlng.lat,e.latlng.lng);});if(position)setPosition(position.lat,position.lng);}if(entryMap){requestAnimationFrame(()=>entryMap.invalidateSize());if(position)entryMap.setView([position.lat,position.lng],15);}});
 $('clear-position').onclick=()=>{branchId=null;clearPosition();};
 function useKnownShop(){branchId=null;clearPosition();const f=window.FOOD_MAP.getFeatures().find(f=>f.properties.name===$('record-name').value.trim());if(!f)return;branchId=f.properties.branchId||f.properties.id;$('record-address').value=f.properties.externalAddress||f.properties.address;if(f.geometry?.type==='Point')setPosition(f.geometry.coordinates[1],f.geometry.coordinates[0]);}
 $('record-name').addEventListener('input',useKnownShop);
 $('record-name').addEventListener('change',useKnownShop);
 $('record-address').addEventListener('input',()=>{branchId=null;clearPosition();});
 function previews(){
  $('photo-previews').innerHTML=files.map((f,i)=>`<div class="photo-preview"><img src="${f.preview}" alt="菜品照片 ${i+1}"><button type="button" data-remove="${i}" aria-label="删除第${i+1}张照片">×</button></div>`).join('');
  $('photo-previews').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(busy)return;requestKey=crypto.randomUUID();const item=files.splice(Number(b.dataset.remove),1)[0];URL.revokeObjectURL(item.preview);if(item.media)api('/api/media/'+item.media.id,{method:'DELETE'}).catch(()=>{});previews();});
 }
 $('record-photos').onchange=()=>{
  const chosen=[...$('record-photos').files];$('record-error').hidden=true;
  for(const file of chosen){if(files.length>=3){$('record-error').textContent='最多选择3张照片。';$('record-error').hidden=false;break;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){$('record-error').textContent='请选择5MB以内的 JPG、PNG 或 WebP 图片。';$('record-error').hidden=false;continue;}files.push({file,preview:URL.createObjectURL(file),media:null});}
  $('record-photos').value='';previews();requestKey=crypto.randomUUID();
 };
 recordForm.addEventListener('input',()=>{if(!busy)requestKey=crypto.randomUUID();});
 function closeRecord(){if(busy)return;dialog.close();$('add-record').focus();}
 $('close-record').onclick=closeRecord;dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('click',e=>{if(e.target===dialog)closeRecord();});
 $('add-record').onclick=async()=>{
  if(window.FOOD_MAP.getSelected())window.FOOD_MAP.closeShop();updateKnownShops();dialog.showModal();
  if(!sessionReady){$('record-progress').textContent='正在连接…';try{const data=await api('/api/session');user=data.user;sessionReady=true;$('record-progress').textContent='分享一道值得记录的菜。';}catch(e){$('record-error').hidden=false;$('record-error').textContent=e.message;}}
  $('record-login').hidden=!!user;recordForm.hidden=!user;
 };
 recordForm.onsubmit=async e=>{
  e.preventDefault();if(busy)return;const err=$('record-error');err.hidden=true;
  const dishes=[...new Set($('record-dishes').value.split(/[、,，;；\n]/).map(s=>s.trim()).filter(Boolean))];
  if(!dishes.length||!files.length){err.textContent=!files.length?'添加至少一张菜品照片，再保存。':'请填写至少一道菜品。';err.hidden=false;if(!files.length)$('record-photos').focus();return;}
  busy=true;$('submit-record').disabled=true;$('close-record').disabled=true;recordForm.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);
  try{
   for(let i=0;i<files.length;i++){
    if(files[i].media)continue;
    $('record-progress').textContent=`正在保存照片 ${i+1}/${files.length}…`;
    const bitmap=await createImageBitmap(files[i].file);
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob)throw new Error('照片无法读取，请重新选择。');
    const form=new FormData();form.append('photo',blob,'dish.jpg');files[i].media=await api('/api/uploads',{method:'POST',body:form});
   }
   $('record-progress').textContent='正在保存食单…';
   const result=await api('/api/entries',{method:'POST',body:{name:$('record-name').value.trim(),address:$('record-address').value.trim(),dishes,mediaIds:files.map(f=>f.media.id),lat:position?.lat??null,lng:position?.lng??null,branchId,experience:$('record-experience').value.trim(),mealDate:$('record-date').value||null,amount:$('record-amount').value===''?null:Number($('record-amount').value),sourceUrl:$('record-source').value.trim(),requestKey}});
   const data=await api('/api/catalog');window.FOOD_MAP.replaceFeatures(data.features);
   files.forEach(f=>URL.revokeObjectURL(f.preview));files=[];previews();recordForm.reset();clearPosition();branchId=null;requestKey=crypto.randomUUID();$('record-progress').textContent='分享一道值得记录的菜。';dialog.close();window.FOOD_MAP.selectShop(result.id);notice('这一餐已保存到食单');
  }catch(e){err.hidden=false;err.textContent=e.message;$('record-progress').textContent='已保留填写内容，可以重试。';}
  finally{busy=false;$('submit-record').disabled=false;$('close-record').disabled=false;recordForm.querySelectorAll('input,textarea').forEach(el=>el.disabled=false);}
 };
 $('record-date').max=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
 Promise.allSettled([api('/api/session'),api('/api/catalog')]).then(results=>{
  if(results[0].status==='fulfilled'){user=results[0].value.user;sessionReady=true;const account=$('account-button');account.hidden=false;account.textContent=user?'退出':'登录';account.setAttribute('aria-label',user?'退出当前账号':'登录食单');account.onclick=async()=>{if(!user){location.href='login';return;}try{await api('auth/logout',{method:'POST'});location.href=results[0].value.publicRead?'./':'login';}catch(e){notice(e.message);}};}
  if(results[1].status==='fulfilled')window.FOOD_MAP.replaceFeatures(results[1].value.features);
  else notice('新增食单暂时无法载入，收藏仍可浏览。');
 });
})();
