// Diagnostic only: real StationRunPage/React rendering, deterministic API fixtures.
// Run from frontend: node tests/diagnostics/station-replay-harness.mjs
// Open http://127.0.0.1:4178 and click Run frontend checks. No live API is used.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../../', import.meta.url))
const page = fileURLToPath(new URL('../../src/StationRunPage.jsx', import.meta.url))
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import StationRunPage from ${JSON.stringify(page)};
const root = createRoot(document.getElementById('app'));
let fixture, generation = 0, calls = [];
const clone = x => JSON.parse(JSON.stringify(x));
const session = (id, status) => ({station_id:id, status, entered_at:'2026-09-15T00:00:00Z'});
function setup(mode) {
  const all = !['incomplete','off'].includes(mode);
  const reason = mode==='passed'?'passed':mode==='exhausted'?'attempts_exhausted':mode==='pending'?'pending_result':mode==='incomplete'?'incomplete':null;
  fixture = {
    all, enabled: mode !== 'off',
    stations: [1,2].map(id => ({station_id:id, station_code:id===1?'A':'B', station_name:id===1?'Trạm A':'Trạm B',
      checkin_policy:'staff_scan',has_form:false,capacity:{current_teams:0},
      visit_count:id===1||all?1:0,best_score:0,scoring_mode:'pass_fail',
      status:id===1?(mode==='passed'?'passed':'failed'):(all?'passed':'not_visited'),
      my_session:id===1||all?session(id,'closed'):null,
      attempts_used:id===1?(mode==='exhausted'?3:1):(all?1:0),max_attempts:3,
      attempts_remaining:id===1?(mode==='exhausted'?0:2):(all?2:3),
      can_replay:id===1?!reason:false,replay_locked:id===1?!!reason:false,
      replay_reason:id===1?reason:null})),
    sessions: {1:session(1,'closed'),2:all?session(2,'closed'):null}
  };
  calls=[];
  history.replaceState(null,'','/');
  root.render(<StationRunPage key={++generation} embedded />);
}
window.replayDiagnosticRequest = async path => {
  calls.push(path);
  document.getElementById('calls').textContent = JSON.stringify(calls,null,2);
  if(path==='/my-team/stations') return clone({team_code:'TEST',replay_enabled:fixture.enabled,replay_after_all:fixture.enabled,all_visited:fixture.all,
    visited_count:fixture.all?2:1,total_stations:2,passed_count:0,stations:fixture.stations});
  if(path.startsWith('/my-team/station-state')) {
    const id=Number(new URL(path,'http://local').searchParams.get('station_id'));
    const station=fixture.stations.find(s=>s.station_id===id);
    return clone({team_code:'TEST',station_id:id||null,
      ...(station?{can_replay:station.can_replay,replay_locked:station.replay_locked,replay_reason:station.replay_reason,
        attempts_used:station.attempts_used,max_attempts:station.max_attempts,attempts_remaining:station.attempts_remaining,
        replay_after_all:fixture.enabled,all_visited:fixture.all}:{}),
      session:id?fixture.sessions[id]:Object.values(fixture.sessions).find(s=>s?.status==='active')||null,
      submission:null,qr:{enabled:true,payload:'diagnostic-only-qr',direction:'in'}});
  }
  throw Error('Unexpected request '+path);
};
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const buttons = () => [...document.querySelectorAll('#app button')];
const button = text => buttons().find(b=>b.textContent.includes(text));
const click = text => {const b=button(text);if(!b)throw Error('Missing button: '+text);b.click();};
const replay = () => !!button('Chơi lại trạm này');
const assert = (condition,message) => {if(!condition)throw Error(message);};
async function mount(mode) { setup(mode);await delay(150);click('Trạm A');await delay(150); }
function completeB() {
  fixture.all=true;
  fixture.stations[0].replay_locked=false;fixture.stations[0].replay_reason=null;
  fixture.stations[0].can_replay=true;
  fixture.stations[1].status='passed';fixture.stations[1].visit_count=1;
  fixture.stations[1].my_session=session(2,'closed');fixture.sessions[2]=session(2,'closed');
}
document.getElementById('run').onclick = async () => {
  const output=document.getElementById('results');output.textContent='';
  document.getElementById('run').disabled=true;
  async function check(name,fn){try{await fn();output.textContent+='PASS: '+name+'\\n';}catch(e){output.textContent+='FAIL: '+name+' — '+e.message+'\\n';}}
  await check('Fresh all-visited + failed A shows Replay and entry QR after click',async()=>{
    await mount('complete');assert(replay(),'Replay hidden');click('Chơi lại trạm này');await delay(100);
    assert(!replay(),'Still on closed screen');assert(!!document.querySelector('#app svg'),'Entry QR missing');
  });
  await check('Incomplete journey hides Replay',async()=>{await mount('incomplete');assert(!replay(),'Replay allowed too early');});
  await check('Passed A stays locked after all stations visited',async()=>{await mount('passed');assert(!replay(),'Passed station replayed');});
  await check('Replay becomes available via polling after server completes last station',async()=>{
    await mount('incomplete');completeB();const before=calls.length;await delay(2400);
    assert(calls.length>before,'Polling did not run');
    assert(replay(),'Replay still hidden; list requests='+calls.filter(p=>p==='/my-team/stations').length);
  });
  await check('Returning to list refreshes rights and lets A reopen',async()=>{
    await mount('incomplete');completeB();
    click('Chọn trạm tiếp theo');await delay(150);click('Trạm A');await delay(150);assert(replay(),'Still hidden after list refresh');
  });
  await check('Normal A -> enter B -> exit B -> list -> A allows Replay',async()=>{
    await mount('incomplete');click('Chọn trạm tiếp theo');await delay(150);click('Trạm B');await delay(150);
    fixture.sessions[2]=session(2,'active');fixture.stations[1].my_session=session(2,'active');
    await delay(2200);completeB();await delay(2200);
    click('Chọn trạm tiếp theo');await delay(150);click('Trạm A');await delay(150);assert(replay(),'Normal loop blocks replay');
  });
  await check('Switch off allows retry of failed A before visiting B',async()=>{
    await mount('off');assert(replay(),'Replay hidden despite fresh permission');
  });
  await check('Total 3 attempts exhausted hides Replay',async()=>{
    await mount('exhausted');assert(!replay(),'Fourth attempt offered');
    assert(document.querySelector('#app').textContent.includes('lượt'),'Attempt limit message missing');
  });
  await check('Pending result hides Replay',async()=>{
    await mount('pending');assert(!replay(),'Pending attempt replayed');
  });
  await check('Fresh passed result revokes an already armed entry QR',async()=>{
    await mount('complete');click('Chơi lại trạm này');await delay(100);
    fixture.stations[0].replay_locked=true;fixture.stations[0].replay_reason='passed';fixture.stations[0].can_replay=false;
    await delay(2400);assert(!replay(),'Replay still offered after pass');
    assert(!document.querySelector('#app svg'),'Entry QR still visible after pass');
    fixture.stations[0].replay_locked=false;fixture.stations[0].replay_reason=null;fixture.stations[0].can_replay=true;
    await delay(2400);assert(replay(),'Replay not restored after corrected verdict');
    assert(!document.querySelector('#app svg'),'Entry QR automatically returned without another click');
  });
  await check('Checkout of replay never automatically displays entry QR again',async()=>{
    await mount('complete');click('Chơi lại trạm này');await delay(100);
    fixture.sessions[1]=session(1,'active');await delay(2200);
    fixture.sessions[1]=session(1,'closed');await delay(2200);
    assert(replay(),'Replay action missing after checkout');assert(!document.querySelector('#app svg'),'Entry QR reopened without a click');
  });
  output.textContent+='DONE\\n';document.getElementById('run').disabled=false;
};
setup('complete');
`
const mocks = {
  './api.js': 'export const apiRequest = (...args) => window.replayDiagnosticRequest(...args); export const logoutAndRedirect = () => {};',
  './ui.jsx': 'export const Icon=()=>null; export const Badge=({label})=>label;',
  './FormResponses.jsx': 'export const MarkdownBlock=()=>null; export const InvisibleWatermark=()=>null; export const TrapPattern=()=>null;',
  './QuestionReview.jsx': 'export default function QuestionHistory(){return null}; export const QuizSummary=()=>null;',
}
const result = await build({
  stdin: {contents:entry,resolveDir:frontend,loader:'jsx'},bundle:true,write:false,
  jsx:'automatic',platform:'browser',define:{'process.env.NODE_ENV':'"development"'},
  plugins:[{name:'station-only-fixtures',setup(builder){
    builder.onResolve({filter:/^\.\//},args => {
      if(args.importer.replaceAll('\\','/')===page.replaceAll('\\','/') && mocks[args.path]) return {path:args.path,namespace:'fixture'};
    });
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:frontend}));
  }}],
})
const html = '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Station replay frontend diagnostic</title><style>body{font:16px system-ui;margin:24px}button{padding:12px;margin:5px;cursor:pointer}#results{white-space:pre-wrap;background:#eee;padding:15px}#app{border:1px solid #aaa;padding:15px;max-width:680px}svg{max-width:200px}#calls{max-height:160px;overflow:auto}</style><h1>Station replay frontend diagnostic</h1><p>Real StationRunPage; isolated API fixtures. No live data.</p><button id="run">Run frontend checks</button><pre id="results"></pre><div id="app"></div><details><summary>API fixture requests</summary><pre id="calls"></pre></details><script src="/bundle.js"></script></html>'
createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(req.url==='/bundle.js'?result.outputFiles[0].contents:html);
}).listen(4178,'127.0.0.1',()=>console.log('Diagnostic: http://127.0.0.1:4178'))
