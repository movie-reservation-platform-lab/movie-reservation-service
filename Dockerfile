# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=production-dependencies /workspace/node_modules node_modules
COPY --from=build /workspace/package.json package.json
COPY --from=build /workspace/dist dist

EXPOSE 3000

CMD ["npm", "run", "start"]
