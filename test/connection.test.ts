import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection } from '../src/connection.ts';

const settings = {provider:'openai', model:'gpt-image-1', baseURL:'https://images.example/v1/', apiKey:'secret'};

test('connection check verifies auth and exact model without generating', async()=>{
  let request:any;
  const result=await checkConnection(settings as any, async (url:any, init:any)=>{
    request={url,init};
    return new Response(JSON.stringify({id:'gpt-image-1'}),{status:200,headers:{'content-type':'application/json'}});
  });
  assert.deepEqual(result,{ok:true,code:'CONNECTED',model:'gpt-image-1'});
  assert.equal(request.url,'https://images.example/v1/models/gpt-image-1');
  assert.equal(request.init.method,undefined);
  assert.equal(request.init.body,undefined);
  assert.equal(request.init.headers.Authorization,'Bearer secret');
});

test('connection check classifies credentials, auth, unsupported query and mock', async()=>{
  assert.equal((await checkConnection({...settings,apiKey:''} as any, fetch)).code,'CREDENTIAL_NOT_CONFIGURED');
  for(const [status,code] of [[401,'AUTH_FAILED'],[404,'MODEL_OR_ENDPOINT_UNAVAILABLE'],[429,'RATE_LIMITED']] as const) {
    assert.equal((await checkConnection(settings as any, async()=>new Response('',{status}) as any)).code,code);
  }
  assert.deepEqual(await checkConnection({...settings,provider:'mock',model:'mock-v1'} as any),{ok:true,code:'MOCK_READY',model:'mock-v1'});
  assert.equal((await checkConnection({...settings,provider:'mock'} as any)).code,'INVALID_MODEL');
});
