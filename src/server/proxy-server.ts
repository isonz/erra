import httpProxy from 'http-proxy';
import https from 'https';
import http from 'http';
import net from 'net';
import URL from 'url';
import fs from 'fs';
import os from 'os';
import pem from 'pem';
import path from 'path';
import LRU from 'lru-cache';
import { createSecureContext } from 'tls';
import { promisify } from 'es6-promisify';
import ip from 'ip';

const certCache = new LRU({
  max: 500,
  maxAge: 1000 * 60 * 60,
})

let beforeProxyReqHandler: (req, resp) => Promise<void> = async () => {}

const proxy = httpProxy.createProxyServer({ ws: true })
proxy.on('error', function (err, req, res) {
  console.error(err);
  res.writeHead(500, { 'Content-Type': 'text/plain;charset=utf-8' });
  res.end('请检查目标服务和Erra是否正常工作。\n' + err.toString());
});

const fsReadFile = promisify(fs.readFile);
const pemCreateCertificate = promisify(pem.createCertificate);

async function getRootCert() {
  const cacheKey = 'root-cert'

  if (certCache.has(cacheKey)) return certCache.get(cacheKey)

  const rootCert = {
    cert: await fsReadFile(path.resolve(os.homedir(), '.erra/erra.crt.pem'), {
      encoding: 'utf-8',
    }),
    key: await fsReadFile(path.resolve(os.homedir(), '.erra/erra.key.pem'), {
      encoding: 'utf-8',
    }),
  }

  certCache.set(cacheKey, rootCert);
  return rootCert;
}

async function createCert(host) {
  if (certCache.has(host)) return certCache.get(host)

  const root = await getRootCert();
  const res = await pemCreateCertificate({
    altNames: [host],
    commonName: host,
    days: 365,
    serviceCertificate: root.cert,
    serviceKey: root.key,
  });

  const cert = {
    cert: res.certificate,
    key: res.clientKey,
  }
  certCache.set(host, cert);

  return cert;
}

async function httpHandler(req, resp) {
  try {
    const url = URL.parse(req.url)

    await beforeProxyReqHandler(req, resp)

    proxy.web(req, resp, {
      target: `${url.protocol || 'https:'}//${req.headers.host}`,
      secure: false,
      ws: true,
    });
  } catch (err) {
    console.error(err);
    resp.writeHead(500, { 'Content-Type': 'text/plain;charset=utf-8' });
    resp.end(err.toString());  
  }
}

async function run({ httpPort, httpsPort }) {
  const serverCrt = await createCert('internal_https_server');

  const httpsServer = https.createServer({
    SNICallback: (servername, cb) => {
      createCert(servername).then(({ cert, key }) => {
        cb(null, createSecureContext({ cert, key }));
      });
    },
    cert: serverCrt.cert,
    key: serverCrt.key,
  }, httpHandler);

  const httpServer = http.createServer(httpHandler)
  httpServer.on('connect', (req, socket, head) => {
    let proxyPort = httpPort;
    // todo: connect请求时 如何判断连到的目标机器是不是https协议？
    const [, targetPort] = req.url.split(':');
    if (targetPort === '443') {
      proxyPort = httpsPort;
    }

    try {
      const conn = net.connect(proxyPort, '127.0.0.1', () => {
        socket.write('HTTP/' + req.httpVersion + ' 200 OK\r\n\r\n', 'UTF-8', () => {
          conn.pipe(socket);
          socket.pipe(conn);
        });
      });
    } catch (err) {
      console.error(err);
    }
  })

  // 简单转发，暂不考虑断点、编辑ws请求
  httpServer.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head, { target: `ws://${req.headers.host}`});
  });

  httpServer.listen(httpPort, '0.0.0.0', () => {
    console.log(`本地代理服务已启动，http_proxy=http://${ip.address()}:${httpPort}`);
  });
  httpsServer.listen(httpsPort, '0.0.0.0');
}

export default {
  run,
  beforeProxyReq(handler) {
    beforeProxyReqHandler = handler
  },
  afterProxyResp(handler) {
    proxy.on('proxyRes', handler)
  }
}