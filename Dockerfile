# syntax=docker/dockerfile:1

ARG NODE_BUILD_IMAGE=node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:fbbdda866ea71aef98c4abece17e3d61fbf820cc2ef3961522caa2478716171a

FROM ${NODE_BUILD_IMAGE} AS build

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./
COPY packages/audit-sdk/package.json packages/audit-sdk/package.json

RUN npm ci

COPY . .

RUN npm run build:audit-sdk && npm run build

FROM ${NODE_BUILD_IMAGE} AS production-dependencies

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./
COPY packages/audit-sdk/package.json packages/audit-sdk/package.json

# Workspaces stay enabled so the service's exact-pinned audit SDK link and its runtime dependencies are installed.
RUN npm ci --omit=dev

FROM ${NODE_BUILD_IMAGE} AS runtime-layout

RUN mkdir /runtime-workspace && chown 65532:65532 /runtime-workspace

COPY --from=production-dependencies --chown=65532:65532 /workspace/node_modules /runtime-workspace/node_modules
COPY --from=build --chown=65532:65532 /workspace/package.json /runtime-workspace/package.json
COPY --from=build --chown=65532:65532 /workspace/dist /runtime-workspace/dist
# node_modules links the SDK here; contract/ holds the JSON Schema the SDK reads at runtime.
COPY --from=build --chown=65532:65532 /workspace/packages/audit-sdk/package.json /runtime-workspace/packages/audit-sdk/package.json
COPY --from=build --chown=65532:65532 /workspace/packages/audit-sdk/dist /runtime-workspace/packages/audit-sdk/dist
COPY --from=build --chown=65532:65532 /workspace/packages/audit-sdk/contract /runtime-workspace/packages/audit-sdk/contract

FROM ${NODE_BUILD_IMAGE} AS runtime-debug

COPY --from=runtime-layout --chown=node:node /runtime-workspace /workspace

WORKDIR /workspace
ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "--import", "./dist/src/infrastructure/observability/instrumentation.js", "dist/src/index.js"]

FROM ${NODE_RUNTIME_IMAGE} AS runtime

COPY --from=runtime-layout --chown=nonroot:nonroot /runtime-workspace /workspace

WORKDIR /workspace
ENV NODE_ENV=production

USER nonroot:nonroot

EXPOSE 3000

CMD ["--import", "./dist/src/infrastructure/observability/instrumentation.js", "dist/src/index.js"]
