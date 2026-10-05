'use strict';
(() => {
  const branchId=f=>f.properties.branchId||f.properties.id;
  const hasPoint=f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.length===2&&f.geometry.coordinates.every(Number.isFinite);
  function representatives(features,selectedId){
    const branches=new Map();
    for(const f of features){const id=branchId(f);if(!branches.has(id)||f.properties.id===selectedId)branches.set(id,f);}
    return [...branches.values()];
  }
  function groupPoints(features,selectedId){
    const groups=new Map();
    for(const f of representatives(features,selectedId).filter(hasPoint)){
      const coordinates=f.geometry.coordinates,key=coordinates.join(',');
      if(!groups.has(key))groups.set(key,{key,coordinates,features:[],recordIds:[]});
      const group=groups.get(key);group.features.push(f);
      group.recordIds.push(...features.filter(record=>branchId(record)===branchId(f)).map(record=>record.properties.id));
    }
    return [...groups.values()];
  }
  function distanceMeters(a,b){
    const rad=v=>v*Math.PI/180,dlat=rad(b[1]-a[1]),dlng=rad(b[0]-a[0]);
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlng/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  window.FOOD_MAP_HELPERS={representatives,groupPoints,distanceMeters};
})();
