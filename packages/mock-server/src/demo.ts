import { WebSocket } from 'ws';
const base = process.env.KIMO_API ?? 'http://localhost:8787';
const response = await fetch(base + '/v1/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'make a great video from these',
    assetIds: [],
    aspect: 'auto',
  }),
});
const raw: unknown = await response.json();
if (
  typeof raw !== 'object' ||
  raw === null ||
  !('wsUrl' in raw) ||
  typeof raw.wsUrl !== 'string'
)
  throw new Error('invalid session response');
const ws = new WebSocket(raw.wsUrl);
ws.on('message', (data) => {
  console.log(data.toString());
  if (data.toString().includes('ask_review')) ws.close();
});
ws.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
