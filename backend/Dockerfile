# AcadHost — Backend API Server Dockerfile
# Used by docker-compose.yml for development only.
# In production the backend runs natively on the Ubuntu VM.
# Distinct from backend/templates/* which are Dockerfile templates
# for student project containers.

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
