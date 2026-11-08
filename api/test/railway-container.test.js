import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const apiDockerfile = new URL('../Dockerfile', import.meta.url);
const webDockerfile = new URL('../../web/Dockerfile', import.meta.url);
const backendEnv = new URL('../../web/15-backend-port.envsh', import.meta.url);
const nginxTemplate = new URL('../../web/nginx.conf.template', import.meta.url);

test('Railway accepts every API Dockerfile stage without a VOLUME instruction', () => {
  assert.doesNotMatch(fs.readFileSync(apiDockerfile, 'utf8'), /^\s*VOLUME\b/im);
});

function configuredPorts(env) {
  // A clean environment ensures developer machine settings cannot mask fallback behavior.
  return execFileSync('/bin/sh', ['-c', '. "$1"; printf "%s,%s,%s" "$BACKEND_PORT" "$PORT" "$NGINX_PORT"', 'sh', backendEnv.pathname], { env, encoding: 'utf8' });
}

test('backend port defaults retain Docker Compose and custom API port compatibility', () => {
  assert.equal(configuredPorts({}), '3000,,');
  assert.equal(configuredPorts({ PORT: '4567', NGINX_PORT: '80' }), '4567,4567,80');
});

test('Railway can use its listener PORT independently of the private API port', () => {
  assert.equal(configuredPorts({ PORT: '8080', NGINX_PORT: '8080', BACKEND_PORT: '3000' }), '3000,8080,8080');
  const template = fs.readFileSync(nginxTemplate, 'utf8');
  assert.equal(template.match(/http:\/\/\$\{BACKEND\}:\$\{BACKEND_PORT\}/g)?.length, 2, 'ordinary API and media uploads share the private port');
  assert.doesNotMatch(template, /\$\{BACKEND\}:\$\{PORT\}/);
  assert.match(fs.readFileSync(webDockerfile, 'utf8'), /COPY --chmod=755 web\/15-backend-port\.envsh \/docker-entrypoint\.d\//);
});
