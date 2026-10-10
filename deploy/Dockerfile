FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/mock-data/package.json packages/mock-data/package.json
RUN npm ci
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=3001 SQLITE_PATH=/data/siteguard.sqlite NODE_ENV=production HOSTED=true
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","run","start"]
