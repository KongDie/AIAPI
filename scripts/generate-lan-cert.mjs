import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasArg = (name) => args.includes(name);

const projectRoot = path.resolve(import.meta.dirname, '..');
const certRoot = path.join(projectRoot, 'certs');
const ipAddress = getArg('--ip') || getLanIPv4Addresses()[0];
const force = hasArg('--force');
const silent = hasArg('--silent');

if (!ipAddress) {
  throw new Error('未找到局域网 IPv4 地址。请手动指定：node scripts/generate-lan-cert.mjs --ip 192.168.1.X');
}

const safeIp = ipAddress.replace(/[^0-9A-Za-z_.-]/g, '_');
const certDir = path.join(certRoot, safeIp);
const keyPath = path.join(certDir, 'lan-server-key.pem');
const certPath = path.join(certDir, 'lan-server.pem');
const rootKeyPath = path.join(certDir, 'root-ca-key.pem');
const rootCertPath = path.join(certDir, 'phone-root-ca.cer');
const rootCertPemPath = path.join(certDir, 'phone-root-ca.pem');
const metadataPath = path.join(certDir, 'metadata.json');

if (!force && filesExist([keyPath, certPath, rootCertPath, rootCertPemPath, metadataPath])) {
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.ipAddress === ipAddress) {
      if (!silent) printResult('证书已存在且 IP 匹配');
      process.exit(0);
    }
  } catch {}
}

fs.mkdirSync(certDir, { recursive: true });
try {
  const rootKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serverKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = new Date();
  const rootNotAfter = addYears(now, 10);
  const serverNotAfter = addYears(now, 3);
  const rootSubject = `Customize Gemini Local Root ${ipAddress}`;
  const serverSubject = `Customize Gemini LAN ${ipAddress}`;

  const rootCertDer = createCertificate({
    subjectCn: rootSubject,
    issuerCn: rootSubject,
    subjectPublicKey: rootKeys.publicKey,
    issuerPrivateKey: rootKeys.privateKey,
    serial: randomBytes(16),
    notBefore: now,
    notAfter: rootNotAfter,
    isCa: true,
  });

  const serverCertDer = createCertificate({
    subjectCn: serverSubject,
    issuerCn: rootSubject,
    subjectPublicKey: serverKeys.publicKey,
    issuerPrivateKey: rootKeys.privateKey,
    serial: randomBytes(16),
    notBefore: now,
    notAfter: serverNotAfter,
    isCa: false,
    altNames: ['localhost', '127.0.0.1', ipAddress],
  });

  const serverKeyPem = serverKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rootKeyPem = rootKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const serverCertPem = pem('CERTIFICATE', serverCertDer);
  const rootCertPem = pem('CERTIFICATE', rootCertDer);

  fs.writeFileSync(keyPath, serverKeyPem, 'utf8');
  fs.writeFileSync(certPath, serverCertPem, 'utf8');
  fs.writeFileSync(rootKeyPath, rootKeyPem, 'utf8');
  fs.writeFileSync(rootCertPath, rootCertDer);
  fs.writeFileSync(rootCertPemPath, rootCertPem, 'utf8');
  fs.writeFileSync(metadataPath, JSON.stringify({
    ipAddress,
    generatedAt: new Date().toISOString(),
    keyPath,
    certPath,
    rootCertificatePath: rootCertPath,
    rootCertificatePemPath: rootCertPemPath,
  }, null, 2), 'utf8');

  if (!silent) printResult('证书已生成');
} catch (error) {
  fs.rmSync(certDir, { recursive: true, force: true });
  throw error;
}

