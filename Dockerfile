# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.13.0 --activate

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter @nvs/api deploy --prod --legacy /opt/nvs-api

FROM node:24.18.0-bookworm-slim AS runtime

ARG NVS_BUILD_SHA=unknown
ARG NVS_BUILD_TIMESTAMP=unknown
ARG NVS_RELEASE_VERSION=0.1.0

LABEL org.opencontainers.image.title="NVS"
LABEL org.opencontainers.image.description="NILES Validation Suite control plane and operations console"
LABEL org.opencontainers.image.revision="${NVS_BUILD_SHA}"
LABEL org.opencontainers.image.created="${NVS_BUILD_TIMESTAMP}"
LABEL org.opencontainers.image.version="${NVS_RELEASE_VERSION}"

ENV NODE_ENV=production
ENV NVS_API_HOST=0.0.0.0
ENV NVS_API_PORT=4100
ENV NVS_CONFIG_DIR=/app/config
ENV NVS_DATA_DIR=/var/lib/nvs
ENV NVS_WEB_DIR=/app/web
ENV NVS_BUILD_SHA="${NVS_BUILD_SHA}"
ENV NVS_BUILD_TIMESTAMP="${NVS_BUILD_TIMESTAMP}"
ENV NVS_RELEASE_VERSION="${NVS_RELEASE_VERSION}"

RUN apt-get update \
    && apt-get install --no-install-recommends -y tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/api /app/config /app/web /var/lib/nvs \
    && chown -R node:node /app /var/lib/nvs

WORKDIR /app

COPY --from=build --chown=node:node /opt/nvs-api/package.json ./package.json
COPY --from=build --chown=node:node /opt/nvs-api/node_modules ./node_modules
COPY --from=build --chown=node:node /opt/nvs-api/dist ./api
COPY --from=build --chown=node:node /workspace/apps/web/dist ./web
COPY --from=build --chown=node:node /workspace/actors ./config/actors
COPY --from=build --chown=node:node /workspace/environments ./config/environments
COPY --from=build --chown=node:node /workspace/scenarios ./config/scenarios

USER node

EXPOSE 4100
VOLUME ["/var/lib/nvs"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/api/health/live',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "api/server.js"]
