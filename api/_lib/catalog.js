// 讀取前端的 js/data.js（瀏覽器用的 IIFE，掛在 window.GameData），讓伺服器和遊戲使用同一份險種資料
// vercel.json 的 includeFiles 會把 js/data.js 一起打包進 function
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

let cached;

export function gameData() {
  if (cached) return cached;
  const code = readFileSync(join(process.cwd(), 'js', 'data.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'data.js', timeout: 1000 });
  cached = sandbox.window.GameData;
  return cached;
}
