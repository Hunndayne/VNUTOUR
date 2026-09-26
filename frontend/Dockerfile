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

# Upgrade the runtime libraries to the first Alpine releases containing the
# fixes required by the Trivy gate. Keep explicit minimum versions so a stale
# base-image layer cannot silently reintroduce the known vulnerabilities.
RUN apk add --no-cache --upgrade \
    "libexpat>=2.8.5-r0" \
    "libuuid>=2.42.3-r1"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
