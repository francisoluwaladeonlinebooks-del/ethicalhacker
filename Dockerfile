# ---------------------------------------------------------------------------
# FICAP production image
#
# Multi-stage build: dependencies, build, then a slim runtime. The runtime runs
# as a non-root user, carries no build tooling, and writes only to the data and
# cache directories that are declared as volumes.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build never needs a database: all pages resolve data at request time.
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    FICAP_DATA_DIR=/data/pglite \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S ficap && adduser -u 1001 -S ficap -G ficap \
 && mkdir -p /data/pglite && chown -R ficap:ficap /data /app

COPY --from=build --chown=ficap:ficap /app/.next ./.next
COPY --from=build --chown=ficap:ficap /app/node_modules ./node_modules
COPY --from=build --chown=ficap:ficap /app/package.json ./package.json
COPY --from=build --chown=ficap:ficap /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=ficap:ficap /app/public ./public
COPY --from=build --chown=ficap:ficap /app/scripts ./scripts
COPY --from=build --chown=ficap:ficap /app/src ./src
COPY --from=build --chown=ficap:ficap /app/tsconfig.json ./tsconfig.json

USER ficap
EXPOSE 3000
VOLUME ["/data"]

# The container starts only when the schema is present. Migrations are an
# explicit operator action, never an implicit side effect of serving traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
