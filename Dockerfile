# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./
COPY ecs-infra/package.json ecs-infra/package.json
COPY movie-reservation-service/package.json movie-reservation-service/package.json

RUN npm ci

COPY movie-reservation-service movie-reservation-service

RUN npm -w movie-reservation-service run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/movie-reservation-service/package.json movie-reservation-service/package.json
COPY --from=build /workspace/movie-reservation-service/dist movie-reservation-service/dist
COPY --from=build /workspace/movie-reservation-service/env_files/templates movie-reservation-service/env_files/templates

WORKDIR /workspace/movie-reservation-service
EXPOSE 3000

CMD ["npm", "run", "start"]
