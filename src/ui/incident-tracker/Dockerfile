# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files from the incident-tracker directory
COPY src/ui/incident-tracker/package*.json ./


# Install dependencies
RUN npm ci --only=production

# Stage 2: Builder
FROM node:20-alpine AS builder

ARG VERSION
ENV VITE_VERSION=$VERSION
# Substituted with INCIDENT_TRACKER_BASE_PATH when the container starts;
# see docker-entrypoint.d/40-base-path.sh.
ENV VITE_BASE_PATH=/__INCIDENT_TRACKER_BASE_PATH__/

WORKDIR /app

# Copy package files
COPY src/ui/incident-tracker/package*.json ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy application source from incident-tracker directory
COPY src/ui/incident-tracker/ ./

# Build the React application
RUN npm run build

# Stage 3: Production
FROM nginx:alpine

# Install debugging tools (optional, remove for production)
#RUN apk add --no-cache bash curl wget bind-tools iputils netcat-openbsd vim jq

# nginx config template and the startup script that renders it and places
# the app at INCIDENT_TRACKER_BASE_PATH (default /incident-tracker).
COPY src/ui/incident-tracker/nginx.conf.template /etc/nginx/templates-current/default.conf.template
COPY --chmod=755 src/ui/incident-tracker/docker-entrypoint.d/40-base-path.sh /docker-entrypoint.d/40-base-path.sh

# The pristine build stays root-owned; the startup script copies it into
# the served directory and substitutes the base path there.
COPY --from=builder /app/dist /usr/share/nginx/html-dist

# Create a non-root user
RUN addgroup -g 1010 -S nginx-user && \
    adduser -S nginx-user -u 1010 -G nginx-user && \
    chown -R nginx-user:nginx-user /usr/share/nginx/html && \
    chown -R nginx-user:nginx-user /var/cache/nginx && \
    chown -R nginx-user:nginx-user /var/log/nginx && \
    chown -R nginx-user:nginx-user /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx-user:nginx-user /var/run/nginx.pid

# Switch to non-root user
USER nginx-user

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
