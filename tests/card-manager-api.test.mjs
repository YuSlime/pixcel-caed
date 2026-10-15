import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={FormData,File,fetch}; context.globalThis=context;
vm.runInNewContext(fs.readFileSync(new URL('../data/card-manager-api.js',import.meta.url),'utf8'),context);
test('admin requests authenticate JSON actions, preserve image multipart and surface endpoint errors',async()=>{
  const requests=[];
  const api=new context.CardManagerApi(()=> 'secret',async(url,init)=>{requests.push(init);return {ok:true,json:async()=>({cards:[]})};});
  await api.request('list'); assert.equal(JSON.parse(requests[0].body).action,'list'); assert.equal(requests[0].headers['x-admin-key'],'secret');
  const form=new FormData(); form.append('source_file',new File(['original'],'source.png',{type:'image/png'}));
  await api.request('create-card',form); assert.equal(requests[1].body.get('action'),'create-card'); assert.equal(requests[1].body.get('source_file').size,8);
  const broken=new context.CardManagerApi(()=> 'secret',async()=>({ok:false,status:409,json:async()=>({error:'ID duplicate'})}));
  await assert.rejects(broken.request('list'),/ID duplicate/);
});
