FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY *.mjs ./
RUN node verify_local_imports.mjs && node --check monitor.mjs && node --check probe.mjs && node --check parser.mjs
ENV TZ=Asia/Seoul NODE_ENV=production
CMD ["node", "monitor.mjs"]
