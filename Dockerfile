# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image with backend + built frontend
FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Data volume for SQLite database
VOLUME ["/data"]

# Entrypoint auto-generates JWT_SECRET on first boot if not provided
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Build-time commit hash — passed in by deploy.sh via --build-arg
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/server.js"]
