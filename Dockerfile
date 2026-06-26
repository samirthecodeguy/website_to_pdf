# ==========================================
# Stage 1: Dependency Builder
# ==========================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies and clean npm cache
RUN npm ci --only=production && npm cache clean --force

# ==========================================
# Stage 2: Production Runner
# ==========================================
FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /usr/src/app

# Copy production dependencies from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application source code
COPY . .

# Create persistent storage directories inside the container:
# 1. /home/node/.web2md - for history logs (history.json)
# 2. /home/node/downloads - for converted files (bind-mounted to host machine)
# Set ownership to the non-root 'node' user
RUN mkdir -p /home/node/.web2md /home/node/downloads && \
    chown -R node:node /usr/src/app /home/node/.web2md /home/node/downloads

# Switch to the non-root user for security
USER node

# Expose the application port
EXPOSE 3000

# Execute server directly (avoiding npm script wraps to ensure proper OS signal forwarding)
CMD ["node", "server.js"]
