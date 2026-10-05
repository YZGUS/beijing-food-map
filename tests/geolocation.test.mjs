import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox={window:{},setTimeout,clearTimeout};vm.runInNewContext(await readFile('public/geolocation.js','utf8'),sandbox);
const {createLocator}=sandbox.window.FOOD_GEO;
function fixture({secure=true,provider=true,getPermission,now}={}){
 const requests=[],states=[],stateDetails=[],positions=[],timers=new Map();let next=0;
 const geo={getCurrentPosition(success,error,options){requests.push({success,error,options});}};
 const locator=createLocator({getProvider:()=>provider?geo:null,isSecure:()=>secure,getPermission,...(now?{now}:{}),onState:s=>{states.push(s.phase);stateDetails.push(s);},onPosition:p=>positions.push(p),setTimer:(f,ms)=>{const id=++next;timers.set(id,{f,ms});return id;},clearTimer:id=>timers.delete(id)});
 return {locator,requests,states,stateDetails,positions,timers};
}
const point=(accuracy=30)=>({coords:{latitude:39.94,longitude:116.42,accuracy}});
test('location is opt-in, accepts real coordinates and bounds cache/wait options',()=>{
 let clock=100000;const f=fixture({now:()=>clock});assert.equal(f.requests.length,0);f.locator.locate();assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.enableHighAccuracy,false);assert.equal(f.requests[0].options.timeout,10000);assert.equal(f.requests[0].options.maximumAge,120000);
 f.requests[0].success(point());assert.deepEqual(f.states,['requesting','located']);assert.equal(f.positions[0].latitude,39.94);assert.equal(f.positions[0].timestamp,clock);assert.equal(f.positions[0].source,'fresh');assert.equal(f.timers.size,0);
 clock+=60000;f.locator.locate();assert.equal(f.states.at(-1),'refreshing');assert.equal(f.positions.at(-1).source,'cached');assert.equal(f.positions.at(-1).timestamp,100000);f.requests[1].error({code:3});assert.equal(f.states.at(-1),'refresh_failed');assert.equal(f.stateDetails.at(-1).reason,'timeout');
 clock+=60001;f.locator.locate();assert.equal(f.states.at(-1),'requesting');assert.equal(f.positions.length,2);f.locator.cancel();
});
test('denied, unavailable and timed-out providers restore a recoverable state',()=>{
 for(const [code,phase] of [[1,'denied'],[2,'unavailable'],[3,'timeout']]){const f=fixture();f.locator.locate();f.requests[0].error({code});assert.equal(f.states.at(-1),phase);assert.equal(f.positions.length,0);assert.equal(f.timers.size,0);f.locator.locate();assert.equal(f.requests.length,2);}
});
test('watchdog separates permission wait, slow acquisition and bounded unsupported permission APIs',async()=>{
 const f=fixture();f.locator.locate();const slow=[...f.timers.values()].find(t=>t.ms===5000);slow.f();assert.equal(f.states.at(-1),'slow');const timer=[...f.timers.values()].find(t=>t.ms===30000);assert.ok(timer);timer.f();assert.equal(f.states.at(-1),'timeout');f.requests[0].success(point());assert.equal(f.positions.length,0);
 let clock=100000;const listeners=new Set();const permission={state:'prompt',addEventListener(_type,listener){listeners.add(listener);},removeEventListener(_type,listener){listeners.delete(listener);}};
 const p=fixture({getPermission:async()=>permission,now:()=>clock});p.locator.locate();await new Promise(setImmediate);assert.equal(p.states.at(-1),'awaiting_permission');assert.equal(p.requests.length,1);assert.equal([...p.timers.values()][0].ms,60000);assert.equal(listeners.size,1);
 clock+=20000;permission.state='granted';for(const listener of listeners)listener();assert.equal(p.states.at(-1),'requesting');assert.ok([...p.timers.values()].some(t=>t.ms===15000));p.requests[0].success(point());assert.equal(p.states.at(-1),'located');assert.equal(p.positions.length,1);assert.equal(listeners.size,0);assert.equal(p.timers.size,0);
 p.locator.locate();await new Promise(setImmediate);p.locator.cancel();assert.equal(listeners.size,0);assert.equal(p.timers.size,0);
});
test('manual browsing cancellation and retry ignore stale location callbacks',()=>{
 const f=fixture();f.locator.locate();f.locator.cancel();f.requests[0].success(point());assert.equal(f.positions.length,0);assert.equal(f.states.at(-1),'idle');
 f.locator.locate();f.locator.locate();f.requests[1].error({code:1});assert.equal(f.states.at(-1),'requesting');f.requests[2].success(point(3000));assert.equal(f.positions.length,1);assert.equal(f.positions[0].accuracy,3000);
});
test('insecure or unsupported browsers do not ask for location',()=>{
 for(const [options,phase] of [[{secure:false},'insecure'],[{provider:false},'unsupported']]){const f=fixture(options);f.locator.locate();assert.equal(f.states.at(-1),phase);assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);}
});
test('invalid provider output cannot move the map',()=>{
 for(const coords of [{latitude:NaN,longitude:116,accuracy:5},{latitude:91,longitude:116,accuracy:5},{latitude:39,longitude:181,accuracy:5},{latitude:39,longitude:116,accuracy:-1}]){const f=fixture();f.locator.locate();f.requests[0].success({coords});assert.equal(f.states.at(-1),'unavailable');assert.equal(f.positions.length,0);}
});
