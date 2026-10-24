// 讀取前端的 js/data.js 與 js/score.js（瀏覽器用的 IIFE，掛在 window 上），讓伺服器和遊戲使用同一份資料與計分標準
// vercel.json 的 includeFiles 會把這些檔案一起打包進 function
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const cache = {};

function loadWindow(file, key) {
  if (cache[key]) return cache[key];
  const code = readFileSync(join(process.cwd(), 'js', file), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: file, timeout: 1000 });
  cache[key] = sandbox.window[key];
  return cache[key];
}

export const gameData = () => loadWindow('data.js', 'GameData');
export const scoring = () => loadWindow('score.js', 'Score');
