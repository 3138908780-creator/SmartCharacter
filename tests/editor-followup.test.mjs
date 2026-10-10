import test from 'node:test';
import assert from 'node:assert/strict';
import {ImportApproval} from '../lib/import-approval.ts';
import {writeDraftBeforeReload,readDraftBackup,newestDraft} from '../lib/project-draft.ts';
test('continue choosing bypasses only the approved import, and later edits or cancellation restore protection',()=>{
 const approval=new ImportApproval();approval.allow('video',4);
 assert.equal(approval.permits('video',4),true);assert.equal(approval.permits('srt',4),false);assert.equal(approval.permits('video',5),false);
 // A failed file preserves the old project and the same selection flow.
 assert.equal(approval.permits('video',4),true);approval.clear();assert.equal(approval.permits('video',4),false);
});
test('reload backup keeps the latest in-progress text and supersedes an older IndexedDB draft',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const current={payload:'{"version":7}',dirty:true,savedAt:200,editing:{cueId:'a',text:'刚刚修改'}};
 writeDraftBeforeReload(current,storage);assert.deepEqual(readDraftBackup(storage),current);
 assert.deepEqual(newestDraft({...current,savedAt:100},readDraftBackup(storage)),current);
 assert.deepEqual(newestDraft({...current,savedAt:300},readDraftBackup(storage)),{...current,savedAt:300});
});
test('invalid or denied reload storage cannot replace a valid persistent draft',()=>{
 const stored={payload:'original',dirty:false,savedAt:100};
 for(const raw of ['not json','null','{"payload":1,"savedAt":200,"dirty":true}','{"payload":"wrong","savedAt":"200","dirty":true}'])assert.equal(readDraftBackup({getItem:()=>raw}),undefined);
 assert.equal(readDraftBackup({getItem:()=>{throw new Error('denied')}}),undefined);
 assert.equal(newestDraft(stored),stored);
});
