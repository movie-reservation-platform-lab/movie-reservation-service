# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./
COPY movie-reservation-service/package.json movie-reservation-service/package.json

RUN npm ci \
    --workspace=movie-reservation-service \
    --include-workspace-root=false

COPY movie-reservation-service movie-reservation-service

RUN npm -w movie-reservation-service run build

FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./
COPY movie-reservation-service/package.json movie-reservation-service/package.json

RUN npm ci \
    --omit=dev \
    --workspace=movie-reservation-service \
    --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=production-dependencies /workspace/node_modules node_modules
COPY --from=build /workspace/movie-reservation-service/package.json movie-reservation-service/package.json
COPY --from=build /workspace/movie-reservation-service/dist movie-reservation-service/dist

WORKDIR /workspace/movie-reservation-service
EXPOSE 3000

CMD ["npm", "run", "start"]
