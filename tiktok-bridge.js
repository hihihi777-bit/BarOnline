'use strict';
// Local-only TikTok LIVE comment bridge. Community connector, not an official TikTok API.
const http = require('node:http');
const { WebcastPushConnection } = require('tiktok-live-connector');
const username = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const port = Number(process.env.BRIDGE_PORT || 17345);
if (!/^[\w.]{2,40}$/.test(username)) {
  console.error('Set TIKTOK_USERNAME to your TikTok LIVE username (without @).');
  process.exit(1);
}
const queue = [];
let nextId = 0, status = 'Đang kết nối TikTok...', lastError = '', connected = false;
const seen = new Map();
function cleanup() { const now = Date.now(); for (const [k,v] of seen) if (now-v>120000) seen.delete(k); }
function handleComment(data) {
  const comment = String(data.comment || '').trim();
  if (!/^up$/i.test(comment)) return;
  const userId = String(data.userId || data.uniqueId || '').slice(0, 100);
  const uniqueId = String(data.uniqueId || '').replace(/^@/, '').slice(0, 50);
  const name = String(data.nickname || uniqueId || 'Khách').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0, 36);
  if (!userId || !name) return;
  cleanup();
  if (seen.has(userId)) return; // max one join per user per 2 minutes
  seen.set(userId, Date.now());
  queue.push({ id: ++nextId, name, uniqueId, at: Date.now() });
  if (queue.length > 250) queue.shift();
  console.log('JOIN', uniqueId, name);
}
const server = http.createServer((req,res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // read-only localhost endpoint; no secret data
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const url = new URL(req.url, 'http://localhost');
  if(req.method!=='GET' || url.pathname!=='/events'){res.writeHead(404);return res.end('Not found');}
  const after = Math.max(0,Number(url.searchParams.get('after'))||0);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({connected,status,lastError,latestId:nextId,events:queue.filter(e=>e.id>after).slice(0,100)}));
});
server.listen(port,'127.0.0.1',()=>console.log(`Local bridge: http://127.0.0.1:${port}/events`));
const connection = new WebcastPushConnection(username);
let retryTimer;
async function connect(){
  try { status='Đang kết nối @'+username; await connection.connect(); connected=true; status='Đã kết nối LIVE @'+username; lastError=''; console.log(status); }
  catch(e){ connected=false; lastError=String(e.message||e);status='Chưa kết nối được LIVE';console.error(lastError);clearTimeout(retryTimer);retryTimer=setTimeout(connect,15000); }
}
connection.on('chat',handleComment);
connection.on('disconnected',()=>{connected=false;status='TikTok mất kết nối, đang thử lại';clearTimeout(retryTimer);retryTimer=setTimeout(connect,10000);});
connection.on('error',e=>{lastError=String(e.message||e);console.error('TikTok:',lastError);});
connect();
