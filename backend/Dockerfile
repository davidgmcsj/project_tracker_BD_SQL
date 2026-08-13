# Imagen del backend (Node/Express). El servidor de destino solo necesita
# Docker instalado — Node y las dependencias viajan dentro de la imagen.
FROM node:20-alpine

WORKDIR /app

# Copiar primero solo los manifiestos aprovecha la cache de capas de Docker:
# si package.json no cambia, "npm ci" no se vuelve a ejecutar en el siguiente build.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# HOME=/home activa la misma ruta de datos persistentes que ya usa el código
# para Azure App Service (ver backend/lib/json-store.cjs) — la reutilizamos
# aquí para no tocar código: data.json y history.json quedan en /home/data.
ENV HOME=/home
RUN mkdir -p /home/data

EXPOSE 3002

CMD ["node", "server.cjs"]
