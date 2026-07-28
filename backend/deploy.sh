#!/bin/bash
set -e

export NODE_ENV=production

echo "==> Instalando dependencias (npm ci: instala exactamente lo que hay en package-lock.json)..."
npm ci --omit=dev

echo "==> Construyendo frontend..."
npm run build

echo "==> Deploy completo. El servidor arranca con 'node server.cjs' (NODE_ENV=production)"
