export function apiErrorMessage(err: unknown, fallback = '请求失败') {
  const text = err instanceof Error ? err.message : '';
  if (
    err instanceof TypeError ||
    err instanceof SyntaxError ||
    /failed to fetch|networkerror|unexpected end of json/i.test(text)
  ) {
    return '连不上后端（端口 8000）。请先启动 uvicorn 再上传。';
  }
  return text || fallback;
}
