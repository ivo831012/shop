#!/bin/sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Няма инсталиран Node.js. Изтеглете версия 22 или по-нова от https://nodejs.org"; exit 1; }
npm install && npm run build:server && npm run seed && echo "Отворете http://localhost:3000" && npm start
