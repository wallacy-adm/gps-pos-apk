const p = require('@expo/config-plugins');
const keys = Object.keys(p).filter(k => k.toLowerCase().includes('mod') || k.toLowerCase().includes('danger') || k.toLowerCase().includes('android'));
console.log(keys.join('\n'));
