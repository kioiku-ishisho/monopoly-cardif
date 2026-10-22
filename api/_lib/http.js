// API 共用工具

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const STAGES = ['youth', 'middle', 'elder'];
export const KINDS = ['chance', 'fate'];
export const GAME_ID = /^[0-9a-f]{32}$/;
export const PLAYER_ID = /^[0-9a-f-]{36}$/;
export const CARD_ID = /^[YMO][1-6]-\d{2}$/;

// 包裝 handler：只接受指定的 HTTP 方法、解析 body、統一錯誤格式
function methodHandler(method, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      const result = await fn(req, body);
      return res.status(200).json(result);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.code });
      console.error(e);
      return res.status(500).json({ error: 'server_error' });
    }
  };
}

export const postHandler = (fn) => methodHandler('POST', fn);
export const getHandler = (fn) => methodHandler('GET', fn);
