# ---- build stage ----
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build

# ---- production dependencies ----
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force
RUN mkdir -p /data && chown 1000:1000 /data && chmod 700 /data

# ---- runtime: Node and required libraries, without npm or a shell ----
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:4e4fb0ce55fd73901600796ef079a9490369d2515d7da31633a91608c82ca13b
ENV NODE_ENV=production
ENV PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules
COPY package.json ./
COPY LICENSE ./
COPY server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --from=dependencies --chown=1000:1000 /data /data
ENV WEB_DIST=/app/web/dist
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
USER 1000:1000
EXPOSE 8300
ENTRYPOINT []
CMD ["node", "server/dist/start.js"]
