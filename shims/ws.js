/**
 * ws shim para React Native
 *
 * O pacote `ws` é uma implementação WebSocket para Node.js.
 * React Native tem WebSocket nativo global — não precisa do ws.
 * O @supabase/realtime-js verifica `globalThis.WebSocket` primeiro;
 * se existir, não usa ws. Mas o Metro tenta empacotar o require('ws')
 * mesmo assim — este shim redireciona para o WebSocket nativo do RN.
 */

/* global WebSocket */

// Garante que o shim exporta o WebSocket nativo do React Native
const WS = typeof WebSocket !== 'undefined' ? WebSocket : global.WebSocket;

module.exports = WS;
module.exports.WebSocket = WS;
module.exports.default = WS;
module.exports.createWebSocketStream = () => {
  throw new Error('createWebSocketStream not supported in React Native');
};
module.exports.Server = class {
  constructor() {
    throw new Error('WebSocket.Server not supported in React Native');
  }
};
