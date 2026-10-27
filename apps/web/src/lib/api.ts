import { KimoClient } from '@kimo/client';
import { readPublicApiConfig } from './api-config';
// Lazy configuration avoids failing unrelated static imports at build time.
// This credential-free facade never captures incoming SSR headers.
function client(): KimoClient {
  const config = readPublicApiConfig();
  return new KimoClient(config.apiBase, undefined, {
    wsOrigin: config.wsOrigin,
  });
}
export const api = {
  get base() {
    return client().base;
  },
  uploads: (...args: Parameters<KimoClient['uploads']>) =>
    client().uploads(...args),
  completeUpload: (...args: Parameters<KimoClient['completeUpload']>) =>
    client().completeUpload(...args),
  createSession: (...args: Parameters<KimoClient['createSession']>) =>
    client().createSession(...args),
  session: (...args: Parameters<KimoClient['session']>) =>
    client().session(...args),
  message: (...args: Parameters<KimoClient['message']>) =>
    client().message(...args),
  ops: (...args: Parameters<KimoClient['ops']>) => client().ops(...args),
  approve: (...args: Parameters<KimoClient['approve']>) =>
    client().approve(...args),
  render: (...args: Parameters<KimoClient['render']>) =>
    client().render(...args),
  video: (...args: Parameters<KimoClient['video']>) => client().video(...args),
  renderFrameUrl: (...args: Parameters<KimoClient['renderFrameUrl']>) =>
    client().renderFrameUrl(...args),
  cancelRender: (...args: Parameters<KimoClient['cancelRender']>) =>
    client().cancelRender(...args),
  reopenSession: (...args: Parameters<KimoClient['reopenSession']>) =>
    client().reopenSession(...args),
  reconcile: (...args: Parameters<KimoClient['reconcile']>) =>
    client().reconcile(...args),
  edit: (...args: Parameters<KimoClient['edit']>) => client().edit(...args),
  connect: (...args: Parameters<KimoClient['connect']>) =>
    client().connect(...args),
} satisfies Pick<KimoClient, keyof KimoClient>;
