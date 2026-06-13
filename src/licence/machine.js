const crypto = require('crypto');
const os     = require('os');
const { execSync } = require('child_process');

let _cache = null;

function getMachineCode() {
  if (_cache) return _cache;

  let rawId = os.hostname();

  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 2000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/);
    if (m) rawId += '|' + m[1];
  } catch {
    // Fallback : première adresse MAC non-loopback
    for (const ifaces of Object.values(os.networkInterfaces())) {
      const mac = ifaces.find(i => !i.internal && i.mac !== '00:00:00:00:00:00');
      if (mac) { rawId += '|' + mac.mac; break; }
    }
  }

  _cache = crypto.createHash('sha256').update(rawId).digest('hex').slice(0, 8).toUpperCase();
  return _cache;
}

module.exports = { getMachineCode };
