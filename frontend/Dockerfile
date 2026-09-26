FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The browser reaches Django through the Nginx reverse proxy by default.
ARG VITE_API_BASE_URL=/api
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

RUN npm run build

FROM nginx:1.30.4-alpine AS runtime

# The base image ships libuuid 2.42.1-r0. Alpine 2.42.3-r1 fixes the seven
# HIGH CVEs reported by Trivy (including CVE-2026-78408).
# It also ships libexpat 2.8.4-r0; 2.8.5-r0 fixes CVE-2026-93990 (HIGH).
RUN apk add --no-cache --upgrade "libuuid>=2.42.3-r1" "libexpat>=2.8.5-r0"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
