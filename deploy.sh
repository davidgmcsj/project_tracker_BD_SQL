#!/bin/bash
set -e

echo "==> Instalando dependencias..."
npm install --omit=dev

echo "==> Construyendo frontend..."
npm run build

echo "==> Deploy completo. El servidor arranca con 'node server.cjs'"
