import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox={window:{},setTimeout,clearTimeout};vm.runInNewContext(await readFile('public/geolocation.js','utf8'),sandbox);
const {createLocator}=sandbox.window.FOOD_GEO;
function fixture({secure=true,provider=true}={}){
 const requests=[],states=[],positions=[],timers=new Map();let next=0;
 const geo={getCurrentPosition(success,error,options){requests.push({success,error,options});}};
 const locator=createLocator({getProvider:()=>provider?geo:null,isSecure:()=>secure,onState:s=>states.push(s.phase),onPosition:p=>positions.push(p),setTimer:(f,ms)=>{const id=++next;timers.set(id,{f,ms});return id;},clearTimer:id=>timers.delete(id)});
 return {locator,requests,states,positions,timers};
}
const point=(accuracy=30)=>({coords:{latitude:39.94,longitude:116.42,accuracy}});
test('location is opt-in, accepts real coordinates and bounds cache/wait options',()=>{
 const f=fixture();assert.equal(f.requests.length,0);f.locator.locate();assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.enableHighAccuracy,false);assert.equal(f.requests[0].options.timeout,10000);assert.equal(f.requests[0].options.maximumAge,30000);
 f.requests[0].success(point());assert.deepEqual(f.states,['requesting','located']);assert.equal(f.positions[0].latitude,39.94);assert.equal(f.timers.size,0);
});
test('denied, unavailable and timed-out providers restore a recoverable state',()=>{
 for(const [code,phase] of [[1,'denied'],[2,'unavailable'],[3,'timeout']]){const f=fixture();f.locator.locate();f.requests[0].error({code});assert.equal(f.states.at(-1),phase);assert.equal(f.positions.length,0);assert.equal(f.timers.size,0);f.locator.locate();assert.equal(f.requests.length,2);}
});
test('watchdog recovers if permission prompt or provider never finishes',()=>{
 const f=fixture();f.locator.locate();const timer=[...f.timers.values()][0];assert.equal(timer.ms,15000);timer.f();assert.equal(f.states.at(-1),'timeout');f.requests[0].success(point());assert.equal(f.positions.length,0);
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
