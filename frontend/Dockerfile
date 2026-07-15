# Build the Vite SPA, then serve the static bundle with nginx.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Canonical/OG absolute URLs are baked at build time. Override per-env via build arg.
ARG VITE_SITE_URL=https://sydekyks.ai
ENV VITE_SITE_URL=$VITE_SITE_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
