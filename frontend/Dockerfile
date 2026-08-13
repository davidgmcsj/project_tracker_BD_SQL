# Imagen del frontend: compila el SPA de React y lo sirve con Nginx.
# Build en dos etapas — la imagen final NO lleva Node ni node_modules, solo
# los archivos estáticos compilados y Nginx.

# ── Etapa 1: compilar ─────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_API_URL se deja vacío a propósito: Nginx hace de proxy interno hacia
# el backend bajo el mismo origen (ver nginx.conf), así el navegador nunca
# ve una URL de backend distinta y no hay problema de CORS entre orígenes.
ARG VITE_API_KEY
ENV VITE_API_URL=""
ENV VITE_API_KEY=${VITE_API_KEY}
RUN npm run build

# ── Etapa 2: servir ───────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