function printResult(title) {
  console.log('');
  console.log(`${title}：${ipAddress}`);
  console.log(`  证书目录:   ${certDir}`);
  console.log(`  服务器证书: ${certPath}`);
  console.log(`  服务器私钥: ${keyPath}`);
  console.log(`  手机根证书: ${rootCertPath}`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 运行 npm.cmd start');
  console.log(`  2. 手机安装并信任 ${rootCertPath}`);
  console.log(`  3. 手机打开 https://${ipAddress}:3443`);
  console.log('');
}

function getLanIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((iface) => iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.'))
    .map((iface) => iface.address);
}

function filesExist(paths) {
  return paths.every((item) => fs.existsSync(item));
}

function addYears(date, years) {
  const copy = new Date(date);
  copy.setFullYear(copy.getFullYear() + years);
  return copy;
}

function createCertificate(options) {
  const signatureAlgorithm = algorithmIdentifier('1.2.840.113549.1.1.11');
  const tbs = seq(
    explicit(0, integer(Buffer.from([0x02]))),
    integer(positiveIntegerBytes(options.serial)),
    signatureAlgorithm,
    name(options.issuerCn),
    seq(time(options.notBefore), time(options.notAfter)),
    name(options.subjectCn),
    options.subjectPublicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions(options))
  );
  const signature = sign('RSA-SHA256', tbs, options.issuerPrivateKey);
  return seq(tbs, signatureAlgorithm, bitString(signature));
}

function extensions(options) {
  const items = [];
  if (options.isCa) {
    items.push(extension('2.5.29.19', true, seq(bool(true), integer(Buffer.from([0x01])))));
    items.push(extension('2.5.29.15', true, bitString(Buffer.from([0x06]), 1)));
  } else {
    items.push(extension('2.5.29.19', true, seq(bool(false))));
    items.push(extension('2.5.29.15', true, bitString(Buffer.from([0xa0]), 5)));
    items.push(extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))));
    items.push(extension('2.5.29.17', false, subjectAltName(options.altNames || [])));
  }
  return seq(...items);
}

function subjectAltName(names) {
  return seq(...names.map((value) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
      return der(0x87, Buffer.from(value.split('.').map(Number)));
    }
    return der(0x82, Buffer.from(value, 'ascii'));
  }));
}

function extension(id, critical, valueDer) {
  const parts = [oid(id)];
  if (critical) parts.push(bool(true));
  parts.push(octetString(valueDer));
  return seq(...parts);
}

function algorithmIdentifier(id) {
  return seq(oid(id), der(0x05, Buffer.alloc(0)));
}

function name(commonName) {
  return seq(set(seq(oid('2.5.4.3'), utf8(commonName))));
}

function time(date) {
  return der(0x18, Buffer.from(date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'), 'ascii'));
}

function positiveIntegerBytes(bytes) {
  const copy = Buffer.from(bytes);
  copy[0] &= 0x7f;
  return copy.some(Boolean) ? copy : Buffer.from([0x01]);
}

function integer(bytes) {
  return der(0x02, bytes);
}

function bool(value) {
  return der(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function oid(value) {
  const parts = value.split('.').map(Number);
  const first = 40 * parts[0] + parts[1];
  const body = [first];
  for (const part of parts.slice(2)) body.push(...base128(part));
  return der(0x06, Buffer.from(body));
}

function base128(value) {
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function utf8(value) {
  return der(0x0c, Buffer.from(value, 'utf8'));
}

function octetString(value) {
  return der(0x04, value);
}

function bitString(value, unusedBits = 0) {
  return der(0x03, Buffer.concat([Buffer.from([unusedBits]), Buffer.from(value)]));
}

function seq(...items) {
  return der(0x30, Buffer.concat(items.map(Buffer.from)));
}

function set(...items) {
  return der(0x31, Buffer.concat(items.map(Buffer.from)));
}

function explicit(tagNumber, value) {
  return der(0xa0 + tagNumber, value);
}

function der(tag, body) {
  return Buffer.concat([Buffer.from([tag]), length(body.length), Buffer.from(body)]);
}

function length(value) {
  if (value < 0x80) return Buffer.from([value]);
  const bytes = [];
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function pem(label, derBytes) {
  const base64 = Buffer.from(derBytes).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}
