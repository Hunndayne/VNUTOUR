// Actual StationRunPage + attendance panel, isolated API fixtures. Run in frontend.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../../', import.meta.url))
const page = fileURLToPath(new URL('../../src/StationRunPage.jsx', import.meta.url))
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import StationRunPage from ${JSON.stringify(page)};
const root=createRoot(document.getElementById('app'));
let fixture, failure=false, generation=0, attendanceCalls=0;
window.attendanceDiagnosticRequest=async path=>{
  if(path==='/my/checkin-qr') {
    attendanceCalls++;
    if(failure)throw new Error('Offline fixture');
    return JSON.parse(JSON.stringify(fixture));
  }
  if(path==='/my-team/stations') return {team_code:'TEST',stations:[],total_stations:0};
  if(path.startsWith('/my-team/station-state')) return {session:null,qr:{enabled:false}};
  throw new Error('Unexpected API '+path);
};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const text=()=>document.getElementById('app').textContent;
const qr=()=>!!document.querySelector('#app svg');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
function click(label){const button=[...document.querySelectorAll('#app button')].find(b=>b.textContent.includes(label));if(!button)throw Error('Missing '+label);button.click()}
async function mount(mode='individual'){
 failure=false;
 fixture={mode,enabled:true,payload:'fixture-not-a-real-qr',participant_name:'Nguyễn An',mssv:'SV001',team_code:'T0001',event_name:'Chạy trạm',checked_in:false,checked_out:false,checked_in_count:0,required_count:2,eligible:false};
 history.replaceState(null,'','/');
 root.render(<StationRunPage key={++generation} embedded/>);
 await delay(150);click('Điểm danh sự kiện');await delay(150);
}
async function refresh(){click('Làm mới trạng thái điểm danh');await delay(150)}
document.getElementById('run').onclick=async()=>{
 const output=document.getElementById('results');output.textContent='';
 document.getElementById('run').disabled=true;
 async function check(name,fn){try{await fn();output.textContent+='PASS: '+name+'\\n'}catch(e){output.textContent+='FAIL: '+name+' — '+e.message+'\\n'}}
 await check('Personal QR shows own identity and 0/2',async()=>{await mount();assert(qr(),'QR absent');assert(text().includes('Nguyễn An')&&text().includes('SV001'),'Identity absent');assert(text().includes('0/2'),'Count absent')});
 await check('Polling hides QR after this member checks in',async()=>{
   const before=attendanceCalls;fixture.checked_in=true;fixture.checked_in_count=1;delete fixture.payload;
   await delay(5400);assert(attendanceCalls>before,'No polling');assert(!qr(),'Old QR visible');assert(text().includes('Bạn đã check-in')&&text().includes('1/2'),'Personal attendance absent');
 });
 await check('Polling updates team eligibility when second member arrives',async()=>{
   fixture.checked_in_count=2;fixture.eligible=true;await delay(5400);
   assert(text().includes('2/2')&&text().includes('Đủ điều kiện'),'Threshold not refreshed');assert(!qr(),'Already scanned QR reappeared');
 });
 await check('Checkout hides QR and shows team closure',async()=>{await mount();fixture.checked_out=true;fixture.enabled=false;delete fixture.payload;await refresh();assert(!qr(),'Checkout QR still shown');assert(text().includes('Đội đã checkout'),'Checkout status absent')});
 await check('Team mode shows shared team QR copy',async()=>{await mount('team');assert(qr(),'Team QR absent');assert(text().includes('QR check-in đội'),'Wrong mode');assert(!text().includes('Nguyễn An'),'Personal identity in team QR');assert(!text().includes('0/2'),'Individual threshold in team mode')});
 await check('No threshold does not invent a one-member requirement',async()=>{await mount();fixture.required_count=0;fixture.eligible=true;await refresh();assert(!text().includes('0/1')&&!text().includes('Chưa đủ điều kiện'),'Invented threshold')});
 await check('Unavailable attendance removes previous QR',async()=>{await mount();fixture.enabled=false;delete fixture.payload;await refresh();assert(!qr(),'Unavailable QR remained');assert(text().includes('Chưa có QR điểm danh'),'Unavailable status absent')});
 await check('Failed refresh clears stale QR; retry restores current state',async()=>{await mount();failure=true;await refresh();assert(!qr(),'Stale QR visible offline');assert(text().includes('Chưa tải được'),'Error absent');failure=false;click('Thử lại');await delay(150);assert(qr(),'Retry failed')});
 output.textContent+='DONE\\n';document.getElementById('run').disabled=false;
};
mount();
`
const mocks = {
  './api.js': 'export const apiRequest=(...args)=>window.attendanceDiagnosticRequest(...args);export const logoutAndRedirect=()=>{};',
  './ui.jsx': 'export const Icon=()=>null;export const Badge=({label})=>label;',
  './FormResponses.jsx': 'export const MarkdownBlock=()=>null;export const InvisibleWatermark=()=>null;export const TrapPattern=()=>null;',
  './QuestionReview.jsx': 'export default function QuestionHistory(){return null};export const QuizSummary=()=>null;',
}
const result = await build({
  stdin:{contents:entry,resolveDir:frontend,loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',
  define:{'process.env.NODE_ENV':'"development"'},
  plugins:[{name:'attendance-fixtures',setup(builder){
    builder.onResolve({filter:/^\.\//},args=>{
      if(args.importer.replaceAll('\\','/')===page.replaceAll('\\','/')&&mocks[args.path])return{path:args.path,namespace:'fixture'}
    })
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:frontend}))
  }}],
})
const html='<!doctype html><html lang="vi"><meta charset="utf-8"><title>Attendance acceptance</title><style>body{font:16px system-ui;margin:24px}button{padding:12px;margin:5px;cursor:pointer}#results{white-space:pre-wrap;background:#eee;padding:15px}#app{border:1px solid #aaa;padding:15px;max-width:680px}svg{max-width:220px}</style><h1>Attendance acceptance</h1><p>Real participant page; fixture API; no live event data.</p><button id="run">Run attendance checks</button><pre id="results"></pre><div id="app"></div><script src="/bundle.js"></script></html>'
createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8')
  res.end(req.url==='/bundle.js'?result.outputFiles[0].contents:html)
}).listen(4179,'127.0.0.1',()=>console.log('Attendance diagnostic: http://127.0.0.1:4179'))
