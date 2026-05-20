# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit && npm cache clean --force

# Copy source code
COPY . .

# Build arguments for environment
ARG VITE_API_URL=""
ARG VITE_DEV_LOGIN=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_DEV_LOGIN=$VITE_DEV_LOGIN

# Build application
RUN npm run build

# Runtime stage - nginx
FROM nginx:1.27-alpine

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy built application from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Fix permissions for nginx (runs as www-data, uid 101)
RUN chown -R 101:101 /usr/share/nginx/html /var/cache/nginx /var/log/nginx

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
